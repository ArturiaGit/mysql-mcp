import re

# 1. Update part4_database_and_dal.md
with open('scripts/be_parts/part4_database_and_dal.md', 'r', encoding='utf-8') as f:
    c4 = f.read()

# Replace updateUserStatus
old_status_method = """  public async updateUserStatus(
    rawTargetUserId: EntityId | number,
    newStatus: 'ACTIVE' | 'DISABLED',
    rawOperatorUserId: EntityId | number
  ): Promise<void> {
    const targetUserId = toEntityId(rawTargetUserId);
    const operatorUserId = toEntityId(rawOperatorUserId);

    await withTransaction(this.pool, async (conn) => {
      await this.guardLastSuperAdminInTx(
        conn,
        targetUserId,
        operatorUserId,
        () => newStatus !== 'ACTIVE'
      );

      await conn.query(
        `UPDATE sys_users
         SET status = ?, auth_version = auth_version + 1
         WHERE id = ?`,
        [newStatus, targetUserId]
      );

      // 【闭环 BE-R10】：管理面写操作必须在同一数据库事务内写入强一致安全审计记录；
      // 若此 INSERT 失败，整个事务自动 ROLLBACK，业务变更绝不单独生效！
      await conn.query(
        `INSERT INTO sys_user_approvals (user_id, action, reason, operator_id)
         VALUES (?, 'STATUS_CHANGE', ?, ?)`,
        [targetUserId, `Changed user status to ${newStatus}`, operatorUserId]
      );
    });"""

new_status_method = """  public async updateUserStatus(
    rawTargetUserId: EntityId | number,
    newStatus: 'ACTIVE' | 'DISABLED',
    expectedVersion: number,
    rawOperatorUserId: EntityId | number
  ): Promise<void> {
    const targetUserId = toEntityId(rawTargetUserId);
    const operatorUserId = toEntityId(rawOperatorUserId);

    await withTransaction(this.pool, async (conn) => {
      await this.guardLastSuperAdminInTx(
        conn,
        targetUserId,
        operatorUserId,
        () => newStatus !== 'ACTIVE'
      );

      const [res] = await conn.query<mysql2.ResultSetHeader>(
        `UPDATE sys_users
         SET status = ?, auth_version = auth_version + 1, version = version + 1
         WHERE id = ? AND version = ?`,
        [newStatus, targetUserId, expectedVersion]
      );

      if (res.affectedRows === 0) {
        throw new AppError({
          code: 'ERR_CONCURRENCY_CONFLICT',
          statusCode: 409,
          message: '用户状态已被其他管理员更新，请重新加载最新版本。',
        });
      }

      // 【闭环 BE-R10】：管理面写操作必须在同一数据库事务内写入强一致安全审计记录；
      // 若此 INSERT 失败，整个事务自动 ROLLBACK，业务变更绝不单独生效！
      await conn.query(
        `INSERT INTO sys_user_approvals (user_id, action, reason, operator_id)
         VALUES (?, 'STATUS_CHANGE', ?, ?)`,
        [targetUserId, `Changed user status to ${newStatus}`, operatorUserId]
      );
    });"""

c4 = c4.replace(old_status_method, new_status_method)

# Replace updateUserRoles
old_roles_method = """  public async updateUserRoles(
    rawTargetUserId: EntityId | number,
    rawNewRoleIds: Array<EntityId | number>,
    rawOperatorUserId: EntityId | number
  ): Promise<void> {
    const targetUserId = toEntityId(rawTargetUserId);
    const operatorUserId = toEntityId(rawOperatorUserId);
    const newRoleIds = rawNewRoleIds.map(toEntityId);

    await withTransaction(this.pool, async (conn) => {
      const [superRoleRows] = await conn.query<mysql2.RowDataPacket[]>(
        `SELECT id FROM sys_roles WHERE role_name = 'SUPER_ADMIN' LIMIT 1`
      );
      const superRoleId = superRoleRows.length > 0 ? toEntityId(superRoleRows[0].id) : '';
      const keepsSuperAdmin = newRoleIds.includes(superRoleId);

      await this.guardLastSuperAdminInTx(
        conn,
        targetUserId,
        operatorUserId,
        () => !keepsSuperAdmin
      );

      await conn.query(`DELETE FROM sys_user_roles WHERE user_id = ?`, [targetUserId]);
      if (newRoleIds.length > 0) {
        const values = newRoleIds.map((rid) => [targetUserId, rid]);
        await conn.query(`INSERT INTO sys_user_roles (user_id, role_id) VALUES ?`, [values]);
      }

      await conn.query(
        `UPDATE sys_users SET auth_version = auth_version + 1 WHERE id = ?`,
        [targetUserId]
      );

      // 【闭环 BE-R10】：同一事务内写入强一致管理审计记录
      await conn.query(
        `INSERT INTO sys_user_approvals (user_id, action, reason, operator_id)
         VALUES (?, 'ROLE_CHANGE', ?, ?)`,
        [targetUserId, `Updated roles to [${newRoleIds.join(',')}]`, operatorUserId]
      );
    });"""

