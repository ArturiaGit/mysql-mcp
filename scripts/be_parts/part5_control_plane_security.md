## 第五章：管控面安全架构：认证、Session、CSRF 与四级守卫状态机

### 5.1 初始超管安全自举 (`BootstrapService`)：持久标记与人工恢复

空库 DDL 只植入内部 `bootstrap_state=PENDING` 标记，不含账号/密码。应用不得在标记缺失时自行补建它。
标记为 PENDING 且除标记外14表全部为空才允许首次自举；同事务写角色、配置、超管、管理审计和 READY。
READY 重启只验证健康，不重设密码、角色、配额或补发超管；缺失/未知标记、PENDING非空、READY无ACTIVE超管均告警并拒绝ready，进入人工恢复。
已有库升级须DBA核验后审计登记READY，不能按“没有admin用户名/没有ACTIVE超管”推断新库。
基础配置可在受控维护中按键补缺，但普通启动缺失配置必须拒绝ready，不能把补配置与补超管身份混为一谈。

```typescript
// apps/admin-api/src/services/bootstrap.service.ts
import crypto from 'node:crypto';
import type mysql2 from 'mysql2/promise';
import { hashPassword } from '@mysql-mcp/security';
import { withTransaction } from '../repositories/base.repository';

export class BootstrapService {
  constructor(
    private readonly pool: mysql2.Pool,
    private readonly env: { NODE_ENV: string; INITIAL_ADMIN_PASSWORD?: string },
    private readonly keyring: { encrypt(plaintext: string): string; decrypt(ciphertext: string): string },
    // 由部署层接入受控一次性交付通道，禁止写入普通日志/审计details。
    private readonly deliverInitialPassword: (password: string) => Promise<void>
  ) {}

  public async ensureSystemInitialized(): Promise<void> {
    const generatedPassword = await withTransaction(this.pool, async (conn) => {
      const [markers] = await conn.query<mysql2.RowDataPacket[]>(
        `SELECT setting_value FROM sys_system_settings WHERE setting_key = 'bootstrap_state' FOR UPDATE`
      );
      const state = markers[0]?.setting_value;
      if (state !== 'PENDING' && state !== 'READY') {
        throw new Error('BOOTSTRAP_RECOVERY_REQUIRED: missing/invalid durable marker');
      }
      if (state === 'READY') {
        // 与所有活跃超管集合写入口相同锁序：role → users → bindings。
        const [roles] = await conn.query<mysql2.RowDataPacket[]>(
          `SELECT id FROM sys_roles WHERE role_name = 'SUPER_ADMIN' FOR UPDATE`
        );
        if (roles.length !== 1) throw new Error('BOOTSTRAP_RECOVERY_REQUIRED: role missing');
        const [users] = await conn.query<mysql2.RowDataPacket[]>(
          `SELECT id, status FROM sys_users ORDER BY id FOR UPDATE`
        );
        const [bindings] = await conn.query<mysql2.RowDataPacket[]>(
          `SELECT user_id FROM sys_user_roles WHERE role_id = ? ORDER BY user_id FOR UPDATE`, [roles[0].id]
        );
        const ids = new Set(bindings.map(r => String(r.user_id)));
        if (!users.some(u => u.status === 'ACTIVE' && ids.has(String(u.id)))) {
          throw new Error('BOOTSTRAP_RECOVERY_REQUIRED: no active super-admin');
        }
        const [globalRows] = await conn.query<mysql2.RowDataPacket[]>(
          `SELECT id FROM sys_rate_limits WHERE scope_type = 'GLOBAL' AND scope_id = 0`
        );
        const [settings] = await conn.query<mysql2.RowDataPacket[]>(
          `SELECT setting_value, is_encrypted FROM sys_system_settings WHERE setting_key = 'notification_channels'`
        );
        if (globalRows.length !== 1 || settings.length !== 1 || settings[0].is_encrypted !== 1) {
          throw new Error('BOOTSTRAP_RECOVERY_REQUIRED: required configuration missing');
        }
        JSON.parse(this.keyring.decrypt(settings[0].setting_value)); // 解密失败不得ready
        return undefined;
      }

      // PENDING只能来自成功执行的空库DDL；禁止在已接流量的数据库启动初始化。
      const tables = ['sys_users', 'sys_roles', 'sys_user_roles', 'sys_user_approvals', 'sys_pats', 'sys_profiles', 'sys_role_profiles', 'sys_role_database_acls', 'sys_role_table_acls', 'sys_rate_limits', 'sys_audit_logs', 'sys_anonymous_security_logs', 'sys_system_settings', 'sys_rate_limit_revisions'];
      for (const table of tables) {
        const [rows] = await conn.query<mysql2.RowDataPacket[]>(
          table === 'sys_system_settings'
            ? `SELECT 1 FROM ?? WHERE setting_key <> 'bootstrap_state' LIMIT 1`
            : `SELECT 1 FROM ?? LIMIT 1`, [table]
        );
        if (rows.length) throw new Error('BOOTSTRAP_RECOVERY_REQUIRED: PENDING database is not empty');
      }
      await conn.query(`
        INSERT INTO sys_roles
          (role_name, display_name, description, default_limit, max_limit, max_timeout_ms, user_qpm_limit, max_inflight_concurrency, is_builtin, version)
        VALUES
          ('SUPER_ADMIN', '超级管理员', '系统最高权限管理者', 100, 1000, 30000, -1, 10, 1, 1),
          ('SECURITY_ADMIN', '安全管理员', '负责审批、RBAC策略、限流与全量审计监控', 100, 1000, 20000, 120, 5, 1, 1),
          ('DBA', '数据库管理员', '负责MySQL数据源与SSH堡垒机配置管理', 100, 1000, 30000, 120, 8, 1, 1),
          ('ANALYST', '数据分析师', '只读查询业务报表数据', 50, 500, 15000, 60, 5, 1, 1),
          ('DEVELOPER', '业务研发人员', '日常研发辅助查询与Schema探索', 50, 500, 15000, 60, 5, 1, 1)
      `);
      const [roleRows] = await conn.query<mysql2.RowDataPacket[]>(
        `SELECT id FROM sys_roles WHERE role_name = 'SUPER_ADMIN' FOR UPDATE`
      );
      await conn.query(`
        INSERT INTO sys_rate_limits
          (scope_type, scope_id, qpm_limit, burst_capacity, loop_breaker_threshold, loop_breaker_window_sec, revision, version)
        VALUES ('GLOBAL', 0, 60, 10, 3, 30, 0, 1)
      `);
      const channels = ['FEISHU', 'DINGTALK', 'WECHAT'].map(channelType => ({
        channelType, enabled: false, webhookUrl: '', secret: null, alertEvents: []
      }));
      await conn.query(
        `INSERT INTO sys_system_settings (setting_key, setting_value, is_encrypted, version)
         VALUES ('notification_channels', ?, 1, 1)`,
        [this.keyring.encrypt(JSON.stringify({ schemaVersion: 1, channels }))]
      );
      const suppliedPassword = this.env.INITIAL_ADMIN_PASSWORD;
      const rawPassword = suppliedPassword || ('Aa1!' + crypto.randomBytes(18).toString('base64url'));
      const pwdHash = await hashPassword(rawPassword);
      await conn.query(
        `INSERT INTO sys_users (username, password_hash, status, must_change_password, auth_version)
         VALUES ('admin', ?, 'ACTIVE', 1, 1)`, [pwdHash]
      );
      // 不经JS Number读取insertId，避免BIGINT精度损失；同连接读取十进制字符串。
      const [idRows] = await conn.query<mysql2.RowDataPacket[]>(`SELECT CAST(LAST_INSERT_ID() AS CHAR) AS id`);
      const userId = idRows[0].id;
      await conn.query(`INSERT INTO sys_user_roles (user_id, role_id) VALUES (?, ?)`, [userId, roleRows[0].id]);
      await conn.query(
        `INSERT INTO sys_user_approvals (user_id, action, reason, operator_id, target_type, target_id, decided_at)
         VALUES (?, 'CONFIG_UPDATE', 'System bootstrap initial super-admin', 0, 'USER', ?, UTC_TIMESTAMP(3))`,
        [userId, userId]
      );
      await conn.query(
        `UPDATE sys_system_settings SET setting_value = 'READY', version = version + 1
         WHERE setting_key = 'bootstrap_state' AND setting_value = 'PENDING'`
      );
      return suppliedPassword ? undefined : rawPassword;
    });
    // 仅提交成功后交付随机密码；交付失败进入人工恢复，绝不清除READY重新自举。
    if (generatedPassword) await this.deliverInitialPassword(generatedPassword);
  }
}
```

