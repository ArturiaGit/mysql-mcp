# 数据库设计第二轮限定范围复核报告

- 复核日期：2026-11-12（Asia/Shanghai）。
- 对象：数据库设计 v1.0.1、后端详细设计 v1.7.1、接口契约 v1.5.1、前端详细设计 v1.4.1。
- 基线：[第一轮报告](D:/E/PersonalProjects/mysql-mcp/docs/reviews/DATABASE_DESIGN_REVIEW.md)及其证据；参考[对方修复记录](D:/E/PersonalProjects/mysql-mcp/docs/reviews/DATABASE_DESIGN_REMEDIATION.md)，但不以该记录的“已修复”声明替代独立验证。
- 范围：DB-R1-01～04，以及这些修改直接涉及的配额合并、令牌桶、接口映射、生成源和既有专项回归。本轮不是重新审计所有数据库/架构设计。

## 一、结论

**本轮复核通过：上一轮 1 项 P1、3 项 P2 均可在文档与给定可执行片段层面关闭；本轮限定范围内未发现新的 P1/P2 问题。**

修复不只是改写说明：USER 配置已成对传入快照，突发容量真正进入令牌桶；API 与前端正式区分“保存的覆盖值”和“最终有效配额”；两处错误接口追踪映射也已修正，并加入能拒绝旧错误的语义检查。

但以下结论必须区分：

1. **本轮四项技术整改可以关闭。**没有必要因同一组已修复问题继续要求下一轮文字整改。
2. **DB-R1-02 的接口维护者/产品签署仍未完成。**数据库文档已明确列为门禁；本轮没有获得签署证据，不能代替产品批准或宣布联调基线已经冻结。
3. **真实应用与 MySQL 上线验收仍未完成。**片段执行不证明实际 Repository、HTTP、自动缓存失效和数据库并发已通过。
4. 原差异清单中的其他项目不因本轮通过自动关闭，尤其 DB-D02 的计数器示例同步、DB-D15 的锁点实现及原有迁移/运维门禁。

## 二、逐项复核

| 问题 | 本轮结果 | 关闭层级 | 仍待完成 |
| --- | --- | --- | --- |
| DB-R1-01 / P1：USER burst 未接线 | 已修复 | 数据映射契约、完整快照片段和实际令牌桶片段 | 真实 Repository 与提交后自动失效联调 |
| DB-R1-02 / P2：继承语义冲突 | 已修复 | 数据库/后端/API/前端文本与计算语义一致 | 接口维护者、产品签署及页面联调 |
| DB-R1-03 / P2：CSRF 被写成注销 | 已修复 | 追踪表与静态语义检查 | 实际 HTTP/浏览器无登出副作用测试 |
| DB-R1-04 / P2：用户限流映射错误 | 已修复 | 表映射、版本来源、禁止副作用和语义检查 | 真实事务/双连接并发验收 |

### 2.1 DB-R1-01：修复已覆盖 USER 行 → 快照 → 主体桶

当前[后端设计 L1573–1587](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L1573)新增 `UserRateLimitConfig` 和 `mapUserRateLimit`，将同一条 USER 规则的 `qpm_limit`、`burst_capacity` 成对映射；无行返回 null。

[快照输入 L1660](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L1660)已由单独的用户 QPM 参数改为完整 `userRateLimit`；[L1734](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L1734)维持 QPM 的 USER > ROLE > GLOBAL，而[L1755](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L1755)独立采用 USER > GLOBAL 的突发容量。GLOBAL 熔断参数没有被用户覆盖误替换。

本轮提取当前完整 TypeScript 代码块，仅进行类型擦除、移除模块导入/导出并提供依赖桩，以冻结时钟执行：

- USER burst=1 / GLOBAL=500：快照为1；同一时刻第1次请求成功，第2次触发 `ERR_RATE_LIMIT_USER`。
- USER burst=20 / GLOBAL=10：快照为20；同一时刻前20次成功，第21次触发主体限流。不是强行取 GLOBAL 或两者最小值。
- 独立边界网格覆盖 QPM=-1/1/30/10000、USER burst=1/20/500、GLOBAL burst=1/500，共24组组合；其中18组有限 QPM 实际验证了用尽容量后的拒绝行为。
- 同一个已有桶，从旧20容量切到新构造的1容量快照后，容量会收紧，不能继续消耗旧突发余额。
- -1 仍只豁免主体限流，Profile 桶继续生效；角色最大值、无角色拒绝、字符串大整数 ID 均保持。

