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

## 2. 连接模型与存储格式（Phase 2-A 落地实现）

### 2.1 存储文件结构 (`connections.json`)
本地持久化存储采用单写者原子重命名机制，顶层结构如下：
```typescript
interface StoreData {
  schema_version: 1;
  items: ConnectionRecord[];       // 已保存的连接记录（至多 256 项）
  cleanup_refs: string[];          // 待清理的旧凭据引用队列（至多 512 项，用于崩溃恢复与重试）
}

interface ConnectionRecord {
  id: string;                      // 稳定 UUID v4
  name: string;                    // 连接名称 (1..64 字符)
  host: string;                    // 主机名 (1..255 字符)
  port: number;                    // 端口号 (1..65535)
  username: string;                // 用户名 (1..128 字符)
  default_database: string | null; // 默认库 (可选, 1..64 字符)
  version: number;                 // 乐观并发版本号 (从 1 递增)
  credential_ref: string;          // 服务端专用凭据引用 (UUID)，绝对不对外暴露
}

// 客户端与接口视图（脱敏）
interface ConnectionView {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  default_database: string | null;
  version: number;
}
```

### 2.2 存储与凭据生命周期事务补偿
1. **凭据引用与服务名**：创建连接时初次 `credential_ref = id`；服务名严格为 `mysql-mcp:<credential_ref>`，用户名为 `mysql-mcp`；
2. **密码更新防丢失**：修改连接密码时，系统分配全新 UUID 作为新 `credential_ref`，绝不直接原地覆盖旧凭据；
3. **四阶段事务补偿顺序**：
   - 第一阶段（记账）：将可能废弃的凭据引用写入 `cleanup_refs` 队列并原子落盘；
   - 第二阶段（写入凭据）：将新密码安全写入 Windows Keyring；
   - 第三阶段（提交配置）：更新 `items` 中连接记录的新引用与递增版本号，原子落盘；
   - 第四阶段（清理旧凭据）：从 Keyring 删除旧凭据，并在落盘成功后从 `cleanup_refs` 移除；若删除失败则保留非秘密 tombstone，后续任何修改操作将自动重试清理；
4. **并发与状态保护**：
   - **测试锁与读租约**：测试任务进行中持有独占使用锁；受限读取任务通过 `withReadConnection` 获取并行读租约（基于内存计数 Map），允许多个只读请求安全并发复用凭据；
   - **使用中状态互斥**：只要连接仍有活跃的测试锁或只读租约（`readers.get(id) > 0`），对该连接发起的 `PATCH` 编辑或 `DELETE` 删除操作，服务端均直接返回 `409 STATE_CONFLICT` 拒绝执行，杜绝读取进行中凭据被清理或连接配置漂移；
   - **完全隔离的会话生命周期**：读租约仅共享不可变的连接配置草稿与解密凭据，**绝不跨请求共享 MySQL 连接实例或会话状态**；每个请求均建立全新的独立 MySQL 只读会话，查询完毕后立即销毁；
   - **乐观锁并发控制**：编辑或删除时前端必须提供 `expected_version`，与当前记录不一致时返回 `409 STATE_CONFLICT`；
   - **旧审批失效与版本监听（Phase 4-A 落地实现）**：当连接被更新（version 自增）或删除时，`ConnectionService` 触发监听器，`ChangeManager` 同步将该连接所有处于 `PENDING` 或 `APPROVED` 状态的待批请求直接置为 `INVALIDATED`，彻底杜绝目标连接配置漂移后的脏执行。

## 3. 会话与请求（Phase 4-A 落地实现）

