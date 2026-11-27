import type { FastifyInstance, FastifyRequest } from 'fastify';
import type {
  ApproveUserRequestDTO, RejectUserRequestDTO, ResetPasswordRequestDTO, SystemRole,
  UpdateUserRolesRequestDTO, UpdateUserStatusRequestDTO,
} from '@mysql-mcp/shared-types';
import { z } from 'zod';
import { ApiError } from './errors.js';
import { entityId, entityParams, parse } from './request-validation.js';
import type { UserAdministrationQueries } from './user-administration-queries.js';
import type { UserAdministrationService, GovernanceSession } from './user-administration-service.js';

const pagination = {
  page: z.string().regex(/^\d+$/).transform(Number).pipe(z.int().min(1)).default(1),
  pageSize: z.string().regex(/^\d+$/).transform(Number).pipe(z.int().min(1).max(100)).default(20),
};
const pendingQuery = z.strictObject(pagination);
const usersQuery = z.strictObject({
  ...pagination,
  search: z.string().optional(),
  status: z.enum(['ACTIVE', 'DISABLED', 'PENDING', 'REJECTED']).optional(),
  role: z.string().regex(/^[A-Z0-9_]{1,32}$/).optional(),
});
const version = z.int().min(1).max(4_294_967_295);
const approve = z.strictObject({ roleIds: z.array(entityId).min(1) }) satisfies z.ZodType<ApproveUserRequestDTO>;
const reject = z.strictObject({ reason: z.string().trim().min(1).max(512) }) satisfies z.ZodType<RejectUserRequestDTO>;
const status = z.strictObject({ status: z.enum(['ACTIVE', 'DISABLED']), version }) satisfies z.ZodType<UpdateUserStatusRequestDTO>;
const roles = z.strictObject({ roleIds: z.array(entityId), version }) satisfies z.ZodType<UpdateUserRolesRequestDTO>;
const reset = z.strictObject({
  newTemporaryPassword: z.string().optional(), mustChangePassword: z.boolean().optional(), version,
}) satisfies z.ZodType<ResetPasswordRequestDTO>;

function targetId(request: FastifyRequest) {
  const params = entityParams.safeParse(request.params);
  if (!params.success) throw new ApiError(404, 'ERR_NOT_FOUND');
  return params.data.id;
}

export function registerUserAdministrationRoutes(
  app: FastifyInstance,
  service: UserAdministrationService,
  queries: UserAdministrationQueries,
  guard: (roles: readonly SystemRole[]) => (request: FastifyRequest) => Promise<void>,
  current: (request: FastifyRequest) => GovernanceSession,
): void {
  const approvalGuard = { preHandler: guard(['SUPER_ADMIN', 'SECURITY_ADMIN']) };
  const userGuard = { preHandler: guard(['SUPER_ADMIN']) };
  app.get('/api/v1/approvals/pending', approvalGuard, async (request) =>
    queries.listApprovals(parse(pendingQuery, request.query)));
  app.post('/api/v1/approvals/:id/approve', approvalGuard, async (request) =>
    service.decideApproval(current(request), targetId(request), { action: 'APPROVE', ...parse(approve, request.body) }));
  app.post('/api/v1/approvals/:id/reject', approvalGuard, async (request) =>
    service.decideApproval(current(request), targetId(request), { action: 'REJECT', ...parse(reject, request.body) }));
  app.get('/api/v1/users', userGuard, async (request) => queries.listUsers(parse(usersQuery, request.query)));
  app.put('/api/v1/users/:id/status', userGuard, async (request) =>
    service.updateStatus(current(request), targetId(request), parse(status, request.body)));
  app.put('/api/v1/users/:id/roles', userGuard, async (request) =>
    service.updateRoles(current(request), targetId(request), parse(roles, request.body)));
  app.delete('/api/v1/users/:id', userGuard, async (request) => service.deleteUser(current(request), targetId(request)));
  app.post('/api/v1/users/:id/reset-password', userGuard, async (request) =>
    service.resetPassword(current(request), targetId(request), parse(reset, request.body)));
  app.get('/api/v1/roles', approvalGuard, async () => queries.listRoles());
}
