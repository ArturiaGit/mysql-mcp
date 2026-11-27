# M6：MCP 数据面安全引擎核心与审计落盘

- **主进度索引**：[`../TODO.md`](../TODO.md)
- **状态**：`[ ] 未开始`
- **对应接口数**：0 项 REST（交付 MCP 11 项工具 + `/mcp` / `/sse` / `/metrics` + 单进程宿主）

---

## 1. 必读依据（轻量分片直读）

- **后端分片**：`scripts/be_parts/part6_data_plane_pipeline.md`、`scripts/be_parts/part7_ast_and_mcp_tools.md`、`scripts/be_parts/part8_core_engine_pool.md`、`scripts/be_parts/part9_security_ssrf_crypto.md`、`scripts/be_parts/part10_audit_and_stats.md`（§10.1）、`scripts/be_parts/part11_api_matrix_and_testing.md`（§11.4 `TC-BE-01~15`）
- **架构分片**：`scripts/arch_parts/part6_interfaces.md`（§6.1 11 项 MCP Tools 显式传参契约）
- **物理库基线**：`docs/sql/001_metadata_schema.sql`（`sys_audit_logs`、`sys_anonymous_security_logs`）
---

## 2. 后端与内核交付清单

- [ ] 落地 `packages/core-ast`（`node-sql-parser@5.4.0`）：
  - `scope-extractor.ts`（全属性树递归 + CTE 顺序可见作用域栈）
  - `ast-validator.ts`（只读白名单、系统库封堵、锁读与高危函数拦截）
  - `acl-evaluator.ts`（库/表 ACL Default Deny + 黑名单绝对优先）
  - `limit-rewriter.ts`（集合运算识别与 Fail-Closed 外层 LIMIT 改写）
- [ ] 落地 `packages/security/src/masker.ts`（SQL 文本脱敏与结果集敏感列掩码）
- [ ] 落地 `packages/core-engine` 运行期：
  - `registry-hub.ts`（内存权威快照、同步失效墓碑、`SnapshotBuilder` 低配额角色不放大）
  - `inflight-tracker.ts` + `dual-bucket-limiter.ts` + `AgentLoopBreaker`
  - `pool-manager.ts`（`mysql2@3.24.6` 自定义 `stream` 工厂 + IP Pinning + TLS `verifyIdentity` + 16MB 协议守卫）
  - `admin-channel.ts` + `query-lifecycle.ts`（租约锁、2000ms 双重 Deadline、`conn.destroy()`）
  - `streaming-executor.ts`（`rowsAsArray: true` + `fields`、UTF-8 64KB 裁剪、5MB/25MB 预算）+ `driver-reset.ts`（1500ms 超时销毁）
  - `audit-engine.ts`（高危强一致入库、10,000 槽位微批、`replayedIdSet` 应急重放与双败保留）
- [ ] 落地 `apps/gateway`：
  - `streamable-http.adapter.ts`（`POST /mcp` 精确断连检测）、`legacy-sse.adapter.ts`、`stdio.adapter.ts`
  - 10 步防御执行流水线与 11 项 MCP Tools
  - `/metrics` 与 `bootstrap-host.ts`（单进程双实例无死锁优雅停机）

---

## 3. 模块验收门禁（真实数据面联动）

- [ ] `TC-BE-01 ~ TC-BE-15` 自动化用例全部通过
- [ ] **真实端到端数据面测试**：使用 M2 签发的 PAT + M4 创建的真实目标库 Profile + M5 配置的 ACL/限流规则，发起真实 MCP 查询，验证：
  - 合法 `SELECT` 经过 LIMIT 注入后成功返回且无乱序覆盖；
  - `SELECT SLEEP(10)` / CTE 穿透黑名单表 / `information_schema` 刺探均被拦截并返回标准报错；
  - 取消/断连能触发 Admin 通道 KILL 与连接物理销毁；
  - 放行与拦截记录均真实写入 `sys_audit_logs`
- [ ] **M2 → M6 PAT 吊销真实断流接线验收（方案 1A 挂账收口）**：将 `apps/admin-api` 的 `PatService` 接入真实 `RegistryHub.markPatRevokedSync` 与 `QueryLifecycleCoordinator.cancelQueriesByPat`，实测调用 `POST /api/v1/pats/:id/revoke` 后，数据面立即拒绝该 PAT 的后续请求并同步 `KILL` 物理打断该 PAT 关联的在途 SQL
