# 综合开发准入评估：第二轮限定范围复核

- 日期：2026-11-12（Asia/Shanghai）。
- 基线：第一轮综合开发准入报告的 RD-01～RD-09；参考对方整改记录，但不以其“已修复”声明替代独立验证。
- 本轮范围：原问题的关闭条件，以及修复直接影响的查询接口、类型、初始化协议、生成源和历史回归。不重新扩展为全系统架构审计。
- 受评版本：系统架构 v1.2.2、后端 v1.7.2、前端 v1.4.2、接口契约 v1.5.2、数据库 v1.0.2。

## 一、结论

**整改基本到位，但暂不判定全项通过：原8项技术问题中，7项可在设计文档/可执行片段层面关闭；RD-02原有8小时时区偏移已修复，但关联审计查询入口迁移遗漏，保留1项P2（RR2-01）。RD-08决策/签署门禁仍未关闭。**

- 本轮限定范围内**没有保留P1问题**。不得把这一结论外推为所有未审领域均无缺陷。
- 不重开已修好的限流计数器、唯一DDL、Profile读写字段、接口矩阵、超管锁序、自举恢复策略。
- 唯一剩余技术修复是小范围的消费者类型与依赖对齐，不需要再次全面重写五份文档。
- 可以继续基础工程与不受影响模块的开发。修完RR2-01并落实RD-08中影响v1.0的明确决策后，可以冻结本轮设计基线、进入全面实现与集成验收；真实MySQL/E2E/性能验收不应倒置为所有开发的前提。

本轮没有修改设计正文、生成分片、对方整改测试或既有评审证据；只新增本报告、本轮复核脚本与证据。复核脚本核验了 **178 个既有文件**在执行前后的哈希不变。

## 二、逐项复核状态

| 编号 | 结果 | 核验内容与边界 |
| --- | --- | --- |
| RD-01 / 原P1 | **关闭** | 创建和更新均经过同事务counter分配；qpm_limit列名一致；revision/version使用同一新值；删除不删counter。顺序模型与反向旧版本检查通过；真实MySQL双连接仍是实施验收 |
| RD-02 / 原P1 | **部分关闭，剩P2** | 驱动Z、借连接等待session UTC初始化、失败销毁、事务/非事务入口均有效；原8小时偏移关闭。§10.3审计Repository仍使用旧Pool参数，见RR2-01 |
| RD-03 / 原P1 | **关闭** | 架构和后端不再内嵌另一套建表SQL；统一引用14表DDL；现有物理表结构未因本轮改变，只新增内部PENDING初始化标记种子 |
| RD-04 / P2 | **关闭** | ProfileReadDTO改为username，写Payload保持user；真实契约fixture编译通过，编辑Mapper明确转换，旧user读类型的反向控制被拒绝 |
| RD-05 / P2 | **关闭** | 全局burst必填字段、导出profile_id、SSH指纹已同步；生成请求类型与源文档匹配。生成类型明确仅负责形状，运行时条件/范围校验没有被虚称已实现 |
| RD-06 / P2 | **关闭** | 契约、前端矩阵、后端矩阵、实施追踪各47项方法+路径精确匹配；新增3项具备守卫、版本/Ticket及交互说明 |
| RD-07 / P2 | **关闭** | API/后端/数据库统一永久SUPER_ADMIN锁→用户→绑定协议；提取真实guard验证最后超管/本人保护与无关本人角色修改；不把受控行集测试当InnoDB并发证明 |
| RD-09 / P2 | **关闭** | 空库DDL植入PENDING；自举成功同事务READY；异常非空库不得补超管。首次/重启/审计回滚/交付失败等既有正向检查保持；本轮补测14张表逐一非空均阻断自举 |
| RD-08 / 决策门禁 | **保留** | 默认burst、库级ACL范围、角色优先语义签署、DST日桶和剩余天数取整仍有待确认项，见第五节 |

