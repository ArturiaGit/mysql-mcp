# TODO.md — 双端垂直切片总索引

> **AI 路由指令**：每次开启模块开发前，**只读本索引定位当前目标模块，然后只读取对应的 `todos/M*.md` 及其列出的设计章节**，不要一次性通读整个 `docs/` 目录。
> **过关铁律**：`todos/M*.md` 内部交付子清单按 Step 分段勾选（后端真实 MySQL 验收通过后勾后端子清单、前端直连真实后端验收通过后勾前端子清单、QA 独立验收 `PASS` 后勾模块验收门禁）；根目录 `TODO.md` 下方模块总表保持 `[ ]`，仅在该模块 **后端真实 MySQL 验收 + 前端高保真实现 + 双端真实联调与 QA `PASS`** 全部通过后，方可勾选总表 `[x]` 收口。

---

## 模块总览与文件路由表

| 模块 | 目标摘要 | 模块 TODO 文件（唯一细节入口） | 后端 REST 接口数 | 前端视图数 | 状态 |
| :--- | :--- | :--- | :---: | :---: | :---: |
| **M0** | 双端工程底座、Git/CI安全护栏、Docker 14 表与 `/_lab` 组件实验室 | [`todos/M0-foundation-lab.md`](todos/M0-foundation-lab.md) | 0（健康探针） | `/_lab` + 骨架 | `[ ]` |
| **M1** | 系统自举、认证会话、Cookie/CSRF 与四级路由守卫闭环 | [`todos/M1-auth-guards.md`](todos/M1-auth-guards.md) | 9 | 6（Auth/状态） | `[ ]` |
| **M2** | 开发者个人中心、PAT 单次展示三态弹窗与客户端配置生成 | [`todos/M2-developer-pat.md`](todos/M2-developer-pat.md) | 4 | 2（PAT/配置） | `[ ]` |
| **M3** | 审批工单中心与用户全生命周期（超管防自残与并发锁序） | [`todos/M3-approvals-users.md`](todos/M3-approvals-users.md) | 8 | 2（审批/用户） | `[ ]` |
| **M4** | 数据源 Profile CRUD、密钥环加密与 SSRF/SSH 三模式连通性测试 | [`todos/M4-profiles-ssrf-ssh.md`](todos/M4-profiles-ssrf-ssh.md) | 6 | 1（Profiles） | `[ ]` |
| **M5** | 角色/库表 ACL 策略矩阵与双重漏斗限流（⚠️ 需先确认 `RD-08`） | [`todos/M5-rbac-acl-ratelimits.md`](todos/M5-rbac-acl-ratelimits.md) | 13 | 2（策略/限流） | `[ ]` |
| **M6** | MCP 数据面核心引擎（AST 防火墙、连接池、11 工具、审计微批） | [`todos/M6-mcp-data-plane.md`](todos/M6-mcp-data-plane.md) | 0（11 MCP 工具） | — | `[ ]` |
| **M7** | 全链路审计排查抽屉、CSV 导出、通知与 Bento 大盘收口（⚠️ 需确认 `RD-08`） | [`todos/M7-audit-notify-dashboard.md`](todos/M7-audit-notify-dashboard.md) | 7 | 3（审计/通知/大盘） | `[ ]` |

**总覆盖统计**：`47 / 47` 项管控面接口（`docs/contracts/endpoint-trace.json`）· `14 / 14` 张物理表（`docs/sql/001_metadata_schema.sql`）· `16` 个正式前端路由（`docs/FRONTEND_ARCHITECTURE_SPEC.md` §7）+ 开发态 `/_lab`。

---

## 派单指令示例（每次只推 1 个模块）

```text
请先阅读 AGENTS.md 和 TODO.md，定位 M1 并读取 todos/M1-auth-guards.md：
1. 先按该文件完成后端实现与真实 MySQL 验收；
2. 再完成前端页面并直连真实后端；
3. 跑通 M1 联调验收剧本，汇报实测结果并更新 TODO 状态。
```
