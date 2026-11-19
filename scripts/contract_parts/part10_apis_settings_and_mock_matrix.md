### 6.9 系统设置与通知渠道模块接口契约 (`/api/v1/settings/*`)

#### 6.9.1 获取系统通知渠道配置
- **接口路径**：`GET /api/v1/settings/notifications`
- **守卫级别**：`L4 角色守卫` (`SUPER_ADMIN` 或 `SECURITY_ADMIN`)
- **功能说明**：获取企业微信、钉钉、飞书机器人 Webhook 告警渠道配置及订阅的高危安全事件。
- **安全说明**：Webhook URL 与签名密钥中敏感 Token 部分进行掩码处理 (`******`)，返回当前配置 `version`。
- **成功响应**：`200 OK`
  ```json
  {
    "channels": [
      {
        "channelType": "FEISHU",
        "enabled": true,
        "webhookUrl": "https://open.feishu.cn/open-apis/bot/v2/hook/********-****-****-****-************",
        "secret": "******",
        "alertEvents": ["HIGH_RISK_AST", "AGENT_LOOP", "POOL_EXHAUSTED", "SECURITY_BRUTE_FORCE"]
      },
      {
        "channelType": "DINGTALK",
        "enabled": false,
        "webhookUrl": "",
        "secret": null,
        "alertEvents": []
      },
      {
        "channelType": "WECHAT",
        "enabled": false,
        "webhookUrl": "",
        "secret": null,
        "alertEvents": []
      }
    ],
    "version": 1
  }
  ```

---

#### 6.9.2 更新系统通知渠道与告警订阅
- **接口路径**：`PUT /api/v1/settings/notifications`
- **守卫级别**：`L4 角色守卫` (`SUPER_ADMIN` 或 `SECURITY_ADMIN`)
- **功能说明**：更新通知渠道配置。校验 `version` (409 CAS)。同事务写管理审计。
- **脱敏字段保留与更新确定性语义**：
  - **`webhookUrl` 处理规则**：若请求体中该字段包含掩码字样（如包含 `********`）或为空/缺省，服务端判定为保留数据库内已存的完整明文 URL；若传入不含掩码的完整新 URL，服务端校验并更新；
  - **`secret` 处理规则**：若传入 `"******"`、`null` 或字段缺省，服务端保留已存加签密钥；若传入空字符串 `""`，服务端将其物理清空；若传入非掩码新字符串，服务端更新密钥；
- **请求头**：`x-csrf-token: <string>`
- **请求体 JSON Schema**：
  | 字段名 | 类型 | 必填 | 约束限制 | 描述 |
  | :--- | :---: | :---: | :--- | :--- |
  | `channels` | `NotificationChannelWriteItem[]` | 是 | 数组容量 1~3 条，渠道类型禁止重复 | 增量合并更新的通知渠道列表 |
  | `channels[].channelType` | `string` | 是 | 枚举: `'FEISHU'`, `'DINGTALK'`, `'WECHAT'` | 通知渠道标识 |
  | `channels[].enabled` | `boolean` | 是 | 布尔值 | 是否启用该渠道告警推送 |
  | `channels[].webhookUrl` | `string` | **否** | 最大 512 字符；缺省或含掩码时保留已存原值 | 机器人 Webhook URL |
  | `channels[].secret` | `string \| null` | **否** | 传 `null` 或 `"******"` 保留原密钥；传 `""` 物理清空；传新值覆盖 | 机器人签名密钥 |
  | `channels[].alertEvents` | `string[]` | 是 | 有效事件枚举数组 | 订阅告警类别 (如 `HIGH_RISK_AST`) |
  | `version` | `number` | 是 | 必须等于当前读取到的全局设置版本号 | 乐观锁版本前置条件 |

- **未提交渠道的确定性增量合并语义**：
  更新采用**按 `channelType` 增量合并 (Partial Patch by channelType)**。客户端仅需提交发生配置变更的渠道；未在 `channels` 数组中提交的渠道类型，服务端**保持原配置与启用状态不变**；若提交全部 3 个渠道则全量覆盖。
- **成功响应**：`200 OK`
  ```json
  {
    "success": true,
    "version": 2
  }
  ```
- **错误分支**：
  - `409 ERR_CONCURRENCY_CONFLICT`：配置已被其他管理员更新；
  - `400 ERR_VALIDATION_FAILED`：Webhook URL 格式非法。

---

