## 第七章：工程目录结构与代码组织规范

### 7.1 Monorepo 模块化目录树规范

项目采用 **pnpm workspaces** 构建现代 TypeScript 全栈 Monorepo 仓库，确保业务数据契约共享、依赖版本统一与代码高内聚解耦。

```
mysql-mcp/
├── .github/                      # CI/CD 自动化流水线 (Lint, Test, Docker Build)
├── apps/
│   ├── gateway/                  # 【数据面】MCP 安全网关服务端 (Fastify v5, 端口: 8080)
│   │   ├── src/
│   │   │   ├── config/           # 网关环境变量解析与验证 (Zod 模式)
│   │   │   ├── adapters/         # 协议适配层 (Streamable HTTP, Legacy SSE, Stdio)
│   │   │   │   ├── streamable-http.adapter.ts  # 现代 POST /mcp 适配器
│   │   │   │   ├── legacy-sse.adapter.ts       # 遗留 /sse + /messages 适配器
│   │   │   │   └── stdio.adapter.ts            # 本地命令行标准 I/O 适配器
│   │   │   ├── pipeline/         # 10 步闭环标准处理流水线
│   │   │   │   ├── 01-auth.middleware.ts       # PAT 验签与短 TTL 授权快照
│   │   │   │   ├── 02-capacity.middleware.ts   # 在途并发与审计队列容量前置预留
│   │   │   │   ├── 03-ratelimit.middleware.ts  # 双重漏斗限流与死循环熔断
│   │   │   │   ├── 04-ast.middleware.ts        # AST 语法只读、表级 ACL 与 Fail-Closed 改写
│   │   │   │   └── 05-audit.middleware.ts      # 异步微批处理刷盘与应急日志追加
│   │   │   ├── mcp/              # MCP Tools 标准路由与处理器
│   │   │   │   ├── tools/        # 11 项 Tools 具体执行实现
│   │   │   │   └── server.ts     # MCP SDK 初始化与工具集注册
│   │   │   ├── index.ts          # 网关数据面服务启动入口
│   │   │   └── routes.ts         # 路由分发
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── admin-api/                # 【管控面】Web 控制台后端 REST API 服务 (端口: 8081)
│   │   ├── src/
│   │   │   ├── controllers/      # REST API 控制器 (用户、审批、数据源、审计等)
│   │   │   ├── middlewares/      # 全局中间件
│   │   │   │   └── force-change-pwd.guard.ts  # 后端全量 API 强制改密拦截网关
│   │   │   ├── services/         # 管控面业务逻辑
│   │   │   │   ├── auth.service.ts            # 账号注册登录、Argon2id 加密、防爆破
│   │   │   │   ├── approval.service.ts        # 审批流转与 Webhook 通知集成
│   │   │   │   ├── profile.service.ts         # 数据源 CRUD 与 AES-256 密钥环加解密
│   │   │   │   ├── pat.service.ts             # PAT 签发与即时失效广播
│   │   │   │   ├── audit.service.ts           # 审计流水多维检索与导出
│   │   │   │   └── bootstrap.service.ts       # 初始超管自举与最后 1 超管自锁保护
│   │   │   ├── index.ts          # 管控 API 启动入口
│   │   │   └── routes.ts         # /api/v1 路由分发
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── admin-ui/                 # 【管控面前端】现代化 Web 控制台 (React 19 + Vite 6)
│       ├── src/
│       │   ├── components/       # shadcn/ui 紧凑组件库 (Button, Sheet, Table, Badge 等)
│       │   ├── layouts/          # 全局“三纵两横一抽屉”骨架布局组件
│       │   │   ├── Sidebar.tsx   # 240px/64px 折叠侧边栏
│       │   │   ├── Topbar.tsx    # 56px 悬浮顶栏与全局搜索
│       │   │   └── InspectSheet.tsx # 560px 原位排查与审批抽屉
│       │   ├── views/            # 页面视图 (遵循 UI_DESIGN_SPEC 规范)
│       │   │   ├── Dashboard.tsx    # Bento 网格式安全与流量大盘
│       │   │   ├── Approvals.tsx    # 用户自主注册与管理员审批流
│       │   │   ├── Profiles.tsx     # 数据源配置与连通性测试
│       │   │   ├── Policies.tsx     # RBAC 角色与表级 ACL 策略
│       │   │   ├── Pats.tsx         # 个人 PAT 签发与一键复制客户端配置
│       │   │   └── Audits.tsx       # 全链路 SQL 审计与高危拦截排查
│       │   ├── stores/           # Zustand 客户端轻量状态
│       │   └── hooks/            # TanStack Query 服务端请求 Hooks
│       ├── tailwind.config.ts    # Tailwind CSS v4 与 OKLCH 设计令牌
│       ├── package.json
│       └── vite.config.ts
│
├── packages/
│   ├── core-ast/                 # 【公共内核】SQL AST 安全分析与 Fail-Closed 改写器
│   │   ├── src/
│   │   │   ├── parser.ts         # MySQL 8.0 语法解析封装
│   │   │   ├── scope-extractor.ts# 基于作用域栈的物理表提取 (嵌套 CTE/Alias/Subquery)
│   │   │   ├── validator.ts      # 严格只读白名单与高危指令拦截器
│   │   │   └── rewriter.ts       # Fail-Closed 动态 LIMIT 注入改写器
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── core-engine/              # 【公共内核】连接池治理与协议状态机复位
│   │   ├── src/
│   │   │   ├── pool-manager.ts   # 多 Profile 物理连接池与在途并发排队控制
│   │   │   ├── query-lifecycle.ts# query_instance_id 状态机与原子防误杀取消
│   │   │   ├── driver-reset.ts   # 驱动命令状态机 COM_RESET_CONNECTION (0x1F) 与 Fail-Destroy
│   │   │   └── ssh-tunnel.ts     # 原生 ssh2 堡垒机跳板机双工流隧道
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── security/                 # 【公共安全】深度防御与加密工具库
│   │   ├── src/
│   │   │   ├── ssrf.ts           # Post-DNS Resolution Check & IP Pinning 防御组件
│   │   │   ├── crypto-keyring.ts # 带 key_id 的 AES-256-GCM 密钥环加解密
│   │   │   ├── pat-hasher.ts     # HMAC-SHA-256 常量时间验签工具
│   │   │   └── masker.ts         # SQL 凭据与手机/邮箱 PII 敏感信息脱敏流水线
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── shared-types/             # 【公共契约】全栈统一 TypeScript 类型与 DTO 库
│       ├── src/
│       │   ├── mcp-tools.ts      # 11 项 Tools 入参与紧凑二维出参契约
│       │   ├── api-dtos.ts       # RESTful API 请求响应 DTO 结构
│       │   ├── entities.ts       # 系统元数据实体定义 (User, Profile, Audit 等)
│       │   └── error-codes.ts    # 全局错误码枚举
│       ├── package.json
│       └── tsconfig.json
│
├── docs/                         # 系统工程文档目录
│   ├── REQUIREMENTS.md           # 生产级闭环版需求规格说明书 (PRD v2.3.0)
│   ├── UI_DESIGN_SPEC.md         # 云原生零信任 Web UI 设计规范说明书
│   ├── LAYOUT_SPEC.md            # Web 控制台布局规范说明书
│   ├── FRONTEND_ARCHITECTURE_SPEC.md # Web 控制台前端实现架构设计说明书
│   ├── BACKEND_ARCHITECTURE_SPEC.md  # 后端实现架构详细设计说明书
│   └── ARCHITECTURE_SPEC.md      # 系统架构设计说明书 (本规范)
│
├── pnpm-workspace.yaml           # pnpm 工作区定义
├── package.json                  # 根项目脚本与开发依赖
├── tsconfig.base.json            # 共享严格 TypeScript 配置基线
└── docker-compose.yml            # 生产环境容器编排配置文件
```

---

### 7.2 模块职责边界与单向依赖约束

1. **单向依赖规则**：
   - `apps/gateway` 与 `apps/admin-api` 可以依赖 `packages/*`；
   - `packages/core-ast`、`packages/core-engine`、`packages/security` 严禁依赖任何 `apps/*`，确保高可测性与高内聚；
   - `packages/shared-types` 仅包含纯类型声明，零运行时依赖。
2. **凭据解密生命周期隔离**：
   - 数据源的真实明文密码与 SSH 密钥的解密操作，仅允许在 `packages/core-engine` 建立物理网络连接的瞬时发生，使用完毕立即垃圾回收，严禁在全局内存或日志中保留明文。