“关闭”仅指本次设计整改范围，不表示Repository/HTTP/页面已经实现。

## 三、唯一剩余技术问题

### RR2-01 / P2：审计查询消费者没有完成UTC安全查询入口迁移（归属RD-02）

**位置：** [后端 §10.3，L5183–5203](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L5183)。

当前代码的关键部分：

```typescript
import type { MetadataQueryExecutor } from './metadata-pool';

export async function queryAuditLogs(
  pool: mysql2.Pool,
  // ...
) {
  // ...
  const [rows] = await pool.query<mysql2.RowDataPacket[]>(/* ... */);
}
```

本次改造已经增加 [每次借连接初始化UTC的入口，L644–671](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L644)，并在 [启动代码L183–207](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L183) 将安全执行器传给相关非事务消费者。但审计Repository只替换了导入，未替换参数和行类型依赖：

1. 当前模块不再导入mysql2，却在L5188、L5201继续引用该命名空间。
2. 函数仍要求`mysql2.Pool`，与只暴露query的`MetadataQueryExecutor`不兼容。
3. 所以不能只补回旧导入让它编译，再继续要求调用方传原始Pool；那样仍没有落实本轮禁止非事务查询旁路UTC借连接入口的设计约束。

#### 独立验证

使用TypeScript **5.9.3 strict**和本机真实mysql2类型声明，提取当前完整queryAuditLogs片段。仅将内部导入的MetadataQueryExecutor解析为其真实接口定义，未偷偷补入mysql2命名空间。

| 验证 | 实际结果 |
| --- | --- |
| 当前代码 | **2条TS2503**：Cannot find namespace 'mysql2' |
| 仅补回mysql2类型导入，并以MetadataQueryExecutor作为真实调用输入 | **TS2345**：MetadataQueryExecutor不可赋给Pool，缺getConnection/releaseConnection/on/end等成员 |
| 内存修正对照：参数改MetadataQueryExecutor，正确解析RowDataPacket类型，再保留同一个调用输入 | **0条诊断** |

三种情形的完整诊断已写入证据。对照只在内存中执行，没有替用户修正文档。

**影响边界：**这是确定的设计代码编译/接口对接问题；本轮没有运行真实HTTP审计请求，不能把它描述成已经观察到生产审计数据错8小时。原有`timezone: '+08:00'`问题本身已经修复。

#### 最小关闭条件

1. `queryAuditLogs`改为接收`MetadataQueryExecutor`，并正确导入它及行类型；内部模块路径须与最终目录组织一致。
2. 调用侧使用`createMetadataQueryExecutor(...)`产生的安全入口，不因类型冲突退回原始Pool。
3. 同步后端生成分片，避免combine重建旧示例。
4. 增加跨模块正向类型检查：实际安全执行器→queryAuditLogs；补充查询先完成UTC初始化、错误时释放连接的串联测试。

只需对该消费者及关联测试作定点修复；不要求重新改造已正确的连接池、事务包装器或审计重放引擎。

## 四、本次执行证据与覆盖边界

### 4.1 本次重跑，而非引用旧结论

对方修复测试及历史回归在新建临时镜像中运行；原工作区的历史文件没有被覆盖。重跑结果的五份正文和DDL哈希与本次独立复核一致，完整结果已嵌入本轮证据。

| 验证组 | 本次结果 |
| --- | --- |
| 对方本次整改正向测试 | **15/15** |
| 数据库静态/顺序模型 | **1067项断言通过**；14表、136列、45索引、7外键、47映射端点 |
| 静态检查器反向变异测试 | **3/3测试方法** |
| 历史数据库整改测试 | **15/15** |
| 历史数据库第二轮独立观察 | **7/7组** |
| 历史四文档第四轮 | **96/96**，原14项继续关闭 |
| 历史后端第八轮限定回归 | **4/4** |
| 本轮独立检查 | **12组中11组成立、1组不成立**；不成立项即RR2-01 |

