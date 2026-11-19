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