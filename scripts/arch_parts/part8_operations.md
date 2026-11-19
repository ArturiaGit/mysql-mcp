## 第八章：单节点原型验证、运维与安全加固

### 8.1 运行模型 (单节点单主进程模型规范)

在进入分布式扩展之前，必须首先完成**单节点单主进程 (Single Gateway Process)** 的闭环原型实现与验收测试。

```
┌────────────────────────────────────────────────────────┐
│               企业内网宿主机 / 单节点虚拟机            │
│                                                        │
│  ┌──────────────────────────────────────────────────┐  │
│  │ Docker 容器: mysql-mcp-gateway                   │  │
│  │   ├─ Port 8080: Gateway (Streamable HTTP / SSE)  │  │
│  │   ├─ Port 8081: Admin API & Nginx (Web UI 静态)   │  │
│  │   └─ 单一事件循环: 在途并发 + 授权快照 + RingBuffer │  │
│  └───────────────────────────┬──────────────────────┘  │
│                              │ 本地专用网络直连        │
│  ┌───────────────────────────▼──────────────────────┐  │
│  │ Docker 容器: mysql-metadata                      │  │
│  │   └─ Port 3306: 系统元数据 MySQL 8.0 (持久化卷)   │  │
│  └──────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────┘
```
- **单一权威状态**：单进程内运行的限流器、在途并发原子计数器、等待队列与审计环形缓冲区无需跨进程 IPC 协调，天然保证计数精确且无锁；
- **状态不翻倍**：单进程模式下，声明的在途并发 5 就是 5，连接池最大 10 就是 10，物理保护边界绝对可控。

---

### 8.2 生产级容器化编排 (docker-compose.yml 参考)

```yaml
version: '3.8'

services:
  # 1. 网关系统元数据库
  mysql-metadata:
    image: mysql:8.0-oracle
    container_name: mcp-mysql-metadata
    restart: always
    environment:
      MYSQL_ROOT_PASSWORD: RootSecurePassword2026!
      MYSQL_DATABASE: mcp_system
      MYSQL_USER: mcp_user
      MYSQL_PASSWORD: McpUserPassword2026!
      TZ: Asia/Shanghai
    command:
      - --character-set-server=utf8mb4
      - --collation-server=utf8mb4_0900_ai_ci
      - --default-time-zone=+08:00
      - --max_connections=500
    volumes:
      - metadata_data:/var/lib/mysql
      - ./init.sql:/docker-entrypoint-initdb.d/init.sql:ro
    ports:
      - "3306:3306"
    networks:
      - mcp-internal

  # 2. MySQL-MCP 安全网关与管控服务 (单主进程模式)
  mysql-mcp-gateway:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: mcp-gateway-app
    restart: always
    depends_on:
      - mysql-metadata
    environment:
      NODE_ENV: production
      PORT_GATEWAY: 8080
      PORT_ADMIN: 8081
      DB_HOST: mysql-metadata
      DB_PORT: 3306
      DB_USER: mcp_user
      DB_PASSWORD: McpUserPassword2026!
      DB_NAME: mcp_system
      GATEWAY_MASTER_KEYS: '{"active_key_id":"k2026_01","keys":{"k2026_01":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"}}'
      INITIAL_ADMIN_PASSWORD: ""
      ALLOWED_OUTBOUND_IPS: "10.100.0.0/16,172.18.0.0/16"
      MAX_INFLIGHT_CONCURRENCY_PER_USER: 5
      MAX_INFLIGHT_CONCURRENCY_PER_PROFILE: 30
      DEFAULT_QUEUE_TIMEOUT_MS: 3000
      MAX_RESULT_PAYLOAD_BYTES: 5242880 # 5MB
    ports:
      - "8080:8080"
      - "8081:8081"
    volumes:
      - ./logs:/app/logs
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/health/live"]
      interval: 10s
      timeout: 3s
      retries: 3
    networks:
      - mcp-internal

volumes:
  metadata_data:
    driver: local

networks:
  mcp-internal:
    driver: bridge
```

---

### 8.3 核心并发与安全验收测试用例 (Test Matrix)

进入单节点原型代码实施后，必须通过以下 8 项关键工程验收测试：

