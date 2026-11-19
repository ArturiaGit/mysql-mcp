# MySQL-MCP 企业级安全网关与管控平台 - Web UI 设计规范说明书 (Design System Spec)

| 规范版本 | 发布日期 | 设计风格 | 空间密度标准 | 适配组件体系 |
| :--- | :--- | :--- | :--- | :--- |
| **v1.0.0** | 2026-11-07 | **Modern Zero-Trust Infra Console (云原生零信任基础设施控制台)** | **High Density (8/10 紧凑级)** | **Tailwind CSS v4 + shadcn/ui (radix-nova / base-nova)** |

---

## 一、设计定位与核心原则 (Design Philosophy)

本平台并非普通的通用后台管理软件，而是承载 **大模型接入控制、AST 语法防火墙、Fail-Closed 只读阻断、双重漏斗限流、分级审计落库** 的企业级数据库安全网关与管控中心。

### 核心设计原则 (The 4 Pillars)
1. **Security & Zero-Trust Visible (零信任与安全态势一等公民)**
   - 安全状态不是隐藏在后台的冷冰冰日志，而是界面的核心视觉信号。
   - AST 拦截（如 `FOR UPDATE`、`SLEEP()`）、SSRF 阻断、Agent 连续报错熔断等关键安全事件，必须具备最高优先级的视觉感知与精准的语义色反馈。
2. **High Information Density (高信息密度，Density 8/10)**
   - 专为 DBA、安全工程师 (SecOps) 与后端/AI 研发设计，拒绝大面积空旷留白和松散间距。
   - 在标准 1080P/2K 屏幕下单屏尽可能展示更多核心指标、审计流水与策略项，表格行高控制在 **36px~38px**，卡片内边距控制在 **16px**。
3. **Fail-Closed & Irreversible Action Safeguard (防呆与防自残保护)**
   - 针对高危操作（撤销超管、冻结账户、注销正在执行的 PAT、切断物理连接）实行防呆保护。
   - 涉及系统最后 1 名活跃超管的禁用/删除操作，在 UI 控件层提供硬锁闭（Disabled + 锁图标 + 风险 Tooltip），避免误触导致系统失控。
4. **Dual-Engine Typography (双引擎文字排版规范)**
   - 界面常规功能文字与技术代码数据（SQL、AST 报错、PAT 密钥、IP/CIDR、JSON 配置、表名字段名）使用两套独立的排版字体族。
   - 全局所有数值、QPM、延迟 (ms)、行数字符串强制开启等宽数字 (`tabular-nums`)，杜绝监控数据刷新时的视觉抖动。

---

## 二、色彩体系与设计令牌 (Color Palette & Tokens)

设计系统采用 **Dark-First（暗色优先）** 架构，同时提供**高对比度的 Light Mode（浅色办公模式）**。颜色基于现代 **OKLCH** 色彩空间定义，保证色彩在不同亮度下的感知一致性。

### 2.1 基础基调色彩 (Base & Neutrals)
采用冷灰/暗冷蓝中性色阶（基于 Zinc/Slate 精细调配），避免使用发灰发脏的纯灰，杜绝纯黑（#000000）导致的视觉断层。

| 令牌名 (Token) | Light Mode (Hex / OKLCH) | Dark Mode (Hex / OKLCH) | 语义说明 |
| :--- | :--- | :--- | :--- |
| `--background` | `#F8FAFC` / `oklch(0.985 0.002 247)` | `#090D16` / `oklch(0.12 0.005 260)` | 控制台全局大背景 |
| `--foreground` | `#0F172A` / `oklch(0.145 0.005 260)` | `#F1F5F9` / `oklch(0.96 0.005 260)` | 一级正文主文本 |
| `--card` | `#FFFFFF` / `oklch(1 0 0)` | `#111827` / `oklch(0.16 0.008 255)` | 容器、卡片、侧边栏表面 |
| `--card-foreground`| `#0F172A` / `oklch(0.145 0.005 260)` | `#F1F5F9` / `oklch(0.96 0.005 260)` | 卡片内正文 |
| `--muted` | `#F1F5F9` / `oklch(0.95 0.005 245)` | `#1E293B` / `oklch(0.24 0.01 255)` | 禁用、次级背景、表头背景 |
| `--muted-foreground`|`#64748B` / `oklch(0.55 0.02 245)` | `#94A3B8` / `oklch(0.70 0.01 255)` | 次要说明、辅助提示文本 |
| `--border` | `#E2E8F0` / `oklch(0.90 0.005 245)` | `#1E293B` / `oklch(0.25 0.01 255)` | 1px 细线边框、分割线 |
| `--input` | `#E2E8F0` / `oklch(0.90 0.005 245)` | `#1E293B` / `oklch(0.25 0.01 255)` | 输入框外框描边 |

