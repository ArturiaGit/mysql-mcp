# 四份设计文档第二轮限定范围复核报告

- 日期：**2026-11-10（Asia/Shanghai）**。
- 依据：[上一轮综合评审报告](D:/E/PersonalProjects/mysql-mcp/docs/reviews/CROSS_DESIGN_REVIEW.md)的 **CR-01～CR-14**。
- **结论：7 项可关闭，7 项仍需整改；剩余为 6 项 P1、1 项 P2。本轮限定范围复核暂不通过。**
- 本轮不新增独立问题编号，不扩展到新的 SQL 安全、限流、审计或基础设施问题类别。仅核验原问题及为其修复而改动的实现、调用链和契约。
- 只新增本报告、复核脚本和三份证据；未修改四份正文、生成分片、上一轮报告或现有脚本/证据。

## 一、结论与受评对象

本次修改不是无效修改：重复 DDL 列和原来缺失的列已经补齐，角色/数据源请求字段、表级 ACL、管理员流量数组、用户 CAS 参数、两项 REST 错误码、纯类型包边界等已得到修复；密码自然过期守卫与目标用户来源状态检查也确实加入了代码。

但仍不能因为当前复现脚本显示“27/27”就认定全部问题关闭：部分断言只验证了修复表象，没有覆盖实际模块引用、SSH 转发完成条件、失败 UI 和真实 ErrorCode 类型约束。本轮独立从当前正文抽取代码，在不注入缺失生产 helper 的条件下重验，并明确保留已修复部分的通过结论。

### 当前正文基线

四份文档仍沿用上一轮版本号，因此用内容哈希标识本次正文，不能仅靠版本号判断是否为同一对象。

| 文档 | 标注版本 | 字节数 | 行数 |
| --- | --- | ---: | ---: |
| 架构 | v1.2.1 | 109,312 | 1,586 |
| 前端详细设计 | v1.4.0 | 98,540 | 1,249 |
| 后端详细设计 | v1.7.0 | 239,740 | 5,284 |
| 接口契约 | v1.5.0 | 153,253 | 2,504 |

- `ARCHITECTURE_SPEC.md`：`d37e4ba71d70168889e9c6a4a3b3c6a66be9013c66672af02cd7e86bb3fbf760`。
- `FRONTEND_ARCHITECTURE_SPEC.md`：`a50da97d5946d5a57b162872ff262d94db006d9a5008220fec1d7e457e2f1497`。
- `BACKEND_ARCHITECTURE_SPEC.md`：`2cbb317bffda809d9be26bae04b4e88088337b58f5ad229165f159ccd898e79a`。
- `API_CONTRACT_SPEC.md`：`41ae7363c002f8f0d696bef8bdee9d2a8bb2088a48eba5c8a4001d7eb64e1965`。

四份正文与各自生成器列出的分片按规定拼接后文本一致。该核对只读执行，没有运行会覆盖正文的 combine 脚本。

## 二、14 项逐项复核结论

“关闭”仅指原设计问题在本轮指定验证范围内已消除，不代表相应产品功能已经通过真实服务集成验收。

