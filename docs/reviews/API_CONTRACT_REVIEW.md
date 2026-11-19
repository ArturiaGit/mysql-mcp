# API 接口契约规范评审报告

- 评审日期：2026-11-09（Asia/Shanghai）。
- 评审对象：[API_CONTRACT_SPEC.md v1.0.0](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md)，119,728 字节，2,151 行。
- SHA-256：`3396AA0ACF2F01677D4FAF5F17ACF075EB8BE2FDA5E2B0D5EC3178A6CC8C2B22`。
- 对照基线：总架构 v1.2.1、后端 v1.7.0、前端 v1.4.0，以及 API 文档的 10 个生成分片。
- **结论：结构完整、主要安全方向正确，但不建议按现状冻结为“终审工程执行基线”。本轮记录 4 项 P1、8 项 P2；应先关闭 P1，再完成协议一致性和契约校验。**
- 本报告不修改原规范、生成分片或生成器。

## 一、评审范围与证据边界

本次完成了 45 个 `HTTP method + path` 接口定义的文档检查，检查重点为安全闭环、状态转换、并发语义、请求/响应可实现性，以及与所引用架构基线的一致性。

工作区未发现 `apps/admin-api`、`apps/admin-ui` 或可运行的接口测试工程；现有内容为设计文档、文档生成脚本和静态 HTML 演示。因此：

- 下列“反例”均为契约推演或待执行的验收场景，不是已在真实服务复现的漏洞。
- 明确区分“正文自相矛盾”“跨文档依赖未同步”“规则未定义”；不将规则缺失直接等同于已实现系统必然存在漏洞。
- 不沿用此前后端评审的通过数，也未执行真实 MySQL、SSH、TLS、浏览器或并发 HTTP 集成测试。
- 静态脚本只证明文字、字段和生成结果的结构事实，不证明业务安全性。

### 已执行的静态核对

| 检查项 | 实际结果 |
| --- | --- |
| 接口定义计数 | 45 个 |
| §3.3 错误码矩阵条目 | 36 个 |
| 正文引用但矩阵未登记的错误码 | `ERR_AUTH_USERNAME_EXISTS`、`ERR_DUPLICATE_NAME`、`ERR_NOTIFICATION_FAILED` |
| 正文与 10 个分片按生成器规则拼接的结果 | 完全一致 |
| 后端基线内 `password_updated_at`、`password_expires_days`、`password_expires_at`、`/auth/password-policy` 的出现次数 | 各为 0 |
| Profile 创建与 DB 测试章节中的 `tls_config` | 均未声明 |
| Profile 创建章节中的 SSH 主机指纹字段 | 未声明 |
| 用户列表与用户角色更新章节中的普通 `version` | 均未声明 |

证据：[api-contract-review.evidence.json](D:/E/PersonalProjects/mysql-mcp/docs/reviews/api-contract-review.evidence.json)。

重跑命令：

```powershell
python D:\E\PersonalProjects\mysql-mcp\docs\reviews\api-contract-review.audit.py
```

该脚本读取规范，并覆盖其同目录的静态证据 JSON；不修改任何设计正文。

## 二、问题总表

P1 表示需要在实施基线冻结前解决的安全规则或核心业务闭环问题；P2 表示会造成实现分歧、交互错误或并发覆盖的协议缺陷。优先级不是漏洞已被利用的证明。

| 编号 | 优先级 | 问题 | 证据性质 |
| --- | --- | --- | --- |
| API-R1-01 | P1 | 保存 Profile 可以绕开测试接口的凭据重新录入限制 | 正文规则缺口 |
| API-R1-02 | P1 | SSH 指纹无持久化输入，TLS 与隧道测试配置未形成闭环 | 字段缺失、跨文档冲突 |
| API-R1-03 | P1 | 密码生命周期新增能力未同步后端存储、守卫和路由基线 | 跨文档依赖未同步 |
| API-R1-04 | P1 | 审批目标 ID 有两种含义，且缺少原子状态前置条件 | 明确歧义、状态协议缺口 |
| API-R1-05 | P2 | 用户角色全量覆盖没有并发版本前置条件 | 并发协议缺口 |
| API-R1-06 | P2 | 用户限流继承态、首次创建和恢复默认缺少完整协议 | 生命周期缺口 |
| API-R1-07 | P2 | 通知脱敏值回填与测试缺少保留/替换/清除语义 | 密文字段往返不闭合 |
| API-R1-08 | P2 | 改密旧密码错误复用 401，与前端全局失会话处理冲突 | 跨文档交互冲突 |
| API-R1-09 | P2 | 密码策略读取声明 L1，但账号状态白名单未放行 | 正文守卫矛盾 |
| API-R1-10 | P2 | 错误模型、错误码目录和 Mock 必填性不一致 | 明确矛盾、目录遗漏 |
| API-R1-11 | P2 | `preValidation` 被误写为请求体解析前，零副作用范围失真 | 框架生命周期事实错误 |
| API-R1-12 | P2 | 核心更新无字段白名单与完整约束，不能形成唯一验收规则 | 校验契约缺口 |

