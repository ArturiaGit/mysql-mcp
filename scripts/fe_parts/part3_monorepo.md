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