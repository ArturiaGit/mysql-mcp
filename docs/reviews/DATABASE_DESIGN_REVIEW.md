# 数据库设计第一轮评估报告

- 评估日期：2026-11-11（Asia/Shanghai）
- 评估对象：`DATABASE_DESIGN_SPEC.md` v1.0.0 及配套 `001_metadata_schema.sql`。
- 对照基线：系统架构 v1.2.1、后端详细设计 v1.7.0、前端详细设计 v1.4.0、接口契约 v1.5.0。以本次读取的正文及 SHA-256 为准，不沿用旧评审报告的“已关闭”结论，也不以旧生成片段替代成稿。
- 本轮只增加评估报告、只读复现脚本和证据文件，未修改四份输入设计、数据库设计、DDL 或原校验器。

## 一、评估结论

**主体数据模型可以继续采用，但当前只能有条件通过设计评审，尚不宜冻结为无歧义的实现基线。**

本轮确认 **1 项 P1、3 项 P2**。其中两项是数据库设计与上下游文档之间尚未收口的执行/行为契约，两项是数据库文档自身的接口追踪表错误。没有把同一个问题在多个文件中的表现重复计数，也没有把“尚未执行真实数据库验收”冒充已经发现的 DDL 故障。

主要风险不在于缺少大量实体表，而在于：**配置能持久化，不等于执行链路已经按该配置工作；接口路径覆盖完整，不等于每个接口的数据访问与副作用描述正确。**

| 编号 | 等级 | 问题 | 性质 | 主要整改位置 |
| --- | --- | --- | --- | --- |
| DB-R1-01 | P1 | USER 专属 `burstCapacity` 已有持久化和 API 契约，但后端快照仍只读取 GLOBAL 值 | 跨文档执行链路缺口 | 数据库 §6.3/7.5；后端 §6.2；联调验收 |
| DB-R1-02 | P2 | 恢复继承后的 QPM，数据库/后端采用角色优先，接口却承诺随全局变更 | 未决的外部行为契约 | 数据库 §1.2/7.5/15；接口 §6.7；前端文案及验收 |
| DB-R1-03 | P2 | `GET /auth/csrf` 被映射成“注销会话并失效相关上下文” | 数据库文档直接错误 | 数据库 §13.1 |
| DB-R1-04 | P2 | 三个 USER 限流接口被映射成用户管理表与“用户 CAS”，遗漏规则和计数器 | 数据库文档直接错误 | 数据库 §13.1；静态语义断言 |

P1 应在实现基线冻结前解决；P2 应在前后端联调基线冻结前解决。本结论不表示正在运行的系统已发生这些故障：当前工作区以设计文档和演示文件为主，复现针对文档中的可执行片段及文本契约。

## 二、具体问题与证据

### DB-R1-01 — [P1] 用户专属突发容量没有贯通到后端执行快照

**数据库侧定位：**

