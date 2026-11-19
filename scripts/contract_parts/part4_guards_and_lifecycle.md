## 第四章：认证架构、四级守卫管道与账号生命周期

### 4.1 四级分层守卫流水线 (L0~L4)

为消除控制台前端在权限校验中因守卫顺序错乱而引发的“死锁环”（如待审用户被错误踢出或未审用户直接陷入重定向），后端网关在 Fastify 中严格确立并物理固化了 **五层自顶向下的守卫拦截流水线 (Guards Pipeline)**：

```
                    ┌────────────────────────┐
                    │   HTTP Request Inbound │
                    └───────────┬────────────┘
                                │
                                ▼
         [L0 Public] 是否属于公开端点放行白名单？
         ( /auth/csrf, /auth/register, /auth/login )
                                │
                      否 ───────┴─────── 是 ───────▶ 放行至 Controller
                                │
                                ▼
         [L1 SessionGuard] 会话 Cookie (mcp_admin_sid) 是否有效？
                                │
                      否 ───────┴─────── 是 ───────▶ 注入 req.currentUser
                      │                                 │
                      ▼                                 ▼
             抛 401 UNAUTHORIZED        [L2 StatusGuard] 账号状态是否为 ACTIVE？
                                                        │
                              ┌─────────────────────────┴────────────────────────┐
                              ▼                                                  ▼
                        状态 != ACTIVE                                      状态 == ACTIVE
                              │                                                  │
                 当前路由是否允许受限访问？                                                ▼
         (例如: /auth/me, /auth/logout, /approvals/resubmit)           [L3 MustChangePwdGuard]
                              │                                       must_change_password || is_expired？
                     是 ──────┴────── 否                                         │
                     │                 │                                是 ──────┴────── 否
                     ▼                 ▼                                │                 │
               放行 Controller    抛 403 (分流拦截:                    当前路由是否在改密白名单？    ▼
                                 PENDING/REJECTED/DISABLED)   (/auth/change-password, /auth/me, [L4 RoleGuard]
                                                               /auth/password-policy)     是否具备目标角色？
                                                                        │                       │
                                                               是 ──────┴────── 否        是 ┴ 否
                                                               │                 │        │    │
                                                               ▼                 ▼        ▼    ▼
                                                          放行 Controller  抛 403 锁定   放行  抛 403
```

- **L0 公开端点 (Public Routes)**：
  - 白名单包括：`GET /api/v1/auth/csrf`、`POST /api/v1/auth/register`、`POST /api/v1/auth/login`；
  - 允许匿名访问，不挂载任何 Session 检验；
- **L1 会话有效级 (SessionGuard)**：
  - 校验 `mcp_admin_sid` 会话 Cookie 是否在服务端 Session 注册表中且未超时；
  - 失败直接返回 `401 ERR_AUTH_UNAUTHORIZED`；成功则将当前用户基础模型 `req.currentUser` 挂载到请求上下文；
- **L2 账号状态级 (StatusGuard)**：
  - 检查 `req.currentUser.status`；
  - 若为 `PENDING`，除放行特权名单（`/auth/me`, `/auth/logout`）外，其余接口一律返回 `403 ERR_AUTH_ACCOUNT_PENDING`；
  - 若为 `REJECTED`，除放行特权名单（`/auth/me`, `/auth/logout`, `POST /approvals/resubmit`）外，其余返回 `403 ERR_AUTH_ACCOUNT_REJECTED`；
  - 若为 `DISABLED`，除放行特权名单（`/auth/me`, `/auth/logout`）外，其余返回 `403 ERR_AUTH_ACCOUNT_DISABLED`；
- **L3 密码有效期与改密守卫 (MustChangePwdGuard)**：
  - **前置条件：仅对状态已处于 `ACTIVE` 的用户生效**；
  - **拦截触发条件**：
    1. `currentUser.must_change_password === true`（例如超管手动在后台重置了该账号密码）；
    2. 或当前时间超过了密码过期点（`is_password_expired === true`，即 `password_expires_days !== null && now > password_expires_at`）；
  - **改密放行白名单与方法级精准控制**：命中拦截后，除放行改密与会话必需端点（`POST /api/v1/auth/change-password`、`GET /api/v1/auth/me`、`POST /api/v1/auth/logout`、`GET /api/v1/auth/csrf`）以及**特权只读端点 `GET /api/v1/auth/password-policy`**（仅允许 GET 读取策略，**严禁豁免 `PUT /api/v1/auth/password-policy`**，防止超期用户在改密前关闭或篡改过期策略）外，访问系统内任何其他业务端点均返回 `403 ERR_MUST_CHANGE_PASSWORD`；
