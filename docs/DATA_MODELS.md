# 数据模型

> 状态：逻辑模型草案，未创建任何数据文件或数据库表。字段为拟定契约，安全约束见[项目约束](./PROJECT_CONSTRAINTS.md)。

## 1. 数据边界与命名

传输字段统一 snake_case；时间为 UTC ISO 8601；ID 为服务端生成的不可预测字符串，名称不是主键。引用 ID 不构成授权，必须检查所属会话。MySQL 业务库结构完全未知，不在本规范中虚构员工或库存表。

| 存储 | 内容 | 不允许保存 |
|---|---|---|
| 普通配置文件（拟定） | schema_version、连接资料及凭据引用 | 明文密码、内部令牌 |
| Windows 系统凭据 | 数据库密码、内部认证秘密 | 无关 DataGrip 凭据 |
| 服务内存 | 浏览器/MCP 会话、准确 SQL、审批挑战、短期结果 | 无上限长期缓存 |
| 最小状态日志与审计（拟定） | 请求绑定摘要、状态、时间、脱敏结果摘要 | 原始 SQL、参数、查询数据、密码 |

文件拟位于用户本地数据目录，由单实例服务写入并限制访问。保留周期与容量须在实现时明确；未指定不等于永久保留。

## 2. 连接模型

```typescript
interface ConnectionRecord {
  connection_id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  default_database: string | null;
  credential_ref: string;
  connection_version: number;
  created_at: string;
  updated_at: string;
}
```

| 字段/规则 | 约束 |
|---|---|
| name | 必填、可编辑；名称歧义以 ID 区分 |
| host / port | 不接受包含密码的连接 URL；端口整数 1–65535 |
| username | 必填，不默认 root |
| default_database | null 表示未设置；不免除工具显式 database 参数 |
| credential_ref | 仅服务端存储可见，不返回 MCP 或普通页面 |
| connection_version | 执行相关配置或密码变化递增，待审批请求失效 |
| 删除 | 执行中拒绝；否则失效相关等待请求并补偿清理凭据 |

TLS 资料结构待 Q08 关闭后补充；不能隐含允许关闭证书校验。连接修改和凭据替换须采用补偿流程，不把密码放普通文件以求原子性。

## 3. 会话与请求

```typescript
type ChangeState =
  | 'PENDING' | 'APPROVED' | 'EXECUTING'
  | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN'
  | 'REJECTED' | 'CANCELLED' | 'EXPIRED' | 'INVALIDATED';

type ConfirmationChannel = 'native' | 'web';

interface ChangeRequest {
  request_id: string;
  session_id: string;
  connection_id: string;
  connection_version: number;
  database: string;
  sql: string; // 只在有界内存中保留
  sql_fingerprint: string;
  reason: string; // 内存；不能作为批准证据
  operation: string;
  risk_codes: string[];
  confirmation_channel: ConfirmationChannel;
  state: ChangeState;
  created_at: string;
  expires_at: string;
  updated_at: string;
}
```

- session_id 由内部认证建立，不接受模型指定所属会话；浏览器会话与 MCP 会话类型分开。
- 客户端名称、版本、声明能力用于兼容诊断，不单独作为可信身份。
- sql_fingerprint 基于准确 SQL 字节形成；持久审计建议使用带本地秘密的 HMAC，避免简单字典猜测业务内容。算法和版本实施时固定。
- 审批绑定除指纹外还包含目标、连接版本、会话和有效期；不能以 SQL 指纹代替授权。
- 原生 challenge_id 仅内部桥接可见；浏览器 approval_nonce 仅认证页面可见；两者均单次消费且不进入模型。
- ApprovalDecision 记录 request_id、channel、decision（approve/reject/cancel）、decided_at、绑定摘要。来自模型的 reason 或 confirmed 不属于 Decision。

## 4. 状态机

| 当前 | 事件 | 下一状态 | 是否派发 SQL |
|---|---|---|---|
| PENDING | 有效人工批准 | APPROVED | 否 |
| PENDING | 人工拒绝 | REJECTED | 否 |
| PENDING | 人工取消/会话断开 | CANCELLED | 否 |
| PENDING / APPROVED | 到期 | EXPIRED | 否 |
| PENDING / APPROVED | 连接变化/删除、服务重启 | INVALIDATED | 否 |
| APPROVED | 执行前复核通过、记录派发意图 | EXECUTING | 取得一次派发权 |
| APPROVED | 会话断开或主动取消 | CANCELLED | 否 |
| APPROVED | 可确定的执行前错误 | FAILED | 否 |
| EXECUTING | 获得成功完成回执 | SUCCEEDED | 不再派发 |
| EXECUTING | 确定的错误回执 | FAILED | 不重试 |
| EXECUTING | 超时/断连/进程崩溃且提交结果不能确定 | UNKNOWN | 不重试 |