以上是自举事务参考实现，不替代启动总入口的 RegistryHub/密钥环/配置Schema完整验证。
启动失败不得接收业务请求；事务回滚保留PENDING，允许在仍为空库时重试；READY不能自动降回PENDING。
初始化期间禁止其他进程/工具写库；标记行锁串行化并发启动，自举标记不向配置API开放。

---

### 5.2 登录 IP + 账号双维防爆破状态机、Argon2id 并发信号量与匿名安全审计（闭环第 四 节 #6）

为防止未认证攻击者利用高频登录请求耗尽 Argon2id 内存/CPU 或刷爆 `sys_anonymous_security_logs`，认证链路建立三道防线：

1. **防线 1：客户端 IP 级滑动窗口限流与锁死（`IpLoginRateLimiter`）**：
   - 仅当请求来自显式配置的 `TRUSTED_PROXY_CIDRS` 时才解析 `X-Forwarded-For`，否则直接使用底层 `req.socket.remoteAddress`；
   - 单个 IP 在 5 分钟内允许最多 **20 次**登录尝试；超过后直接内存拦截 15 分钟（不再进入 Argon2id 计算），且每个被封禁 IP 每分钟最多写 1 条汇聚匿名审计日志，防止匿名审计表被洪水打满。
2. **防线 2：Argon2id 并发信号量（`Argon2Semaphore`）**：
   - 限制全进程同时执行的 Argon2id 哈希/验签协程上限为 **`maxConcurrent = 8`**（内存峰值 `8 * 64MB = 512MB`），等待队列上限 `32`，超出直接返回 `429 ERR_RATE_LIMIT_USER`。
