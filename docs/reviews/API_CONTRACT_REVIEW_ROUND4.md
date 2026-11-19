# API 接口契约第四轮限定范围复审报告

- 日期：2026-11-09（Asia/Shanghai）。
- 基线：[第三轮复审报告](D:/E/PersonalProjects/mysql-mcp/docs/reviews/API_CONTRACT_REVIEW_ROUND3.md)。以报告文字为历史基线，不把可能被重跑覆盖的旧 evidence JSON 当作历史源文件快照。
- 范围：仅 API-R1-03 的改密时间刷新及 GET 专属 L3 豁免，以及 API-R1-05 的两个写入入口 CAS。不重新打开已关闭项，不审计整个认证模块，不新增问题编号。
- 当前 [API 契约](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md)：139,827 字节；SHA-256 `6E92754621C47E82278099E6EE0B1E6CCBCED4B7569C47CEE9E8ABCC92872DDD`。
- 当前直接依赖 [后端设计](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md)：231,009 字节；SHA-256 `35A6235E07EF3B3BF8253C5DDF1F71249EB7E4E1C8F249390880E2C5A2B327E4`。

**结论：修改基本合理，但仍不能全部关闭。API-R1-05 可在文档层面关闭；API-R1-03 只剩“同路径 PUT 被一并豁免 L3”这一处原有残余，保留 P1。**

## 一、限定范围复核结果

| 原编号 / 残余 | 本轮结果 | 依据 |
| --- | --- | --- |
| API-R1-03：改密刷新时间 | 已解决 | 后端同事务改密步骤已明确更新 password_updated_at = NOW()。 |
| API-R1-03：GET 密码策略保留 L1/L2 | 已解决 | 密码策略已移出 PUBLIC_PATHS；匿名及 PENDING 请求均被相应守卫拒绝，过期 ACTIVE 用户的 GET 仍可放行。 |
| API-R1-03：不能连带豁免 PUT | 未解决，保留 P1 | 改为 L3 白名单后仍只比较 routePath，GET 与 PUT 共享路径，二者均提前放行。 |
| API-R1-05：状态与角色写入 CAS | 文档层面关闭 | 两方法均接收 expectedVersion，以 id + version 条件更新并递增 version，零影响行抛 409；外层事务负责回滚。 |

此前关闭项及 API-R1-03 的迁移等已解决部分沿用上轮结论，不在本轮重新验证。

## 二、唯一剩余问题：API-R1-03（P1）

### 密码策略的 L3 豁免仍未区分 GET / PUT

**位置：** [后端 L1307–1312](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L1307) 与 [L1377–1385](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L1377)。

本轮已正确地从公开名单移除 `/api/v1/auth/password-policy`，但又把它直接加入 `MUST_CHANGE_PWD_ALLOWED_PATHS`。L3 命中后仅按路径检查集合，没有判断请求方法，随后 return。

契约对两种方法的要求并不相同：

- [API L948–950](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L948)：GET 只要求 L2，允许过期 ACTIVE 用户读取策略。
- [API L968–980](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L968)：PUT 是 L4 端点，不属于先改密拦截的豁免；可以修改有效期，含传 null 关闭轮换。

因此，当前守卫不仅放行读取，还会放行过期或强制改密账号对同一路径的 PUT。若 Handler 按契约写入，该请求可先延长或关闭有效期，违背“先改密才能执行非豁免写操作”的原有约束。这里不是新增权限评审，而是第三轮已明确要求“仅 GET 豁免，不能一并豁免 PUT”的同一处修复遗漏。

### 对原守卫执行的最小正反对照

固定当前时间为 `2026-11-09T00:00:00.000Z`。自然过期账号的密码时间为 `2026-01-01`、有效期 90 天；未过期账号为 `2026-11-08`。强制改密对照使用未过期密码和 must_change_password=true。

