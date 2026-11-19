### 6.3 用户管理模块接口契约 (`/api/v1/users/*`)

#### 6.3.1 分页查询用户全量列表
- **接口路径**：`GET /api/v1/users`
- **守卫级别**：`L4 角色守卫` (`SUPER_ADMIN`)
- **功能说明**：超级管理员检索系统全部用户账号列表，支持按用户名模糊搜索、状态过滤以及角色筛选。
- **查询参数 (Query Parameters)**：
  | 参数名 | 类型 | 必填 | 默认值 | 描述 |
  | :--- | :---: | :---: | :--- | :--- |
  | `page` | `number` | 否 | `1` | 请求页码 (`>= 1`) |
  | `pageSize` | `number` | 否 | `20` | 每页数量 (`1 <= pageSize <= 100`) |
  | `search` | `string` | 否 | - | 用户名或邮箱模糊搜索关键词 |
  | `status` | `string` | 否 | - | 状态过滤: `PENDING`, `ACTIVE`, `REJECTED`, `DISABLED` |
  | `role` | `string` | 否 | - | 角色英文标识过滤 (如 `SUPER_ADMIN`, `DBA`) |
- **成功响应**：`200 OK`
  ```json
  {
    "items": [
      {
        "id": "1",
        "username": "admin",
        "email": "admin@example.com",
        "department": "平台架构部",
        "status": "ACTIVE",
        "must_change_password": false,
        "password_expires_days": 90,
        "is_password_expired": false,
        "version": 1,
        "roles": [
          { "id": "1", "role_name": "SUPER_ADMIN", "display_name": "超级管理员" }
        ],
        "is_last_super_admin": true,
        "created_at": "2026-11-01T00:00:00.000Z",
        "updated_at": "2026-11-07T12:00:00.000Z"
      }
    ],
    "total": 1,
    "page": 1,
    "pageSize": 20,
    "totalPages": 1
  }
  ```
  - `is_last_super_admin`：服务端动态计算布尔值。若为 `true`，前端在操作列禁用针对该用户的【停用】、【删除】与【取消超管角色】按钮，并展示防自残气泡提示；
  - `version`：用户账号主记录的当前乐观锁版本号，供更新角色或启停状态时进行并发冲突校验。

---

#### 6.3.2 变更用户账号状态 (冻结 / 解冻与状态转换矩阵)
- **接口路径**：`PUT /api/v1/users/:id/status`
- **守卫级别**：`L4 角色守卫` (`SUPER_ADMIN`)
- **路径参数**：`:id` (目标用户 ID，`string`)
- **功能说明**：超级管理员启用或停用用户账号。校验 `version` (409 CAS)，同事务加锁校验超管自残，同事务写管理审计，并立即断流。
- **状态流转矩阵约束 (防审批绕过铁律)**：
  本接口仅用于存量正常或停用账号的启停流转，**严禁绕过审批治理流程**：
  | 当前状态 (From) | 允许的目标状态 (To) | 业务行为说明 |
  | :--- | :--- | :--- |
  | `ACTIVE` | `DISABLED` | 允许停用，校验自残保护与最后超管保护 |
  | `DISABLED` | `ACTIVE` | 允许解冻恢复已停用账号 |
  | `PENDING` | `*` (任何目标状态) | **严格禁止**！必须通过工单审批流程 (`POST /approvals/:id/approve` 或 `reject`) 流转。违者抛 `400 ERR_INVALID_STATUS_TRANSITION` |
  | `REJECTED` | `*` (任何目标状态) | **严格禁止**！必须由申请人补充重提并经由管理员审批通过后激活。违者抛 `400 ERR_INVALID_STATUS_TRANSITION` |
- **安全防线联动**：
  - 若将账号置为 `DISABLED`：服务端同步向内存下发 `markUserInvalidatedSync(targetUserId)`，并调用 `cancelQueriesByUser(targetUserId, 'ACCOUNT_DISABLED')` 立即掐断该用户在途所有 SQL 连接；
  - 超管自锁防线：禁止冻结自身；当目标为仅存的最后 1 名活跃超管时抛 `400 ERR_LAST_SUPER_ADMIN`。
- **请求头**：`x-csrf-token: <string>`
- **请求体 JSON Schema**：
  | 字段名 | 类型 | 必填 | 描述 |
  | :--- | :---: | :---: | :--- |
  | `status` | `string` | 是 | 目标流转状态: 仅限 `'ACTIVE'` 或 `'DISABLED'` |
  | `version` | `number` | 是 | 当前读取到的用户记录乐观锁版本号 |
- **请求示例**：
  ```json
  {
    "status": "DISABLED",
    "version": 1
  }
  ```
- **成功响应**：`200 OK`
  ```json
  {
    "success": true,
    "version": 2
  }
  ```
