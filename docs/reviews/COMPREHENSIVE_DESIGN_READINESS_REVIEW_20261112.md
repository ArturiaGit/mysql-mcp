# 五份设计文档综合一致性与开发准入评估

- 评估日期：2026-11-12（Asia/Shanghai）。
- 对象：系统架构 v1.2.1、后端详细设计 v1.7.1、前端详细设计 v1.4.1、接口契约 v1.5.1、数据库设计 v1.0.1，以及配套空库 DDL。
- 方式：跨文档核对、历史专项回归、SQL 引导的顺序模型、真实 mysql2 解析器验证、提取 DTO 的 TypeScript strict 检查。未修改设计正文、生成分片或历史评审材料。

## 一、结论：可启动基础工程，不应无条件冻结五份文档后全面并行开发

**当前仍有不一致，不满足“没有冲突，可以直接照文档全面开发”的条件。**

本轮登记 **8 项技术不一致（3 项 P1、5 项 P2）及 1 组决策/签署门禁**。这不是说系统架构需要推倒重来，而是最新数据库设计和接口契约的部分变化尚未贯穿到详细设计、示例代码与前端类型。

- **可以立即开始**：Monorepo/构建与测试基础设施、单进程双 Fastify 宿主、共享类型/Schema 的生成设施、前端布局及不依赖争议字段的组件、测试容器与 fixtures。
- **先收口再固化**：数据库迁移与 Repository 基线、限流版本算法、时间映射、Profile 读写 DTO、相关接口/前端表单、超管事务与自举策略。
- **不要求先完成整套运行系统才能开工**：真实 HTTP/浏览器 E2E、全链路 KILL/TLS/SSH、性能/恢复演练属于实施与发布验收，不应被倒置成所有开发工作的前置条件。
- **建议的准入方式**：完成一次有清单、有责任人的基线修订；受影响模块按下文验收条目收口后进入全面业务开发。避免继续无边界地做“再一轮全面文字审稿”。

历史评审结论仍有效，但必须保持范围：四文档第四轮只关闭既有 CR-01～CR-14；数据库第二轮只关闭 DB-R1-01～04。本报告未重开这些已经通过的事项。数据库设计自己也明确说明其他 DB-D 差异并未因第二轮通过而关闭。

## 二、总体一致性判断

| 核对方向 | 评估 |
| --- | --- |
| 系统边界、部署与状态归属 | 单节点单主进程、数据面/管控面、内存 RegistryHub/Session/限流器与持久元数据的基本方向一致；不需要为本轮问题引入 Redis 或多节点方案 |
| 认证、状态机、已有权限失效链 | 历史专项检查保持通过；不把以前修好的 CSRF、SSH 指纹、密码策略 DTO、审计重放再列为未修复问题 |
| 限流实际配额计算 | USER QPM/burst 映射与角色优先计算的既有修复保持；但持久 revision 写事务示例仍有另一处 ABA 问题 |
| 前后端接口/DTO | 仍有明确字段冲突、缺必填参数和路由追踪缺项，不能仅依赖“已闭环”标记 |
| 数据库与后端实现基线 | 两套 DDL、时区配置、自举与锁序尚未完全一致，是本轮主要风险 |
| 测试与上线准备 | 已有设计片段/静态证据，不是完整应用或真实 MySQL 验收；作为开发过程的门禁继续推进 |

## 三、本次实际验证结果

所有历史回归在工作区外新建的临时镜像执行，避免覆盖历史证据。镜像与当前五份正文及 DDL 的 SHA-256 一致；新证据包含本次重跑的结果，而不是只引用旧报告。

