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