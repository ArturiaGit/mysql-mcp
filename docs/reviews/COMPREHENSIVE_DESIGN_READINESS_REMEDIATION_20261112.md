# 综合开发准入评审问题核验与整改记录

- 日期：2026-11-12（Asia/Shanghai）。
- 对应原始报告：`COMPREHENSIVE_DESIGN_READINESS_REVIEW_20261112.md`。
- 范围：RD-01～RD-09。当前仓库是设计文档、演示及校验脚本，尚无完整应用工程。
- 结论：**8项技术问题均确认属实，并完成设计正文、生成源和相关示例的修订；RD-08仍是待责任人确认的决策门禁。不能将此记录理解为生产代码、真实数据库或发布验收已经通过。**
- 保留原报告、反例探针与历史证据，不修改其当时结论；本次使用独立的正向验收及证据文件。

## 1. 逐项查验和处理

| 编号 | 查验结论 | 本次修订 | 当前状态及边界 |
| --- | --- | --- | --- |
| RD-01 / P1 | 创建分配counter，更新仅增业务行，确有ABA；SQL列名也不匹配 | API §6.7.4改为创建/更新共用counter分配，用户→计数器→规则锁序；使用qpm_limit；revision/version绑定同一新值；删除保留counter；同事务审计与失败回滚。后端§4.4.3同步Repository协议 | 设计修复；顺序模型覆盖创建1→更新2→更新3→删除→重建4、旧更新/删除全部拒绝、审计回滚及溢出。真实MySQL双连接待实施 |
| RD-02 / P1 | +08:00确会错读UTC时间 | 驱动Z；每次借连接等待session UTC设置，失败销毁连接；事务入口及非事务查询适配器共用初始化。启动时RegistryHub/AuditEngine接收安全查询入口；元数据示例改用UTC_TIMESTAMP(3) | 真实mysql2编码/解码保持UTC毫秒，Intl显示边界通过；连接失败关闭、释放和真实mysql2类型声明检查通过。没有数据库/浏览器往返 |
| RD-03 / P1 | 两份内嵌DDL与14表权威SQL不一致 | 删除架构/后端内嵌建表SQL，统一引用001_metadata_schema.sql；后端补Repository列/约束映射。保留14表结构，空库脚本新增唯一内部初始化标记种子 | 单一物理基线及静态检查通过；空库SQL尚未在MySQL执行，不提供生产迁移脚本 |
| RD-04 / P2 | GET username不能满足前端必填user | 区分ProfileReadDTO与Create/UpdateProfilePayload；ProfileDTO仅作读模型兼容别名；显式username→user表单映射，排除秘密及只读字段 | 原契约响应经TypeScript strict检查通过，恢复旧user声明的反向检查失败；未运行页面 |
| RD-05 / P2 | 全局burst、导出profile_id与SSH指纹存在遗漏/漂移 | 前后端矩阵对齐字段；从契约字段表生成请求类型/原约束记录/真实示例；概要矩阵明确非完整签名 | 类型正反向检查通过；生成类型是形状层，不替代范围、枚举、条件校验 |
| RD-06 / P2 | 两份矩阵均漏3项，只有44/47 | 加入reset-password、DELETE用户覆盖、export/download；补守卫、版本、失效、Ticket先CAS后发流及前端行为；生成47项实施分工与测试计划 | 精确方法+路径47/47；Controller/Schema/Service/Repository是设计任务归属，不声称已有实现或HTTP测试 |
| RD-07 / P2 | 后端JOIN锁与DB稳定锁点未统一，API也有汇总锁示例 | 全部采用永久SUPER_ADMIN角色锁→按ID锁用户→锁绑定的当前读协议；API/后端/DB同步；明确启停、授予/撤销、审批授予、删除、自举入口及有限重试边界 | 提取真实guard片段验证锁序、最后超管、本人保护及不误拦无关本人角色变更；未证明InnoDB并发调度 |
| RD-09 / P2 | 无ACTIVE超管就自动创建admin，确与人工恢复原则冲突 | 仅空库DDL植入PENDING；除标记外14表为空才能自举；角色/配置/超管/管理审计/READY同事务提交。READY重启只校验。标记缺失、PENDING非空、READY无超管均拒绝ready并要求人工恢复 | 提取BootstrapService实际控制流验证首次、重启、异常库、审计失败回滚和提交后密码交付失败；密码不写普通日志；真实事务/恢复演练待实施 |

自举标记是启动专用互斥点，不向配置API开放；锁在业务锁之前获取的例外已在数据库§7.1声明。历史库没有该标记不能自动当作新库，须由DBA审计核验后登记READY。新库全局burst暂按数据库原有值10；旧15不会在重启时被覆盖。

## 2. RD-08：保留决策门禁，不代替负责人签署

