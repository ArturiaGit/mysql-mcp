import { withMetadataTransaction, type MetadataPool, type MetadataQueryExecutor, type MetadataRow, type MetadataWriteResult } from '@mysql-mcp/core-engine';
import { hashPassword, verifyPassword } from '@mysql-mcp/security';
import type {
  ChangePasswordRequestDTO, EntityId, RegisterRequestDTO, ResubmitApprovalRequestDTO,
  SystemRole, UpdatePasswordPolicyResponseDTO, UserProfileDTO, UserStatus,
} from '@mysql-mcp/shared-types';
import { csrfToken, hasStrongPassword, newSecret, passwordExpiry, passwordPolicyDTO, SESSION_TTL_SECONDS } from './auth-domain.js';
import { ApiError } from './errors.js';
import { IpAttemptLimiter } from './ip-attempt-limiter.js';

interface UserRow extends MetadataRow {
  id: EntityId; username: string; password_hash: string; email: string | null; department: string | null;
  status: UserStatus; must_change_password: number; password_updated_at: Date;
  password_expires_days: number | null; auth_version: number; version: number; failed_login_count: number;
  locked_until: Date | null; created_at: Date;
}
interface Session { userId: EntityId; authVersion: number; expiresAt: number; seed: string; }
type LoginOutcome = { user: UserProfileDTO; authVersion: number } | { error: ApiError };
const maxSessions = 10_000;

export class AuthService {
  private readonly sessions = new Map<string, Session>();
  private readonly loginLimit = new IpAttemptLimiter(20);
  private readonly registerLimit = new IpAttemptLimiter(10);
  private dummyHash?: Promise<string>;

  constructor(private readonly pool: MetadataPool, private readonly db: MetadataQueryExecutor, private readonly secret: string) {}

  createCsrf(sid: string | undefined, previous: string | undefined) {
    const session = this.liveSession(sid);
    const seed = session?.seed ?? (previous && /^[a-f0-9]{64}$/.test(previous) ? previous : newSecret());
    return { seed, token: csrfToken(`${session ? sid : 'anonymous'}:${seed}`, this.secret) };
  }

  csrfFor(sid: string | undefined, seed: string | undefined): string | undefined {
    if (!seed || !/^[a-f0-9]{64}$/.test(seed)) return undefined;
    const session = this.liveSession(sid);
    if (session && session.seed !== seed) return undefined;
    return csrfToken(`${session ? sid : 'anonymous'}:${seed}`, this.secret);
  }

  async register(input: RegisterRequestDTO, ip: string): Promise<void> {
    this.registerLimit.admit(ip);
    if (!hasStrongPassword(input.password)) throw new ApiError(400, 'ERR_PASSWORD_POLICY_VIOLATED');
    const encoded = await this.hash(input.password);
    try {
      await withMetadataTransaction(this.pool, async (tx) => {
        await tx.query(
          "INSERT INTO sys_users (username, password_hash, email, department, apply_reason, status, must_change_password, password_expires_days) VALUES (?, ?, ?, ?, ?, 'PENDING', 0, 90)",
          [input.username, encoded, input.email ?? null, input.department ?? null, input.reason ?? null],
        );
        const [[inserted]] = await tx.query<(MetadataRow & { id: EntityId })[]>('SELECT CAST(LAST_INSERT_ID() AS CHAR) AS id');
        if (!inserted) throw new Error('Missing registered user ID');
        await tx.query("INSERT INTO sys_user_approvals (user_id, action, operator_id, application_reason, target_type, target_id) VALUES (?, 'SUBMIT', 0, ?, 'USER', ?)", [inserted.id, input.reason ?? null, inserted.id]);
      });
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ER_DUP_ENTRY') throw new ApiError(409, 'ERR_AUTH_USERNAME_EXISTS');
      throw error;
    }
  }