这些测试有交叉覆盖，**不能累加成全系统通过率**。脚本退出0表示审计脚本完整运行，必须同时查看summary中的`violated: 1`，不能宣称全部通过。

历史四文档脚本在临时镜像中有两处必要的抽取适配：

- 内嵌DDL已经删除，改为读取规范引用的权威SQL。
- ProfileDTO已是兼容别名，改为抽取ProfileReadDTO。

它们不修改业务预期，但也不能称为“所有历史脚本逐字不变”。本轮另行独立验证：架构/后端没有残留内嵌DDL，14表和关键约束确实存在，Profile原始GET响应可通过新DTO检查，避免仅靠旧脚本换取数据源后给出形式上的通过。

### 4.2 本轮独立补充验证

- 完整提取非事务执行器，控制UTC初始化Promise：SET未完成时业务SELECT不得开始；第二次借出再次SET；业务失败释放；SET失败销毁、不释放回池。
- 完整提取withTransaction，核验UTC初始化先于BEGIN，成功commit、失败rollback与release的顺序。
- 严格编译审计消费者及真实输入接口，发现此前正向测试未覆盖的RR2-01。
- 从API原始JSON验证Profile读DTO与编辑Mapper，确认不将密码、私钥、ID、status和时间读字段整包回传为写Payload。
- 对全局限流缺burst、导出旧profileId作反向类型控制；合法profile_id与SSH指纹输入通过。
- 按方法+路径验证47项完全相等，检查重复项而不只是比较去重后的数量。
- 对大整型字符串用户ID执行5组超管guard场景，验证锁顺序及自我/最后超管边界。
- 对14张表分别置为非空，执行真实BootstrapService片段：PENDING均在任何用户创建、哈希、秘密交付前拒绝。
- 四份成稿与生成分片一致；请求类型、fixtures及endpoint trace通过生成源`--check`。

中断前未跑完的独立脚本，问题是负向Profile测试过度依赖诊断文本：TypeScript对对象字面量先给出TS2353“username为未知字段”，而不一定先给TS2741“缺user”。本轮改为严格识别相关诊断码及字段名；正确DTO仍须零诊断，错误DTO仍须被拒绝，没有放宽产品行为预期。

### 4.3 未验证内容

未执行真实MySQL建库/多连接并发、实际HTTP服务、浏览器E2E、全工程构建、生产升级、恢复演练或性能压测。受控SQL响应和顺序模型不是数据库并发证明；生成实施追踪不是已有Controller/Service/Repository代码。以上沿用开发/发布阶段验收安排，不新增为本轮文档问题。

## 五、RD-08的准确状态

