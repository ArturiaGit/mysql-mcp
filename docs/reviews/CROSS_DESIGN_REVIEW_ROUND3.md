# 四份设计文档第三轮限定范围复核报告

- 日期：**2026-11-11（Asia/Shanghai）**。
- 依据：[第二轮综合复核报告](D:/E/PersonalProjects/mysql-mcp/docs/reviews/CROSS_DESIGN_REVIEW_ROUND2.md)，重点复核其未关闭的 CR-02、CR-03、CR-04、CR-05、CR-06、CR-11、CR-14，并回归原来已关闭的 7 项。
- **结论：本轮新增关闭 5 项；累计 12 项关闭、2 项仍需整改（CR-04：P1；CR-11：P2）。原 CR-01～CR-14 的限定范围复核暂不通过。**
- 不新增独立问题编号，不扩展到新的评审类别。两项残留均来自本轮为修复原问题而新增/修改的直接调用链或接口映射。
- 本轮只新增报告、复核脚本和证据；未修改设计正文、生成分片或既有报告、脚本、证据。

## 一、结论摘要

本次修复有实质进展，不应继续沿用第二轮“7 项未关闭”的结论：

1. TLS helper 已成为连接池模块的显式运行时导出，维护通道和测试服务有相应导入，模块不再因缺失名称而失败。
2. SSH 完整信任元组变更已经触发凭据重录，且在解密、DNS 和驱动创建前拒绝请求。
3. 登出能够区分成功与未确认，普通 403 不再刷新重试；失败时使用专用警示跳转，设计文字规定登录页显示横幅。
4. 审计 Profile ID 已改 string；状态修复所需 ErrorCode 和用户不存在错误码已对齐。
5. UserProfile 的 department 可选性已对齐，真实 Zod 推断与 DTO 的 strict 相等检查也通过。

**还剩两处闭环缺口：**

- SSH 已不是空 Socket，但新增的临时隧道方法把驱动提供的 **hex SHA-256 摘要**与契约要求的 **`SHA256:<Base64>` 指纹**直接比较，正确的契约指纹也会被拒绝。本机真实 ssh2 客户端/服务端握手已复现。
- 密码策略 GET/PUT、设置入口和风险确认已补齐，但新 GET 映射声明的 `PasswordPolicyDTO` 使用 `/me` 风格字段，与契约 GET 响应不一致，不能作为该接口的直接响应类型。

## 二、当前受评基线与保护范围

四份正文仍沿用原版本号，因此以内容哈希区分实际修订。本轮架构正文和接口契约正文未改变，前后端正文已改变。

| 文档 | 标注版本 | 字节数 | 行数 | 相对第二轮 |
| --- | --- | ---: | ---: | --- |
| ARCHITECTURE_SPEC.md | v1.2.1 | 109,312 | 1,586 | 未变 |
| FRONTEND_ARCHITECTURE_SPEC.md | v1.4.0 | 101,649 | 1,285 | 已变 |
| BACKEND_ARCHITECTURE_SPEC.md | v1.7.0 | 245,762 | 5,430 | 已变 |
| API_CONTRACT_SPEC.md | v1.5.0 | 153,253 | 2,504 | 未变 |

SHA-256：

- 架构：`d37e4ba71d70168889e9c6a4a3b3c6a66be9013c66672af02cd7e86bb3fbf760`
- 前端：`56983c9b3b1cac5990fbfff4913f5a98b89909030f123019a45edd65fe07f83b`
- 后端：`31783faa36aa69dc6b026dedf2a9a2b1aa8b4df19fcbf0ed307d5e736d4db888`
- 契约：`41ae7363c002f8f0d696bef8bdee9d2a8bb2088a48eba5c8a4001d7eb64e1965`

只读核对四个 combine 脚本声明的分片：架构 8、前端 11、后端 11、契约 10，按其拼接规则生成的文本均与当前正文一致。没有执行会覆盖正文的 combine 脚本。独立复核脚本前后核对四份正文、上一轮综合评审文件及原生成分片的哈希，均未被复核脚本修改。

