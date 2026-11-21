import {
  withMetadataTransaction, type MetadataPool, type MetadataQueryExecutor, type MetadataRow, type MetadataWriteResult,
} from '@mysql-mcp/core-engine';
import { createPatToken, hashPatToken } from '@mysql-mcp/security';
import type { CreatePatResponseDTO, EntityId, PatListItemDTO, ProfileOptionDTO } from '@mysql-mcp/shared-types';
import { passwordExpiry } from './auth-domain.js';
import { ApiError } from './errors.js';

interface PatRow extends MetadataRow {
  id: EntityId;
  name: string;
  token_prefix: string;
  expires_at: Date | null;
  last_used_at: Date | null;
  created_at: Date;
}

interface UserState extends MetadataRow {
  status: string;
  must_change_password: number;
  password_expires_days: number | null;
  password_updated_at: Date;
}

/** M6 host boundary: mark synchronously, then start cancellation, only after metadata commit. */
export interface PatRevocationHooks {
  markPatRevokedSync(id: EntityId): undefined;
  cancelQueriesByPat(id: EntityId, reason: 'PAT_REVOKED'): void | Promise<void>;
}

export class PatService {
  constructor(
    private readonly pool: MetadataPool,
    private readonly db: MetadataQueryExecutor,
    private readonly pepper: string,
    private readonly revocationHooks?: PatRevocationHooks,
  ) {}

  async list(userId: EntityId): Promise<PatListItemDTO[]> {
    const [rows] = await this.db.query<PatRow[]>(
      `SELECT id, name, token_prefix, expires_at, last_used_at, created_at
       FROM sys_pats WHERE user_id = CAST(? AS UNSIGNED) AND revoked_at IS NULL ORDER BY created_at DESC, id DESC`,
      [userId],
    );
    return rows.map(toPatDTO);
  }

  async create(userId: EntityId, name: string, expiresDays: number): Promise<CreatePatResponseDTO> {
    const rawToken = createPatToken();
    const tokenPrefix = rawToken.slice(0, 16);
    const tokenHash = hashPatToken(rawToken, this.pepper);
    const pat = await withMetadataTransaction(this.pool, async (tx) => {
      await lockActiveUser(tx, userId);
      await tx.query(
        `INSERT INTO sys_pats (user_id, name, token_prefix, token_hash, expires_at)
         VALUES (?, ?, ?, ?, TIMESTAMPADD(DAY, ?, UTC_TIMESTAMP(3)))`,
        [userId, name, tokenPrefix, tokenHash, expiresDays],
      );
      const [[inserted]] = await tx.query<(MetadataRow & { id: EntityId })[]>('SELECT CAST(LAST_INSERT_ID() AS CHAR) AS id');
      if (!inserted) throw new Error('Missing PAT ID');
      const [[row]] = await tx.query<PatRow[]>(
        'SELECT id, name, token_prefix, expires_at, last_used_at, created_at FROM sys_pats WHERE id = CAST(? AS UNSIGNED)',
        [inserted.id],
      );
      if (!row?.expires_at) throw new Error('Missing created PAT expiry');
      const dto = toPatDTO(row);
      await tx.query(
        `INSERT INTO sys_user_approvals (user_id, action, operator_id, target_type, target_id, details)
         VALUES (?, 'CONFIG_UPDATE', ?, 'PAT', ?, ?)`,
        [userId, userId, inserted.id, JSON.stringify({ operation: 'PAT_CREATE', name, tokenPrefix, expiresAt: dto.expires_at })],
      );
      return dto;
    });
    return { pat, rawToken };
  }

  async revoke(userId: EntityId, id: EntityId): Promise<void> {
    await withMetadataTransaction(this.pool, async (tx) => {
      // User first, then PAT, as in password change. This also serializes with role updates for the operator.
      await lockActiveUser(tx, userId);
      const [[pat]] = await tx.query<(MetadataRow & { user_id: EntityId; revoked_at: Date | null })[]>(
        'SELECT user_id, revoked_at FROM sys_pats WHERE id = CAST(? AS UNSIGNED) FOR UPDATE', [id],
      );
      if (!pat || pat.revoked_at !== null) throw new ApiError(404, 'ERR_NOT_FOUND');
      if (pat.user_id !== userId) {
        const [[role]] = await tx.query<MetadataRow[]>(
          `SELECT 1 FROM sys_user_roles ur JOIN sys_roles r ON r.id = ur.role_id
           WHERE ur.user_id = CAST(? AS UNSIGNED) AND r.role_name = 'SUPER_ADMIN'`, [userId],
        );
        if (!role) throw new ApiError(403, 'ERR_RBAC_FORBIDDEN');
      }
      const [updated] = await tx.query<MetadataWriteResult>(
        'UPDATE sys_pats SET revoked_at = UTC_TIMESTAMP(3) WHERE id = CAST(? AS UNSIGNED) AND revoked_at IS NULL', [id],
      );
      if (updated.affectedRows !== 1) throw new ApiError(404, 'ERR_NOT_FOUND');
      await tx.query(
        `INSERT INTO sys_user_approvals (user_id, action, operator_id, target_type, target_id, details)
         VALUES (?, 'PAT_REVOKE', ?, 'PAT', ?, ?)`,
        [userId, userId, id, JSON.stringify({ operation: 'PAT_REVOKE' })],
      );
    });
    if (this.revocationHooks) {
      this.revocationHooks.markPatRevokedSync(id);
      await this.revocationHooks.cancelQueriesByPat(id, 'PAT_REVOKED');
    }
  }

  async myOptions(userId: EntityId): Promise<ProfileOptionDTO[]> {
    const [rows] = await this.db.query<(MetadataRow & ProfileOptionDTO)[]>(
      `SELECT p.id, p.name, p.display_name AS displayName FROM sys_profiles p WHERE p.status = 'ACTIVE'
       AND EXISTS (SELECT 1 FROM sys_role_profiles rp JOIN sys_user_roles ur ON ur.role_id = rp.role_id
                   WHERE rp.profile_id = p.id AND ur.user_id = CAST(? AS UNSIGNED)) ORDER BY p.name, p.id`,
      [userId],
    );
    return rows.map(({ id, name, displayName }) => ({ id, name, displayName }));
  }
}

async function lockActiveUser(tx: MetadataQueryExecutor, userId: EntityId): Promise<void> {
  const [[state]] = await tx.query<UserState[]>(
    `SELECT status, must_change_password, password_expires_days, password_updated_at
     FROM sys_users WHERE id = CAST(? AS UNSIGNED) FOR UPDATE`, [userId],
  );
  if (!state || state.status !== 'ACTIVE') throw new ApiError(403, 'ERR_AUTH_ACCOUNT_DISABLED');
  const expiry = passwordExpiry(state.password_updated_at, state.password_expires_days);
  if (state.must_change_password === 1 || (expiry !== null && Date.now() > expiry.getTime())) {
    throw new ApiError(403, 'ERR_MUST_CHANGE_PASSWORD');
  }
}

function toPatDTO(row: PatRow): PatListItemDTO {
  return {
    id: row.id, name: row.name, token_prefix: row.token_prefix, expires_at: row.expires_at?.toISOString() ?? null,
    last_used_at: row.last_used_at?.toISOString() ?? null, created_at: row.created_at.toISOString(),
  };
}
