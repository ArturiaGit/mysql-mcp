## 第四章：系统元数据库演进 DDL 与数据访问层 (Repository & Transaction) 设计

### 4.1 唯一物理 Schema 与 Repository 映射

**唯一可执行空库 DDL：`docs/sql/001_metadata_schema.sql`**；列字典、约束与迁移原则见 `DATABASE_DESIGN_SPEC.md`。本章不再复制建表 SQL，禁止从历史正文创建数据库。14 表的结构差异检查直接读取该 SQL；现存库升级须先盘点，不得重复执行空库脚本。

| Repository | 必须遵守的物理映射与约束 |
| :--- | :--- |
| RateLimitRepository | `userQuotaQpm` ↔ `qpm_limit`；USER 每次创建/更新同步持久 counter、revision/version；删除保留 counter，见 §4.4.3 |
| ApprovalRepository | 创建工单写不可变 `application_reason` 快照；决定时写 `decided_at`；删除用户取消开放工单；`pending_user_id` 为生成列，禁止写入 |
| AdminAuditRepository | 同事务写 `target_type`、`target_id`、脱敏 `details`；历史不随用户级联删除 |
| UserRoleRepository / PatRepository | 角色 FK 为 RESTRICT；PAT→用户为 CASCADE；删除用户显式清理 USER 限流但保留计数器 |
| AclRepository | 库名、表模式用 as_cs 比较，库级精确名；不能沿用默认 ai_ci |
| ProfileRepository | 写请求 `user` → 物理 `username` → 读响应 `username`；时间 UTC 毫秒；审计快照 `profile_name` 容量128 |
| SettingsRepository | 内部 `bootstrap_state` 不暴露为可写通知设置；仅首次空库脚本置 PENDING，自举成功同事务置 READY |

所有元数据时间均为 UTC `DATETIME(3)`，数据库时间函数使用 `UTC_TIMESTAMP(3)`（或在已确认 UTC session 上的 `CURRENT_TIMESTAMP(3)`）；禁止秒精度 UTC_TIMESTAMP(3) 和按本地时区隐式转换。

---

### 4.2 64 位大整型 (`BIGINT UNSIGNED`) 全链路 `string` 序列化与内存索引契约（闭环 `BE-R12`）

```typescript
// packages/core-engine/src/metadata-pool.ts
import mysql2 from 'mysql2/promise';

export interface MetadataDbConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  connectionLimit?: number;
}

export function createMetadataPool(cfg: MetadataDbConfig): mysql2.Pool {
  return mysql2.createPool({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    connectionLimit: cfg.connectionLimit ?? 20,
    waitForConnections: true,
    queueLimit: 200,
    timezone: 'Z',
    supportBigNumbers: true,
    bigNumberStrings: true, // 驱动层直接输出十进制字符串，禁止转回 Number
    multipleStatements: false,
  });
}

// 所有元数据读写（包括非事务查询）必须经此入口借连接；禁止直接 pool.query/execute。
export async function acquireMetadataConnection(pool: mysql2.Pool): Promise<mysql2.PoolConnection> {
  const conn = await pool.getConnection();
  try {
    // 每次借出都设置：覆盖新建/复用连接，不依赖异步 connection 事件的执行顺序。
    await conn.query("SET SESSION time_zone = '+00:00'");
    return conn;
  } catch (error) {
    conn.destroy(); // 未初始化成功的连接绝不能回池或执行业务 SQL
    throw error;
  }
}


export interface MetadataQueryExecutor {
  query<T extends mysql2.QueryResult = mysql2.RowDataPacket[]>(
    sql: string, values?: unknown[]
  ): Promise<[T, mysql2.FieldPacket[]]>;
}

// 非事务消费者（RegistryHub、AuditEngine）只接收此窄接口，不能旁路UTC初始化。
export function createMetadataQueryExecutor(pool: mysql2.Pool): MetadataQueryExecutor {
  return {
    async query<T extends mysql2.QueryResult = mysql2.RowDataPacket[]>(sql: string, values?: unknown[]) {
      const conn = await acquireMetadataConnection(pool);
      try { return await conn.query<T>(sql, values); }
      finally { conn.release(); }
    }
  };
}

```


元数据入口通过core-engine公共模块导出，管控应用不得用仓库目录内不存在的相对路径引用：

```typescript
// packages/core-engine/src/index.ts（元数据导出片段，保留其他已有导出）
export { createMetadataPool, acquireMetadataConnection, createMetadataQueryExecutor } from './metadata-pool';
export type { MetadataDbConfig, MetadataQueryExecutor } from './metadata-pool';
```

---

### 4.3 事务管理器 (`withTransaction`) 与乐观锁 CAS 更新模板

