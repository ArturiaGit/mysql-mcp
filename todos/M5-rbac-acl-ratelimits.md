# M5：角色 / 库表 ACL 策略矩阵与双重漏斗限流

> **前置确认 gate**：进入本模块前，请确认 `RD-08` 中关于“新库全局 `burstCapacity` 默认值（10 vs 15）、库级 ACL 精确名/通配边界、USER/ROLE/GLOBAL 限流外部行为冻结签署”是否拍板。

- **主进度索引**：[`../TODO.md`](../TODO.md)
- **状态**：`[ ] 未开始`
- **对应接口数**：13 项 | **对应前端视图**：2 个

---

## 1. 必读依据（轻量分片直读）

- **后端分片**：`scripts/be_parts/part4_database_and_dal.md`（§4.4.3）、`scripts/be_parts/part5_control_plane_security.md`、`scripts/be_parts/part6_data_plane_pipeline.md`（限流与 RegistryHub 失效）；另参考 `docs/DATABASE_DESIGN_SPEC.md` §15.1（`RD-08`）
- **接口契约分片**：`scripts/contract_parts/part5_concurrency_and_security.md`、`scripts/contract_parts/part8_apis_profiles_and_roles_acls.md`（§6.6）、`scripts/contract_parts/part9_apis_rate_limits_and_audits.md`（§6.7）；形状类型：`docs/contracts/readiness.types.ts`
- **前端分片**：`scripts/fe_parts/part5_layout_paradigms.md`（§5.4）、`scripts/fe_parts/part8_api_dto_mapping.md`
- **原型局部参考**：`ui-showcase.html`（仅 `#data` 双重漏斗、`#security` 规则卡）；`admin-console-demo.html`（仅 `rbac`、`limits` 页模板）
---

## 2. 后端交付清单（13 项接口）

- [ ] 角色模板 CRUD（4 项）：
  - [ ] `GET /api/v1/roles`
  - [ ] `POST /api/v1/roles`
  - [ ] `PUT /api/v1/roles/:id`（含 `default_limit`、`max_limit`、`max_timeout_ms`、`user_qpm_limit`、`profileIds`、`version`）
  - [ ] `DELETE /api/v1/roles/:id`
- [ ] 库级与表级 ACL（4 项，支持 `profile_id = "0"` 全局规则、同事务审计与乐观锁）：
  - [ ] `GET /api/v1/roles/:id/table-acls`
  - [ ] `PUT /api/v1/roles/:id/table-acls`
  - [ ] `GET /api/v1/roles/:id/db-acls`
  - [ ] `PUT /api/v1/roles/:id/db-acls`
- [ ] 全局限流与用户覆盖（5 项，严格 `sys_rate_limit_revisions` counter 防 ABA、`isCustom` 区分、与 `RegistryHub` 失效联动）：
  - [ ] `GET /api/v1/rate-limits/global`
  - [ ] `PUT /api/v1/rate-limits/global`
  - [ ] `GET /api/v1/rate-limits/users/:id`
  - [ ] `PUT /api/v1/rate-limits/users/:id`
  - [ ] `DELETE /api/v1/rate-limits/users/:id`（校验 `?revision=N`，兼容 `version`）

---

## 3. 前端交付清单（2 个视图 + 领域组件）

- [ ] 实现 `src/api/schemas/policy.schema.ts` 与 `limits` 校验模式（对齐 `GlobalRateLimitPayload` / `UserRateLimitPayload` / `DeleteUserRateLimitQuery`）
- [ ] 实现 `/policies`（`PoliciesView.tsx`：红色黑名单卡片绝对置顶 + 蓝色白名单 + `profile_id="0"` 全局作用域 + 多角色合并决策结论 `Default Deny -> Union Allow -> Strict Deny`）
- [ ] 实现 `src/components/domain/dual-bucket/` 与 `/limits`（`LimitsView.tsx`：User Bucket + `[ ∧ AND ]` + Profile Capacity Bucket + `-1 EXEMPT` 安全红线提示 + `DB-R1-02` 已保存覆盖与有效配额分离）

---

## 4. 模块联调验收剧本

- [ ] 为同一用户绑定两个角色（一角色 `ALLOW` 某库/表、另一角色 `DENY`），验证 `/policies` 合并展示判定为 `DENY`
- [ ] 对未设置个人限流的用户调用 `GET /api/v1/rate-limits/users/:id` 返回 `isCustom=false` 时，验证前端表单保持空值与 `revision=0`（绝不填入 `GLOBAL` 默认值伪装覆盖）
- [ ] 新增、修改并执行“移除用户覆盖”全流程，验证 `revision` 递增防 ABA、409 冲突刷新及同事务审计落库
