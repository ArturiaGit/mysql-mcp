# Phase 2-A 回环服务与连接管理后端实现计划

> 状态：in_progress  
> 任务编号：TASK-APP-003  
> 关联功能：F25 (回环认证/CSRF), F01 (新增连接), F02 (编辑连接), F03 (删除连接), F04 (多连接列表), F05 (测试连接)  
> 需求来源：R01, R02, R03, R14, R15, R16, R17  
> 任务分支：feat/server-connection-and-auth  
> main 基线：`bdbef3f6247e581eb793270c3768c530cf7728b6`  
> 执行模式：`mode: "code"`（后端核心任务，Antigravity 规划/交付 × PI-Desktop 实施代码与测试）  

---

## 1. 目标与背景

根据 [阶段实施路线图](../ROADMAP.md) 与 [全栈分工与前后端物理隔离协作规范](../FULLSTACK_DIVISION_SPECIFICATION.md)，Phase 1 基础依赖与安全原型已全部就绪。项目现正式推进至 **Phase 2（连接管理及认证）**。

依照大型特性“两阶段递进拆分”策略，本任务为 **Phase 2-A（后端基础与接口就绪，Backend-First）**，专职由 **PI-Desktop** 在 `mysql-mcp/src/server/` 与 `mysql-mcp/tests/` 中落地回环 Fastify HTTP 服务端、本地会话与 CSRF 安全防护、连接元数据持久化及联动 Windows Keyring 凭据管理、连接测试模拟及自动化接口测试套件。前端界面（`mysql-mcp/web/`）留待后续 Phase 2-B（TASK-APP-004）由 Antigravity 专职开发。

---

## 2. 授权范围与绝对禁止事项

### 2.1 授权范围
- 任务允许路径：`mysql-mcp/`、`docs/`、`governance/`；
- 实施代码路径（PI-Desktop 专职）：
  - `mysql-mcp/src/server/`：Fastify 实例工厂、会话/CSRF 中间件、连接管理服务、路由注册；
  - `mysql-mcp/src/index.ts`：更新顶层导出；
  - `mysql-mcp/tests/server.test.mjs`：编写全量服务端路由与安全单测；
  - `mysql-mcp/scripts/build.mjs`：联动运行服务端测试套件；
  - `mysql-mcp/package.json`：仅限引入必需的轻量运行时依赖（如 `@fastify/cookie`, `@fastify/cors` 或确定性纯 Node 依赖）。

### 2.2 绝对禁止事项（双向红线）
1. **PI-Desktop 严禁侵入前端资产**：严禁创建或修改 `mysql-mcp/web/` 下任何文件，严禁编写前端 HTML/CSS/客户端脚本；
2. **PI-Desktop 严禁执行 Git 交付**：严禁运行 `git commit`、`git push` 或操作 PR，所有产物以 handoff details 交付 Antigravity；
3. **安全凭据绝不泄露**：
   - 接口返回的连接详情中，密码字段必须坚决剔除；
   - 错误响应必须经由 `sanitizeError` 脱敏，严禁在响应中暴露操作系统路径或系统用户；
   - 生产环境密码必须存储至 `WindowsKeyringProvider`，绝不允许明文后备；
4. **禁止连接外部未授权生产数据库**：本阶段连接测试以网络探测/模拟握手为主，不连接外部生产数据库，不执行提权。

---

## 3. 技术契约与接口规格

依据 [`docs/API_AND_PROTOCOLS.md`](../API_AND_PROTOCOLS.md) 锁定的通用契约：

### 3.1 监听与安全头
- **网络绑定**：严格且仅监听 `127.0.0.1` 本地回环地址，禁止监听 `0.0.0.0`；
- **Host/Origin 强校验**：请求头 `Host` 必须匹配 `127.0.0.1:<port>` 或 `localhost:<port>`；若携带 `Origin`，必须与当前服务端回环地址严格一致，任何外域请求直接阻断（返回 HTTP 403 Forbidden）；
- **响应格式**：成功 `{ "ok": true, "data": ... }`，失败 `{ "ok": false, "error": { "code": "...", "message": "脱敏说明" } }`。

### 3.2 身份会话与 CSRF（F25）
- **POST /api/v1/session**：
  - 输入：`{ "local_code": string }`（服务端启动时在控制台生成的单次随机高熵校验码）；
  - 响应：设置 HttpOnly、SameSite=Strict 会话 Cookie，响应返回 `{ "ok": true, "data": { "csrf_token": string } }`；