```typescript
// apps/admin-api/src/repositories/base.repository.ts
import type mysql2 from 'mysql2/promise';
import type { EntityId } from '@mysql-mcp/shared-types';
import { AppError, acquireMetadataConnection } from '@mysql-mcp/core-engine';

export async function withTransaction<T>(
  pool: mysql2.Pool,
  fn: (conn: mysql2.PoolConnection) => Promise<T>
): Promise<T> {
  const conn = await acquireMetadataConnection(pool);
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function assertOptimisticLockUpdated(
  conn: mysql2.PoolConnection,
  affectedRows: number,
  tableName: 'sys_profiles' | 'sys_roles' | 'sys_rate_limits' | 'sys_system_settings',
  idColumn: string,
  idValue: EntityId | number
): Promise<void> {
  if (affectedRows > 0) return;

  const [rows] = await conn.query<mysql2.RowDataPacket[]>(
    `SELECT 1 FROM ?? WHERE ?? = ? LIMIT 1`,
    [tableName, idColumn, String(idValue)]
  );

  if (rows.length === 0) {
    throw new AppError({
      code: 'ERR_VALIDATION_FAILED',
      statusCode: 404,
      message: `Target entity in ${tableName} not found.`,
    });
  }

  throw new AppError({
    code: 'ERR_CONCURRENCY_CONFLICT',
    statusCode: 409,
    message: '该配置已被其他管理员更新，请重新加载最新版本后重试。',
    actionGuidance: 'Reload the latest configuration and re-apply your changes.',
  });
}
```

---

### 4.4 核心高危事务实现（闭环 `BE-R07`、`BE-R10`、`BE-R12`）

#### 4.4.1 最后 1 名活跃超管防自残排他锁 + 同事务强一致审计 + 同步墓碑失效

针对评审报告 **`BE-R07`**（异步重载失败跳过取消且保留旧权限）、**`BE-R10`**（管理写操作必须在同一事务内写审计，失败则整体回滚）与 **`BE-R12`**（全程使用 `EntityId = string`，禁止 `Number(targetUserId)`）：

```typescript
// apps/admin-api/src/services/user.service.ts
import type mysql2 from 'mysql2/promise';
import type { EntityId } from '@mysql-mcp/shared-types';
import { toEntityId } from '@mysql-mcp/core-engine';
import { AppError, RegistryHub, QueryLifecycleCoordinator } from '@mysql-mcp/core-engine';
import { withTransaction } from '../repositories/base.repository';

export class UserService {
  constructor(
    private readonly pool: mysql2.Pool,
    private readonly registryHub: RegistryHub,
    private readonly lifecycle: QueryLifecycleCoordinator
  ) {}

  private async guardLastSuperAdminInTx(
    conn: mysql2.PoolConnection,
    targetUserId: EntityId,
    operatorUserId: EntityId,
    willLoseActiveSuperAdmin: (currentIsActiveSuperAdmin: boolean) => boolean
  ): Promise<void> {
    // 唯一协议：永久角色锁 → 用户主键升序 → 绑定主键升序；全部为当前读。
    const [superRoles] = await conn.query<mysql2.RowDataPacket[]>(
      `SELECT id FROM sys_roles WHERE role_name = 'SUPER_ADMIN' FOR UPDATE`
    );
    if (superRoles.length !== 1) throw new Error('SUPER_ADMIN role missing; manual recovery required');
    // 管控低频写采用保守全用户锁；优化为候选集前必须证明锁序与当前读等价。
    const [users] = await conn.query<mysql2.RowDataPacket[]>(
      `SELECT id, status FROM sys_users ORDER BY id FOR UPDATE`
    );
    const [bindings] = await conn.query<mysql2.RowDataPacket[]>(
      `SELECT user_id FROM sys_user_roles WHERE role_id = ? ORDER BY user_id FOR UPDATE`,
      [superRoles[0].id]
    );
    const superIds = new Set(bindings.map(r => toEntityId(r.user_id)));
    const activeSuperIds = new Set(users.filter(r => r.status === 'ACTIVE' && superIds.has(toEntityId(r.id)))
      .map(r => toEntityId(r.id)));
    const currentIsActiveSuperAdmin = activeSuperIds.has(targetUserId);

    if (targetUserId === operatorUserId && willLoseActiveSuperAdmin(currentIsActiveSuperAdmin)) {
      throw new AppError({
        code: 'ERR_SELF_ACTION_PROHIBITED',
        statusCode: 400,
        message: '禁止对当前登录账号自身执行冻结、降级或删除操作。',
      });
    }

    if (currentIsActiveSuperAdmin && willLoseActiveSuperAdmin(currentIsActiveSuperAdmin)) {
      if (activeSuperIds.size <= 1) {
        throw new AppError({
          code: 'ERR_LAST_SUPER_ADMIN',
          statusCode: 400,
          message: '系统必须保留至少 1 名活跃超级管理员，禁止禁用、删除或移除最后一名超管权限。',
          actionGuidance: 'Please grant SUPER_ADMIN to another active user before modifying this account.',
        });
      }
    }
  }

  public async updateUserStatus(
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

      // 来源状态校验：仅允许 ACTIVE <-> DISABLED 互相流转，PENDING / REJECTED 必须走审批流
      const [userRows] = await conn.query<mysql2.RowDataPacket[]>(
        `SELECT id, status, version FROM sys_users WHERE id = ? FOR UPDATE`,
        [targetUserId]
      );
      if (userRows.length === 0) {
        throw new AppError({
          code: 'ERR_NOT_FOUND',
          statusCode: 404,
          message: '目标用户不存在。',
        });
      }
      const currentStatus = userRows[0].status;
      if (currentStatus === 'PENDING' || currentStatus === 'REJECTED') {
        throw new AppError({
          code: 'ERR_INVALID_STATUS_TRANSITION',
          statusCode: 400,
          message: `当前用户处于 ${currentStatus} 状态，禁止直接启停，必须通过注册审批流程进行流转。`,
        });
      }
      if (currentStatus === newStatus) {
        throw new AppError({
          code: 'ERR_INVALID_STATUS_TRANSITION',
          statusCode: 400,
          message: `目标用户已处于 ${newStatus} 状态，无需重复流转。`,
        });
      }

      const [res] = await conn.query<mysql2.ResultSetHeader>(
        `UPDATE sys_users
         SET status = ?, auth_version = auth_version + 1, version = version + 1
         WHERE id = ? AND version = ? AND status = ?`,
        [newStatus, targetUserId, expectedVersion, currentStatus]
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
    });

    // 【闭环 BE-R07 第 1 步】：事务提交后同一同步控制段，立即打上内存失效墓碑（零 I/O，不可抛错）
    this.registryHub.markUserInvalidatedSync(targetUserId);

    // 【闭环 BE-R07 第 2 步】：在任何异步 DB 重载之前，立即同步触发在途查询取消！
    if (newStatus === 'DISABLED') {
      this.lifecycle.cancelQueriesByUser(targetUserId, 'USER_DISABLED');
    }

    // 【闭环 BE-R07 第 3 步】：异步从元数据库重载最新用户权限；若重载失败，墓碑继续保持 Fail-Closed 拒绝状态
    try {
      await this.registryHub.reloadUserAuthFromDb(targetUserId);
    } catch {
      // 保持 markUserInvalidatedSync 墓碑不清除，拒绝任何旧快照放行
    }
  }

  public async updateUserRoles(
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
        currentIsActiveSuperAdmin => currentIsActiveSuperAdmin && !keepsSuperAdmin
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
    });

    // 【闭环 BE-R07】：同步置位失效墓碑并取消该用户旧权限下的在途查询，随后异步重载
    this.registryHub.markUserInvalidatedSync(targetUserId);
    this.lifecycle.cancelQueriesByUser(targetUserId, 'USER_ROLES_CHANGED');
    try {
      await this.registryHub.reloadUserAuthFromDb(targetUserId);
    } catch {
      // 重载失败保持墓碑 Fail-Closed
    }
  }
}
```