  async login(username: string, password: string, ip: string, oldSid: string | undefined) {
    this.loginLimit.admit(ip);
    const [[snapshot]] = await this.db.query<UserRow[]>('SELECT * FROM sys_users WHERE username = ?', [username]);
    if (!snapshot) {
      this.dummyHash ??= this.hash(newSecret()).catch((error: unknown) => { this.dummyHash = undefined; throw error; });
      await this.verify(await this.dummyHash, password);
      await this.auditLogin(ip, 'AUTH_FAILED');
      throw loginFailed(1);
    }
    const lock = accountLock(snapshot, Date.now());
    if (lock) throw lock;
    // Keep Argon2 outside row locks, then serialize the decision and counters on the current row.
    const matches = await this.verify(snapshot.password_hash, password);
    const outcome = await withMetadataTransaction<LoginOutcome>(this.pool, async (tx) => {
      const [[row]] = await tx.query<UserRow[]>('SELECT * FROM sys_users WHERE id = ? FOR UPDATE', [snapshot.id]);
      if (!row || row.password_hash !== snapshot.password_hash) return { error: loginFailed(1) };
      const now = Date.now();
      const locked = accountLock(row, now);
      if (locked) return { error: locked };
      if (!matches) {
        const count = (row.locked_until ? 0 : row.failed_login_count) + 1;
        const until = count >= 5 ? new Date(now + 900_000) : null;
        await tx.query('UPDATE sys_users SET failed_login_count = ?, locked_until = ? WHERE id = ?', [count, until, row.id]);
        await this.auditLogin(ip, until ? 'BRUTE_FORCE_LOCKED' : 'AUTH_FAILED', tx);
        return { error: until ? new ApiError(429, 'ERR_AUTH_ACCOUNT_LOCKED', { retry_after_sec: 900 }) : loginFailed(count) };
      }
      await tx.query('UPDATE sys_users SET failed_login_count = 0, locked_until = NULL WHERE id = ?', [row.id]);
      return { user: await this.profile(row, tx), authVersion: row.auth_version };
    });
    if ('error' in outcome) throw outcome.error;
    this.logout(oldSid);
    return { user: outcome.user, ...this.issueSession(outcome.user.id, outcome.authVersion) };
  }

  async authenticate(sid: string | undefined): Promise<UserProfileDTO> {
    const session = this.liveSession(sid);
    if (!session) throw new ApiError(401, 'ERR_AUTH_UNAUTHORIZED');
    const [[row]] = await this.db.query<UserRow[]>('SELECT * FROM sys_users WHERE id = ?', [session.userId]);
    if (!row || (row.status === 'ACTIVE' && row.auth_version !== session.authVersion) || this.liveSession(sid) !== session) {
      throw new ApiError(401, 'ERR_AUTH_UNAUTHORIZED');
    }
    const user = await this.profile(row, this.db);
    if (this.liveSession(sid) !== session) throw new ApiError(401, 'ERR_AUTH_UNAUTHORIZED');
    return user;
  }

  logout(sid: string | undefined): void { if (sid) this.sessions.delete(sid); }

  async changePassword(user: UserProfileDTO, { oldPassword, newPassword, revokeAllPats = true }: ChangePasswordRequestDTO) {
    const [[row]] = await this.db.query<UserRow[]>('SELECT * FROM sys_users WHERE id = ?', [user.id]);
    if (!row || !(await this.verify(row.password_hash, oldPassword))) throw new ApiError(400, 'ERR_OLD_PASSWORD_INVALID');
    if (!hasStrongPassword(newPassword)) throw new ApiError(400, 'ERR_PASSWORD_POLICY_VIOLATED');
    if (newPassword === oldPassword) throw new ApiError(400, 'ERR_SAME_AS_OLD_PASSWORD');
    const encoded = await this.hash(newPassword);
    await withMetadataTransaction(this.pool, async (tx) => {
      const [result] = await tx.query<MetadataWriteResult>(
        "UPDATE sys_users SET password_hash = ?, must_change_password = 0, password_updated_at = UTC_TIMESTAMP(3), auth_version = auth_version + 1, version = version + 1 WHERE id = ? AND status = 'ACTIVE' AND auth_version = ? AND version = ?",
        [encoded, user.id, row.auth_version, user.version],
      );
      if (result.affectedRows !== 1) throw new ApiError(409, 'ERR_CONCURRENCY_CONFLICT');
      if (revokeAllPats) await tx.query('UPDATE sys_pats SET revoked_at = UTC_TIMESTAMP(3) WHERE user_id = ? AND revoked_at IS NULL', [user.id]);
      await tx.query("INSERT INTO sys_user_approvals (user_id, action, operator_id, target_type, target_id, details) VALUES (?, 'STATUS_CHANGE', ?, 'USER', ?, JSON_OBJECT('event', 'PASSWORD_CHANGED'))", [user.id, user.id, user.id]);
    });
    for (const [id, session] of this.sessions) if (session.userId === user.id) this.sessions.delete(id);
    return this.issueSession(user.id, row.auth_version + 1);
  }

