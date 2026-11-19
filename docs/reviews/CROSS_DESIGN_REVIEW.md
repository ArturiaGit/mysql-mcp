# 四份设计文档综合评审报告

- 评审日期：2026-11-09（Asia/Shanghai）。
- 范围：系统架构设计、前端详细设计、后端详细设计、接口契约；重点核验跨文档一致性与从设计到实现的可执行性。
- **结论：暂不建议将四份文档作为同一套“冻结实施/联调基线”批准。确认 14 项问题：11 项 P1、3 项 P2；本轮未认定 P0。**
- 本轮只增加报告、复现脚本和证据，不修改设计正文、生成分片及历史评审记录。

> 这是设计评审，不是已部署产品的漏洞扫描。下文“执行结果”来自当前 Markdown 中抽取的代码块及受控依赖；没有业务源码工程、真实数据库、TLS/SSH 服务或浏览器端到端测试。静态字段比对与受控模型的结果不会冒充真实 HTTP/数据库执行结果。

## 一、受评基线与裁定规则

| 文档 | 当前标注版本 | 字节数 | 行数 |
| --- | --- | ---: | ---: |
| [系统架构](D:/E/PersonalProjects/mysql-mcp/docs/ARCHITECTURE_SPEC.md) | v1.2.1 | 107,966 | 1,581 |
| [前端详细设计](D:/E/PersonalProjects/mysql-mcp/docs/FRONTEND_ARCHITECTURE_SPEC.md) | v1.4.0 | 95,041 | 1,187 |
| [后端详细设计](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md) | v1.7.0 | 231,349 | 5,199 |
| [接口契约](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md) | v1.5.0 | 153,192 | 2,504 |

接口契约 [L108–111](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L108) 已明确规定，REST 字段、类型、状态码、错误码以该文档为唯一验收标准。因此，本报告遇到 REST 定义冲突时，以契约为裁定依据；涉及内部工程边界、DDL、连接执行与安全实现时，同时检查架构和详细设计，不能用“接口文档优先”掩盖实现缺口。MCP 数据面在该 REST 契约范围之外，不将 REST 的规则机械套用于 MCP。

同一版本号不足以证明正文相同。当前后端正文与历史第八轮报告记载的哈希、字节数不同，本轮以当前文件重新抽取并执行限定回归，不沿用旧报告的通过结论。

### SHA-256

- `ARCHITECTURE_SPEC.md`：`0096cf72fff32c37ec1ad5a3ca1fa2ea909bfb18a5b98958eeebd3fbb5906a21`。
- `FRONTEND_ARCHITECTURE_SPEC.md`：`87478e5b8c44eeee3f890de988297b03ce31ba9bf49dc5cedf2fe7729ae54f0d`。
- `BACKEND_ARCHITECTURE_SPEC.md`：`182c1149cb230a5b6e9143c4248e0a59fb276b8e426b9d3a62d553440d7c1c7d`。
- `API_CONTRACT_SPEC.md`：`1945a5e2b3db891534dde06121d0df93ff4a56b5d7b2ec64e29882e77e34efbe`。

## 二、问题总表

P1：会阻断关键实施/联调链路，或破坏已经明确的安全、治理不变量；应在相关模块按冻结基线开发前解决。P2：应在工程实施前对齐的生命周期、错误处理或模块边界问题。优先级针对设计落地风险，不代表已经在生产系统验证了可利用性。