| 用例编号 | 验收测试场景 | 预期测试行为与交付标准 |
| :---: | :--- | :--- |
| **TC-01** | **CTE 同名但带显式库名防穿透**<br>`WITH salary AS (...) SELECT * FROM finance.salary` | 前缀优先算法生效，真实物理表 `finance.salary` 被准确提取并送检 ACL；若在黑名单中，100% 阻断。 |
| **TC-02** | **取消租约锁防误杀与有界收尾**<br>并发压测下取消长查询与查询正常返回毫秒级重叠，且 Admin 通道响应挂死 | 原子 CAS 进入 `CANCELING` 加装租约锁；正常路径严禁归还连接；本地 2s 超时到期强制 `destroy()` 连接并清理配额，零误杀且零挂死。 |
| **TC-03** | **复位无响应与 1500ms 超时清理**<br>模拟 MySQL 底层网络死锁，服务端不回传 `OK_Packet` | 1500ms 复位硬超时触发并抛出异常；连接执行 `destroy()` 物理切断并剔除，连接池重新建连，零泄露。 |
| **TC-04** | **两名超管并发被移除验证**<br>两名管理员同时并发调用 API 移除系统中仅有的两名超管 | 事务行级锁 `FOR UPDATE` 确保串行化；第一笔操作成功，第二笔操作检测到活跃超管仅剩 1 名，被强制拒绝。 |
| **TC-05A**| **大量小行流式防爆截断**<br>执行下发返回 100MB 数据的只读查询 | 流式游标实时累加原生数组行；累计超 5MB 时立即触发 `stream.destroy()` 并切断连接，堆内存波动 < 20MB。 |
| **TC-05B**| **单行/单字段超长防御**<br>查询单个超大字段 (如 10MB BLOB) 或巨型协议包 | 协议层 `maxAllowedPacket (16MB)` 与单字段截断生效，保证内存不被单个异常字段打爆。 |
| **TC-06** | **排队期间 PAT 自然到期二次鉴权**<br>携带 1 秒后到期的 PAT，排队等待 1.5 秒后借出连接 | 借出瞬间核验 `patExpiresAt`，检测到已自然到期，立即中断下发并返回 `ERR_AUTH_PAT_NATURALLY_EXPIRED`。 |
| **TC-07** | **数字别名与重名列保真**<br>执行 `SELECT 'a' AS '2', 'b' AS '1'` 及 `SELECT a.id, b.id FROM a JOIN b` | `rowsAsArray: true` 原生二维数组保真列顺序为 `['a', 'b']`；重名列均保留，零丢列。 |

---

### 8.4 监控告警指标 (Prometheus Metrics & Healthcheck)

网关通过 `/metrics` 接口暴露标准 Prometheus 指标：

```
# HELP mcp_gateway_requests_total 网关处理请求总量 (按 Tool 及响应状态)
# TYPE mcp_gateway_requests_total counter
mcp_gateway_requests_total{tool="execute_query", status="success"} 152840
mcp_gateway_requests_total{tool="execute_query", status="blocked_ast"} 312
mcp_gateway_requests_total{tool="execute_query", status="blocked_concurrency"} 45
mcp_gateway_requests_total{tool="execute_query", status="canceled"} 18

# HELP mcp_gateway_inflight_requests 当前正在执行的在途请求数
# TYPE mcp_gateway_inflight_requests gauge
mcp_gateway_inflight_requests{profile="prod_readonly"} 6

# HELP mcp_gateway_destroyed_connections_total 触发 Fail-Destroy 物理销毁的连接总数
# TYPE mcp_gateway_destroyed_connections_total counter
mcp_gateway_destroyed_connections_total{profile="prod_readonly", reason="canceled"} 18
mcp_gateway_destroyed_connections_total{profile="prod_readonly", reason="reset_timeout"} 2
mcp_gateway_destroyed_connections_total{profile="prod_readonly", reason="payload_exceeded"} 5

# HELP mcp_gateway_pool_waiting_requests 连接池并发排队等待队列当前长度
# TYPE mcp_gateway_pool_waiting_requests gauge
mcp_gateway_pool_waiting_requests{profile="prod_readonly"} 0

# HELP mcp_gateway_com_reset_duration_seconds COM_RESET_CONNECTION 状态复位耗时
# TYPE mcp_gateway_com_reset_duration_seconds histogram
mcp_gateway_com_reset_duration_seconds_bucket{le="0.001"} 145000
mcp_gateway_com_reset_duration_seconds_bucket{le="0.002"} 152800

# HELP mcp_gateway_audit_queue_utilization 审计内存 RingBuffer 队列利用率
# TYPE mcp_gateway_audit_queue_utilization gauge
mcp_gateway_audit_queue_utilization 0.12

# HELP mcp_gateway_oldest_unflushed_audit_age_seconds 最老未刷盘审计事件存活时间 (秒)
# TYPE mcp_gateway_oldest_unflushed_audit_age_seconds gauge
mcp_gateway_oldest_unflushed_audit_age_seconds 0.28
```

#### 健康检查探针 (Healthcheck Probes)
- **存活探针 (Liveness - `/health/live`)**：检测 Node.js 异步事件循环是否健康；
- **就绪探针 (Readiness - `/health/ready`)**：检测系统元数据库连通性、本地密钥环完整性与关键加密参数就绪状态；元数据故障时返回 503 实现负载均衡自动摘流。
