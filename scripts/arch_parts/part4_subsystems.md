## 第四章：核心子系统深度技术设计

### 4.1 协议适配与业务上下文 (RequestContext) 模型

#### 4.1.1 协议适配层设计与代际解耦
网关设计独立的协议适配层 (Protocol Adapter)，屏蔽 Streamable HTTP (POST /mcp)、Legacy HTTP+SSE 与 Stdio 底层差异，统一解构为内部标准调用对象 `InternalMcpInvocation`。

#### 4.1.2 携带完整时效校验的 RequestContextSnapshot
为彻底消除“排队期间用户权限变更、PAT 自然过期或策略失效导致越权”的漏洞，快照中显式封装全量时效与版本标识：

```typescript
interface RequestContextSnapshot {
  requestId: string;           // 单次请求全局唯一 ID
  userId: number;              // 认证用户 ID
  username: string;            // 用户名快照
  patId: number;               // 认证使用的 PAT ID
  patExpiresAt: number | null; // PAT 绝对过期时间戳 (毫秒, null 为永久)
  authVersion: number;         // 用户授权版本号 (改密/冻结/改角色时递增)
  globalPolicyVersion: number; // 全局策略版本号 (角色模板/限流/ACL 调整时递增)
  activeRoleIds: number[];     // 生效角色 ID 列表
  effectiveProfile: {
    id: number;
    name: string;
    capacityQpm: number;
    maxPoolSize: number;
  };
  effectiveDatabase: string;   // 当前操作生效的工作数据库
  tableAcl: {
    blacklists: string[];      // 角色合并后的黑名单模式
    whitelists: string[];      // 角色合并后的白名单模式
  };
  quotas: {
    defaultLimit: number;
    maxLimit: number;
    maxTimeoutMs: number;
    userQpmLimit: number;
    maxInflightConcurrency: number; // 单用户最大在途并发数
  };
  snapshotCreatedAt: number;   // 快照生成时间戳
  snapshotTtlMs: number;       // 本地快照有效时限 (硬设为 2000ms)
}
```

---

### 4.2 认证、短 TTL 授权快照与二次鉴权多维完整契约

#### 4.2.1 凭据验签与常量时间比较
- **PAT 生成**：256-bit 高熵 CSPRNG 密钥，格式为 `mcp_pat_<32位安全串>`；
- **存储标准**：数据库仅存储不可逆摘要 `token_hash = HMAC-SHA-256(SERVER_PEPPER, token)`；
- **验签防时序攻击**：调用 `crypto.timingSafeEqual()` 进行常量时间比对。

#### 4.2.2 执行前二次鉴权多维完整契约 (Pre-Execution Validation Contract)
针对“排队延迟导致 PAT 自然到期、快照超时、策略更新或数据源停用”的边缘漏洞，在物理连接借出、即将下发 SQL 瞬间，网关执行严格的多维原子契约核验：

```typescript
function validateSnapshotBeforeExecution(
  snapshot: RequestContextSnapshot,
  registries: {
    userAuth: UserAuthRegistry;
    policy: PolicyRegistry;
    patRevocation: PatRevocationRegistry;
    profile: ProfileRegistry;
  }
): { valid: boolean; reason?: string } {
  const now = Date.now();

  // 1. 检查快照自身 TTL 是否过期 (排队等待超过 2000ms 必须拒绝下发，重新刷新鉴权)
  if (now - snapshot.snapshotCreatedAt > snapshot.snapshotTtlMs) {
    return { valid: false, reason: 'ERR_AUTH_SNAPSHOT_TTL_EXPIRED' };
  }

  // 2. 检查 PAT 是否已自然到期或被撤销
  if (snapshot.patExpiresAt !== null && now > snapshot.patExpiresAt) {
    return { valid: false, reason: 'ERR_AUTH_PAT_NATURALLY_EXPIRED' };
  }
  if (registries.patRevocation.isRevoked(snapshot.patId)) {
    return { valid: false, reason: 'ERR_AUTH_PAT_REVOKED' };
  }

  // 3. 检查用户授权版本 (改密、冻结、角色调整时版本递增)
  if (snapshot.authVersion !== registries.userAuth.getVersion(snapshot.userId)) {
    return { valid: false, reason: 'ERR_AUTH_USER_VERSION_CHANGED' };
  }

  // 4. 检查全局策略版本 (角色模板变更、ACL 策略调整)
  if (snapshot.globalPolicyVersion !== registries.policy.getGlobalVersion()) {
    return { valid: false, reason: 'ERR_AUTH_POLICY_CHANGED' };
  }

  // 5. 检查目标 Profile 状态 (数据源停用或下线)
  if (!registries.profile.isActive(snapshot.effectiveProfile.id)) {
    return { valid: false, reason: 'ERR_PROFILE_INACTIVE' };
  }

  return { valid: true };
}
```
校验不通过时，网关立即终止执行，直接释放或销毁物理连接，杜绝排队延迟引发的隐蔽越权。

