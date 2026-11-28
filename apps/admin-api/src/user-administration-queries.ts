import { withMetadataTransaction, type MetadataParameter, type MetadataPool, type MetadataRow } from '@mysql-mcp/core-engine';
import type { EntityId, PaginatedDTO, PendingApprovalDTO, RoleDTO, UserListItemDTO, UserRoleSummaryDTO, UserStatus } from '@mysql-mcp/shared-types';
import { passwordExpiry } from './auth-domain.js';

export interface PageQuery { page: number; pageSize: number; }
export interface UsersQuery extends PageQuery { search?: string | undefined; status?: UserStatus | undefined; role?: string | undefined; }
interface CountRow extends MetadataRow { total: string; }
interface ApprovalRow extends MetadataRow, Omit<PendingApprovalDTO, 'created_at'> { created_at: Date; }
interface ListedUser extends MetadataRow, Omit<UserListItemDTO, 'roles' | 'must_change_password' | 'is_password_expired' | 'created_at' | 'updated_at' | 'is_last_super_admin'> {
  must_change_password: number;
  password_updated_at: Date;
  created_at: Date;
  updated_at: Date;
  is_last_super_admin: number | string;
}
interface UserRoleRow extends MetadataRow, UserRoleSummaryDTO { user_id: EntityId; }
interface RoleRow extends MetadataRow, Omit<RoleDTO, 'profileIds' | 'created_at' | 'updated_at'> {
  created_at: Date;
  updated_at: Date;
}
interface ProfileBinding extends MetadataRow { role_id: EntityId; profile_id: EntityId; }

export class UserAdministrationQueries {
  constructor(private readonly pool: MetadataPool) {}

  async listApprovals(page: PageQuery): Promise<PaginatedDTO<PendingApprovalDTO>> {
    return withMetadataTransaction(this.pool, async (tx) => {
      const pending = `FROM sys_user_approvals a JOIN sys_users u ON u.id = a.user_id
                       WHERE u.status = 'PENDING' AND a.action IN ('SUBMIT', 'RESUBMIT')`;
      const [[count]] = await tx.query<CountRow[]>(`SELECT COUNT(*) AS total ${pending}`);
      const total = countValue(count);
      if (outsidePage(page, total)) return paginate([], page, total);
      const [rows] = await tx.query<ApprovalRow[]>(
        `SELECT a.id, a.user_id, u.username, u.email, u.department,
                COALESCE(a.application_reason, a.reason, u.apply_reason) AS reason, a.created_at
         ${pending} ORDER BY a.created_at DESC, a.id DESC LIMIT ? OFFSET ?`, pageBounds(page),
      );
      return paginate(rows.map((row) => ({ ...row, created_at: row.created_at.toISOString() })), page, total);
    });
  }