- **L4 RBAC 细粒度角色级 (RoleGuard)**：
  - 校验 `req.currentUser.roles` 是否包含目标路由声明的所需角色（如 `SUPER_ADMIN`、`SECURITY_ADMIN`、`DBA` 等）；
  - 校验失败立即返回 `403 ERR_RBAC_FORBIDDEN`。

### 4.2 账号全生命周期状态机与路由分流

系统严格管理账号自注册至停用的完整闭环状态机。**用户自主注册时即须填写强密码，审批通过后账号直接激活可用，无需首次登录强制重置**：

```
                    ┌─────────────────────────┐
                    │  自主注册申请 (强密码)   │
                    └────────────┬────────────┘
                                 │
                                 ▼
                     ┌───────────────────────┐
                     │   PENDING (待审批)    │◀──────────────────┐
                     └───────────┬───────────┘                   │
                                 │                               │
                 ┌───────────────┴───────────────┐               │
                 ▼                               ▼               │
      ┌─────────────────────┐        ┌───────────────────────┐   │
      │  ACTIVE (直接激活)  │        │  REJECTED (已驳回)    │   │
      │ (可直接使用原密码)  │        └───────────┬───────────┘   │
      └──────────┬──────────┘                    │               │
                 │                               └────── 重新提交 ┘
        ┌────────┴────────────────────┐
        ▼                             ▼
┌──────────────────────────┐   ┌──────────────┐
│ 超期失效或管理员重置      │   │   DISABLED   │
│ (触发改密弹窗锁定)       │   │   (已停用)   │
└──────────────────────────┘   └──────────────┘
```

#### 前端路由分流与状态映射表
| 用户账号状态 | 密码有效状态 | 前端路由行为 | 允许访问的控制台视图 |
| :--- | :---: | :--- | :--- |
| **未登录** | - | 强制重定向至 `/login` | 登录页 (`/login`)、注册页 (`/register`) |
| **`PENDING`** | 正常 | 全局路由拦截，重定向至审批等待页 | 待审批专属状态页 (`/approvals/wait`) |
| **`REJECTED`** | 正常 | 全局路由拦截，重定向至驳回详情页 | 驳回重提专属页 (`/approvals/rejected`) |
| **`DISABLED`** | - | 全局路由拦截，重定向至停用告示页 | 停用告知专属页 (`/disabled`) |
| **`ACTIVE`** | **已过期或被重置** | 全局弹窗模态锁定，不可关闭 | 强制改密模态对话框 (`/change-password`) |
| **`ACTIVE`** | **正常有效** | 正常加载控制台，进入大盘与功能页 | 根据角色分配进入对应功能模块 (`/dashboard`, `/profiles` 等) |

### 4.3 `/auth/me` 全状态 200 返回与前端会话引导

- **契约定义**：只要调用方携带合法的 `mcp_admin_sid` 会话 Cookie，**无论该用户当前处于 `PENDING`、`ACTIVE`、`REJECTED` 还是 `DISABLED`，`GET /api/v1/auth/me` 一律稳定返回 HTTP 200 OK**；
- **解决的痛点**：杜绝后端在用户待审或停用时直接在 `/auth/me` 抛 403 导致前端 `AuthGuard` 无法获取用户信息从而陷入死循环；
- **返回模型 (`UserProfileDTO`)**：
  ```json
  {
    "id": "1001",
    "username": "zhangsan",
    "email": "zhangsan@example.com",
    "department": "AI平台研发部",
    "status": "ACTIVE",
    "must_change_password": false,
    "password_updated_at": "2026-11-08T06:00:00.000Z",
    "password_expires_days": 90,
    "password_expires_at": "2027-02-06T06:00:00.000Z",
    "is_password_expired": false,
    "version": 1,
    "roles": ["DEVELOPER"],
    "reject_reason": null,
    "created_at": "2026-11-08T06:00:00.000Z"
  }
  ```
  - 当且仅当 `status === 'REJECTED'` 时，下发 `reject_reason` 字段；其余状态下该字段为 `null`；
  - `password_expires_days`：当前密码有效期天数，默认 90 天；若用户或管理员选择关闭定期重置，该字段返回 `null`，`password_expires_at` 同步返回 `null`，`is_password_expired` 恒为 `false`；
  - `version`：当前用户主记录的乐观锁版本号，用于更新角色与状态时的并发冲突校验。

