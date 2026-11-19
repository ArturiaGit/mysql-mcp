# API 接口契约第三轮限定范围复审报告

- 日期：2026-11-09（Asia/Shanghai）。
- 依据：[第二轮复审报告](D:/E/PersonalProjects/mysql-mcp/docs/reviews/API_CONTRACT_REVIEW_ROUND2.md)。
- 范围：仅 API-R1-02、03、04、05、12 五项残余；不重新打开此前已关闭的七项，不新增问题编号或问题类别。
- 对象：[API_CONTRACT_SPEC.md](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md)，页首仍标 v1.1.0，139,778 字节，2,384 行。
- 对象 SHA-256：`4C0A252DD53C288013FC128ECB29F6E1A4849ECA60845CAB145E5B2D3E74B98D`。
- 直接依赖：[后端设计](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md)，230,184 字节，5,176 行；SHA-256：`A0A719F55C2F97F6790A119E26B0275B302D015349C341BB2C574A51D193525C`。

**结论：本轮修改方向合理，五项中三项实质问题可在文档层面关闭；两项仍部分未解决：API-R1-03（P1）和 API-R1-05（P2）。尚不支持全部闭环。**

## 一、逐项复核

| 原编号 | 本轮判定 | 已确认的修改 | 剩余情况 |
| --- | --- | --- | --- |
| API-R1-02 | 实质问题关闭（文档层面） | TLS 主定义仅保留 enabled、ca_cert，移除关闭验真及主机名覆盖参数；示例同步移除相应字段。 | 页首修订摘要仍列旧字段，作为原项的摘要同步事项，不保留为 P1。 |
| API-R1-03 | 部分解决，保留 P1 | 迁移改为可空列→按 created_at 回填→收紧非空；后端已增加自然过期计算。 | 后端改密步骤仍缺更新时间；密码策略读取被放进 L0 公开名单，未实现仅豁免 L3。 |
| API-R1-04 | 实质存储条件问题关闭（文档层面） | 审批通过及驳回均改为匹配 SUBMIT/RESUBMIT；通过时同时条件更新 PENDING 用户并在失败时回滚。 | 页首仍写 action=PENDING，应同步摘要，不再以存储条件无法命中为由阻断。 |
| API-R1-05 | 部分解决，保留 P2 | 后端用户 DDL 与迁移均已增加 version。 | UserService 仍不接收提交版本，也不比较或递增编辑版本。 |
| API-R1-12 | 关闭（文档层面） | 不可变字段改变确定返回 400；缺省保留、可空字段清除、未知字段拒绝均有明确规则。 | 原来的“拒绝或忽略”及缺省歧义已解决，不要求改接口路径或换 Schema 工具。 |

以上是**五项评审判定**，不是五项集成测试。此前已关闭七项沿用上轮结论，本轮未重新验证。

## 二、尚未关闭的原问题

### API-R1-03（P1）：自然过期已有判定，但改密刷新和豁免层级仍不一致

#### 1. 原迁移回填问题已修复

[API L567–580](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L567) 已采用：

1. 增加允许 NULL 的 password_updated_at；
2. 对 NULL 行按 created_at 回填；
3. 再改成 NOT NULL 并设置默认值。

这已经解决上一轮“先建非空列、后用 IS NULL 回填”的矛盾。本轮不再保留该反例，也不追加新的迁移要求。此处为静态顺序核对，没有执行真实 MySQL DDL。

#### 2. 后端改密步骤仍没有刷新密码更新时间

API [L584–585](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L584) 要求改密时同事务更新 password_updated_at；但后端 [L1224–1225](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L1224) 仍只列出更新密码哈希、清除强制改密标记、增加 auth_version 与写审计。

同时，新增的后端自然过期计算 [L1349–1357](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L1349) 确实依赖 password_updated_at。若按该后端改密步骤实现，用户即使成功改密，下一次请求仍可能根据旧时间戳判定已过期。

**最小修改：** 将 password_updated_at 的刷新补入该同事务改密步骤，与 API 要求保持一致。不要求新增其他密码治理能力。

#### 3. 密码策略读取被加入公开名单，而不是只豁免 L3

[后端 L1287–1292](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L1287) 把 `/api/v1/auth/password-policy` 放入了 PUBLIC_PATHS；守卫 [L1312](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L1312) 在此集合命中后直接 return。

但 API [L948–950](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L948) 要求该 GET 端点是 **L2 ACTIVE，只豁免 L3**。当前写法不只是允许过期 ACTIVE 用户读取，还让该守卫跳过会话和账号状态校验。

为避免把“返回 ALLOW”误判成正确修复，本轮对同一个已给出的守卫执行了最小正反对照：

| 原问题对应场景 | 预期守卫结果 | 抽取守卫实际结果 | 判定 |
| --- | --- | --- | --- |
| ACTIVE、自然过期，访问普通业务 `/pats` | ERR_MUST_CHANGE_PASSWORD | ERR_MUST_CHANGE_PASSWORD | 一致 |
| ACTIVE、自然过期，访问改密端点 | 放行 | 放行 | 一致 |
| ACTIVE、自然过期，GET 密码策略 | 放行 | 放行 | 一致，但单独看此结果不足以证明修复正确 |
| 无 currentUser，GET 同一密码策略 | ERR_AUTH_UNAUTHORIZED | 放行 | 反例 |
| PENDING，GET 同一密码策略 | ERR_AUTH_ACCOUNT_PENDING | 放行 | 反例 |

