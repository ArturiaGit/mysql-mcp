### 6.5 数据源配置模块接口契约 (`/api/v1/profiles/*`)

#### 6.5.1 查询全量数据源列表 (管理视图)
- **接口路径**：`GET /api/v1/profiles`
- **守卫级别**：`L4 角色守卫` (`SUPER_ADMIN` 或 `DBA`)
- **功能说明**：管理员或 DBA 查看全部数据源连接池的运维配置。
- **安全说明**：密码与私钥密文绝对脱敏，`password` 字段固定回显为 `"******"`，响应体包含 `version` 乐观锁版本。
- **成功响应**：`200 OK`
  ```json
  [
    {
      "id": "101",
      "name": "mysql_prod_primary",
      "display_name": "核心业务主库 (只读镜像)",
      "environment": "PROD",
      "host": "10.0.8.21",
      "port": 3306,
      "username": "mcp_readonly_user",
      "database": "trade_order",
      "max_pool_size": 15,
      "queue_timeout_ms": 3000,
      "profile_capacity_qpm": 600,
      "max_inflight_concurrency": 25,
      "use_ssh": true,
      "ssh_host": "10.0.8.5",
      "ssh_port": 22,
      "ssh_user": "bastion_proxy",
      "ssh_host_fingerprint_sha256": "SHA256:abcd1234efgh5678ijkl9012mnop3456qrst7890uvw",
      "tls_config": {
        "enabled": true,
        "ca_cert": null
      },
      "status": "ACTIVE",
      "version": 1,
      "created_at": "2026-11-05T00:00:00.000Z",
      "updated_at": "2026-11-07T08:00:00.000Z"
    }
  ]
  ```

---

#### 6.5.2 查询普通研发人员轻量级数据源选项
- **接口路径**：`GET /api/v1/profiles/my-options`
- **守卫级别**：`L4 角色守卫` (全体 `ACTIVE` 用户，含 `DEVELOPER` 与 `SECURITY_ADMIN`)
- **功能说明**：研发或安全官在客户端配置向导中拉取可选数据源下拉框。**仅返回当前登录人角色被授权访问的数据源，彻底隐藏主机 IP、端口、密码、私钥与连接池大小等敏感运维拓扑**。
- **成功响应**：`200 OK`
  ```json
  [
    {
      "id": "101",
      "name": "mysql_prod_primary",
      "displayName": "核心业务主库 (只读镜像)"
    }
  ]
  ```

---