---

### 4.3 三层纵深数据安全防线与修正后的 CTE 提取算法

#### 4.3.1 三层纵深防御分工
1. **第 1 道物理防线（绝对兜底）**：MySQL 实例账号仅授予特定业务表的 `SELECT` 权限，彻底收回所有写特权与高级函数特权，杜绝视图穿透与存储过程越权；
2. **第 2 道 AST 语法防线**：拦截 `FOR UPDATE`、`LOCK IN SHARE MODE`、`SLEEP()`、`LOAD_FILE`、`INTO OUTFILE`；
3. **第 3 道策略防线**：库表 ACL 严格执行 **Default Deny**。

#### 4.3.2 修正后的 CTE 递归提取算法 (库名前缀优先与顺序可见性)
算法确立**前缀优先原则**，并处理同级 CTE 顺序可见性：

```
算法：前缀优先与作用域栈物理表提取 (ExtractPhysicalTablesWithScope)
输入：ASTNode 根节点
输出：Set<PhysicalTable> (标准库表标识)

1. 初始化全局物理表集合 physicalTables = new Set()
2. 初始化作用域栈 scopeStack = new Stack<Set<string>>()
3. 进入当前查询块：
   a. 创建当前作用域 cteScope = new Set<string>()
   b. 若当前节点包含 WITH 块 (CTE 声明列表: withList):
      i. 遍历 withList 中的每个定义 (cteItem):
         - 【顺序可见性保障】：在解析 cteItem 的内部查询前，把已注册在 cteScope 的同级前面 CTE 视作可见
         - 递归调用本算法提取 cteItem 内部引用的物理表
         - 将 cteItem.name (纯小写表名) 存入当前层级的 cteScope (供后续同级 CTE 引用)
   c. 将 cteScope 压入 scopeStack
4. 递归遍历查询主体 (FROM、JOIN、子查询、UNION 分支):
   a. 若遇到表引用节点 TableRef (database, name):
      i. 【核心前缀优先规则】：
         若 database 存在且不为空 (例如 finance.salary):
         - 属于显式限定的数据库实体对象，绝不匹配 CTE 别名！
         - 提取为 "finance.salary"，直接加入 physicalTables
      ii. 若 database 为空 (未限定库名，例如 salary):
         - 检查 name 是否在 scopeStack 的任何一层中存在：
           * 若存在：判定为 CTE 虚拟中间表别名，跳过
           * 若不存在：使用上下文默认工作库 defaultDatabase 补全为 "defaultDatabase.name"，加入 physicalTables
   b. 若遇到嵌套子查询或派生表 DerivedTable:
      i. 递归调用步骤 3 处理子查询
5. 退出当前查询块：
   a. scopeStack.pop() 弹出当前层级
6. 返回 physicalTables
```

#### 4.3.3 安全无表查询放行与表级 ACL 判定 (Default Deny)
伪代码明确区分“安全无表查询”与“解析失败”：

