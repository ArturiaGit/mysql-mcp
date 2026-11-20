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