| 编号 | 原级别 | 判定 | 已修复部分 / 未关闭原因 |
| --- | --- | --- | --- |
| CR-01 | P1 | **关闭** | `sys_roles.version` 不再重复；原报告点名的用户、内置角色、大小写模式列已补齐 |
| CR-02 | P1 | **部分修复，保留** | 测试服务中的 TLS 映射正确；业务连接池、KILL 通道调用 helper 却未定义或导入 |
| CR-03 | P1 | **部分修复，保留** | TLS 开关/CA 与 SSH 开关变更已拦截；SSH 主机/端口/账号/指纹变更仍可复用旧密码 |
| CR-04 | P1 | **未关闭** | 新增 SSH 分支，但转发函数仅返回未连接的空 Socket，没有真实 SSH 会话或 forward 通道 |
| CR-05 | P1 | **部分修复，保留** | 正常登出和 CSRF 过期重试通过；500/网络失败仍无用户提示地清缓存跳转，普通 403 也被重试 |
| CR-06 | P1 | **部分修复，保留** | 多数 ID 与数组已改 string；审计 DTO 的 `profile_id` 仍是 number |
| CR-07 | P1 | **关闭** | 数据源和角色创建/更新的原冲突字段已统一为契约字段，后端角色路由表也同步 |
| CR-08 | P1 | **关闭** | 表级 ACL 已改为 `table_pattern / rule_type`，黑白名单枚举与 string Profile ID 对齐 |
| CR-09 | P1 | **关闭** | 管理员 `profile_traffic` 已改为 `Array<...>` |
| CR-10 | P1 | **关闭** | 用户状态/角色两个请求均补 `version`；乐观锁说明同步覆盖用户操作 |
| CR-11 | P2 | **部分修复，保留** | 到期字段和守卫已加入；UserProfile Schema/DTO 的 department 可选性不等，密码策略映射仍缺失 |
| CR-12 | P2 | **关闭** | 原角色拒绝、自操作拒绝两组 code 已统一；修复状态机引入的类型问题单列在原 CR-14 下 |
| CR-13 | P2 | **关闭** | shared-types 只保留类型，`toEntityId` 已迁至 core-engine，UserService 值导入同步调整 |
| CR-14 | P1 | **逻辑修复，工程落地未关闭** | PENDING/REJECTED 转换已拒绝且无写入；新增错误字面量未进入 ErrorCode，实际 strict 语义检查报错 |

## 三、仍需整改的 7 项

### CR-02 [P1] TLS helper 只定义在应用服务文件，另外两个模块无法解析

**位置：** 后端池模块导入区 [L2988–2996](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L2988)、调用 [L3233–3235](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L3233)；维护模块导入区 [L3422–3428](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L3422)、调用 [L3519–3521](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L3519)；唯一 helper 定义 [L4200–4227](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L4200)。

**已经通过：** 测试服务中的 `toMysqlSslOptions()` 能正确处理关闭 TLS、系统 CA、私有 CA，原来 `enabled:false` 仍生成 SSL 和 `ca_cert` 未映射的问题在这里已修复。

**残留：** `pool-manager.ts` 和 `admin-channel.ts` 都直接调用 `toMysqlSslOptions()`，本模块却既无定义也无导入。唯一实现被放在 `apps/admin-api/.../profile-connectivity.service.ts`，不是可以跨模块自然可见的全局函数。

**独立执行：** 分别以独立 CommonJS 模块加载两个原文代码块：

- 构造 `ManagedProfilePool`：`toMysqlSslOptions is not defined`；`mysql2.createPool` 未被调用。
- 调用具备有效端点租约的 `AdminMaintenanceChannel.killQuery()`：相同 ReferenceError；驱动维护连接未被创建。

这不是只在 TLS 启用时才出错：条件表达式本身就先调用未绑定名称。测试没有把应用服务里的 helper 偷渡进共享 VM 全局，因此能暴露实际模块边界问题。

**关闭条件：** 将 helper 放入允许底层使用的公共运行时模块，如 `packages/security` 或适当 core-engine 公共文件，并在三个消费模块显式导入。不能让 core-engine 反向依赖 apps/admin-api。重新执行各模块自身的构造/调用测试，保留三组 TLS 映射对照。

**证据：** `tls_disabled / tls_system_ca / tls_private_ca` 通过；`pool_tls_helper_resolves_in_module / admin_tls_helper_resolves_in_module` 未通过。

### CR-03 [P1] 仍未比较 SSH 跳板机完整信任元组

**位置：** 后端合并草稿 [L4279–4285](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L4279)、重填判定 [L4291–4311](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L4291)；契约 [L647–658](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L647)。

**已经通过：** 修改数据库 host、TLS 开关/CA、SSH 开关而不重填密码，均在解密、DNS 和驱动创建前被拒绝；完全未变配置可以继续复用密文凭据。

**残留：** `sshChanged` 仅判断 `payload.use_ssh` 是否改变，没有比较刚刚合并的 `ssh_host / ssh_port / ssh_user / ssh_host_fingerprint_sha256`。

例如已存配置已经启用 SSH，仅发送下列载荷：

```json
{ "profile_id": "101", "ssh_host": "other-bastion.example.test" }
```

