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