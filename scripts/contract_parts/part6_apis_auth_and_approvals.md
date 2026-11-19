## 第六章：管控面 RESTful API 全量接口契约详述

### 6.1 认证模块接口契约 (`/api/v1/auth/*`)

#### 6.1.1 获取 CSRF 安全令牌
- **接口路径**：`GET /api/v1/auth/csrf`
- **守卫级别**：`L0 公开端点`
- **功能说明**：公开无门槛获取当前会话的 CSRF 安全令牌。若当前客户端未分配种子，服务端在响应头中同时下发 `mcp_csrf_seed` Cookie。前端在单飞刷新时统一调用此接口。
- **请求头**：无特殊要求（可携带已有 Cookie）。
- **请求入参**：*(无入参)*
- **成功响应**：`200 OK`
  ```json
  {
    "csrfToken": "a8f3c7b2e1d045899c34f0e7d6a5b1c8e9f2a4b6c8d0e2f4a6b8c0d2e4f6a8b0"
  }
  ```

---

#### 6.1.2 用户自主申请注册 (强密码录入)
- **接口路径**：`POST /api/v1/auth/register`
- **守卫级别**：`L0 公开端点` (挂载 IP 级频控与 Argon2 并发信号量)
- **功能说明**：外部研发人员自助提交账号注册申请。**用户提交时即须设置高强度正式密码**。初始账号状态设为 `PENDING`，`must_change_password=0`，密码默认有效期设为 90 天，记录至审批表等待管理员审批。管理员审核通过激活后，**用户可直接使用此密码登录，无需首次强制改密**。
- **请求头**：`x-csrf-token: <string>`
- **请求体 JSON Schema**：
  | 字段名 | 类型 | 必填 | 约束限制 | 描述 |
  | :--- | :---: | :---: | :--- | :--- |
  | `username` | `string` | 是 | 长度 3~64 字符，仅限 `^[a-zA-Z0-9_-]+$` | 注册登录账号名 (全局唯一) |
  | `password` | `string` | 是 | 长度 8~64 字符，须混合大小写字母、数字及特殊符号 | 用户设置的正式强密码 (HTTPS加密传输，后端Argon2id加盐存储) |
  | `email` | `string` | 否 | 合法 Email 格式，最大 128 字符 | 用户工作邮箱 |
  | `department` | `string` | 否 | 最大 128 字符 | 所属部门或业务线 |
  | `reason` | `string` | 否 | 最大 512 字符 | 申请账号的使用背景与理由 |
- **请求示例**：
  ```json
  {
    "username": "zhangsan",
    "password": "Password123#",
    "email": "zhangsan@example.com",
    "department": "AI平台研发部",
    "reason": "用于接入智能客服数据分析 Agent，需访问生产从库订单表。"
  }
  ```
- **成功响应**：`200 OK`
  ```json
  {
    "success": true,
    "message": "注册申请已成功提交，请等待系统管理员审批。"
  }
  ```
- **错误分支**：
  - `400 ERR_PASSWORD_POLICY_VIOLATED`：密码不满足复杂度要求（须含大小写字母、数字及特殊字符）；
  - `400 ERR_VALIDATION_FAILED`：参数格式校验不通过；
  - `409 ERR_AUTH_USERNAME_EXISTS`：用户名已被占用；
  - `429 ERR_RATE_LIMIT_USER`：注册 IP 触发防刷频控保护。

---

#### 6.1.3 账号密码登录
- **接口路径**：`POST /api/v1/auth/login`
- **守卫级别**：`L0 公开端点` (挂载 IP+账号双维防爆破与 Argon2 信号量)
- **功能说明**：验证用户名与密码。登录成功后轮换会话并下发 `mcp_admin_sid` HttpOnly Cookie。返回用户信息及密码有效期与到期状态。
- **请求头**：`x-csrf-token: <string>`
- **请求体 JSON Schema**：
  | 字段名 | 类型 | 必填 | 描述 |
  | :--- | :---: | :---: | :--- |
  | `username` | `string` | 是 | 登录用户名 |
  | `password` | `string` | 是 | 登录密码 |
- **请求示例**：
  ```json
  {
    "username": "admin",
    "password": "InitialAdminPassword123#"
  }
  ```
- **成功响应**：`200 OK`
  - **响应头**：`Set-Cookie: mcp_admin_sid=sess_9f8a...; Path=/api/v1; HttpOnly; Secure; SameSite=Strict; Max-Age=28800`
  - **响应体**：
    ```json
    {
      "user": {
        "id": "1",
        "username": "admin",
        "email": "admin@example.com",
        "department": "安全运维部",
        "status": "ACTIVE",
        "must_change_password": false,
        "password_updated_at": "2026-11-01T00:00:00.000Z",
        "password_expires_days": 90,
        "password_expires_at": "2027-01-30T00:00:00.000Z",
        "is_password_expired": false,
        "version": 1,
        "roles": ["SUPER_ADMIN"],
        "reject_reason": null,
        "created_at": "2026-11-01T00:00:00.000Z"
      }
    }
    ```