另外做了两项内存反向控制：临时恢复“只取 GLOBAL”的赋值、临时丢弃 Mapper 的 burst 字段，均重现错误的500，说明检查能识别原缺陷，而不只是对当前输出作无效断言。这些控制没有写回文档，也不计作新发现。

**保留边界：**更新用例由测试显式构造新快照，没有模拟真实 Repository 提交及自动失效消息。因此只能证明“收到新配置后能正确执行”，不能证明生产链路会自动收到新配置。[数据库设计 L1153](D:/E/PersonalProjects/mysql-mcp/docs/DATABASE_DESIGN_SPEC.md#L1153)已准确保留该联调门禁。

### 2.2 DB-R1-02：外部契约已显式修订，未偷偷更改角色优先算法

- [接口契约 L2013–2015](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L2013)明确配置 GET 返回保存的覆盖值，继承态仍为 0/null；有效 QPM 与 burst 分别按两套优先级计算。
- [接口契约 L2092](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L2092)已删除“后续全局 QPM 必然联动”的错误承诺，明确移除覆盖后恢复角色 QPM 与 GLOBAL burst。
- [前端设计 L754–756](D:/E/PersonalProjects/mysql-mcp/docs/FRONTEND_ARCHITECTURE_SPEC.md#L754)同步修改提示、删除确认文案、大盘有效值来源及保存后的重新拉取行为。
- [数据库设计 L68–69](D:/E/PersonalProjects/mysql-mcp/docs/DATABASE_DESIGN_SPEC.md#L68)新增 DB-D17/18 跟踪，不再只在算法段落解释冲突。

独立验证角色 QPM=60、无 USER 覆盖时，GLOBAL QPM 100→20，实际结果60→60；此结果现在与 API/前端声明一致。GLOBAL burst 500→10 则确实影响无覆盖用户，两种字段没有再混为同一套“继承”。

**技术冲突关闭，业务批准不代签。**[数据库设计 L1154](D:/E/PersonalProjects/mysql-mcp/docs/DATABASE_DESIGN_SPEC.md#L1154)明确写出未签署前不冻结联调基线。本轮认可该边界，而不是把“写了待签署”认定为产品已经批准。

### 2.3 DB-R1-03：CSRF 行已改为无登出副作用

[数据库设计 L1008](D:/E/PersonalProjects/mysql-mcp/docs/DATABASE_DESIGN_SPEC.md#L1008)现在明确：按需建立/复用 seed、返回 token，不注销 Session、不撤销授权上下文、不写业务库。logout 仍保留正确注销语义。

新增检查不仅验证“不注销”文字存在，还排除剩余正向注销/失效描述；原错误行和定向变异均会被拒绝。未发现将获取 Token 与 logout 再次混淆的残余。

### 2.4 DB-R1-04：三个 USER 接口已分别描述，不再套用用户管理模板

[数据库设计 L1045–1047](D:/E/PersonalProjects/mysql-mcp/docs/DATABASE_DESIGN_SPEC.md#L1045)现在分别明确：

- GET：users + USER rate_limits，只读当前覆盖；无行返回0/null，不拿历史 counter 充当当前 revision。
- PUT：规则、计数器、管理审计按 §7.5 同事务处理；以 USER revision CAS，而非 `sys_users.version`。
- DELETE：仅删 USER 规则，保留 counter/PAT，不重置用户版本；提交后重新加载 QPM/burst。

[校验器 L91 起](D:/E/PersonalProjects/mysql-mcp/scripts/validate_database_design.py#L91)新增按 HTTP 方法区分的表集合、版本语义、禁止副作用检查，并在主校验流程实际调用。对应[变异测试](D:/E/PersonalProjects/mysql-mcp/scripts/test_validate_database_design.py)覆盖4条旧错误行和13个定向变异，而不是只统计路由是否存在。

## 三、本轮实际重跑结果

| 验证 | 实际结果 | 说明 |
| --- | --- | --- |
| 数据库静态/顺序模型校验 | 1067 次断言通过 | 14表、136字段、45索引、7外键、47路由、3段JSON；不是1067个独立集成场景 |
| 语义校验器测试 | 3个测试方法通过 | 当前正确矩阵通过；4条旧错误及13个定向变异被拒绝 |
| 对方修复测试重新执行 | 15/15 | 包含 TypeScript 5.9.3 strict/noEmit 片段检查，零诊断；不是全项目构建 |
| 本轮独立验证 | 7/7组通过 | 含24组配额组合、18组实际桶边界、生命周期、契约映射和2个反向控制；不与其他套件简单相加为独立业务用例总数 |
| 既有跨设计第四轮回归 | 96/96 | 直接重跑原断言；含本机 SSH 回环，无外部 SSH/数据库 |
| 既有后端第八轮专项 | 4/4 | 审计重放/熔断专项；不是完整历史73项套件 |
| 生成片段与成稿 | 一致性检查通过 | 后端、前端、API拼装一致；相关限流契约生成器也核对了修订文本 |
| 源文件/历史证据保护 | 155份受保护文件哈希不变 | 本轮未改设计、DDL、生成源、原校验器、对方测试或历史证据 |

系统架构和物理 DDL 的哈希还与第一轮基线相同，符合此次修复只需调整跨层契约/片段、无需物理数据库迁移的范围。

重跑既有测试时，仅将输出证据路径指向本轮新文件；没有修改测试输入、断言或并发调度。完整 hash、观察值和执行边界见本轮证据。

## 四、产物及复现

- [本轮独立复核脚本](D:/E/PersonalProjects/mysql-mcp/docs/reviews/database-design-review-round2.repro.cjs)
- [本轮主证据](D:/E/PersonalProjects/mysql-mcp/docs/reviews/database-design-review-round2.evidence.json)
- [对方修复测试重跑证据](D:/E/PersonalProjects/mysql-mcp/docs/reviews/database-design-review-round2.remediation.evidence.json)
- [跨设计回归重跑证据](D:/E/PersonalProjects/mysql-mcp/docs/reviews/database-design-review-round2.cross-regression.evidence.json)
- [后端专项重跑证据](D:/E/PersonalProjects/mysql-mcp/docs/reviews/database-design-review-round2.backend-regression.evidence.json)

无第三方依赖的基础复核（运行时需支持当前脚本使用的 Node 类型擦除 API）：

```powershell
node D:\E\PersonalProjects\mysql-mcp\docs\reviews\database-design-review-round2.repro.cjs
```

本次实际使用已存在的历史评审依赖执行完整复核，未安装新包：

```powershell
$env:NODE_PATH = "$env:TEMP\mysql-mcp-design-review-20261108\node_modules;$env:TEMP\mysql-mcp-cross-review-20261111\node_modules"
node D:\E\PersonalProjects\mysql-mcp\docs\reviews\database-design-review-round2.repro.cjs --typecheck --historical
```

本轮主证据日期为2026-11-12；历史脚本输出自身保留原评审日期字段，其本轮重跑身份以新文件名和主证据的 suites 记录为准。不要把原脚本内的日期当成本轮执行日期。

## 五、验收边界与下一步

未执行真实 MySQL DDL、mysql2 实际 Repository 读写、数据库双连接并发、真实 HTTP/浏览器、自动缓存失效、迁移恢复或容量压测。本轮没有启动 MySQL，也没有连接业务数据库。本机 SSH 回环仅属于既有跨设计测试，不构成真实 SSH/数据库部署验收。

建议下一步：

1. 由接口维护者和产品完成 DB-R1-02 的语义/文案签署。
2. 实现或接入真实 Repository 后执行 TC-DB-43～46，重点检验提交后自动失效、实际 GET/大盘回显以及无副作用 CSRF。
3. 按原数据库验收矩阵完成 DDL、事务并发、计数器重建、防最后超管、审计重放及恢复验证，并继续跟踪原差异清单的未决项目。

**最终意见：认可本轮修复。四项原评审问题不再作为文档整改阻断项；不要将此结论扩展为“全部设计差异已消除”“产品已签署”或“系统可以直接上线”。**