#### 6.9.3 发送测试通知消息 (支持已存配置与新增草稿)
- **接口路径**：`POST /api/v1/settings/test-notify`
- **守卫级别**：`L4 角色守卫` (`SUPER_ADMIN` 或 `SECURITY_ADMIN`)
- **功能说明**：向指定的企业微信/钉钉/飞书 Webhook 发送一条测试卡片。
- **两大工作模式**：
  - **模式 1：已存渠道测试**：仅需传递 `{ "channelType": "FEISHU" }`，无需重传 URL 与 Secret，服务端自动从密钥库中解密已保存的有效配置发起推送；
  - **模式 2：草稿/新增测试**：传递 `{ "channelType": "FEISHU", "webhookUrl": "https://...", "secret": "..." }`，对填入的全新参数执行连通性探测。
- **安全防线**：全链路执行 SSRF Post-DNS 解析核验，强制锁定 IP 发起请求，禁止 3xx 外部重定向跳转，加装 3000ms 硬超时。
- **请求头**：`x-csrf-token: <string>`
- **请求体 JSON Schema**：
  | 字段名 | 类型 | 必填 | 描述 |
  | :--- | :---: | :---: | :--- |
  | `channelType` | `string` | 是 | `"WECHAT"`, `"DINGTALK"`, `"FEISHU"` |
  | `webhookUrl` | `string` | 否 | 测试新地址时必填；模式 1 可不传 |
  | `secret` | `string` | 否 | 签名密钥 (模式 2 可选) |
- **请求示例 (模式 1：快速测试已存配置)**：
  ```json
  {
    "channelType": "FEISHU"
  }
  ```
- **成功响应**：`200 OK`
  ```json
  {
    "success": true,
    "latencyMs": 142
  }
  ```
- **错误分支**：
  - `403 ERR_SSRF_PROHIBITED`：Webhook 域名解析出私有或保留 IP；
  - `400 ERR_NOTIFICATION_FAILED`：远端通知平台返回错误（如签名失效或 Token 无效）。

---

## 第七章：前后端联调测试矩阵与边界用例基线

### 7.1 核心成功路径测试矩阵 (`TC-INT-01` ~ `TC-INT-12`)

| 用例编号 | 业务场景 | 接口链路 | 期望 HTTP 状态 | 核心断言契约 |
| :---: | :--- | :--- | :---: | :--- |
| **TC-INT-01** | CSRF 令牌安全获取 | `GET /api/v1/auth/csrf` | `200 OK` | 返回 64 位十六进制 Token；若无种子自动下发 `mcp_csrf_seed` Cookie |
| **TC-INT-02** | 用户自主强口令注册 | `POST /api/v1/auth/register` | `200 OK` | 录入强密码，账号初始状态为 `PENDING`，`must_change_password=0`，记录审批流 |
| **TC-INT-03** | 初始超管密码登录 | `POST /api/v1/auth/login` | `200 OK` | 下发 `mcp_admin_sid` HttpOnly Cookie，返回 `UserProfileDTO` (含过期时间) |
| **TC-INT-04** | 会话信息全状态拉取 | `GET /api/v1/auth/me` | `200 OK` | `PENDING/REJECTED/DISABLED/ACTIVE` 均返回 200，被驳回用户下发 `reject_reason` |
| **TC-INT-05** | 审批通过直接激活 | `POST /api/v1/approvals/:id/approve` | `200 OK` | 用户状态流转为 `ACTIVE`，`must_change_password=0`，**用户可直接用原密码登录** |
| **TC-INT-06** | 自主修改密码 | `POST /api/v1/auth/change-password` | `200 OK` | 更新密码并重置 `password_updated_at`，重新开始过期计算，换发新 Session |
| **TC-INT-07** | 个人访问令牌签发 | `POST /api/v1/pats` | `200 OK` | **单次返回 rawToken 明文**，数据库存储哈希，返回 `token_prefix` |
| **TC-INT-08** | 数据源已存连通性测试 | `POST /api/v1/profiles/test-db` | `200 OK` | 仅传 `profile_id`，后端成功解密存量密码，返回 `{ reachable: true }` |
| **TC-INT-09** | 研发拉取轻量 Profile 选项 | `GET /api/v1/profiles/my-options` | `200 OK` | 仅返回授权 Profile 的 `{ id, name, displayName }`，绝无主机端口泄露 |
| **TC-INT-10** | 表级 ACL 黑名单置顶配置 | `PUT /api/v1/roles/:id/table-acls` | `200 OK` | 规则全量原子替换，`profile_id="0"` 全局生效，父角色版本自增并返回新版本 |
| **TC-INT-11** | 态势大盘双视角动态裁剪 | `GET /api/v1/audits/stats` | `200 OK` | 管理员视角返回全量指标；普通研发视角仅聚合本人数据且屏蔽连接数 |
| **TC-INT-12** | 审计日志 5 分钟 Ticket 导出 | `POST /api/v1/audits/export` ➔ `GET .../download` | `200 OK` | 签名 Ticket 验证通过，流式返回 CSV，首字符带公式注入前缀自动转义 |

