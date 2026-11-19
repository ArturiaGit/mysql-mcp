# API 接口契约第五轮限定范围复审报告

- 日期：2026-11-09（Asia/Shanghai）。
- 基线：[第四轮复审报告](D:/E/PersonalProjects/mysql-mcp/docs/reviews/API_CONTRACT_REVIEW_ROUND4.md)的文字结论。
- 范围：仅 API-R1-03 最后一处残余——密码策略 GET 专属 L3 豁免，不能连带豁免同路径 PUT。不重新打开 API-R1-05 或其他已关闭项，不扩展到整个认证模块。
- 当前 [API 契约](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md)：140,023 字节；SHA-256 `268FCC0BE8869962300EF98971B25355BDE9ADC0BE3864681AA6A2EABE112EBE`。
- 当前直接依赖 [后端设计](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md)：231,349 字节；SHA-256 `182C1149CB230A5B6E9143C4248E0A59FB276B8E426B9D3A62D553440D7C1C7D`。

**结论：本轮修正合理，API-R1-03 可在文档层面关闭。本轮限定范围内没有剩余阻断项；此前关闭项沿用原结论，本轮未重新验证。**

## 一、修正内容核对

1. [API L472–477](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L472) 已明确只有 `GET /api/v1/auth/password-policy` 享有该项豁免，并明确禁止豁免 PUT。
2. [后端 PUBLIC_PATHS L1307–1311](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L1307) 不包含密码策略路径，仍须先通过 L1 登录及 L2 状态检查。
3. [后端路径级 L3 白名单 L1319–1323](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L1319) 已移除密码策略路径，避免无差别豁免 GET / PUT。
4. [后端 L1376–1388](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L1376) 使用 `req.method === 'GET' && routePath === '/api/v1/auth/password-policy'` 单独判断该豁免。过期或强制改密时，同路径 PUT 不满足条件，抛 `403 ERR_MUST_CHANGE_PASSWORD`。

上述修正与 [GET 端点 L948–950](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L948)、[PUT 端点 L968–970](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L968) 的守卫分层一致，满足上一轮要求，无需继续修改这一处设计。

## 二、隔离执行验证

从当前后端 §5.5 抽取原始 `fourTierSecurityGuard`，仅移除 import/export、擦除 TypeScript 类型，提供 AppError 替身并固定 Date.now；不修改守卫控制流。

固定时间为 `2026-11-09T00:00:00.000Z`。自然过期账号密码时间为 `2026-01-01`、有效期 90 天；未过期账号密码时间为 `2026-11-08`。强制改密账号使用未过期密码并设置 must_change_password=true。

| 场景 | 请求（省略 /api/v1 前缀） | 守卫实际结果 | 是否符合预期 |
| --- | --- | --- | --- |
| ACTIVE、自然过期 | GET /auth/password-policy | 放行 | 是 |
| ACTIVE、自然过期 | PUT /auth/password-policy | 403 ERR_MUST_CHANGE_PASSWORD | 是 |
| ACTIVE、强制改密 | GET /auth/password-policy | 放行 | 是 |
| ACTIVE、强制改密 | PUT /auth/password-policy | 403 ERR_MUST_CHANGE_PASSWORD | 是 |
| 匿名 | GET /auth/password-policy | 401 ERR_AUTH_UNAUTHORIZED | 是 |
| PENDING | GET /auth/password-policy | 403 ERR_AUTH_ACCOUNT_PENDING | 是 |
| ACTIVE、未过期且无需强制改密 | PUT /auth/password-policy | 放行 | 是 |
| ACTIVE、自然过期 | GET /pats | 403 ERR_MUST_CHANGE_PASSWORD | 是 |
| ACTIVE、自然过期 | POST /auth/change-password | 放行 | 是 |

九项观察均符合预期。第四轮的两个 PUT 反例已消除，同时没有把读取、正常策略更新或改密入口错误封住。该数字是守卫场景观察数，不是九个独立评审问题，也不是全系统测试通过率。

## 三、产物与证据边界

- [复现脚本](D:/E/PersonalProjects/mysql-mcp/docs/reviews/api-contract-review-round5.repro.cjs)。
- [本轮证据 JSON](D:/E/PersonalProjects/mysql-mcp/docs/reviews/api-contract-review-round5.evidence.json)。
- PUT 探针附带 `{passwordExpiresDays: null}`，但只执行守卫，没有运行 Handler、CSRF 中间件或真实 HTTP/Fastify 服务，没有连接或修改 MySQL。
- 未运行全仓构建、TypeScript 语义检查或浏览器集成；本轮关闭属于文档及所给守卫函数层面的闭环，不代表真实部署已经通过端到端验收。
- 本轮仅新增第五轮报告、脚本和证据，没有修改原规范或前四轮评审产物。脚本运行前后核对了受评源文件和既有评审文件哈希。
- 此前已关闭的改密时间刷新、迁移、CAS 及其他项不在本轮重测范围内。

```powershell
node D:\E\PersonalProjects\mysql-mcp\docs\reviews\api-contract-review-round5.repro.cjs
```

脚本仅覆盖第五轮 evidence JSON。评审关闭结论不等同于实际服务的集成测试证明。

**本轮无需再提出修改要求，也无需为已关闭项启动新一轮评审。**
