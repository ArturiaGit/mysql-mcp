import { randomInt } from 'node:crypto';
import { withMetadataTransaction, type MetadataPool, type MetadataQueryExecutor, type MetadataRow, type MetadataWriteResult } from '@mysql-mcp/core-engine';
import { hashPassword } from '@mysql-mcp/security';
import type {
  ActionSuccessDTO, ApproveUserRequestDTO, EntityId, RejectUserRequestDTO, ResetPasswordRequestDTO,
  ResetPasswordResponseDTO, SystemRole, UpdateUserRolesRequestDTO, UpdateUserStatusRequestDTO,
  UserStatus, VersionedActionSuccessDTO,
} from '@mysql-mcp/shared-types';
import { hasStrongPassword, passwordExpiry } from './auth-domain.js';
import { boundedArgon, type AuthService } from './auth-service.js';
import { ApiError } from './errors.js';
import { invalidateAfterCommit } from './post-commit-invalidation.js';
import type { PatRevocationHooks } from './pat-service.js';

export interface GovernanceSession { user: { id: EntityId }; authVersion: number; }
export type UserCancellationReason = 'ACCOUNT_DISABLED' | 'USER_ROLES_CHANGED' | 'PASSWORD_RESET' | 'USER_DELETED';
export interface UserInvalidationHooks {
  markUserInvalidatedSync(id: EntityId): undefined;
  cancelQueriesByUser(id: EntityId, reason: UserCancellationReason): void | Promise<void>;
}

interface UserRow extends MetadataRow {
  id: EntityId;
  status: UserStatus;
  version: number;
  auth_version: number;
  must_change_password: number;
  password_expires_days: number | null;
  password_updated_at: Date;
}
interface IdRow extends MetadataRow { id: EntityId; }
interface ApprovalRow extends MetadataRow { user_id: EntityId; action: string; }
interface BindingRow extends MetadataRow { user_id: EntityId; role_id: EntityId; }

interface GovernanceState {
  target: UserRow;
  actor: UserRow | undefined;
  superRoleId: EntityId;
  activeSuperAdmins: Set<EntityId>;
  bindings: BindingRow[];
  requestedRoleIds: EntityId[];
  rolesExist: boolean;
}

type ApprovalDecision = ({ action: 'APPROVE' } & ApproveUserRequestDTO) | ({ action: 'REJECT' } & RejectUserRequestDTO);
type UserAudit = { action: 'STATUS_CHANGE' | 'ROLE_CHANGE' | 'CONFIG_UPDATE'; details: object };
const superAdminRoles = ['SUPER_ADMIN'] as const;
const approvalRoles = ['SUPER_ADMIN', 'SECURITY_ADMIN'] as const;

export class UserAdministrationService {
  constructor(
    private readonly pool: MetadataPool,
    private readonly db: MetadataQueryExecutor,
    private readonly auth: AuthService,
    private readonly onInvalidationFailure: () => void,
    private readonly invalidation?: UserInvalidationHooks,
    private readonly patRevocation?: PatRevocationHooks,
  ) {}