代码没有返回 `ERR_CREDENTIAL_REENTRY_REQUIRED`，而是解密了 `DB_CIPHER`，将旧数据库密码放入新的连接配置。逐一修改端口、账号、指纹也产生同样结果。

观察到的 `reachable:true` 是驱动替身的受控成功，不是真实连通性；本项的关键证据是**应在解密和外联前拒绝，却已解密旧密码并创建驱动连接选项**。

**关闭条件：** 在解密之前，比较归一化后的数据库身份、TLS 配置及 SSH 开关/主机/端口/账号/指纹完整集合。四个 SSH 字段各自变化均必须阻断无新凭据请求，且解密、DNS、驱动创建计数都为 0。不要因为修复了 TLS 子场景就关闭整个原凭据边界问题。

**证据：** 四个 `ssh_*_change_requires_reentry` 未通过；四个原 host/TLS/开关反例及未变配置对照通过。

### CR-04 [P1] 所谓 SSH 转发仍是占位实现

**位置：** 后端 [L4252–4257](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L4252)、调用 [L4349–4353](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L4349)。

新增函数的完整实质是：

```typescript
private createSshForwardStream(sshConfig, targetIp, targetPort) {
  return (net.Socket ? new net.Socket() : {} as any);
}
```

它不使用传入的 SSH 配置和目的地址，不创建 SSH 客户端，不连接堡垒机，不执行 HostKey 验证，也不创建 forward 通道。真实 Node 环境下 `new net.Socket()` 只是未连接的 Socket，不是已认证 SSH 数据流。

**已存、新建、草稿三种模式的独立观察：** 均返回未连接 Socket；只对数据库主机发起了 SSRF 解析，没有对堡垒机进行解析/验证。已存私钥字段使用 `private_key_encrypted`，新分支读取的却是 `saved.ssh_config?.private_key`，也没有解密已存 SSH 私钥的路径。

因此“没有走 `net.connect` 直连”不等于“完成了安全 SSH 转发”。当前旧探针用的 net 替身没有 Socket 构造器，该占位函数甚至会返回 `{}`，但“不直连且字段名出现过”的断言仍然显示通过。

**关闭条件：** 测试服务复用已有 SshTunnelManager/连接工厂的真实 SSH 实现，完成跳板机及目标校验、凭据解密、指纹校验和 forward 流返回；补三模式的完整链路证明。若短期内只保留接口声明，也必须明确标记待实现，不能用空流当作已经完成的闭环实现。

**证据：** 三个 `ssh_*_profile_actual_forward` 均未通过。没有真实 SSH 服务，故本轮不作真实握手失败次数或时延断言。

### CR-05 [P1] 登出失败依旧静默呈现为退出，403 重试边界也过宽