| 编号 | 优先级 | 问题 | 主要责任文档 |
| --- | --- | --- | --- |
| CR-01 | P1 | 架构 DDL 存在重复列，且与后端执行代码所需结构不一致 | 架构、后端 |
| CR-02 | P1 | TLS 外部配置未映射为驱动配置，关闭开关与自定义 CA 均失效 | 契约、后端 |
| CR-03 | P1 | 修改 TLS 信任边界仍可复用存量数据库密码 | 契约、后端 |
| CR-04 | P1 | 数据库连通性测试忽略 SSH 路径，测的不是保存配置中的实际链路 | 契约、后端 |
| CR-05 | P1 | 前端登出缺少 CSRF，失败仍清空缓存并跳转，服务端会话未注销 | 前端、后端、契约 |
| CR-06 | P1 | 前端多处实体 ID 仍为 number，与全链路 string 契约冲突 | 前端、契约 |
| CR-07 | P1 | 数据源及角色请求字段命名不一致，缺少显式映射层 | 前端、后端、契约 |
| CR-08 | P1 | 前端表级 ACL 的字段和枚举不符合线上的读写契约 | 前端、契约 |
| CR-09 | P1 | 管理员大盘 profile_traffic 被定义为对象，接口实际返回数组 | 前端、契约 |
| CR-10 | P1 | 用户状态与角色更新请求缺少必填 CAS version | 前端、后端、契约 |
| CR-11 | P2 | 前端用户模型及改密守卫未纳入密码自然过期 | 前端、后端、契约 |
| CR-12 | P2 | REST 权限拒绝、自操作拒绝错误码不统一 | 后端、契约 |
| CR-13 | P2 | shared-types 的纯类型边界与后端运行时函数导出冲突 | 架构、前端、后端 |
| CR-14 | P1 | 后端用户状态变更示例缺少来源状态校验，可绕过审批流转约束 | 后端、契约 |

## 三、关键问题与整改验收

### CR-01 [P1] 架构 DDL 不是可直接执行且与后端一致的初始化基线