### 2.2 品牌与网关主色 (Primary Accent)
选用象征**高可用网络、安全隧道与数据流**的 **Electric Sky / Cyan (电光天蓝)**：
- **Light Primary**: `#0284C7` / `oklch(0.55 0.18 240)` | 前景色：`#FFFFFF`
- **Dark Primary**: `#38BDF8` / `oklch(0.72 0.16 230)` | 前景色：`#082F49`
- **Focus Ring (`--ring`)**: 与 Primary 联动，高亮聚焦外发光 `ring-2 ring-primary/40`

### 2.3 安全网关专属状态语义色 (Security Semantic Scale)
在安全管控平台中，状态绝不可混淆，建立严密的四色安全标准：

```
┌────────────────────────────────────────────────────────────────────────┐
│                        安全语义色彩四象限                             │
├────────────────────────────────┬───────────────────────────────────────┤
│  🟢 安全放行 (Emerald #10B981)   │  🟠 预警与限流 (Amber #F59E0B)        │
│  - AST 只读校验放行             │  - 双重漏斗限流 (QPM 超限)            │
│  - 账号 ACTIVE (已激活)        │  - 连接池排队拥塞                     │
│  - 物理连接 COM_RESET 成功     │  - 账号 PENDING (待审批)              │
│  - 连通性测试通过              │  - 慢 SQL 告警 (>1000ms)              │
├────────────────────────────────┼───────────────────────────────────────┤
│  🔴 高危阻断 (Rose #EF4444)     │  🟣 凭据机密 (Violet #8B5CF6)         │
│  - AST 违规 (FOR UPDATE/SLEEP) │  - 256-bit PAT 访问令牌               │
│  - SSRF 防重绑定拦截           │  - AES-256-GCM 加密标识               │
│  - Agent 报错死循环熔断        │  - SSH 堡垒机证书与隧道               │
│  - 账号 DISABLED (冻结)        │  - 敏感字段掩码 (Dynamic Masking)     │
└────────────────────────────────┴───────────────────────────────────────┘
```

#### 语义色彩数值与透明度遮罩 (Alpha Channel Standard)
- **Safe (绿)**:
  - Text: `text-emerald-500` / `text-emerald-400`
  - Badge 描边底色: `border-emerald-500/20 bg-emerald-500/10`
- **Warning (橙/黄)**:
  - Text: `text-amber-500` / `text-amber-400`
  - Badge 描边底色: `border-amber-500/20 bg-amber-500/10`
- **Destructive (红)**:
  - Text: `text-rose-500` / `text-rose-400`
  - Badge 描边底色: `border-rose-500/20 bg-rose-500/10`
- **Credential / Tech (紫)**:
  - Text: `text-purple-500` / `text-purple-400`
  - Badge 描边底色: `border-purple-500/20 bg-purple-500/10`

---

## 三、排版与字体系统 (Typography System)

### 3.1 字体栈规范 (Font Stacks)
```css
/* UI 正文与控件字体 */
--font-sans: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;

/* 代码、SQL、哈希、IP、Schema 专用等宽字体 */
--font-mono: 'JetBrains Mono', 'Fira Code', ui-monospace, SFMono-Regular, monospace;
```

### 3.2 字阶与排版阶梯 (Type Scale)

| 级别 | 字号 (px/rem) | 行高 | 字重 (Weight) | 应用场景 |
| :--- | :--- | :--- | :--- | :--- |
| **Page Title** | 20px / 1.25rem | 28px | SemiBold (600) | 各一级模块大标题 (如“全链路 SQL 审计大盘”) |
| **Card / Dialog Title** | 15px / 0.9375rem | 22px | SemiBold (600) | 卡片标题、弹窗/抽屉主标题、分组名 |
| **Body / Primary** | 13px / 0.8125rem | 20px | Regular (400) | 表格正文、表单输入框文本、常规说明 |
| **Form Label / Table Head** | 12px / 0.75rem | 18px | Medium (500) | 表单 Label、数据表格表头（大写字母加微小字间距 `tracking-wider`） |
| **Compact / Helper** | 12px / 0.75rem | 16px | Regular (400) | 输入框下方校验提示 (Helper text)、次级描述 |
| **Code / Micro Tag** | 11px ~ 12px | 16px | Mono Regular (400) | PAT 摘要、SQL 片段、耗时 Badge、IP 地址、状态码 |