  async decideApproval(session: GovernanceSession, approvalId: EntityId, decision: ApprovalDecision): Promise<ActionSuccessDTO> {
    // This read locates the user. Both rows are rechecked under their transaction locks.
    const [[located]] = await this.db.query<ApprovalRow[]>(
      'SELECT user_id FROM sys_user_approvals WHERE id = CAST(CAST(? AS CHAR) AS UNSIGNED)', [approvalId],
    );
    if (!located) throw new ApiError(404, 'ERR_NOT_FOUND');
    const targetId = located.user_id;
    await withGovernanceTransaction(this.pool, async (tx) => {
      const state = await lockGovernance(tx, session, targetId,
        decision.action === 'APPROVE' ? decision.roleIds : [], approvalConflict);
      await authorizeMutation(tx, state, session, approvalRoles);
      requireValidRoles(state);
      const { requestedRoleIds: roleIds } = state;
      if (roleIds.includes(state.superRoleId) && !state.bindings.some(
        (binding) => binding.user_id === session.user.id && binding.role_id === state.superRoleId,
      )) {
        throw new ApiError(403, 'ERR_RBAC_FORBIDDEN', { requiredRoles: superAdminRoles });
      }
      const [[approval]] = await tx.query<ApprovalRow[]>(
        'SELECT user_id, action FROM sys_user_approvals WHERE id = CAST(CAST(? AS CHAR) AS UNSIGNED) FOR UPDATE', [approvalId],
      );
      if (!approval || approval.user_id !== targetId || (approval.action !== 'SUBMIT' && approval.action !== 'RESUBMIT')
        || state.target.status !== 'PENDING') throw approvalConflict();

      const decided = decision.action === 'APPROVE'
        ? await tx.query<MetadataWriteResult>(
          `UPDATE sys_user_approvals SET action = 'APPROVE', operator_id = ?, decided_at = UTC_TIMESTAMP(3), details = ?
           WHERE id = CAST(CAST(? AS CHAR) AS UNSIGNED) AND action IN ('SUBMIT', 'RESUBMIT')`,
          [session.user.id, JSON.stringify({ roleIds }), approvalId],
        )
        : await tx.query<MetadataWriteResult>(
          `UPDATE sys_user_approvals SET action = 'REJECT', reason = ?, operator_id = ?, decided_at = UTC_TIMESTAMP(3)
           WHERE id = CAST(CAST(? AS CHAR) AS UNSIGNED) AND action IN ('SUBMIT', 'RESUBMIT')`, [decision.reason, session.user.id, approvalId],
        );
      if (decided[0].affectedRows !== 1) throw approvalConflict();
      const approved = decision.action === 'APPROVE';
      const [updated] = await tx.query<MetadataWriteResult>(
        `UPDATE sys_users SET status = ?, must_change_password = IF(?, 0, must_change_password),
          version = version + 1, auth_version = auth_version + 1 WHERE id = CAST(CAST(? AS CHAR) AS UNSIGNED) AND status = 'PENDING'`,
        [approved ? 'ACTIVE' : 'REJECTED', approved, targetId],
      );
      if (updated.affectedRows !== 1) throw approvalConflict();
      if (approved) {
        await tx.query('DELETE FROM sys_user_roles WHERE user_id = CAST(CAST(? AS CHAR) AS UNSIGNED)', [targetId]);
        await insertBindings(tx, targetId, roleIds);
      }
    });
    await this.invalidate(targetId);
    return { success: true };
  }

  async updateStatus(session: GovernanceSession, id: EntityId, input: UpdateUserStatusRequestDTO): Promise<VersionedActionSuccessDTO> {
    const { status, version } = input;
    await withGovernanceTransaction(this.pool, async (tx) => {
      const state = await lockGovernance(tx, session, id);
      // Preserve the last-super-admin veto for mutually destructive requests that both passed L4.
      if (status === 'DISABLED') requireSafeRemoval(state, session);
      await authorizeMutation(tx, state, session, superAdminRoles);
      requireVersion(state.target, version);
      const current = state.target.status;
      if ((current !== 'ACTIVE' && current !== 'DISABLED') || current === status) {
        throw new ApiError(400, 'ERR_INVALID_STATUS_TRANSITION', { current_status: current });
      }
      await updateUserCAS(tx, state.target, version, 'status = ?', [status]);
      await auditUser(tx, session, id, { action: 'STATUS_CHANGE', details: { previousStatus: current, status, version: version + 1 } });
    });
    await this.invalidate(id, status === 'DISABLED' ? 'ACCOUNT_DISABLED' : undefined);
    return { success: true, version: version + 1 };
  }

