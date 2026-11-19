# API 接口契约第二轮限定范围复审报告

- 日期：2026-11-09（Asia/Shanghai）。
- 对象：[API_CONTRACT_SPEC.md v1.1.0](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md)，137,836 字节，2,371 行。
- 对象 SHA-256：`22451445E5F87A139548D3CDBD2E1C32F476129FBCF6D3809218D7E757747EC5`。
- 依据：[第一轮报告](D:/E/PersonalProjects/mysql-mcp/docs/reviews/API_CONTRACT_REVIEW.md)的 API-R1-01～API-R1-12。
- **结论：修改方向基本合理，原 12 项中 7 项在文档契约层面可关闭，5 项部分解决但仍有残余（3 项 P1、2 项 P2）。本轮不支持“12 项全部闭环”的声明。**

## 一、严格限定范围

遵循用户“不扩大评审范围”的要求，本轮只检查上轮 12 项问题的原有反例、修复规则及其直接依赖：

- 未评审第一轮报告第五节的非阻断补充事项，未新增问题类别或独立问题编号。
- 仅因旧问题涉及持久化、守卫或连接行为，才核对相应后端章节；不是重新审计后端架构。
- 不要求采用第一轮建议中的特定实现方式；只要求修复能满足原问题的约束。
- 静态核对正文与分片是否一致，仅用于确认受评对象，不另计业务用例。
- 未执行 MySQL、SSH、TLS、真实 HTTP 或浏览器集成测试。下文“关闭”均为**文档层面关闭**，不是运行验证通过。
- 保留第一轮报告、脚本和现有证据，不覆盖其文件；未修改规范或生成分片。

## 二、逐项复核结论

| 原编号 | 原级别 | 本轮判定 | 核验结果 |
| --- | --- | --- | --- |
| API-R1-01 | P1 | 关闭（文档层面） | §5.2 与 Profile 保存明确覆盖端点变化时重录凭据，保存路径不再被豁免。 |
| API-R1-02 | P1 | 部分解决 | SSH 指纹持久化及 TLS/隧道测试字段已补充，但 TLS 验真与主机名覆盖规则仍与严格校验基线不一致。 |
| API-R1-03 | P1 | 部分解决 | 后端增加密码字段与策略路由；迁移回填条件不成立，后端守卫仍未纳入自然过期判定。 |
| API-R1-04 | P1 | 部分解决 | 工单 ID 唯一化、409 和重提新轮次已写明；新增 PENDING 条件未与现有审批存储模型衔接。 |
| API-R1-05 | P2 | 部分解决 | 用户版本读取、回传与 CAS 要求已补齐，但用户版本列、迁移和后端更新示例尚未同步。 |
| API-R1-06 | P2 | 关闭（文档层面） | 继承态 version=0、首次创建冲突、已有覆盖 CAS 和 DELETE 恢复继承均已明确。 |
| API-R1-07 | P2 | 关闭（文档层面） | 已定义掩码/空值保留、Secret 清空及替换语义，并补充已存渠道测试模式。 |
| API-R1-08 | P2 | 关闭（文档层面） | 旧密码错误改为 400 ERR_OLD_PASSWORD_INVALID，不再触发前端通用 401 失会话路径。 |
| API-R1-09 | P2 | 关闭（文档层面） | 密码策略 GET 改为 L2 ACTIVE，明确豁免 L3，与 API 内的账号状态白名单一致。 |
| API-R1-10 | P2 | 关闭（文档层面） | guidance 必填性与 Mock 已一致；42 项错误码完整覆盖当前引用，并定义字段错误结构。 |
| API-R1-11 | P2 | 关闭（文档层面） | 已修正 Parsing/preValidation 顺序，并将无副作用承诺收敛为业务和数据副作用。 |
| API-R1-12 | P2 | 部分解决 | 白名单、配额范围及 default<=max 已补充；不可变字段仍允许“拒绝或忽略”两种结果，更新缺省语义未唯一化。 |

**统计为 12 项评审判定，不是 12 项执行测试或“7/12 测试通过率”。**

## 三、尚未关闭的原问题

### API-R1-02（P1）：TLS 字段已补齐，但安全语义仍不一致

**已确认的修复：**

- [L209–214](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L209) 已真实定义 `TlsConfig`，不是仅在修订说明中列出字段名。
- [L1439–1445](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L1439) 已定义 SSH 条件必填及可持久化指纹。
- [L1577–1583](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L1577) 已补齐 DB 草稿测试的 TLS/SSH 参数。

**仍未闭合的原约束：**