## 三、14 项复核台账

“关闭”指原设计问题在本轮验证范围内已消除，不等于相应功能已经通过完整产品集成验收。

| 编号 | 原级别 | 第二轮状态 | 本轮状态 | 判定依据 |
| --- | --- | --- | --- | --- |
| CR-01 | P1 | 关闭 | **保持关闭** | 原重复列和原点名缺失列检查通过 |
| CR-02 | P1 | 保留 | **关闭** | 公共 helper 显式导出/导入，池与维护模块独立执行通过，三种 TLS 映射通过 |
| CR-03 | P1 | 保留 | **关闭** | 八组 host/TLS/SSH 变更反例均在解密、DNS、建连前拒绝；未变配置正对照通过 |
| CR-04 | P1 | 保留 | **部分修复，保留** | 真实转发路径、双目标校验和凭据解密已补，但正确契约指纹因编码不一致被拒绝 |
| CR-05 | P1 | 保留 | **关闭** | 成功、陈旧 CSRF、普通 403、500、网络异常路径符合原闭环要求 |
| CR-06 | P1 | 保留 | **关闭** | AuditRecordDTO.profile_id 已为 string，原 ID 与数组检查通过 |
| CR-07 | P1 | 关闭 | **保持关闭** | 原请求字段命名检查通过 |
| CR-08 | P1 | 关闭 | **保持关闭** | table_pattern/rule_type、黑白名单与字符串 ID 检查通过 |
| CR-09 | P1 | 关闭 | **保持关闭** | profile_traffic 仍为数组 |
| CR-10 | P1 | 关闭 | **保持关闭** | 用户状态/角色更新请求均保留 version |
| CR-11 | P2 | 保留 | **部分修复，保留** | Schema/DTO、到期守卫、设置入口和确认已修复；新密码策略 GET DTO 与契约不符 |
| CR-12 | P2 | 关闭 | **保持关闭** | 原角色/自操作两组 REST 错误码保持统一 |
| CR-13 | P2 | 关闭 | **保持关闭** | 类型包与运行时 helper 边界保持正确 |
| CR-14 | P1 | 保留 | **关闭** | 禁止与合法转换通过，实际 ErrorCode/AppError/UserService strict 检查零诊断，NOT_FOUND 对齐 |

## 四、仍需整改的 2 项

### CR-04 [P1] 已接通真实 SSH 实现，但指纹编码比较不符合接口契约

**直接位置：** 新临时隧道方法 [后端 L4111–4185](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L4111)，其中 [L4158–4159](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L4158)；测试服务调用 [L4467–4478](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L4467)。契约指纹格式 [L1499](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L1499)，示例 [L1520](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L1520)。

#### 已修好的部分

- 已删除 `new net.Socket()` 占位逻辑，测试服务注入 SshTunnelManager，调用 `openEphemeralTunnelStream()`，将其返回通道交给 MySQL 流工厂。
- 新方法先校验数据库目标与堡垒机地址，将校验后的 IP 用于 `forwardOut` 和 SSH connect。
- 已存 SSH 私钥使用 `private_key_encrypted` 并交给 keyring 解密；新建/草稿使用新私钥。
- 缺指纹、错误指纹、堡垒机/目标 SSRF 拒绝及未注入 manager 均 Fail-Closed；forward、MySQL connect/ping 失败的相应收尾对照通过。

因此，本轮**不再认定“SSH 仍只有空 Socket”**。

#### 残留与影响

新增方法配置：

```typescript
hostHash: 'sha256',
hostVerifier: (hashedKey: string): boolean => hashedKey === expectedFingerprint,
```

本轮安装在工作区外的 `ssh2@1.17.0` 官方包 README 的 `hostHash/hostVerifier` 说明，以及 `lib/client.js:283` 的实际实现均确认：设置 `hostHash` 后，传给回调的是 `createHash(hashAlgo).update(key).digest('hex')`。