## 三、P1 问题

### API-R1-01：将凭据重新录入规则覆盖到 Profile 保存和所有实际出站连接

**位置：** [§5.2，L610–617](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L610)、[§6.5.4，L1386–1411](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L1386)。

测试接口规定：修改 `host`、`port` 或数据库用户后，如果没有新密码，必须拒绝复用存量凭据。但保存接口明确允许“`password` 为空或缺省则沿用原密文”，同时允许增量修改连接参数，并没有附加端点变更时的例外限制。

**契约反例：** DBA 不调用 `test-db`，直接提交 `PUT /profiles/101`，改变 `host` 并省略密码；保存后由热重载连接池或下一次查询连接新主机，旧凭据仍然被用于新端点。这样，测试端点的保护不能覆盖等价的生产连接路径。

这里确认的是**规范允许绕过同一条凭据使用限制**，不是已经取得了某个数据库的明文密码。SSRF 检查通过也不等价于新端点获准使用旧凭据。

**建议：** 在统一 Profile 配置合并/校验层定义规则，覆盖保存、测试、热重载及维护通道。比较规范化后的完整认证目标；连接目标改变且未提供新凭据时拒绝保存，不落库、不递增版本、不创建连接。单独定义 SSH 跳板机变更时的私钥使用规则，避免用一个 `password` 条件覆盖两类认证。

**验收：** 不经过测试接口直接保存新端点、空密码和缺省密码均被拒绝；仅改展示名允许保留旧密文；同端点输入新密码时测试必须使用新值。

### API-R1-02：安全连接参数不能只出现在文字承诺或临时测试字段中

**位置：** [Profile 创建字段 L1338–1356](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L1338)、[DB 测试字段 L1439–1447](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L1439)、[SSH 测试字段 L1473–1481](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L1473)。

- Profile 创建请求有 SSH 私钥，却没有可保存的主机指纹字段；SSH 测试中的 `hostFingerprintSha256` 仅为可选临时字段。
- 所引用的后端基线 [L3870](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L3870) 已明确：指纹缺失、为空或不匹配时拒绝 SSH 握手。按本契约创建 SSH Profile，无法明确地录入生产连接所需指纹。
- Profile 创建及 DB 测试均缺少 TLS 配置字段；而后端 [L4146–4154](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L4146) 的 `TestDbPayload` 含 `tls_config`，[DDL L665–667](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L665) 也包含 TLS/SSH 安全配置。
- 新建草稿的 `test-db` 请求不能表达尚未保存的 SSH 隧道配置，不能保证测到的路径与保存后使用的路径一致。

**影响：** 可能出现“严格实现后无法使用 SSH Profile”“测试成功但实际连接条件不同”两类结果；不应为了让流程可用而退回不验证主机身份的实现。`ssh2` 官方说明也指出，未设置 `hostVerifier` 时默认自动接受主机密钥，不能把库默认行为当作安全兜底。[外部依据 S2]

**建议：** 明确可持久化的 TLS/SSH 配置结构，以及创建、更新、查询脱敏和测试之间的字段映射；SSH 启用时要求可信指纹或等价、已定义的信任机制。固定证书/指纹校验不可被普通请求关闭，DB 测试与生产池使用同一配置归一化和连接构造逻辑。

**验收：** 完整走通“新建 SSH+TLS Profile → 草稿测试 → 保存 → 已存配置测试 → 实际查询”；分别验证缺失/错误指纹和错误证书必然失败。

### API-R1-03：密码生命周期不是已由所引用后端基线承载的能力

**位置：** [§4.4，L508–529](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L508)、[§6.1.7–6.1.8，L885–941](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L885)。

