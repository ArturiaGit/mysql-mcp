import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import type { CurrentUserResponseDTO, SystemRole, UserProfileDTO } from '@mysql-mcp/shared-types';
import { z } from 'zod';
import { cookie, CSRF_COOKIE, equalSecret, parseCookies, PASSWORD_MAX_DAYS, PASSWORD_MIN_DAYS, SESSION_COOKIE, SESSION_TTL_SECONDS } from './auth-domain.js';
import type { AuthService } from './auth-service.js';
import { ApiError } from './errors.js';

interface RouteOptions { service: AuthService; secureCookies: boolean; ready: () => boolean; }
interface GuardPolicy {
  restricted?: 'all' | 'rejected';
  allowExpired?: boolean;
  roles?: readonly SystemRole[];
}

const username = z.string().regex(/^[A-Za-z0-9_-]{3,64}$/);
const password = z.string().min(1).max(1024);
const contact = { email: z.email().max(128).nullable().optional(), department: z.string().max(128).optional() };
const registerSchema = z.strictObject({ username, password, ...contact, reason: z.string().max(512).optional() });
const loginSchema = z.strictObject({ username, password });
const changeSchema = z.strictObject({ oldPassword: password, newPassword: password, revokeAllPats: z.boolean().optional() });
const policySchema = z.strictObject({ passwordExpiresDays: z.number().int().min(PASSWORD_MIN_DAYS).max(PASSWORD_MAX_DAYS).nullable() });
const resubmitSchema = z.strictObject({ ...contact, reason: z.string().trim().min(1).max(512) });