契约的 `ssh_host_fingerprint_sha256` 则要求 `SHA256:...` 格式；真实有效输入为带 `SHA256:` 前缀的 Base64 指纹。**同一个主机密钥的 hex 文本不等于其 OpenSSH 指纹文本**。这里没有转换或统一解析，正确指纹也必然被比较为 false。

结果不是“指纹被绕过”，而是**Fail-Closed 错误拒绝合法连接**：新建、已存、草稿三模式都会在握手验证阶段失败，根本到不了 MySQL 连接创建。

#### 独立证据

| 观察 | 结果 |
| --- | --- |
| 新建模式，正确的 `SHA256:<Base64>` 指纹 | 被拒绝；无 forward、MySQL 创建次数 0 |
| 已存模式，正确的相同格式指纹 | DB 与 SSH 密文按预期解密，但随后被拒绝；MySQL 创建次数 0 |
| 草稿模式，正确的相同格式指纹 | 被拒绝；MySQL 创建次数 0 |
| 三模式改传裸 hex 的诊断对照 | 转发、固定目标、MySQL 流工厂调用与 tunnel close 均通过 |
| **真实 loopback ssh2 握手，同一主机密钥的正确 OpenSSH 指纹** | `Host denied (verification failed)`，没有返回通道 |
| **同一密钥、同一服务端，改传裸 hex 的真实诊断对照** | 完成 SSH 公钥认证，服务端接受 forward channel，返回真实 Channel |

裸 hex 只用于定位错误，**不是符合当前契约的成功案例，也不是要求前端偷偷改变字段格式的整改建议**。

真实测试使用本机临时端口、运行时生成的 Ed25519 主机/用户密钥和实际 ssh2 客户端/服务端。服务端只接受受控的 forward channel，没有连接真实数据库；此结果证明 SSH 握手和编码问题，不证明 MySQL-over-SSH 集成可用。密钥未写入证据文件。

#### 关闭条件

1. 统一驱动摘要与契约指纹的解析/编码，例如将合法 hex 摘要转为 `SHA256:<Base64无填充>` 再比较，或从原始主机密钥生成同格式指纹。
2. 保持缺失、格式错误和不匹配时拒绝；不要删除 hostVerifier 或改为恒 true。
3. 重跑新建/已存/草稿的正确契约指纹场景及错误指纹反例；正确指纹应进入 forward，错误指纹不得创建 MySQL 连接。
4. 用同一密钥的真实 loopback 正反对照验证。后端原缓存式 SSH 分支 [L4089–4092](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L4089)也有相同文本比较，宜复用同一个规范化函数避免测试与生产漂移；本轮不另立新问题或重开其他历史条目。

### CR-11 [P2] 密码策略入口已补，但 GET 响应 DTO 仍未对齐契约

