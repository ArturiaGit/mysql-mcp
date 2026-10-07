# 系统架构

> 状态：拟采用方案，全部组件尚未实现。安全规则见[项目约束](./PROJECT_CONSTRAINTS.md)，契约见[接口](./API_AND_PROTOCOLS.md)。

## 1. 拓扑与职责

```mermaid
flowchart LR
    U[本地用户] --> B[浏览器管理页面]
    B -->|认证会话与 CSRF| H[回环 HTTP 管理服务]
    A[三个 AI 客户端] -->|各自 stdio| M[MCP 适配进程]
    M -->|内部认证通道| H
    H --> P[SQL 策略与审批服务]
    P --> E[MySQL 执行器]
    E --> D[(目标 MySQL)]
    H --> C[(非敏感连接配置)]
    H --> K[Windows 凭据存储]
    P --> J[(最小状态日志与审计)]
```

| 层 / 物理路径 | 责任 Agent | 责任 | 禁止 |
|---|---|---|---|
| web (`mysql-mcp/web/`) | Antigravity | 展示、输入、人工确认、设计系统与交互反馈 | 直接连 MySQL、存密码到 Web Storage、编写后端服务 |
| server/routes (`mysql-mcp/src/server/`) | PI-Desktop | 认证、结构校验、协议映射、回环监听 | 自建第二套审批逻辑、修改前端页面资产 |
| mcp (`mysql-mcp/src/mcp/`) | PI-Desktop | 工具适配、原生确认桥接、Stdio 协议 | 持有数据库密码、直接执行 SQL |
| approval (`mysql-mcp/src/sql/`) | PI-Desktop | 请求绑定、原子状态迁移、AST 策略判定、执行授权 | 将模型声明视为用户批准 |
| db (`mysql-mcp/src/db/`) | PI-Desktop | 分类、目标验证、连接池管理、资源控制、执行 | 自动提权、写入自动重试 |
| config/security/audit (`mysql-mcp/src/security/`) | PI-Desktop | 配置、Windows Keyring 凭据、脱敏、最小审计 | 将秘密写入普通文件 |

全栈物理隔离与分工详见[全栈分工规范](./FULLSTACK_DIVISION_SPECIFICATION.md)。依赖方向为入口→业务→基础设施，MCP 与 HTTP 共用同一业务服务。管理服务是单实例配置写入者；第二个实例启动应明确报错，不争抢状态文件。

## 2. 认证与秘密流向（Phase 2-A 落地实现）

1. **本地回环 Fastify 服务**：
   - 严格仅绑定 `127.0.0.1`，禁止监听外部网卡；
   - 强校验 `Host`（仅允许 `127.0.0.1:<port>` 或 `localhost:<port>`）与 `Origin`（强制同源），跨域外网请求直接 403 阻断；
   - 身份认证：通过控制台输出的 32 字节高熵随机 HEX 本地码（`local_code`）换取会话，单次使用、5分钟过期；限速每分钟最多 10 次尝试；
   - 会话与防 CSRF：基于内存管理（最多 16 会话，TTL 30 分钟），通过 `Set-Cookie: HttpOnly; Path=/; SameSite=Strict` 保持；所有状态变更请求校验 `x-csrf-token`；
2. **秘密绝不上浮**：
   - 密码仅通过页面 POST/PATCH 请求体直达服务端内存，随即写入 Windows Keyring；
   - 所有接口响应（连接列表、连接详情、错误消息）绝对剔除 `password` 与内部 `credential_ref`；
   - 错误响应统一通过安全错误白名单脱敏，严禁泄漏操作系统路径或原生数据库堆栈；
3. **威胁边界**：
   - 本地服务与 Keyring 无法抵御同一 Windows 用户上下文下的恶意进程；此安全边界公开披露。

## 3. 连接管理与存储架构（Phase 2-A 落地实现）

```mermaid
sequenceDiagram
    participant U as 浏览器/用户页面
    participant S as Fastify回环服务
    participant F as 文件存储 (connections.json)
    participant K as Windows Keyring
    U->>S: POST /api/v1/connections (带密码及CSRF)
    S->>S: 生成稳定UUID及校验输入
    S->>F: 阶段1：原子记账 (cleanup_refs 登记)
    S->>K: 阶段2：写入密码 (mysql-mcp:UUID)
    S->>F: 阶段3：原子写新配置并重命名
    S->>K: 阶段4：清理队列中废弃凭据
    S-->>U: 返回 201 及脱敏 ConnectionView
    U->>S: POST /api/v1/connections/:id/test
    S->>S: 获取连接使用锁 (加读计数)
    S->>K: 读取密码进行模拟握手/连通测试
    S->>S: 释放使用锁并归还并发额度
    S-->>U: 返回测试结果摘要 (connected/simulated/duration_ms)
```