**最小修改：** 从 PUBLIC_PATHS 移除该路径；按请求方法或路由元数据，仅让 GET 密码策略豁免 L3，保留 L1/L2 校验。不能简单地把同路径的 PUT 也一起豁免。

这只是在复核上一轮 API-R1-03 已要求的“保留必要端点放行”的修复位置和约束，不重新审计整个认证模块，也不另开 API-R1-09。

**证据边界：** 上表执行的是文档代码块中的守卫函数，不是实际 HTTP 请求。它证明该守卫的校验被绕过，不证明真实服务中的其他中间件或 Handler 也一定放行，更不声称已造成真实数据泄露。

### API-R1-05（P2）：增加 version 列之后，后端写入示例仍未使用它

**已修复的部分：**

- [后端 L587](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L587) 已有 version 列。
- [API 迁移 L569](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L569) 已补存量初始化默认值 1。

**原问题仍有残余：**

- [状态更新 L953–974](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L953) 的方法参数没有提交版本，SQL 仍只使用 `WHERE id=?`，没有编辑版本比较或 version 递增。
- [角色更新 L1001–1033](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L1001) 同样没有提交版本；角色绑定全量替换之后只增加 auth_version，没有编辑版本 CAS。

因此上一轮的存储列缺口已修复，但“两个管理员基于同一旧版本修改，只能一方成功”的要求仍没有进入后端示例。排他锁和 auth_version 不能代替客户端表单的版本前置条件。

**最小修改：** 在这两个方法中接收请求版本，在同事务中比较并递增 version；不匹配时回滚并返回 ERR_CONCURRENCY_CONFLICT。只修改这两个原有入口，不扩展到其他实体或删除策略。

此项仅做静态核对，没有执行真实并发数据库测试。

## 三、可关闭项的具体依据

### API-R1-02

[TlsConfig L208–212](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L208) 明确严格验真、身份绑定 host，且不再暴露 reject_unauthorized/server_name。结合上一轮已经确认的 SSH 指纹、TLS/隧道测试字段，原有实质问题可关闭。

页首 [L17](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L17) 仍列出已移除字段，应同步修订摘要。本轮不把摘要旧文案扩大为新的连接安全问题。

### API-R1-04

[通过 L1051–1056](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L1051) 与 [驳回 L1091–1095](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L1091) 已使用现有动作值 SUBMIT/RESUBMIT，原先要求不存在的 PENDING action 才能命中的存储条件问题已解决。通过还明确条件更新用户状态并检查影响行数。

因此本轮关闭上轮该项剩余的实质存储条件问题，不新增审批模型重构要求。页首 [L22](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L22) 的旧 PENDING 条件应同步到正文，不另计一个缺陷。

### API-R1-12

[Profile L1508–1509](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L1508) 与 [Role L1726–1728](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L1726) 已给出确定的不可变字段处理、增量合并、null 与未知字段规则。

虽然角色功能说明仍沿用“全量更新”字样，但后续明确的增量合并规则已经消除原来缺省字段的实际歧义，本轮不因此继续阻断。建议同步措辞，但不要求改成 PATCH，也不要求增加新文档。

## 四、执行与复现边界

- 静态核对只覆盖原五项残余及其直接依赖；正文与十个分片的拼接一致性仅用于确认受评对象。
- 对 API-R1-03 抽取后端 §5.5 的原始 TypeScript 代码块，移除 import/export、擦除类型，在内存中提供 AppError 替身和固定 Date.now；未替换守卫逻辑。
- 固定时间：2026-11-09T00:00:00.000Z；过期账号密码更新时间为 2026-01-01，有效期 90 天。
- 共执行五项守卫观察：三项符合预期，两项反例；不合并为本轮五个问题的通过率，也不沿用任何旧探针通过数。
- 未运行真实 Fastify 服务、MySQL、SSH、TLS 或浏览器集成；未执行全仓构建和 TypeScript 语义类型检查。
- 原规范、生成分片及前两轮报告/脚本/现有证据文件均未修改。

复现脚本：[api-contract-review-round3.repro.cjs](D:/E/PersonalProjects/mysql-mcp/docs/reviews/api-contract-review-round3.repro.cjs)。

证据：[api-contract-review-round3.evidence.json](D:/E/PersonalProjects/mysql-mcp/docs/reviews/api-contract-review-round3.evidence.json)。

```powershell
node D:\E\PersonalProjects\mysql-mcp\docs\reviews\api-contract-review-round3.repro.cjs
```

脚本仅覆盖本轮证据 JSON；其中各项关闭/保留状态属于评审记录，不是自动证明。

**下一轮只需复核 API-R1-03 的改密时间刷新及正确的 L3 豁免，以及 API-R1-05 的两个写入入口 CAS。无需重新打开其他实质已关闭项。**
