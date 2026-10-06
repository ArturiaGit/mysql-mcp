# 部署与运维指南

> 状态：Phase 1 应用工程脚手架与依赖安装契约已建立（F28），可执行离线依赖准备与冒烟构建；管理服务与业务运行时仍处于规划中，本文不能作为完整的应用启动与运维教程。

## 1. 环境与前提

首期面向当前 Windows 用户环境。运行时声明为 Node.js `>=22`，本机实测验证环境为 Node.js v24.16.0 与 npm 11.13.0（lockfile v3，153 个包，0 漏洞）。驱动拟用原生 MySQL 协议，不要求安装 mysql 命令行，也不读取 DataGrip 密码。

### 依赖准备契约与命令
1. **治理快照与 CI 标准依赖入口**：
   - 根目录执行：`node scripts/governance/prepare.mjs`
   - 契约细节：调用 `scripts/governance/lib/dependencies.mjs`，通过原生 Node.js 直接定位 `npm-cli.js`（`shell: false`，杜绝 Shell 注入），在隔离环境中以 `--ignore-scripts --include=dev --no-audit --no-fund --prefer-offline` 执行 `npm ci`。
   - 安全防线：全过程超时限制 180s，清理敏感环境变量，执行前后严格校验 `package.json` 与 `package-lock.json` 的 SHA256 哈希一致性，杜绝工作区直接复制 `node_modules` 带来的污染。
2. **应用开发工作区命令**（在 `mysql-mcp/` 目录下）：
   - 安装依赖：`npm ci --ignore-scripts`
   - 类型检查：`npm run compile` 或 `npm run typecheck`（执行 `node scripts/compile.mjs`，`tsc --noEmit`，不落盘）
   - 生产构建与全量测试：`npm run build` 或 `npm test`（执行 `node scripts/build.mjs`，清理 `dist/`，编译产物并运行全部 5 个套件共 190 项应用测试，含 63 项 Fastify 服务端测试）
   - MCP Stdio 原型启动：`node dist/mcp/server.js`（直接作为独立子进程启动，监听 stdin/stdout）

运行身份为有权限使用其系统凭据存储的本机用户，不默认管理员权限，不自动注册 Windows 服务或开放防火墙。

### 存储路径与锁机制（Phase 2-A 落地）
- **连接数据路径**：
  - Windows 环境：默认使用 `%LOCALAPPDATA%/mysql-mcp/connections.json`；
  - 非 Windows 环境：默认使用 `$HOME/mysql-mcp/connections.json`；
  - 原生凭据存储依赖 Windows Keyring，若系统底层凭据存储不可用则 fail-closed 直接拒绝启动或操作；
- **单写者锁管理 (`connections.json.lock`)**：
  - 采用独占式排他打开标志（`wx`）创建 `.lock` 租约文件，防止双进程并发写入；
  - 正常停止服务（`await server.close()`）时自动安全删除 `.lock` 文件；
  - 崩溃或异常断电遗留锁：服务端坚决**不自动猜测进程存活或强制抢锁**（fail-closed）；用户需在人工确认无其他 `mysql-mcp` 运行进程后手动删除 `.lock` 文件；
- **目录权限与原子写入**：
  - 目录创建模式 `0700`，文件创建模式 `0600`（Windows 环境继承用户目录 ACL，未做独立 Windows ACL 强化验收）；
  - 数据写入经过临时文件与 `file.sync()`，通过原子 `rename` 覆盖，断电或崩溃不损坏原文件。

## 2. Fastify 本地回环管理服务（Phase 2-A 落地）

### 2.1 工厂 API 与生命周期
```typescript
import { createLocalServer } from './server/app.js';

// 1. 创建服务实例（惰性工厂，导入与实例化时不产生网络监听或副作用）
const server = await createLocalServer({
  port: 3210, // 默认回环端口为 3210；测试或端口占用时可设为 0 由 OS 分配
  storageFile: 'path/to/connections.json', // 可选自定义文件路径
});

// 2. 生成单次高熵登录码 (32 字节 HEX)
const code = server.issueLocalCode();
console.log(`本地登录代码: ${code}`);

// 3. 启动监听（严格且仅绑定 127.0.0.1）
await server.start();
console.log(`管理服务运行于: http://127.0.0.1:${server.port}`);

