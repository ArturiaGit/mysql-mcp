# 技术选型

> 状态：选型草案，依赖未安装。用户已确认优先 Node.js / TypeScript；其余选择不是已实现功能。

## 1. 选型矩阵

| 领域 | 拟选 | 理由 | 落地前验证 |
|---|---|---|---|
| 语言/运行时 | TypeScript、Node.js | 符合用户偏好，便于 MCP 生态集成 | strict 类型检查、Windows 运行 |
| 包管理 | npm | 本机已可用，单项目不必引入 workspace | 锁文件、可复现安装 |
| MCP | @modelcontextprotocol/sdk | 官方 TypeScript SDK | stdio、版本协商、elicitation 生命周期 |
| MySQL | mysql2 | 原生协议驱动，不依赖 mysql 命令行 | 认证插件、TLS、类型精度、取消语义 |
| 管理 HTTP | Fastify | 轻量路由与参数校验 | Cookie、CSRF、Host/Origin、防日志泄露 |
| SQL 分类 | node-sql-parser + [策略矩阵](./SQL_POLICY_MATRIX.md) | AST 辅助对象及操作识别，详见策略四级模型 | MySQL 子语法矩阵及绕过负面用例 |
| 系统凭据 | @napi-rs/keyring + [多环境凭据抽象](./DATA_MODELS.md#7-凭据提供者接口与异常脱敏规范) | 生产 Windows 系统存储，CI/测试采用 In-Memory 桩 | 跨平台离线测试、虚构凭据 CRUD/重启 |
| 本地 UI | HTML/CSS/TypeScript | 连接与审批页面较少，控制复杂度 | 构建、可访问性、XSS 防护 |
| 测试 | [测试分层与沙箱规范](./TESTING_STRATEGY.md) | 纯内存单测 + Fake MySQL 连接桩，严禁直连库 | Windows 性能防超时及协议完整覆盖 |

本机检查得到 Node.js v24.16.0、npm 11.13.0，仅证明命令可运行，不据此宣称最低兼容版本。依赖实际版本、最低 Node 版本须在安装和测试后记录，并固定锁文件；构建规范见[应用工程化脚手架](./ENGINEERING_TOOLCHAIN.md)。

## 2. 工程布局（详见 [工程化规范](./ENGINEERING_TOOLCHAIN.md)）

```text
工作区/
├── docs/                   规范（本次交付）
├── mysql-mcp-memory.md     原始历史记忆
└── mysql-mcp/              未来应用，当前不存在
    ├── src/server/         HTTP 入口
    ├── src/mcp/            stdio 协议适配
    ├── src/db/             SQL 策略与执行
    ├── src/approval/       审批状态服务
    ├── src/config/         配置持久化
    ├── src/security/       凭据、认证、脱敏
    ├── src/audit/          最小审计
    ├── src/web/            本地页面
    └── tests/              单元、集成与界面测试
```

运行数据拟位于 `%LOCALAPPDATA%/MySQLMCP/`，不与源代码混放。不将连接配置存入待查询的 MySQL，不要求新增 Redis、独立队列或云服务。

## 3. 依赖决策规则

- 先确认必要性、官方来源、维护情况、许可证和安全影响；记录直接依赖及原生安装脚本。
- 解析器只辅助分类，不能承诺所有 SQL 正确识别。不能为了支持一条语句关闭策略检查。
- 凭据模块失败不得降级明文；先报告可复现原因，替代模块或 DPAPI 方案需重新评估。
- 连接池若使用，必须按连接版本隔离并清理会话状态；是否采用池在资源验证后确定。
- 不照搬参考项目的 React/NestJS/Go/Prisma，也不将当前轻量 UI 草案变成用户已锁定的框架要求。

## 4. 首批验证输出

实施阶段需产出：依赖版本清单、Windows 原生模块结果、SQL 支持矩阵、驱动超时/断连行为、MCP 客户端兼容证据。检查和状态记录见[代码审查](./CODE_REVIEW.md)与[部署指南](./DEPLOYMENT_GUIDE.md)。未获得软件实施授权前不执行安装。
