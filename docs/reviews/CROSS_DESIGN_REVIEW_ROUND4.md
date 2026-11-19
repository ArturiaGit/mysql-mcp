# 四份设计文档第四轮限定范围复核报告

- 日期：**2026-11-11（Asia/Shanghai）**。
- 依据：[第三轮综合复核报告](D:/E/PersonalProjects/mysql-mcp/docs/reviews/CROSS_DESIGN_REVIEW_ROUND3.md)。重点复核剩余 CR-04、CR-11，并回归原来已关闭的 12 项。
- **结论：CR-04、CR-11 均可关闭；原 CR-01～CR-14 累计 14 项全部关闭，本轮限定范围复核通过。未发现本轮修复引入的、需要保留在该范围内的问题。**
- 该结论针对设计文档及抽取代码的指定验证，不等于整个产品完成真实集成验收，也不表示所有未评审领域无缺陷。
- 本轮未修改设计正文、生成分片或既有评审报告、脚本、证据；仅新增第四轮报告、复核脚本与证据文件。

## 一、结论摘要

本次修改已修复第三轮剩余的两个直接问题：

1. **SSH 指纹编码已统一。** 新增解析器将驱动的 hex 摘要和契约的 `SHA256:<Base64>` 指纹转换为 32 字节摘要后比较；临时隧道和缓存式生产隧道均使用同一校验函数。正确契约指纹能够完成本机真实 SSH 握手并取得转发通道，缺失、格式错误或不匹配指纹仍被拒绝，没有以取消校验的方式换取连通。
2. **密码策略 GET DTO 已与契约对齐。** 字段名、必填性、类型及关闭策略的 null/-1 语义一致，不再要求接口未返回的 password_updated_at；原契约 JSON 与关闭策略 fixture 的 strict 类型检查均通过。

验证结果：

| 验证组 | 结果 | 含义 |
| --- | --- | --- |
| 第三轮原 63 项观察在当前正文上重跑 | **63/63** | 不修改原断言，只重定向证据输出路径；原两个反例已转为通过 |
| 本轮复核脚本：原 63 项 + 33 项针对性补充 | **96/96** | 指纹解析、失败拒绝、两条 SSH 路径和密码策略空值语义均通过；不是整个系统的通过率 |
| 历史审计/limiter 限定回归 | **4/4** | 封存交错、独立重放对照与 limiter strict 检查保持通过 |

前两组重叠，**不能相加为 159 项独立覆盖**。96 项中包含原 63 项。

## 二、当前正文基线

版本号仍未变化，因此用内容哈希标识本次受评对象。相对第三轮，前后端正文有修订，架构与接口契约正文未变。

| 文档 | 标注版本 | 字节数 | 行数 | 相对第三轮 |
| --- | --- | ---: | ---: | --- |
| ARCHITECTURE_SPEC.md | v1.2.1 | 109,312 | 1,586 | 未变 |
| FRONTEND_ARCHITECTURE_SPEC.md | v1.4.0 | 102,123 | 1,288 | 已变 |
| BACKEND_ARCHITECTURE_SPEC.md | v1.7.0 | 247,159 | 5,470 | 已变 |
| API_CONTRACT_SPEC.md | v1.5.0 | 153,253 | 2,504 | 未变 |

SHA-256：

- 架构：`d37e4ba71d70168889e9c6a4a3b3c6a66be9013c66672af02cd7e86bb3fbf760`
- 前端：`0989e8c64381ad4aabdb75f871717f9350b15b59acf9ef2e887cd32e2eb4db74`
- 后端：`38923bf04ee11b657a8ec2efb7441e2eace896c2a666688621538a22ff90fc0a`
- 契约：`41ae7363c002f8f0d696bef8bdee9d2a8bb2088a48eba5c8a4001d7eb64e1965`

四份正文与各自 combine 脚本声明的分片按规则拼接后文本一致：架构 8、前端 11、后端 11、契约 10。该核对只读执行，未运行会覆盖正文的生成脚本。复核脚本前后对四份正文、既有综合评审文件与生成分片进行哈希保护检查，结果一致。

## 三、CR-04 [P1] 关闭：契约指纹已能通过真实 SSH 校验

### 3.1 修改内容核验

位置：

- [后端 L3964–3985：parseSha256FingerprintBytes](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L3964)
- [后端 L3987–3997：verifySshHostFingerprint](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L3987)
- [后端 L4130–4132：缓存式隧道调用](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L4130)
- [后端 L4197–4199：临时隧道调用](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L4197)
- [后端 L4507：连通性测试服务调用临时隧道](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L4507)

原先 `hashedKey === expectedFingerprint` 已被公共校验函数替代。解析器执行以下处理：