### 7.2 安全与异常边界测试矩阵 (`TC-INT-13` ~ `TC-INT-27`)

| 用例编号 | 业务场景 | 触发操作 | 期望 HTTP | 期望错误码 (`code`) | 交互断言与自愈校验 |
| :---: | :--- | :--- | :---: | :---: | :--- |
| **TC-INT-13** | 密码登录防爆破锁定 | 连续 5 次输入错误密码 | `429` | `ERR_AUTH_ACCOUNT_LOCKED` | 账号被锁定 15 分钟，响应体携带精确 `retry_after_sec` 倒计时 |
| **TC-INT-14** | 待审账号越权访问功能 | `PENDING` 账号访问 `/api/v1/pats` | `403` | `ERR_AUTH_ACCOUNT_PENDING` | L2 守卫硬拦截，前端自动分流引导至 `/approvals/wait` 状态页 |
| **TC-INT-15** | 密码超期失效拦截功能 | 密码超过 90 天访问 `/api/v1/profiles` | `403` | `ERR_MUST_CHANGE_PASSWORD` | L3 守卫硬拦截，前端弹出全局模态改密框，锁定其他路由功能 |
| **TC-INT-16** | 尝试使用弱口令注册/改密 | 提交长度为 6 位纯数字密码 | `400` | `ERR_PASSWORD_POLICY_VIOLATED` | 表单对应字段标红并展示大小写/数字/特殊字符复杂度要求 |
| **TC-INT-17** | CSRF 令牌伪造或缺失 | 发起写请求携带空 `x-csrf-token` | `403` | `ERR_CSRF_INVALID` | `preValidation` 零副作用拦截，前端自动单飞拉取新 Token 后静默重试 |
| **TC-INT-18** | 超管尝试自冻结/自删除 | 管理员对自己调用停用或删除接口 | `400` | `ERR_SELF_ACTION_PROHIBITED` | 操作被阻止，Toast 提示“系统防自残保护中，禁止对自己执行此操作” |
| **TC-INT-19** | 尝试停用最后一名超管 | 系统仅存 1 名超管时尝试停用 | `400` | `ERR_LAST_SUPER_ADMIN` | 排他事务锁判定拦截，弹窗明确提示“系统必须保留至少 1 名超管” |
| **TC-INT-20** | 数据源编辑草稿并发冲突 | 携带旧 `version: 1` 提交 PUT | `409` | `ERR_CONCURRENCY_CONFLICT` | **前端严格保留用户本地草稿**，弹出冲突横条并高亮差异字段 |
| **TC-INT-21** | 修改数据源端点未填密码 | 修改了 host 但未填入密码 | `400` | `ERR_CREDENTIAL_REENTRY_REQUIRED` | 防外泄铁律拦截，密码框变红提示“修改主机目标必须重新输入密码” |
| **TC-INT-22** | 连通性测试命中私网 SSRF | 测试连接 `169.254.169.254` | `403` | `ERR_SSRF_PROHIBITED` | 域名 Post-DNS 拦截，引导联系管理员配置 `ALLOWED_OUTBOUND_IPS` |
| **TC-INT-23** | 删除仍在使用的 Profile | 删除已被角色关联的数据源 | `400` | `ERR_PROFILE_IN_USE` | 阻断删除，错误详情列表标出占用的关联角色名称 |
| **TC-INT-24** | 审计下载 Ticket 重复消费 | 使用已下载过的 Ticket 再次请求 | `403` | `ERR_TICKET_ALREADY_USED` | 单次消费原则拦截，提示“凭证已被使用，不可重复下载” |
| **TC-INT-25** | 审计下载 Ticket 超过 5 分钟 | 等待 301 秒后请求下载链接 | `403` | `ERR_TICKET_EXPIRED` | 拦截过期凭证，提示“导出凭证已过期，请重新发起导出申请” |
| **TC-INT-26** | 密码有效期配置更新 | `PUT /auth/password-policy` 设为 60 天 | `200` | - | 更新成功，重新计算过期时间点，返回最新剩余天数 |
| **TC-INT-27** | 关闭密码过期风险提醒拦截 | 尝试设置 `passwordExpiresDays: null` | `200` | - | 前端必须弹窗高风险警示对话框，用户确认后提交成功，服务端审计记录 |
| **TC-INT-28** | 限流删除重建防 ABA 校验 | A读取版本1，B删除后重新创建分配版本2，A提交旧版本1 | `409` | `ERR_CONCURRENCY_CONFLICT` | 持久化计数器分配新版本2，A的旧版本1更新被CAS原子拦截，杜绝ABA覆盖 |
| **TC-INT-29** | 审计 Ticket 并发原子预占 | 两个并发请求携带同一 Ticket 请求下载 | `403` | `ERR_TICKET_ALREADY_USED` | 首个请求 CAS 预占成功下载，第二个请求未发流直接被 403 阻断 |
| **TC-INT-30** | SSH/TLS 信任边界变更防外泄 | 数据源主机未变，但切换 `use_ssh=true` 且未填密码 | `400` | `ERR_CREDENTIAL_REENTRY_REQUIRED` | 信任边界发生变更，强制必须重新输入密码，防止凭据外泄 |
| **TC-INT-31** | 双栈 IPv6 ULA / 映射地址拦截 | 目标域名解析出 `fc00::1` 或 `::ffff:127.0.0.1` | `403` | `ERR_SSRF_PROHIBITED` | 双栈 DNS 全量解析核验，Fail-Closed 立即拦截私网出站 |
| **TC-INT-32** | 时序 QPM 速率与未完成桶折算 | 请求带 `timezone`，10分钟桶发生120次调用 | `200` | - | 正确输出速率 `12.0` QPM；未完成当前桶平滑折算，历史空桶补零 `0.0` |