```typescript
export const CHANGE_LIMITS = Object.freeze({
  approval_ttl_ms: 300_000,     // 审批有效期 5 分钟 (300 秒)
  retention_ms: 300_000,        // 终态摘要保留 5 分钟 (300 秒)
  execution_timeout_ms: 30_000, // 写执行硬时限 30 秒
  max_requests: 256,            // 最大请求容量
  max_sessions: 16,             // 最大活动 MCP 会话数
  max_concurrent: 4,            // 最大执行并发数
  max_sql_bytes: 1_048_576,     // 全局 SQL/reason 内存预算 (1MiB)
  max_queued: 64                // 最大状态队列排队数
});

export type ChangeState =
  | 'PENDING' | 'APPROVED' | 'EXECUTING'
  | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN'
  | 'REJECTED' | 'CANCELLED' | 'EXPIRED' | 'INVALIDATED';

export type ConfirmationChannel = 'native' | 'web';
export type Decision = 'approve' | 'reject' | 'cancel';

export interface ChangeSummary {
  request_id: string;
  connection_id: string;
  connection_version: number;
  database: string;
  operation: string;           // 'INSERT' | 'UPDATE' | 'DELETE' | 'CREATE' | 'ALTER' | 'DROP' | 'TRUNCATE'
  risk_level: 'L1' | 'L2';
  risk_codes: string[];        // L2 包含 ['HIGH_RISK']
  sql_fingerprint: string;     // AST 结构规范化 SHA256 指纹
  exact_sql_digest: string;    // 输入 SQL 原始文本 SHA256 哈希
  confirmation_channel: ConfirmationChannel;
  state: ChangeState;
  created_at: string;
  expires_at: string;
  updated_at: string;
  result?: WriteResult & { execution_ms: number };
  error_code?: ServerErrorCode;
}

export interface WebDecision {
  decision: Decision;
  approval_nonce: string;      // 32 字节高熵十六进制，单次消费
  sql_fingerprint: string;     // 页面审查与提交一致性校验
  connection_version: number;  // 乐观并发版本号校验
}
```

- **数据隔离与安全性**：
  - **原始 SQL 仅内存保留**：原始 SQL 仅在活动有效期的内存详情及页面审查中可见，**绝不写入 `changes.json` 持久化日志**，列表、MCP 状态与审计中仅保留结构指纹与摘要，杜绝重放风险；
  - **审批 Nonce 绝不进入模型**：浏览器 `approval_nonce` 仅在认证管理会话的详情接口中单次返回，验证消费后立即销毁；
  - **原生确认通道限制**：仅在可信本地注入的客户端版本/权限模式通过且无副作用探针（accept/decline/cancel）实测成功时，L1 变更才启用原生确认；L2 高危变更强制走 Web 页面审查；原生拒绝或取消不降级后备。

## 4. 状态机与持久化日志 (`changes.json`)

| 当前 | 事件 | 下一状态 | 是否派发 SQL |
|---|---|---|---|
| PENDING | 有效人工批准 (approve) | APPROVED | 否 |
| PENDING | 人工拒绝 (reject) | REJECTED | 否（零派发） |
| PENDING | 人工取消 (cancel) / 会话断开 | CANCELLED | 否（零派发） |
| PENDING / APPROVED | 到期 (超过 5 分钟) | EXPIRED | 否（零派发） |
| PENDING / APPROVED | 连接版本变化、连接删除、服务重启 | INVALIDATED | 否（零派发） |
| APPROVED | 执行前复核通过、取得唯一派发权 | EXECUTING | 取得单次派发权 |
| APPROVED | 会话断开或主动取消 | CANCELLED | 否（零派发） |
| APPROVED | 可确定的执行前错误 | FAILED | 否（零派发） |
| EXECUTING | 获得确定性成功回执 | SUCCEEDED | 不再派发 |
| EXECUTING | 确定性数据库错误回执 | FAILED | **不自动重试** |
| EXECUTING | 超时/断线/崩溃且提交结果无法确定 | UNKNOWN | **坚决不重试**（需人工核查） |

- **落盘时机与崩溃一致性**：
  - 状态流转前执行原子写入单写者存储（`schema_version: 1`）；
  - 派发执行前必须先将状态置为 `EXECUTING` 并持久化落盘；若执行回执持久化失败，保守标记为 `UNKNOWN`；
  - **服务重启恢复策略**：重启加载旧日志时，处于 `EXECUTING` 的旧记录保守转换为 `UNKNOWN`（`error_code: 'DB_ERROR'`）；旧的非终态（PENDING / APPROVED）一律转换为 `INVALIDATED`；重启不重放任何 SQL。