  async listUsers(page: UsersQuery): Promise<PaginatedDTO<UserListItemDTO>> {
    const filters: string[] = [];
    const params: MetadataParameter[] = [];
    if (page.search) {
      const pattern = `%${page.search.replace(/[!%_]/g, '!$&')}%`;
      filters.push("(u.username LIKE ? ESCAPE '!' OR u.email LIKE ? ESCAPE '!')");
      params.push(pattern, pattern);
    }
    if (page.status) {
      filters.push('u.status = ?');
      params.push(page.status);
    }
    if (page.role) {
      filters.push(`EXISTS (SELECT 1 FROM sys_user_roles ur JOIN sys_roles r ON r.id = ur.role_id
                            WHERE ur.user_id = u.id AND r.role_name = ?)`);
      params.push(page.role);
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    return withMetadataTransaction(this.pool, async (tx) => {
      const [[count]] = await tx.query<CountRow[]>(`SELECT COUNT(*) AS total FROM sys_users u ${where}`, params);
      const total = countValue(count);
      if (outsidePage(page, total)) return paginate([], page, total);
      const [rows] = await tx.query<ListedUser[]>(
        `WITH active_super_admins AS (
           SELECT ur.user_id FROM sys_roles r JOIN sys_user_roles ur ON ur.role_id = r.id
           JOIN sys_users su ON su.id = ur.user_id WHERE r.role_name = 'SUPER_ADMIN' AND su.status = 'ACTIVE'
         )
         SELECT u.id, u.username, u.email, u.department, u.status, u.must_change_password, u.password_expires_days,
                u.password_updated_at, u.version, u.created_at, u.updated_at,
                ((SELECT COUNT(*) FROM active_super_admins) = 1 AND
                  EXISTS (SELECT 1 FROM active_super_admins s WHERE s.user_id = u.id)) AS is_last_super_admin
         FROM sys_users u ${where} ORDER BY u.created_at DESC, u.id DESC LIMIT ? OFFSET ?`, [...params, ...pageBounds(page)],
      );
      if (!rows.length) return paginate([], page, total);
      const [bindings] = await tx.query<UserRoleRow[]>(
        `SELECT ur.user_id, r.id, r.role_name, r.display_name FROM sys_user_roles ur JOIN sys_roles r ON r.id = ur.role_id
         WHERE ur.user_id IN (${rows.map(() => 'CAST(CAST(? AS CHAR) AS UNSIGNED)').join(', ')}) ORDER BY ur.user_id, r.id`,
        rows.map((row) => row.id),
      );
      const roles = groupBy(bindings, (binding) => binding.user_id);
      const now = Date.now();
      return paginate(rows.map((row) => {
        const expiry = passwordExpiry(row.password_updated_at, row.password_expires_days);
        return {
          id: row.id, username: row.username, email: row.email, department: row.department, status: row.status,
          must_change_password: row.must_change_password === 1, password_expires_days: row.password_expires_days,
          is_password_expired: expiry !== null && now > expiry.getTime(), version: row.version,
          roles: (roles.get(row.id) ?? []).map(({ id, role_name, display_name }) => ({ id, role_name, display_name })),
          is_last_super_admin: row.is_last_super_admin === 1 || row.is_last_super_admin === '1',
          created_at: row.created_at.toISOString(), updated_at: row.updated_at.toISOString(),
        };
      }), page, total);
    });
  }

  async listRoles(): Promise<RoleDTO[]> {
    return withMetadataTransaction(this.pool, async (tx) => {
      const [rows] = await tx.query<RoleRow[]>(
        `SELECT id, role_name, display_name, description, version, default_limit, max_limit, max_timeout_ms,
                user_qpm_limit, max_inflight_concurrency, created_at, updated_at FROM sys_roles ORDER BY id`,
      );
      const [bindings] = await tx.query<ProfileBinding[]>('SELECT role_id, profile_id FROM sys_role_profiles ORDER BY role_id, profile_id');
      const profiles = groupBy(bindings, (binding) => binding.role_id);
      return rows.map((row) => ({
        ...row, profileIds: (profiles.get(row.id) ?? []).map((binding) => binding.profile_id),
        created_at: row.created_at.toISOString(), updated_at: row.updated_at.toISOString(),
      }));
    });
  }
}

function countValue(row: CountRow | undefined): number {
  const total = Number(row?.total);
  if (!Number.isSafeInteger(total) || total < 0) throw new Error('Unsafe metadata count');
  return total;
}

function outsidePage({ page, pageSize }: PageQuery, total: number): boolean {
  return page > Math.ceil(total / pageSize);
}

function pageBounds({ page, pageSize }: PageQuery): [number, number] {
  return [pageSize, (page - 1) * pageSize];
}

function paginate<T>(items: T[], { page, pageSize }: PageQuery, total: number): PaginatedDTO<T> {
  return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
}

function groupBy<T>(rows: readonly T[], key: (row: T) => EntityId): Map<EntityId, T[]> {
  const groups = new Map<EntityId, T[]>();
  for (const row of rows) {
    const id = key(row);
    const group = groups.get(id);
    if (group) group.push(row);
    else groups.set(id, [row]);
  }
  return groups;
}