3. **防线 3：账号级 5 次连续失败锁定（`failed_login_count` & `locked_until`）**：
   - 单账号连续错误达 **5 次**锁定 15 分钟，每次错误返回 `remaining_attempts = Math.max(0, 5 - failedCount)`。

```typescript
// packages/security/src/password-hasher.ts
import { hash, verify } from '@node-rs/argon2';
import { AppError } from '@mysql-mcp/core-engine';

class ConcurrencySemaphore {
  private active = 0;
  private readonly waitQueue: Array<() => void> = [];

  constructor(
    private readonly maxConcurrent: number,
    private readonly maxWaitQueue: number
  ) {}

  public async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.maxConcurrent) {
      if (this.waitQueue.length >= this.maxWaitQueue) {
        throw new AppError({
          code: 'ERR_RATE_LIMIT_USER',
          statusCode: 429,
          message: 'Authentication service is busy. Please retry shortly.',
          retryAfterSec: 3,
        });
      }
      await new Promise<void>((resolve) => this.waitQueue.push(resolve));
    }
    this.active += 1;
    try {
      return await fn();
    } finally {
      this.active -= 1;
      const next = this.waitQueue.shift();
      if (next) next();
    }
  }
}

const argon2Semaphore = new ConcurrencySemaphore(8, 32);

const ARGON2_OPTS = {
  memoryCost: 65536, // 64 MB
  timeCost: 3,
  parallelism: 4,
};

export async function hashPassword(plain: string): Promise<string> {
  return argon2Semaphore.runExclusive(() => hash(plain, ARGON2_OPTS));
}

export async function verifyPassword(hashed: string, plain: string): Promise<boolean> {
  return argon2Semaphore.runExclusive(() => verify(hashed, plain));
}
```