- **错误分支**：
  - `401 ERR_AUTH_FAILED`：账号或密码错误（携带 `remaining_attempts`）；
  - `429 ERR_AUTH_ACCOUNT_LOCKED`：连续 5 次密码错误，账号临时锁定 15 分钟（携带 `retry_after_sec`）；
  - `400 ERR_VALIDATION_FAILED`：入参缺失。

---

#### 6.1.4 账号登出
- **接口路径**：`POST /api/v1/auth/logout`
- **守卫级别**：`L1 会话有效级`
- **功能说明**：注销服务端 Session 记录，清除客户端 `mcp_admin_sid` Cookie。
- **请求头**：`x-csrf-token: <string>`
- **请求入参**：*(无入参)*
- **成功响应**：`200 OK`
  - **响应头**：`Set-Cookie: mcp_admin_sid=; Path=/api/v1; Max-Age=0; HttpOnly; Secure; SameSite=Strict`
  - **响应体**：
    ```json
    {
      "success": true
    }
    ```

---

#### 6.1.5 修改登录密码 (常规改密 / 超期改密 / 重置改密)
- **接口路径**：`POST /api/v1/auth/change-password`
- **守卫级别**：`L2 账号状态级` (允许已登录且密码过期或 `must_change_password=1` 的 ACTIVE 账号访问)
- **功能说明**：更新用户登录密码。成功后重置 `must_change_password=0`，刷新 `password_updated_at = UTC_TIMESTAMP(3)`，自增 `version` 与 `auth_version`，物理中断该用户在途 SQL 查询并轮换会话。
- **防踢出契约**：旧密码输入错误返回 **`400 ERR_OLD_PASSWORD_INVALID`**，禁止返回 401，防止前端拦截器将用户误踢出登录态并清空改密表单。
- **请求头**：`x-csrf-token: <string>`
- **请求体 JSON Schema**：
  | 字段名 | 类型 | 必填 | 默认值 | 描述 |
  | :--- | :---: | :---: | :---: | :--- |
  | `oldPassword` | `string` | 是 | - | 当前旧密码 |
  | `newPassword` | `string` | 是 | - | 符合安全复杂度要求的新密码 (8~64位，含大小写字母、数字及特殊符号) |
  | `revokeAllPats` | `boolean` | 否 | `true` | 是否同时吊销历史签发的所有个人访问令牌 (PAT) |
- **请求示例**：
  ```json
  {
    "oldPassword": "OldPassword123#",
    "newPassword": "NewStrongSecret2026!#",
    "revokeAllPats": true
  }
  ```
- **成功响应**：`200 OK`
  - **响应头**：换发全新 `mcp_admin_sid` 会话 Cookie
  - **响应体**：
    ```json
    {
      "success": true
    }
    ```
- **错误分支**：
  - `400 ERR_OLD_PASSWORD_INVALID`：旧密码验证错误 (400 业务错误，保留会话不跳转)；
  - `400 ERR_PASSWORD_POLICY_VIOLATED`：新密码不符合复杂度策略；
  - `400 ERR_SAME_AS_OLD_PASSWORD`：新密码与当前旧密码相同。

---

#### 6.1.6 获取当前登录人会话信息
- **接口路径**：`GET /api/v1/auth/me`
- **守卫级别**：`L1 会话有效级` (全状态放行契约)
- **功能说明**：返回当前客户端会话对应的用户信息、所属角色、账号状态以及密码过期相关元数据。对于 `PENDING`、`REJECTED`、`DISABLED` 均稳定返回 HTTP 200，由前端分流守卫导流。
- **请求头**：依赖浏览器自动附带的 Cookie `mcp_admin_sid`。
- **请求入参**：*(无入参)*
- **成功响应**：`200 OK`
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
- **错误分支**：
  - `401 ERR_AUTH_UNAUTHORIZED`：Cookie 缺失、伪造或会话已过期。

---

#### 6.1.7 查询个人密码过期策略与剩余有效期
- **接口路径**：`GET /api/v1/auth/password-policy`
- **守卫级别**：`L2 账号状态级` (仅限 ACTIVE 用户，对密码已超期失效者豁免 L3)
- **功能说明**：查询当前登录用户的密码到期策略配置、当前剩余可用天数及系统支持的配置阈值。
- **成功响应**：`200 OK`
  ```json
  {
    "passwordExpiresDays": 90,
    "passwordExpiresAt": "2027-02-06T06:00:00.000Z",
    "isExpirationEnabled": true,
    "daysRemaining": 89,
    "isExpired": false,
    "minDays": 30,
    "maxDays": 180
  }
  ```
  - 当 `isExpirationEnabled === false` 时，`passwordExpiresDays` 与 `passwordExpiresAt` 返回 `null`，`daysRemaining` 返回 `-1`。