1. 支持驱动的 64 位 hex 摘要与契约 `SHA256:<Base64>` 指纹，统一输出 32 字节 Buffer。
2. 校验 Base64 长度、字符和重新编码结果，非法或非规范编码返回 null；缺失、错误前缀、错误长度同样拒绝。
3. 两边均成功解析后才调用 `crypto.timingSafeEqual()`，不会对不同长度 Buffer 直接比较。
4. 两条 SSH 分支使用同一个函数，没有只修测试路径而保留生产路径的编码冲突。

### 3.2 原反例复验

| 场景 | 结果 |
| --- | --- |
| 新建 test-db，正确契约指纹 | 进入 SSH forward，流工厂取得受控转发流，MySQL 替身完成 connect/ping |
| 已存 test-db，正确契约指纹 | 按预期解密 DB/SSH 凭据，进入 forward，测试通过 |
| 草稿 test-db，正确契约指纹 | 使用新配置/私钥进入 forward，测试通过 |
| 错误主机指纹 | 拒绝，不创建 MySQL 连接 |
| 缺失指纹、缺失 manager | 保持 Fail-Closed |
| 堡垒机或目标地址被 SSRF guard 拒绝 | 不进入 MySQL 驱动创建 |
| forward / MySQL connect / ping 失败 | 原清理对照通过，隧道正确关闭 |

这些场景使用当前原文的测试服务与隧道管理器，网络/驱动事件为受控替身，不宣称真实 MySQL 已连通。

### 3.3 针对性增加的证据

- **18 项解析器观察**：规范 OpenSSH、带合法填充、hex、大小写 hex、首尾空格等支持格式；缺失、null、空值、非字符串、错误前缀、短/非法 hex、错误长度/字符 Base64、非规范尾部位和重复填充等拒绝场景，均符合预期。
- **5 项公共校验函数观察**：正确、摘要不同、驱动摘要非法、期望值缺失/非法，返回值均符合预期且无异常逃逸。
- **1 项真实 strict 语义检查**：解析器和校验函数使用实际 Node Buffer/crypto 类型，零诊断。
- **新增 7 项真实 loopback 场景**，连同原 2 项共 9 项：临时隧道正确契约指纹通过；缓存式隧道正确契约指纹通过；两条路径的错误、缺失、非法指纹均被拒绝，没有接受 forward channel。裸 hex 正对照也保持通过，但关闭结论依赖的是正确契约格式已通过，而不是让调用方绕过原契约。

真实 loopback 测试使用同一组运行时生成的 Ed25519 主机密钥和用户密钥，实际 ssh2 客户端/服务端完成公钥认证及通道请求；测试端口只绑定 127.0.0.1，密钥不写入证据文件。服务端只接受受控 channel，未连接真正数据库目标。

**判定：第三轮指出的正确指纹被误拒绝问题已经消除，且校验没有变为 Fail-Open。CR-04 关闭。**

## 四、CR-11 [P2] 关闭：密码策略响应模型已与接口一致

位置：