- [数据库设计 L596–599](D:/E/PersonalProjects/mysql-mcp/docs/DATABASE_DESIGN_SPEC.md#L596)：`burstCapacity` 映射到 `burst_capacity`，USER 有自己的值，缺省为 10。
- [数据库设计 L690–699](D:/E/PersonalProjects/mysql-mcp/docs/DATABASE_DESIGN_SPEC.md#L690)：事务写入 USER 的 QPM、突发容量、revision/version，并在提交后失效快照。
- [DDL L194–211](D:/E/PersonalProjects/mysql-mcp/docs/sql/001_metadata_schema.sql#L194)：规则表确实存储 `burst_capacity`，并允许 1～500。

**上下游证据：**

- [接口契约 L2067–2071](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L2067)：USER 写接口将 `burstCapacity` 定义为“专属突发容量”。
- [后端设计 L1639–1640](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L1639)：快照构造输入只有 `userSpecificQpmLimit` 和 `globalRateLimit`，没有对应的 USER 突发容量。
- [后端设计 L1732–1742](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L1732)：`quotas.userBurstCapacity = params.globalRateLimit.burstCapacity`，不读取 USER 规则值。
- [后端设计 L2079–2086、L2113–2120](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L2079)：令牌桶确实使用传入的突发容量，不能依靠执行层自动补救快照缺值。

**可复现反例：**

1. GLOBAL 的突发容量为 500。
2. USER 专属规则保存 `qpm_limit=30, burst_capacity=1`。
3. 运行当前后端文档中原始 QPM 与 quotas 构造片段，得到 `userQpmLimit=30, userBurstCapacity=500`，不是 USER 设置的 1。

这会使界面/GET 回显的专属容量与执行快照不一致；当 GLOBAL 大于 USER 值时，主体突发保护会被放宽。Profile 的独立资源保护仍可能继续限制请求，本报告不据此宣称“必然同时执行 500 条 SQL”。

**建议：**

- 在数据库设计中明确有效突发容量的读取优先级：存在 USER 覆盖时使用其已持久化的 `burst_capacity`；无覆盖时使用 GLOBAL 值。角色表没有该字段，不应套用 QPM 的角色合并逻辑。
- Repository 到快照构造器须传完整 USER 限流配置，或显式增加 USER 突发容量参数；更新和删除后重载两项配置，而不只是 QPM。
- 把后端签名和赋值同步列入数据库差异收口清单。不能只新增数据库列或在 API 中回显值就宣告完成。
- 增加验收：USER=1/GLOBAL=500、USER=20/GLOBAL=10、删除 USER 后恢复 GLOBAL，以及修改后旧快照失效。`qpm=-1` 的主体不限流语义另按既有契约处理。

**归属说明：**这是数据库详细设计进入现有后端实现基线时的阻断项，不是声称 DDL 的 `burst_capacity` 列本身定义错误。

### DB-R1-02 — [P2] “恢复继承全局”与实际角色优先语义未正式收口

**定位与冲突：**

- [数据库设计 L708](D:/E/PersonalProjects/mysql-mcp/docs/DATABASE_DESIGN_SPEC.md#L708) 明确选择 `USER > ROLE > GLOBAL`，并解释接口的“继承全局”不等于覆盖角色配额。
- [后端设计 L1702–1716](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L1702) 与上述选择一致。
- 但[接口契约 L2083–2096](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L2083) 不只是使用一个简称，还明确承诺：删除用户覆盖后，“后续全局限流变更将对该用户自动联动生效”。
- [数据库设计 L46](D:/E/PersonalProjects/mysql-mcp/docs/DATABASE_DESIGN_SPEC.md#L46) 又规定外部状态/字段行为以接口契约为准，冲突不能通过静默修改 API 解决。现有差异清单和待确认清单没有把这项行为冲突单列闭环。

**可复现反例：**

用户角色 QPM=60，已经删除 USER 覆盖；GLOBAL QPM 从 100 调到 20。文档中的后端计算在变更前后均得到 60，和接口承诺的后续全局联动不一致。

而且当前角色表的 `user_qpm_limit` 为 NOT NULL、取合法数值或 -1，后端又禁止无角色执行，因此在正常合法角色集合下，GLOBAL QPM 的兜底分支并不是通常意义的“所有继承用户默认值”。前端个人大盘的 `user_quota_qpm` 应展示执行侧有效值，不能根据“继承全局”的标签自行取 GLOBAL 值。

**建议：**

优先保持系统架构与后端已有的多角色合并规则，但必须由接口维护者正式将此状态命名为“无用户覆盖，按角色/全局策略计算”，同步修改“后续全局自动联动”的承诺、前端提示与测试。若产品确实要求恢复后直接跟随 GLOBAL，则应单独评审优先级及数据模型，不应仅在数据库文档里悄悄调整计算。

数据库设计应把它列为显式差异和签署事项，并补充“已保存覆盖值”和“最终有效配额”的 DTO/页面来源区分。此项不要求立即增加一张新表。

### DB-R1-03 — [P2] CSRF 获取接口被错误写成注销会话

**定位：**[数据库设计 L1004](D:/E/PersonalProjects/mysql-mcp/docs/DATABASE_DESIGN_SPEC.md#L1004)。

当前行是：

```text
GET /api/v1/auth/csrf | 内存CSRF/Session | 不建表；注销会话并失效相关上下文
```

这和[接口契约 §2.3、L754–764](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L754)的取种子/令牌语义相反；[前端设计 L362–378](D:/E/PersonalProjects/mysql-mcp/docs/FRONTEND_ARCHITECTURE_SPEC.md#L362)还明确要求 CSRF 刷新后自动重试原请求，并在改密换 Session 后主动取 Token。若按该追踪表实现，会使正常令牌刷新注销当前登录上下文。

**建议：**该行改为“按需建立/复用 CSRF seed，返回 token；不注销 Session、不撤销已有授权上下文、不写业务库”。仅 `POST /auth/logout` 保留注销语义。添加针对 GET CSRF 的无登出副作用断言。

### DB-R1-04 — [P2] 用户限流接口没有映射到限流规则与持久计数器

**定位：**[数据库设计 L1041–1043](D:/E/PersonalProjects/mysql-mcp/docs/DATABASE_DESIGN_SPEC.md#L1041)。

GET/PUT/DELETE 三行都使用：

```text
users、user_roles、roles；删除关联PAT/限流 | 用户CAS；治理操作防自锁；管理审计与提交后失效
```

这与本文件 §7.5 及接口 §6.7 的 `revision` 协议直接矛盾：遗漏 `sys_rate_limits` 和 `sys_rate_limit_revisions`，把限流 CAS 混同用户版本 CAS，还引入了不属于恢复限流继承的 PAT 删除语义。`sys_users.version` 与 USER 限流 revision 是独立版本，不能互换。

**建议逐项修正，而非三行共用一个用户管理模板：**

| 接口 | 正确主要数据 | 持久化/并发语义 |
| --- | --- | --- |
| GET USER 限流 | users + USER rate_limits；按需要读取其他策略来源 | 只读；无业务行时返回继承态 0/null；不能拿历史计数器值冒充当前 API revision |
| PUT USER 限流 | users + rate_limit_revisions + rate_limits + user_approvals | 按 §7.5 锁序；以 USER revision CAS；规则与计数器同事务更新；不以 user.version CAS |
| DELETE USER 限流 | users + rate_limit_revisions + rate_limits + user_approvals | 按 revision 条件只删除 USER 规则；保留 counter；不删除 PAT，不重置用户版本 |

静态校验器[现有 L212–216](D:/E/PersonalProjects/mysql-mcp/scripts/validate_database_design.py#L212)只比较路由集合，完全可能在这些内容错误时仍通过。应为关键接口新增“允许读写的表、版本来源、禁止副作用”断言，不能再把“47 条路径存在”作为接口数据访问正确性的证明。

## 三、已具备的设计质量与可保留部分

以下是文本层面核对后的正面结论，不代表已经在真实 MySQL 中通过验收。

| 评估维度 | 当前判断 | 依据/边界 |
| --- | --- | --- |
| 系统边界 | 合理 | 元数据库与被纳管业务库分离；Session、Ticket、快照、令牌桶等仍在单节点内存，不强行引入 Redis 或持久会话表 |
| 实体覆盖 | 基本完整 | 用户、角色、绑定、库表 ACL、Profile、PAT、审批/管理审计、SQL/匿名审计、配置、限流规则及计数器都有落点 |
| 14 表相对 13 表的扩展 | 有依据 | 独立持久计数器是接口防 ABA 语义所需，不是无依据的过度建模 |
| 代际算法 | 有实质补强 | 创建和每次更新同时推进 counter，删除保留；能解决旧接口示例“只在创建递增计数器”的缺陷；明确 revision=0 仅代表当前无覆盖，不伪称 0 有历史 epoch 语义 |
| ID、时间、类型 | 对齐较好 | BIGINT 全链路 string；UTC DATETIME(3)；驱动/会话时区双约束；布尔值显式映射；版本溢出拒绝写 |
| 删除与历史 | 方向正确 | 已绑定角色/Profile RESTRICT；用户删除级联 PAT；审计无级联 FK；删除 Profile 后 DTO name=null，但历史快照不被改写 |
| 账号生命周期 | 补充有效 | 原始申请理由快照、处理时间、单用户开放工单唯一性、重提产生新工单；未把密码过期新增为账号状态 |
| 事务与安全失效 | 规范较完整 | 管理审计同事务；外部 I/O 不在持锁事务内；统一锁序；提交后同步墓碑；SUPER_ADMIN 稳定锁点优于仅依赖汇总示例的隐含互斥 |
| JSON 与秘密 | 边界清晰 | TLS/SSH 白名单、加密信封、通知按渠道增量合并、掩码不落库；CHECK 仅兜底 JSON object，不冒充完整 Schema 校验 |
| 前端需求 | 主要落点齐备 | 审计精确回补、草稿测试不保存、ACL 父版本、轻量 Profile 三列投影、双角色大盘、删除资源空值展示等均有设计 |
| 审计幂等与分区 | 没有夸大能力 | 明确复合去重键并非跨时间全局唯一；冻结事件时间；不把所有 INSERT IGNORE warning 当成功；分区保留、迟到重放和长导出一致性边界已说明 |
| 运维与交付边界 | 相对诚实 | 区分空库 DDL 与存量迁移；不捏造历史 revision/时间精度；备份安全回退、密钥保留与容量假设均有声明 |

**不建议为了本轮问题推倒 14 表模型。**优先修复跨层数据读取协议、接口语义和追踪矩阵，然后补真实数据库验证。

## 四、不重复计为新缺陷的已知差异/待决事项

数据库文档已经明确承认下列项目，评估时不能再把它们包装成“首次发现”：

1. DB-D02：旧接口 SQL 更新规则而未同步 counter；数据库设计给出的同事务推进协议是正确修复方向，但仍须同步接口示例。
2. DB-D04～D06：旧后端时区、STAGING/STG、TLS JSON 结构需要同步。
3. DB-D07/D08/D16：FK 删除方向、PAT 级联、审计展示名扩容都有明确动机。
4. DB-D12：全局 burst 新库取 10、旧库 15 不自动覆盖，是待产品确认的默认值，不等同于本轮 DB-R1-01 的 USER 值完全未接线。
5. 库级通配符范围、daysRemaining 取整、DST 日桶分母、审计保留期、RPO/RTO、导出非冻结快照等已被列为待确认或能力边界。应签署收口，但不因“存在待决项”就断言已经产生数据错误。
6. 审批工单与管理审计共表不能提供 WORM；文档已公开说明。不应在当前单节点原型范围内无依据地要求引入独立审计平台。

本轮 P1/P2 处理不替代上述已有差异的同步任务。

## 五、验证过程与证据等级

### 5.1 现有静态校验

执行：

```powershell
python D:\E\PersonalProjects\mysql-mcp\scripts\validate_database_design.py
```

输出：

```text
PASS: 984 static/model assertions; 14 tables; 136 columns; 45 indexes; 7 foreign keys; 47 mapped endpoints; 3 JSON examples.
NOT RUN: MySQL parsing/execution, CHECK enforcement, multi-connection concurrency, migration, restore, or performance tests.
```

984 是脚本执行的断言次数，不是 984 个独立业务场景；47 是路由覆盖数，不是 47 个接口语义测试全部正确。

### 5.2 本轮独立反例验证

- [复现脚本](D:/E/PersonalProjects/mysql-mcp/docs/reviews/database-design-review.repro.cjs)
- [证据 JSON](D:/E/PersonalProjects/mysql-mcp/docs/reviews/database-design-review.evidence.json)

执行：

```powershell
node D:\E\PersonalProjects\mysql-mcp\docs\reviews\database-design-review.repro.cjs
```

方法：从当前后端正文抽取 QPM 与 quotas 构造片段，只擦除两处 TypeScript 类型注解，在隔离 VM 中执行；不改写赋值分支，不以自己重写的算法替代待审逻辑。另对数据库追踪表进行文本断言，并重跑原静态校验器。

| 观察 | 结果 | 证据等级 |
| --- | --- | --- |
| USER burst=1、GLOBAL burst=500 | 后端文档片段生成 500 | 原始代码片段隔离执行；不是运行中服务观测 |
| 删除 USER 覆盖、ROLE QPM=60，GLOBAL 100→20 | 有效 QPM 60→60 | 原始代码片段隔离执行，结合接口承诺识别冲突 |
| CSRF 追踪行 | 确实含注销会话语义 | 文档原文断言 |
| 三条 USER 限流追踪行 | 均遗漏限流规则/计数器并写用户 CAS | 文档原文断言 |
| 正向控制：USER QPM=30 优先于 ROLE=60 | 得到 30 | 防止把整个合并逻辑误判为失效 |
| 正向控制：ROLE=-1、无 USER 覆盖 | 得到 -1 | 保留既有不限主体 QPM 语义 |
| 原静态校验 | 仍通过 | 说明结构通过不能排除上述语义缺陷 |

源文件 SHA-256、字节数、片段起始行号和测试边界见证据 JSON。脚本确认评估前后七份受保护输入文件哈希不变。复现脚本正常退出表示上述反例成功重现，不表示所有设计已验收通过。

### 5.3 未执行与环境限制

本轮只读检查确认 Docker 客户端存在，但 Docker Desktop Linux 引擎管道不可连接；未发现可直接调用的 mysql 客户端。没有启动后台服务，没有连接任何业务/生产数据库。

因此以下内容仍未验证：

- 真实 MySQL 小版本下的建表执行、CHECK/生成列/外键/分区行为；
- mysql2 实际类型转换、Repository 的事务映射与完整 HTTP/浏览器联调；
- 双连接锁序、死锁重试、审批并发、防最后超管竞态；
- 故障注入、应急重放、存量迁移和备份恢复；
- 代表性数据量下的列表/COUNT、30 天聚合和分区维护性能。

缺乏这些证据是**上线验收缺口**，不是本轮证明 DDL 有语法错误。

## 六、建议的整改与验收顺序

1. **先修执行语义**：USER 突发容量贯通 Repository→快照→令牌桶；明确无 USER 覆盖时 QPM 的产品含义，接口与前端同步。
2. **再修文档权威性**：更正 CSRF 与三条用户限流追踪记录；把 DB-R1-01/02 纳入差异清单，明确责任文档和验收口径。
3. **增强语义回归**：在保留原 984 项检查的基础上，增加按接口方法、表集合、版本来源与禁止副作用的检查；增加 USER/GLOBAL 值不同的执行链路用例。
4. **隔离 MySQL 验收**：先跑空库 DDL/域约束/驱动映射，再跑审批、防自锁、USER 限流创建更新删除和重建的双连接测试，以及审计重复重放与分区边界测试。
5. **最后批准运维基线**：精确 MySQL 版本、现库盘点、历史时区、计数器迁移、容量/SLO、保留期和恢复演练有证据后，才转为生产实施基线。

**建议评审意见：保留主体方案；修复 1 项 P1、3 项 P2 后进行针对性复核。文档复核通过与真实数据库/上线验收通过应分开签署。**
