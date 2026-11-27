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
  3. **未勾选强制拦截提示（无额外操作按钮）**：在用户勾选确认前，底部完成按钮保持禁用，点击右上角关闭按钮、点击遮罩层或按下 `Esc` 键均**不得关闭弹窗**，仅在勾选框下方原地显示/高亮纯文字提示（不包含“放弃保存并关闭”或“继续保存”等二次操作按钮），提醒用户必须先复制并勾选确认后再关闭窗口；
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