---

### 5.3 HttpOnly 会话管理、Session Regeneration 与密码变更撤销语义（闭环第 四 节 #3）

- **Cookie 基线**：`mcp_admin_sid`，`HttpOnly; Secure; SameSite=Strict; Path=/api/v1; Max-Age=28800`。
- **密码变更的完整撤销与在途中断语义（对齐 PRD L139-143）**：
  当用户在 `POST /api/v1/auth/change-password` 修改密码时：
  1. 在同一个元数据库事务内：更新 `password_hash`、置 `must_change_password = 0`、更新 `password_updated_at = UTC_TIMESTAMP(3)`、递增 **`auth_version = auth_version + 1`**、递增 **`version = version + 1`**，并写入 `sys_user_approvals` 审计记录；
  2. 事务提交后：**立即同步调用 `registryHub.markUserInvalidatedSync(userId)` 与 `lifecycleCoordinator.cancelQueriesByUser(userId, 'PASSWORD_CHANGED')`**，强制中断该用户所有正在执行的在途 SQL 查询，并使所有携带旧 `authVersion` 的排队中 `RequestContextSnapshot` 在借出连接二次核验时全部失效；
  3. 销毁该用户除当前会话外的所有其他 Web Session，并为当前会话轮换全新的 `sessionId` 与 `csrfSecret`（Session Regeneration）；
  4. 用户名下未吊销的 PAT 在下一次新建请求时将绑定最新的 `authVersion`，若管理员或用户在改密时勾选 `revokeAllPats: true`（默认推荐），则在同一事务内批量设置 `UPDATE sys_pats SET revoked_at = UTC_TIMESTAMP(3) WHERE user_id = ? AND revoked_at IS NULL`。

---

### 5.4 `preValidation` 无副作用 CSRF 校验器与 `/api/v1/auth/csrf` 公开端点

```typescript
// apps/admin-api/src/middlewares/csrf.prevalidation.ts
import crypto from 'node:crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { AppError } from '@mysql-mcp/core-engine';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function generateCsrfToken(serverPepper: string, seed: string): string {
  return crypto.createHmac('sha256', serverPepper).update(`csrf:${seed}`).digest('hex');
}

export function verifyCsrfTokenConstantTime(
  serverPepper: string,
  seed: string,
  providedToken: string | undefined
): boolean {
  if (!providedToken || typeof providedToken !== 'string') return false;
  const expected = generateCsrfToken(serverPepper, seed);
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(providedToken, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function csrfPreValidationHook(
  req: FastifyRequest,
  _reply: FastifyReply
): Promise<void> {
  if (SAFE_METHODS.has(req.method)) return;

  const seed = req.session?.csrfSecret ?? req.cookies['mcp_csrf_seed'];
  const headerToken = req.headers['x-csrf-token'] as string | undefined;

  if (!seed || !verifyCsrfTokenConstantTime(req.runtimeCtx.config.SERVER_PEPPER, seed, headerToken)) {
    throw new AppError({
      code: 'ERR_CSRF_INVALID',
      statusCode: 403,
      message: 'CSRF Token 校验失败或已过期，请刷新后重试。',
    });
  }
}
```

---

### 5.5 四级分层守卫 (`AuthGuard ➔ StatusGuard ➔ MustChangePwdGuard ➔ RoleGuard`) 实现