## 5. 结果与审计（Phase 3 落地模型）

### 5.1 查询结果模型 (`QueryResult`)
在 Phase 3 中，受限只读查询结果模型在 `mysql-mcp/src/sql/results.ts` 完整锁定：

```typescript
export interface ColumnMeta {
  name: string;                         // 列名（截断上限 1024 字符）
  mysql_type: string;                   // MySQL 底层字段类型编号或名称（截断上限 128 字符）
  encoding: 'text' | 'base64';          // 编码方式：二进制或原始字节流使用 base64，文本使用 text
}

export interface QueryResult {
  columns: ColumnMeta[];                // 列元数据数组（最多 128 列，超限截断并触发 byte_limit）
  rows: unknown[][];                    // 二维数据数组（保留同名重复列；最多 1000 行）
  returned_rows: number;                // 实际返回行数（0..1000）
  truncated: boolean;                   // 是否发生截断
  truncation_reason: 'row_limit' | 'byte_limit' | null; // 截断原因：行数超限为 row_limit；单字段超限/列超限/整帧超限为 byte_limit
  duration_ms: number;                  // 实际查询与流式拉取耗时毫秒数（0..15000）
}
```

**类型映射与序列化规则**：
- **精度安全**：`BIGINT`（64位整数）与 `DECIMAL`（定点数）强制转为高精度字符串返回，杜绝 JavaScript IEEE 754 浮点精度截断；
- **日期与时间**：强制配置 `dateStrings: true`，直接输出原始 MySQL 日期/时间文本，不擅自做本地时区漂移转换；
- **二进制与 BIT**：字符集为二进制（charset 63 且类型为 BLOB/VARBINARY/BINARY/BIT 等）的字段，内容在服务端编码为标准 `base64` 文本（单字段上限 49,149 原始字节，base64 编码后不超过 64KiB），`encoding` 标记为 `'base64'`；
- **安全基本类型**：`null`、`boolean`、以及 JavaScript 安全范围内的有限数值（`Number.isSafeInteger` 或非 NaN/Infinity 浮点数）保持原样输出；
- **字段截断防线**：单字段超过 64KiB (`65,536` 字节) 执行边界裁剪（避免破坏 UTF-16 代理对或 base64 四元组），并触发 `truncation_reason: 'byte_limit'`；
- **整帧预算熔断**：单次响应计算包含 JSON-RPC 及 text content 转义的完整预算 `responseBytes(result)`，若超过 1MiB (`1,048,576` 字节)，自动弹出超出预算的最后一行并触发 `byte_limit` 截断。

### 5.2 元数据工具数据模型
- **`list_databases` 响应**：
  ```typescript
  interface DatabaseListResult {
    items: string[];                    // 数据库名列表（过滤为账号实际可见库）
    next_cursor: null;
  }
  ```
- **`list_tables` 响应**：
  ```typescript
  interface TableListResult {
    items: {
      name: string;                     // 表或视图名
      type: 'table' | 'view';           // 区分基表与视图
    }[];
    next_cursor: null;
  }
  ```
- **`describe_table` 响应**：
  ```typescript
  interface TableSchemaResult {
    columns: {
      name: string;                     // 列名
      mysql_type: string;               // 完整 MySQL 类型声明（如 varchar(255)）
      nullable: boolean;                // 是否可空 (IS_NULLABLE === 'YES')
      primary_key: boolean;             // 是否主键 (COLUMN_KEY === 'PRI')
      ordinal_position: number;         // 列顺序位置 (1-based)
    }[];
    indexes: {
      name: string;                     // 索引名称
      column: string | null;            // 索引包含的列名（可为 null）
      unique: boolean;                  // 是否唯一索引 (NON_UNIQUE === 0)
      sequence: number;                 // 复合索引中的序号 (SEQ_IN_INDEX)
    }[];
  }
  ```