  getPasswordPolicy(user: UserProfileDTO) {
    return passwordPolicyDTO(user.password_expires_days, new Date(user.password_updated_at));
  }

  async updatePasswordPolicy(user: UserProfileDTO, days: number | null): Promise<UpdatePasswordPolicyResponseDTO> {
    return withMetadataTransaction(this.pool, async (tx) => {
      const [result] = await tx.query<MetadataWriteResult>(
        "UPDATE sys_users SET password_expires_days = ?, version = version + 1 WHERE id = ? AND version = ? AND status = 'ACTIVE' AND must_change_password = 0 AND (password_expires_days IS NULL OR UTC_TIMESTAMP(3) <= TIMESTAMPADD(DAY, password_expires_days, password_updated_at))",
        [days, user.id, user.version],
      );
      if (result.affectedRows !== 1) throw new ApiError(409, 'ERR_CONCURRENCY_CONFLICT');
      await tx.query("INSERT INTO sys_user_approvals (user_id, action, operator_id, target_type, target_id, details) VALUES (?, 'CONFIG_UPDATE', ?, 'USER', ?, JSON_OBJECT('passwordExpiresDays', ?))", [user.id, user.id, user.id, days]);
      return { success: true, passwordExpiresDays: days, passwordExpiresAt: passwordExpiry(new Date(user.password_updated_at), days)?.toISOString() ?? null, isExpirationEnabled: days !== null };
    });
  }

  async resubmit(user: UserProfileDTO, input: ResubmitApprovalRequestDTO): Promise<void> {
    if (user.status !== 'REJECTED') throw new ApiError(409, 'ERR_INVALID_STATUS_TRANSITION');
    await withMetadataTransaction(this.pool, async (tx) => {
      // Approval mutations share the SUPER_ADMIN → user → role bindings lock order.
      const [[superRole]] = await tx.query<(MetadataRow & { id: EntityId })[]>('SELECT id FROM sys_roles WHERE role_name = ? FOR UPDATE', ['SUPER_ADMIN']);
      if (!superRole) throw new Error('Missing SUPER_ADMIN role');
      const [[lockedUser]] = await tx.query<(MetadataRow & Pick<UserRow, 'id' | 'version' | 'status'>)[]>('SELECT id, version, status FROM sys_users WHERE id = ? FOR UPDATE', [user.id]);
      if (lockedUser?.status !== 'REJECTED' || lockedUser.version !== user.version) throw new ApiError(409, 'ERR_INVALID_STATUS_TRANSITION');
      await tx.query('SELECT id FROM sys_user_roles WHERE user_id = ? ORDER BY role_id FOR UPDATE', [user.id]);
      const [result] = await tx.query<MetadataWriteResult>(
        "UPDATE sys_users SET status = 'PENDING', apply_reason = ?, email = IF(?, ?, email), department = COALESCE(?, department), version = version + 1 WHERE id = ? AND status = 'REJECTED' AND version = ?",
        [input.reason, input.email !== undefined, input.email ?? null, input.department ?? null, user.id, user.version],
      );
      if (result.affectedRows !== 1) throw new ApiError(409, 'ERR_INVALID_STATUS_TRANSITION');
      await tx.query("INSERT INTO sys_user_approvals (user_id, action, operator_id, application_reason, target_type, target_id) VALUES (?, 'RESUBMIT', ?, ?, 'USER', ?)", [user.id, user.id, input.reason, user.id]);
    });
  }