---

#### 6.1.8 更新个人密码过期与轮换策略 (带关闭风险提示)
- **接口路径**：`PUT /api/v1/auth/password-policy`
- **守卫级别**：`L4 角色守卫` (全体 `ACTIVE` 用户)
- **功能说明**：用户自定义其账号密码的定期更换周期。支持配置 30~180 天，或传入 `null` 关闭定期重置（永不过期）。
- **前端安全风险提示约束**：
  当用户在前端界面尝试关闭定期更换（即传入 `null`）时，**前端必须弹出醒目的高风险安全确认对话框**：
  > “⚠️ **安全风险警示**：关闭密码定期轮换将使得账号密码永不过期，可能显著增加凭据被泄露、撞库或长期未察觉被盗用的安全风险。建议保持 90 天定期更换周期。确认要关闭定期轮换吗？”
  用户显式确认后方可提交。
- **请求头**：`x-csrf-token: <string>`
- **请求体 JSON Schema**：
  | 字段名 | 类型 | 必填 | 约束限制 | 描述 |
  | :--- | :---: | :---: | :--- | :--- |
  | `passwordExpiresDays` | `number \| null` | 是 | 整数 `30 <= val <= 180`，或 `null` | 密码有效天数。传 `null` 表示关闭定期重置 |
- **请求示例 (调整为 60 天)**：
  ```json
  {
    "passwordExpiresDays": 60
  }
  ```
- **请求示例 (关闭定期重置)**：
  ```json
  {
    "passwordExpiresDays": null
  }
  ```
- **成功响应**：`200 OK`
  ```json
  {
    "success": true,
    "passwordExpiresDays": 60,
    "passwordExpiresAt": "2027-01-07T06:00:00.000Z",
    "isExpirationEnabled": true
  }
  ```
- **错误分支**：
  - `400 ERR_VALIDATION_FAILED`：有效天数不在 30~180 天范围内；
  - `403 ERR_CSRF_INVALID`：CSRF 令牌无效。

---

### 6.2 注册与审批流模块接口契约 (`/api/v1/approvals/*`)

#### 6.2.1 获取待审批工单分页列表
- **接口路径**：`GET /api/v1/approvals/pending`
- **守卫级别**：`L4 角色守卫` (`SUPER_ADMIN` 或 `SECURITY_ADMIN`)
- **功能说明**：分页拉取当前系统中所有处于 `PENDING` 待审状态的用户注册申请工单列表。
- **查询参数 (Query Parameters)**：
  | 参数名 | 类型 | 必填 | 默认值 | 描述 |
  | :--- | :---: | :---: | :---: | :--- |
  | `page` | `number` | 否 | `1` | 页码 (`>= 1`) |
  | `pageSize` | `number` | 否 | `20` | 每页数量 (`1 <= pageSize <= 100`) |
- **成功响应**：`200 OK`
  ```json
  {
    "items": [
      {
        "id": "5001",
        "user_id": "1002",
        "username": "lisi",
        "email": "lisi@example.com",
        "department": "风控数据组",
        "reason": "需要通过 Agent 定期审计数据表结构变动。",
        "created_at": "2026-11-08T07:15:30.000Z"
      }
    ],
    "total": 1,
    "page": 1,
    "pageSize": 20,
    "totalPages": 1
  }
  ```
  - `id`: 工单全局唯一标识 (`approval_id`)，后续通过/驳回接口的路径参数 `:id` 必须严格传入此 ID。

---

#### 6.2.2 审批通过并激活账号
- **接口路径**：`POST /api/v1/approvals/:id/approve`
- **守卫级别**：`L4 角色守卫` (`SUPER_ADMIN` 或 `SECURITY_ADMIN`)
- **路径参数**：`:id` (待审工单 ID，`string`，对应待审列表返回的 `items[].id`)
- **功能说明**：审核通过注册申请，赋予用户指定的初始角色并将用户状态置为 `ACTIVE`。**用户账号被直接激活，`must_change_password` 保持为 0，用户可立即使用其注册时填写的强密码登录进入控制台正常工作，无需首次登录强制重置**。
- **原子条件更新与防并发冲突**：
  服务端在事务内执行排他条件更新：
  ```sql
  UPDATE sys_user_approvals 
  SET action = 'APPROVE', operator_id = ? 
  WHERE id = ? AND action IN ('SUBMIT', 'RESUBMIT');
  ```
  同时原子更新用户状态 `UPDATE sys_users SET status = 'ACTIVE', version = version + 1 WHERE id = targetUserId AND status = 'PENDING';`。
