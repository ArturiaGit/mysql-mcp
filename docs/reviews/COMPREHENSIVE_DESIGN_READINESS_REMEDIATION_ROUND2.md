# 综合开发准入评审：第二轮剩余问题整改记录

- 日期：2026-11-12（Asia/Shanghai）。
- 对应报告：`COMPREHENSIVE_DESIGN_READINESS_REVIEW_ROUND2.md`。
- 范围：唯一剩余技术问题 RR2-01（归属 RD-02）及关联查询回归；核对 RD-08 状态，不扩展为新一轮架构审计。
- 后端详细设计：v1.7.2 → **v1.7.3**；其余四份设计和物理SQL保持不变。

## 一、结论

**RR2-01 已在设计文档及可执行片段层面关闭，RD-02 的剩余审计查询消费者迁移已完成。RD-08 仍需责任人作出决定并提供签署证据。**

本次不宣称完整应用、真实 MySQL、HTTP 或浏览器验收通过；也不把这些实施验收倒置为开始开发的前提。原第二轮报告、反例脚本和历史证据保持原样；新增正向测试及独立证据，不将历史反例改写成放行测试。

## 二、查验与定点修复

原 §10.3 仅将导入改为 MetadataQueryExecutor，仍以 mysql2.Pool 为参数，并调用 pool.query<mysql2.RowDataPacket[]>，但未导入 mysql2。报告所述命名空间缺失与安全执行器不能赋给完整Pool的问题均成立；相对路径 ./metadata-pool 也不符合该Repository位于 apps/admin-api 的目录。

| 关闭条件 | 本次处理 | 验证 |
| --- | --- | --- |
| 消费者接收安全执行器 | queryAuditLogs 参数改为 queries: MetadataQueryExecutor，内部调用 queries.query<RowDataPacket[]> | 实际安全工厂的返回值可直接传入Repository及查询服务，strict零诊断 |
| 正确依赖与行类型 | RowDataPacket 从 mysql2/promise 独立导入；MetadataQueryExecutor 从 @mysql-mcp/core-engine 导入；§4.2补公共导出片段 | 四模块源片段按原目录展开，经真实mysql2类型声明和tsconfig路径解析编译；未用合并接口或类型断言掩盖错误 |
| 调用侧不退回原始Pool | §10.3补 createAuditQueryService，通过 runtimeCtx.metadataQueries 调用Repository；明确由 buildAdminServer 装配，沿用§1.2既有安全工厂入口 | 串联运行公共导出→工厂→查询服务→Repository；原始Pool.query设置为失败哨兵，不允许绕行 |
| 同步生成源 | 修改后端 part1_intro、part4_database_and_dal、part10_audit_and_stats，并重新combine | 正文与分片逐字规范化比较通过；生成契约 --check 通过 |
| UTC及错误释放串联 | 不改既有UTC连接池算法，验证真实消费者使用它的行为 | SET未完成不发SELECT；每次借连接重新SET；SQL失败释放；SET失败销毁、不回池、不SELECT |

保留精确回补查询的参数化SQL、query_instance_id.trim()、大ID字符串和响应结构。**普通分页分支仍是原有占位实现**，本轮没有将其扩展成完整查询功能，也不声称已补齐HTTP授权处理。文档明确要求原有守卫和调用者数据范围检查先于查询调用。

## 三、实际验证结果

运行环境和文件SHA-256见新证据；本次使用本机既有 Node.js 22.22.0、TypeScript 5.9.3、mysql2 3.24.6 依赖，不安装包、不连接数据库。

| 检查 | 结果 | 范围 |
| --- | --- | --- |
| 本轮定点正向测试 | **7/7组通过** | 跨模块类型、负向变异、真实消费者/执行器配受控连接、响应及生成源 |
| 跨模块strict | **0条诊断** | 元数据模块、公共导出、审计Repository、查询服务及实际工厂调用输入 |
| 负向类型控制 | 全部拒绝 | 未导入mysql2命名空间产生TS2503；只补类型导入又改回Pool产生TS2345；错误相对模块路径产生TS2307 |
| 上一轮正向整改测试 | **15/15通过** | 临时镜像内执行原脚本，完整新结果嵌入本轮证据，原历史证据未覆盖 |
| 数据库静态/顺序模型 | **1067项断言通过** | 14表、136列、45索引、7外键、47接口映射 |
| 静态检查器反向测试 | **3/3通过** | 原有单元测试 |
| 生成产物漂移 | **通过** | 后端正文与分片；生成请求类型、fixtures、47项接口追踪 |

串联测试还覆盖：空结果、连续两次借连接、参数值不拼接为SQL、业务异常保持原错误且只释放一次、借连接失败不使用连接。测试仅以受控连接响应替换MySQL，不把它称为数据库集成测试。

本轮按评审建议限定范围，未重新运行全部历史96项或其他后端历史套件；不将旧轮成绩列作本轮新增结果。

## 四、RD-08状态

| 待确认项 | 保留状态 | 责任角色 |
| --- | --- | --- |
| 全局burst默认 | 暂定新库10，旧15不自动覆盖；待批准 | 产品/安全 |
| 库级ACL范围 | 文本已统一v1.0精确名；范围确认与扩展另行裁决 | 安全/接口维护者 |
| USER/ROLE/GLOBAL语义 | 技术文本已对齐；仍保留“未签署前不冻结联调基线” | 接口维护者/产品 |
| DST日桶 | IANA自然日与固定1440分钟分母歧义待决 | 接口维护者 |
| daysRemaining | ceil、最小0、关闭为-1仍为建议，待明确接受 | 前后端/产品 |

本次未收到新的批准记录，不代替负责人签署，也不推断仓库外不存在批准。无需重开已关闭技术项；确认影响v1.0的决定后，可按原顺序冻结本轮设计基线并进入实施。

## 五、交付物与复核命令

- 后端修订：`../BACKEND_ARCHITECTURE_SPEC.md` §4.2、§10.3。
- 正向测试：`comprehensive-design-readiness-round2.remediation.test.cjs`。
- 当前证据：`comprehensive-design-readiness-round2.remediation.evidence.json`（含源文件哈希、诊断、事件顺序及本轮重跑结果）。

```powershell
node scripts/combine_be_spec.js
python scripts/generate_readiness_contracts.py --check
$deps = Join-Path $env:TEMP 'mysql-mcp-design-review-20261108'
$extra = Join-Path $env:TEMP 'mysql-mcp-cross-review-20261111'
$env:NODE_PATH = "$deps\node_modules;$deps\r3-extra\node_modules;$extra\node_modules"
$node = Join-Path $deps 'r2-node22\node_modules\node\bin\node.exe'
& $node docs/reviews/comprehensive-design-readiness-round2.remediation.test.cjs --regressions
```

带 --regressions 会把上一轮正向测试放到工作区外临时镜像执行，并将结果嵌入本轮新证据；不覆盖旧报告/旧证据。省略该参数仅执行本轮7组检查并重写本轮证据，因此归档应使用上述完整命令。

未执行：真实MySQL、HTTP、浏览器E2E、全工程构建、完整分页实现、生产迁移与恢复演练。