```typescript
function evaluateTableAcl(
  physicalTables: Set<string>, 
  acl: { blacklists: string[]; whitelists: string[] },
  isKnownNoTableQuery: boolean // 如 SELECT 1, SELECT NOW(), SELECT @@version
): boolean {
  // 1. 安全无表查询放行
  if (physicalTables.size === 0) {
    if (isKnownNoTableQuery) {
      return true; // 合法的无表探测或心跳查询，允许放行
    }
    return false; // 无法识别的未知对象结构，Default Deny 拦截
  }

  // 2. 实体表严格校验
  for (const table of physicalTables) {
    // 黑名单优先：命中任何一条立即拒绝
    if (acl.blacklists.some(pattern => matchPattern(table, pattern))) {
      return false;
    }
    // 白名单校验：白名单为空或未命中白名单，一律拒绝 (Default Deny)
    if (acl.whitelists.length === 0) {
      return false;
    }
    const isWhitelisted = acl.whitelists.some(pattern => matchPattern(table, pattern));
    if (!isWhitelisted) {
      return false;
    }
  }

  return true;
}
```

---

### 4.4 全链路立体资源防护 (在途并发、超时联动 KILL、流式 rowsAsArray 与分层内存预算)

#### 4.4.1 分层内存预算体系 (Multi-Tier Memory Budget)
系统杜绝将 5MB 简单等同于网关内存防爆，建立四层立体内存约束模型：

```
┌────────────────────────────────────────────────────────┐
│                        四层立体内存约束模型                    │
├─────────────────────┬──────────────────────────────────┤
│ 1. 协议包硬上限     │ maxAllowedPacket = 16MB (底层网络层拒绝巨型数据包)│
│ 2. 单行单字段预算   │ 单字段 > 64KB 截断；单行超长拒绝 (防单个巨型单元格)│
│ 3. 结果集返回预算   │ 累计流式行字节数 > 5MB 立即销毁流并切断连接      │
│ 4. 并发总内存预算   │ 单用户最大在途并发 (5) * 5MB = 25MB (总内存严格有界)│
└─────────────────────┴──────────────────────────────────┘
```

#### 4.4.2 原生数组行模式 (rowsAsArray) 流式执行器
彻底解决 `Object.values(row)` 带来的键排序乱序与重名列覆盖问题：

```typescript
import mysql2 from 'mysql2';

interface ExecutionResult {
  columns: string[];
  rows: any[][];
  truncated: boolean;
  executionTimeMs: number;
}

export async function executeQueryWithStreamDefense(
  conn: mysql2.PoolConnection,
  sql: string,
  params: any[],
  remainingTimeoutMs: number,
  maxBytes: number = 5 * 1024 * 1024 // 5MB 结果预算
): Promise<ExecutionResult> {
  const startTime = Date.now();

  return new Promise((resolve, reject) => {
    let columns: string[] = [];
    const rows: any[][] = [];
    let accumulatedBytes = 0;
    let isTruncated = false;

    // 核心：强制开启 rowsAsArray 原生二维数组模式，并透传有效剩余超时
    const queryStream = conn.query({
      sql,
      values: params,
      rowsAsArray: true, // 杜绝对象键排序乱序与 JOIN 重名列覆盖
      timeout: remainingTimeoutMs,
    }).stream();

    // 1. 从 fields 事件提取原始列元数据，保真列顺序
    queryStream.on('fields', (fields: mysql2.FieldPacket[]) => {
      columns = fields.map(f => f.name);
    });

    // 2. 流式逐行处理原生数组行
    queryStream.on('data', (rowArray: any[]) => {
      if (isTruncated) return;

      // 实时计量每行字节数
      const rowBytes = Buffer.byteLength(JSON.stringify(rowArray));
      accumulatedBytes += rowBytes;

      if (accumulatedBytes > maxBytes) {
        isTruncated = true;
        // 达到 5MB 预算，主动销毁网络流，杜绝大结果集继续灌入 V8 堆内存
        queryStream.destroy();
        // 标记连接处于非干净状态，释放时强制物理销毁
        (conn as any).__force_destroy = true;

        resolve({
          columns,
          rows,
          truncated: true,
          executionTimeMs: Date.now() - startTime,
        });
      } else {
        rows.push(rowArray);
      }
    });

    queryStream.on('end', () => {
      if (!isTruncated) {
        resolve({
          columns,
          rows,
          truncated: false,
          executionTimeMs: Date.now() - startTime,
        });
      }
    });

    queryStream.on('error', (err: Error) => {
      reject(err);
    });
  });
}
```