1. `reject_unauthorized?: boolean` 仅说明默认 true，没有限制 false。与后端 [L3166–3172](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L3166)、[L4230–4236](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L4230) 固定 `rejectUnauthorized:true`、`verifyIdentity:true` 的规则不能得出同一行为。按字段含义关闭验证，与由后端忽略该值并保持严格验证，是两种不同契约。
2. `server_name` 被定义为 SNI 主机名覆盖，而同一规范 [L686–688](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L686) 要求 SNI 和证书校验绑定原始 host；当前示例也给 IP host 配置了不同的 server_name，却未声明如何统一校验身份。

这仍是第一轮 API-R1-02 所要求的“固定验真规则、测试与生产配置同构”，不是新增证书攻击面评审。**不据此断言实际连接已经关闭了证书验证**，当前后端示例事实上仍强制开启。

**最小收口：** 选定唯一 TLS 信任规则。若沿用后端严格基线，就拒绝 false，并删除或约束 server_name 覆盖；若确需不同的逻辑身份，明确其校验规则和字段映射，同步测试与生产连接定义。无需再新增一套连接功能。

### API-R1-03（P1）：迁移回填没有生效条件，自然过期守卫仍未同步

**已确认的修复：** 后端 [L584–585](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L584) 已增加密码字段，[L5035–5036](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L5035) 已增加密码策略路由。第一轮的“完全没有持久化与路由定义”不再成立。

**剩余一：回填 SQL 与前面的列定义冲突。**

[API L569–576](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L569) 先添加：

```sql
password_updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
```

随后却使用：

```sql
WHERE password_updated_at IS NULL
```

在前一个 DDL 成功后的非空约束下，该条件不能匹配待回填行；因此脚本没有实现注释所述的“按 created_at 初始化历史账号”。这是对原迁移场景的静态判定，不是已在真实数据库测得影响行数。

**最小收口：** 可以先增加可空列、回填后再收紧约束；也可以明确选择迁移时刻作为旧账号起算点，并修改无效 SQL 与说明。这里不强制要求以 created_at 为起点，只要求选定的策略与脚本一致。

**剩余二：自然过期拦截仍停留在 API 要求，未同步引用的后端守卫。**

API [L475–478](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L475) 已定义强制改密或自然过期都要拦截；后端 [L1347–1356](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L1347) 仍只检查 `currentUser.must_change_password`，没有自然过期条件。后端改密步骤 [L1223–1224](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L1223) 也尚未同步刷新密码更新时间。

**最小收口：** 在上述直接相关章节统一过期判定与改密更新时间，保留必要端点的放行。只补原能力的实际规则，不要求新增其他账号治理功能。

### API-R1-04（P1）：审批 CAS 没有接上现有的审批记录模型

**已确认的修复：** [L1042](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L1042)、[L1081](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L1081) 已固定 ID 来自待审列表的工单 ID；[L1111](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L1111) 明确重提生成新轮次，并登记了状态冲突码。

**残余：** 新增的条件更新 [L1047–1049](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L1047) 要求 `sys_user_approvals.action='PENDING'`，但引用后端的 [表定义 L628–638](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L628) 仍把该表定义为审批/管理审计记录，其 action 表达 `SUBMIT / APPROVE / REJECT / RESUBMIT / ...` 动作；没有定义何时生成具有 PENDING action 的可变工单，也没有相应迁移或状态字段。

注册接口只定义用户状态为 PENDING，重提仍声明追加 RESUBMIT 流水，不能由此推出工单行的 action 已经变为 PENDING。**若直接拿现有 SUBMIT/RESUBMIT 记录作为该 CAS 的目标，条件不会命中，反而被判定为已处理。**

该结论并不声称 VARCHAR 在数据库层禁止写 PENDING；问题是受评设计尚未定义这种记录的生产方式，以及它与既有流水的关系。

**最小收口：** 统一当前审批轮次的存储状态及其生成/消费条件。可以保留动作流水模型并对用户/当前轮次做原子终结，也可以定义明确的可变工单状态；不强制拆表。保证同一设计能产生待审记录、完成一次审批，并拒绝旧轮次和并发重复操作。

### API-R1-05（P2）：用户 CAS 协议补了，但版本来源尚未落地

**已确认的修复：** [L1182](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L1182) 定义读取版本；[L1190–1199](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L1190)、[L1226–1234](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L1226) 定义状态/角色更新的版本前置条件；响应返回新版本和 409 也已补齐。

**残余：** 版本来源明确指定为 `sys_users.version`，但后端 [用户 DDL L575–594](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L575) 仍没有 version 列，API 的新增迁移也只加了两个密码字段。后端 [L969–972](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L969) 和 [L1029–1032](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L1029) 的更新示例仍只有 `WHERE id=?`，没有编辑版本 CAS。