API 契约新增并要求持久化/计算 `password_updated_at`、`password_expires_days`、`password_expires_at`，增加 GET/PUT 密码策略接口，同时要求 L3 执行自然过期校验。但它声明配套的后端 v1.7.0 已闭环，而该后端的 [用户 DDL L575–592](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L575) 没有相应字段，[路由基线 L5023 起](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L5023) 也没有该接口。

契约可以合法新增需求，但不能把仍需新增的持久化、迁移及守卫工作描述为已对齐。单靠 JSON 示例无法决定既有账号从何时起算、如何回填以及是否立即过期。

**建议：** 更新后端设计和迁移计划，明确哪些字段持久化、哪些计算生成；确定旧账号初始化、自举账号、审批等待期间过期、关闭/重新开启过期策略的行为，并使会话鉴权和相应数据面鉴权采用一致规则。

**验收：** 覆盖新库安装、旧账号迁移、修改周期、关闭后重新启用，以及用户在已登录状态下自然过期；不仅检查前端返回字段。

### API-R1-04：审批目标与状态转换必须是唯一、原子且可判错的

**位置：** [待审列表 L959–967](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L959)、[通过 L979–1005](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L979)、[驳回 L1009–1033](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L1009)。

列表明确同时返回工单 `id` 和 `user_id`，但通过/驳回的路径参数又写成“待审记录 ID 或用户 ID”。这不是客户端可以自行选择的等价表示：两个 ID 的数值可能分别指向不同记录。

另外，接口没有定义审批记录必须仍待审、账号必须仍为 `PENDING` 的原子前置条件及冲突响应；也没有定义同时通过/驳回、重复操作以及驳回重提后旧页面再次提交的结果。

**影响：** 前后端可能针对不同实体执行审批；不同实现也可能允许过时审批覆盖较新的账号/工单状态。此处是契约缺口，尚未在真实服务证实错误状态转换。

**建议：** 固定 `:id` 仅代表一个实体，优先使用当前待审工单 ID，并明确其与用户的关系；对当前审批轮次和状态执行事务内条件更新。并发终态只能有一个成功，另一方返回已登记的状态冲突码。重提产生新的轮次/版本，旧审批请求不能作用于新轮次。

**验收：** 构造工单 ID 与另一用户 ID 数值相同、通过/驳回并发、重复通过、驳回后重提再提交旧页面，以及账号已被停用时提交旧审批。

## 四、P2 问题

### API-R1-05：用户角色全量覆盖会发生静默丢失更新

**位置：** [用户列表 L1082–1107](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L1082)、[角色更新 L1146–1173](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L1146)。

角色绑定是全量替换，但 GET 不给编辑版本，PUT 不带版本前置条件。`auth_version` 的服务端递增只是使授权快照失效，不能判断客户端表单是否过时。

**反例：** 两名超管读取同一角色集，一人回收敏感角色，另一人随后提交基于旧页面的完整列表，重新把敏感角色授回。最后一名超管保护也不能防止此类覆盖。

**建议/验收：** 提供用户授权集合版本或 ETag，并在替换时做原子比较；相同读取版本的两次不同修改只能一个成功，另一方 409 且保留草稿。账号状态修改和破坏性操作是否采用同类前置条件，也应明确。

### API-R1-06：用户限流“恢复默认”及首次创建的版本语义不完整

**位置：** [L1764–1801](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L1764)。

GET 允许返回不存在覆盖记录的 `isCustom:false`，但未定义此时 `version` 来自何处。PUT 又规定首次创建可传 1，而已有新记录也可能恰好是版本 1。标题承诺“重置”，请求却只有具体配额、突发容量和版本，没有移除覆盖/恢复继承的表达。

**影响：** 客户端无法可靠完成“继承 → 自定义 → 恢复继承”；两个客户端基于继承态创建时的冲突结果也不唯一。复制当前全局值并不等于恢复继承，因为后续全局值变化时不会联动。

**建议/验收：** 定义 `inherit/custom` 判别结构及不存在记录的前置条件，可采用 `version:0`、ETag 或显式 create-only；定义删除覆盖或 `mode:inherit`，并明确重复请求与冲突行为。测试并发首次创建、恢复继承、恢复后修改全局配置。

### API-R1-07：通知配置的脱敏读、保留更新和已存测试无法闭环