- **错误分支**：
  - `409 ERR_CONCURRENCY_CONFLICT`：用户状态已被其他管理员抢先修改；
  - `400 ERR_SELF_ACTION_PROHIBITED`：超管尝试停用自己的账号；
  - `400 ERR_LAST_SUPER_ADMIN`：尝试停用系统中仅存的最后 1 名活跃超管；
  - `404 ERR_NOT_FOUND`：目标用户不存在。

---

#### 6.3.3 更新用户分配的角色绑定
- **接口路径**：`PUT /api/v1/users/:id/roles`
- **守卫级别**：`L4 角色守卫` (`SUPER_ADMIN`)
- **路径参数**：`:id` (目标用户 ID，`string`)
- **功能说明**：全量覆盖更新指定用户的角色分配关系。校验 `version` (409 CAS) 杜绝并发静默覆盖。同事务写审计，更新 `sys_users.auth_version` 与 `sys_users.version`，使排队中的旧快照失效。
- **安全防线联动**：
  - 超管自残防线：若目标用户拥有 `SUPER_ADMIN`，且传入的 `roleIds` 不包含超管角色，且系统中除该用户外无其他活跃超管，触发 `400 ERR_LAST_SUPER_ADMIN` 阻断降级。
- **请求头**：`x-csrf-token: <string>`
- **请求体 JSON Schema**：
  | 字段名 | 类型 | 必填 | 描述 |
  | :--- | :---: | :---: | :--- |
  | `roleIds` | `string[]` | 是 | 赋予该用户的全量角色 ID 列表 (允许分配多个角色) |
  | `version` | `number` | 是 | 当前读取到的用户主记录乐观锁版本号 |
- **请求示例**：
  ```json
  {
    "roleIds": ["2", "4"],
    "version": 1
  }
  ```
- **成功响应**：`200 OK`
  ```json
  {
    "success": true,
    "version": 2
  }
  ```
- **错误分支**：
  - `409 ERR_CONCURRENCY_CONFLICT`：用户角色配置已被其他管理员抢先修改；
  - `400 ERR_LAST_SUPER_ADMIN`：降级操作会导致系统中无可用超管；
  - `400 ERR_VALIDATION_FAILED`：角色 ID 列表包含不存在的角色；
  - `404 ERR_NOT_FOUND`：目标用户不存在。

---

#### 6.3.4 删除用户账号
- **接口路径**：`DELETE /api/v1/users/:id`
- **守卫级别**：`L4 角色守卫` (`SUPER_ADMIN`)
- **路径参数**：`:id` (目标用户 ID，`string`)
- **功能说明**：物理级联删除用户账号及名下所有 PAT 和角色关联。同事务排他锁自残判定，并立即同步断流。
- **请求头**：`x-csrf-token: <string>`
- **请求入参**：*(无请求体)*
- **成功响应**：`200 OK`
  ```json
  {
    "success": true
  }
  ```
- **错误分支**：
  - `400 ERR_SELF_ACTION_PROHIBITED`：禁止删除当前登录的管理员自身账号；
  - `400 ERR_LAST_SUPER_ADMIN`：目标为最后一名超管，禁止删除；
  - `404 ERR_NOT_FOUND`：目标用户不存在。

---

#### 6.3.5 管理员重置指定用户密码 / 标记强制改密
- **接口路径**：`POST /api/v1/users/:id/reset-password`
- **守卫级别**：`L4 角色守卫` (`SUPER_ADMIN`)
- **路径参数**：`:id` (目标用户 ID，`string`)
- **功能说明**：超级管理员重置指定用户的登录口令，或为用户分配新的临时密码并标记下次登录强制改密。
- **同事务联动与会话清退 (支持选择是否强制改密)**：
  在同一个元数据库事务内执行原子变更：
  ```sql
  UPDATE sys_users 
  SET password_hash = ?, 
      must_change_password = ?, -- 按请求参数动态写入: mustChangePassword === false ? 0 : 1 (默认 1)
      password_updated_at = UTC_TIMESTAMP(3),
      auth_version = auth_version + 1, 
      version = version + 1 
  WHERE id = ? AND version = ?;
  ```
  - 若 `mustChangePassword === true`（默认）：用户下次登录时必须修改密码；
  - 若管理员明确传入 `mustChangePassword === false`：用户下次登录可直接使用该临时密码进入控制台正常工作，无需强制改密；
  - 事务提交后立即下发内存失效墓碑、物理打断在途 SQL、销毁该用户全部在途 Web Session。
- **请求头**：`x-csrf-token: <string>`
- **请求体 JSON Schema**：
  | 字段名 | 类型 | 必填 | 默认值 | 约束限制 | 描述 |
  | :--- | :---: | :---: | :---: | :--- | :--- |
  | `newTemporaryPassword` | `string` | 否 | 由服务端自动生成 | 8~64 字符，须含大小写字母、数字及特殊字符 | 指定临时密码；缺省时服务端生成 16 位强随机凭证 |
  | `mustChangePassword` | `boolean` | 否 | `true` | 布尔值 | 用户首次以此密码登录时是否强制重置密码 |
  | `version` | `number` | 是 | - | 当前读取到的用户主记录版本号 | 乐观锁版本号 |