### 4.4 密码生命周期：强密码基线、可配置轮换、安全风险提示与 DDL 迁移

系统确立了“注册即强口令、审批直接激活、可配置周期轮换、关闭强风险提醒”的完整密码治理闭环：

1. **注册强口令基线**：
   - 用户在 `POST /api/v1/auth/register` 提交时即进行强密码语法校验（8~64 位字符，必须混合包含大写字母、小写字母、数字及特殊符号）；
   - 注册成功且通过管理员审批激活后，`must_change_password` 保持为 `false`，**无需首次登录强制修改，用户可直接使用注册密码登录**；
2. **密码有效期与可配置轮换策略 (30~180 天，默认 90 天)**：
   - **默认时限**：系统默认密码有效期为 **90 天**（自注册或最后一次修改密码的时间 `password_updated_at` 起算）；
   - **用户可配置区间**：用户可在个人设置中自行调整密码轮换周期，允许配置的合法阈值区间为 **30 ~ 180 天**；
   - **允许关闭与高风险提示铁律 (Security Risk Warning)**：
     - 允许用户或管理员选择“关闭定期重置”（即永不过期，`passwordExpiresDays: null`）；
     - **前端交互约束**：当用户在界面勾选或选择“关闭定期更换”时，**前端必须弹出醒目的高风险安全确认对话框**：
       > “⚠️ **安全风险警示**：关闭密码定期轮换将使得账号密码永不过期，可能显著增加凭据被泄露、撞库或长期未察觉被盗用的安全风险。建议保持 90 天定期更换周期。确认要关闭定期轮换吗？”
     - 仅当用户主动勾选“我已知晓安全风险”并点击确认后，前端才允许发起提交；
     - **后端审计追踪**：服务端将“关闭密码定期轮换”标记为高危安全行为，在 `sys_user_approvals` 或管理审计表中记录审计流水；
3. **元数据库 DDL 增量迁移规范 (Database Migration Baseline)**：
   为正式落地上述密码生命周期管理能力，系统对 `sys_users` 表执行如下标准 DDL 升级：
   ```sql
   -- 步骤 1：增加版本列与密码字段 (允许 NULL 以支持存量平滑回填)
   ALTER TABLE `sys_users` 
     ADD COLUMN `version` INT UNSIGNED NOT NULL DEFAULT 1 COMMENT '乐观锁版本号',
     ADD COLUMN `password_updated_at` DATETIME DEFAULT NULL COMMENT '密码最后修改时间',
     ADD COLUMN `password_expires_days` INT DEFAULT 90 COMMENT '密码有效期天数 (30-180，NULL表示永不过期)';

   -- 步骤 2：存量历史数据平滑回填，起算点设定为用户创建时间 created_at
   UPDATE `sys_users` 
   SET `password_updated_at` = `created_at`, `password_expires_days` = 90 
   WHERE `password_updated_at` IS NULL;

   -- 步骤 3：收紧非空约束与自动默认值
   ALTER TABLE `sys_users` 
     MODIFY COLUMN `password_updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '密码最后修改时间';
   ```
4. **过期主动拦截与改密在途销毁联动**：
   - 当密码到期（`now > password_expires_at`），L3 守卫拦截后续业务请求，返回 `403 ERR_MUST_CHANGE_PASSWORD`（附带自愈指引：“密码已超过有效期（90天），请修改密码后继续使用”）；
   - 用户调用 `POST /api/v1/auth/change-password` 成功后：
     - 同事务更新 `password_hash`、置 `must_change_password = 0`、刷新 `password_updated_at = UTC_TIMESTAMP(3)`、递增 **`auth_version = auth_version + 1`**、递增 **`version = version + 1`**；
     - 同步调用 `lifecycleCoordinator.cancelQueriesByUser(userId, 'PASSWORD_CHANGED')` 掐断在途 SQL；
     - 轮换 Session ID，并在下一周期重新开始计算 90 天（或用户自定义天数）倒计时。