  private liveSession(sid: string | undefined): Session | undefined {
    const session = sid ? this.sessions.get(sid) : undefined;
    return session && session.expiresAt > Date.now() ? session : undefined;
  }

  private issueSession(userId: EntityId, authVersion: number) {
    const now = Date.now();
    if (this.sessions.size >= maxSessions) {
      for (const [id, session] of this.sessions) if (session.expiresAt <= now) this.sessions.delete(id);
      const oldest = this.sessions.keys().next().value;
      if (this.sessions.size >= maxSessions && oldest) this.sessions.delete(oldest);
    }
    const sid = newSecret();
    const seed = newSecret();
    this.sessions.set(sid, { userId, authVersion, seed, expiresAt: now + SESSION_TTL_SECONDS * 1000 });
    return { sid, seed };
  }

  private async profile(user: UserRow, db: MetadataQueryExecutor): Promise<UserProfileDTO> {
    const [roles] = await db.query<(MetadataRow & { role: SystemRole })[]>(
      'SELECT r.role_name AS role FROM sys_user_roles ur JOIN sys_roles r ON r.id = ur.role_id WHERE ur.user_id = ? ORDER BY r.role_name', [user.id],
    );
    const [[rejection]] = user.status === 'REJECTED' ? await db.query<(MetadataRow & { reason: string | null })[]>(
      "SELECT reason FROM sys_user_approvals WHERE user_id = ? AND action = 'REJECT' ORDER BY created_at DESC, id DESC LIMIT 1", [user.id],
    ) : [[]];
    const updatedAt = user.password_updated_at;
    const expiresAt = passwordExpiry(updatedAt, user.password_expires_days);
    return {
      id: user.id, username: user.username, email: user.email, department: user.department,
      status: user.status, must_change_password: user.must_change_password === 1,
      password_updated_at: updatedAt.toISOString(), password_expires_days: user.password_expires_days,
      password_expires_at: expiresAt?.toISOString() ?? null,
      is_password_expired: expiresAt !== null && Date.now() > expiresAt.getTime(),
      version: user.version, roles: roles.map(({ role }) => role), reject_reason: rejection?.reason ?? null,
      created_at: user.created_at.toISOString(),
    };
  }

  private async auditLogin(ip: string, event: 'AUTH_FAILED' | 'BRUTE_FORCE_LOCKED', db = this.db) {
    await db.query('INSERT INTO sys_anonymous_security_logs (client_ip, request_path, event_type) VALUES (?, ?, ?)', [ip, '/api/v1/auth/login', event]);
  }

  private hash(password: string): Promise<string> { return boundedArgon(() => hashPassword(password)); }
  private verify(encoded: string, password: string): Promise<boolean> { return boundedArgon(() => verifyPassword(encoded, password)); }
}

async function boundedArgon<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); }
  catch (error) {
    if (error instanceof Error && error.message === 'ARGON2_CAPACITY_EXCEEDED') throw new ApiError(429, 'ERR_RATE_LIMIT_USER', { retry_after_sec: 1 });
    throw error;
  }
}

function accountLock(user: UserRow, now: number): ApiError | undefined {
  const remaining = (user.locked_until?.getTime() ?? 0) - now;
  if (remaining > 0) return new ApiError(429, 'ERR_AUTH_ACCOUNT_LOCKED', { retry_after_sec: Math.ceil(remaining / 1000) });
  return undefined;
}

function loginFailed(count: number): ApiError {
  return new ApiError(401, 'ERR_AUTH_FAILED', { remaining_attempts: Math.max(0, 5 - count) });
}