**位置：** [L1989–2031](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L1989)、[L2045–2056](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L2045)。

GET 返回掩码 `webhookUrl` 和 `secret`；PUT 要求完整渠道列表，只笼统规定未修改 Secret 时保留旧密文，没有规定省略、`null`、空串及掩码字符串分别代表什么。测试接口又要求完整 Webhook，没有“使用已存渠道”的调用方式。

**反例：** 用户仅修改 `enabled` 后把 GET 对象原样提交，掩码 URL 可能被当成真实 URL 保存；已存机器人也不能在不重新输入完整 URL 的情况下可靠测试。

**建议/验收：** 将读取 DTO 与写入 DTO 分开；为机密字段定义明确的保留、替换、清除操作，禁止把掩码当成新凭据。提供基于渠道标识的已存测试模式。测试“读取 → 仅改订阅事件 → 保存 → 已存测试”，确认凭据不变且不回传明文。

### API-R1-08：旧密码输错不应被误当成会话失效

**位置：** [API L849–852](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L849)；对照 [前端 L388](D:/E/PersonalProjects/mysql-mcp/docs/FRONTEND_ARCHITECTURE_SPEC.md#L388)。

改密旧密码错误返回 `401 ERR_AUTH_FAILED`；所引用前端基线对 HTTP 401 的处理是清缓存并跳转登录。一次旧密码输入错误会因此触发与会话过期相同的交互，而不是保留改密表单进行纠错。

**建议/验收：** 可以为已认证场景的旧密码错误定义 400/403 专用业务码，也可以明确 HTTP 拦截器按端点和错误码豁免；关键是两端采用同一规则。测试旧密码错误保留会话和草稿，真正的 `ERR_AUTH_UNAUTHORIZED` 仍退出登录。

### API-R1-09：密码策略 GET 的 L1 声明与 L2 白名单冲突

**位置：** [L429–439](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L429)、[L885–888](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L885)。

端点声明 L1，只要求有效会话；全局 L2 规则却限定 PENDING/DISABLED 仅能访问 me/logout，REJECTED 额外允许 resubmit，未包含密码策略 GET。因此同一受限账号的合法会话会得到“200”或“403”两种相互冲突的实现依据。

**建议/验收：** 若只让 ACTIVE 用户（包含密码过期者）读取，端点应标 L2 并豁免 L3；若全状态可读，则扩充 L2 白名单。使用四种账号状态及 ACTIVE+过期组合验证完整矩阵。

### API-R1-10：统一错误协议尚未真正统一

**位置：** [L280–306](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L280)、[L333–374](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L333)、[L2119–2122](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L2119)。

- `action_guidance` 在接口和字段说明中可选，但 Mock 基线要求所有错误都包含；二者不能作为同一严格验收规则。
- `ERR_AUTH_USERNAME_EXISTS`、`ERR_DUPLICATE_NAME`、`ERR_NOTIFICATION_FAILED` 出现在接口错误分支，却不在声称全量的错误码矩阵中。
- `details.validation_errors` 只有名称，没有路径格式、字段级错误项结构及与前端表单的映射约定。

**建议/验收：** 选定唯一必填性和兜底行为；让接口引用、共享错误类型及错误码目录取自同一注册源；定义可验证的字段错误结构。静态校验所有错误码引用均可解析，并分别测试缺失/存在 guidance 的预期行为。

### API-R1-11：修正 CSRF 钩子的生命周期和“零副作用”范围

**位置：** [L163–165](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L163)。

正文将 `preValidation` 写成“在读取请求体……之前”。Fastify 官方生命周期实际为 `preParsing → Parsing → preValidation → Validation → preHandler → Handler`，所以该钩子不能保证“尚未读取/解析 body”。[外部依据 S1]

“数据库与内存状态零变更”也过于绝对：早期日志、限流计数、请求统计是否允许变化没有定义。前端能够安全重试需要保证的是认证敏感计数和业务效果不被重复执行，而不是声称所有内存完全不变。

**建议/验收：** 明确 CSRF 检验必须在密码校验、业务写入及外部调用之前；定义允许的观测性副作用，以及登录失败计数等安全敏感状态的顺序。若确需在读取 body 前拒绝，使用适合的更早钩子，并统一解析错误处理。通过实际 Fastify 测试验证 CSRF 失败不写业务数据、不验证密码、不调用外部服务，刷新后最多重试一次。

### API-R1-12：将“包含待修改字段”收敛为可执行的更新契约

**位置：** [Profile 更新 L1390–1392](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L1390)、[角色创建/更新 L1526–1554](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L1526)。

两个核心更新接口都没有列出完整可写字段集合、空值/缺省语义和未知字段行为。角色配额没有完整的数值边界或 `default_limit <= max_limit` 等跨字段规则；只写 `version:number` 也没有确定正整数范围。前后端分别选择不同白名单和约束，都可能声称符合正文。

这一问题不等同于“没有 OpenAPI 文件就不合格”，也不证明实现允许任意字段赋值；问题是没有唯一规则来判断该实现是否合格。全局对内置角色的保护已经存在，不能因为端点未重复说明，就直接断言 SECURITY_ADMIN 已能提权。

**建议/验收：** 为 Create/Update/Read 分别定义 Schema：可写白名单、只读字段、整数范围、字符串长度、条件必填、未知字段策略以及跨字段限制。对 `role_name` 等标识是否允许变更给出明确决定。补充空更新、未知字段、只读字段、负数/小数版本和 default 大于 max 的测试。

## 五、建议补充但本轮未单独计为阻断项的事项

1. **大盘时间语义：** `today/7d/30d` 的统计时区、窗口边界、桶宽和空桶补零没有固定；UTC 传输格式本身不能决定自然日的起止。应在大盘和导出中共用规则。
2. **审计“脱敏”定义：** CSV 示例仍有 SQL 文本、用户名及 IP。应明确哪些字段保留、哪些内容掩码、SQL 字面量与底层错误如何处理；CSV 公式转义不等于敏感信息脱敏。Ticket 还应明确签发人绑定、并发原子消费、进程重启及流中断后的处理。
3. **低权限管理角色的选择器数据：** SECURITY_ADMIN 可配置角色的 `profileIds`，却不能读取仅 SUPER_ADMIN/DBA 可用的全量 Profile。应确认 `my-options` 是否足够表达其可管理范围，不宜通过放开敏感拓扑查询来补 UI 下拉框。
4. **状态重置入口：** 正文提到管理员重置密码及管理员调整过期策略，但接口清单没有专门的管理员入口。应明确是否属于当前交付范围；不是当前范围就删除相应闭环承诺。
5. **生成源维护：** 当前分片与正文一致。后续修订应同步修改分片后重新生成，避免仅改正文被 `combine_contract.js` 覆盖；还需检查生成分片的上游生成脚本是否会再次覆盖修订。

这些内容尚未全部转化为可执行反例，不与上面的 12 项重复计数。

## 六、已有优点与结论

值得保留的设计方向包括：实体 ID 字符串化；me 接口在有效会话下返回账号状态；受限账号与强制改密分层；ACL 共享父角色 CAS 版本；冲突时保留本地草稿；PAT 单次明文展示；出站 IP Pinning 与一次性审计下载凭证。

**最终判断：该文档适合作为一份较完整的接口设计草案，但当前“唯一权威、终审冻结、可直接验收”的定位超出了已闭合的程度。**

建议实施顺序：

1. 先处理 API-R1-01～04：统一凭据使用规则、补足安全连接配置、补齐密码生命周期依赖、固定审批标识和状态转换。
2. 再处理 API-R1-05～12：补齐并发/继承/密文字段往返协议，统一错误、守卫和校验规则。
3. 从修订后的唯一契约生成共享类型、运行时 Schema 与 Mock；用上述反例补充现有 27 条联调场景，不能把静态检查数当作接口通过率。
4. 待实现存在后再执行真实 MySQL/SSH/TLS、并发写入和浏览器端会话集成验收；完成后再考虑恢复“终审工程执行基线”状态。

## 外部事实核验来源

仅对框架/库行为使用上游一手文档，核验日期为 2026-11-09：

- S1：Fastify 官方 Lifecycle，`https://fastify.dev/docs/latest/Reference/Lifecycle/`。用于确认 Parsing 与 preValidation 的先后关系，不代表已运行本项目 Fastify 实例。
- S2：ssh2 上游 README 的 client connect options，`https://github.com/mscdex/ssh2`。用于确认省略 hostVerifier 时的默认行为，不代表本项目实际遗漏了校验器；本项目后端基线反而已经声明必须显式校验并 Fail-Closed。