- [前端 L908–909：GET/PUT 映射](D:/E/PersonalProjects/mysql-mcp/docs/FRONTEND_ARCHITECTURE_SPEC.md#L908)
- [前端 L968–977：PasswordPolicyDTO](D:/E/PersonalProjects/mysql-mcp/docs/FRONTEND_ARCHITECTURE_SPEC.md#L968)
- [契约 L936–952：GET 响应及关闭策略语义](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L936)

当前 DTO 的七个必填字段为：

```typescript
passwordExpiresDays: number | null;
passwordExpiresAt: string | null;
isExpirationEnabled: boolean;
daysRemaining: number;
isExpired: boolean;
minDays: number;
maxDays: number;
```

与契约字段逐项一致，不再混用 `/me` 的 snake_case 字段，也不再要求 `password_updated_at`。PUT 映射还补齐了契约响应中的到期时间和启用标志。

独立验证：

1. 将契约 GET JSON 原样赋给当前 DTO：strict 类型检查零诊断，无缺失或未知字段。
2. 按契约关闭策略语义构造 fixture：`passwordExpiresDays=null`、`passwordExpiresAt=null`、`isExpirationEnabled=false`、`daysRemaining=-1`、`isExpired=false`，赋给当前 DTO：零诊断。
3. AST 核对七个字段的名称、类型及必填性：完全一致。
4. 原 UserProfile Schema 与 DTO 的真实 Zod 推断相等检查、自然到期守卫、设置入口和风险确认检查保持通过。

第 2 项是从契约语义构造的静态 fixture，不是宣称真实 HTTP 服务已返回该结果；设置入口和确认流程仍是文档要求，未执行浏览器视觉验收。

**判定：原缺失的策略映射及其修复引入的 DTO 冲突均已闭环。CR-11 关闭。**

## 五、原 14 项最终台账

| 编号 | 原级别 | 本轮结论 | 验证要点 |
| --- | --- | --- | --- |
| CR-01 | P1 | **保持关闭** | 原重复列和原点名缺失列通过 |
| CR-02 | P1 | **保持关闭** | TLS 三种映射、连接池与维护通道模块引用通过 |
| CR-03 | P1 | **保持关闭** | host/TLS/SSH 八组变更反例在解密/DNS/驱动前拒绝，未变配置对照通过 |
| CR-04 | P1 | **本轮关闭** | 规范化指纹；三模式与两条真实 SSH 路径正反例通过 |
| CR-05 | P1 | **保持关闭** | 成功/陈旧 CSRF/普通 403/500/网络异常登出分支通过 |
| CR-06 | P1 | **保持关闭** | 实体 ID 与关联数组仍为字符串 |
| CR-07 | P1 | **保持关闭** | 原请求字段命名保持对齐 |
| CR-08 | P1 | **保持关闭** | 表级 ACL 结构及枚举通过 |
| CR-09 | P1 | **保持关闭** | profile_traffic 仍为数组 |
| CR-10 | P1 | **保持关闭** | 用户启停/角色更新 version 参数保留 |
| CR-11 | P2 | **本轮关闭** | 密码策略 wire DTO、空值语义和原 UserProfile 检查通过 |
| CR-12 | P2 | **保持关闭** | 原两组权限/自操作错误码保持一致 |
| CR-13 | P2 | **保持关闭** | 纯类型包与运行时 helper 边界保持正确 |
| CR-14 | P1 | **保持关闭** | 四种禁止转换和两种合法转换通过，ErrorCode/UserService strict 检查零诊断 |

没有新建问题编号，也不重新打开其他历史评审条目。原已关闭 12 项未发现本轮范围内的回归。

## 六、证据、复跑与执行边界

本轮新增：

- [本报告](D:/E/PersonalProjects/mysql-mcp/docs/reviews/CROSS_DESIGN_REVIEW_ROUND4.md)
- [第四轮复核脚本](D:/E/PersonalProjects/mysql-mcp/docs/reviews/cross-design-review-round4.repro.cjs)
- [96 项完整证据](D:/E/PersonalProjects/mysql-mcp/docs/reviews/cross-design-review-round4.evidence.json)
- [第三轮原脚本重跑新证据](D:/E/PersonalProjects/mysql-mcp/docs/reviews/cross-design-review-round4.baseline.evidence.json)
- [历史限定回归新证据](D:/E/PersonalProjects/mysql-mcp/docs/reviews/cross-design-review-round4.regression.evidence.json)

第三轮原脚本重跑时只在内存中替换输出文件路径，原文件及断言均未修改；新证据另存为 round4.baseline。第四轮脚本在原 63 项基础上增加 33 项针对性观察，所有问题关闭状态仍由对应观察计算。不存在“将反例删掉后宣布通过”的处理。

环境沿用工作区外既有临时依赖：Node 24.16.0、TypeScript 5.9.3、mysql2 3.24.6、Node types 26.6.6、ssh2 1.17.0、Zod 3.25.76。本轮未安装新包，未改工程依赖或锁文件。

```powershell
Set-Location 'D:\E\PersonalProjects\mysql-mcp'
$tmp = Join-Path $env:TEMP 'mysql-mcp-design-review-20261108'
$extra = Join-Path $env:TEMP 'mysql-mcp-cross-review-20261111'
$env:NODE_PATH = "$tmp\node_modules;$tmp\r3-extra\node_modules;$extra\node_modules"
node --check .\docs\reviews\cross-design-review-round4.repro.cjs
node .\docs\reviews\cross-design-review-round4.repro.cjs
```

依赖目录仍在且正文未变时，预期：`total:96, holds:96, violated:0, closedIssues:14, remainingIssues:0`。脚本完成后应检查 summary，不能仅以退出码判断全部不变量成立。本机真实 SSH 测试每次生成新密钥，指纹文本变化正常。

执行过：代码抽取、受控事件/驱动调用、真实 TS/Zod 类型检查、本机真实 SSH 握手与受控 forward channel，以及审计真实临时文件系统/受控 MySQL 的限定回归。

未执行：真实 MySQL 目标连接或建库事务、真实 TLS 握手、外部堡垒机/数据库端到端链路、真实 HTTP/浏览器 E2E、完整工程构建、历史 73 项全量测试。它们仍按既定实施验收计划推进，不应据此重新打开本轮已经修复的设计问题。

**收口建议：结束原 CR-01～CR-14 的文档整改循环。当前未发现需要继续保留的条目，后续进入既定实现与集成验收阶段。**