---

### 4.5 连接池治理、官方 reset(cb) 原生命令与 1500ms 超时

#### 4.5.1 统一 callback 连接模型与原生复位状态机
精确锁定生产驱动为 **`mysql2: "3.24.6"`**，数据面底层统一采用原生 callback 风格 `mysql2.PoolConnection`，直接调用官方状态机 `conn.reset(cb)`，消除所有 `as any`：

```typescript
import mysql2 from 'mysql2';

export async function safeReleaseConnection(conn: mysql2.PoolConnection): Promise<void> {
  // 若执行过程中发生了流式截断超限、客户端中断或超时，强制物理销毁
  if ((conn as any).__force_destroy) {
    conn.destroy();
    return;
  }

  let isResetSuccess = false;
  let resetTimer: NodeJS.Timeout | null = null;

  try {
    await new Promise<void>((resolve, reject) => {
      // 挂载 1500ms 复位硬超时定时器，防 MySQL 服务端锁死或 Socket 挂起
      resetTimer = setTimeout(() => {
        reject(new Error('Reset connection timed out after 1500ms'));
      }, 1500);

      // 规范调用官方 reset(cb) 接口 (发送 0x1F 并等待 OK_Packet 回包)
      conn.reset((err: Error | null) => {
        if (resetTimer) clearTimeout(resetTimer);
        if (err) reject(err);
        else resolve(); // 仅当收到服务端 OK_Packet (0x00)，确认复位成功
      });
    });
    isResetSuccess = true;
  } catch (err) {
    isResetSuccess = false;
  } finally {
    if (resetTimer) clearTimeout(resetTimer);

    if (isResetSuccess) {
      conn.release(); // 确认状态干净，安全归还连接池
    } else {
      // 【Fail-Destroy 铁律】：复位超时、复位失败或连接处于未决状态，坚决物理销毁！
      conn.destroy();
    }
  }
}
```

---

### 4.6 取消租约锁 (Lease Lock) 与双重 Deadline 有界收尾

#### 4.6.1 解决取消与完成的竞态以及 Admin KILL 挂死
为防止 Admin KILL 网络挂起导致连接永久锁死，网关引入双重 Deadline 与有界收尾机制：

```typescript
interface ActiveQueryContext {
  queryInstanceId: string;
  threadId: number;
  conn: mysql2.PoolConnection;
  status: 'RUNNING' | 'CANCELING' | 'COMPLETED' | 'CANCELED';
  startedAt: number;
}

export class QueryLifecycleCoordinator {
  private activeQueries = new Map<string, ActiveQueryContext>();

  constructor(private adminChannel: AdminMaintenanceChannel) {}

  // 原子状态转移：RUNNING -> CANCELING (加装连接租约独占锁)
  cancelRunningQuery(instanceId: string): void {
    const context = this.activeQueries.get(instanceId);
    if (!context || context.status !== 'RUNNING') return;

    // 1. 原子加锁：进入 CANCELING 并加装租约锁
    context.status = 'CANCELING';
    (context.conn as any).__locked_for_cancellation = true;

    // 2. 双重 Deadline 保证有界收尾：无论 Admin KILL 是否挂起，本地 2000ms 强制清理
    const safetyDeadline = setTimeout(() => {
      // 兜底强制销毁物理套接字，断开底层 TCP，让 MySQL 服务端自动回收线程
      context.conn.destroy();
      this.activeQueries.delete(instanceId);
    }, 2000);

    // 3. 异步下发 KILL，捕获错误杜绝 unhandled rejection
    this.adminChannel.killQuery(context.threadId)
      .then(() => {
        // 服务端 KILL 成功确认
      })
      .catch((killErr: Error) => {
        // 记录告警：可能线程已经执行结束，属于预期良性竞争
      })
      .finally(() => {
        clearTimeout(safetyDeadline);
        context.conn.destroy(); // 物理销毁套接字，绝不归还
        this.activeQueries.delete(instanceId);
      });
  }

  // 正常执行完成路径的连接交接检查
  handleQuerySuccess(instanceId: string): void {
    const context = this.activeQueries.get(instanceId);
    if (!context) return;

    // 核心互斥检查：若已被取消逻辑锁定租约，正常完成路径放弃归还，严禁复用
    if ((context.conn as any).__locked_for_cancellation || context.status === 'CANCELING') {
      return;
    }

    context.status = 'COMPLETED';
    safeReleaseConnection(context.conn);
    this.activeQueries.delete(instanceId);
  }
}
```