- **DELETE /api/v1/session**：
  - 注销并清理当前会话与 CSRF Token；
- **CSRF 校验**：除 `/api/v1/session` 建立会话外，所有状态变更请求（POST/PATCH/DELETE）必须在 `x-csrf-token` 请求头携带与当前会话一致的有效 CSRF Token，缺失或不匹配返回 403 Forbidden。

### 3.3 连接管理 REST 路由（F01~F04）
- **GET /api/v1/connections**：
  - 响应：`{ "ok": true, "data": { "items": [ { "id": "uuid", "name": "...", "host": "...", "port": 3306, "username": "...", "default_database": "...", "version": 1 } ], "next_cursor": null } }`；
  - **绝不包含 password 或 credential_ref 字段**；
- **POST /api/v1/connections**：
  - 输入：`{ name, host, port, username, default_database, password }`；
  - 行为：校验输入有效性；密码写入 `WindowsKeyringProvider`（服务名为 `mysql-mcp:<id>`）；连接元数据（含 `credential_ref: id`, `version: 1`）持久化至本地安全 JSON 存储；
  - 响应：HTTP 201 Created，返回脱敏后的连接元数据；
- **PATCH /api/v1/connections/:connection_id**：
  - 输入：`{ expected_version, name?, host?, port?, username?, default_database?, password? }`；
  - 行为：校验 `expected_version` 是否与存储中的 `version` 一致（不一致返回 409 Conflict，错误码 `STATE_CONFLICT`）；若提供 `password` 则更新 Windows Keyring，若省略/留空则保持原密码；`version` 递增；
  - 响应：HTTP 200 OK，返回更新后的脱敏连接元数据；
- **DELETE /api/v1/connections/:connection_id**：
  - 输入：`{ expected_version }`；
  - 行为：校验版本；删除本地连接元数据；同步清理 Windows Keyring 中对应的凭据；
  - 响应：HTTP 200 OK。

### 3.4 连接测试（F05）
- **POST /api/v1/connections/test**（测试未保存草稿）：
  - 输入：草稿字段及 `password`；
  - 行为：模拟连通性探测或端口握手，草稿数据不保存至磁盘与 Keyring；返回测试耗时与连通状态；
- **POST /api/v1/connections/:connection_id/test**（测试已保存连接）：
  - 输入：`{ expected_version }`；
  - 行为：从本地读取连接配置并从 Windows Keyring 读取密码进行连通性测试；不向客户端返回密码。

---

## 4. 实施步骤（PI-Desktop 任务路线）

1. **服务与安全中间件**：
   - 在 `mysql-mcp/src/server/auth.ts` 实现本地随机代码生成器、内存会话存储与 CSRF Token 管理；
   - 在 `mysql-mcp/src/server/app.ts` 构建 Fastify 应用实例工厂，配置 `127.0.0.1` 监听限制与 Host/Origin 校验过滤器；
2. **连接存储与凭据联动**：
   - 在 `mysql-mcp/src/server/connections.ts` 实现连接配置存储库（支持原子读写本地 JSON、UUID 分配、乐观锁版本号自增与回滚补偿），安全调用 `WindowsKeyringProvider`；
3. **路由分发与错误脱敏**：
   - 在 `mysql-mcp/src/server/routes.ts` 注册所有 `/api/v1/*` 路由，接入统一错误脱敏处理器；
4. **自动化测试套件**：
   - 在 `mysql-mcp/tests/server.test.mjs` 编写全套自动化测试，覆盖会话换取、非法 Origin 拦截、CSRF 防御、连接增删改查、乐观锁冲突、编辑留空保持密码、草稿测试不入库等全场景；
   - 更新 `mysql-mcp/scripts/build.mjs`，联动运行 `server.test.mjs`。

---

## 5. 验收标准与门禁核验

1. **自动化测试指标**：
   - `npm test --prefix mysql-mcp` 联动执行冒烟测试、凭据测试、SQL 策略测试、MCP 协议测试以及新增的 Fastify 服务端测试，全部 pass，0 失败，0 跳过；
   - `node mysql-mcp/scripts/compile.mjs` 纯类型编译以 exit 0 通过；
2. **安全与隔离指标**：
   - 跨站请求（非 127.0.0.1 Origin）被 100% 阻断为 403 Forbidden；
   - 任何接口响应中 100% 无明文密码与内部 `credential_ref` 暴露；
   - 连接更新中乐观锁版本不一致时确定性返回 409 Conflict。