若工单或用户更新的影响行数为 0，说明该工单已被其他管理员审批处理或状态已发生变动，事务立即回滚并返回 `409 ERR_APPROVAL_STATE_CONFLICT`。
- **安全约束**：`SECURITY_ADMIN` 无权授予 `SUPER_ADMIN` 角色（越权检查）。
- **请求头**：`x-csrf-token: <string>`
- **请求体 JSON Schema**：
  | 字段名 | 类型 | 必填 | 描述 |
  | :--- | :---: | :---: | :--- |
  | `roleIds` | `string[]` | 是 | 赋予该用户的初始角色 ID 列表 (至少 1 项) |
- **请求示例**：
  ```json
  {
    "roleIds": ["2", "3"]
  }
  ```
- **成功响应**：`200 OK`
  ```json
  {
    "success": true
  }
  ```
- **错误分支**：
  - `409 ERR_APPROVAL_STATE_CONFLICT`：工单已被其他管理员审批或账号已非待审状态；
  - `400 ERR_VALIDATION_FAILED`：角色 ID 列表为空或包含非法 ID；
  - `403 ERR_RBAC_FORBIDDEN`：当前操作管理员无权授予目标角色；
  - `404 ERR_NOT_FOUND`：目标待审工单不存在。

---

#### 6.2.3 驳回用户注册申请
- **接口路径**：`POST /api/v1/approvals/:id/reject`
- **守卫级别**：`L4 角色守卫` (`SUPER_ADMIN` 或 `SECURITY_ADMIN`)
- **路径参数**：`:id` (待审工单 ID，`string`，对应待审列表返回的 `items[].id`)
- **功能说明**：驳回用户注册申请，将用户状态流转为 `REJECTED`，必填驳回理由，同事务记录至审批流历史表。
- **原子状态检查与条件更新**：
  服务端在事务内原子更新：
  ```sql
  UPDATE sys_user_approvals 
  SET action = 'REJECT', reason = ?, operator_id = ? 
  WHERE id = ? AND action IN ('SUBMIT', 'RESUBMIT');
  ```
  同时原子更新用户状态为 `REJECTED`。若影响行数为 0，说明工单已被抢审，返回 `409 ERR_APPROVAL_STATE_CONFLICT`。
- **请求头**：`x-csrf-token: <string>`
- **请求体 JSON Schema**：
  | 字段名 | 类型 | 必填 | 约束限制 | 描述 |
  | :--- | :---: | :---: | :--- | :--- |
  | `reason` | `string` | 是 | 长度 1~512 字符 | 明确的驳回原因与修改指引 |
- **请求示例**：
  ```json
  {
    "reason": "请补充具体的业务主管审批单号，并明确写明 Agent 需要查询的数据表范围。"
  }
  ```
- **成功响应**：`200 OK`
  ```json
  {
    "success": true
  }
  ```
- **错误分支**：
  - `409 ERR_APPROVAL_STATE_CONFLICT`：工单已被其他管理员处理；
  - `400 ERR_VALIDATION_FAILED`：驳回原因未填写；
  - `404 ERR_NOT_FOUND`：目标工单不存在。

---

#### 6.2.4 被驳回用户补充信息重新提交
- **接口路径**：`POST /api/v1/approvals/resubmit`
- **守卫级别**：`L1 会话有效级` (仅限当前状态处于 `REJECTED` 的用户调用)
- **功能说明**：被驳回用户补充申请理由、邮箱或部门后重新提交。状态原子回迁至 `PENDING`，同事务追加一条 `RESUBMIT` 审批流日志，生成新的审批工单轮次。
- **请求头**：`x-csrf-token: <string>`
- **请求体 JSON Schema**：
  | 字段名 | 类型 | 必填 | 描述 |
  | :--- | :---: | :---: | :--- |
  | `email` | `string` | 否 | 更新后的联系邮箱 |
  | `department` | `string` | 否 | 更新后的部门信息 |
  | `reason` | `string` | 是 | 重新修改补充后的申请说明 (1~512 字符) |
- **请求示例**：
  ```json
  {
    "email": "lisi@example.com",
    "department": "风控数据组",
    "reason": "已补充业务审批单号 OA-20261108-091，仅需查询 order_summary 脱敏视图。"
  }
  ```
- **成功响应**：`200 OK`
  ```json
  {
    "success": true
  }
  ```
- **错误分支**：
  - `403 ERR_AUTH_ACCOUNT_PENDING`：当前账号已处于 PENDING 态，不可重复提交；
  - `400 ERR_VALIDATION_FAILED`：缺少必填的补充理由。