#### 6.5.3 新增数据源 Profile
- **接口路径**：`POST /api/v1/profiles`
- **守卫级别**：`L4 角色守卫` (`SUPER_ADMIN` 或 `DBA`)
- **功能说明**：纳管新 MySQL 数据源。密码与 SSH 私钥由 AES-256-GCM 密钥环加密存储。初始版本号 `version = 1`。
- **安全校验**：录入的主机执行 SSRF 拦截检查。若启用 SSH 必须提供可信主机指纹。
- **请求头**：`x-csrf-token: <string>`
- **请求体 JSON Schema**：
  | 字段名 | 类型 | 必填 | 默认值 | 约束限制 | 描述 |
  | :--- | :---: | :---: | :---: | :--- | :--- |
  | `name` | `string` | 是 | - | 长度 1~64 字符，仅限 `^[a-zA-Z0-9_-]+$` | 唯一英文标识 (创建后不可变更) |
  | `display_name` | `string` | 是 | - | 长度 1~128 字符 | 中文展示名 |
  | `environment` | `string` | 否 | `"PROD"` | 枚举: `"PROD"`, `"STG"`, `"DEV"` | 部署环境 (创建后不可变更) |
  | `host` | `string` | 是 | - | 最大 255 字符，非空 | 目标 MySQL 主机域名或 IP |
  | `port` | `number` | 是 | `3306` | 整数，`1 <= port <= 65535` | 目标端口 |
  | `user` | `string` | 是 | - | 长度 1~64 字符 | 数据库登录用户 |
  | `password` | `string` | 是 | - | 长度 1~255 字符 | 数据库登录明文密码 |
  | `database` | `string` | 是 | - | 长度 1~64 字符 | 默认连接数据库名 |
  | `max_pool_size` | `number` | 否 | `10` | 整数，`1 <= val <= 50` | 生产连接池最大容量 |
  | `queue_timeout_ms`| `number` | 否 | `3000` | 整数，`500 <= val <= 30000` | 连接池借出排队超时 (ms) |
  | `profile_capacity_qpm` | `number` | 否 | `300` | 整数，`10 <= val <= 10000` | 数据源 QPM 保护上限 |
  | `max_inflight_concurrency` | `number` | 否 | `30` | 整数，`1 <= val <= 50` | 最大在途并发数 |
  | `use_ssh` | `boolean` | 否 | `false` | 布尔值 | 是否经由 SSH 堡垒机隧道转发 |
  | `ssh_host` | `string` | 否 | - | `use_ssh=true` 时必填 | 跳板机 IP 或域名 |
  | `ssh_port` | `number` | 否 | `22` | 整数，`1 <= val <= 65535` | 跳板机端口 |
  | `ssh_user` | `string` | 否 | - | `use_ssh=true` 时必填 | 跳板机用户名 |
  | `ssh_private_key`| `string` | 否 | - | `use_ssh=true` 时必填 | 跳板机 OpenSSH 格式私钥文本 |
  | `ssh_host_fingerprint_sha256` | `string` | 否 | - | `use_ssh=true` 时必填 (如 "SHA256:...") | 预期 SSH 主机密钥指纹 (Fail-Closed) |
  | `tls_config` | `TlsConfig \| null` | 否 | `null` | 结构化对象 | 数据库 TLS 加密连接配置 |
- **请求示例**：
  ```json
  {
    "name": "mysql_crm_read",
    "display_name": "CRM客户管理从库",
    "environment": "PROD",
    "host": "10.0.12.18",
    "port": 3306,
    "user": "mcp_agent_reader",
    "password": "DbSecretPassword123#",
    "database": "crm_db",
    "max_pool_size": 10,
    "queue_timeout_ms": 3000,
    "profile_capacity_qpm": 300,
    "use_ssh": true,
    "ssh_host": "10.0.8.5",
    "ssh_port": 22,
    "ssh_user": "bastion_proxy",
    "ssh_private_key": "-----BEGIN OPENSSH PRIVATE KEY-----\n...",
    "ssh_host_fingerprint_sha256": "SHA256:abcd1234efgh5678ijkl9012mnop3456qrst7890uvw",
    "tls_config": {
      "enabled": true,
      "ca_cert": "-----BEGIN CERTIFICATE-----\n..."
    }
  }
  ```
- **成功响应**：`200 OK`
  ```json
  {
    "id": "102",
    "version": 1
  }
  ```
- **错误分支**：
  - `409 ERR_DUPLICATE_NAME`：数据源英文标识已被占用；
  - `403 ERR_SSRF_PROHIBITED`：数据库主机命中私网拦截规则且未在白名单中；
  - `400 ERR_VALIDATION_FAILED`：入参校验失败（如启用 SSH 但未提供指纹）。

---