new_roles_method = """  public async updateUserRoles(
    rawTargetUserId: EntityId | number,
    rawNewRoleIds: Array<EntityId | number>,
    expectedVersion: number,
    rawOperatorUserId: EntityId | number
  ): Promise<void> {
    const targetUserId = toEntityId(rawTargetUserId);
    const operatorUserId = toEntityId(rawOperatorUserId);
    const newRoleIds = rawNewRoleIds.map(toEntityId);

    await withTransaction(this.pool, async (conn) => {
      const [superRoleRows] = await conn.query<mysql2.RowDataPacket[]>(
        `SELECT id FROM sys_roles WHERE role_name = 'SUPER_ADMIN' LIMIT 1`
      );
      const superRoleId = superRoleRows.length > 0 ? toEntityId(superRoleRows[0].id) : '';
      const keepsSuperAdmin = newRoleIds.includes(superRoleId);

      await this.guardLastSuperAdminInTx(
        conn,
        targetUserId,
        operatorUserId,
        () => !keepsSuperAdmin
      );

      await conn.query(`DELETE FROM sys_user_roles WHERE user_id = ?`, [targetUserId]);
      if (newRoleIds.length > 0) {
        const values = newRoleIds.map((rid) => [targetUserId, rid]);
        await conn.query(`INSERT INTO sys_user_roles (user_id, role_id) VALUES ?`, [values]);
      }

      const [res] = await conn.query<mysql2.ResultSetHeader>(
        `UPDATE sys_users 
         SET auth_version = auth_version + 1, version = version + 1 
         WHERE id = ? AND version = ?`,
        [targetUserId, expectedVersion]
      );

      if (res.affectedRows === 0) {
        throw new AppError({
          code: 'ERR_CONCURRENCY_CONFLICT',
          statusCode: 409,
          message: '用户角色已被其他管理员更新，请重新加载最新版本。',
        });
      }

      // 【闭环 BE-R10】：同一事务内写入强一致管理审计记录
      await conn.query(
        `INSERT INTO sys_user_approvals (user_id, action, reason, operator_id)
         VALUES (?, 'ROLE_CHANGE', ?, ?)`,
        [targetUserId, `Updated roles to [${newRoleIds.join(',')}]`, operatorUserId]
      );
    });"""

c4 = c4.replace(old_roles_method, new_roles_method)

with open('scripts/be_parts/part4_database_and_dal.md', 'w', encoding='utf-8') as f:
    f.write(c4)

# 2. Update part5_control_plane_security.md
with open('scripts/be_parts/part5_control_plane_security.md', 'r', encoding='utf-8') as f:
    c5 = f.read()

# Fix 5.3 password change step
old_step = "  1. 在同一个元数据库事务内：更新 `password_hash`、置 `must_change_password = 0`、递增 **`auth_version = auth_version + 1`**，并写入 `sys_user_approvals` 审计记录；"
new_step = "  1. 在同一个元数据库事务内：更新 `password_hash`、置 `must_change_password = 0`、更新 `password_updated_at = NOW()`、递增 **`auth_version = auth_version + 1`**、递增 **`version = version + 1`**，并写入 `sys_user_approvals` 审计记录；"
c5 = c5.replace(old_step, new_step)

# Fix PUBLIC_PATHS: remove password-policy
old_public = """const PUBLIC_PATHS = new Set([
  '/api/v1/auth/csrf',
  '/api/v1/auth/password-policy',
  '/api/v1/auth/login',
  '/api/v1/auth/register',
]);"""

new_public = """const PUBLIC_PATHS = new Set([
  '/api/v1/auth/csrf',
  '/api/v1/auth/login',
  '/api/v1/auth/register',
]);"""
c5 = c5.replace(old_public, new_public)

# Fix MUST_CHANGE_PWD_ALLOWED_PATHS: ensure password-policy is NOT in it (it's checked via method === 'GET')
if "'/api/v1/auth/password-policy'," in c5[:c5.find('fourTierSecurityGuard')]:
    c5 = c5.replace("  '/api/v1/auth/password-policy',\n", "")

with open('scripts/be_parts/part5_control_plane_security.md', 'w', encoding='utf-8') as f:
    f.write(c5)

print("Updated be_parts 4 and 5 cleanly")