| 验证 | 本次结果 | 结论边界 |
| --- | --- | --- |
| 数据库静态/顺序模型校验 | 1067 项断言通过；14 表、136 列、45 索引、7 外键、47 个接口映射 | 不等于 MySQL 已接受 DDL，也不验证后端文档的另一套 DDL |
| 静态检查器反向变异测试 | 3/3 测试方法通过 | 检查器能识别既有 CSRF/限流追踪表错误 |
| 数据库整改测试 | 15/15 | 既有整改范围 |
| 数据库第二轮独立观察 | 7/7 组 | 既有 USER burst/角色优先等限定范围 |
| 四文档第四轮回归 | 96/96，原 14 项继续关闭 | 不是所有接口字段的穷举 |
| 后端第八轮限定回归 | 4/4 | 审计重放交错及 limiter 类型检查 |
| 本轮独立一致性探针 | 9 组确认了当前冲突/待决项 | **这里的“确认”不是设计通过**；含有故意要求反例成立的断言 |

上述测试有范围重叠，不能相加成一个“全系统通过率”。本轮未执行真实 MySQL 建库、事务并发、HTTP、浏览器 E2E、全工程构建或生产迁移。首轮运行发现临时环境缺少 ssh2 的模块搜索路径，补入已有依赖目录后原样重跑通过；没有安装新依赖或改动工程锁文件。

## 四、问题清单

### RD-01 / P1：用户限流更新仍未同步持久计数器，API SQL 还引用不存在的列