  async updateRoles(session: GovernanceSession, id: EntityId, input: UpdateUserRolesRequestDTO): Promise<VersionedActionSuccessDTO> {
    const { version } = input;
    await withGovernanceTransaction(this.pool, async (tx) => {
      const state = await lockGovernance(tx, session, id, input.roleIds);
      const previousRoleIds = state.bindings.filter((binding) => binding.user_id === id).map((binding) => binding.role_id);
      if (previousRoleIds.includes(state.superRoleId) && !input.roleIds.includes(state.superRoleId)) requireSafeRemoval(state, session);
      await authorizeMutation(tx, state, session, superAdminRoles);
      requireVersion(state.target, version);
      requireValidRoles(state);
      const { requestedRoleIds: roleIds } = state;
      await updateUserCAS(tx, state.target, version);
      await tx.query('DELETE FROM sys_user_roles WHERE user_id = CAST(CAST(? AS CHAR) AS UNSIGNED)', [id]);
      await insertBindings(tx, id, roleIds);
      await auditUser(tx, session, id, { action: 'ROLE_CHANGE', details: { previousRoleIds, roleIds, version: version + 1 } });
    });
    await this.invalidate(id, 'USER_ROLES_CHANGED');
    return { success: true, version: version + 1 };
  }

  async deleteUser(session: GovernanceSession, id: EntityId): Promise<ActionSuccessDTO> {
    const patIds = await withGovernanceTransaction(this.pool, async (tx) => {
      const state = await lockGovernance(tx, session, id);
      requireSafeRemoval(state, session);
      await authorizeMutation(tx, state, session, superAdminRoles);
      // Acquire the USER limit lock before the approval row, then cancel the work order before deleting data.
      await tx.query("SELECT id FROM sys_rate_limits WHERE scope_type = 'USER' AND scope_id = CAST(CAST(? AS CHAR) AS UNSIGNED) FOR UPDATE", [id]);
      await tx.query(
        `UPDATE sys_user_approvals SET action = 'CANCELED', operator_id = ?, reason = ?, decided_at = UTC_TIMESTAMP(3)
         WHERE pending_user_id = CAST(CAST(? AS CHAR) AS UNSIGNED)`, [session.user.id, '目标用户已删除', id],
      );
      await tx.query("DELETE FROM sys_rate_limits WHERE scope_type = 'USER' AND scope_id = CAST(CAST(? AS CHAR) AS UNSIGNED)", [id]);
      const [pats] = await tx.query<IdRow[]>(
        'SELECT id FROM sys_pats WHERE user_id = CAST(CAST(? AS CHAR) AS UNSIGNED) AND revoked_at IS NULL ORDER BY id FOR UPDATE', [id],
      );
      await tx.query('DELETE FROM sys_users WHERE id = CAST(CAST(? AS CHAR) AS UNSIGNED)', [id]);
      await auditUser(tx, session, id, { action: 'CONFIG_UPDATE', details: { operation: 'USER_DELETE' } });
      return pats.map((pat) => pat.id);
    });
    await this.invalidate(id, 'USER_DELETED', patIds);
    return { success: true };
  }

  async resetPassword(session: GovernanceSession, id: EntityId, input: ResetPasswordRequestDTO): Promise<ResetPasswordResponseDTO> {
    const { version, mustChangePassword = true } = input;
    const temporaryPassword = input.newTemporaryPassword ?? generateTemporaryPassword();
    if (!hasStrongPassword(temporaryPassword)) throw new ApiError(400, 'ERR_PASSWORD_POLICY_VIOLATED');
    const encoded = await boundedArgon(() => hashPassword(temporaryPassword));
    await withGovernanceTransaction(this.pool, async (tx) => {
      const state = await lockGovernance(tx, session, id);
      await authorizeMutation(tx, state, session, superAdminRoles);
      requireVersion(state.target, version);
      await updateUserCAS(tx, state.target, version,
        `password_hash = ?, must_change_password = ?, password_updated_at = UTC_TIMESTAMP(3),
         failed_login_count = 0, locked_until = NULL`, [encoded, mustChangePassword]);
      await auditUser(tx, session, id, { action: 'CONFIG_UPDATE', details: { operation: 'PASSWORD_RESET', mustChangePassword, version: version + 1 } });
    });
    await this.invalidate(id, 'PASSWORD_RESET');
    return { success: true, temporaryPassword, version: version + 1 };
  }