**位置：** 架构 [L935–946](D:/E/PersonalProjects/mysql-mcp/docs/ARCHITECTURE_SPEC.md#L935)、[L916–933](D:/E/PersonalProjects/mysql-mcp/docs/ARCHITECTURE_SPEC.md#L916)；后端 [L575–614](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L575)、[L970–974](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L970)。

- `CREATE TABLE sys_roles` 在 L940 与 L946 重复声明 `version`。这不是可选字段差异，而是同一建表语句中的重复列定义，不能作为有效初始化 DDL。
- 即使移除重复列，架构相较后端仍缺少：`sys_users.apply_reason / password_updated_at / password_expires_days / version`、`sys_roles.is_builtin`、`sys_profiles.lower_case_table_names`。后端用户更新示例已经读取、递增 `sys_users.version`。

**影响：** 按架构建库无法得到后端设计要求的数据库；手工修正重复列仍不足以支持用户 CAS、密码周期和初始化内置角色等流程。

**证据：** `ddl_unique_columns`、`ddl_schema_alignment`；后端 DDL 无重复列的正向对照通过。这里只做 DDL 结构抽取，没有声称运行了真实 MySQL 建表。

**整改与验收：** 指定一份可执行 migration 为 DDL 唯一来源；架构引用它或同步生成，不保留两套不同的“完整 DDL”。在空库上完整迁移，并用 `information_schema.COLUMNS` 比对列结构；执行用户状态 CAS、初始化角色和密码策略读写冒烟测试。

### CR-02 [P1] TLS 线协议模型没有转换为 mysql2 实际连接选项

**位置：** 契约 [L214–218](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L214)；后端连接池 [L3198–3206](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L3198)、维护通道 [L3488–3496](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L3488)、测试连接 [L4262–4270](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L4262)。

契约使用 `{ enabled: boolean, ca_cert?: string | null }`。后端却只判断整个对象是否 truthy，并把它直接展开为 `ssl`：

- `{ enabled: false }` 仍生成 `ssl` 对象，因此“关闭 TLS”不生效；
- `{ enabled: true, ca_cert: "PRIVATE_CA" }` 生成的是 `ssl.ca_cert`，不是驱动实际读取的 `ssl.ca`。测试代码的真实选项捕获确认 `ssl.ca` 为缺省。

已额外检查本地锁定的 `mysql2@3.24.6` 驱动源码：其安全上下文使用 `ca: ssl.ca`。该检查的版本、源文件位置和哈希记录在主证据的 `driverInspection` 中；没有进行真实 TLS 握手。

**影响：** 无 TLS 数据源可能被误要求 TLS；企业私有 CA 无法按契约加载，导致合法数据库握手失败。维护 KILL 通道也有相同配置展开方式，不能只修测试接口。

**证据：** `tls_disabled_wire_mapping`、`tls_custom_ca_wire_mapping`。

**整改与验收：** 建立唯一的 `toMysqlSslOptions(TlsConfig)`：`null` 或 `enabled:false` 不传 `ssl`；启用时将 `ca_cert` 映射到 `ca`，保留强制证书和身份校验。测试连接、业务连接池、维护通道共用此函数；补关闭、系统 CA、私有 CA、错误 CA 四组真实握手用例。

### CR-03 [P1] TLS 降级/CA 更换没有触发凭据重新录入

**位置：** 契约 [L647–658](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L647)；后端 [L4207–4231](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L4207)。

契约明确要求改变 TLS 开关或 CA 必须重填密码。后端测试服务允许直接覆盖 `targetTlsConfig`，但复用旧密文前只比较 `host / port / user`。

隔离执行以一个存量启用 TLS 的 Profile 为输入，仅提交：

```json
{ "profile_id": "101", "tls_config": null }
```

实际结果是：没有返回 `ERR_CREDENTIAL_REENTRY_REQUIRED`，旧密码已被解密并放入一个没有 `ssl` 选项的连接配置。相同代码对“改 host 不填密码”的正向防护仍然有效，说明缺口集中于信任边界校验维度，而不是整个防重填逻辑均未实现。

**影响：** 设计所承诺的“既有凭据不得在改变信任边界后自动复用”不成立；这里没有声称已经通过真实网络窃取密码。

**证据：** `tls_change_requires_credential`；`host_change_reentry_control`、`unchanged_credential_reuse_control` 为通过的必要对照。

**整改与验收：** 在解密或任何外联前，对数据库身份、TLS 开关/CA、SSH 开关/地址/账号/指纹统一归一化比较；发生变更且缺少新凭据时拒绝。分别断言返回指定错误码、解密次数为 0、外联次数为 0。此项不能仅通过修复 CR-02 的字段映射关闭。

### CR-04 [P1] test-db 没有执行契约要求的 SSH 转发链路

**位置：** 契约 [L1619–1665](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L1619)；后端 [L4180–4188](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L4180)、[L4249–4261](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L4249)。

`test-db` 契约允许新建/草稿时传 `use_ssh`、跳板机地址、私钥及指纹，已存模式也应测试完整已存配置。后端 `TestDbPayload` 不包含这些字段，构造函数未注入隧道管理器，建立连接时始终调用直连 `net.connect({host:pinnedIp, port:targetPort})`。

**隔离结果：** 向文档代码提交完整 SSH 测试载荷，服务仍选择直连；六个 SSH 请求字段未被读取。已存配置带有 SSH 信息时，同样没有恢复和调用 SSH 路径。

**影响：** 只能经堡垒机访问的数据源会被误判不可达；若直连恰好可达，成功提示验证的也不是实际部署链路。SSRF、HostKey 和凭据边界不能从“独立 test-ssh 能通”推导为完整 MySQL 隧道已验证。

**证据：** `ssh_test_uses_requested_path`。捕获的是受控 `net` 替身，不是真实 socket。

**整改与验收：** 测试服务复用与业务池相同的“完整连接配置解析 + SSRF + SSH 指纹 + 隧道 + TLS”工厂。分别覆盖已存、草稿、新建；断言 SSH 模式未创建数据库直连 socket，目标 MySQL 握手经预期隧道完成。

### CR-05 [P1] 登出看似完成，服务端 Session 实际仍有效

**位置：** 前端 [L441–456](D:/E/PersonalProjects/mysql-mcp/docs/FRONTEND_ARCHITECTURE_SPEC.md#L441)；契约 [L854–861](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L854)；后端 [L1283–1293](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L1283)。

`handleLogout()` 直接调用原生 `fetch`，未带 `x-csrf-token`，也没有走已经设计的 CSRF 刷新/重试封装。后端对 POST 登出照常做 CSRF 前置校验，缺头时在业务注销前返回 403。前端没有检查 `response.ok`，仍在 `finally` 清缓存、跳转登录页。

**隔离执行结果：** 后端前置钩子返回 `ERR_CSRF_INVALID`；Session 注销替身未被调用；前端缓存已清空且跳转 `/login`。带合法 Token 的对照请求通过。

**影响：** UI 呈现“已退出”，但原 Cookie 对应的服务端会话未被注销；共享终端及后续自动会话恢复可能继续识别上一用户。

**证据：** `logout_csrf_end_to_end`、`csrf_valid_header_control`。前者名称表示文档函数跨层串联，不表示真实 HTTP E2E。

**整改与验收：** 使用独立超时信号的安全请求客户端，保留 CSRF Token 并只对 `ERR_CSRF_INVALID` 刷新重试一次；确认注销响应成功。若网络失败仍要本地清理，必须明确告知“本地退出，服务端注销未确认”，而非静默宣称成功。补“登出后同 Cookie 调用 `/auth/me` 为 401”的真实会话用例。

### CR-06 [P1] 全链路 string ID 只在部分前端模型落地

**位置：** 前端 [L836–854](D:/E/PersonalProjects/mysql-mcp/docs/FRONTEND_ARCHITECTURE_SPEC.md#L836)、[L888–928](D:/E/PersonalProjects/mysql-mcp/docs/FRONTEND_ARCHITECTURE_SPEC.md#L888)、[L942–973](D:/E/PersonalProjects/mysql-mcp/docs/FRONTEND_ARCHITECTURE_SPEC.md#L942)；契约 [L184–222](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L184)。

契约要求所有实体 ID 均为 string，ACL 全局值为 `"0"`。前端仍规定：审批/角色分配 `roleIds: number[]`、角色 Profile 关联 `profileIds: number[]`、`ProfileOptionDTO.id: number`、`ProfileDTO.id: number`、审计/ACL/大盘 `profile_id: number`。

前端 §3.3 还将规则表述为“超过 53 位”的 ID 才必须字符串化，但契约并不存在“小 ID 可保留 number”的分支。

**影响：** 小 ID 也会发生 schema、选项值和选择器严格相等判断不一致；以 `Number(id)` 消除此差异则重新引入大整数精度风险。此项不应靠前端临时强转消除类型报错。

**证据：** `profile_option_id_contract`、`approval_id_array_contract`，并交叉核对其余 DTO 定义。

**整改与验收：** 引入共享 `EntityId` 并覆盖所有主外键、数组、路径和表单值，统一 `"0"`。用 `"1"` 以及 `"9007199254740992" / "9007199254740993"` 验证显示、选择、提交、缓存键和定向操作均不混淆。

### CR-07 [P1] 数据源/角色请求在三份文档间没有一致的线上字段名

**位置：** 前端 [L848–854](D:/E/PersonalProjects/mysql-mcp/docs/FRONTEND_ARCHITECTURE_SPEC.md#L848)；后端 [L5087–5088](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L5087)；契约 [L1479–1501](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L1479)、[L1735–1787](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L1735)。

| 操作 | 前端/部分后端表格 | REST 契约要求 |
| --- | --- | --- |
| 新增数据源 | `displayName`, `maxPoolSize`, `profileCapacityQpm` | `display_name`, `max_pool_size`, `profile_capacity_qpm` |
| 新增角色 | `name`，未列中文名 | 必填 `role_name`, `display_name` |
| 更新角色策略 | `defaultLimit`, `maxLimit`, `maxExecutionTimeMs`, `userQuotaQpm` | `default_limit`, `max_limit`, `max_timeout_ms`, `user_qpm_limit` |

这不能简单解释为“内部模型可用 camelCase”：前端 §8.1 和后端 §11.1 都标为接口请求入参，且未定义映射层；角色更新契约还明确规定未知字段报错。

**证据：** `profile_create_fields`、`role_create_fields`、`role_update_fields`。它们按契约 Markdown 字段表比对，不是已运行 Fastify Schema 的 HTTP 400 记录。角色请求探针特意使用 string ID，排除了 CR-06 的影响后仍不一致。

**整改与验收：** 线上请求严格采用契约名；内部表单若保留另一套名字，提供显式、覆盖必填字段和可空语义的 request mapper，并把路由表标为 wire payload。用实际请求序列化结果做契约测试，而非只检查内部 TS 类型。

### CR-08 [P1] 表级 ACL 的模型并不是接口中的规则模型

**位置：** 前端 [L915–923](D:/E/PersonalProjects/mysql-mcp/docs/FRONTEND_ARCHITECTURE_SPEC.md#L915)；契约 [L1817–1887](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L1817)。

前端规定 `{ profile_id, table_name, effect: 'ALLOW'|'DENY' }`；接口读写使用 `{ profile_id, table_pattern, rule_type: 'BLACKLIST'|'WHITELIST', description? }`，读取还包含规则 `id`。

**影响：** 表名模式与黑白名单类型在前端 DTO 中没有同名字段，直接读取会为空；提交前端 DTO 又缺少契约必填项。即使修复所有 ID 类型，该问题仍然存在。

**证据：** `table_acl_wire_fields`。

**整改与验收：** 将线上读写 DTO 分开定义并按契约对齐；若界面内部保留 effect，则显式规定 `DENY ↔ BLACKLIST`、`ALLOW ↔ WHITELIST` 转换。用 `salary_*` 黑名单和 `order_*` 白名单完成“读取—编辑—提交—重读”的完整 round-trip，并保留父角色 version。

### CR-09 [P1] 管理员大盘的流量集合类型不一致

**位置：** 前端 [L934–952](D:/E/PersonalProjects/mysql-mcp/docs/FRONTEND_ARCHITECTURE_SPEC.md#L934)；契约 [L2202–2225](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L2202)。

前端 `AdminDashboardStatsDTO.profile_traffic` 是单个对象；契约返回 `profile_traffic: [...]`，允许承载多个数据源。普通研发的 `authorized_profiles` 又已使用数组，使两套视图的差异更容易被仅使用单 Profile 的 Mock 掩盖。

**影响：** 按前端类型访问 `profile_traffic.time_series` 时，无法读取真实数组负载的时间序列；图表及 Profile 切换无法按双方定义直接联调。此处与 CR-06 的元素 ID 类型是两个独立问题。

**证据：** `dashboard_profile_traffic_shape`，直接使用契约中的管理员响应示例。

**整改与验收：** 改为数组并明确空列表、单 Profile、多 Profile、聚合视图的展示选择规则。加入至少两个数据源的契约 fixture，避免只用手工拼造的单对象 Mock。

### CR-10 [P1] 用户状态/角色更新缺少 CAS 版本号

**位置：** 前端 [L840–841](D:/E/PersonalProjects/mysql-mcp/docs/FRONTEND_ARCHITECTURE_SPEC.md#L840)；契约 [L1186–1212](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L1186)、[L1230–1243](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L1230)；后端 [L953–974](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L953)。

前端状态更新只发 `{status}`，角色更新只发 `{roleIds}`；两个接口的契约都必填 `version`，后端方法也接收 `expectedVersion`。前端 §4.8 的乐观锁清单仅覆盖 Profile、角色、ACL 和限流，没有涵盖用户状态/角色绑定。

**影响：** 严格实现契约会拒绝前端正常请求；若后端为兼容而取消用户 version 校验，又会丢失已承诺的并发覆盖保护。给 `roleIds` 改成 string 不能修复 version 缺失。

**证据：** `user_status_cas`、`user_roles_cas`；角色探针已使用 string ID 排除其他冲突。

**整改与验收：** 用户列表模型携带 version，两个 mutation 原样提交，成功后同步返回的新版本；409 保留草稿并重新加载远端。加入两个管理员读取同一版本、先后更新只有一个成功的用例。

### CR-11 [P2] 前端密码生命周期仍停留在首次改密模型

**位置：** 前端 Schema [L328–336](D:/E/PersonalProjects/mysql-mcp/docs/FRONTEND_ARCHITECTURE_SPEC.md#L328)、守卫 [L470](D:/E/PersonalProjects/mysql-mcp/docs/FRONTEND_ARCHITECTURE_SPEC.md#L470)/[L513–518](D:/E/PersonalProjects/mysql-mcp/docs/FRONTEND_ARCHITECTURE_SPEC.md#L513)、DTO [L871–879](D:/E/PersonalProjects/mysql-mcp/docs/FRONTEND_ARCHITECTURE_SPEC.md#L871)；契约 [L528–552](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L528)；后端 [L1368–1385](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L1368)。

前端只以 `must_change_password` 判定改密，而契约、后端已经区分“首次强制改密”和“密码自然到期”。当前前端 DTO/Schema 还缺少 `is_password_expired`、到期时间、轮换天数、`reject_reason` 等 `/auth/me` 字段，路由表未纳入个人密码策略端点。

**观察：** `ACTIVE + must_change_password:false + 自然到期` 时，前端声明的判定放行，后端文档守卫返回 `ERR_MUST_CHANGE_PASSWORD`。前端确实已定义该错误的全局跳转，因此本轮不把它夸大成服务端越权或必然死循环；问题是初始化守卫、页面状态和密码策略功能尚未完整对齐。

**证据：** `password_expiry_guard_alignment`。

**整改与验收：** 对齐 UserProfile DTO 和 Schema，守卫覆盖首次强制/自然过期两种原因；补密码策略路由/请求映射和“关闭到期”的风险提示。覆盖首次登录、自然过期、永不过期、REJECTED 驳回说明四种状态，校验错误兜底与初始化导航一致。

### CR-12 [P2] REST 错误码字典存在两套名字

**位置：** 后端 [L483–484](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L483)、[L921–926](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L921)、[L1391–1400](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L1391)；契约 [L388–391](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L388)。

| 语义 | REST 契约 | 后端实际示例 |
| --- | --- | --- |
| 路由角色不足 | `ERR_RBAC_FORBIDDEN` | `ERR_FORBIDDEN_ROLE` |
| 禁止操作本人 | `ERR_SELF_ACTION_PROHIBITED` | `ERR_SELF_OPERATION_FORBIDDEN` |

这里比对的是后端管理面守卫和 UserService，并非要求数据面独立错误码都纳入 REST 契约。

**影响：** 前端针对契约 code 的分支及接口错误断言无法稳定命中。状态码一致不能替代机读 code 一致。

**证据：** `error_code_vocabulary`。

**整改与验收：** REST 层统一到契约字典；若内部仍有不同错误，边界转换必须显式定义。用无权访问管理路由、冻结本人两条请求验证真实输出 code。

### CR-13 [P2] shared-types 既被要求纯类型，又被用作运行时工具包

**位置：** 架构 [L1406–1409](D:/E/PersonalProjects/mysql-mcp/docs/ARCHITECTURE_SPEC.md#L1406)、前端 [L298–301](D:/E/PersonalProjects/mysql-mcp/docs/FRONTEND_ARCHITECTURE_SPEC.md#L298)；后端 [L429–460](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L429)、[L904](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L904)。

架构和前端明确要求该包只输出 `interface / type`；后端却在 `packages/shared-types/src/entities.ts` 导出具有运行时行为的 `toEntityId()`，并从该包进行值导入。

“没有第三方运行时依赖”与“没有运行时代码”不是同一件事。这个 helper 可以做到零依赖，但仍违反目前的纯类型包声明。

**影响：** 按纯声明产物配置包导出时，后端值导入无法成立；按后端实现产出运行时 JS，又不满足前端/架构的包边界检查。本项不声称 helper 本身存在安全漏洞。

**证据：** `shared_types_type_only_boundary`。

**整改与验收：** 选择并同步一种规则：将 helper 移到 `shared-runtime / core-engine` 等运行时包；或明确修改 ADR，允许 shared-types 提供零依赖运行时工具。对实际导出产物做导入测试，不能仅让文档双方各自成立。

### CR-14 [P1] 用户状态更新核心示例未实现来源状态约束

**位置：** 契约 [L1186–1198](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L1186)；后端 [L953–991](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L953)。

契约规定 `/users/:id/status` 只能做 `ACTIVE → DISABLED`、`DISABLED → ACTIVE`；`PENDING / REJECTED` 必须走审批，直接转换返回 `ERR_INVALID_STATUS_TRANSITION`。

后端 `updateUserStatus()` 检查了操作者本人、最后超管和 expectedVersion，但没有读取/锁定目标用户当前状态，更新条件只有 `WHERE id = ? AND version = ?`。操作者的 StatusGuard 只约束操作者，不能代替目标用户的来源状态检查。

**隔离结果：** 在事务查询替身中分别以 PENDING、REJECTED 作为目标原状态调用原文方法，两者均接受 ACTIVE，执行状态更新和 STATUS_CHANGE 审计，没有产生契约要求的错误。ACTIVE→DISABLED、DISABLED→ACTIVE 两个合法转换对照通过。这里证明的是所给 Service 示例缺少约束，并非已探测某个线上 Controller 存在越权入口。

**影响：** 如果按该核心示例落地，具备用户管理权限的操作能够跳过审批处理这一治理步骤；文档声明的目标状态机不成立。

**证据：** `status_transition_pending`、`status_transition_rejected`，以及两个合法状态转换对照。

**整改与验收：** 在同一事务内锁定目标记录并检查来源状态，CAS 更新带上预期来源状态；区分非法流转与并发版本冲突。对 PENDING/REJECTED 的所有目标状态验证无用户修改、无成功审计；合法启停流程保持通过。

## 四、验证结果、历史问题及证据边界

### 4.1 本轮交叉核验

- **27 项观察：21 项不满足跨文档/实现不变量，6 项必要对照通过，对应 14 项问题。**
- 不满足项既包括静态字段/DDL 比对，也包括文档代码隔离执行，不能全部称作“运行时测试失败”。
- 此数是针对已识别差异设计的反例集合，不是随机覆盖率、通过率或整个系统的质量评分。
- 原文代码块通过 Node 的 TypeScript 转换后在 VM 中执行，只移除模块导入/导出并注入外部依赖，不在被测函数中修复逻辑。
- TLS、MySQL、网络、会话注销、事务查询使用受控替身；HTTP 请求字段检查使用从 Markdown 提取的字段表模型，不是尚未存在的 Fastify schema。
- Frontend guard 的自然到期观察使用前端文档声明的布尔规则；后端拒绝结果执行当前后端守卫代码。没有声称运行了真实 React 路由树。

### 4.2 历史限定回归

本轮在当前后端正文上重新运行已有第八轮脚本，并通过 `REVIEW_EVIDENCE_FILE` 将输出重定向到新文件，保留历史证据：

| 项目 | 结果 |
| --- | --- |
| 审计连续封存交错 | `lostEventIds: []`，通过 |
| 首次快照前封存交错 | `lostEventIds: []`，通过 |
| 独立封存路径重放对照 | 通过 |
| limiter 完整代码块 strict 语义类型检查 | `diagnostics: []`，通过 |

合计 **4/4**。本报告不重新打开历史 `BE-R7-01 / BE-R7-02`，也不将本次差异叫作这些问题复发。没有重跑历史 73 项完整基线，故不独立确认“73/73”声明。

### 4.3 未完成的验证

未运行真实 MySQL 建库/migration、数据库查询/KILL、TLS 私有 CA 握手、SSH 堡垒机、Docker 编排、真实 Fastify HTTP、完整 TS 工程构建、浏览器与屏幕阅读器验收。本轮未发现足够证据的新 SQL 防火墙或审计丢失问题，不对这些未覆盖路径给出全面通过承诺。

## 五、整改顺序与基线收敛建议

1. **先解决后端安全/治理和初始化阻断：** CR-01、CR-02、CR-03、CR-04、CR-05、CR-14。先确定完整连接配置和状态转换语义，不让前端补丁掩盖后端缺口。
2. **再一次性同步线上契约：** CR-06～CR-10；统一生成 EntityId、读写 DTO、请求映射与 fixture。不要把每次修补限定为“只改一张接口表”，导致另一份文档继续漂移。
3. **同步生命周期、错误字典和包边界：** CR-11～CR-13。
4. **建立可执行唯一来源：** 将可验证 schema/migration/契约样例纳入工程；生成或核对四份文档的相关章节。`shared-types` 保持何种边界先做 ADR 裁定，再选代码生成落点。
5. **关闭条件：** 各问题通过本文列出的反例和必要对照，并补对应真实 HTTP/数据库/安全集成测试；重新运行已有回归。文档页首“终稿/已闭环”的标签不能替代交叉一致性证据。

## 六、产物与复跑

- [本报告](D:/E/PersonalProjects/mysql-mcp/docs/reviews/CROSS_DESIGN_REVIEW.md)
- [本轮复现脚本](D:/E/PersonalProjects/mysql-mcp/docs/reviews/cross-design-review.repro.cjs)
- [本轮完整证据](D:/E/PersonalProjects/mysql-mcp/docs/reviews/cross-design-review.evidence.json)
- [历史第八轮脚本在当前正文上的新回归证据](D:/E/PersonalProjects/mysql-mcp/docs/reviews/cross-design-review.regression.evidence.json)

本轮脚本使用本次实际运行的 Node.js 24.16.0，无必须安装的第三方依赖；若 NODE_PATH 中可解析 mysql2，会额外记录锁定驱动源码检查信息。不要将退出码 0 误读成“全部设计通过”：脚本的目的为生成观察证据，应同时核对 `summary`、每项 `holds` 和文档哈希。

```powershell
Set-Location 'D:\E\PersonalProjects\mysql-mcp'
node --check .\docs\reviews\cross-design-review.repro.cjs
node .\docs\reviews\cross-design-review.repro.cjs
```

受评正文未修订时预期为 `total:27, holds:6, violated:21, findings:14`。代码执行依赖 `stripTypeScriptTypes` 的 transform 模式，本次 Node 会输出 experimental 提示。

历史限定回归依赖已存在的独立临时依赖环境，本次使用 Node.js 22.22.0、TypeScript 5.9.3、mysql2 3.24.6、Node 类型 26.6.6：

```powershell
Set-Location 'D:\E\PersonalProjects\mysql-mcp'
$tmp = Join-Path $env:TEMP 'mysql-mcp-design-review-20261108'
$env:NODE_PATH = "$tmp\node_modules;$tmp\r3-extra\node_modules"
$env:REVIEW_EVIDENCE_FILE = Join-Path (Get-Location) 'docs\reviews\cross-design-review.regression.evidence.json'
& "$tmp\r2-node22\node_modules\node\bin\node.exe" `
  .\docs\reviews\backend-design-review-round8.repro.cjs `
  .\docs\BACKEND_ARCHITECTURE_SPEC.md
Remove-Item Env:REVIEW_EVIDENCE_FILE
```

临时依赖目录不是仓库交付物；其他环境需要先准备等价依赖，不能把目录缺失解释为设计回归。新回归证据预期 `total:4, holds:4, violated:0`。