证据见 [数据库 §15.1，L1155–1172](D:/E/PersonalProjects/mysql-mcp/docs/DATABASE_DESIGN_SPEC.md#L1155)。

| 项目 | 当前状态 |
| --- | --- |
| 全局burst默认 | 示例统一暂定10，旧15不自动覆盖；产品/安全确认仍待完成 |
| 库级ACL通配 | 相关文本已统一v1.0精确名；范围确认/后续能力扩展仍由安全和接口维护者裁决 |
| USER/ROLE/GLOBAL继承语义 | 技术文本与执行片段已对齐，但L1163仍明确“未签署前不冻结联调基线”；仓库未提供签署证据 |
| DST日桶 | 支持IANA自然日与固定1440分钟分母的歧义仍列为待澄清 |
| daysRemaining | 向上取整仍为建议，需前后端/产品明确接受 |

这不是要求把已经修好的RD-01、RD-04等重新打开。可以由责任人接受现有暂定方案并记录批准，不必为完成签署再次调整实现算法。仓库未见证据不等于断言仓库外没有批准。

## 六、后续准入建议

1. **本轮关闭7项，保留RR2-01这一项P2及RD-08决策门禁。**不扩大整改清单。
2. 定点修复审计消费者及生成源，以跨模块类型检查证明安全查询入口真正接通。
3. 对RD-08形成明确的v1.0决定/签署；随后可冻结本轮开发基线，进入全面实现。
4. 下一次复核只需要验证RR2-01修复、相关查询回归及签署状态，不必再从头重复整套架构审稿。

**最终意见：修复有效且已接近收口；当前不是“仍有多项重大架构冲突”，也不是“所有问题全部修复”。**

## 七、交付物和复跑

- [本轮报告](D:/E/PersonalProjects/mysql-mcp/docs/reviews/COMPREHENSIVE_DESIGN_READINESS_REVIEW_ROUND2.md)
- [独立复核脚本](D:/E/PersonalProjects/mysql-mcp/docs/reviews/comprehensive-design-readiness-round2.repro.cjs)
- [完整证据及本次重跑嵌入结果](D:/E/PersonalProjects/mysql-mcp/docs/reviews/comprehensive-design-readiness-round2.evidence.json)

本轮脚本含当前反例及内存修正对照，是此版本的可复核快照，不是未来修复后永久要求错误继续存在的产品测试。使用本机已有独立依赖复跑：

```powershell
Set-Location 'D:\E\PersonalProjects\mysql-mcp'
$deps = Join-Path $env:TEMP 'mysql-mcp-design-review-20261108'
$extra = Join-Path $env:TEMP 'mysql-mcp-cross-review-20261111'
$env:NODE_PATH = "$deps\node_modules;$deps\r3-extra\node_modules;$extra\node_modules"
$env:PYTHONIOENCODING = 'utf-8'
$node = Join-Path $deps 'r2-node22\node_modules\node\bin\node.exe'
& $node docs/reviews/comprehensive-design-readiness-round2.repro.cjs `
  --mirror "$env:TEMP\mysql-mcp-readiness-r2-69a68ca9"
```

`--mirror`使用本轮临时镜像内的已重跑证据，脚本核验输入哈希，不执行网络请求或数据库连接。无镜像时可不传该参数执行独立检查，但会重写本轮证据且不嵌入历史结果；正式归档应保留当前完整证据。历史套件的两处抽取适配仅发生在临时镜像，原始历史脚本保留。

### 受评正文与配套Schema SHA-256

| 文件 | SHA-256 |
| --- | --- |
| `docs/ARCHITECTURE_SPEC.md` | `21614af8cadc8f92172779cd6106d12009084ed8b4b2ba5fbcbc738cbc4a4d22` |
| `docs/BACKEND_ARCHITECTURE_SPEC.md` | `a81c356a5d59536225437d9e48b1a31df5446612c5d76db6e2435c13da5d54c3` |
| `docs/FRONTEND_ARCHITECTURE_SPEC.md` | `78286bdaa2a5c6a98345f07b0802181ae3f33fd99b40d89e4bf0fe7f6029d1b0` |
| `docs/API_CONTRACT_SPEC.md` | `34c00e059d1219c976185a3ff5c0a5b21076ec672e77b1d3c3e6346b828dcb2e` |
| `docs/DATABASE_DESIGN_SPEC.md` | `93190c64f157cbc46781664b3a426886ad07330c429e2d1782552e8e2b3f10dd` |
| `docs/sql/001_metadata_schema.sql` | `655fae957076927283141b15cd7d90afb77e9bc6b278b3ef70f7d76fe6e6f7c2` |
| `docs/contracts/readiness.types.ts` | `f40baa341a7deca4b611e461f8c4538277dcbc09f183cfb2df0286fb17f4625f` |
| `docs/contracts/readiness.fixtures.json` | `8c361a9a2dc4aefa38239409c034c558c8a3f531a8f9c941e17a37bebace6589` |
| `docs/contracts/endpoint-trace.json` | `7e508d351d3bc9d2cc0a147a73b40c3a0f197adea5ff497852efb25c3b832323` |