### 3.3 数值排版硬性约束 (Tabular Numbers)
所有展示数值、计数器、耗时毫秒数、QPM 指标的组件，必须强制声明：
```css
font-variant-numeric: tabular-nums; /* 或 Tailwind 类名: tabular-nums */
```
**原因**：避免实时 SSE 监控推送刷新时，因数字 "1" 和 "8" 宽度不同造成卡片与表格视觉跳动。

---

## 四、空间、栅格与深度规范 (Spatial, Grid & Elevation)

### 4.1 空间与间距步进 (8px Grid with 4px Sub-step)
严格执行 Density: 8/10 的紧凑要求：
- `gap-1` (4px)：图标与相邻文本间隙、状态圆点间距。
- `gap-2` (8px)：紧凑按钮组、Tab 选项卡内间距、Badge 内部。
- `gap-3` (12px)：表单内垂直字段间距、筛选栏各控件间距。
- `gap-4` (16px)：卡片之间的网格间距 (Grid Gap)、标准面板内边距 (`p-4`)。
- 页面主内容内边距：`p-5` (20px) ~ `p-6` (24px)，杜绝超过 32px 的无效大留白。

### 4.2 圆角规范 (Border Radius Hierarchy)
遵循克制精致的工业软件美学，采用小圆角基准：
- **`--radius: 0.375rem` (6px)**：输入框、下拉菜单、标准按钮、Toast 提示。
- **`4px` (rounded-sm)**：Badge 状态标签、Tag 胶囊、代码块角标。
- **`8px` (rounded-lg)**：Card 卡片、Dialog 对话框、Dropdown 浮层、Sheet 抽屉。
- **禁止**：全站严禁出现 > 12px 的大圆角或圆形胶囊大按钮（Avatar 除外）。

### 4.3 深度与描边 (Borders & Elevation)
- **1px 精准分割线**：所有卡片和面板统一使用 `1px solid var(--border)`，放弃大面积重阴影。
- **Elevation 层级**：
  - **Level 0 (Flat)**：底层主视口背景 (`bg-background`)。
  - **Level 1 (Card/Surface)**：内容卡片与表格表面 (`bg-card border border-border shadow-xs`)。
  - **Level 2 (Popovers/Dropdowns)**：下拉选框、上下文菜单 (`bg-popover border border-border shadow-md`)。
  - **Level 3 (Modal/Sheet)**：模态弹窗与审查抽屉 (`bg-card border border-border shadow-xl backdrop-blur-sm`)。

---

## 五、通用组件交互与视觉标准 (Component UI Specs)

基于 **shadcn/ui** 原则深度定制的组件视觉规范：

### 5.1 按钮系统 (Button)
- **尺寸基线**：统一采用 `size="sm"`（高度 `32px`，内边距 `px-3`）作为控制台默认尺寸；仅全局主 CTA（如“新建 Profile”）采用标准高 `36px`。
- **变体规则**：
  - `variant="default"`：天蓝主色背景 + 白字，用于页面单一核心提交。
  - `variant="secondary"`：中性灰色底，用于常规次级操作（如“测试连接”）。
  - `variant="outline"`：1px 细线边框 + 透明底，用于表格内行操作、次级筛选。
  - `variant="destructive"`：警示红底，专用于“注销 PAT”、“阻断 Session”、“冻结账号”。
  - `variant="ghost"`：纯图标按钮，用于复制、刷新、侧栏折叠。
- **加载状态规范**：严禁自行手写 Loading 样式，统一规范：`<Button disabled><Loader2 className="animate-spin" data-icon="inline-start" /> 执行中...</Button>`。

### 5.2 状态徽章 (Status Badge with Dot)
每个 Badge 必须携带实心状态圆点，提高色盲可访问性与辨识度：
```tsx
// 状态 Badge 结构规范
<Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400 font-mono text-[11px] gap-1.5 py-0.5">
  <span className="size-1.5 rounded-full bg-emerald-500" />
  ACTIVE
</Badge>
```
- **实时活跃态**：对当前保持 SSE 长连接的 McpSession，圆点追加 `animate-pulse`。