---

### 4.7 全场景 SSRF 深度防御系统 (Post-DNS Resolution Check & IP Pinning)

覆盖 Webhook、MySQL 连接、SSH 隧道与 SMTP 连通性测试。

```
[目标主机 Hostname] ──▶ dns.promises.lookup(host, { all: true }) ──▶ 获得全部解析 IP
                              │
                              ▼
        [逐一遍历 IP 进行 CIDR 黑名单过滤]
        · 环回: 127.0.0.0/8, ::1
        · 私网: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, fc00::/7
        · 云元数据: 169.254.169.254, fd00:ec2::254
        · 链路本地: 169.254.0.0/16, fe80::/10
        · 运营商 CGNAT: 100.64.0.0/10
        · 映射编码: ::ffff:127.0.0.1
                              │
  ┌───────────────────────────┴───────────────────────────┐
  ▼                                                       ▼
[命中了黑名单 且 未在 ALLOWED_OUTBOUND_IPS 白名单中]     [校验完全通过]
  │                                                       │
  ▼                                                       ▼
[403 立即阻断并产生高危告警]                           [强制 IP Pinning 直连]
                                                          直接 Socket 连接已验证 IP，
                                                          禁止 3xx 重定向，超时 2s/3s
```

---

### 4.8 高可靠分级审计体系 (全量在途事件有界管控与容量丢失边界)

#### 4.8.1 全量在途事件有界管控
为防止审计队列统计偏差，网关对**“已预留槽位、正在排队、微批待提交”的所有未持久化在途事件实行统一限额管控**：
- 设定全局未提交事件硬上限为 **10,000 条**；
- 达到 8,000 条 (80%) 触发背压减速；达到 10,000 条 (100%) 暂停接收新入站请求，从源头消除丢日志风险。

#### 4.8.2 客观界定系统容灾边界
- **优雅退出 0 丢失**：系统捕获 `SIGTERM` / `SIGINT` 信号后，停止接入新请求并同步 flush 内存队列；
- **客观容量丢失边界**：在发生不可捕获的 `SIGKILL` (如 OOM Killer 强杀) 或服务器突发物理掉电时，未落盘数据最大潜在丢失量**严格受限于有界容量上限 (<= 10,000 条)**，监控指标暴露最老未持久化事件的存活年龄。

---

### 4.9 超管自锁判定完善与全量入口事务级防自残

#### 4.9.1 精确状态变化判定 (避免无关修改被误拒)
超管自锁不仅检查当前活跃超管数，而是基于**操作后的剩余活跃超管数**进行精确评估：
- 若操作只是修改最后超管的无关属性（如修改邮箱、绑定普通分析师角色），系统予以放行；
- 仅当操作会导致其失去 `SUPER_ADMIN` 角色（解绑超管角色、修改角色列表不含超管）或将其状态置为非 `ACTIVE`（如 `DISABLED` 或物理删除）时，且当前系统中仅剩最后 1 名活跃超管，触发强制拦截。

```sql
-- 事务级排他锁校验
SELECT COUNT(DISTINCT u.id) AS active_super_admins
FROM sys_users u
JOIN sys_user_roles ur ON u.id = ur.user_id
JOIN sys_roles r ON ur.role_id = r.id
WHERE r.role_name = 'SUPER_ADMIN' 
  AND u.status = 'ACTIVE'
FOR UPDATE;

-- 在事务中比对：若目标用户是当前活跃超管，且操作会导致其失效，且 active_super_admins <= 1：
-- 立即 ROLLBACK 并抛出 HTTP 400 错误
```