**位置：** 前端 [L465–507](D:/E/PersonalProjects/mysql-mcp/docs/FRONTEND_ARCHITECTURE_SPEC.md#L465)。

**已经通过：** 请求携带 CSRF；正常注销完成；旧 Token 触发拒绝后刷新重试可以注销。

**残留一：失败没有向用户显式区分。** `serverLogoutOk` 被赋值但从未读取。服务端返回 500 时，没有任何失败提示；仍然在 finally 清缓存并跳转 `/login`，会话未注销。网络异常时只 `console.warn`，重定向后用户仍不知道服务端注销未确认。相比上轮，本轮不再认定“每一次正常登出都失败”，但原报告要求的失败状态闭环仍未实现。

**残留二：** 分支只检查 `res.status === 403`，没有读取 `code === ERR_CSRF_INVALID`，因此普通 `ERR_RBAC_FORBIDDEN` 403 也会刷新并重复请求。代码注释称“单飞”，新函数本身并无单飞 Promise；本轮整改重点仍限定在原先要求的精确重试边界，不另立问题。

**独立结果：**

| 输入 | 实际行为 | 判定 |
| --- | --- | --- |
| 正常成功 | 携带有效 CSRF、Session 注销、跳转 | 通过 |
| CSRF 过期 | 刷新一次并重新注销成功 | 通过 |
| 普通权限 403 | 刷新一次、POST 共两次 | 不符合仅 CSRF 重试规则 |
| 服务端 500 | Session 未注销、无提示、清缓存并跳转 | 未闭环 |
| 网络失败 | Session 未注销、仅 console 提示、清缓存并跳转 | 未闭环 |

**关闭条件：** 读取注销响应的错误 code；仅 CSRF 错误刷新一次。明确消费注销确认状态：失败时保留可重试反馈，或跳到有明确“本地退出、服务端注销未确认”提示的页面。不能仅在开发者控制台打印告警。保留成功注销对照。

### CR-06 [P1] 审计 DTO 仍有一个 number 型实体关联 ID

**位置：** 前端 [L941–947](D:/E/PersonalProjects/mysql-mcp/docs/FRONTEND_ARCHITECTURE_SPEC.md#L941)、旧全局规则文字 [L715](D:/E/PersonalProjects/mysql-mcp/docs/FRONTEND_ARCHITECTURE_SPEC.md#L715)；接口审计样例 [L2134–2141](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L2134)。

大多数修改已经完成：Profile、ACL、大盘中的实体 ID 和角色/数据源关联数组都改为 string。唯一剩余的明确 DTO 类型反例为：

```typescript
export interface AuditRecordDTO {
  // ...
  profile_id: number;
}
```

接口实际示例为 `"profile_id":"101"`，全局契约也要求所有实体主外键均为 string。正文 §5.4 还保留 `profile_id = 0` 的数字写法，和新的 DTO 中 `"0"` 未同步；这属于本项相同 ID 约定的文字残留，不另计问题。

**关闭条件：** 将 `AuditRecordDTO.profile_id` 对齐为 string，统一遗留全局值说明；保持其余已修复 DTO 不回退。加入审计真实 fixture 的解析和 Profile 关联操作测试。

**证据：** `all_frontend_entity_id_fields_are_strings` 精确列出唯一 number 型残留；角色/数据源 ID 数组对照通过。

### CR-11 [P2] 自然到期守卫已修，但用户模型严格相等与策略接口仍不完整

**位置：** 前端 Schema [L328–342](D:/E/PersonalProjects/mysql-mcp/docs/FRONTEND_ARCHITECTURE_SPEC.md#L328)、DTO [L923–937](D:/E/PersonalProjects/mysql-mcp/docs/FRONTEND_ARCHITECTURE_SPEC.md#L923)、守卫 [L522](D:/E/PersonalProjects/mysql-mcp/docs/FRONTEND_ARCHITECTURE_SPEC.md#L522)、接口矩阵 [L881–886](D:/E/PersonalProjects/mysql-mcp/docs/FRONTEND_ARCHITECTURE_SPEC.md#L881)；契约密码策略 [L936–992](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L936)。

**已经通过：** DTO/Schema 已加入密码到期、版本、驳回原因等字段，改密条件增加 `is_password_expired`，原自然过期初始化误放行的问题已经消除。

**残留：**

1. Schema 新增 `department: z.string().nullable().optional()`，DTO 却是必填 `department: string | null`。这不满足文档自身要求的独立推断类型与 DTO 严格双向相等。此处通过 Schema/TS AST 的可选性抽取确认，没有冒称已运行未安装的 Zod/expect-type 工程。
2. 前端正文仍完全没有 `/api/v1/auth/password-policy` 的 GET/PUT 映射、个人配置入口和关闭轮换的风险确认流程。上轮 CR-11 的整改要求已明确涵盖这一生命周期部分，不是本次新增功能要求。

**关闭条件：** 对齐 department 的必填/可空语义，让已声明的双向相等测试真实成立；补前端个人密码策略读取、更新和关闭前风险确认。无需重新改写已修好的自然过期守卫。

**证据：** `frontend_expiry_guard_includes_natural_expiry` 通过；`user_schema_dto_requiredness_matches / frontend_password_policy_route_mapping` 未通过。

### CR-14 [P1] 状态矩阵已堵住，但修复代码不能通过自己的错误码类型检查

**位置：** 后端状态变更 [L977–1009](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L977)、ErrorCode [L475–515](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L475)；契约用户不存在返回 [L1226](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L1226)。

**已确认修复：** 增加 `SELECT ... FOR UPDATE` 读取目标状态，拒绝 PENDING/REJECTED，并将来源状态纳入 CAS 条件。四种禁止转换（两种来源状态 × 两种目标状态）均抛出 `ERR_INVALID_STATUS_TRANSITION`，用户写入、成功审计、内存墓碑计数均为 0；合法启停的两个对照通过。

所以本轮**不再声称原审批绕过反例仍成立**。

**残留来自本次修复本身：** 新增的 `ERR_INVALID_STATUS_TRANSITION` 和 `ERR_USER_NOT_FOUND` 未加入当前实际的 `ErrorCode` 字符串联合。将文档中的 ErrorCode、AppError、UserService 合在同一真实 TypeScript strict 语义检查中，得到三条 TS2322：

```text
Type '"ERR_USER_NOT_FOUND"' is not assignable to type 'ErrorCode'.
Type '"ERR_INVALID_STATUS_TRANSITION"' is not assignable to type 'ErrorCode'.
Type '"ERR_INVALID_STATUS_TRANSITION"' is not assignable to type 'ErrorCode'.
```

此外，用户不存在时 REST 契约要求 `ERR_NOT_FOUND`，不是新造的 `ERR_USER_NOT_FOUND`。仅改成另一个未进入 union 的字面量仍不足以完成修复。

**关闭条件：** 用契约规定的错误码，补齐共享 ErrorCode；对新增拒绝分支进行真实语义检查，不只做擦除类型后的 VM 执行。保留四条禁止流转和两个合法启停对照。原 CR-12 的两组权限/本人 code 已修复，本项不重复将它们算作未关闭。

## 四、已关闭项的依据与范围

| 项目 | 本轮依据 |
| --- | --- |
| CR-01 | 原重复列反例和原点名缺失列均消除；只关闭这组原问题，不新增审查早已存在的字段长度、默认值或注释差别 |
| CR-07 | 当前前端路由表直接包含 `display_name / max_pool_size / profile_capacity_qpm`、`role_name / display_name`、角色策略 snake_case 字段；后端角色更新表同步 |
| CR-08 | 当前 DTO 不再使用 `table_name / effect`，改为 `table_pattern / rule_type`，黑白名单联合和 string Profile ID 明确 |
| CR-09 | `profile_traffic: Array<{...}>`，元素 Profile ID 亦为 string |
| CR-10 | 两个更新请求根级字段均有 version；本轮直接读取声明，不把旧脚本中手工 payload 缺 version 的观察当作新问题 |
| CR-12 | 原两种管理面错误名称已统一成 `ERR_RBAC_FORBIDDEN / ERR_SELF_ACTION_PROHIBITED`，未把数据面独立错误码机械纳入 REST 范围 |
| CR-13 | 原共享类型文件仅导出 EntityId；运行时 helper 位于 core-engine，UserService 已作正确值导入 |

本轮不会为了关闭这些问题额外要求重构已成立的修复方案，也不会将未执行的整个产品集成门禁算作新的评审问题。

## 五、为何“27/27”不能证明 14 项全部关闭

### 5.1 重跑现有脚本：27/27，确实可复现

当前 `cross-design-review.repro.cjs` 已随修订被调整，原同名 evidence 也已更新。本轮没有覆盖或回滚这些文件，而是通过输出环境变量重跑到新文件：结果仍为 **27 项全部 holds**。

这不是否认执行结果，而是说明它的证明范围：

- TLS 检查只运行 §9.2 测试服务，没有单独加载两个实际调用 helper 的底层模块。
- SSH 的通过条件只检查“不再有 directSockets”和“字段名被引用”；空 Socket/空对象也能通过，不能证明握手、指纹验证和 forward 成立。
- ID 检查只看 Profile 选项及审批数组，没有覆盖 AuditRecordDTO。
- 登出只测正常成功路径，没有注入 500/网络失败和普通业务 403。
- 状态检查只做类型擦除后的执行，注入宽松 AppError，无法发现 ErrorCode 联合不包含新增字面量。
- 用户 CAS 旧观察中仍同时出现 `missingRequiredFields:["version"]` 和 `holds:true`：原因是 payload 手工 fixture 未同步、通过标志只检查路由文字。当前路由已补 version，本轮直接核验当前声明，确认 CR-10 可关闭，不把旧 fixture 的不一致当成产品缺陷。

这些属于探针覆盖和证据解释问题，本轮不另增问题编号，也不据此推断修订方的动机。

### 5.2 本轮独立限定复核

**46 项观察：30 项成立，16 项未成立；归并为 7 项关闭、7 项保留。**

这是一组有针对性的反例与必要对照，不是整个系统的测试通过率。16 条失败观察不能当成 16 项独立缺陷。

- 使用当前文档中的原代码，保留模块导入语义；依赖以可见的受控替身隔离，不把缺失业务 helper 当作全局依赖补上。
- 只有涉及新状态修复的检查使用完整真实 ErrorCode/AppError 的语义约束；其他 VM 观察中的宽松 AppError 不被用于宣称类型正确。
- SSH/mysql 握手替身可主动成功，因此 `reachable:true` 不构成真实可用证据；流工厂被额外显式调用以检查它返回的对象和网络路径。
- DDL 只核验原列重复与原缺失列，不扩大整改清单。

### 5.3 历史审计/limiter 限定回归

另将现有后端第八轮脚本在当前后端正文上独立重跑，输出到新的 round2 文件。结果为 **4/4**：两条封存交错无丢失、独立封存重放对照通过、limiter strict 检查零诊断。

不重新打开 BE-R7-01 / BE-R7-02；没有重跑历史 73 项全量基线，也没有独立确认页首“73/73”声明。

## 六、建议本轮只做这些后续修改

1. 将 TLS mapper 放到合法公共运行时位置，三个消费模块显式导入。
2. 补完整 SSH 信任元组比较，并用真实隧道管理器替换空 Socket。
3. 处理登出失败的用户反馈与指定错误码重试。
4. 修正唯一残留的审计 ID 类型。
5. 对齐 UserProfile Schema 可选性，并补原密码策略入口/接口映射。
6. 同步状态修复所需的契约错误码和 ErrorCode 联合，使实际示例可编译。

已关闭的 7 项无需再启动新整改。完成剩余项后，复核上述反例与必要对照即可；不因本轮结论要求无限扩大新的评审类别。

## 七、交付、复跑与保护范围

本轮新增：

- [本报告](D:/E/PersonalProjects/mysql-mcp/docs/reviews/CROSS_DESIGN_REVIEW_ROUND2.md)
- [独立复核脚本](D:/E/PersonalProjects/mysql-mcp/docs/reviews/cross-design-review-round2.repro.cjs)
- [独立完整证据](D:/E/PersonalProjects/mysql-mcp/docs/reviews/cross-design-review-round2.evidence.json)
- [现有修订脚本重跑证据](D:/E/PersonalProjects/mysql-mcp/docs/reviews/cross-design-review-round2.baseline.evidence.json)
- [历史限定回归新证据](D:/E/PersonalProjects/mysql-mcp/docs/reviews/cross-design-review-round2.regression.evidence.json)

本轮独立脚本使用 Node.js 24.16.0、TypeScript 5.9.3，类型检查读取现有 mysql2 和 Node 类型。依赖环境沿用工作区外临时目录，不修改依赖锁或生产工程。

```powershell
Set-Location 'D:\E\PersonalProjects\mysql-mcp'
$tmp = Join-Path $env:TEMP 'mysql-mcp-design-review-20261108'
$env:NODE_PATH = "$tmp\node_modules;$tmp\r3-extra\node_modules"
node --check .\docs\reviews\cross-design-review-round2.repro.cjs
node .\docs\reviews\cross-design-review-round2.repro.cjs
```

当前受评内容未改变时，预期 `total:46, holds:30, violated:16, closedIssues:7, remainingIssues:7`。脚本退出码 0 表示完成观察收集，不表示所有问题通过。脚本自动校验四份正文、原综合报告、现有同名前轮脚本和证据均未被它修改。

**未执行：** 真实 MySQL 建库/事务、TLS/SSH 握手、真实 HTTP 服务、浏览器路由、完整工程构建、历史 73 项全量基线。真实集成门禁仍然存在，但不作为本轮新增问题或已关闭项的额外整改要求。