  private async invalidate(id: EntityId, reason?: UserCancellationReason, patIds: readonly EntityId[] = []): Promise<void> {
    await invalidateAfterCommit(this.onInvalidationFailure, [
      () => { if (reason) this.auth.revokeUserSessions(id); },
      () => this.invalidation?.markUserInvalidatedSync(id),
      ...patIds.map((patId) => () => this.patRevocation?.markPatRevokedSync(patId)),
    ], [
      ...(reason ? [() => this.invalidation?.cancelQueriesByUser(id, reason)] : []),
      ...patIds.map((patId) => () => this.patRevocation?.cancelQueriesByPat(patId, 'PAT_REVOKED')),
    ]);
  }
}

async function withGovernanceTransaction<T>(pool: MetadataPool, operation: (tx: MetadataQueryExecutor) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    let retryable = false;
    try {
      return await withMetadataTransaction(pool, async (tx) => {
        try { return await operation(tx); }
        catch (error) {
          retryable = error instanceof Error && 'code' in error
            && (error.code === 'ER_LOCK_DEADLOCK' || error.code === 'ER_LOCK_WAIT_TIMEOUT');
          throw error;
        }
      });
    } catch (error) {
      // A failed COMMIT may have landed. Only retry lock errors originating inside the transaction body.
      if (!retryable || attempt === 3) throw error;
    }
  }
}

async function lockGovernance(
  tx: MetadataQueryExecutor, session: GovernanceSession, targetId: EntityId,
  roleIds: readonly EntityId[] = [],
  missingTarget = () => new ApiError(404, 'ERR_NOT_FOUND'),
): Promise<GovernanceState> {
  const [[superRole]] = await tx.query<IdRow[]>("SELECT id FROM sys_roles WHERE role_name = 'SUPER_ADMIN' FOR UPDATE");
  if (!superRole) throw new Error('Missing SUPER_ADMIN role');
  // Governance writes share the permanent role row and take current reads in the same order.
  const [users] = await tx.query<UserRow[]>(
    `SELECT id, status, version, auth_version, must_change_password, password_expires_days, password_updated_at
     FROM sys_users FORCE INDEX (PRIMARY) ORDER BY id FOR UPDATE`,
  );
  const target = users.find((user) => user.id === targetId);
  if (!target) throw missingTarget();
  const { requestedRoleIds, rolesExist } = await lockRequestedRoles(tx, superRole.id, roleIds);
  const [bindings] = await tx.query<BindingRow[]>(
    `SELECT user_id, role_id FROM sys_user_roles FORCE INDEX (uk_user_role)
     WHERE user_id IN (CAST(CAST(? AS CHAR) AS UNSIGNED), CAST(CAST(? AS CHAR) AS UNSIGNED)) OR role_id = CAST(CAST(? AS CHAR) AS UNSIGNED)
     ORDER BY user_id, role_id FOR UPDATE`, [session.user.id, targetId, superRole.id],
  );
  const superUsers = new Set(bindings.filter((row) => row.role_id === superRole.id).map((row) => row.user_id));
  return {
    target, actor: users.find((user) => user.id === session.user.id), superRoleId: superRole.id, bindings, requestedRoleIds, rolesExist,
    activeSuperAdmins: new Set(users.filter((user) => user.status === 'ACTIVE' && superUsers.has(user.id)).map((user) => user.id)),
  };
}

async function authorizeMutation(tx: MetadataQueryExecutor, state: GovernanceState, session: GovernanceSession, requiredRoles: readonly SystemRole[]): Promise<void> {
  const { actor, bindings, superRoleId } = state;
  // The HTTP guard may have run before a concurrent freeze, role change or password reset committed.
  if (!actor || actor.status !== 'ACTIVE' || actor.auth_version !== session.authVersion) throw new ApiError(401, 'ERR_AUTH_UNAUTHORIZED');
  const expiry = passwordExpiry(actor.password_updated_at, actor.password_expires_days);
  if (actor.must_change_password === 1 || (expiry !== null && Date.now() > expiry.getTime())) {
    throw new ApiError(403, 'ERR_MUST_CHANGE_PASSWORD');
  }
  const actorRoleIds = bindings.filter((binding) => binding.user_id === actor.id).map((binding) => binding.role_id);
  if (actorRoleIds.includes(superRoleId)) return;
  if (requiredRoles.includes('SECURITY_ADMIN')) {
    const [[securityRole]] = await tx.query<IdRow[]>("SELECT id FROM sys_roles WHERE role_name = 'SECURITY_ADMIN'");
    if (securityRole && actorRoleIds.includes(securityRole.id)) return;
  }
  throw new ApiError(403, 'ERR_RBAC_FORBIDDEN', { requiredRoles });
}