| 项目 | 当前文本与处理 | 仍需确认 |
| --- | --- | --- |
| 新库GLOBAL burst | 示例统一为数据库既有暂定10；旧值不覆盖；PUT请求中15仍是合法用户配置示例，不是默认值 | 产品/安全确认默认值 |
| 库级ACL通配 | 沿用v1.0精确名；前端帮助、API校验及历史规则迁移提示同步，表级星号模式不变 | 安全/接口维护者确认当前范围；扩大能力须单独设计 |
| USER/ROLE/GLOBAL语义 | 保留已对齐的角色优先语义，不重开旧问题 | 接口维护者与产品提供签署证据 |
| DST日桶 | 保留23/25小时自然日与固定1440分钟之间的待决事项 | 接口维护者选择实际桶长、规范化口径或时区限制 |
| daysRemaining取整 | 维持数据库建议：ceil、最小0、关闭为-1；未伪装为已批准契约 | 前后端/产品确认边界文案 |

## 3. 版本与可再生成性

| 文档 | 新版本 |
| --- | --- |
| 系统架构 | v1.2.2 |
| 后端详细设计 | v1.7.2 |
| 前端详细设计 | v1.4.2 |
| 接口契约 | v1.5.2 |
| 数据库设计 / 空库SQL标识 | v1.0.2 |

四份正文均由源分片重新合成；数据库设计与SQL直接维护。旧contract_generators和前端单文件生成器已改为调用当前combine入口，防止重生成旧稿覆盖修订。其他历史一次性补丁脚本不属于当前构建入口。

新增 `docs/contracts/` 包含8组生成请求形状、Profile读类型、删除查询规范化类型、契约响应/请求fixtures、字段约束来源与47项接口追踪。运行时Schema、共享包集成及真实Mock服务仍属应用实施工作。

## 4. 实际验证结果

| 验证 | 结果 | 证据边界 |
| --- | --- | --- |
| 数据库静态校验/顺序模型 | 1067断言通过；14表、136列、45索引、7外键、47接口 | 不代表MySQL接受DDL |
| 原静态检查器反向测试 | 3/3通过 | 检查器反向变异 |
| 本次正向整改探针 | 15/15组通过 | 真实TS strict与mysql2解析/编码；提取片段配受控连接；顺序模型 |
| 生成产物漂移检查 | 通过 | 四份正文与分片、请求类型、fixture、47项追踪一致 |
| 数据库既有整改 | 15/15通过 | 临时副本重跑 |
| 数据库第二轮独立观察 | 7/7组通过 | 临时副本重跑 |
| 四文档第四轮历史回归 | 96/96通过 | 有下述两处提取适配；断言不变 |
| 后端第八轮限定回归 | 4/4通过 | 既有审计/限流范围；不是后端全部历史73项重跑 |

首次直接套用历史测试时，旧测试因硬编码提取 `interface ProfileDTO` 而停止，这不是应用运行失败。为适配有意进行的结构修订，临时副本中仅作两处提取改动：

1. CR-01从唯一SQL脚本读取物理列，不再从已删除的正文DDL取列。
2. CR-10检查ProfileReadDTO，原ProfileDTO现为兼容别名；原ID字符串断言不变。

没有修改仓库内历史测试或证据，没有把历史反例探针改成“通过”。新的正向探针独立检查本轮问题。历史限定回归的适配和边界完整记录在新的汇总证据中。

## 5. 复核命令与文件

```powershell
node scripts/combine_arch.js
node scripts/combine_be_spec.js
node scripts/combine_fe_spec.js
node scripts/combine_contract.js
python scripts/generate_readiness_contracts.py
python scripts/generate_readiness_contracts.py --check
python scripts/validate_database_design.py
python -m unittest discover -s scripts -p test_validate_database_design.py

# 使用本机已存在的独立依赖，不安装新依赖、不连接数据库。
$deps = Join-Path $env:TEMP 'mysql-mcp-design-review-20261108'
$extra = Join-Path $env:TEMP 'mysql-mcp-cross-review-20261111'
$env:NODE_PATH = "$deps\node_modules;$deps\r3-extra\node_modules;$extra\node_modules"
$node = Join-Path $deps 'r2-node22\node_modules\node\bin\node.exe'
& $node docs/reviews/comprehensive-design-readiness-20261112.remediation.test.cjs
python scripts/run_readiness_regressions.py --node $node
```

- 正向脚本：`comprehensive-design-readiness-20261112.remediation.test.cjs`。
- 正向证据（当前文件SHA-256及验证边界）：`comprehensive-design-readiness-20261112.remediation.evidence.json`。
- 历史回归汇总（当前受测哈希、适配、嵌入原回归结果及临时路径）：`comprehensive-design-readiness-20261112.remediation.regression.json`。
- 47项追踪：`../contracts/ENDPOINT_TRACE.md`。

## 6. 尚未执行的实施/准入门禁

真实MySQL小版本上的DDL/CHECK/FK/排序规则、UTC毫秒与大ID往返；限流双连接竞争；超管并发变更/死锁；自举崩溃恢复；真实Repository→快照失效；HTTP和浏览器联调；KILL/TLS/SSH/SSRF、压力、备份恢复与RPO/RTO。

**本次完成有限范围的文档和可执行示例收口，不代替产品签署，也不把“开始开发前必须先完成应用集成验收”当作要求。RD-08按责任人确认后，受影响模块按原准入顺序进入实施。**