终态不可重新批准或返回 PENDING。FAILED 不承诺数据库没有部分效果，尤其是非事务表；需返回安全的效果说明。EXECUTING 后取消不直接改成 CANCELLED，应根据实际结果记 SUCCEEDED/FAILED/UNKNOWN。

审批记录持久化不保存可重放的 SQL。重启对旧执行意图保守标 UNKNOWN；旧待审批请求失效。重连会话不能通过猜 ID 获取别人的结果；旧请求摘要可由认证管理页面查看，MCP 跨会话恢复机制不在首期承诺内。

## 5. 结果与审计

```typescript
interface QueryResult {
  columns: { name: string; mysql_type: string; encoding: string }[];
  rows: unknown[][];
  returned_rows: number;
  truncated: boolean;
  truncation_reason: 'row_limit' | 'byte_limit' | null;
  duration_ms: number;
}

interface ChangeResult {
  request_id: string;
  state: ChangeState;
  affected_rows?: string;
  insert_id?: string;
  error_code?: string;
  effect_note?: string;
}
```

rows 用数组保留同名列；BIGINT/DECIMAL 用字符串避免精度损失，二进制使用显式编码标识，日期不擅自做时区转换。具体类型映射须按驱动测试后锁定。truncated 为 true 不意味着数据库总行数已知；不能将 returned_rows 当总记录数。

审计最小字段：event_id、request_id、session_id 的非秘密标识、connection_id、database、operation、sql_fingerprint、channel、state、时间、error_code 和必要执行摘要。目标库名同样是敏感元数据，应限制访问。日志不要保存原始 SQL 或业务结果；错误消息先脱敏。

## 6. 演进规则

schema_version 与应用版本独立。读到未知新版本拒绝写回，不能用默认值覆盖数据。迁移前明确备份边界；普通配置备份不包含系统凭据。具体文件格式、恢复流程及保留期在实现前完善，见[版本规范](./VERSIONING.md)。

---

## 7. 凭据提供者接口与异常脱敏规范

### 7.1 跨平台凭据抽象接口 (`ICredentialProvider`)

为消除对特定操作系统底层凭据服务（如 Windows Credential Manager）的强耦合，确保代码在 GitHub Actions（Ubuntu 容器且无 D-Bus/Secret Service 环境）中测试可复现且不崩溃，凭据层必须面向接口编程：

```typescript
export interface ICredentialProvider {
  getCredential(ref: string): Promise<string | null>;
  setCredential(ref: string, secret: string): Promise<void>;
  deleteCredential(ref: string): Promise<void>;
}
```

- **生产环境 (`WindowsKeyringProvider`)**：调用 `@napi-rs/keyring` 接入 Windows Credential Manager，密码不落磁盘文件。
- **自动化测试与 CI 环境 (`InMemoryCredentialProvider`)**：基于内存加密散列结构实现凭据存取，生命周期与进程绑定，零外部系统调用依赖，确保 CI 100% 稳定通过。

### 7.2 异常信息脱敏规范 (`maskErrorMessage`)

MySQL 驱动或底层系统抛出的异常可能夹带敏感数据，直接回传给 AI 模型或客户端存在严重信息泄露风险。所有对外输出（API 响应、MCP isError 载荷、审计日志）的错误消息必须经脱敏过滤器处理：

1. **连接与凭据遮蔽**：拦截并替换形如 `password=...` 或 `mysql://...` 的连接串信息为 `[CREDENTIAL_REDACTED]`。
2. **唯一约束明文遮蔽**：对键冲突报错 `Duplicate entry '...' for key '...'`，将具体数据值遮蔽为 `Duplicate entry '[MASKED]' for key '...'`，仅保留键名以供排查。
3. **本地物理路径遮蔽**：对堆栈或语法错误中包含的绝对路径（如 `D:\...\` 或 `/home/...`）统一替换为 `[LOCAL_PATH]`。
4. **严重未知错误保护**：对未知驱动崩溃或网络断开异常，仅对外暴露安全错误码（如 `DATABASE_ERROR`），底层原始堆栈仅写入本地内存诊断记录。

