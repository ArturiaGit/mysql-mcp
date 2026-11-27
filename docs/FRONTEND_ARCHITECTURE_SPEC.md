# MySQL MCP 企业级网关与管控平台 - Web 控制台前端实现架构详细设计说明书 (Frontend Detailed Architecture Specification)

| 文档版本 | 发布日期 | 状态 | 适用范围 | 密级 |
| :--- | :--- | :--- | :--- | :--- |
| **v1.4.2** | 2026-11-12 | **数据库评审修订版；待联调验收** | **前端工程研发、前后端联调、接口验收与测试用例编写** | **内部公开** |

## 开发准入整改（v1.4.2 / 2026-11-12）

核验并修订 RD-01/02/03/04/05/06/07/09：持久限流版本、UTC连接、单一DDL、读写DTO、请求字段、47项接口追踪、超管锁序与首次自举标记。
RD-08 产品/接口签署仍待确认；新库burst暂按数据库既有值10，库级ACL按既有v1.0精确名，不代表新增产品批准。
验证范围及未完成的真实MySQL/HTTP/浏览器门禁见 `docs/reviews/COMPREHENSIVE_DESIGN_READINESS_REMEDIATION_20261112.md`。

## 数据库评审修订（v1.4.1 / 2026-11-12）

DB-R1-02：区分已保存覆盖与有效配额，修正移除覆盖提示及大盘取值来源。 本次为文档与可执行片段修复，不代表应用或真实数据库已验收；接口/产品签署与联调门禁见数据库设计 §15.1。

---

## 修订说明 (Revision Preface - v1.4.0 深度收口终审修订)

本版本在 v1.3.1 的基础上，针对架构评审委员会第五轮复审指出的 7 项核心工程契约与 4 项设计细节进行了最终收口，彻底消除了重定向绕过、守卫死锁、请求取消信号失效与大数截断隐患：

1. **`sanitizeReturnUrl` 路径穿越与协议相对 URL 彻底根治（§4.1）**：
   - 彻底修复 `pathname` 产生双正斜杠（`//`）导致的协议相对跳转漏洞（如 `/a/..//example.org` 逃逸），增加二次严格前缀校验，杜绝任何外部重定向风险。
2. **账号状态页与守卫顺序解耦（§4.1 与 §4.2）**：
   - 明确 `/me` 在有效 Cookie 下即使为受限状态（PENDING/REJECTED/DISABLED）均返回 HTTP 200 及最小状态信息，由 `StatusGuard` 分流，解开与 `AuthGuard` 的死锁环；
   - 明确守卫严格执行顺序：`AuthGuard` ➔ `StatusGuard` ➔ `MustChangePwdGuard`（**仅对 ACTIVE 用户生效**）➔ `RoleGuard`，彻底消除未审用户被强制改密的死循环。
3. **请求取消引入 `SessionRequestManager` 代际管理（§4.1）**：
   - 废除单例 AbortController，引入支持 `abortAndRotate()` 的代际管理器；
   - 明确登出执行顺序：先掐断旧业务请求，再通过独立的 5s 超时信号发起 `/auth/logout`，最后清空本地缓存，杜绝登出请求被自身取消及新会话信号失效。
4. **64 位大整型 JSON 序列化强类型契约（§3.3 与 §8.2）**：
   - 服务端契约明确：对超过 $2^{53}-1$ 的大整型 ID（如 `sys_audit_logs.id`），输出 JSON 时**必须强制序列化为字符串**，防止前端 `JSON.parse()` 阶段发生静默四舍五入与精度丢失；前端 DTO 显式对齐为 `string`。
5. **CSRF Token 刷新单飞 Promise 与重试边界（§3.3 与 §4.1）**：
   - 引入 Single-Flight Promise 合并并发 CSRF 刷新请求；
   - 明确服务端在执行任何写逻辑前完成 CSRF 校验，确保 `ERR_CSRF_INVALID` 无副作用，前端安全重试一次；改密成功换 Session 后主动重新获取 Token。
6. **Profile 字段纠偏与角色策略完整性（§8.1 与 §8.2）**：
   - 将 `ProfileDTO` 字段纠正为主架构 DDL 的 `queue_timeout_ms`（排队超时）；
   - 角色更新端点完整覆盖主架构的默认 LIMIT、最大 LIMIT、超时时间与配额字段。
7. **后端协同清单客观事实归位（§8.3）**：
   - 客观更正版本控制条目为“需后端确认版本来源方案及 409 机制”；
   - 补齐拆分限流路由、审计导出结构、大整型 string 传输等协同项。
8. **四处细节清理**：
   - 抽屉移除未实现的沙盒演练动作，仅保留【复制脱敏 SQL】；
   - 路线图彻底删除残留的“PAT 吊销”；
   - 规范 `profile_id = "0"` 表示全局 ACL 规则；
   - 增设普通研发专用的轻量 Profile 选项接口 `GET /api/v1/profiles/my-options`，不泄露运维配置。

---

## 目录索引 (Table of Contents)