- **`list_connections` 响应**：
  ```typescript
  interface ConnectionListResult {
    items: ConnectionView[];            // 脱敏连接视图（至多 256 项）
    next_cursor: null;
  }
  ```

### 5.3 变更执行与状态查询结果模型（Phase 4-A 落地实现）

```typescript
export interface WriteResult {
  affected_rows: number | string;       // 受影响行数（支持安全整数或十进制字符串以承载 uint64）
  last_insert_id: number | string;      // 最新自增 ID（支持安全整数或十进制字符串以承载 uint64）
  warning_count: number;                // 告警数量 (0..65535)
}

export interface ChangeStatusResult {
  request_id: string;                   // 变更请求 UUID
  state: ChangeState;                   // 当前十状态之一
  updated_at: string;                   // 最新更新时间戳
  result?: WriteResult & { execution_ms: number }; // 成功回执 (SUCCEEDED)
  error_code?: ServerErrorCode;         // 脱敏错误码 (FAILED / UNKNOWN)
  effect_note?: string;                 // 终态安全效果说明（不承诺回滚/不可自动重试）
}
```

审计最小字段：`request_id`、`session_id`、`connection_id`、`connection_version`、`database`、`operation`、`risk_level`、`risk_codes`、`sql_fingerprint`、`exact_sql_digest`、`confirmation_channel`、`state`、时间戳、`error_code` 和必要执行回执。目标库名同样是受控元数据。持久化日志绝不保存原始 SQL 或业务明文结果；错误消息先行脱敏。

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

- **生产环境 (`WindowsKeyringProvider`)**：
  - 基于 `@napi-rs/keyring` 惰性按需加载底层原生动态链接库，提供强类型别名 `getPassword`、`setPassword`、`deletePassword`；
  - **服务与账户契约**：系统凭据服务名为 `mysql-mcp:<connection-id>`，用户名统一固定为 `mysql-mcp`；
  - **标识符约束**：`ref`（即 `connection-id`）长度限定为 1~128 个安全字符（`/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/`），禁止包含控制字符或换行符；
  - **秘密约束**：`secret` 必须为非空合法 UTF-8 字符串，UTF-8 字节长度严格限制在 1024 字节以内，禁止包含空字符 `\0`；
  - **安全异常统一屏蔽**：参数非法抛出 `CredentialArgumentError`（`INVALID_ARGUMENT`），系统服务不可用或访问失败抛出 `CredentialStoreError`（`CREDENTIAL_STORE_UNAVAILABLE`），底层原生异常与本地路径绝不外泄；
  - **零明文后备**：生产环境下系统凭据存取失败坚决不降级为磁盘明文文件或进程内存后备。
- **自动化测试环境**：测试套件内提供基于 AES-GCM 的测试专用内存 Provider 模拟无原生环境分支；生产环境不包含任何内存后备机制。零新增运行时依赖，`package-lock.json` 保持不变。

### 7.2 异常信息脱敏规范 (`maskErrorMessage`)

MySQL 驱动或底层系统抛出的异常可能夹带敏感数据，直接回传给 AI 模型或客户端存在严重信息泄露风险。所有对外输出（API 响应、MCP isError 载荷、审计日志）的错误消息必须经脱敏过滤器处理：

1. **连接与凭据遮蔽**：拦截并替换形如 `password=...` 或 `mysql://...` 的连接串信息为 `[CREDENTIAL_REDACTED]`。
2. **唯一约束明文遮蔽**：对键冲突报错 `Duplicate entry '...' for key '...'`，将具体数据值遮蔽为 `Duplicate entry '[MASKED]' for key '...'`，仅保留键名以供排查。
3. **本地物理路径遮蔽**：对堆栈或语法错误中包含的绝对路径（如 `D:\...\` 或 `/home/...`）统一替换为 `[LOCAL_PATH]`。
4. **严重未知错误保护**：对未知驱动崩溃或网络断开异常，仅对外暴露安全错误码（如 `DATABASE_ERROR`），底层原始堆栈仅写入本地内存诊断记录。