#### 4.4.3 USER 限流 Repository 统一事务协议（RD-01）

`putUserOverride` 与 `deleteUserOverride` 严格实现数据库 §7.5 和接口 §6.7.4/5：
用户行 FOR UPDATE → 计数器 FOR UPDATE → 业务规则 FOR UPDATE → 校验预期 revision → 分配/保存新版本 → 同事务 CONFIG_UPDATE 审计。
创建与更新共用一次分配步骤，不能仅对创建递增计数器；写入列是 `qpm_limit`，不是 `user_quota_qpm`。
`revision=version=last_revision`；每次成功创建/更新加1，删除保留 counter。溢出、旧版本、缺失用户、审计失败均整体回滚。
仅创建接受0；更新/删除要求正修订号；兼容 version 与 revision 同传时必须相等。
成功提交后同步失效 RegistryHub 并重载 QPM 与 burst，失效失败保持 Fail-Closed，不回退旧快照。

#### 4.4.4 所有超管集合变更入口共享锁序（RD-07）

§4.4.1 的角色→用户→绑定锁协议同时适用于启用/禁用、授予/撤销 SUPER_ADMIN、用户删除、审批授予角色及首次自举。
必须在任何用户/绑定锁之前获取永久 SUPER_ADMIN 行锁；内置角色不可删除或重命名。
本人保护只拒绝本人禁用/删除/移除 SUPER_ADMIN，不误拦无关角色修改；剩余人数检查只在减少活跃集合时执行。
审批、限流等其他用户写事务遵循数据库 §7.1：涉及超管集合时先角色锁，再用户锁；禁止持用户锁后倒序申请角色锁。
死锁/锁等待仅允许整体回滚后有限重试（最多3次），每次重新读取状态和CAS；不得重放已提交事务或提前发布失效通知。
真实 MySQL 双连接验收：相互降权、并发授予/撤销、删除/启停、审批授予与禁用、死锁耗尽；单元顺序模型不是并发证明。