function requireSafeRemoval(state: GovernanceState, session: GovernanceSession): void {
  const id = state.target.id;
  if (id === session.user.id) throw new ApiError(400, 'ERR_SELF_ACTION_PROHIBITED');
  if (state.activeSuperAdmins.has(id) && state.activeSuperAdmins.size === 1) throw new ApiError(400, 'ERR_LAST_SUPER_ADMIN');
}

async function lockRequestedRoles(tx: MetadataQueryExecutor, superRoleId: EntityId, ids: readonly EntityId[]) {
  const requestedRoleIds = [...new Set(ids)];
  const otherIds = requestedRoleIds.filter((id) => id !== superRoleId);
  if (otherIds.length === 0) return { requestedRoleIds, rolesExist: true };
  // Keep the parameter textual until conversion to preserve IDs above signed BIGINT.
  const [rows] = await tx.query<IdRow[]>(
    `SELECT id FROM sys_roles WHERE id IN (${otherIds.map(() => 'CAST(CAST(? AS CHAR) AS UNSIGNED)').join(', ')})
     ORDER BY id FOR SHARE`, otherIds,
  );
  return { requestedRoleIds, rolesExist: rows.length === otherIds.length };
}

function requireValidRoles(state: GovernanceState): void {
  if (!state.rolesExist) throw new ApiError(400, 'ERR_VALIDATION_FAILED', {
    validation_errors: [{ field: 'roleIds', message: '角色列表包含不存在的角色。', rule: 'unknown_role' }],
  });
}

async function insertBindings(tx: MetadataQueryExecutor, id: EntityId, roleIds: readonly EntityId[]): Promise<void> {
  if (roleIds.length === 0) return;
  await tx.query(`INSERT INTO sys_user_roles (user_id, role_id) VALUES ${roleIds.map(() => '(?, ?)').join(', ')}`,
    roleIds.flatMap((roleId) => [id, roleId]));
}

function approvalConflict() { return new ApiError(409, 'ERR_APPROVAL_STATE_CONFLICT'); }

function requireVersion(target: UserRow, version: number): void {
  if (target.version !== version) throw versionConflict(target, version);
}

function versionConflict(target: UserRow, submitted_version: number) {
  return new ApiError(409, 'ERR_CONCURRENCY_CONFLICT', { current_version: target.version, submitted_version });
}

async function updateUserCAS(
  tx: MetadataQueryExecutor, target: UserRow, version: number, assignments?: string, params: readonly (string | boolean)[] = [],
): Promise<void> {
  const [updated] = await tx.query<MetadataWriteResult>(
    `UPDATE sys_users SET ${assignments ? `${assignments}, ` : ''}version = version + 1, auth_version = auth_version + 1
     WHERE id = CAST(CAST(? AS CHAR) AS UNSIGNED) AND version = ?`, [...params, target.id, version],
  );
  if (updated.affectedRows !== 1) throw versionConflict(target, version);
}

async function auditUser(tx: MetadataQueryExecutor, session: GovernanceSession, id: EntityId, audit: UserAudit): Promise<void> {
  await tx.query(
    `INSERT INTO sys_user_approvals (user_id, action, operator_id, target_type, target_id, details)
     VALUES (?, ?, ?, 'USER', ?, ?)`, [id, audit.action, session.user.id, id, JSON.stringify(audit.details)],
  );
}

const passwordAlphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!#$%&*+-=?@_';
export function generateTemporaryPassword(): string {
  let value: string;
  do {
    value = Array.from({ length: 16 }, () => passwordAlphabet.charAt(randomInt(passwordAlphabet.length))).join('');
  } while (!hasStrongPassword(value));
  return value;
}