#### 6.5.4 更新数据源 Profile 配置
- **接口路径**：`PUT /api/v1/profiles/:id`
- **守卫级别**：`L4 角色守卫` (`SUPER_ADMIN` 或 `DBA`)
- **路径参数**：`:id` (目标 Profile ID，`string`)
- **功能说明**：更新连接池参数。校验 `version` (409 CAS)。更新成功后递增 `generation`，热排空原连接池。
- **连接路径与信任边界变更防外泄铁律 (Trust Boundary Re-entry Iron Law)**：
  - **全链路信任边界受控**：若发生以下任一变动，请求体**必须传入新的 `password` 明文字符串**；若未提供，服务端**立即阻断并抛出 `400 ERR_CREDENTIAL_REENTRY_REQUIRED`**：
    1. 数据库主机、端口或用户变动 (`host`, `port`, `user`)；
    2. 跳板机转发隧道状态切换 (`use_ssh` 启停)，或跳板机端点/指纹变动 (`ssh_host`, `ssh_port`, `ssh_user`, `ssh_host_fingerprint_sha256`)；
    3. TLS 传输安全级别变动 (`tls_config.enabled` 启停，或 `tls_config.ca_cert` 证书变更)；
  - **跳板机私钥同理**：若跳板机端点发生变动，必须传入新的 `ssh_private_key` 与指纹；
  - 只有在数据库端点、SSH 转发隧道、主机指纹与 TLS 信任级别**全链路拓扑完全未变**的前提下，才允许密码留空沿用库内旧密文。
- **不可变字段确定性规则**：`name` 与 `environment` 属于不可变属性。若请求体试图修改其值（即传入值与数据库已存值不一致），服务端**将严格阻断并返回 `400 ERR_PROFILE_IMMUTABLE_FIELD`**；若传入值与数据库已存值完全相同则放行。
- **缺省与增量更新语义规范**：更新采用**白名单字段增量合并更新 (Partial Patch on Allowed Fields)**。请求体中未提供的可选字段（缺省/未传）一律视为保留当前已存原值；传有效非空值表示更新覆盖；传 `null` 表示清空允许为空的字段；未知字段返回 `400 ERR_VALIDATION_FAILED`。
- **请求头**：`x-csrf-token: <string>`
- **请求体全量可写字段清单 (UpdateProfilePayload)**：
  | 字段名 | 类型 | 必填 | 约束限制 | 描述 |
  | :--- | :---: | :---: | :--- | :--- |
  | `display_name` | `string` | 否 | 长度 1~128 字符 | 中文展示名 |
  | `host` | `string` | 否 | 最大 255 字符 (修改时必传password) | 目标 MySQL 主机 |
  | `port` | `number` | 否 | 整数 1~65535 (修改时必传password) | 目标端口 |
  | `user` | `string` | 否 | 长度 1~64 字符 (修改时必传password) | 数据库用户 |
  | `password` | `string` | 否 | 端点变更时必填；未变时留空沿用 | 数据库密码 |
  | `database` | `string` | 否 | 长度 1~64 字符 | 默认数据库名 |
  | `max_pool_size` | `number` | 否 | 整数 1~50 | 连接池容量 |
  | `queue_timeout_ms`| `number` | 否 | 整数 500~30000 | 排队超时 |
  | `profile_capacity_qpm` | `number` | 否 | 整数 10~10000 | QPM 保护上限 |
  | `max_inflight_concurrency` | `number` | 否 | 整数 1~50 | 最大在途并发数 |
  | `use_ssh` | `boolean` | 否 | 布尔值 | 是否启用跳板机 |
  | `ssh_host` | `string` | 否 | 修改时须提供新私钥与指纹 | 跳板机主机 |
  | `ssh_port` | `number` | 否 | 整数 1~65535 | 跳板机端口 |
  | `ssh_user` | `string` | 否 | 修改时须提供新私钥与指纹 | 跳板机用户 |
  | `ssh_private_key`| `string` | 否 | 端点变更时必填；未变时留空沿用 | 跳板机私钥 |
  | `ssh_host_fingerprint_sha256` | `string` | 否 | 预期主机密钥指纹 | SHA256 指纹文本 |
  | `tls_config` | `TlsConfig \| null` | 否 | 结构化对象 | TLS 加密配置 |
  | `version` | `number` | **是** | 必须等于当前读取到的版本号 | 乐观锁版本号 |