**位置：** 前端 GET 映射 [L908](D:/E/PersonalProjects/mysql-mcp/docs/FRONTEND_ARCHITECTURE_SPEC.md#L908)、新增 DTO [L968–974](D:/E/PersonalProjects/mysql-mcp/docs/FRONTEND_ARCHITECTURE_SPEC.md#L968)；契约 GET 响应 [L936–952](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L936)。

#### 已修好的部分

- department 在 Schema 与 DTO 中均为必填且可空，真实 Zod 3.25.76 推断类型与 UserProfileDTO strict 相等检查零诊断。
- 自然到期守卫仍正确。
- GET/PUT 映射、个人设置入口与关闭轮换的显式风险确认已加入，见 [前端 L595](D:/E/PersonalProjects/mysql-mcp/docs/FRONTEND_ARCHITECTURE_SPEC.md#L595)。

因此不再要求重复修这些已通过的部分。

#### 残留与影响

新路由表把 `GET /api/v1/auth/password-policy` 的响应类型直接定义为 `PasswordPolicyDTO`：

```typescript
export interface PasswordPolicyDTO {
  password_updated_at: string;
  password_expires_days: number | null;
  password_expires_at: string | null;
  is_password_expired: boolean;
}
```

但契约实际响应为：

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

这不只是 camelCase/snake_case 差异：`password_updated_at` 在 GET 响应中根本不存在；`isExpired` 与 DTO 的 `is_password_expired` 也没有已定义的转换，启用状态、剩余天数和上下限均未体现在该响应类型中。当前前端文档未定义这个端点的显式适配器。

按新增 DTO 直接消费契约响应，所有四个必填字段都会缺失；表面有 GET 入口，实际仍无法按该类型可靠显示策略状态。将契约 JSON 原样赋给当前 DTO，真实 TS strict 检查报 **TS2353**（`passwordExpiresDays` 不是已知属性）。

这是**修复原 CR-11 时新引入的响应映射错误**，仍归原问题，不增加编号。

#### 关闭条件

- 按契约定义专门的 wire response DTO：`passwordExpiresDays/passwordExpiresAt/isExpirationEnabled/daysRemaining/isExpired/minDays/maxDays`，保持类型和空值语义一致；或明确给出并验证从 wire response 到独立 ViewModel 的适配器。
- 不得将契约没有的 `password_updated_at` 当作接口必填响应字段。
- 用当前契约 JSON 及关闭轮换的 null/-1 语义做解析/类型对照；保留已有设置入口、风险确认和 UserProfile 类型检查。
- PUT 当前列出的字段是契约响应的有效子集，本轮不因省略未消费字段另开问题。

## 五、本轮新增关闭的 5 项

| 条目 | 位置与关闭依据 |
| --- | --- |
| CR-02 | [后端 L3000](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L3000) 导出 mapper，[L3447](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L3447) 维护模块导入，[L4308](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L4308) 测试服务导入。独立模块构造/调用到达驱动工厂；TLS 关闭、系统 CA、私有 CA 的实际选项检查通过。未做真实 TLS 握手。 |
| CR-03 | [后端 L4383–4408](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L4383)。完整 SSH 元组参与比较，四个 SSH 字段单独修改均在解密/DNS/驱动前拒绝，原 host/TLS/开关反例与未变配置对照通过。本项不再因 CR-04 握手错误而误判。 |
| CR-05 | [前端 L478–531](D:/E/PersonalProjects/mysql-mcp/docs/FRONTEND_ARCHITECTURE_SPEC.md#L478)。仅 ERR_CSRF_INVALID 刷新一次；普通权限 403 无刷新且仅一次 POST。500/网络失败跳 `/login?warning=session_unconfirmed`，成功跳 `/login`。LoginView 横幅有明确设计要求；本轮未执行浏览器，不声称已视觉验收。 |
| CR-06 | [前端 L977–983](D:/E/PersonalProjects/mysql-mcp/docs/FRONTEND_ARCHITECTURE_SPEC.md#L977)。AuditRecordDTO.profile_id 为 string，全局通配说明为 `"0"`，原实体 ID 与关联数组检查通过。 |
| CR-14 | [后端 L986–1001](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L986)，ErrorCode [L514–515](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L514)。四种禁止转换无写入/成功审计/失效标记，两种合法转换通过；UserService 联同实际 ErrorCode/AppError 的 strict 语义检查零诊断，用户不存在使用契约 ERR_NOT_FOUND。 |

原已关闭的 CR-01/07/08/09/10/12/13 均通过限定回归，不重新打开，也不因两项残留要求继续整改这些已关闭条目。

## 六、验证方法、计数与旧探针适配

### 6.1 独立复核：63 项观察，58 项成立、5 项未成立

- 5 条失败观察是 CR-04 的三模式与真实正确指纹共 4 条，以及 CR-11 的响应映射 1 条，**不等于 5 个新缺陷**。
- 保留第二轮必要反例与对照，适配新增显式导入和构造参数：从原文连接池模块加载真实 TLS mapper；向测试服务注入原文 SshTunnelManager，而不是伪造缺失 helper 或用空流代替。
- SSH 受控客户端按实际 ssh2 的 hex 回调语义运行；额外使用同一真实主机密钥的本地握手对照验证，避免“字符串替身恰好相等”的假通过。
- 新增密码策略映射必须和原契约 JSON 相容，不能只搜到 GET/PUT 路径文字就认定完整对齐。
- Zod/TypeScript 类型检查使用真实包；不是用类型擦除后的 VM 执行声称编译成功。

### 6.2 第二轮旧脚本：原断言重跑为 39/46，不机械计入产品缺陷

旧脚本的测试服务依赖替身没有提供新导入的公共 TLS mapper，也没有传入新构造函数的 SSH manager。只把输出路径在内存中改到新证据文件、其余断言不变，重跑结果为 **39 项成立、7 项未成立**。

其中 TLS 三组与未变配置的失败是旧替身不能解析新导入所致，不能据此继续保留 CR-02/03；旧 SSH 观察也没有执行新增 manager。本轮正确适配调用方式后，CR-02/03 通过，并用真实 manager 和 ssh2 找到 CR-04 的实际残留。原脚本内嵌日期仍是 2026-11-10，重跑附加元数据明确执行日期为 2026-11-11。

旧脚本还会把只检查路径存在的 CR-11 判为关闭，本轮直接检查新增响应类型，避免漏掉修复引入的不一致。旧脚本、旧证据均未被覆盖。

### 6.3 历史审计/limiter 限定回归：4/4

现有后端第八轮脚本在当前正文上重跑到独立新证据文件：两条封存交错无事件丢失、独立封存重放对照通过，limiter strict 检查零诊断。BE-R7-01/02 保持关闭。

未重跑历史 73 项全量基线，也不以页首 73/73 声明替代本轮执行。

## 七、交付与复跑

本轮新增：

- [本报告](D:/E/PersonalProjects/mysql-mcp/docs/reviews/CROSS_DESIGN_REVIEW_ROUND3.md)
- [独立复核脚本](D:/E/PersonalProjects/mysql-mcp/docs/reviews/cross-design-review-round3.repro.cjs)
- [独立完整证据](D:/E/PersonalProjects/mysql-mcp/docs/reviews/cross-design-review-round3.evidence.json)
- [第二轮旧脚本重跑新证据](D:/E/PersonalProjects/mysql-mcp/docs/reviews/cross-design-review-round3.legacy.evidence.json)
- [历史限定回归新证据](D:/E/PersonalProjects/mysql-mcp/docs/reviews/cross-design-review-round3.regression.evidence.json)

环境：Node 24.16.0、TypeScript 5.9.3、mysql2 3.24.6、Node types 26.6.6；本轮在工作区外临时目录另装 ssh2 1.17.0 与 Zod 3.25.76，不改工程依赖与锁文件。新增包以 `--ignore-scripts` 安装，未运行依赖安装脚本。

```powershell
Set-Location 'D:\E\PersonalProjects\mysql-mcp'
$tmp = Join-Path $env:TEMP 'mysql-mcp-design-review-20261108'
$extra = Join-Path $env:TEMP 'mysql-mcp-cross-review-20261111'
$env:NODE_PATH = "$tmp\node_modules;$tmp\r3-extra\node_modules;$extra\node_modules"
node --check .\docs\reviews\cross-design-review-round3.repro.cjs
node .\docs\reviews\cross-design-review-round3.repro.cjs
```

依赖目录仍在且受评正文不变时，预期：`total:63, holds:58, violated:5, closedIssues:12, remainingIssues:2`。脚本退出码 0 表示完成证据收集，不表示评审全部通过。真实 loopback 对照每次生成新密钥，指纹文本变化是正常的。

**执行边界：** 执行了本机真实 SSH 协议握手和受控 forward channel，但没有连接真实 MySQL/SSH 目标服务，没有真实 TLS 握手、真实 HTTP/浏览器 E2E、完整工程构建或历史 73 项全量测试。既有集成验收门禁保持不变，不作为本轮额外新问题。

**后续只需修复 CR-04 的指纹编码和 CR-11 的 GET 响应类型，并重跑相应正反例与必要回归；无需重新整改已关闭的 12 项。**