| 场景 | 方法 / 路径 | 预期 | 抽取守卫实际结果 |
| --- | --- | --- | --- |
| ACTIVE、自然过期 | GET /pats | ERR_MUST_CHANGE_PASSWORD | 一致 |
| ACTIVE、自然过期 | POST /auth/change-password | 放行 | 一致 |
| ACTIVE、自然过期 | GET /auth/password-policy | 放行 | 一致 |
| 匿名 | GET /auth/password-policy | ERR_AUTH_UNAUTHORIZED | 一致 |
| PENDING | GET /auth/password-policy | ERR_AUTH_ACCOUNT_PENDING | 一致 |
| ACTIVE、自然过期 | PUT /auth/password-policy | ERR_MUST_CHANGE_PASSWORD | **放行，反例** |
| ACTIVE、强制改密 | PUT /auth/password-policy | ERR_MUST_CHANGE_PASSWORD | **放行，反例** |
| ACTIVE、未过期且无需强制改密 | PUT /auth/password-policy | 放行 | 一致 |

表中路径均省略公共前缀 `/api/v1`。PUT 探针附带 `{passwordExpiresDays: null}`，但只运行守卫，未执行 Handler，也没有修改数据库。

**最小修正：** 从路径集合移除 password-policy；另用 `req.method === 'GET' && routePath === '/api/v1/auth/password-policy'` 判断该端点的 L3 豁免，其余既有豁免不变。PUT 必须继续接受 L3 检查。无需新增接口、重构守卫或调整其他已关闭项。

## 三、已解决部分的确认

### API-R1-03：改密刷新及 L1/L2 已补齐

[后端 L1244–1245](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L1244) 已在同一个元数据库事务内补充 `password_updated_at = NOW()`，满足本轮对改密时间刷新的要求。这里属于文档步骤核对，没有实际执行改密 SQL。

[公开路径 L1320–1324](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L1320) 不再包含密码策略。匿名、PENDING、过期 ACTIVE 的 GET 正反对照均符合契约，不再保留第三轮“该路径直接跳过登录与账号状态检查”的问题。

### API-R1-05：两个入口 CAS 可关闭

- [状态更新 L953–983](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L953)：接收 expectedVersion；使用 `WHERE id = ? AND version = ?`，同条 UPDATE 递增 version；零影响行抛 `409 ERR_CONCURRENCY_CONFLICT`。
- [角色更新 L1010–1053](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L1010)：同样接收并比较版本，递增 version，冲突时抛 409。
- [事务包装 L844–859](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L844)：异常时 rollback；角色 DELETE/INSERT 虽位于 CAS 前，但在同一事务内，CAS 冲突会回滚前面的角色改动。不能仅因语句先后顺序再次判为未修复。

执行了四项隔离控制流探针：两个方法各测试匹配版本成功、旧版本冲突。匹配版本时变更及审计提交、版本递增一次；旧版本时抛 409、回滚，角色原值保持不变，且不触发提交后的失效/取消调用。四项均符合预期。

这些探针使用内存 SQL/事务替身，验证文档函数如何处理数据库返回值及事务边界；不是实际 MySQL 并发竞争、锁行为或持久化回滚的证明。结合静态 SQL 条件核对，足以关闭上一轮这两个示例缺少 CAS 的文档问题。

## 四、证据与边界

- [复现脚本](D:/E/PersonalProjects/mysql-mcp/docs/reviews/api-contract-review-round4.repro.cjs)。
- [本轮证据 JSON](D:/E/PersonalProjects/mysql-mcp/docs/reviews/api-contract-review-round4.evidence.json)。
- 原始守卫、UserService 和 withTransaction 均从当前后端文档代码块抽取；移除 import/export 并转换 TypeScript 语法，提供 AppError、时间及依赖替身，没有替换被评审函数的控制流。
- 守卫共八项观察：六项符合预期，两项为同一原问题的反例。CAS 共四项模拟观察：四项符合预期。这些数字不是“问题通过率”。
- 未运行真实 HTTP/Fastify、MySQL 或浏览器集成；未执行全仓构建或 TypeScript 语义检查，不声称真实服务已经发生策略写入或数据泄露。
- 本轮仅新增第四轮报告、脚本和证据；未修改原规范及前三轮评审文件。脚本运行前后还校验了受评文件及既有评审文件哈希。

```powershell
node D:\E\PersonalProjects\mysql-mcp\docs\reviews\api-contract-review-round4.repro.cjs
```

脚本仅覆盖第四轮 evidence JSON；关闭/保留判定是评审结论，不是自动证明。

**下一轮只需复核 API-R1-03：过期用户 GET 密码策略应放行，PUT 应被 L3 拒绝。API-R1-05 及其他已关闭项不需要重新打开。**