// 4. 优雅关闭（释放单写者锁与底层资源）
await server.close();
```

### 2.2 生产与安全运维说明
- **日志与安全脱敏**：Fastify 内部请求日志已显式禁用（`logger: false`），杜绝请求头或密码落入本地文件；所有未知异常仅返回固定安全提示（`INTERNAL_ERROR`），严禁泄漏任何原生错误堆栈；
- **零外部中间件**：服务基于 Fastify 5.x 核心纯内建实现会话、Cookie 解析与 CSRF 拦截，零新增第三方脆弱依赖。

## 3. 客户端兼容矩阵

| 客户端 | 本机版本 | 文献依据 | stdio 实测 | 原生逐次确认 | 网页后备 |
|---|---|---|---|---|---|
| PI-Desktop | 未验证 | 本轮未核实接入配置 | 未验证 | 未验证 | 计划支持，未验证 |
| Codex 桌面应用 | 未验证 | 官方源码有 elicitation，见需求基线 | 未验证 | 未验证 | 计划支持，未验证 |
| 腾讯 WorkBuddy 桌面应用 | 未验证 | 官方说明 command/args 本地进程接入 | 未验证 | 未验证 | 计划支持，未验证 |

“应该都是最新版”保留为用户判断，不能填入版本列作为证据。配置路径、格式、重载方法应依据实际版本核实；不将 CLI 文档当桌面专属文档。

配置内容只允许：绝对 Node 可执行路径、绝对 MCP 构建入口路径、非敏感参数。处理 Windows 空格路径和 JSON 转义；不要把 MySQL 密码、内部令牌放入 env、args 或 URL。当前不提供猜测性的 PI-Desktop 或 Codex 配置文件。

### 确认验收步骤

- 记录系统、客户端完整版本、权限模式、MCP 协商能力及日期。
- 无副作用探针展示两条不同请求，确认每次都弹出准确内容。
- 分别测试接受、拒绝、取消、过期、断线以及重复响应。
- 检查“完全访问”“始终允许”等设置是否跳过人工确认；若不能保证，关闭原生路径并使用网页。
- 原生拒绝不得自动转网页；所有未确认探针均无执行记录。
- 客户端更新或权限模式变化后重新验证，不能永久沿用通过标签。

## 4. 数据库与网络边界

本地页面回环监听不等于 MySQL 只能位于本机；多个服务器连接受 DBA 授权与网络策略约束。远程连接 TLS/证书需求待确认，不静默跳过证书验证。

查询结果会进入客户端/模型上下文，需核实所用模型的数据处理政策；不要把凭据未出本机描述成全部数据仅本地处理。审批必须显示目标，生产连接应有显著名称标识，但不虚构已存在的环境标签功能。

## 5. 运维与排错

| 现象 | 检查顺序 | 禁止做法 |
|---|---|---|
| 管理页面不可达 | 进程状态、实际端口、回环绑定 | 直接改为 0.0.0.0 |
| MCP 无工具 | 客户端版本、Node/入口绝对路径、stderr | 向 stdout 打调试日志 |
| 凭据存储失败 | 运行身份、原生模块、系统存储可用性 | 保存明文后继续 |
| 数据库连接失败 | 用户核对地址/端口、网络、TLS、DBA 授权 | 猜密码、自动改 root 权限 |
| SQL 被拒绝 | 策略范围与明确错误码 | 删除校验、混用多语句 |
| 写入结果未知 | 原 request_id、DBA 核对实际状态 | 自动重试同一 SQL |
| 审批不弹窗 | 实际模式及版本；网页后备 | 用模型 confirmed=true 绕过 |

日志只用脱敏摘要，提交故障材料前检查目标名称与业务元数据。不给用户索要密码截图。

## 6. 升级、备份与停止

普通配置备份不含 Windows 凭据，不能宣称复制配置就能跨机器恢复密码。跨账户迁移应重新在页面输入凭据。升级需停止新写请求、等待已执行请求稳定、保存配置和最小状态日志；中断执行保留 UNKNOWN。

重启不恢复待审批 SQL；旧审批失效，执行意图不重放。卸载或清理运行资料属于独立授权操作，不能为清理测试目录删除真实连接或数据库。真实写入验收只在 DBA 指定隔离库且逐次确认后进行。