1. **单写者文件存储 (`JsonMetadataStorage`)**：
   - 独占式排他创建 `.lock` 租约文件，防止双实例并发冲突；服务正常退出时自动删除 `.lock`；
   - 写入采用带 UUID 的临时文件 (`.tmp`)，经 `file.sync()` 强制落盘后，通过原子重命名（`rename`）覆盖原目标文件；
   - 故障关闭：若写入失败，原有配置完好无损；
2. **并发控制与连接锁**：
   - 读写互斥与使用锁：连接在测试执行期间持有活跃计数；若此时收到编辑或删除请求，服务端返回 `409 STATE_CONFLICT` 拒绝冲突操作；
   - 乐观并发控制：编辑与删除必须提供 `expected_version`，与当前配置版本一致才允许推进。

## 4. 写入与双通道确认

```mermaid
sequenceDiagram
    participant A as AI 客户端
    participant M as MCP 桥接
    participant S as 审批服务
    participant U as 真人
    participant D as MySQL
    A->>M: request_change（无确认参数）
    M->>S: 校验并创建准确请求
    alt 原生确认已验证可用
        S-->>M: 单次审批挑战
        M->>U: 客户端展示目标、SQL、风险
        U-->>M: 接受或拒绝
        M->>S: 对应挑战的原生响应
    else 原生不可用
        S-->>A: PENDING 与无令牌管理页地址
        U->>S: 已认证页面检查后批准或拒绝
    end
    S->>S: 原子检查版本、期限、状态及授权
    alt 有效批准
        S->>S: 持久记录 EXECUTING 后取得派发权
        S->>D: 执行一次准确 SQL
        D-->>S: 结果或连接中断
    end
    A->>M: get_change_status
    M->>S: 仅查询，不重新执行
    S-->>A: 状态与脱敏摘要
```

原生显式拒绝/取消为终态，不转网页重新尝试。原生协议未支持时可选择网页；如果挑战已发出但通道故障，应先撤销挑战并确保无法迟到批准，再切换，无法保证则取消请求重新申请。

## 5. 并发、故障及重启

- 请求 SQL、目标、连接版本冻结；所有审批入口争抢同一次原子状态转换。过期、资料变化、断开的请求不得启动执行。
- 执行期间锁住该连接的编辑/删除；不持有用户长时间审批等待期间的 MySQL 事务或行锁。
- SQL 内存保存；持久状态日志在派发前记 EXECUTING。重启将遗留 EXECUTING 标为 UNKNOWN，其他非执行等待请求失效；绝不重放 SQL。
- 如果状态日志无法可靠落盘，不开始写操作。日志写入成功但 SQL 尚未派发时崩溃，也可能保守报告 UNKNOWN，这是不承诺恰好一次的原因。
- 服务中断后 MCP 返回不可用或已有未知状态，不自动启动多个服务、不再次提交写请求。
- 执行取消需要处理驱动和服务端实际状态；关闭连接不等于服务器没有提交。结果不确定时通知用户向 DBA 核对。

具体字段和转换以[数据模型](./DATA_MODELS.md)为准。内部通道实现、文件锁和 Windows 原子持久化行为需测试，以上不是通过证据。

---

## 6. Phase 1-B 落地核心模块与物理边界

在 `mysql-mcp/src/` 中，系统已落地三大核心安全与协议原型，严格遵循模块正交性与关注点分离原则：

```text
mysql-mcp/src/
├── index.ts               // 顶层导出聚合器（惰性元数据与工厂重新导出，不产生自发网络/服务副作用）
├── security/
│   └── keyring.ts         // Windows Credential Manager 异步系统凭据封装 (ICredentialProvider / WindowsKeyringProvider)
├── sql/
│   ├── ast.ts             // 词法分号预查、node-sql-parser 解析适配与资源上限硬阈值
│   └── policy.ts          // L0~L3 风险分级矩阵、白名单校验器、指纹与摘要计算 (evaluateSql)
└── mcp/
    └── server.ts          // @modelcontextprotocol/sdk Stdio Server 原型工厂 (createMcpServer / startStdioServer)
```

1. **凭据安全模块 (`security/keyring.ts`)**：提供强类型安全异常，屏蔽底层系统堆栈，服务名为 `mysql-mcp:<connection-id>`，用户名统一为 `mysql-mcp`，生产环境绝对无明文后备；
2. **SQL 策略模块 (`sql/policy.ts` & `sql/ast.ts`)**：纯静态、纯内存 AST 策略校验，在 SQL 接触数据库之前完成 L0~L3 风险阻断，计算结构指纹与准确哈希；
3. **MCP 通信模块 (`mcp/server.ts`)**：实现标准 stdio 协议帧传输与进程生命周期监听（EOF/SIGINT/SIGTERM），工具未挂载时对未知调用返回标准错误且严格不回显传入参数。