- **请求示例**：
  ```json
  {
    "mustChangePassword": true,
    "version": 1
  }
  ```
- **成功响应**：`200 OK`
  ```json
  {
    "success": true,
    "temporaryPassword": "TempPassword2026!#",
    "version": 2
  }
  ```
- **错误分支**：
  - `409 ERR_CONCURRENCY_CONFLICT`：用户已被其他管理员修改；
  - `400 ERR_PASSWORD_POLICY_VIOLATED`：手动指定的临时密码不符合强密码复杂度策略；
  - `404 ERR_NOT_FOUND`：目标用户不存在。

---

### 6.4 个人访问令牌模块接口契约 (`/api/v1/pats/*`)

#### 6.4.1 查询当前登录用户名下的 PAT 列表
- **接口路径**：`GET /api/v1/pats`
- **守卫级别**：`L4 角色守卫` (全体 `ACTIVE` 用户)
- **功能说明**：查看当前登录人名下所有未注销与历史有效的个人访问令牌概览。
- **安全说明**：严禁返回原始 Token 明文，仅暴露 `token_prefix`。
- **查询参数**：*(无入参，严格隔离在 `WHERE user_id = currentUser.id` 范围)*
- **成功响应**：`200 OK`
  ```json
  [
    {
      "id": "201",
      "name": "Cursor-Agent-Dev",
      "token_prefix": "mcp_pat_8f3a",
      "expires_at": "2027-02-08T06:00:00.000Z",
      "last_used_at": "2026-11-08T08:12:00.000Z",
      "created_at": "2026-11-08T06:00:00.000Z"
    }
  ]
  ```

---

#### 6.4.2 签发全新个人访问令牌 (单次明文返回)
- **接口路径**：`POST /api/v1/pats`
- **守卫级别**：`L4 角色守卫` (全体 `ACTIVE` 用户；若密码已超期失效由 L3 守卫拦截)
- **功能说明**：由系统生成 256 位安全令牌。此接口**有且仅有本次**在响应体中透出 `rawToken` 明文。
- **请求头**：`x-csrf-token: <string>`
- **请求体 JSON Schema**：
  | 字段名 | 类型 | 必填 | 默认值 | 约束限制 | 描述 |
  | :--- | :---: | :---: | :---: | :--- | :--- |
  | `name` | `string` | 是 | - | 长度 1~64 字符 | 令牌业务用途或环境标识 |
  | `expiresDays` | `number` | 否 | `90` | 整数，`1 <= expiresDays <= 365` | 有效天数 (最长 365 天) |
- **请求示例**：
  ```json
  {
    "name": "Cursor-Agent-Dev",
    "expiresDays": 90
  }
  ```
- **成功响应**：`200 OK`
  ```json
  {
    "pat": {
      "id": "201",
      "name": "Cursor-Agent-Dev",
      "token_prefix": "mcp_pat_8f3a",
      "expires_at": "2027-02-06T06:00:00.000Z",
      "last_used_at": null,
      "created_at": "2026-11-08T06:00:00.000Z"
    },
    "rawToken": "mcp_pat_8f3a9e2d1c4b7a0f6e5d8c3b2a1f0e9d8c7b6a5f4e3d2c1b0a9f8e7d6c5b4a32"
  }
  ```
- **错误分支**：
  - `403 ERR_MUST_CHANGE_PASSWORD`：用户密码已过期或需要重置，禁止签发 PAT；
  - `400 ERR_VALIDATION_FAILED`：参数格式或过期天数超限。

---

#### 6.4.3 吊销指定的个人访问令牌
- **接口路径**：`POST /api/v1/pats/:id/revoke`
- **守卫级别**：`L4 角色守卫` (全体 `ACTIVE` 用户)
- **路径参数**：`:id` (目标 PAT ID，`string`)
- **功能说明**：将指定 PAT 置为已吊销 (`revoked_at = UTC_TIMESTAMP(3)`)。非超管用户只能吊销自身名下的 PAT。
- **安全联动**：服务端立即同步执行 `markPatRevokedSync(patId)`，并向 MySQL 发起 `cancelQueriesByPat(patId, 'PAT_REVOKED')`，立即打断使用该 PAT 正在执行的查询。
- **请求头**：`x-csrf-token: <string>`
- **请求入参**：*(无请求体)*
- **成功响应**：`200 OK`
  ```json
  {
    "success": true
  }
  ```
- **错误分支**：
  - `403 ERR_RBAC_FORBIDDEN`：尝试越权吊销他人名下的 PAT；
  - `404 ERR_NOT_FOUND`：目标 PAT 不存在或已被注销。