**证据**：[接口契约 §6.7.4，L2052–2069](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L2052)；[数据库 §7.5，L676–708](D:/E/PersonalProjects/mysql-mcp/docs/DATABASE_DESIGN_SPEC.md#L676)。

API 示例在“创建”时增加 `sys_rate_limit_revisions.last_revision`，但“更新已有覆盖”只增加业务行 `revision/version`。数据库设计则要求每次创建和更新都同步递增持久计数器。

按当前 API 两段 SQL 的语义进行顺序模拟：

| 操作 | 持久计数器 | 业务 revision |
| --- | ---: | ---: |
| 创建 | 1 | 1 |
| 更新 | 1 | 2 |
| 删除 | 1 | 无 |
| 重建 | 2 | 2 |

迟到的旧 `revision=2` 请求因此仍能命中新建记录。数据库设计要求的正确结果应是重建为 **3**。本轮模型确认旧路径接受迟到 CAS，修正对照拒绝。

此外，同一 API UPDATE 使用 `user_quota_qpm`，而配套 DDL 以及后端 DDL 的物理列均为 `qpm_limit`。`userQuotaQpm` 是 API 字段，不能直接变成未经定义的 SQL 列。

**影响**：按接口示例实现会遇到 SQL 列不存在；只修列名仍会留下 ABA 覆盖/误删除风险。优先级原则可以帮助裁决，但不能让仍然错误的示例安全可用。

**收口要求**：同步 API、后端 Repository 事务说明与生成分片，以数据库 §7.5 为候选完整算法；统一 `qpm_limit`、同事务计数器分配、业务 revision/version 和审计。验收至少覆盖“创建→多次更新→删除→重建→旧更新/旧删除全部409”，再在真实 MySQL 双连接验证。

**既有来源**：数据库 DB-D02/03 已登记；本轮确认仍然存在，并非重开 DB-R1-01/02。

### RD-02 / P1：元数据连接按 +08:00 解释时间，与 UTC 存储契约冲突

**证据**：[后端 metadata-pool，L828–842](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L828)；[数据库时间与驱动，L160–166](D:/E/PersonalProjects/mysql-mcp/docs/DATABASE_DESIGN_SPEC.md#L160)；[接口 UTC 规范，L228–234](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L228)。

后端配置仍为 `timezone: '+08:00'`；数据库要求 UTC DATETIME(3)、驱动 `timezone: 'Z'`，每条新连接设置 `time_zone='+00:00'`。接口也要求 UTC 存储与传输。

本轮直接调用既有 **mysql2 3.24.6** 的真实 Packet 解析器，以受控 DATETIME 协议数据测试：

- UTC 物理值：`2026-11-12 08:00:00.123`。
- 当前后端配置输出：`2026-11-12T00:00:00.123Z`。
- 数据库规范配置输出：`2026-11-12T08:00:00.123Z`。
- 差值：**-8 小时**。

这是驱动解析反例，不是仅凭时间字符串猜测；但没有连接真实数据库。后端旧 DDL 还大量使用不带毫秒精度的 DATETIME，需要一并纳入 RD-03 的单一 DDL 收口。

**影响**：审计查询窗口、密码/PAT 到期判断及时间展示可能偏移。仅调用 `toISOString()` 不能纠正已被错误解释的时间。

**收口要求**：统一驱动、每连接 session 时区、物理精度、SQL 时间函数/写入映射；已有数据必须先判明历史时区，不可直接批量减8小时。增加“插入→读取→DTO→浏览器显示”往返用例。

### RD-03 / P1：后端“完整 DDL”与数据库权威 DDL 仍是两个不同基线

**证据**：[后端 §4.1 完整 DDL](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L583)；[数据库权威建表脚本声明](D:/E/PersonalProjects/mysql-mcp/docs/DATABASE_DESIGN_SPEC.md#L187)；[配套空库 DDL](D:/E/PersonalProjects/mysql-mcp/docs/sql/001_metadata_schema.sql)。系统架构 [§5.2](D:/E/PersonalProjects/mysql-mcp/docs/ARCHITECTURE_SPEC.md#L910) 也仍保留旧 DDL，未明确退为历史/概念示例。

本轮结构对比确认：后端13张表，配套脚本14张表。不是只有注释不同：

| 项目 | 后端详细设计 | 数据库设计/配套DDL |
| --- | --- | --- |
| 用户限流 | 无持久计数器表，业务表无 revision | 新增计数器表及 revision |
| 审批工单 | 无原始申请理由快照、处理时间、目标信息/待审生成列 | 增加 application_reason、decided_at、target_type、target_id、details、pending_user_id |
| 用户角色→角色删除规则 | CASCADE | RESTRICT |
| PAT→用户 | 无相应外键 | CASCADE 外键 |
| ACL 名称比较 | 继承默认 ai_ci | 名称/模式列 as_cs |
| 审计 Profile 名称 | VARCHAR(64) | VARCHAR(128) |
| 时间 | DATETIME | DATETIME(3) UTC |

**影响**：不同人员按不同“正式规范”建库，会形成缺表缺列、级联行为、大小写规则及审计字段容量不一致。前面几项足以直接阻断 Repository 的共同实现基础。

**收口要求**：明确空库 DDL 是物理 Schema 唯一事实来源；同步后端引用或自动生成其 DDL 章节。架构可保留概念模型，但旧 SQL 必须明确不用于建库。补齐新增列的 Repository 读写映射；用 Schema diff 防止再次分叉，而不要求手工维护三套 SQL。

### RD-04 / P2：Profile GET 的 username 与前端必填 user 不兼容

**证据**：[Profile GET JSON，L1426–1455](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L1426)；[前端 ProfileDTO，L1080–1098](D:/E/PersonalProjects/mysql-mcp/docs/FRONTEND_ARCHITECTURE_SPEC.md#L1080)；[数据库读写映射，L585](D:/E/PersonalProjects/mysql-mcp/docs/DATABASE_DESIGN_SPEC.md#L585)。

API GET 返回 `username`；前端 `ProfileDTO` 必填 `user: string`。数据库映射已明确“写 user / 读 username”，并明确不能沿用前端旧 `user` 示例；前端正文却仍然未改。

本轮将 API 原始响应对象赋值给抽取的前端 DTO，TypeScript 5.9.3 strict 返回 **TS2741：缺少 user**。仅把 DTO 读字段改为 username 的对照编译通过。

**影响**：列表/编辑回填可能读到 undefined；按 DTO 构造的 Mock 能通过自测却与真接口不兼容。读写不同名本身不是错误，缺少明确 Mapper 且读 DTO 声明错误才是问题。

**收口要求**：区分 ProfileReadDTO 与 Create/UpdateProfilePayload；明确 username→user 的表单映射，使用真实契约 fixture 做响应解析和类型测试。

### RD-05 / P2：请求映射表仍有必填字段遗漏和过滤字段名漂移

**证据**：[前端接口映射，L938–950](D:/E/PersonalProjects/mysql-mcp/docs/FRONTEND_ARCHITECTURE_SPEC.md#L938)；[后端映射，L5383–5384](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L5383)；[全局限流请求 Schema，L1978–1984](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L1978)；[导出请求 Schema，L2258–2266](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L2258)。

三个可直接影响联调的例子：

1. 前端全局限流 PUT 的请求签名遗漏 **必填 burstCapacity**；按该签名构造完整请求仍不满足接口 Schema。
2. 前后端导出映射表使用 **profileId**，接口导出 Payload 要求 **profile_id**。严格拒绝未知字段会报错；若选择忽略未知字段，则存在丢失用户指定过滤范围的风险。本文不声称已在实际 HTTP 服务复现。
3. 前端 `test-ssh` 请求签名未包含 **hostFingerprintSha256**；契约要求更换 SSH 目标/身份时与新私钥一起重填。遗漏会使新增/修改测试无法完成规定的安全输入。

**收口要求**：从统一 Schema 生成请求类型和映射清单；补齐全局 burst、导出 profile_id、SSH 指纹。对于只展示部分字段的概要表，必须标注“非完整签名”并链接权威定义，不能让它作为实现输入类型。

### RD-06 / P2：接口契约47项，前后端映射矩阵各只覆盖44项

**证据**：[前端 §8.1](D:/E/PersonalProjects/mysql-mcp/docs/FRONTEND_ARCHITECTURE_SPEC.md#L910)；[后端 §11.1 全量路由表](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L5346)；[重置密码端点](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L1290)、[移除限流覆盖端点](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L2089)、[下载端点](D:/E/PersonalProjects/mysql-mcp/docs/API_CONTRACT_SPEC.md#L2288)。

按 HTTP 方法+路径展开 GET/PUT 等合并行，缺项在两份详细设计中一致：

- `POST /api/v1/users/:id/reset-password`。
- `DELETE /api/v1/rate-limits/users/:id`。
- `GET /api/v1/audits/export/download`。

下载路径在后端导出说明中被提及，因此不能说“后端完全没设计下载”；问题在于没有作为独立接口列出守卫、Ticket CAS 与错误分支。重置密码路径在两份详细设计正文均未出现；恢复继承的 DELETE 操作也不在路由矩阵中。

**影响**：以详细设计矩阵拆开发任务，会遗漏必要功能、前端入口或服务端守卫。这里只证明设计追踪缺项，不把它表述成实际服务已经返回404。

**收口要求**：补全47项接口追踪，每项落到 Controller/Schema/Service/Repository、前端调用或下载行为及测试。若某项确实延期，应同步修改 API 范围，不能默认缺省即延期。

### RD-07 / P2：超管保护有两种锁协议，数据库新增规则未进入后端事务示例

**证据**：[后端超管保护，L928–949](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L928)；[数据库统一锁序，L635](D:/E/PersonalProjects/mysql-mcp/docs/DATABASE_DESIGN_SPEC.md#L635)；[数据库稳定锁点，L662–672](D:/E/PersonalProjects/mysql-mcp/docs/DATABASE_DESIGN_SPEC.md#L662)。

后端对“当前 ACTIVE 超管”的 JOIN 查询执行 FOR UPDATE；数据库规范新增“首先锁永久 SUPER_ADMIN 角色行”，并要求授予/撤销超管、启停、删除都经相同锁点与锁序。后端没有显式采用该协议。

**重要边界**：本轮没有运行 MySQL 并发调度，不能据此断言旧 JOIN 一定不加角色锁或一定出现最后超管丢失。可确认的问题是两份文档规定了不同实现协议，当前没有等价性证明或统一决策。

**收口要求**：选定并同步一种锁协议；覆盖所有会影响活跃超管集合的入口，而非只改禁用一个方法。真实数据库测试至少涵盖相互降权、并发授予/撤销、删除/启停以及死锁重试边界。

### RD-09 / P2：自举服务允许非空库自动补超管，与数据库的人工恢复原则矛盾

**证据**：[BootstrapService，L1155–1193](D:/E/PersonalProjects/mysql-mcp/docs/BACKEND_ARCHITECTURE_SPEC.md#L1155)；[空库初始化，L910–915](D:/E/PersonalProjects/mysql-mcp/docs/DATABASE_DESIGN_SPEC.md#L910)。

后端仅在发现已有 ACTIVE 超管时返回；查不到就继续创建 `admin`。它没有在此路径判断“是否首次空库初始化”。数据库明确要求：只有首次空库初始化允许创建，运行中超管缺失应报警并人工恢复，不能每次启动自动补一个。

可触发的设计场景是：非空库中没有 ACTIVE 超管，且已不存在名为 admin 的用户。按后端片段会新建超管；按数据库设计应拒绝正常就绪并转人工恢复。若 admin 用户名尚在，现有逻辑还可能遇到唯一键失败，而不是进入设计好的恢复路径。

**收口要求**：明确“首次初始化”可持久识别的条件/标记和失败状态；区分可幂等补缺的基础配置与不可自动补发的超管身份。测试空库首次、正常重启、非空库超管缺失三个分支。本轮仅检查代码控制流，没有创建真实账号。

## 五、RD-08：决策与签署门禁，不混同于新增运行时缺陷

| 待确认项 | 当前证据 | 开工处理建议 |
| --- | --- | --- |
| 全局初始 burst=10 还是15 | 后端 Bootstrap L1152 写15；数据库 §11.1 L927 规定新库10；DB-D12/§15.1 仍待产品确认 | 新库选定一个默认值并同步；旧库值不得随启动被覆盖 |
| 库级 ACL 是否支持通配 | 前端 L1011 尚写待确认；后端 DDL L713 仍称通配；数据库 DB-D14 规定v1.0精确名 | 推荐按已有数据库安全边界先锁定精确名，并同步接口校验、前端帮助及旧规则处置；表级 * 能力不受此裁决自动影响 |
| USER/ROLE/GLOBAL 语义签署 | 数据库 L1154 明写“未签署前不冻结联调基线” | 技术文本/执行片段已对齐，不重开旧缺陷；由接口维护者与产品批准文案、有效值来源和验收预期。当前仓库未见签署证据，不能推断仓库外一定无人批准 |
| DST 日桶与1440分钟 | API L2190–2197 与数据库 L806/1160 明示待澄清 | 若支持任意IANA时区，明确按实际桶长还是规范化24小时计算；或正式限制当前支持时区。可作为统计模块验收决策，不阻塞基础框架 |
| 密码剩余天数取整 | 数据库 L1159 仍待确认 | 固定 ceil/floor及0/-1边界；属于小范围契约决策，无需重审整个密码体系 |

这些项目不能靠开发者各自选择默认行为来“自然解决”。也没有必要因小范围产品决策暂停不相关模块。

## 六、建议的开发准入与验收顺序

### A. 全面业务开发前：冻结最小一致基线

1. 架构/后端/DBA 共同确认唯一物理 Schema；旧 DDL 改为引用/生成，数据库补充规则逐项同步。
2. 关闭 RD-01/02/03：统一 revision、UTC 与 DDL；给出确定的 Repository/迁移输入。
3. 关闭 RD-04/05/06：修正 Profile读写模型和Payload；47项接口全追踪，生成共享类型与Mock fixtures。
4. 关闭 RD-07/09：锁协议、自举恢复策略选定且写入服务设计。
5. 对 RD-08 中影响 v1.0 行为的决策取得明确结论；已有签署证据可直接引用，不要求形式化重复审批。
6. 更新文档版本/修订记录与生成分片，保留本次证据；不要只改最终Markdown而让下一次combine恢复旧内容。

### B. 开发首个垂直切片内：建立实际实现证据

- 在选定的真实 MySQL 小版本上执行空库 DDL、Bootstrap、Repository，验证 CHECK/FK/排序规则/UTC毫秒与大ID往返。
- 打通登录→会话→角色/ACL→一次MCP只读查询→审计查询的最小链路；由统一Schema连接前端与HTTP。
- 对限流创建/更新/删除重建、最后超管、自举重启、配置提交后自动失效执行真实事务与故障用例。
- 将“文档示例通过”升级为“仓库代码编译+单元+契约+数据库集成通过”。

这一步是开发工作，而不是要求在开发前已经完成开发。

### C. 发布前：执行原计划中的安全、可靠性与运维门禁

真实 KILL/断连/超时、SSH/TLS/SSRF、审计故障落盘与恢复、浏览器E2E、吞吐与内存预算、迁移/备份恢复及RPO/RTO。存量升级需要真实历史库信息；全新空库的初期开发不必等待一套尚无输入的生产升级脚本。

**最终意见：允许有边界地开工；当前不签署“五文档已完全一致、可直接全面并行开发”。完成上述有限的基线收口后即可进入全面实施，不必无限循环扩展设计审查。**

## 七、可复核材料与运行方式

- [本轮探针脚本](D:/E/PersonalProjects/mysql-mcp/docs/reviews/comprehensive-design-readiness-20261112.audit.cjs)。
- [本轮证据（含本次历史回归的嵌入结果）](D:/E/PersonalProjects/mysql-mcp/docs/reviews/comprehensive-design-readiness-20261112.evidence.json)。

本轮只新增这两份材料与本报告。探针是当前版本的反例记录，不是修复后的放行测试；修改设计后，应另建/更新正向验收用例，而不能把“反例不再成立导致快照断言失败”误判为产品回归。

使用本机已经存在的独立依赖执行本轮新探针（无需安装包、不连接数据库）：

```powershell
Set-Location 'D:\E\PersonalProjects\mysql-mcp'
$deps = Join-Path $env:TEMP 'mysql-mcp-design-review-20261108'
$extra = Join-Path $env:TEMP 'mysql-mcp-cross-review-20261111'
$env:NODE_PATH = "$deps\node_modules;$deps\r3-extra\node_modules;$extra\node_modules"
$node = Join-Path $deps 'r2-node22\node_modules\node\bin\node.exe'
& $node docs/reviews/comprehensive-design-readiness-20261112.audit.cjs
```

该命令只重写本轮证据文件；若需保留其中历史回归嵌入数据，传 `--history <本次在临时镜像生成的database-design-review-round2.evidence.json绝对路径>`。脚本验证历史受评正文哈希，拒绝混用不同版本。历史重跑命令为临时镜像内 `database-design-review-round2.repro.cjs --historical --typecheck`；不要直接覆盖原仓库的历史证据。

### 本轮受评内容 SHA-256

| 文件 | SHA-256 |
| --- | --- |
| `docs/ARCHITECTURE_SPEC.md` | `d37e4ba71d70168889e9c6a4a3b3c6a66be9013c66672af02cd7e86bb3fbf760` |
| `docs/BACKEND_ARCHITECTURE_SPEC.md` | `6dbaa390d253bfa90fb04eba66dc05cb09f11a941c36a4225c68d2747d4ae127` |
| `docs/FRONTEND_ARCHITECTURE_SPEC.md` | `3fb10fc54273a3c067de8fb27f7e555e0f434ae59e809b9c17de3d7911c80ddf` |
| `docs/API_CONTRACT_SPEC.md` | `3bf1a1429d6b4abb43d6b7e3a86fe7acaeba450df9dff17f956fcf44e043496b` |
| `docs/DATABASE_DESIGN_SPEC.md` | `30efbddd375e1765f156746837d7a4d7f6a51df77e399b2b5b7f7bb2230f5df8` |
| `docs/sql/001_metadata_schema.sql` | `64b46b9f0afd9ff76441f506398f2f0e207ebc30e59ea21fa2ea3b249e9c308f` |