### 7.3 前端 Mock 数据适配基线

在前后端独立并行开发阶段，前端 `apps/admin-ui` 可基于本契约标准结构接入 MSW (Mock Service Worker) 或 Vite 本地代理，所有 Mock 端点必须满足：
1. 主键全部使用 64 位大整型格式的字符串（如 `"1001"`, `"90001002003004005"`）；
2. 修改接口必须返回递增后的整数 `version`；
3. 异常分支必须完整返回包含 `code`, `message`, `timestamp`, `action_guidance` 的 `StandardErrorResponse`；
4. 密码策略相关端点完整模拟 30~180 天范围校验与关闭风险确认弹窗行为。

---

## 第八章：附录与设计基线索引

### 8.1 关联设计文档与架构决策索引
- **系统总架构说明书**：[`docs/ARCHITECTURE_SPEC.md`](./ARCHITECTURE_SPEC.md) (v1.2.1 基线版)
  - §5.2 物理 Schema 唯一入口（统一引用 `docs/sql/001_metadata_schema.sql` 的14表结构）
  - §6.1 MCP 11 项 Tools 显式传参契约与紧凑二维出参
  - §6.3 统一错误码与异常响应矩阵
- **后端详细设计说明书**：[`docs/BACKEND_ARCHITECTURE_SPEC.md`](./BACKEND_ARCHITECTURE_SPEC.md) (v1.7.0 七轮整改版)
  - §3.3 全链路 64 位 `EntityId (string)` 类型契约
  - §5.4 `preValidation` 无副作用 CSRF 校验器与 `/auth/csrf` 端点
  - §5.5 四级分层守卫完整实现流水线
  - §9.2 连通性测试三模式解析与防外泄安全铁律
  - §10.2 `/audits/stats` 双角色视角脱敏与时序聚合
  - §10.4 审计安全 CSV 导出、防公式注入与 5 分钟 Ticket
  - §11.1 管控面全量 RESTful 路由总表
- **前端详细设计说明书**：[`docs/FRONTEND_ARCHITECTURE_SPEC.md`](./FRONTEND_ARCHITECTURE_SPEC.md) (v1.4.0 终审修订版)
  - §3.2 `packages/shared-types` 纯类型边界定义
  - §4.1 会话管理、CSRF 刷新与 `SessionRequestManager` 代际管理
  - §4.2 账号生命周期全状态机与分层守卫顺序
  - §4.8 乐观锁冲突控制与草稿保留交互
  - §8.1 核心 RESTful API 路由映射表
  - §8.3 后端协同确认契约清单 (9 项闭环跟踪)

### 8.2 契约签名与生效声明
本接口契约规范自发布之日起作为 **MySQL MCP 企业级安全网关与管控平台 v1.0** 前后端研发、集成联调与自动化测试验收的唯一执行准则。