### 5.3 表单与输入控件 (Forms & Secret Inputs)
- **表单布局**：严格采用 `FieldGroup` + `Field` + `FieldLabel`，杜绝使用 `space-y-*` 裸排。
- **机密数据展示与录入（MySQL 密码、SSH 私钥）**：
  - 必须采用 `InputGroup` 封装，严禁前端回显明文（遵循 PRD 2.1 规范）。
  - 编辑时显示 `●●●●●●●● (已安全加密存储)` 占位符，右侧配备 `InputGroupAddon` 提供“重置重新录入”按钮。
- **校验状态**：通过 `Field[data-invalid]` 与 `Input[aria-invalid]` 驱动红色边框与错误说明淡入。

### 5.4 侧滑详情抽屉 (Inspection Sheet)
在审计、监控和规则排查中，**杜绝频繁跳出整页**：
- 采用从右侧滑出的 `Sheet`（推荐宽度 `540px` ~ `640px`）。
- 抽屉内置：
  1. **Header**：事件 ID、时间戳、状态 Badge、快速复制。
  2. **Content (分区块 Card)**：
     - **AST 语法解析树明细**：命中表列表（物理表穿透）、涉及函数、黑名单比对状态。
     - **原始 SQL vs 改写 SQL**：Monospace 格式化对比卡片，高亮被注入的 `LIMIT`。
     - **执行计划 (EXPLAIN) 瓶颈卡**：全表扫描 (`type: ALL`) 标红，索引未命中告警。
  3. **Footer**：导出当前记录、阻断关联 PAT、一键定位该 Session。

---

## 六、关键业务场景专属 UI 呈现规范 (Domain UX Specifications)

### 6.1 PAT 凭据中心与“单次展示”弹窗 (PAT Reveal Pattern)
- **流程规范**：
  1. 用户点击“新建 PAT”，输入用途名称与有效期（默认 30 天）。
  2. 生成成功后，进入**强交互保护模态窗 (`Dialog`)**：
     - 顶部挂载红色预警横幅：`<Alert variant="destructive">该令牌仅在本次创建时完整展示一次，系统底层采用 HMAC-SHA-256 不可逆存储，关闭后无法重新查看，请立即复制并妥善保管。</Alert>`。
     - 令牌展示框：等宽字体、全选保护、右侧附带一键复制大按钮。
     - **防手抖保护**：弹窗底部的关闭按钮初始为禁用或二次确认：“我已妥善备份此 Token” Checkbox 勾选后方可关闭弹窗。
  3. 客户端快速配置选项卡：弹窗下方提供 `Tabs`（Claude Desktop / Codex / 自建 Agent），展示一键复制的完整配置代码块：
     ```json
     {
       "mcpServers": {
         "mysql-gateway": {
           "url": "https://gateway.company.com/mcp",
           "headers": {
             "Authorization": "Bearer mcp_pat_xxxxxxxxxxxxxxxx"
           }
         }
       }
     }
     ```

### 6.2 双重漏斗限流与熔断监控器 (Dual-Bucket Rate Limiter Display)
在配置与监控界面，将抽象公式 `(user_qpm < limit) AND (profile_qpm < capacity)` 可视化：
- **双重进度漏斗条 (Dual Funnel Gauges)**：
  - **主体配额桶 (User Bucket)**：展示当前消耗 / 额度（若配置 `-1` 则显示特殊的紫色胶囊 `EXEMPT (无限制)`）。
  - **资源保护桶 (Profile Capacity Bucket)**：展示当前 Profile 聚合流量 / 承载上限（如 `182 / 300 QPM`）。
  - **安全红线视觉提示**：当用户配额为 `-1` 时，资源保护桶依然使用彩色进度条醒目标注：“-1 豁免不可穿透底层资源保护桶”。
- **死循环熔断器配置卡片 (Agent Loop Breaker)**：
  - 滑动窗口选择器 (`Slider` 10s ~ 120s)。
  - 连续相同报错阈值 (`Input` 2 ~ 10次)。
  - 触发熔断时的模拟拦截响应预览框（代码框展示标准 JSON-RPC 报错格式）。

### 6.3 表级 ACL 规则编辑器 (Table-Level ACL Matrix)
- **黑白名单层级区分**：
  - **黑名单区域置顶**：边框标红，规则卡片采用 `border-destructive/30 bg-destructive/5`，显著标注：“🚨 黑名单具有绝对最高优先级，命中即阻断”。
  - **通配符输入展示**：如输入 `salary_*`、`secret_db.*`，输入即刻格式化为等宽代码标签。