1. [第一章：系统定位与前端架构边界](#第一章系统定位与前端架构边界)
   - 1.1 业务定位与控制台边界
   - 1.2 双用户角色诉求模型 (SecOps/DBA vs AI/业务研发)
   - 1.3 前端四大核心架构支柱 (4 Architectural Pillars)
   - 1.4 功能分期与交付边界界定 (v1.0 Baseline vs v1.1 RFC vs Out of Scope)
2. [第二章：技术选型与架构决策记录 (ADR-UI)](#第二章技术选型与架构决策记录-adr-ui)
   - 2.1 ADR-UI-01: React 19 + Vite 6 + TypeScript 严格模式基线
   - 2.2 ADR-UI-02: Tailwind CSS v4 现代 @theme 与 OKLCH 双模式排版
   - 2.3 ADR-UI-03: shadcn/ui (radix-nova) 紧凑组件裁剪与矢量图标规范
   - 2.4 ADR-UI-04: 服务端缓存 (TanStack Query v5) 与瞬态 UI 状态 (Zustand) 解耦
   - 2.5 ADR-UI-05: 态势感知通道 (v1.0 轮询基线与 v1.1 SSE RFC 规范)
   - 2.6 ADR-UI-06: CodeMirror 6 轻量 SQL 差异高亮与按需虚拟滚动
3. [第三章：Monorepo 工程化组织与契约边界](#第三章monorepo-工程化组织与契约边界)
   - 3.1 `apps/admin-ui` 模块目录树规范
   - 3.2 共享契约 `packages/shared-types` 纯类型边界 (0 运行时依赖)
   - 3.3 本地 Zod 校验模式、独立推断双向测试与大整型安全
4. [第四章：零信任前端安全机制与全生命周期状态机](#第四章零信任前端安全机制与全生命周期状态机)
   - 4.1 认证与会话生命周期管理 (HttpOnly Cookie + CSRF 单飞刷新 + 严格同源重定向)
   - 4.2 账号生命周期全状态机与分层守卫执行顺序
   - 4.3 首次登录强制改密全量路由守卫 (`MustChangePwdGuard`)
   - 4.4 事务级超管防自残与本人操作保护 (`AntiSelfLockout` & `SelfActionGuard`)
   - 4.5 个人访问令牌 (PAT) 凭据生命周期与配置生成三态模型
   - 4.6 数据源连通性测试三大工作模式 (已存 / 草稿 / 新增)
   - 4.7 SSRF 拦截场景的精准交互引导 (受控出站白名单认知)
   - 4.8 并发配置修改冲突控制 (乐观锁与草稿保留)
5. [第五章：全局骨架布局拓扑与四大业务场景范式](#第五章全局骨架布局拓扑与四大业务场景范式)
   - 5.1 全局骨架：“三纵两横一抽屉”拓扑规范与精确断点
   - 5.2 范式一：安全态势运维大盘 (Profile 维度对齐的 QPM 双折线对比)
   - 5.3 范式二：全链路审计与日志检索 (真实物理字段收敛与 URL 直达回补)
   - 5.4 范式三：策略矩阵与限流控制台 (黑名单置顶 + 多角色合并决策展示)
   - 5.5 范式四：开发者自服务门户 (三态 PAT 配置片段生成器)
6. [第六章：状态管理模型与唯一事实来源 (SSOT)](#第六章状态管理模型与唯一事实来源-ssot)
   - 6.1 服务端状态缓存机理 (TanStack Query: SWR、非敏感乐观更新、失效策略)
   - 6.2 唯一事实来源：URL SearchParams 状态机驱动
   - 6.3 客户端瞬态 UI 状态 (Zustand)
7. [第七章：页面—路由—权限 RBAC 矩阵表](#第七章页面路由权限-rbac-矩阵表)
8. [第八章：页面—接口—DTO 契约映射表与后端协同清单](#第八章页面接口dto-契约映射表与后端协同清单)
   - 8.1 核心 RESTful API 路由映射矩阵 (全量补齐)
   - 8.2 核心 DTO 字段结构定义 (空值容忍与大整型字符串契约)
   - 8.3 后端协同确认契约清单 (Backend Collaboration Tracker)
9. [第九章：异常防御、错误码自愈映射与设计令牌体系](#第九章异常防御错误码自愈映射与设计令牌体系)
   - 9.1 后端标准错误码与前端自愈指引映射表 (Error Code Matrix)
   - 9.2 全局 React Error Boundary 弹性降级机制
   - 9.3 OKLCH 双模式色彩令牌与 WCAG 2.1 AA 对比度基准
10. [第十章：工程验收准则与自动化测试矩阵](#第十章工程验收准则与自动化测试矩阵)
    - 10.1 单元测试与双向契约测试规范 (Vitest --typecheck)
    - 10.2 端到端核心业务验收测试链路 (Playwright E2E)
    - 10.3 性能预算基线 (Bundle Size Budget & LCP)
11. [第十一章：前端实施里程碑与排期计划 (Phased Roadmap)](#第十一章前端实施里程碑与排期计划-phased-roadmap)

---

## 第一章：系统定位与前端架构边界

### 1.1 业务定位与控制台边界
MySQL MCP Server 是面向企业大模型（LLM/Agent）访问私有数据库的集中式安全网关。前端控制台工程（`apps/admin-ui`）是整个系统的**可视化管控面（Control Plane Portal）**，运行于独立端口 `8081`（生产环境下由 Nginx 统一反向代理或由 `admin-api` 托管静态资源）。

前端严密遵守控制面与数据面的**物理与逻辑隔离**：
- 前端**绝对不直接接触** MySQL 物理数据库驱动、不运行任何连接池代码；
- 前端**绝对不直接接入** MCP 协议通道（Stdio / SSE / Streamable HTTP `POST /mcp`）；
- 前端**纯粹通过 RESTful API（`/api/v1/*`）** 与 `apps/admin-api` 进行受控交互，所有涉及数据库凭据、连通性测试、AST 语法分析等操作均交由后端安全管道执行。

### 1.2 双用户角色诉求模型 (SecOps/DBA vs AI/业务研发)
控制台在同一套界面框架内，必须优雅协同两类目标用户截然不同的交互心智模型：

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                控制台双角色诉求映射模型                                │
├────────────────────────────────┬───────────────────────────────────────────────────────┤
│ 角色 A: SecOps / DBA / 超级管理员 │ 角色 B: AI / 后端业务研发工程师                       │
├────────────────────────────────┼───────────────────────────────────────────────────────┤
│ · 诉求 1: 毫秒级态势感知 (高危拦截即时报警) │ · 诉求 1: 极简自服务 (快速签发个人 PAT 令牌)          │
│ · 诉求 2: 极高数据密度 (单屏展示海量审计)   │ · 诉求 2: 客户端接入向导 (Claude Desktop / Codex 片段)│
│ · 诉求 3: 零心流中断 (抽屉排查替代整页跳转) │ · 诉求 3: 个人权限边界可预期 (清晰查看已授权 Profile) │
│ · 诉求 4: 空间化安全控制 (黑名单置顶/双漏斗)│ · 诉求 4: 查询报错可自愈 (清晰知晓被拒原因与纠正建议) │
└────────────────────────────────┴───────────────────────────────────────────────────────┘
```

### 1.3 前端四大核心架构支柱 (4 Architectural Pillars)
1. **零心流中断 (Zero Flow Disruption)**：排查高危 SQL、查看审计流水与处理注册审批工单时，**严禁频繁跳出整页**，统一基于右侧滑出抽屉（`InspectSheet`）呈现上下文，主列表视线与滚动位置始终保持锚定。
2. **安全规则空间化 (Spatialized Security Rules)**：系统底层的关键安全原则在空间视觉上直接体现。
   - 表级 ACL 规则编辑器中，“黑名单红框危险区”**绝对置顶**于白名单之上，直观表达“拒绝规则具有最高优先级”；
   - 双重漏斗限流中心将“主体配额桶”与“Profile 资源保护桶”垂直堆叠，并以等宽逻辑符号 `[ ∧ AND ]` 串接，直观表达双桶并行的保护机制。
3. **高承载密度 (Data-Dense 8/10)**：表格行高精确控制在 **36px~38px**，栅格间距 12px~16px，全量代码与监控指标强制开启等宽数字（`tabular-nums`），拒绝消费级 Web 应用无意义的大留白，保证 1080P/2K 屏幕下的单屏吞吐力。
4. **防呆与防自残保护 (Fail-Closed & Anti-Self-Lockout)**：
   - 针对超级管理员的操作，前端在 UI 组件层实施硬锁闭（Disabled + 锁图标 + 告警 Tooltip），阻断最后 1 名活跃超管被禁用或降级，并禁止操作当前登录人自身；
   - 首次登录强制改密拦截（`MustChangePwdGuard`），改密完成前全站路由物理级锁定；
   - 个人 PAT 令牌实施“单次展示与风险二次确认”，关闭即彻底销毁内存中的明文变量。

### 1.4 功能分期与交付边界界定 (v1.0 vs v1.1 vs Out of Scope)
根据系统主架构 §6.2 现有接口与数据模型，明确划分功能实施范围：

| 划分维度 | 包含功能清单 | 依赖与约束边界 |
| :--- | :--- | :--- |
| **v1.0 工程实施基线 (本期范围)** | 1. 账号认证、注册审批与首次登录强制改密全生命周期状态机；<br>2. 个人中心 PAT 签发（单次展示）、吊销与三态客户端配置生成；<br>3. 用户生命周期管理、超管防自残硬锁定与本人操作保护；<br>4. 数据源 Profile CRUD 与三模式连通性测试 (已存/草稿/新增)；<br>5. 角色 CRUD 与库表 ACL 黑白名单空间化编辑矩阵；<br>6. 双重漏斗限流与死循环熔断阈值多目标配置；<br>7. 全链路审计高密度表格检索与只读 `InspectSheet` 抽屉 (带 URL 直达回补)；<br>8. 审计脱敏日志导出 (`POST /api/v1/audits/export`)；<br>9. 系统通知渠道配置 (`/api/v1/settings/notifications`)；<br>10. Bento Grid 大盘基于 Profile 维度的短轮询（10s）指标刷新。 | 严格以主架构 §6.2 现有 RESTful 接口与 `sys_audit_logs` 物理表结构为事实边界。 |
| **v1.1 RFC 待批特性 (后续规划)** | 1. `GET /api/v1/audits/live` SSE 实时告警单向长连接推送；<br>2. `POST /api/v1/policies/simulate-ast` 在线 AST 沙盒实时演练接口；<br>3. TLS 证书文件上传与 SSH 私钥拖拽解析；<br>4. 普通研发人员专用“个人历史查询流水”独立页面。 | 须经后端架构评审会批准并正式纳入 `ARCHITECTURE_SPEC.md` 后方可启动前端开发。 |
| **Out of Scope (本期不提供)** | 1. 前端控制台直接连库执行任意 SQL 的交互式编辑器；<br>2. 前端主动发起向在途数据库连接发送 KILL QUERY 的操作（当前管控面未暴露 KILL 端点，KILL 属于数据面内部状态机）。 | 控制台当前不予提供。若未来开放管理 KILL 端点，需重新设计权限与审计闭环。 |

---

## 第二章：技术选型与架构决策记录 (ADR-UI)

### 2.1 ADR-UI-01: React 19 + Vite 6 + TypeScript 严格模式基线
- **决策结论**：采用 **React 19** + **Vite 6** 作为前端核心基础，开启严格模式 TypeScript 5.7+。
- **架构决策依据**：
  1. **现代客户端渲染原语**：React 19 提供完善的非受控表单 Transitions 与 Actions 状态流转机制（`useActionState`、`useOptimistic` 用于非安全敏感 UI 交互），在 SPA + RESTful 架构下提供清晰的高性能组件渲染体验；
  2. **Vite 6 极速构建**：具备毫秒级 HMR 热更新与 Rollup 高性能代码分割，通过现代浏览器 ESM 支持保证轻量级极速研发体验；
  3. **严格类型防线**：在 `tsconfig.json` 中启用 `strict: true`、`noImplicitAny: true` 与 `noUncheckedIndexedAccess: true`，消除空指针异常隐患。

### 2.2 ADR-UI-02: Tailwind CSS v4 现代 @theme 与 OKLCH 双模式排版
- **决策结论**：全面引入 **Tailwind CSS v4**，废除旧式 `tailwind.config.ts`，基于现代 **OKLCH** 色彩空间，在 CSS 内通过 `@theme` 与原生变量分别构建 Dark Mode（默认）与 Light Mode 调色板；严格满足 WCAG 2.1 AA 对比度基准。
- **架构决策依据**：
  1. **OKLCH 感知亮度一致性与对比度保障**：OKLCH 空间解决了传统 sRGB 与 HSL 在不同色相下感知亮度抖动的问题，但设计系统不盲目假设“OKLCH 自动安全”，而是严格测量关键前景色与背景色组合，确保普通文本对比度 `>= 4.5:1`、大文本与组件边框对比度 `>= 3.0:1`；
  2. **双引擎排版解耦**：
     - **UI 功能文本引擎**：`Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif`；
     - **技术数据排版引擎**：`"JetBrains Mono", Consolas, monospace`，并全局强制声明 `font-variant-numeric: tabular-nums`，彻底杜绝 QPM、执行耗时、内存字节数跳动导致的视觉抖动。

### 2.3 ADR-UI-03: shadcn/ui (radix-nova) 紧凑组件裁剪与矢量图标规范
- **决策结论**：选用 **shadcn/ui**（基线采用 Radix Primitives），在本地代码树维护紧凑型组件库；**全面采用标准矢量图标（Lucide Icons），严格禁止在正式控制台 UI 文案中直接裸写 Emoji**。
- **架构决策依据**：
  1. **无运行时黑盒**：代码直接落地于 `src/components/ui/`，团队对 DOM 结构、事件冒泡与样式具有 100% 裁量权；
  2. **空间密度定制**：基于规范将默认组件的 Padding/Margin 裁剪至 Density 8/10 级别（例如 Button 默认高度裁剪至 32px/36px，Table 单元格行高裁剪至 38px）；
  3. **企业级视觉规范**：Emoji 在不同操作系统（Windows/macOS/Linux）下色彩与渲染尺寸严重不一致，破坏工业级基础设施软件的严肃性。所有警告、状态、操作指示统一采用 SVG 矢量图标（如 `<Icon name="shield-alert" />`、`<Icon name="circle-check" />`）。

### 2.4 ADR-UI-04: 服务端缓存 (TanStack Query v5) 与瞬态 UI 状态 (Zustand) 解耦
- **决策结论**：严格将“服务端异步缓存”与“客户端纯 UI 状态”彻底解耦。
- **架构决策依据**：
  1. **禁止混用全局 Store**：严禁将 API 数据（如用户列表、审计日志）存入 Zustand 全局变量中，避免冗长样板代码与脆弱的手工缓存失效逻辑；
  2. **TanStack Query 统一托管服务端数据**：利用 SWR 机制、自动请求去重、窗口聚焦重新校验（`refetchOnWindowFocus`）与基于 Query Key 的自动化缓存清除；
  3. **Zustand 专注纯客户端瞬态交互**：仅负责管理无法序列化到 URL 的高频 UI 状态（侧边栏展开/折叠、主题模式、全局搜索浮层唤起）。所有具有排查、分享语义的状态（事件 ID、页码、筛选）全部交由 URL 驱动。

### 2.5 ADR-UI-05: 态势感知通道 (v1.0 轮询基线与 v1.1 SSE RFC 规范)
- **决策结论**：
  - **v1.0 基线实现**：大盘监控采用 TanStack Query 优雅的短轮询机制（`refetchInterval: 10000ms` 查询 `/api/v1/audits/stats`），无须依赖未在主架构 §6.2 正式入库的长连接接口；
  - **v1.1 演进规范 (RFC)**：若后续接入 `GET /api/v1/audits/live` (SSE)，必须同时落地三项硬契约：
    1. **服务端权限严格过滤**：后端必须根据请求 Cookie 的身份进行事件裁剪，普通研发人员仅接收本人发起的查询事件，绝不允许向全员广播全网关审计流；
    2. **客户端告警频控与防抖**：当突发流量产生高频拦截时，前端实施 5 秒滑动窗口频控，至多展示 1 条聚合告警 Toast（“检测到 12 次高危拦截”），防止告警风暴阻塞主线程；
    3. **标准重连状态机**：利用标准 `Last-Event-ID` 支持断线重连补齐；一旦连接中断超过 60 秒，无缝降级回短轮询机制。

### 2.6 ADR-UI-06: CodeMirror 6 轻量 SQL AST 差异高亮与按需虚拟滚动
- **决策结论**：放弃动辄数兆体积的 Monaco Editor，选用轻量模块化的 **CodeMirror 6** 进行只读 SQL 渲染与改写对比；对于海量日志列表采用 **TanStack Virtual** 虚拟滚动。
- **架构决策依据**：
  1. **极轻包体积**：CodeMirror 6 核心压缩后仅约 40KB，初始化速度极快；
  2. **差异高亮精准表达**：原生支持行内差异标记，可精准定位注入语句与被拦截关键词；
  3. **边界限定**：虚拟滚动仅针对高频大量数据的审计流水表（`AuditsView`）开启；普通的分页表格（如用户、Profile、角色）默认采用服务端常规分页，避免不必要的虚拟化开销与键盘无障碍导航断裂。

---

## 第三章：Monorepo 工程化组织与契约边界

### 3.1 `apps/admin-ui` 模块目录树规范

```
apps/admin-ui/
├── public/                       # 静态资源 (Logo、Favicon)
├── src/
│   ├── api/                      # REST API 请求客户端与统一封装
│   │   ├── client.ts             # 强类型 Fetch 封装 (401重定向/403改密守卫/CSRF Token/SessionRequestManager)
│   │   ├── session-request.ts    # 具代际能力的请求取消管理器 (SessionRequestManager)
│   │   ├── schemas/              # 本地 Zod 运行时校验模式 (独立推断 + 静态双向测试)
│   │   │   ├── auth.schema.ts    # 登录、改密、注册校验 (email 允许为 null，id 为 string)
│   │   │   ├── profile.schema.ts # 数据源配置校验 (支持三模式连通性测试)
│   │   │   └── policy.schema.ts  # 表级与库级 ACL 结构化规则校验
│   │   └── endpoints/            # 按业务划分的 API 方法
│   │       ├── auth.ts           # 登录、登出、注册、首次改密、当前用户信息、CSRF 获取
│   │       ├── approvals.ts      # 待审批列表、审批通过、驳回、驳回重提
│   │       ├── users.ts          # 用户列表、状态冻结、角色分配、删除 (超管自残与本人保护)
│   │       ├── pats.ts           # PAT 列表、签发新令牌 (单次展示)、吊销
│   │       ├── profiles.ts       # 数据源 CRUD、三模式连通性测试 (已存/草稿/新增)、轻量选项
│   │       ├── roles.ts          # 角色 CRUD、库表 ACL 黑白名单 CRUD (结构化规则)
│   │       ├── limits.ts         # 全局与用户专属限流配置 CRUD
│   │       ├── settings.ts       # 系统通知渠道配置与测试发送
│   │       └── audits.ts         # 审计流水检索、按 query_instance_id 精确定位回补、脱敏导出
│   │
│   ├── components/               # 组件体系
│   │   ├── ui/                   # shadcn/ui 基础紧凑组件
│   │   │   ├── button.tsx        # 紧凑按钮 (h-8 / h-9)
│   │   │   ├── dialog.tsx        # 模态对话框 (支持二次确认退出)
│   │   │   ├── sheet.tsx         # 响应式排查抽屉核心容器 (XL:600px, LG:540px)
│   │   │   ├── table.tsx         # 高密度固定表头表格 (h-[38px] 行高)
│   │   │   ├── badge.tsx         # 四象限安全语义徽章 (Safe/Warn/Danger/Secret)
│   │   │   ├── tooltip.tsx       # 防自残与规则解释浮层
│   │   │   ├── tabs.tsx          # 紧凑切换卡片
│   │   │   └── toast.tsx         # 操作反馈与告警频控通知
│   │   │
│   │   └── domain/               # 领域复合业务组件
│   │       ├── dual-bucket/      # 双重漏斗垂直级联与 AND 衔接滑块
│   │       ├── pat-modal/        # PAT 单次展示与防呆确认弹窗 (三态模型)
│   │       ├── ssrf-tester/      # 数据库与 SSH 跳板机三模式连通性测试器
│   │       └── client-snippet/   # 客户端配置片段生成器 (Claude/Codex/cURL)
│   │
│   ├── layouts/                  # 全局“三纵两横一抽屉”骨架组件
│   │   ├── AppShell.tsx          # 根布局骨架与响应式断点监听
│   │   ├── Sidebar.tsx           # 240px / 64px 折叠侧边栏组件
│   │   ├── Topbar.tsx            # 56px 悬浮顶栏、面包屑与健康状态指示器
│   │   ├── CommandPalette.tsx    # Ctrl+K 全局快速指令导航浮层
│   │   └── InspectSheet.tsx      # 原位排查抽屉 (基于真实物理字段，只读诊断)
│   │
│   ├── views/                    # 业务页面视图 (遵循四大布局范式)
│   │   ├── auth/                 # 认证页面族
│   │   │   ├── LoginView.tsx     # 账号密码登录 (带防爆破感知)
│   │   │   ├── RegisterView.tsx  # 自主注册申请 (待审批状态引导)
│   │   │   ├── ChangePasswordView.tsx # 首次登录强制改密沙盒页
│   │   │   ├── PendingApprovalView.tsx# PENDING 状态等待审核引导页
│   │   │   ├── ResubmitApprovalView.tsx# REJECTED 状态修改资料重新申请页
│   │   │   └── AccountDisabledView.tsx# DISABLED 状态全屏冻结阻断页
│   │   ├── dashboard/            # 范式1: Bento Grid 安全大盘 (Profile 维度对齐)
│   │   │   └── DashboardView.tsx
│   │   ├── audits/               # 范式2: 全链路 SQL 审计高密度检索与脱敏导出
│   │   │   └── AuditsView.tsx
│   │   ├── approvals/            # 范式2: 用户注册审批工单中心
│   │   │   └── ApprovalsView.tsx
│   │   ├── users/                # 范式2: 用户生命周期与超管防自残/本人保护
│   │   │   └── UsersView.tsx
│   │   ├── policies/             # 范式3: 表级与库级 ACL 黑白名单与角色管理
│   │   │   └── PoliciesView.tsx
│   │   ├── limits/               # 范式3: 双重漏斗限流与 Agent 熔断中心
│   │   │   └── LimitsView.tsx
│   │   ├── profiles/             # 范式3: 数据源配置与 SSH 堡垒机管理
│   │   │   └── ProfilesView.tsx
│   │   ├── settings/             # 范式3: 系统通知渠道 Webhook 配置
│   │   │   └── SettingsView.tsx
│   │   └── developer/            # 范式4: 个人 PAT 签发与客户端接入向导
│   │       ├── MyTokensView.tsx
│   │       └── ClientConfigView.tsx
│   │
│   ├── stores/                   # Zustand 客户端轻量 UI 瞬态 (无业务数据)
│   │   ├── useShellStore.ts      # 侧栏折叠、当前主题
│   │   └── useCommandStore.ts    # Ctrl+K 快速唤起状态
│   │
│   ├── hooks/                    # 自定义组合式 Hooks
│   │   ├── useAuth.ts            # 当前登录态、生命周期状态感知
│   │   ├── useDashboardStats.ts  # 大盘指标轮询 Hook (10s 周期)
│   │   └── useUrlState.ts        # 抽屉 eventId 与筛选参数与 URL 双向绑定 (SSOT)
│   │
│   ├── router/                   # 路由系统
│   │   ├── routes.tsx            # 路由映射表
│   │   └── guards/               # 路由守卫链
│   │       ├── AuthGuard.tsx     # 登录认证守卫 (401 拦截)
│   │       ├── StatusGuard.tsx   # 账号生命周期守卫 (PENDING/REJECTED/DISABLED)
│   │       ├── MustChangePwdGuard.tsx # 首次强制改密硬拦截守卫
│   │       └── RoleGuard.tsx     # 超管/安全员 RBAC 权限守卫 (403 页面)
│   │
│   ├── styles/                   # 样式入口与令牌定义
│   │   ├── globals.css           # 基础重置样式
│   │   └── theme.css             # Tailwind v4 @theme 与 OKLCH 双模式变量定义
│   │
│   ├── App.tsx                   # 应用根组件 (挂载 QueryClientProvider 等)
│   ├── main.tsx                  # 入口渲染文件
│   └── vite-env.d.ts             # 环境变量与 Vite 类型扩展
│
├── package.json                  # 模块元数据与依赖定义
├── tsconfig.json                 # TypeScript 编译配置 (继承 tsconfig.base.json)
└── vite.config.ts                # Vite 6 构建配置
```

### 3.2 共享契约 `packages/shared-types` 纯类型边界 (0 运行时依赖)
严格落实主架构 §7.2 规范：
- `packages/shared-types` 纯粹输出 TypeScript `interface` 与 `type`，**严禁引入 Zod 等运行时依赖**；
- 状态与枚举采用纯字符串字面量联合（String Literal Unions），例如：
  ```ts
  // packages/shared-types/src/entities.ts
  export type AuditStatus = 
    | 'SUCCESS' 
    | 'BLOCKED_AST' 
    | 'BLOCKED_ACL' 
    | 'BLOCKED_CONCURRENCY' 
    | 'BLOCKED_RATE' 
    | 'CANCELED' 
    | 'FAILED_MYSQL' 
    | 'TIMEOUT';

  export type UserAccountStatus = 'PENDING' | 'ACTIVE' | 'REJECTED' | 'DISABLED';
  export type AclEffect = 'ALLOW' | 'DENY';
  ```
- 避免普通 TypeScript `enum` 在编译产物中生成 JavaScript 运行时对象导致的包体污染与引用不一致问题。

### 3.3 本地 Zod 校验模式、独立推断双向测试与大整型安全
- **64 位大整型字符串契约（防止 JavaScript 精度截断）**：
  JavaScript 原生 `Number.MAX_SAFE_INTEGER` 仅能表达至 $2^{53}-1$。为防止浏览器 `response.json()` 阶段发生静默四舍五入，**服务端契约强制规定：全链路所有主外键、实体 ID、关联数组及路径参数（如 `sys_users.id`、`sys_profiles.id`、`sys_audit_logs.id` 等），输出 JSON 时统一强制格式化为精确十进制字符串（`EntityId = string`），全局通配数据源 ID 统一规定为 `"0"`，严禁按大小写或数值大小保留 number**。前端 DTO 与 Zod Schema 明确将 64 位 ID 定义为 `string`：
  ```ts
  // apps/admin-ui/src/api/schemas/auth.schema.ts
  import { z } from 'zod';
  import type { UserProfileDTO } from '@mysql-mcp/shared-types';

  // 保留 Schema 独立推断结果，对齐数据库 NULLABLE 与字符串化 ID
  export const UserProfileSchema = z.object({
    id: z.string(),                        // 强制使用 string 承载大整型
    username: z.string(),
    email: z.string().email().nullable(),  // 规范对齐：允许为空
    department: z.string().nullable(),
    status: z.enum(['PENDING', 'ACTIVE', 'REJECTED', 'DISABLED']),
    must_change_password: z.boolean(),
    password_updated_at: z.string().optional(),
    password_expires_days: z.number().nullable(),
    password_expires_at: z.string().nullable(),
    is_password_expired: z.boolean(),
    version: z.number(),
    roles: z.array(z.string()),
    reject_reason: z.string().nullable(),
    created_at: z.string(),
  });

  export type InferredUserProfile = z.infer<typeof UserProfileSchema>;
  ```
- **双向严格相等静态测试 (Vitest Type Testing)**：
  在 `src/api/schemas/__tests__/type-align.test-d.ts` 中，使用 `expect-type` 验证 Schema 独立推断类型与共享 DTO 严格双向等价，并在 CI 中强制执行 `vitest --typecheck` 或 `tsc --noEmit`：
  ```ts
  import { describe, it } from 'vitest';
  import { expectTypeOf } from 'expect-type';
  import type { InferredUserProfile } from '../auth.schema';
  import type { UserProfileDTO } from '@mysql-mcp/shared-types';

  describe('DTO 契约双向等价静态测试', () => {
    it('Zod 独立推断类型必须与 shared-types DTO 严格双向相等', () => {
      // 若 DTO 新增了字段或改变了可选性，双向等价检查立即阻断 CI 构建
      expectTypeOf<InferredUserProfile>().toEqualTypeOf<UserProfileDTO>();
    });
  });
  ```
- **CSRF Token 单飞刷新 (Single-Flight Promise) 与重试边界**：
  1. 开启 `credentials: "include"`，保证 HttpOnly 鉴权 Cookie 传递；
  2. 封装单飞刷新函数，防止并发请求遭遇 CSRF 失效时触发 Token 刷新风暴：
     ```ts
     let csrfPromise: Promise<string> | null = null;
     export async function getOrRefreshCsrfToken(): Promise<string> {
       if (!csrfPromise) {
         csrfPromise = fetch('/api/v1/auth/csrf', { credentials: 'include' })
           .then((res) => res.json())
           .then((data) => data.csrfToken)
           .finally(() => { csrfPromise = null; });
       }
       return csrfPromise;
     }
     ```
  3. **服务端前置校验与安全重试**：服务端保证 CSRF 校验位于控制器逻辑之前，一旦返回 `ERR_CSRF_INVALID` (HTTP 403)，确保业务未产生写副作用。前端自动刷新 Token 并重试一次该请求；普通业务权限 403 绝不触发重试；
  4. 首次强制改密成功下发新 Session 后，前端主动调用 `getOrRefreshCsrfToken()` 轮换 Token。

---

## 第四章：零信任前端安全机制与全生命周期状态机

### 4.1 认证与会话生命周期管理 (HttpOnly Cookie + CSRF 防护 + 严格同源重定向)
- **安全传输与会话基线**：
  - 会话采用带 `HttpOnly; Secure; SameSite=Strict` 的强安全 Cookie，绝不在 `localStorage` 中持久化敏感 Token；必须全程基于 **HTTPS** 传输；
  - **CSRF Token 生命周期与重试边界**：
    - 公开端点：`GET /api/v1/auth/csrf` 全局无门槛放行（未登录、改密中、待审状态均可访问）；
    - 应用冷启动时获取 `X-CSRF-Token` 保持在内存中；登录成功与登出后自动轮换 Token；
    - **重试白名单限制**：仅当服务端明确返回 HTTP 403 且错误码为 `ERR_CSRF_INVALID` 时，前端才刷新 Token 并自动重试一次；普通业务权限 403 绝不触发重试。
- **`/me` 异常精准分流**：
  严禁将所有异常笼统当作未登录：
  | `/me` 返回状态 | 前端处置逻辑 |
  | :--- | :--- |
  | **HTTP 401** | 判定会话超时或未登录，清空本地缓存，携带安全清洗后的 `returnUrl` 重定向至 `/login`； |
  | **网络超时 / 5xx 故障** | **严禁判定为未登录踢回登录页**！保持在当前视口，展示全屏“网关网络连接异常，点击重新连接”占位卡片； |
  | **HTTP 403 (账号冻结)** | 重定向至 `/forbidden` 封禁说明页； |
  | **账号正常 (200 OK)** | 正常放行，进入账号生命周期状态机判定。 |
- **`returnUrl` 开放重定向漏洞根治实现 (`sanitizeReturnUrl`)**：
  彻底修复因路径穿越（`/a/..//`）导致 `pathname` 产生双正斜杠（`//`）从而被浏览器解析为外部域名的漏洞：
  ```ts
  export function sanitizeReturnUrl(rawUrl: string | null | undefined, fallback = '/dashboard'): string {
    if (!rawUrl) return fallback;
    // 1. 严格拒绝反斜杠与 ASCII 控制字符
    if (/[\\|\x00-\x1F\x7F]/.test(rawUrl)) return fallback;
    try {
      // 2. 基于当前 Origin 严格解析
      const parsed = new URL(rawUrl, window.location.origin);
      if (parsed.origin !== window.location.origin) return fallback;
      
      // 3. 核心修复：检查解析后的 pathname 必须严格以单正斜杠开头，且绝对不能以双斜杠开头！
      if (!parsed.pathname.startsWith('/') || parsed.pathname.startsWith('//')) {
        return fallback;
      }
      
      const safePath = parsed.pathname + parsed.search + parsed.hash;
      // 4. 对拼接结果做最终防线校验 (杜绝路径穿越产生的 // 逃逸)
      if (!safePath.startsWith('/') || safePath.startsWith('//')) {
        return fallback;
      }
      return safePath;
    } catch {
      return fallback;
    }
  }
  ```
- **请求取消与会话代际管理 (`SessionRequestManager`)**：
  废除单例 AbortController，引入支持代际换代的请求管理器，确保旧请求彻底掐断且新会话不受影响：
  ```ts
  class SessionRequestManager {
    private currentController: AbortController = new AbortController();

    public getSignal(): AbortSignal {
      return this.currentController.signal;
    }

    public abortAndRotate(): void {
      // 1. 物理掐断当前会话的所有在途业务请求
      this.currentController.abort();
      // 2. 核心：立即实例化全新的 Controller 供后续新会话使用！
      this.currentController = new AbortController();
    }
  }

  export const sessionRequestManager = new SessionRequestManager();

  // 内存持有 CSRF Token (由冷启动或最近一次刷新保持)
  let activeCsrfToken: string | null = null;

  export function setActiveCsrfToken(token: string | null): void {
    activeCsrfToken = token;
  }

  export function getActiveCsrfToken(): string | null {
    return activeCsrfToken;
  }

  let csrfRefreshPromise: Promise<string> | null = null;

  export async function getOrRefreshCsrfToken(): Promise<string> {
    if (!csrfRefreshPromise) {
      csrfRefreshPromise = fetch('/api/v1/auth/csrf', { credentials: 'include' })
        .then(async (res) => {
          if (!res.ok) {
            throw new Error(`Failed to fetch CSRF token: ${res.status}`);
          }
          const data = await res.json();
          activeCsrfToken = data.csrfToken;
          return data.csrfToken as string;
        })
        .finally(() => {
          csrfRefreshPromise = null;
        });
    }
    return csrfRefreshPromise;
  }

  // 登出标准执行时序 (CR-05 闭环：携带 CSRF Token 与独立 5s 超时信号，精确错误重试与注销确认状态反馈)
  export async function handleLogout() {
    // 步骤 1: 物理掐断上一会话的所有在途业务查询 (大盘轮询、审计列表)
    sessionRequestManager.abortAndRotate();

    // 步骤 2: 发起登出请求（携带 CSRF Token 与独立 5s 超时信号）
    let serverLogoutOk = false;
    try {
      let token = getActiveCsrfToken();
      if (!token) {
        token = await getOrRefreshCsrfToken();
      }
      const res = await fetch('/api/v1/auth/logout', { 
        method: 'POST', 
        headers: {
          'x-csrf-token': token,
        },
        credentials: 'include',
        signal: AbortSignal.timeout(5000) 
      });

      if (res.ok) {
        serverLogoutOk = true;
      } else if (res.status === 403) {
        // 严格仅当错误码为 ERR_CSRF_INVALID 时单飞刷新 CSRF Token 并重试一次，普通 403 绝不重试
        const errBody = await res.json().catch(() => null);
        if (errBody?.code === 'ERR_CSRF_INVALID') {
          const refreshedToken = await getOrRefreshCsrfToken();
          const retryRes = await fetch('/api/v1/auth/logout', {
            method: 'POST',
            headers: {
              'x-csrf-token': refreshedToken,
            },
            credentials: 'include',
            signal: AbortSignal.timeout(5000)
          });
          if (retryRes.ok) {
            serverLogoutOk = true;
          }
        }
      }
    } catch (e) {
      console.warn('本地退出，服务端注销未确认:', e);
    } finally {
      // 步骤 3: 彻底清空 React Query 内存业务缓存
      queryClient.clear();
      // 步骤 4: 重定向：服务端注销成功正常跳 /login；未确认或网络/服务失败重定向带提示参数，明确提示用户“本地退出，服务端注销未确认”
      if (serverLogoutOk) {
        window.location.href = '/login';
      } else {
        // LoginView 读取 ?warning=session_unconfirmed 后在登录页顶部渲染醒目警示横幅：
        // “本地退出已完成，但服务端注销未确认，请检查网络或关闭浏览器以确保安全。”
        window.location.href = '/login?warning=session_unconfirmed';
      }
    }
  }
  ```

### 4.2 账号生命周期全状态机与分层守卫执行顺序
为彻底杜绝“未审用户进入强制改密页死循环”以及“冻结用户被踢回登录页”的问题，确立**严格的四级分层守卫流水线**：

1. **守卫执行管道顺序（严格串行）**：
   - **第一关：`AuthGuard`**：检查 Session 是否存在。若为 401 重定向至 `/login`；凭据有效时（哪怕为受限状态），放行进入下一关；
   - **第二关：`StatusGuard`**：判定 `user.status`。
     - 若为 `PENDING` ➔ 重定向至 `/approvals/wait`；
     - 若为 `REJECTED` ➔ 重定向至 `/approvals/re`；
     - 若为 `DISABLED` ➔ 重定向至 `/forbidden`；
     - **仅当为 `ACTIVE` 时**，放行进入第三关；
   - **第三关：`MustChangePwdGuard`**：**仅针对已激活（`ACTIVE`）用户生效！** 若 `must_change_password === true || is_password_expired === true`，全屏锁定重定向至 `/change-password`（涵盖首次强制改密与密码自然过期双场景）；改密完成后放行进入第四关；
   - **第四关：`RoleGuard`**：仅对已激活且完成改密的用户判定具体业务路由的 RBAC 权限（无权展示 403 页面）。

```
                           [访问应用受保护路由]
                                    │
                                    ▼
                     [1. AuthGuard 认证守卫]
                   (/me 返回 401 判定未认证/超时)
                                    │
                 ┌──────────────────┴──────────────────┐
             [未认证/401]                           [已认证/200]
                 │                                     │
                 ▼                                     ▼
         重定向至 /login                     [2. StatusGuard 账号状态守卫]
         (带安全 returnUrl)                     (读取 user.status)
                                                       │
            ┌─────────────────────┬────────────────────┼─────────────────────┐
            ▼                     ▼                    ▼                     ▼
       [ PENDING ]          [ REJECTED ]         [ DISABLED ]           [ ACTIVE ]
            │                     │                    │                     │
            ▼                     ▼                    ▼                     ▼
     重定向 /approvals/wait 重定向 /approvals/re  重定向 /forbidden            │
     (查看审核排队进度)     (查看驳回原因并重提)   (展示封禁原因与申诉)         │
                                                                             │
                                                                             ▼
                                                           [3. MustChangePwdGuard 改密守卫]
                                                            (user.must_change_password)
                                                                             │
                                                                 ┌───────────┴───────────┐
                                                                [是]                    [否]
                                                                 │                       │
                                                                 ▼                       ▼
                                                         全屏锁定重定向              [4. RoleGuard]
                                                         至 /change-password        (检查访问权限)
                                                         (阻断全量外部路由)              │
                                                                                 ┌───────┴───────┐
                                                                               [通过]          [无权]
                                                                                 │               │
                                                                                 ▼               ▼
                                                                              放行进入        展示 403 页面
```

### 4.3 账号首次强制改密与定期到期全量路由守卫 (`MustChangePwdGuard`)
- 当且仅当 `user.status === 'ACTIVE'` 且 (`user.must_change_password === true || user.is_password_expired === true`) 时：
  1. 路由无条件重定向至 `/change-password`；
  2. 禁用顶栏与侧边栏全部导航项，禁用 `Ctrl+K` 快速启动面板；
  3. 页面提供强密码动态检测（长度 >= 12 位、含大小写字母、数字、特殊符号）；
  4. 成功调用 `POST /api/v1/auth/change-password` 后，服务端重置改密标记并下发新 Session，前端主动重新拉取 CSRF Token，原地重新触发 `/me` 刷新用户信息，平滑解锁进入控制台大盘；
  5. **个人密码轮换策略设置与高危确认弹窗 (`/api/v1/auth/password-policy`)**：用户可在个人设置页面通过 `GET /api/v1/auth/password-policy` 查询当前密码有效期，并通过 `PUT /api/v1/auth/password-policy` 调整轮换天数（30~180 天，或 `null` 表示永不过期）。若用户选择关闭定期更换（`passwordExpiresDays: null`），前端必须弹出高危安全风险确认对话框，仅在用户勾选“我已知晓安全风险”并确认后才允许提交；
  6. **被驳回状态说明 (`REJECTED`)**：当 `/auth/me` 返回 `status === 'REJECTED'` 时，前端读取 `reject_reason` 在 `/approvals/re` 页面向用户展示驳回原因并允许重新提交申请。

### 4.4 事务级超管防自残与本人操作保护 (`AntiSelfLockout` & `SelfActionGuard`)
- **保护一：最后 1 名活跃超管防自残 (`AntiSelfLockout`)**：
  在 `UsersView` 中，基于后端返回的 `is_last_super_admin: boolean` 标记：
  1. 对最后 1 名活跃超管的【冻结】、【降级 SUPER_ADMIN】、【删除】按钮直接置灰并禁用（`disabled`）；
  2. 悬停展示醒目 Tooltip 警示：“系统必须保留至少 1 名活跃超级管理员，当前账号已被保护，禁止停用或降级。”；
  3. 后置异常兜底：若并发操作导致冲突，前端捕获 `ERR_LAST_SUPER_ADMIN` (HTTP 400)，弹出专用模态框向用户解释规则，并自动触发用户列表重新拉取。
- **保护二：禁止对当前登录账号自身执行禁用或删除 (`SelfActionGuard`)**：
  在 `UsersView` 中，匹配 `user.id === currentLoginUser.id` 的行：
  1. 【禁用账号】与【删除账号】操作按钮无条件置灰并禁用；
  2. 悬停展示 Tooltip 提示：“禁止对当前登录账号自身执行停用或删除操作，以防管理权意外丢失”；
  3. 即使系统存在多名其他超管，本人操作保护依然绝对生效。
- **保护三：角色提权防范 (Privilege Escalation Prevention)**：
  角色分配面板中，仅当当前登录操作人拥有 `SUPER_ADMIN` 角色时，才允许向他人勾选赋予 `SUPER_ADMIN` 角色；低权限管理员严禁越权向用户绑定高于自身的角色。

### 4.5 个人访问令牌 (PAT) 凭据生命周期与配置生成三态模型
为彻底解决“关闭弹窗销毁明文”与“配置生成器插值明文”的时序矛盾，确立**三态契约**：

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              PAT 凭据与配置生成三态模型                                │
├─────────────────┬──────────────────────┬───────────────────────────────────────────────┤
│ 状态阶段        │ 令牌明文持有状态     │ 客户端配置生成表现                            │
├─────────────────┼──────────────────────┼───────────────────────────────────────────────┤
│ 1. 签发即时态   │ 仅在 PatModal 内存中 │ 弹窗内直接提供“含真实 PAT 完整片段”一键复制   │
├─────────────────┼──────────────────────┼───────────────────────────────────────────────┤
│ 2. 日常模板态   │ 前后端均无明文       │ 页面仅生成带占位符片段: --token=<YOUR_PAT>     │
├─────────────────┼──────────────────────┼───────────────────────────────────────────────┤
│ 3. 临时装填态   │ 用户组件临时受控内存 │ 用户临时粘贴已有 PAT 生成完整片段 (不存任何库) │
└─────────────────┴──────────────────────┴───────────────────────────────────────────────┘
```

- **弹窗防呆与强制勾选关闭交互**：
  1. 令牌明文区域默认显示掩码（或清晰单次展示区配合掩码开关），提供【显示/隐藏明文】与【一键复制】按钮；
  2. 复制完成后，提供显式勾选框：`[ ] 我已复制并妥善保存此令牌。我了解关闭后系统无法再次显示该令牌。`；
  3. **未勾选强制拦截悬浮提示（无跳过关闭按钮）**：在用户勾选确认前，底部完成按钮保持禁用，点击右上角关闭按钮、点击遮罩层或按下 `Esc` 键均**不得关闭弹窗**；在当前 `<dialog>` 顶层正上方弹出醒目的**悬浮轻提示弹窗（Toast，约 3 秒自动消失，不撑高主弹窗布局）**，并同步高亮滚动聚焦至确认勾选框，提醒用户必须先复制并勾选确认后再关闭窗口；
  4. 仅在用户勾选确认后允许关闭弹窗，关闭或卸载瞬间立即销毁弹窗并重置内存变量（`rawToken = null`）；
  5. **零泄漏安全准则**：`rawToken` 严禁传入 React Query 缓存、严禁存入 Zustand、严禁写入 localStorage、严禁输出到任何前端日志与 Sentry 异常监控。

### 4.6 数据源连通性测试三大工作模式 (已存 / 草稿 / 新增)
针对数据源密码“只写不读”的特性，将连通性测试接口（`test-db` 与 `test-ssh`）严密划分为 **3 种工作模式**：

| 工作模式 | 适用场景 | 提交入参 (Request Payload) | 后端鉴权与凭据复用逻辑 |
| :--- | :--- | :--- | :--- |
| **模式 1：已存配置测试** | 在 Profile 列表点击单行【测试】 | `{ profile_id: '101' }` | 后端直接从加密密钥环中解密已保存密码/私钥执行测试 |
| **模式 2：编辑草稿测试** | 用户修改了 host/port 等，但保留原密码未动 | `{ profile_id: '101', host: 'new-ip', port: 3307 }` (密码留空) | 后端以传入的草稿参数覆盖已存参数，同时复用已存解密密码测试 |
| **模式 3：新增/改密测试**| 新建 Profile，或用户录入了新密码 | `{ host, port, user, password: 'new-password', database }` (不传 profile_id) | 纯粹使用前端当前表单提交的全新明文参数执行连通性测试 |

### 4.7 SSRF 拦截场景的精准交互引导 (受控出站白名单认知)
- 当管理员测试数据源或 SSH 连通性被网关拦截（返回 `ERR_SSRF_PROHIBITED`，HTTP 403）时：
- 前端给出符合企业内网实际部署规范的引导：
  > “目标主机已被安全网关出站策略拦截 (ERR_SSRF_PROHIBITED)。若该主机属于合法的企业 VPC 内网数据库或堡垒机，请联系网关系统管理员检查并将其加入服务端的 `ALLOWED_OUTBOUND_IPS` 白名单中。”

### 4.8 并发配置修改冲突控制 (乐观锁与草稿保留)
- **版本号并发控制 (Optimistic Locking)**：
  - 数据源 Profile、角色策略、库表 ACL、限流配置，以及用户状态变更（`/users/:id/status`）与角色分配（`/users/:id/roles`）的查询接口显式返回 `version: number`；
  - 提交更新时请求体必须原样携带修改前的 `version`；
  - 若其他管理员已先一步更新，后端比对版本不匹配，返回 HTTP 409 `ERR_CONCURRENCY_CONFLICT`；
  - **草稿保留交互**：前端捕获 409 后阻断覆盖，**严禁直接清空用户的编辑表单**；界面弹出差异警告条并高亮显示与远端冲突的字段，由用户决定是手动合并差异再次提交，还是放弃本地草稿重新加载。
- **安全敏感操作严禁前端乐观更新**：
  - 审批通过/驳回、角色绑定、账号冻结等高危安全操作，**前端严禁提前修改本地视图**；
  - 界面显示操作 Pending Loading 态，严格等待服务端返回 HTTP 200 确认后，再执行数据失效与视图刷新。

---

## 第五章：全局骨架布局拓扑与四大业务场景范式

### 5.1 全局骨架：“三纵两横一抽屉”拓扑规范与精确断点
控制台严格实现 `LAYOUT_SPEC.md` 中定义的企业级基础设施控制台骨架拓扑：

```
┌────────────────────────────────────────────────────────────────────────────────────────────────┐
│  [Top Bar 顶栏 (固定高度: 56px, Sticky 悬浮置顶)]                                               │
│  ├─ 侧栏开关 ├─ 面包屑路径 ├─ 集群状态指示器 ├─ [全局搜索 Ctrl+K] ├─ 快速动作 ├─ 主题 ├─ 账号   │
├──────────────────┬─────────────────────────────────────────────────────────────┬───────────────┤
│ [Sidebar 侧边栏] │ [Main Workspace 主内容区 (弹性自适应)]                      │ [Sheet 抽屉]  │
│ (宽度: 240px /   │ ┌─────────────────────────────────────────────────────────┐ │ (响应式断点   │
│  折叠后: 64px)   │ │ 页面大标题与情境动作条 (Page Header)                    │ │  按需滑出)    │
│                  │ └─────────────────────────────────────────────────────────┘ │               │
│ ├─ Brand 区域    │ ┌─────────────────────────────────────────────────────────┐ │ ├─ 事件唯一ID│
│ ├─ 分组 1: 运维  │ │ 核心工作台画布 (Content Canvas)                         │ │ ├─ 脱敏 SQL │
│ ├─ 分组 2: 安全  │ │                                                         │ │ ├─ 真实状态 │
│ ├─ 分组 3: 研发  │ │  · 范式 1: Bento 网格大盘 (Profile 维度流量对比)        │ │ ├─ 客户端 IP│
│ └─ 底部网关版本  │ │  · 范式 2: 密集数据表格 (带 Sticky 表头 + 紧凑筛选栏)   │ │ ├─ 报错信息  │
│                  │ │  · 范式 3: 分组配置与规则矩阵 (黑名单置顶)               │ │ └─ 一键复制 │
│                  │ │  · 范式 4: 开发者凭据与配置向导 (单列聚焦卡片)           │ │             │
│                  │ └─────────────────────────────────────────────────────────┘ │               │
└──────────────────┴─────────────────────────────────────────────────────────────┴───────────────┘
```

#### 响应式断点与抽屉规格对应表
| 视口规格 | 屏幕宽度区间 | 侧边栏模式 | 右侧排查抽屉 (InspectSheet) 规格与形态 |
| :--- | :--- | :--- | :--- |
| **超宽屏 (XL)** | `>= 1440px` | 默认展开 `240px` | 右侧平滑滑出，固定宽度 **`600px`** |
| **标准桌面 (LG)**| `1024px ~ 1439px` | 默认收起为 `64px` 图标态 | 右侧平滑滑出，紧凑宽度 **`540px`** |
| **平板 (MD)** | `768px ~ 1023px` | 悬浮遮罩抽屉 (Overlay) | 占视口宽度 **`70%`** 的右侧浮层 |
| **移动端急症 (SM)**| `< 768px` | 完全隐藏，汉堡菜单唤起 | 降级为从视口底部拉起的 **`Drawer` (占高 85vh)** |

### 5.2 范式一：安全态势运维大盘 (Profile 维度对齐的 QPM 双折线对比)
*应用视图：`DashboardView`*
- **不同角色的数据可见性隔离**：
  - **管理员视图 (SUPER_ADMIN / SECURITY_ADMIN)**：展示全网关统计、支持切换全量 Profile 查看各业务线流量；
  - **普通研发人员视图**：严格受限，仅展示本人拥有访问权的 Profile，折线图仅体现本人发起的请求量与配额消耗，不越权窥探全局物理承载数据。
- **首行 KPI 指标卡片 (4 列响应式)**：
  - MCP 调用总量（带 24h 环比浮动胶囊）；
  - 当前在途连接数与连接池利用率（独立指标，与 QPM 解耦）；
  - 今日高危拦截总数与近 1 小时频次（展示拦截命中分布）；
  - 待审批注册申请（待审批数 > 0 时展示 Amber 警示徽章）。
- **Profile 维度严格对齐的流量时序对比图 (占 8 列栅格)**：
  - **核心控件：Profile 选择器**（提供“全部 Profile 聚合”与各个具体数据源切换）；
  - 选定具体 Profile 时，双折线严格对齐口径：
    - 实线（电光天蓝）：**该 Profile 当前实时 QPM 实际吞吐**；
    - 虚线（警示橙黄）：**该 Profile 配置的 `profile_capacity_qpm` (QPM 限额上限)**；
  - 彻底消灭“QPM 吞吐去对比并发连接数上限”的指标混淆；
  - 默认每 10 秒短轮询更新数据，数值变动开启 `tabular-nums` 避免抖动。
- **高危拦截最近记录 (占 4 列栅格)**：
  - 展示最近 5 条真实阻断事件，点击某项直接更新 URL `?eventId=query_instance_id` 弹出抽屉查看详情。

### 5.3 范式二：全链路审计与日志检索 (真实物理字段收敛与 URL 直达回补)
*应用视图：`AuditsView`、`ApprovalsView`、`UsersView`*
- **高密度紧凑数据表格 (Dense Table)**：
  - 表头吸顶（`sticky top-0 z-10 bg-muted/80 backdrop-blur-sm`），行高固定为 **38px**；
  - SQL 语句列限制最大宽度 `max-w-[320px]`，超长截断并支持一键复制；
  - **执行状态与性能标记双轨展示**：
    - 状态列展示原子枚举：`SUCCESS` (绿)、`BLOCKED_AST` (红)、`BLOCKED_ACL` (红)、`BLOCKED_RATE` (红)、`TIMEOUT` (黄) 等；
    - 慢查询追加独立标签：当 `status === 'SUCCESS'` 且 `latency_ms >= 1000` 时，追加渲染橙色 `SLOW: 1,280ms` 标签。
- **收敛至真实物理字段的排查抽屉 (`InspectSheet`)**：
  - **数据真实性边界**：由于 `sys_audit_logs` 物理表未存储改写 SQL 与 EXPLAIN，且未记录具体 `pat_id`，抽屉严禁展示伪造字段，并**移除缺乏数据支撑的“一键吊销 PAT”按钮**（发现高危行为统一引导至【用户管理】全局冻结账号）；
  - **真实物理字段卡片**：
    1. **事件元数据**：展示 `query_instance_id`、`session_id`、精确发生时间、客户端 IP 与关联用户；
    2. **脱敏 SQL 文本**：CodeMirror 6 渲染脱敏后的 `sql_text`，提供【一键复制脱敏 SQL】动作；
    3. **执行结果与耗时**：展示真实 `status`、`latency_ms`、`rows_affected`；
    4. **异常说明**：若为阻断或超时，展示数据库中真实记录的 `error_message`。
- **URL `?eventId=...` 深度直达与回补状态机**：
  - 用户通过包含 `?eventId=query_instance_id` 的链接直接打开审计页时：
    1. 前端先在当前加载的分页列表缓存中查找匹配记录；
    2. 若未找到（该事件位于后续页码或已被筛选条件过滤），前端主动发起精确单条拉取：`GET /api/v1/audits?query_instance_id=xxx`；
    3. 成功获取后直接在抽屉渲染详情；若后端返回 404 或无权访问，抽屉展示“该审计记录不存在或已被归档清理”的友好占位提示。

### 5.4 范式三：策略矩阵与限流控制台 (黑名单置顶 + 多角色合并决策展示)
*应用视图：`PoliciesView`、`LimitsView`*
- **表级与库级 ACL 策略中心 (黑名单置顶原则)**：
  - **顶部红色危险区卡片 (Denylist)**：以 `border-rose-500/30 bg-rose-500/5` 样式绝对置顶，标明黑名单规则，标明：“黑名单优先级最高，命中即阻断”；
  - **下部蓝色授权区卡片 (Allowlist)**：展示允许访问的库表通配符（如 `analytics.*`）；
  - **全局作用域约定**：在库级与表级 ACL 规则中，`profile_id = "0"` 显式表示作用于该角色名下所有 Profile 的全局规则；
  - **多角色策略合并决策展示**：
    依据主架构 §5.4 规范，直观展示用户所属多角色的权限合并计算结论：
    - 基础底线：Default Deny（默认全部拒绝）；
    - 授权叠加：各角色 Allowlist 取并集（Union）；
    - 绝对拒绝：任一角色的 Denylist 命中即阻断（Strict Deny Overrides All）。
- **双重漏斗限流控制台**：
  - 垂直排列“主体配额桶 (User Bucket)”与“Profile 资源保护桶 (Profile Bucket)”，并在交界处放置等宽语义徽章 `[ ∧ AND 逻辑串接 ]`；
  - 滑块调节配额，醒目标注：“主体免限流（-1）依然受底层 Profile 资源保护桶绝对约束”。
  - **用户覆盖与有效值分开展示（DB-R1-02）**：GET USER 限流仅回显已保存配置；`isCustom=false` 时显示“无用户覆盖，按角色/全局策略计算”，QPM/突发容量编辑值保持 null，revision/version 为 0，不能填入 GLOBAL 值冒充自定义配置。
  - 删除按钮使用“移除用户覆盖”，确认提示：“QPM 恢复角色合并策略（角色无可用配额时才用全局兜底），突发容量恢复全局值”。不承诺 GLOBAL QPM 变更影响所有继承用户；角色 QPM=60、GLOBAL 从100改20时仍显示有效值60。
  - 个人大盘 `user_quota_qpm` 取后端按执行侧同一策略计算的有效 QPM，不能从 USER 配置接口的 null 或全局默认推算。PUT/DELETE 成功后重新拉取覆盖配置及个人大盘，不用旧值乐观推导最终配额。

### 5.5 范式四：开发者自服务门户 (三态 PAT 配置片段生成器)
*应用视图：`MyTokensView`、`ClientConfigView`*
- **单列聚焦卡片流**：采用居中单列（`max-w-4xl`）结构；
- **轻量授权 Profile 选项拉取**：
  普通研发人员进入配置向导时，前端调用轻量授权选项端点 `GET /api/v1/profiles/my-options`，仅获取本人有权访问的 `{ id, name, displayName }` 脱敏列表，避免向非管理员泄露数据库 Host/Port/SSH 等底层运维拓扑；
- **三态客户端配置生成器**：
  - 顶部提供常用 MCP 宿主 Tab 切换：`[Claude Desktop]` | `[Codex]` | `[通用 cURL / SSE]`；
  - 页面默认生成安全占位符模板：
    ```json
    {
      "mcpServers": {
        "mysql-production": {
          "command": "npx",
          "args": [
            "-y",
            "@company/mysql-mcp-client",
            "--gateway=https://mcp.internal.company.com:8080",
            "--token=<YOUR_SAVED_PAT_TOKEN>",
            "--profile=production_readonly"
          ]
        }
      }
    }
    ```
    *注：`@company/mysql-mcp-client` 为企业客户端适配器占位包名，实际命令以企业内网私有源发布的客户端 CLI 包名为准。*
  - 提供【装填已有令牌】临时输入框（仅受控保存在局部组件状态，内存插值供用户复制，绝不持久化与外传）；
  - 提供【签发新令牌】快捷跳转引导。

---

## 第六章：状态管理模型与唯一事实来源 (SSOT)

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        前端状态分类驱动与流转模型                                      │
├─────────────────┬──────────────────────┬───────────────────────────────────────────────┤
│ 状态层级        │ 管理驱动技术         │ 职责划分与典型场景                           │
├─────────────────┼──────────────────────┼───────────────────────────────────────────────┤
│ 1. 服务端数据缓存│ TanStack Query v5    │ 用户、Profile、审计日志、策略数据 (带 SWR 缓存) │
├─────────────────┼──────────────────────┼───────────────────────────────────────────────┤
│ 2. 唯一视口状态 │ URL SearchParams     │ 抽屉展开(?eventId=...)、审计筛选、分页页码    │
│    (SSOT 事实源)│ (基于 React Router)  │ 保证任何排查视角均可跨人员分享、刷新无损恢复  │
├─────────────────┼──────────────────────┼───────────────────────────────────────────────┤
│ 3. 客户端瞬态 UI│ Zustand 5.x          │ 侧边栏展开/折叠、暗色/浅色主题、全局快捷键浮层│
├─────────────────┼──────────────────────┼───────────────────────────────────────────────┤
│ 4. 态势感知通道 │ 短轮询 (v1.0 10s基线)│ 定时拉取大盘指标；v1.1 RFC 待批后升级为 SSE   │
└─────────────────┴──────────────────────┴───────────────────────────────────────────────┘
```

### 6.1 服务端状态缓存机理 (TanStack Query v5)
- **全局查询配置 (QueryClient Defaults)**：
  - `staleTime: 30 * 1000` (30 秒内数据视为新鲜，页面来回切换不触发重复网络请求)；
  - `gcTime: 5 * 60 * 1000` (未被引用的失效缓存保留 5 分钟后垃圾回收)；
  - `refetchOnWindowFocus: true` (DBA 从其他应用切回控制台时，自动静默同步最新安全数据)；
  - `retry: 1` (失败快速呈现，避免界面死等)。
- **操作安全原则**：
  - 高危安全操作（注册审批、角色变更、用户封禁、PAT 吊销）**绝不采用前端乐观更新**；
  - 界面统一展示 Pending Loading 状态，严格等待服务端 HTTP 200 确认后，再执行 `queryClient.invalidateQueries` 重新拉取权威状态。

### 6.2 唯一事实来源：URL SearchParams 状态机驱动
**彻底废除在 Zustand 中维护抽屉开闭与选中事件的冗余设计**。以 URL 为唯一事实来源：
```tsx
// apps/admin-ui/src/hooks/useInspectDrawer.ts
import { useSearchParams } from 'react-router-dom';

export function useInspectDrawer() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeEventId = searchParams.get('eventId');

  const openDrawer = (eventId: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('eventId', eventId);
      return next;
    });
  };

  const closeDrawer = () => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('eventId');
      return next;
    });
  };

  return {
    isOpen: Boolean(activeEventId),
    activeEventId,
    openDrawer,
    closeDrawer,
  };
}
```

### 6.3 客户端瞬态 UI 状态 (Zustand)
Zustand 严格收缩边界，仅维护无法序列化到 URL 的界面轻量配置：
```ts
// apps/admin-ui/src/stores/useShellStore.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface ShellState {
  sidebarCollapsed: boolean;
  theme: 'dark' | 'light';
  toggleSidebar: () => void;
  setTheme: (theme: 'dark' | 'light') => void;
}

export const useShellStore = create<ShellState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      theme: 'dark',
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setTheme: (theme) => set({ theme }),
    }),
    {
      name: 'mcp_shell_settings',
    }
  )
);
```

---

## 第七章：页面—路由—权限 RBAC 矩阵表

平台实行严格基于角色的路由与操作权限隔离：

| 视图路径 (Route) | 视图组件 (View) | 访问角色范围 | 页面数据可见性 | 核心交互与操作权限 |
| :--- | :--- | :--- | :--- | :--- |
| `/login` | `LoginView` | 匿名全员 | 无 | 账号密码登录、防爆破错误次数展示 |
| `/register` | `RegisterView` | 匿名全员 | 无 | 填写信息申请注册账号 |
| `/change-password` | `ChangePasswordView` | 强制改密用户 | 个人脱敏基础信息 | 修改密码（提交解除强制锁定） |
| `/approvals/wait` | `PendingApprovalView` | `PENDING` 用户 | 个人审批申请进度 | 仅查看排队中提示，无业务菜单 |
| `/approvals/re` | `ResubmitApprovalView`| `REJECTED` 用户 | 驳回原因说明 | 修改资料并重新发起审批申请 |
| `/forbidden` | `AccountDisabledView` | `DISABLED` 用户 | 封禁状态说明 | 查看冻结提示与支持联系方式 |
| `/dashboard` | `DashboardView` | 全体激活用户 | 管理员看全网关；普通研发看个人授权 Profile | 切换 Profile 筛选、查看对应流量双折线与最近拦截 |
| `/audits` | `AuditsView` | `SUPER_ADMIN` / `SECURITY_ADMIN` | 全量在途与归档 SQL 审计流水 | 多维组合筛选、唤起只读排查抽屉、导出脱敏审计日志 |
| `/approvals` | `ApprovalsView` | `SUPER_ADMIN` / `SECURITY_ADMIN` | 全量待审批与历史审批工单 | 审批通过并赋予角色、驳回并填写驳回理由 |
| `/users` | `UsersView` | `SUPER_ADMIN` | 全量用户列表与角色绑定关系 | 冻结/解冻账号、变更角色、删除（受超管防自残与本人保护） |
| `/policies` | `PoliciesView` | `SUPER_ADMIN` / `SECURITY_ADMIN` | 角色策略、表级与库级 ACL | 编辑黑白名单规则、查看多角色合并决策结论 |
| `/limits` | `LimitsView` | `SUPER_ADMIN` / `SECURITY_ADMIN` | 全局配额桶与 Profile 保护桶 | 调整双重漏斗阈值、配置死循环熔断参数 |
| `/profiles` | `ProfilesView` | `SUPER_ADMIN` / `DBA` | 全量 MySQL 数据源与 SSH 堡垒机 | 新增/编辑/删除数据源、三模式连通性测试 |
| `/settings/notifications` | `SettingsView` | `SUPER_ADMIN` / `SECURITY_ADMIN` | 企微/钉钉/飞书通知 Webhook | 配置通知渠道、发送测试通知 (SSRF 校验) |
| `/developer/pats` | `MyTokensView` | 全体激活用户 | 仅查看个人名下 PAT 列表 | 签发新 PAT (单次展示)、主动吊销本人 PAT |
| `/developer/config`| `ClientConfigView` | 全体激活用户 | 仅展示本人有权访问的 Profile | 选择 Profile 生成三态配置片段 (安全模板/临时装填) |

---

## 第八章：页面—接口—DTO 契约映射表与后端协同清单

### 8.1 核心 RESTful API 路由映射矩阵

> 本矩阵的内联对象为字段概要，**非完整签名**；必填性、联合类型与条件安全约束以 `API_CONTRACT_SPEC.md` 对应接口为准。生成类型/真实响应 fixture 与47项实现追踪见 `docs/contracts/`（由 `scripts/generate_readiness_contracts.py` 生成）。

| 业务模块 | 接口路由 (Route) | HTTP 方法 | 请求入参签名 (Request Payload) | 响应数据 (Response Body) | 关键错误码与交互边界 |
| :--- | :--- | :---: | :--- | :--- | :--- |
| **认证** | `/api/v1/auth/csrf` | `GET` | *(无入参)* | `{ csrfToken: string }` | 公开无门槛端点，单飞刷新 CSRF Token |
| | `/api/v1/auth/password-policy` | `GET` | *(无入参)* | `PasswordPolicyDTO` | 查询当前登录用户密码轮换周期与到期时间 |
| | `/api/v1/auth/password-policy` | `PUT` | `{ passwordExpiresDays: number | null }` | `{ success: true, passwordExpiresDays: number | null, passwordExpiresAt: string | null, isExpirationEnabled: boolean }` | 调整密码轮换天数 (30~180天，null 为关闭轮换并弹高危风险确认对话框) |
| | `/api/v1/auth/register` | `POST` | `{ username, password, email, department, reason }` | `{ success: true, message: string }` | 注册申请成功，引导进入待审排队页 |
| | `/api/v1/auth/login` | `POST` | `{ username, password }` | `{ user: UserProfileDTO }` (Cookie 下发) | `ERR_AUTH_FAILED` (提示防爆破剩余次数) |
| | `/api/v1/auth/logout` | `POST` | *(无入参)* | `{ success: true }` | 调用 SessionRequestManager 掐断，清空缓存 |
| | `/api/v1/auth/change-password`| `POST` | `{ oldPassword, newPassword }` | `{ success: true }` | 成功后轮换 CSRF 并解锁全局改密限制 |
| | `/api/v1/auth/me` | `GET` | *(无入参，依赖 Cookie)* | `UserProfileDTO` | 401 重定向登录，网络超时展示重试卡片 |
| **审批** | `/api/v1/approvals/pending` | `GET` | `?page=1&pageSize=20` | `Paginated<PendingApprovalDTO>` | 待审批工单高密度分页列表 |
| | `/api/v1/approvals/:id/approve`| `POST`| `{ roleIds: string[] }` | `{ success: true }` | 严格非乐观更新，等待 HTTP 200 后刷新列表 |
| | `/api/v1/approvals/:id/reject` | `POST`| `{ reason: string }` | `{ success: true }` | 必填驳回理由校验 |
| | `/api/v1/approvals/resubmit` | `POST`| `{ email, department, reason }` | `{ success: true }` | 重新提交后跳转至 `/approvals/wait` |
| **用户** | `/api/v1/users` | `GET` | `?page=1&pageSize=20&search=...` | `Paginated<UserListItemDTO>` | 含 `is_last_super_admin` 标记 |
| | `/api/v1/users/:id/status` | `PUT` | `{ status: "DISABLED" \| "ACTIVE", version }` | `{ success: true }` | 命中 `ERR_LAST_SUPER_ADMIN` 或本人保护阻断 |
| | `/api/v1/users/:id/roles` | `PUT` | `{ roleIds: string[], version }` | `{ success: true }` | 命中超管防自残阻断；低权限禁止越权提权 |
| | `/api/v1/users/:id` | `DELETE` | *(无入参)* | `{ success: true }` | 本人与最后超管保护，二次确认弹窗 |
| **PAT** | `/api/v1/pats` | `GET` | *(无入参)* | `PatListItemDTO[]` | 仅返回 `token_prefix` 与脱敏摘要 |
| | `/api/v1/pats` | `POST` | `{ name, expiresDays }` | `{ pat: PatCreatedDTO, rawToken: string }` | **仅本次返回 rawToken，触发三态防呆弹窗** |
| | `/api/v1/pats/:id/revoke` | `POST` | *(无入参)* | `{ success: true }` | 仅支持吊销本人 PAT，二次确认 |
| **数据源** | `/api/v1/profiles` | `GET` | *(无入参)* | `ProfileDTO[]` | 密码脱敏为 `******`，包含 `version` |
| | `/api/v1/profiles/my-options` | `GET` | *(无入参)* | `ProfileOptionDTO[]` | 普通研发配置向导轻量选项 (不泄露运维配置) |
| | `/api/v1/profiles` | `POST` | `{ name, display_name, host, port, user, password, database, max_pool_size, profile_capacity_qpm }` | `{ id: string }` | 新建数据源，初始版本号 1 |
| | `/api/v1/profiles/:id` | `PUT` | `{ ...profileFields, version }` | `{ success: true }` | 密码留空不改；409 冲突保留草稿并提示 |
| | `/api/v1/profiles/:id` | `DELETE` | *(无入参)* | `{ success: true }` | 级联检查，若有依赖阻断删除 |
| | `/api/v1/profiles/test-db` | `POST` | `{ profile_id?, host?, port?, user?, password?, database?, tls_config?, use_ssh?, ssh_host?, ssh_port?, ssh_user?, ssh_private_key?, ssh_host_fingerprint_sha256? }` | `{ reachable: boolean, latencyMs: number }` | 三模式测试；`ERR_SSRF_PROHIBITED` 引导白名单 |
| | `/api/v1/profiles/test-ssh`| `POST` | `{ profile_id?, host?, port?, username?, privateKey?, hostFingerprintSha256? }` | `{ reachable: boolean, latencyMs: number }` | 三模式测试；`ERR_SSRF_PROHIBITED` 引导白名单 |
| **角色ACL**| `/api/v1/roles` | `GET/POST`| GET无 / POST: `{ role_name, display_name, description?, profileIds: string[] }` | `RoleDTO[]` / `{ id: string }` | 角色模版创建与列表 |
| | `/api/v1/roles/:id` | `PUT/DELETE`| PUT: `{ display_name?, description?, profileIds: string[], default_limit?, max_limit?, max_timeout_ms?, user_qpm_limit?, version }` / DELETE无 | `{ success: true }` | 角色模版与策略参数更新/删除 (带版本校验) |
| | `/api/v1/roles/:id/table-acls` | `GET/PUT` | GET无 / PUT: `{ rules: TableAclRuleDTO[], version }` | `TableAclResponseDTO` / `{ success: true }` | 表级黑名单置顶，支持 409 冲突控制 |
| | `/api/v1/roles/:id/db-acls` | `GET/PUT` | GET无 / PUT: `{ rules: DbAclRuleDTO[], version }` | `DbAclResponseDTO` / `{ success: true }` | 库级结构化规则 (ALLOW/DENY/profile_id="0"为全局) |
| **限流** | `/api/v1/rate-limits/global` | `GET/PUT`| GET无 / PUT: `{ defaultUserQuotaQpm, burstCapacity, agentLoopThreshold, agentLoopWindowSec, version }` | `GlobalRateLimitDTO` / `{ success: true }` | 全局默认配额与死循环熔断阈值 |
| | `/api/v1/rate-limits/users/:id`| `GET/PUT`| GET无 / PUT: `{ userQuotaQpm, burstCapacity?, revision }` | `UserRateLimitDTO` / `{ success: true }` | 用户专属配额 (-1 免限流，受 Profile 上限约束) |
| **审计** | `/api/v1/audits` | `GET` | `?status=...&profile=...&query_instance_id=...&page=1`| `Paginated<AuditRecordDTO>` | 支持按 `query_instance_id` 精确单条回补 |
| | `/api/v1/audits/stats` | `GET` | `?profile_id=...&range=today` | `AdminDashboardStatsDTO` 或 `DeveloperDashboardStatsDTO` | 10s 轮询，服务端根据角色进行脱敏裁剪 |
| | `/api/v1/audits/export` | `POST` | `{ range, profile_id?, status? }` | `{ downloadUrl: string, count: number }` | 导出脱敏审计 CSV |
| **通知** | `/api/v1/settings/notifications`| `GET/PUT` | GET无 / PUT: `{ channels: NotificationChannelDTO[], version }` | `NotificationSettingsDTO` / `{ success: true }` | 企微/钉钉/飞书 Webhook 渠道配置 |
| | `/api/v1/settings/test-notify` | `POST` | `{ channelType: "WECHAT" \| "DINGTALK" \| "FEISHU", webhookUrl: string }` | `{ success: true, latencyMs: number }` | 发送测试通知，带 SSRF 防重绑定拦截 |
| | `/api/v1/users/:id/reset-password` | `POST` | `{ newTemporaryPassword?, mustChangePassword?, version }` | `{ success, temporaryPassword, version }` | 仅SUPER_ADMIN；二次确认；临时密码仅本次展示、不持久缓存；409保留输入并刷新版本 |
| | `/api/v1/rate-limits/users/:id` | `DELETE` | `?revision=N`（N>0，兼容version） | `{ success: true }` | 恢复继承按钮；409刷新；QPM按角色/全局、burst按GLOBAL重新取值 |
| | `/api/v1/audits/export/download` | `GET` | `?ticket=...` | `text/csv` 文件流 | 同源Cookie下载；过期/已消费403引导重新导出；不自动复用Ticket |

---

### 8.2 核心 DTO 字段结构定义 (空值规范与大整型字符串契约)

```ts
// 用户基础模型 DTO (email 对齐数据库允许为 NULL 约束)
export interface UserProfileDTO {
  id: string;                 // 服务端强制输出为字符串，防止精度丢失
  username: string;
  email: string | null;       // 规范对齐：允许为空
  department: string | null;
  status: 'PENDING' | 'ACTIVE' | 'REJECTED' | 'DISABLED';
  must_change_password: boolean;
  password_updated_at?: string;
  password_expires_days: number | null;
  password_expires_at: string | null;
  is_password_expired: boolean;
  version: number;
  roles: string[];
  reject_reason: string | null;
  created_at: string;
}

// 用户密码生命周期策略 DTO (100% 对齐 GET /api/v1/auth/password-policy 线上契约)
export interface PasswordPolicyDTO {
  passwordExpiresDays: number | null; // 30~180 天；关闭定期更换时为 null
  passwordExpiresAt: string | null;   // ISO 8601 UTC 到期时间；关闭定期更换时为 null
  isExpirationEnabled: boolean;       // 是否启用定期更换
  daysRemaining: number;              // 剩余有效天数；关闭定期更换时固定为 -1
  isExpired: boolean;                 // 当前密码是否已自然过期
  minDays: number;                    // 最小可配天数 (30)
  maxDays: number;                    // 最大可配天数 (180)
}

// 审计流水实体 DTO (100% 对齐 sys_audit_logs 物理表)
export interface AuditRecordDTO {
  id: string;                 // 服务端强制序列化为 string，防 64 位整型截断
  query_instance_id: string;  // 全局唯一查询实例 ID (VARCHAR(64))
  session_id: string | null;  // 逻辑 McpSession ID (允许 null)
  user_id: string;
  username: string;
  profile_id: string;
  profile_name: string | null;// 若已解绑/删除为 null，前端规范回显 "(已解绑数据源)"
  database_name: string | null;// 允许 null
  sql_text: string;           // 脱敏后的完整 SQL
  sql_type: string;           // SELECT 等
  status: AuditStatus;        // SUCCESS, BLOCKED_AST, BLOCKED_ACL, BLOCKED_CONCURRENCY, BLOCKED_RATE, CANCELED, FAILED_MYSQL, TIMEOUT
  error_message: string | null;
  latency_ms: number;
  rows_affected: number;
  client_ip: string;
  is_high_risk: boolean;
  created_at: string;
}

// 库级结构化 ACL 规则 DTO
export interface DbAclRuleDTO {
  id?: string;
  profile_id: string;         // "0" 表示对该角色名下所有 Profile 生效的全局规则
  database_name: string;      // 目标数据库名 (v1.0仅精确名，拒绝通配符)
  effect: 'ALLOW' | 'DENY';   // 明确允许或拒绝 (DENY 优先)
}

export interface DbAclResponseDTO {
  rules: DbAclRuleDTO[];
  version: number;            // 规则集版本号
}

// 表级结构化 ACL 规则 DTO
export interface TableAclRuleDTO {
  id?: string;                        // 规则唯一标识 (读取时提供)
  profile_id: string;                 // "0" 为全局规则
  table_pattern: string;              // 支持通配符如 "salary_*" 或 "order_*"
  rule_type: 'BLACKLIST' | 'WHITELIST'; // 规则类型: 黑名单优先生效
  description?: string | null;        // 规则备注说明
}

export interface TableAclResponseDTO {
  rules: TableAclRuleDTO[];
  version: number;
}

// 普通研发轻量 Profile 选项 DTO (不暴露底层运维配置)
export interface ProfileOptionDTO {
  id: string;
  name: string;
  displayName: string;
}

// 管理员大盘统计 DTO (全量运维视角)
export interface AdminDashboardStatsDTO {
  total_calls_today: number;
  total_calls_growth_pct: number;
  active_sessions_count: number;
  active_db_connections: number; // 物理连接数 (独立指标)
  high_risk_blocked_count: number;
  pending_approvals_count: number;
  profile_traffic: Array<{
    profile_id: string;
    profile_name: string;
    profile_capacity_qpm: number;// QPM 容量上限
    current_qpm: number;         // 当前实时吞吐
    time_series: Array<{
      timestamp: string;
      actual_qpm: number;
      limit_qpm: number;
    }>;
  }>;
}

// 普通研发大盘统计 DTO (个人视图脱敏裁剪，不暴露底层连接数与审批数)
export interface DeveloperDashboardStatsDTO {
  personal_calls_today: number;
  personal_calls_growth_pct: number;
  personal_blocked_count: number;
  authorized_profiles: Array<{
    profile_id: string;
    profile_name: string;
    user_quota_qpm: number;     // 个人配额
    current_qpm: number;        // 个人吞吐
    time_series: Array<{
      timestamp: string;
      personal_qpm: number;
    }>;
  }>;
}

// 数据源实体 DTO
export interface ProfileReadDTO {
  id: string;
  name: string;
  display_name: string;
  environment: 'PROD' | 'STG' | 'DEV';
  host: string;
  port: number;
  username: string; // GET只返回username，写请求使用user
  database: string;
  max_pool_size: number;
  profile_capacity_qpm: number;
  queue_timeout_ms: number;
  max_inflight_concurrency: number;
  use_ssh: boolean;
  ssh_host?: string | null;
  ssh_port?: number | null;
  ssh_user?: string | null;
  ssh_host_fingerprint_sha256?: string | null;
  tls_config: { enabled: boolean; ca_cert?: string | null } | null;
  status: 'ACTIVE' | 'DISABLED';
  version: number;
  created_at: string;
  updated_at: string;
}
export type ProfileDTO = ProfileReadDTO; // 仅供旧读调用迁移，不能作为写Payload
// CreateProfilePayload / UpdateProfilePayload 从 docs/contracts/readiness.types.ts 生成导入。
// 仅选择可写字段，不展开整个读DTO；不回填密码、私钥、id、时间和status。
export function profileToEditForm(profile: ProfileReadDTO) {
  return {
    display_name: profile.display_name, host: profile.host, port: profile.port,
    user: profile.username, database: profile.database,
    max_pool_size: profile.max_pool_size, queue_timeout_ms: profile.queue_timeout_ms,
    profile_capacity_qpm: profile.profile_capacity_qpm,
    max_inflight_concurrency: profile.max_inflight_concurrency,
    use_ssh: profile.use_ssh, ssh_host: profile.ssh_host ?? undefined,
    ssh_port: profile.ssh_port ?? undefined, ssh_user: profile.ssh_user ?? undefined,
    ssh_host_fingerprint_sha256: profile.ssh_host_fingerprint_sha256 ?? undefined,
    tls_config: profile.tls_config, version: profile.version,
  };
}
```

---

### 8.3 后端协同确认契约清单 (Backend Collaboration Tracker)

为杜绝前端单方面定契约导致的联调阻断，将本详细设计中梳理出的需后端协同入库的契约点单独建表跟踪：

| 契约项 | 前端详细设计诉求 | 后端主架构现状 | 联调协同与入库状态 |
| :--- | :--- | :--- | :--- |
| **1. 审计单条精确回补** | `GET /api/v1/audits?query_instance_id=xxx` 支持精准拉取单条记录，用于 URL 深度直达 | 已有分页 `/audits` 接口，入参需增加 `query_instance_id` 过滤分支 | ✅ 已在 BACKEND_ARCHITECTURE_SPEC v1.0.0 闭环入库 |
| **2. 连通性测试草稿模式**| `test-db`/`test-ssh` 支持传 `{ profile_id, host, port }`，自动复用密文密码与新参数测试 | 已有连通性测试端点，需扩展入参联合解析逻辑 | ✅ 已在 BACKEND_ARCHITECTURE_SPEC v1.0.0 闭环入库 |
| **3. 实体乐观锁版本机制**| `Profile`、`Role`、`ACL`、`RateLimit` 响应增加 `version`，PUT 校验 `version`，409 拦截 | 需后端确认版本来源方案 (增加 version 列 / ETag / updated_at 毫秒戳) | ✅ 已在 BACKEND_ARCHITECTURE_SPEC v1.0.0 闭环入库 |
| **4. 库级 ACL 结构化规则**| 库级 ACL 传 `DbAclRuleDTO[]` (包含 `profile_id`, `database_name`, `effect`) | 物理表 `sys_role_database_acls` 结构完全支持，API 需对齐 DTO | ✅ 已在 BACKEND_ARCHITECTURE_SPEC v1.0.0 闭环入库 |
| **5. 大盘响应按角色裁剪**| 普通研发人员调用 `/audits/stats` 时，服务端自动脱敏裁剪为 `DeveloperDashboardStatsDTO` | 已有 `/audits/stats`，需在 Service 层按当前用户角色做返回体分支 | ✅ 已在 BACKEND_ARCHITECTURE_SPEC v1.0.0 闭环入库 |
| **6. CSRF 独立获取端点**| `GET /api/v1/auth/csrf` 作为公开端点，在各守卫前均放行访问 | 需在 Fastify 路由注册全局放行名单 | ✅ 已在 BACKEND_ARCHITECTURE_SPEC v1.0.0 闭环入库 |
| **7. 限流更新路由目标拆分**| 拆分为 `/rate-limits/global` (全局与熔断) 与 `/rate-limits/users/:id` (用户配额) | 目前基线路由为扁平 `/rate-limits`，需拆分端点映射 | ✅ 已在 BACKEND_ARCHITECTURE_SPEC v1.0.0 闭环入库 |
| **8. 64 位整型字符串输出**| 超过 53 位的 BIGINT 实体 ID，后端在 JSON 序列化阶段强制输出为 `string` 格式 | 需在 Fastify 序列化器或 DTO 转换层配置大数字符串化 | ✅ 已在 BACKEND_ARCHITECTURE_SPEC v1.0.0 闭环入库 |
| **9. 研发轻量 Profile 选项**| 提供 `GET /api/v1/profiles/my-options`，仅返回 `{ id, name, displayName }` 脱敏选项 | 避免普通研发调用管理端全量 Profile 列表造成信息泄露 | ✅ 已在 BACKEND_ARCHITECTURE_SPEC v1.0.0 闭环入库 |

---

## 第九章：异常防御、错误码自愈映射与设计令牌体系

### 9.1 后端标准错误码与前端自愈指引映射表 (Error Code Matrix)
前端 HTTP 拦截器严格基于架构基线标准错误码执行交互映射：

| 错误编码 (`code`) | HTTP 状态码 | 触发场景 | 前端交互反馈与自愈指引 (Action Guidance) |
| :--- | :---: | :--- | :--- |
| `ERR_MUST_CHANGE_PASSWORD` | 403 | 首次登录使用初始密码 | 路由全局拦截锁，重定向至 `/change-password` 并锁定控制台其他功能 |
| `ERR_LAST_SUPER_ADMIN` | 400 | 尝试停用/降级最后 1 名超管 | 模态弹窗醒目解释：“系统必须保留至少 1 名活跃超管，请先激活其他超管” |
| `ERR_AST_FORBIDDEN_SYNTAX` | 403 | 查询包含 UPDATE/DELETE/锁表 | 抽屉标红定位违规关键词，提示：“网关只读模式禁止写操作与 FOR UPDATE” |
| `ERR_AST_TABLE_DENIED` | 403 | 访问未授权表或黑名单表 | 标明命中的黑名单通配符，提供【联系管理员申请表授权】快捷指引 |
| `ERR_AST_LIMIT_FAIL_CLOSED` | 400 | 复合 SQL 无法安全重写 LIMIT | 提示：“网关无法安全推断嵌套层级，请在最外层显式书写 LIMIT 子句” |
| `ERR_RATE_LIMIT_USER` | 429 | 用户主体配额桶超限 | Toast 提示配额超限，展示漏斗恢复倒计时（`Retry-After` 秒数） |
| `ERR_RATE_LIMIT_PROFILE` | 429 | Profile 资源保护桶打满 | 提示：“数据源并发压力过大，网关正在排队保护，请稍后重试” |
| `ERR_AGENT_LOOP_DETECTED` | 429 | Agent 连续 3 次相同报错 | 触发死循环熔断卡片提示，展示自动冷却倒计时，并建议排查模型 Prompt |
| `ERR_SSRF_PROHIBITED` | 403 | 连通性测试命中受限 IP | 表单对应输入框下方标红并给出 `ALLOWED_OUTBOUND_IPS` 出站白名单引导 |
| `ERR_CONCURRENCY_CONFLICT`| 409 | 存在并发配置修改 | 弹出冲突提示条：“该配置已被其他管理员更新，请重新加载最新版本” |

### 9.2 全局 React Error Boundary 弹性降级机制
- **路由级边界隔离**：在每个路由视图（View）外层包裹独立的 `ErrorBoundary`。单个视图崩溃仅局部降级为重试占位卡片，侧边栏与全局顶栏保持可用；
- **抽屉重置机制**：排查抽屉内部组件发生未捕获异常时，自动回退并提供【关闭并重置抽屉状态】按钮，清除 URL 中的 `eventId` 参数，保护主列表工作流不被中断。

### 9.3 OKLCH 双模式色彩令牌与设计令牌规范
在 `src/styles/theme.css` 中采用现代 Tailwind v4 `@theme` 声明，同时满足 WCAG 2.1 AA 对比度基准（正文 `>= 4.5:1`，控件边框 `>= 3.0:1`）：

```css
@theme {
  /* 双引擎字体族 */
  --font-sans: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
  --font-mono: "JetBrains Mono", Consolas, monospace;
}

/* 暗色模式调色板 (Dark Mode Default) */
:root, [data-theme="dark"] {
  --color-bg-app: oklch(0.12 0.005 260);          /* #090D16 全局大背景 */
  --color-bg-sidebar: oklch(0.14 0.006 258);      /* #0D131C 侧边栏背景 */
  --color-bg-card: oklch(0.16 0.008 255);         /* #111827 容器卡片表面 */
  --color-bg-surface: oklch(0.20 0.01 255);       /* #172231 悬浮与次级背景 */
  --color-border-line: oklch(0.28 0.01 255);      /* #233044 1px 分割线 (对比度合规) */
  --color-fg-main: oklch(0.96 0.005 260);         /* #F1F5F9 一级正文主文本 */
  --color-fg-muted: oklch(0.72 0.01 255);         /* #94A3B8 次要说明文本 */
  
  /* 品牌与网络主色 (Electric Sky) */
  --color-primary: oklch(0.72 0.16 230);          /* #38BDF8 对比度 > 4.5:1 */
  --color-primary-soft: oklch(0.24 0.05 230);

  /* 四象限安全语义色 (Security Semantic Scale) */
  --color-safe: oklch(0.78 0.16 155);             /* 翠绿 - SUCCESS / ACTIVE */
  --color-safe-soft: oklch(0.22 0.05 155);
  --color-warning: oklch(0.82 0.15 85);           /* 琥珀 - 慢查询 / 待审批 */
  --color-warning-soft: oklch(0.25 0.05 85);
  --color-danger: oklch(0.70 0.20 20);            /* 鲜红 - AST违规 / SSRF阻断 */
  --color-danger-soft: oklch(0.22 0.06 20);
  --color-secret: oklch(0.78 0.16 295);           /* 紫罗兰 - 256bit PAT / 密钥 */
  --color-secret-soft: oklch(0.23 0.05 295);
}

/* 浅色高对比度模式 (Light Mode) */
[data-theme="light"] {
  --color-bg-app: oklch(0.985 0.002 247);        /* #F8FAFC 全局背景 */
  --color-bg-sidebar: oklch(0.96 0.003 245);      /* #F1F5F9 侧边栏背景 */
  --color-bg-card: oklch(1 0 0);                  /* #FFFFFF 容器卡片表面 */
  --color-bg-surface: oklch(0.94 0.005 245);      /* #E2E8F0 悬浮背景 */
  --color-border-line: oklch(0.88 0.005 245);     /* #CBD5E1 1px 分割线 */
  --color-fg-main: oklch(0.15 0.005 260);         /* #0F172A 一级正文 */
  --color-fg-muted: oklch(0.45 0.02 245);         /* #475569 次要说明 */
  
  --color-primary: oklch(0.48 0.18 240);          /* #0284C7 浅色品牌色 */
  --color-primary-soft: oklch(0.94 0.04 240);

  --color-safe: oklch(0.45 0.16 155);             /* 深绿放行 */
  --color-safe-soft: oklch(0.94 0.04 155);
  --color-warning: oklch(0.49 0.14 82);           /* 深琥珀预警 (相对 warning-soft 对比度 >= 5.45:1，满足 WCAG 2.1 AA) */
  --color-warning-soft: oklch(0.95 0.04 85);
  --color-danger: oklch(0.50 0.20 20);            /* 深红高危阻断 */
  --color-danger-soft: oklch(0.95 0.04 20);
  --color-secret: oklch(0.48 0.16 295);           /* 深紫机密凭据 */
  --color-secret-soft: oklch(0.94 0.04 295);
}
```

---

## 第十章：工程验收准则与自动化测试矩阵

### 10.1 单元测试与双向契约测试规范 (Vitest)
前端测试覆盖率必须满足以下基线要求：
- **状态机与守卫测试**：
  - 测试分层守卫执行顺序：断言 `PENDING`、`REJECTED`、`DISABLED` 状态账号优先被 `StatusGuard` 拦截，**绝对不触发 `MustChangePwdGuard`**，杜绝未审用户改密死循环；
  - 测试 `StatusGuard` 路由重定向断言与豁免白名单；
  - 测试 `useInspectDrawer` 与 URL SearchParams 的双向同步契约；
- **安全与边缘用例测试**：
  - **`sanitizeReturnUrl` 严格边界测试**：
    - 传入反斜杠伪装：`String.raw`/\example.org/account`` ➔ 断言返回 `/dashboard`；
    - 传入路径穿越协议相对路径：`/a/..//example.org/account` ➔ 断言返回 `/dashboard`；
    - 传入同源双斜杠：`https://console.example//example.org/account` ➔ 断言返回 `/dashboard`；
    - 传入正常站内路径：`/audits?status=SUCCESS` ➔ 断言返回原路径；
  - 测试 `UserProfileSchema` 针对 `email: null` 空邮箱用户的解析放行，断言与数据库 NULLABLE 一致；
  - 测试 64 位大整型主键 ID：断言 Schema 将大数字符串正确解析为 `string`，杜绝数字精度截断；
  - 测试多角色策略合并逻辑：同名数据库在一个角色中为 ALLOW、另一角色中为 DENY，断言最终判定为 `DENY`（黑名单绝对优先）；
- **契约与 DTO 静态双向测试**：
  - 在 CI 中强制执行 `vitest --typecheck` 或 `tsc --noEmit`，通过 `expectTypeOf` 验证本地 Zod 独立推断类型与 `packages/shared-types` 的纯 TS 类型双向等价；
  - 测试各后端标准错误码自愈映射转换器。

### 10.2 端到端核心业务验收测试链路 (Playwright E2E)
E2E 测试必须覆盖以下 6 大验收链路（全绿作为交付前提）：
1. **链路 1：首次登录强制改密与自锁闭环**
   - 模拟使用初始密码登录 -> 验证自动重定向至 `/change-password` -> 尝试手动跳转 `/audits` 验证被硬拦截 -> 完成密码重置 -> 验证成功解锁进入 `/dashboard`；
2. **链路 2：最后 1 名超管防自残与本人操作保护**
   - 超管登录用户管理页 -> 定位当前登录人自身行 -> 断言【冻结】与【删除】按钮为 disabled 状态 -> 验证提示“禁止对当前登录账号自身执行操作”；
   - 定位当前唯一超管行 -> 断言【冻结】与【删除】按钮为 disabled 状态 -> 验证提示“系统必须保留至少 1 名活跃超管”；
3. **链路 3：PAT 签发单次展示与防呆确认**
   - 触发签发 PAT 弹窗 -> 按 ESC 键触发二级退出确认（文案明确“放弃保存不影响令牌生效”） -> 验证【确认已保存】按钮默认 disabled -> 点击复制并在复选框打勾 -> 验证按钮激活并关闭 -> 刷新列表断言明文永不再现；
4. **链路 4：审计日志抽屉原位排查与响应式断点**
   - 视口宽度 1500px 时，断言抽屉宽度为 **600px**；视口宽度 1200px 时，断言抽屉宽度为 **540px**；
   - 点击审计列表第 1 行 -> 验证 URL 变为 `?eventId=query_instance_id` -> 复制该完整 URL 在新标签页打开 -> 验证新标签页自动打开抽屉并拉取该单条记录聚焦；
5. **链路 5：SSRF 拦截合规引导**
   - 数据源配置录入受限 IP -> 点击连通性测试 -> 捕获 `ERR_SSRF_PROHIBITED` 错误 -> 验证表单下方准确出现“出站白名单 ALLOWED_OUTBOUND_IPS”自愈指引；
6. **链路 6：并发冲突阻断与草稿保留 (Optimistic Lock Test)**
   - 模拟两端同时修改同一 Profile -> 第二端提交携带旧 `version` -> 捕获 HTTP 409 `ERR_CONCURRENCY_CONFLICT` -> 验证界面显示冲突警告条、**用户已输入的表单草稿未被清空**，高亮显示冲突字段。

### 10.3 性能预算基线 (Bundle Size Budget & LCP)
- 核心代码包体积（gzip 压缩后）：
  - `vendors`（React + Router + QueryClient）：**<= 140KB**；
  - `admin-ui-core`（公共 Shell + 设计令牌）：**<= 40KB**；
  - 动态路由 Chunk（如 `AuditsView`、`DashboardView`）：单个 **<= 60KB**；
- 性能关键指标（在 100Mbps 局域网基准下）：
  - **最大内容绘制 (LCP)**：<= 800ms；
  - **首次输入延迟 (FID / INP)**：<= 50ms；
  - **累积布局偏移 (CLS)**：<= 0.02（全量指标与代码强制 `tabular-nums`，杜绝抖动）。

---

## 第十一章：前端实施里程碑与排期计划 (Phased Roadmap)

结合系统单节点原型工程基线与功能分期规划，前端工程采用 **4 个阶段** 推进落地：

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        前端工程开发推进路线图 (Roadmap)                                │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ 【阶段 P1: 基础骨架与设计系统交付】 (周期: 1 周)                                      │
│ ├─ 初始化 apps/admin-ui (Vite 6 + React 19 + Tailwind v4 @theme + TypeScript Strict)   │
│ ├─ 落地“三纵两横一抽屉”骨架 (Sidebar 240/64px, Topbar 56px, Sheet 600/540px)          │
│ └─ 固化 OKLCH 双模式色彩体系、双引擎字体排版与暗浅主题切换器                           │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ 【阶段 P2: 鉴权安全闭环与自服务体系】 (周期: 1.5 周)                                  │
│ ├─ 实现登录/注册视图与基于 HttpOnly Cookie 的会话状态机                               │
│ ├─ 落地 StatusGuard 与 MustChangePwdGuard 全生命周期四级分层守卫管道                   │
│ ├─ 落地开发者个人中心: 单次展示 PAT 签发受限模态框与防呆保存复选确认                   │
│ └─ 客户端配置片段生成器 (Claude Desktop / Codex / 通用 cURL 三态生成向导)              │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ 【阶段 P3: 核心管理与高密度数据面】 (周期: 2 周)                                      │
│ ├─ 全链路 SQL 审计高密度表格 (TanStack Table v8 + Virtual, 38px 行高, URL SSOT 状态机) │
│ ├─ 原位排查抽屉 (基于 sys_audit_logs 真实字段: 脱敏SQL, 真实状态, 耗时, 错误信息, URL回补)│
│ ├─ 用户生命周期与审批中心 (通过/驳回工单, 驳回重提流程)                                │
│ └─ 超管防自残与本人保护拦截 (前端按钮级禁用置灰 + 锁图标 + ERR_LAST_SUPER_ADMIN 重载)  │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ 【阶段 P4: 策略矩阵与大盘态势感知】 (周期: 1.5 周)                                    │
│ ├─ 数据源 Profile CRUD 与连通性测试器 (三模式测试，带出站白名单引导)                   │
│ ├─ 表级与库级 ACL 结构化黑白名单编辑矩阵 (黑名单绝对置顶) + 多角色合并决策展示         │
│ ├─ 双重漏斗限流多目标配置中心 (逻辑 AND 串接)                                          │
│ └─ Bento Grid 监控大盘构建 (Profile 维度对齐的双折线流量对比，10s 短轮询基线)          │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 附录：与相关设计规范文档索引

- **系统主架构设计说明书**：[`docs/ARCHITECTURE_SPEC.md`](./ARCHITECTURE_SPEC.md)（特别参考 ADR-05、§6.2 REST API、§6.3 错误码与 §7.1 Monorepo 目录结构）
- **Web 控制台布局规范说明书**：[`docs/LAYOUT_SPEC.md`](./LAYOUT_SPEC.md)（特别参考“三纵两横一抽屉”与四大场景范式）
- **Web UI 设计规范说明书**：[`docs/UI_DESIGN_SPEC.md`](./UI_DESIGN_SPEC.md)（特别参考 OKLCH 色彩空间与四象限语义）
- **需求规格说明书**：[`docs/REQUIREMENTS.md`](./REQUIREMENTS.md)（特别参考 PRD 功能项与安全要求）
- **单文件高保真交互演示原型**：[`admin-console-demo.html`](../admin-console-demo.html)（涵盖所有组件视觉与高密度排版的原型参考）