export async function registerAuthRoutes(app: FastifyInstance, { service, secureCookies, ready }: RouteOptions): Promise<void> {
  await app.register(rateLimit, { global: false, max: 100, timeWindow: 60_000 });
  const users = new WeakMap<FastifyRequest, UserProfileDTO>();
  const guard = (policy: GuardPolicy = {}) => async (request: FastifyRequest) => {
    const user = await service.authenticate(sessionId(request));
    assertGuard(user, policy);
    users.set(request, user);
  };
  function current(request: FastifyRequest): UserProfileDTO {
    const user = users.get(request);
    if (!user) throw new ApiError(401, 'ERR_AUTH_UNAUTHORIZED');
    return user;
  }
  const setCookies = (reply: FastifyReply, sid: string, seed: string) => reply.header('set-cookie', [
    cookie(SESSION_COOKIE, sid, secureCookies, SESSION_TTL_SECONDS),
    cookie(CSRF_COOKIE, seed, secureCookies, SESSION_TTL_SECONDS),
  ]);

  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/v1/')) return;
    reply.header('cache-control', 'no-store, no-cache, must-revalidate, private').header('pragma', 'no-cache').header('expires', '0');
    if (!ready()) throw new ApiError(503, 'ERR_INTERNAL_SERVER');
  });
  app.addHook('preValidation', async (request) => {
    if (!request.url.startsWith('/api/v1/') || !['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return;
    const cookies = parseCookies(request.headers.cookie);
    const seed = cookies.get(CSRF_COOKIE);
    const provided = request.headers['x-csrf-token'];
    const expected = service.csrfFor(cookies.get(SESSION_COOKIE), seed);
    if (typeof provided !== 'string' || !expected || !equalSecret(provided, expected)) throw new ApiError(403, 'ERR_CSRF_INVALID');
  });

  app.get('/api/v1/auth/csrf', async (request, reply) => {
    const cookies = parseCookies(request.headers.cookie);
    const previous = cookies.get(CSRF_COOKIE);
    const { seed, token } = service.createCsrf(cookies.get(SESSION_COOKIE), previous);
    if (seed !== previous) reply.header('set-cookie', cookie(CSRF_COOKIE, seed, secureCookies, SESSION_TTL_SECONDS));
    return { csrfToken: token };
  });
  app.post('/api/v1/auth/register', { config: { rateLimit: { max: 30, timeWindow: 60_000 } } }, async (request) => {
    await service.register(parse(registerSchema, request.body), request.ip);
    return { success: true, message: '注册申请已成功提交，请等待系统管理员审批。' };
  });
  app.post('/api/v1/auth/login', { config: { rateLimit: { max: 100, timeWindow: 60_000 } } }, async (request, reply) => {
    const { username, password } = parse(loginSchema, request.body);
    const { user, sid, seed } = await service.login(username, password, request.ip, sessionId(request));
    setCookies(reply, sid, seed);
    return { user };
  });
  const statusView = { restricted: 'all', allowExpired: true } as const;
  app.post('/api/v1/auth/logout', { preHandler: guard(statusView) }, async (request, reply) => {
    service.logout(sessionId(request));
    reply.header('set-cookie', [cookie(SESSION_COOKIE, '', secureCookies, 0), cookie(CSRF_COOKIE, '', secureCookies, 0)]);
    return { success: true };
  });
  app.post('/api/v1/auth/change-password', { config: { rateLimit: { max: 30, timeWindow: 60_000 } }, preHandler: guard({ allowExpired: true }) }, async (request, reply) => {
    const input = parse(changeSchema, request.body);
    const user = current(request);
    const authVersion = await service.changePassword(user, input);
    const { sid, seed } = service.issueRegeneratedSession(user.id, authVersion);
    setCookies(reply, sid, seed);
    return { success: true };
  });
  app.get('/api/v1/auth/me', { preHandler: guard(statusView) }, async (request): Promise<CurrentUserResponseDTO> => {
    const user = current(request);
    return user.status === 'ACTIVE' ? { ...user, status: user.status } : {
      id: user.id, username: user.username, email: user.email, department: user.department,
      status: user.status, reject_reason: user.reject_reason, created_at: user.created_at,
    };
  });
  app.get('/api/v1/auth/password-policy', { preHandler: guard({ allowExpired: true }) }, async (request) => service.getPasswordPolicy(current(request)));
  app.put('/api/v1/auth/password-policy', { preHandler: guard() }, async (request) => service.updatePasswordPolicy(current(request), parse(policySchema, request.body).passwordExpiresDays));
  app.post('/api/v1/approvals/resubmit', { config: { rateLimit: { max: 20, timeWindow: 60_000 } }, preHandler: guard({ restricted: 'rejected' }) }, async (request) => {
    await service.resubmit(current(request), parse(resubmitSchema, request.body));
    return { success: true };
  });

  // TC-BE-16 exercises the guard on this reserved M2 route. No PAT data is served in M1.
  app.setNotFoundHandler({ preHandler: async (request: FastifyRequest) => {
    if (request.method === 'GET' && request.url.split('?', 1)[0] === '/api/v1/pats') await guard()(request);
  } }, () => { throw new ApiError(404, 'ERR_NOT_FOUND'); });
}

function sessionId(request: FastifyRequest): string | undefined {
  return parseCookies(request.headers.cookie).get(SESSION_COOKIE);
}

export function assertGuard(user: UserProfileDTO, policy: GuardPolicy): void {
  if (user.status !== 'ACTIVE' && policy.restricted !== 'all' && !(user.status === 'REJECTED' && policy.restricted === 'rejected')) {
    if (user.status === 'PENDING') throw new ApiError(403, 'ERR_AUTH_ACCOUNT_PENDING');
    if (user.status === 'REJECTED') throw new ApiError(403, 'ERR_AUTH_ACCOUNT_REJECTED');
    throw new ApiError(403, 'ERR_AUTH_ACCOUNT_DISABLED');
  }
  if (user.status === 'ACTIVE' && !policy.allowExpired && (user.must_change_password || user.is_password_expired)) {
    throw new ApiError(403, 'ERR_MUST_CHANGE_PASSWORD');
  }
  if (policy.roles && !policy.roles.some((role) => user.roles.includes(role))) throw new ApiError(403, 'ERR_RBAC_FORBIDDEN');
}

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (parsed.success) return parsed.data;
  throw new ApiError(400, 'ERR_VALIDATION_FAILED', { validation_errors: parsed.error.issues.map(({ path, code }) => ({
    field: path.map(String).join('.'), message: '字段格式无效。', rule: code,
  })) });
}