- **请求示例**：
  ```json
  {
    "display_name": "核心业务主库 (升级读写隔离)",
    "max_pool_size": 20,
    "profile_capacity_qpm": 800,
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
  - `400 ERR_CREDENTIAL_REENTRY_REQUIRED`：修改了 host/port 等端点但未录入新密码；
  - `400 ERR_PROFILE_IMMUTABLE_FIELD`：试图变更 name 或 environment 不可变字段；
  - `409 ERR_CONCURRENCY_CONFLICT`：提交的版本号已被抢先更新（携带最新版本详情）；
  - `404 ERR_NOT_FOUND`：目标 Profile 不存在。

---

#### 6.5.5 删除数据源 Profile
- **接口路径**：`DELETE /api/v1/profiles/:id`
- **守卫级别**：`L4 角色守卫` (`SUPER_ADMIN` 或 `DBA`)
- **路径参数**：`:id` (目标 Profile ID，`string`)
- **功能说明**：删除数据源并销毁物理连接池。
- **安全检查**：检查 `sys_role_profiles`，若该 Profile 仍被角色策略关联，抛 `400 ERR_PROFILE_IN_USE` 阻断。
- **请求头**：`x-csrf-token: <string>`
- **成功响应**：`200 OK`
  ```json
  {
    "success": true
  }
  ```
- **错误分支**：
  - `400 ERR_PROFILE_IN_USE`：仍有角色绑定该数据源，禁止删除。

---

#### 6.5.6 测试 MySQL 数据库连通性
- **接口路径**：`POST /api/v1/profiles/test-db`
- **守卫级别**：`L4 角色守卫` (`SUPER_ADMIN` 或 `DBA`)
- **功能说明**：以三大模式安全测试 MySQL 连接、握手与认证耗时。全链路加装 SSRF Post-DNS 防御与 IP Pinning。支持草稿模式传入临时 SSH 隧道与 TLS 参数。
- **防外泄铁律**：若修改了 host/port/user、TLS 信任链（开关或 CA 证书）或 SSH 隧道配置，必须提供新密码，否则抛 `400 ERR_CREDENTIAL_REENTRY_REQUIRED`。
- **请求头**：`x-csrf-token: <string>`
- **请求体 JSON Schema**：
  | 字段名 | 类型 | 必填 | 描述 |
  | :--- | :---: | :---: | :--- |
  | `profile_id` | `string` | 否 | 已存 Profile ID (模式 1 或 模式 2 必传) |
  | `host` | `string` | 否 | 目标数据库主机 (模式 3 必传) |
  | `port` | `number` | 否 | 目标端口 (模式 3 必传) |
  | `user` | `string` | 否 | 数据库用户 (模式 3 必传) |
  | `password` | `string` | 否 | 数据库密码 (模式 3 必传；模式 2 修改主机后必传) |
  | `database` | `string` | 否 | 数据库名 |
  | `tls_config` | `TlsConfig \| null` | 否 | 结构化 TLS 配置 (测试端点同步支持) |
  | `use_ssh` | `boolean` | 否 | 是否启用跳板机转发测试 |
  | `ssh_host` | `string` | 否 | 跳板机主机 |
  | `ssh_port` | `number` | 否 | 跳板机端口 |
  | `ssh_user` | `string` | 否 | 跳板机用户名 |
  | `ssh_private_key` | `string` | 否 | 跳板机私钥文本 |
  | `ssh_host_fingerprint_sha256` | `string` | 否 | 预期跳板机指纹 |
- **请求示例 (模式 1：已存配置快速测通)**：
  ```json
  {
    "profile_id": "101"
  }
  ```
- **请求示例 (模式 3：带 TLS 与 SSH 的草稿新建测试)**：
  ```json
  {
    "host": "10.0.12.18",
    "port": 3306,
    "user": "reader",
    "password": "Password123#",
    "database": "crm_db",
    "tls_config": {
      "enabled": true,
      "ca_cert": null
    },
    "use_ssh": true,
    "ssh_host": "10.0.8.5",
    "ssh_port": 22,
    "ssh_user": "bastion_proxy",
    "ssh_private_key": "-----BEGIN OPENSSH PRIVATE KEY-----\n...",
    "ssh_host_fingerprint_sha256": "SHA256:abcd1234efgh5678ijkl9012mnop3456qrst7890uvw"
  }
  ```
- **成功响应**：`200 OK`
  ```json
  {
    "reachable": true,
    "latencyMs": 18
  }
  ```
- **错误分支**：
  - `400 ERR_CREDENTIAL_REENTRY_REQUIRED`：修改了 host/port 但未重输密码；
  - `403 ERR_SSRF_PROHIBITED`：目标主机被 SSRF 出站白名单拦截；
  - `200 OK (业务不可达)`：`{ "reachable": false, "latencyMs": 2000, "error": "Access denied for user 'reader'@'10.0.8.21'" }`。

---

#### 6.5.7 测试 SSH 跳板机连通性
- **接口路径**：`POST /api/v1/profiles/test-ssh`
- **守卫级别**：`L4 角色守卫` (`SUPER_ADMIN` 或 `DBA`)
- **功能说明**：仅测试网关到 SSH 堡垒机本身的连通性、HostKey 指纹比对及私钥认证。**本测试不建立 MySQL 数据库连接，无需也绝不要求输入数据库密码**。
- **SSH 独立防外泄铁律**：若测试已有数据源时修改了 `host` (跳板机)、`port` 或 `username`，必须输入新的 `privateKey` 与 `hostFingerprintSha256`；未输入抛 `400 ERR_CREDENTIAL_REENTRY_REQUIRED`；参数未变时自动复用已解密存量私钥。
- **请求头**：`x-csrf-token: <string>`
- **请求体 JSON Schema**：
  | 字段名 | 类型 | 必填 | 描述 |
  | :--- | :---: | :---: | :--- |
  | `profile_id` | `string` | 否 | 已存 Profile ID |
  | `host` | `string` | 否 | SSH 堡垒机主机 |
  | `port` | `number` | 否 | SSH 端口 (默认 22) |
  | `username` | `string` | 否 | SSH 登录用户 |
  | `privateKey` | `string` | 否 | OpenSSH 私钥文本 |
  | `hostFingerprintSha256` | `string` | 否 | 预期 SHA-256 主机公钥指纹 (防中间人) |
- **成功响应**：`200 OK`
  ```json
  {
    "reachable": true,
    "latencyMs": 35
  }
  ```

---

### 6.6 角色策略与库表 ACL 模块接口契约 (`/api/v1/roles/*`)

#### 6.6.1 查询角色模版与授权配置列表
- **接口路径**：`GET /api/v1/roles`
- **守卫级别**：`L4 角色守卫` (`SUPER_ADMIN` 或 `SECURITY_ADMIN`)
- **功能说明**：获取系统全量角色模版定义，包含其绑定的数据源列表、默认 LIMIT、最大 LIMIT、超时时间、用户 QPM 与乐观锁版本号。
- **成功响应**：`200 OK`
  ```json
  [
    {
      "id": "2",
      "role_name": "DATA_ANALYST",
      "display_name": "数据分析师角色",
      "description": "允许查询只读库订单与报表视图，单次最大限制 200 行",
      "version": 2,
      "default_limit": 50,
      "max_limit": 200,
      "max_timeout_ms": 15000,
      "user_qpm_limit": 60,
      "max_inflight_concurrency": 5,
      "profileIds": ["101", "102"],
      "created_at": "2026-11-05T00:00:00.000Z",
      "updated_at": "2026-11-08T06:00:00.000Z"
    }
  ]
  ```

---

#### 6.6.2 创建自定义角色
- **接口路径**：`POST /api/v1/roles`
- **守卫级别**：`L4 角色守卫` (`SUPER_ADMIN` 或 `SECURITY_ADMIN`)
- **功能说明**：创建新角色策略模版，初始版本 `version = 1`。
- **跨字段校验规则**：必须满足 **`default_limit <= max_limit`**，否则抛出 `400 ERR_VALIDATION_FAILED`。
- **请求头**：`x-csrf-token: <string>`
- **请求体 JSON Schema**：
  | 字段名 | 类型 | 必填 | 默认值 | 约束限制 | 描述 |
  | :--- | :---: | :---: | :---: | :--- | :--- |
  | `role_name` | `string` | 是 | - | 长度 1~32 字符，仅限 `^[A-Z0-9_]+$` | 唯一英文标识 (创建后不可变更) |
  | `display_name` | `string` | 是 | - | 长度 1~64 字符 | 角色中文名 |
  | `description` | `string` | 否 | `null` | 最大 255 字符 | 角色职责与权限说明 |
  | `profileIds` | `string[]` | 是 | - | 至少包含 1 个有效 Profile ID | 允许访问的数据源 ID 列表 |
  | `default_limit` | `number` | 否 | `50` | 整数，`1 <= val <= 500` (须<=max_limit) | 默认注入 LIMIT |
  | `max_limit` | `number` | 否 | `500` | 整数，`1 <= val <= 5000` | 允许执行的最大 LIMIT |
  | `max_timeout_ms`| `number` | 否 | `15000` | 整数，`1000 <= val <= 60000` | 最大执行超时 (ms) |
  | `user_qpm_limit`| `number` | 否 | `60` | 整数，`-1` 或 `1 <= val <= 10000` | 用户基础 QPM (-1 为免限流) |
  | `max_inflight_concurrency`| `number` | 否 | `5` | 整数，`1 <= val <= 50` | 最大在途并发数 |
- **成功响应**：`200 OK`
  ```json
  {
    "id": "3",
    "version": 1
  }
  ```
- **错误分支**：
  - `409 ERR_DUPLICATE_NAME`：角色英文名称已被占用；
  - `400 ERR_VALIDATION_FAILED`：参数格式错误或 `default_limit > max_limit`。

---

#### 6.6.3 更新角色策略与资源配额
- **接口路径**：`PUT /api/v1/roles/:id`
- **守卫级别**：`L4 角色守卫` (`SUPER_ADMIN` 或 `SECURITY_ADMIN`)
- **路径参数**：`:id` (目标角色 ID，`string`)
- **功能说明**：全量更新角色策略参数。校验 `version` (409 CAS)。更新成功后递增系统 `globalPolicyVersion`，使排队快照在二次核验时触发策略重载。
- **不可变字段确定性规则**：`role_name` 属于不可变属性。若请求体试图变更其值（即传入值与数据库已存值不一致），服务端**将严格阻断并返回 `400 ERR_ROLE_IMMUTABLE_FIELD`**；若传入值与数据库已存值完全相同则放行。
- **缺省与增量更新语义规范**：更新采用**白名单字段增量合并更新 (Partial Patch on Allowed Fields)**。请求体中未提供的可选字段（缺省/未传）一律视为保留当前已存原值；传有效非空值表示更新覆盖；传 `null` 表示清空允许为空的字段（如 `description`）；未知字段返回 `400 ERR_VALIDATION_FAILED`。
- **跨字段校验规则**：更新后的参数必须满足 **`default_limit <= max_limit`**。
- **请求头**：`x-csrf-token: <string>`
- **请求体全量可写字段清单 (UpdateRolePayload)**：
  | 字段名 | 类型 | 必填 | 约束限制 | 描述 |
  | :--- | :---: | :---: | :--- | :--- |
  | `display_name` | `string` | 否 | 长度 1~64 字符 | 角色中文名 |
  | `description` | `string \| null` | 否 | 最大 255 字符 | 角色说明 |
  | `profileIds` | `string[]` | 否 | 至少 1 项有效 Profile ID | 授权数据源列表 |
  | `default_limit` | `number` | 否 | 整数 1~500 (须 <= max_limit) | 默认注入 LIMIT |
  | `max_limit` | `number` | 否 | 整数 1~5000 | 最大允许 LIMIT |
  | `max_timeout_ms`| `number` | 否 | 整数 1000~60000 | 最大查询超时 |
  | `user_qpm_limit`| `number` | 否 | 整数 -1 或 1~10000 | 基础 QPM 配额 |
  | `max_inflight_concurrency`| `number` | 否 | 整数 1~50 | 最大在途并发数 |
  | `version` | `number` | **是** | 必须等于当前读取到的版本号 | 乐观锁版本号 |
- **成功响应**：`200 OK`
  ```json
  {
    "success": true,
    "version": 3
  }
  ```
- **错误分支**：
  - `409 ERR_CONCURRENCY_CONFLICT`：版本冲突；
  - `400 ERR_VALIDATION_FAILED`：入参不合法或 `default_limit > max_limit`；
  - `404 ERR_NOT_FOUND`：目标角色不存在。

---

#### 6.6.4 删除自定义角色
- **接口路径**：`DELETE /api/v1/roles/:id`
- **守卫级别**：`L4 角色守卫` (`SUPER_ADMIN` 或 `SECURITY_ADMIN`)
- **路径参数**：`:id` (目标角色 ID，`string`)
- **功能说明**：物理删除自定义角色。
- **安全检查**：内置角色禁止删除 (`400 ERR_BUILTIN_ROLE_PROTECTED`)；若有用户仍分配此角色，抛 `400 ERR_ROLE_IN_USE` 阻断。
- **请求头**：`x-csrf-token: <string>`
- **成功响应**：`200 OK`
  ```json
  {
    "success": true
  }
  ```

---

#### 6.6.5 获取角色的表级 ACL 规则列表
- **接口路径**：`GET /api/v1/roles/:id/table-acls`
- **守卫级别**：`L4 角色守卫` (`SUPER_ADMIN` 或 `SECURITY_ADMIN`)
- **路径参数**：`:id` (目标角色 ID，`string`)
- **功能说明**：获取指定角色名下的表级黑白名单规则集及父角色当前乐观锁版本。
- **成功响应**：`200 OK`
  ```json
  {
    "rules": [
      {
        "id": "301",
        "profile_id": "0",
        "table_pattern": "salary_*",
        "rule_type": "BLACKLIST",
        "description": "薪酬敏感情报全全局黑名单禁止访问"
      },
      {
        "id": "302",
        "profile_id": "101",
        "table_pattern": "order_*",
        "rule_type": "WHITELIST",
        "description": "订单库只读开放订单表通配"
      }
    ],
    "version": 2
  }
  ```
  - `profile_id: "0"`：代表对该角色下绑定的所有数据源全局生效的通用规则。

---

#### 6.6.6 全量更新角色的表级 ACL 规则集
- **接口路径**：`PUT /api/v1/roles/:id/table-acls`
- **守卫级别**：`L4 角色守卫` (`SUPER_ADMIN` 或 `SECURITY_ADMIN`)
- **路径参数**：`:id` (目标角色 ID，`string`)
- **功能说明**：全量原子替换该角色的表级 ACL 规则。校验并递增父记录 `sys_roles.version` (409 CAS)。同事务写管理审计。
- **请求头**：`x-csrf-token: <string>`
- **请求体 JSON Schema**：
  | 字段名 | 类型 | 必填 | 约束限制 | 描述 |
  | :--- | :---: | :---: | :--- | :--- |
  | `rules` | `TableAclRuleWriteItem[]` | 是 | 数组容量 0~200 条，禁止同模式重复 | 全量表级规则数组 (全量覆盖语义；传空数组表示清空自定义规则) |
  | `rules[].profile_id` | `string` | 是 | `"0"` 或角色已绑定的有效 Profile ID | 作用数据源标识 (`"0"` 为角色下全局规则) |
  | `rules[].table_pattern` | `string` | 是 | 长度 1~128 字符，支持通配如 `salary_*` | 表名匹配模式 |
  | `rules[].rule_type` | `string` | 是 | 枚举: `'BLACKLIST'` 或 `'WHITELIST'` | 规则类型 |
  | `rules[].description` | `string` | 否 | 最大 255 字符，可为 `null` | 规则备注说明 |
  | `version` | `number` | 是 | 必须等于当前读取到的父角色版本号 | 乐观锁版本前置条件 |
- **请求示例**：
  ```json
  {
    "rules": [
      {
        "profile_id": "0",
        "table_pattern": "salary_*",
        "rule_type": "BLACKLIST",
        "description": "薪资表黑名单"
      },
      {
        "profile_id": "101",
        "table_pattern": "order_*",
        "rule_type": "WHITELIST"
      }
    ],
    "version": 2
  }
  ```
- **成功响应**：`200 OK`
  ```json
  {
    "success": true,
    "version": 3
  }
  ```
- **错误分支**：
  - `409 ERR_CONCURRENCY_CONFLICT`：角色版本已变动；
  - `400 ERR_VALIDATION_FAILED`：规则匹配格式有误。

---

#### 6.6.7 获取角色的库级 ACL 规则列表
- **接口路径**：`GET /api/v1/roles/:id/db-acls`
- **守卫级别**：`L4 角色守卫` (`SUPER_ADMIN` 或 `SECURITY_ADMIN`)
- **路径参数**：`:id` (目标角色 ID，`string`)
- **功能说明**：获取指定角色名下的结构化数据库级规则（`ALLOW` 或 `DENY`）。
- **成功响应**：`200 OK`
  ```json
  {
    "rules": [
      {
        "id": "401",
        "profile_id": "0",
        "database_name": "mysql",
        "effect": "DENY"
      },
      {
        "id": "402",
        "profile_id": "101",
        "database_name": "trade_order",
        "effect": "ALLOW"
      }
    ],
    "version": 2
  }
  ```

---

#### 6.6.8 全量更新角色的库级 ACL 规则集
- **接口路径**：`PUT /api/v1/roles/:id/db-acls`
- **守卫级别**：`L4 角色守卫` (`SUPER_ADMIN` 或 `SECURITY_ADMIN`)
- **路径参数**：`:id` (目标角色 ID，`string`)
- **功能说明**：全量原子替换库级 ACL 规则。校验并递增父记录 `sys_roles.version` (409 CAS)。
- **请求头**：`x-csrf-token: <string>`
- **请求体 JSON Schema**：
  | 字段名 | 类型 | 必填 | 约束限制 | 描述 |
  | :--- | :---: | :---: | :--- | :--- |
  | `rules` | `DbAclRuleWriteItem[]` | 是 | 数组容量 0~100 条，禁止同库重复 | 库级规则数组 (全量覆盖语义；传空数组表示清空自定义规则) |
  | `rules[].profile_id` | `string` | 是 | `"0"` 或角色已绑定的有效 Profile ID | 作用数据源标识 (`"0"` 为角色下全局规则) |
  | `rules[].database_name`| `string` | 是 | 长度 1~64 字符；v1.0精确名，拒绝`*`模式 | 目标数据库名，不使用LIKE匹配 |
  | `rules[].effect` | `string` | 是 | 枚举: `'ALLOW'` 或 `'DENY'` | 明确允许或禁止 |
  | `version` | `number` | 是 | 必须等于当前读取到的父角色版本号 | 乐观锁版本前置条件 |
- **成功响应**：`200 OK`
  ```json
  {
    "success": true,
    "version": 3
  }
  ```

库级 ACL 沿用数据库v1.0安全边界：写入含 `*` 的库级模式返回 `400 ERR_VALIDATION_FAILED`；`%`/`_` 按字面字符处理，不展开为LIKE通配。历史库级通配规则须人工迁移并核验授权范围，不能启动时静默扩大/缩小权限；表级 `table_pattern` 的既定 `*` 能力不受影响。