```typescript
// apps/admin-api/src/middlewares/guards.ts
import type { FastifyRequest, FastifyReply } from 'fastify';
import { AppError } from '@mysql-mcp/core-engine';

const PUBLIC_PATHS = new Set([
  '/api/v1/auth/csrf',
  '/api/v1/auth/login',
  '/api/v1/auth/register',
]);

const NON_ACTIVE_ALLOWED_PATHS = new Set([
  '/api/v1/auth/me',
  '/api/v1/auth/logout',
  '/api/v1/approvals/resubmit',
]);

const MUST_CHANGE_PWD_ALLOWED_PATHS = new Set([
  '/api/v1/auth/me',
  '/api/v1/auth/logout',
  '/api/v1/auth/change-password',
]);

export async function fourTierSecurityGuard(
  req: FastifyRequest,
  _reply: FastifyReply
): Promise<void> {
  const routePath = req.routeOptions.url ?? req.url.split('?')[0];

  if (PUBLIC_PATHS.has(routePath)) return;

  const currentUser = req.currentUser;
  if (!currentUser) {
    throw new AppError({
      code: 'ERR_AUTH_UNAUTHORIZED',
      statusCode: 401,
      message: '会话未登录或已超时，请重新登录。',
    });
  }

  // L2: StatusGuard 严格优先于 MustChangePwdGuard，防止 PENDING 用户陷入改密死循环
  if (currentUser.status !== 'ACTIVE') {
    if (NON_ACTIVE_ALLOWED_PATHS.has(routePath)) {
      if (routePath === '/api/v1/approvals/resubmit' && currentUser.status !== 'REJECTED') {
        throw new AppError({
          code: 'ERR_VALIDATION_FAILED',
          statusCode: 400,
          message: '仅已驳回 (REJECTED) 状态的账号允许重新提交审批申请。',
        });
      }
      return;
    }

    const statusCodeMap = {
      PENDING: 'ERR_AUTH_ACCOUNT_PENDING',
      REJECTED: 'ERR_AUTH_ACCOUNT_REJECTED',
      DISABLED: 'ERR_AUTH_ACCOUNT_DISABLED',
    } as const;

    throw new AppError({
      code: statusCodeMap[currentUser.status as keyof typeof statusCodeMap] ?? 'ERR_AUTH_ACCOUNT_DISABLED',
      statusCode: 403,
      message: `当前账号状态 (${currentUser.status}) 无权访问业务接口。`,
    });
  }

  // L3: MustChangePwdGuard (仅对 ACTIVE 用户生效，含密码自然过期判定)
  const now = Date.now();
  const is_password_expired = Boolean(
    currentUser.password_expires_days !== null &&
    currentUser.password_updated_at &&
    now > (new Date(currentUser.password_updated_at).getTime() + (currentUser.password_expires_days || 90) * 86400000)
  );

  if (currentUser.must_change_password || is_password_expired) {
    const isExempted = MUST_CHANGE_PWD_ALLOWED_PATHS.has(routePath) ||
      (req.method === 'GET' && routePath === '/api/v1/auth/password-policy');

    if (!isExempted) {
      throw new AppError({
        code: 'ERR_MUST_CHANGE_PASSWORD',
        statusCode: 403,
        message: is_password_expired ? '密码已超过有效期限，请修改密码后继续使用。' : '首次登录或密码已被重置，请修改密码后继续使用。',
        actionGuidance: '密码安全策略拦截中，请在改密对话框中设置符合复杂度要求的新密码。',
      });
    }
    return;
  }

  // L4: RoleGuard
  const requiredRoles = req.routeOptions.config?.requiredRoles as string[] | undefined;
  if (requiredRoles && requiredRoles.length > 0) {
    const hasRole = currentUser.roles.some((r) => requiredRoles.includes(r));
    if (!hasRole) {
      throw new AppError({
        code: 'ERR_RBAC_FORBIDDEN',
        statusCode: 403,
        message: '当前角色无权访问该管理接口。',
      });
    }
  }
}
```