- **真实表穿透提示器 (AST Penetration)**：
  - 在规则说明旁配有交互式 Tooltip，图解说明：“支持 AST 递归穿透 CTE (`WITH`)、子查询、多表 JOIN 与别名，隐式引用黑名单表同样将被准确拦截”。

### 6.4 数据源 (Profile) 与 SSRF 防御盾 (SSRF Shielded Tester)
- **网络拓扑可视化卡片**：
  - 展示：`Web Console -> Gateway -> [SSH Bastion Tunnel (可选)] -> Target MySQL` 链条。
- **一键连通性测试 (Connectivity Test)**：
  - 点击按钮后进入加载态。
  - **SSRF 拦截结果呈现**：
    - 若配置内网非法 IP 或恶意 DNS 重绑定域名，测试结果直接弹出红色高危警报卡：
      `"SSRF Protection Alert: Target resolved to 127.0.0.1 (Loopback) or 169.254.169.254 (Cloud Metadata). Outbound connection forcibly terminated."`
    - 同时展示：`[查看强一致审计流水]` 快速跳转按钮。

### 6.5 超级管理员自锁硬防护交互 (Super-Admin Protection Safeguard)
- **前端防御性渲染**：
  - 用户管理列表在渲染时获取当前 `active_super_admin_count`。
  - 当登录用户为本人，或系统活跃超管数 `<= 1` 时：
    - 针对该账号的“禁用”、“降权”和“删除”按钮直接渲染为 `disabled`。
    - 鼠标悬停显示 `Tooltip`：“受系统安全底线硬保护：系统中必须保留至少 1 名 ACTIVE 状态的超级管理员，且管理员严禁自残自杀。”

---

## 七、响应式布局与视口断点规范 (Responsive Standards)

虽然该平台以专业运维桌面端为主，但仍需支持突发移动端审批与平板排查：

| 断点 | 宽度区间 | 布局策略 |
| :--- | :--- | :--- |
| **Desktop (标准宽屏)** | `>= 1440px` | 完整两栏布局：展开式侧边栏 (240px) + 双排/三排 Bento 仪表盘网格 + 审计多列并排展示。 |
| **Laptop (紧凑笔电)** | `1024px ~ 1439px` | 侧边栏支持手动折叠为图标模式 (64px)；表格启用横向平滑滚动；抽屉宽度固定为 540px。 |
| **Tablet (平板/小屏)** | `768px ~ 1023px` | 侧边栏自动收起至顶部汉堡菜单；审计大盘由表格降级为指标卡片流；抽屉覆盖 80% 屏幕宽度。 |
| **Mobile (手机端急诊)** | `< 768px` | 仅保留“待审批工单审核”、“急停熔断/Kill Session”、“查看高危拦截通知”等关键链路；抽屉转为底部拉起抽屉 (`Drawer`)。 |

---

## 八、无障碍与交互动效红线 (Accessibility & Anti-Patterns)

### 8.1 严守无障碍基线 (Accessibility Baseline)
- **对比度底线**：普通正文对比度必须 `>= 4.5:1`，大标题和关键状态标签对比度 `>= 7:1`。
- **键盘导航 (Focus Rings)**：任何按钮、输入框、Tab 触发项严禁粗暴去除 `outline: none`，必须保证键盘 Tab 聚焦时有清晰可见的 `--ring` 外发光。
- **语义化标签**：所有图表、指标、带状态的图标必须附带 `aria-label` 或屏幕阅读器专用的 `sr-only` 标题。

### 8.2 必须杜绝的反模式 (Anti-Patterns to Avoid)
1. ❌ **严禁使用 Emoji 代替系统图标**：禁止在界面中使用 `⚠️`, `❌`, `🔑` 等 Emoji，统一采用 `lucide-react` 矢量图标（如 `AlertTriangle`, `CircleX`, `KeyRound`）。
2. ❌ **严禁使用慢速或夸张的弹簧动效**：所有过渡时长严控在 `150ms ~ 200ms`（`ease-out`），不使用晃动激烈的弹性阻尼，尊重 `prefers-reduced-motion` 设置。
3. ❌ **严禁在数据监控图表中单靠颜色传达意义**：曲线和柱状图必须配合 Hover Tooltip、不同线型（虚线/实线）或数据点标记辅助色盲用户。
4. ❌ **严禁出现没有截断限制的长文本**：SQL 预览、错误回传必须设置 `truncate` 或固定高度带有滚动条的代码块，严禁撑破布局。