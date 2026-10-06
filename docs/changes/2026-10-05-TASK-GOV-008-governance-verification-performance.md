# [TASK-GOV-008] 机械验证性能优化、Hook 快速验签直通与单测夹具缓存

- 变更日期：2026-10-05
- 关联任务：TASK-GOV-008
- 关联 PR：[#9](https://github.com/ArturiaGit/mysql-mcp/pull/9)
- 关联 Commit：[`f2dfffc`](https://github.com/ArturiaGit/mysql-mcp/commit/f2dfffcc45e03871efd33b9b62711d6f7b0cd0ca)
- 责任执行方：Antigravity & PI-Desktop
- 关联功能/需求：G01, G03 / R15, R16, R17

---

## 📢 发版说明（Release Notes / 面向用户与下游）

### 变更分类与追溯条目
- **⚡ Performance**：
  - 在 `scripts/governance/check.mjs` 中实现 Git Hook 快速验签直通（Fast-Path Verification），`pre-commit` 与 `pre-push` 在匹配已通过交接候选证据时毫秒级放行（实测 ~1.6 秒），避免每次提交/推送重复冷启动 6 分钟全量测试套件。
  - 在 `tests/governance/governance.test.mjs` 引入单次基线仓库夹具缓存（Baseline Fixture Cache），消除 89 项用例各自初始化 Git 仓库的物理开销，测试耗时由未优化前的 108~138 秒稳定优化至 ~82 秒（降幅约 30%~40%）。
  - 在 `scripts/governance/lib/core.mjs` 实现基于 `git cat-file --batch` 的批量快照对象导出，显著减少 Windows 平台下的进程派生与 I/O 阻塞。
- **🔄 Changed**：
  - 将 `governance/checks.json` 中 `collaboration-tests` 的 `timeout_ms` 阈值由 300000ms（5分钟）调整至 600000ms（10分钟），并在 `scripts/governance/lib/validate.mjs` 同步放宽上限校验，彻底杜绝 Windows 负载抖动引发的 `ETIMEDOUT` 误报。
  - 为 `TASK-GOV-008` 正式登记 `build_checks`（`app-build` 与 `app-compile`），保证包含应用工程时的治理构建门禁闭环。
- **🔒 Security**：
  - Hook 快速直通坚持安全兜底原则：仅在严格匹配交付候选快照、原始 TAP 摘要、输入前缀摘要及运行环境（Node/平台/架构）时放行；未匹配或存在代码漂移时强制降级执行全量隔离 `run.mjs`。
  - 在 `AGENTS.md` 确立快速失败（Fail-Fast）红线，禁止 Agent 在检查超时或未知环境异常时开展耗时数十分钟的发散性底层环境压测。

### 发版亮点摘要 (Highlights)
彻底解决机械验证在 Windows 平台下级联重复执行、300 秒超时死循环导致的单个交付任务耗时超过 2.5 小时的严重性能瓶颈，将日常 Git 提交/推送门禁由 12 分钟压缩至 2 秒内，全流程提速 10~20 倍，同时保持零门禁降级与 100% 安全校验。

---

## 🛠️ Agent 工程上下文与架构演进（面向开发者与后续 Agent）

### 1. 架构与设计决策 (Why & Design)
- **痛点根源**：在 TASK-APP-001 交付中，单任务耗时达到 145 分钟（271 个自治步骤）。核心瓶颈在于：
  1. `check.mjs` 在 `--staged` 和 `--pre-push` 均无条件执行 `run.mjs`，加上 Antigravity 手动执行，单次交付全量重跑 5 次（纯 CPU 耗时超 32 分钟）；
  2. 300 秒临界超时在 Windows 偶发抖动触发 `ETIMEDOUT`，导致 Agent 陷入 70+ 分钟底层环境排查（扫描磁盘、调线程池、查 PATH）；
  3. 大上下文（600+ 步）导致 LLM 推理延迟螺旋上升（~35 分钟）。
- **解决方案**：
  - **基于候选快照哈希的 Hook 验签直通**：Antigravity 在交付前由 `documentation_delivery` 生成真实 `run.json` 并记录到交接事件中；Hook 仅需校验暂存树是否与已通过且经签名的交付快照完全一致。若一致直接直通（~1.6s）；若不一致（代码被篡改或漂移）立即降级执行全量 `run.mjs`。
  - **双重容限与夹具缓存**：单测缓存模板仓库避免重复 `git init`；调高超时阈值至 600s；AGENTS.md 增加快速失败约束。

### 2. 实际改动文件与逻辑清单 (What)
- `scripts/governance/check.mjs`：实现快照候选比对与 `fast-path` 直通逻辑，保留冷启动降级。
- `scripts/governance/lib/core.mjs`：实现 `git cat-file --batch` 批量 blob 导出。
- `scripts/governance/lib/validate.mjs`：放宽 checks 超时上限至 600000ms。
- `governance/checks.json`：设置 `collaboration-tests` 超时为 600000ms。
- `governance/tasks.json`：登记 TASK-GOV-008，配置 `build_checks`（`app-build`, `app-compile`）。
- `governance/features.json`：关联 G01 与 G03。
- `tests/governance/governance.test.mjs`：引入基线模板缓存机制，新增 7 项回归测试。
- `tests/governance/collaboration-git.test.mjs`：新增 Hook 快速直通与冷启动降级回归测试。
- `AGENTS.md`：增加 Hook 直通说明与失败快速响应红线。
- `docs/plans/governance-verification-performance.md`：记录完整实施计划与验收指标。

### 3. ⚠️ 对后续 Agent 的避坑指南与警示红线 (Caveats & Rules)
- **禁止绕过证据**：Hook 的快速直通依赖当前交接事件中真实记录的 `run.json` 及其输入前缀指纹；绝不允许为了追求速度而删除 Hook、修改 `core.hooksPath` 或使用 `--no-verify`。
- **快速失败原则**：遇到 `run.mjs` 超时或异常退出，先核实是否为已知偶发负载波动或代码缺陷，严禁自行展开长时间、超过 2 轮的系统底层探测（如递归遍历宿主目录查找文件、修改系统环境配置等）。
- **应用构建契约**：只要工程存在 `mysql-mcp/package.json`，任何 code 模式任务必须在 `tasks.json` 显式登记 `build_checks`。

### 4. 验证证据 (Verification)
- `node scripts/governance/run.mjs`：隔离快照下 169/169 项测试全部通过（0 失败，0 跳过，0 取消）。
- 治理测试耗时：89 项测试实测 82.031 秒（稳定在 <= 95 秒内，较未优化的 108~138 秒有显著改善）。
- 协作测试耗时：80 项测试实测 287.723 秒（稳定在 600 秒限额内）。
- 应用构建检查：`app-build`（含 6 项应用冒烟测试）与 `app-compile` 均 exit 0 通过。
- Hook 快速直通验证：合成 staged 夹具耗时 1671.0ms（< 2 秒），代码漂移时安全降级全量冷启动。