因此前后端协议缺口已经修复，但第一轮要求的原子版本保护尚未形成一致的工程基线。

**最小收口：** 补 version 列、存量初始化与相关 CAS 更新，明确零影响行数的冲突处理。无需扩展到上轮未要求的其他实体或全量删除策略。

### API-R1-12（P2）：可写清单合理，但“拒绝或忽略”仍不是唯一结果

**已确认的修复：** Profile/Role 已列出可写清单和数值边界；角色创建及更新已经要求 default_limit<=max_limit，标识不可变也已明确。这些改动合理，不要求改成特定 Schema 库或另交一份 OpenAPI。

**残余：** [L1713–1714](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L1713) 一方面写“全量更新”，另一方面全部业务字段均可选，并规定 role_name 变更“将被拒绝或忽略”。同一个修改 role_name 的请求仍可以返回错误或成功，同一个省略字段的请求也缺少明确的保留/替换规则，不能成为唯一联调验收依据。

**最小收口：** 选定不可变/未知字段的处理规则与状态码；明确更新是“缺省保留”还是完整替换。可以沿用当前 PUT 路径和表格结构，不要求为了风格改成 PATCH。

## 四、可关闭项的定位依据

以下只关闭第一轮对应问题，不据此保证相关模块整体正确：

- **API-R1-01：** [L671–673](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L671)、[L1493–1496](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L1493) 已把测试和保存统一覆盖，并分别定义数据库密码、跳板机私钥的重录条件。
- **API-R1-06：** [L1944–1946](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L1944)、[L1977–1979](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L1977)、[L1997–2010](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L1997) 已定义继承、首次创建、更新和恢复继承。
- **API-R1-07：** [L2242–2244](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L2242)、[L2268–2278](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L2268) 已解决原样回填掩码及已存配置测试的问题。选择掩码作为保留指示，并不因未采用第一轮建议的显式操作对象而被否定。
- **API-R1-08：** [L374](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L374)、[L908](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L908) 已将旧密码错误定为 400；原来的前端 401 全局分流反例不再成立。
- **API-R1-09：** [L946](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L946) 与 [L478](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L478) 已一致。后端自然过期守卫的同步问题只记入 API-R1-03，不重复计数。
- **API-R1-10：** [L302](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L302)、[L319–345](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L319)、[L2342](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L2342) 已统一必填性并补齐字段错误结构；当前错误码矩阵实际 42 项，正文无未登记引用。
- **API-R1-11：** [L173–176](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L173) 已改成先 Parsing、再 preValidation，并限定为无业务/数据副作用，与本轮核对的 Fastify 官方生命周期一致。此项不再保留为需修改项。

## 五、静态证据与交付边界

本轮脚本观测：

- 当前接口定义 46 个；新增的恢复继承端点属于 API-R1-06 原修复范围，不作为新增审查面。
- 错误码目录 42 项，正文引用但未登记的错误码为 0。
- 正文与 10 个分片按现有生成规则拼接后完全一致。
- 后端用户表已增加密码字段，但没有编辑 version；后端守卫代码块没有密码自然过期判断。
- 上述观测只用于支持原 12 项的判定，不能代替集成验收。

脚本：[api-contract-review-round2.audit.py](D:/E/PersonalProjects/mysql-mcp/docs/reviews/api-contract-review-round2.audit.py)。

证据：[api-contract-review-round2.evidence.json](D:/E/PersonalProjects/mysql-mcp/docs/reviews/api-contract-review-round2.evidence.json)。

```powershell
python D:\E\PersonalProjects\mysql-mcp\docs\reviews\api-contract-review-round2.audit.py
```

脚本仅重写本轮证据 JSON，不修改受评规范、分片及第一轮产物。其中 12 项状态是文档评审记录，不是脚本自动证明的业务结论。

**下一轮只需复核 API-R1-02、03、04、05、12 的上述残余；无须重新打开已关闭的 7 项，也无须扩大到其他功能。**

### 上游事实核验

本轮仅为原问题核对以下一手文档：

- MySQL 8.0 数据类型默认值与 NOT NULL 约束：`https://dev.mysql.com/doc/refman/8.0/en/data-type-defaults.html`、`https://dev.mysql.com/doc/refman/8.0/en/innodb-online-ddl-operations.html`。用于核对迁移条件，不声称执行过真实 DDL。
- Fastify 官方 Lifecycle：`https://fastify.dev/docs/latest/Reference/Lifecycle/`。用于核对 API-R1-11 的修正顺序。
