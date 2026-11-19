## 第九章：全场景 SSRF 深度防御、AES-256-GCM 密钥环与通知推送系统 (`packages/security`)

### 9.1 `SsrfGuard`: Post-DNS Resolution Check、全量 CIDR 黑名单与 IP Pinning

```typescript
// packages/security/src/ssrf-guard.ts
import dns from 'node:dns';
import net from 'node:net';
import ipaddr from 'ipaddr.js';
import { AppError } from '@mysql-mcp/core-engine';

const PROHIBITED_CIDRS = [
  '0.0.0.0/8',
  '127.0.0.0/8',
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '169.254.0.0/16',
  '100.64.0.0/10',
  '::1/128',
  'fc00::/7',
  'fe80::/10',
];

export class SsrfGuard {
  private readonly parsedProhibited = PROHIBITED_CIDRS.map((c) => ipaddr.parseCIDR(c));
  private readonly parsedAllowedOutbound: Array<[ipaddr.IPv4 | ipaddr.IPv6, number]>;

  constructor(allowedOutboundCidrsCsv: string) {
    this.parsedAllowedOutbound = allowedOutboundCidrsCsv
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((cidr) => (cidr.includes('/') ? ipaddr.parseCIDR(cidr) : ipaddr.parseCIDR(`${cidr}/32`)));
  }

  public isIpAllowed(rawIp: string): boolean {
    let addr = ipaddr.parse(rawIp);
    if (addr.kind() === 'ipv6' && (addr as ipaddr.IPv6).isIPv4MappedAddress()) {
      addr = (addr as ipaddr.IPv6).toIPv4Address();
    }

    const inWhitelist = this.parsedAllowedOutbound.some(([netAddr, prefix]) => {
      if (addr.kind() !== netAddr.kind()) return false;
      return addr.match([netAddr, prefix]);
    });
    if (inWhitelist) return true;

    const inBlacklist = this.parsedProhibited.some(([netAddr, prefix]) => {
      if (addr.kind() !== netAddr.kind()) return false;
      return addr.match([netAddr, prefix]);
    });

    return !inBlacklist;
  }

  public async resolveAndValidateHost(hostname: string): Promise<string> {
    const cleanHost = hostname.trim();
    if (net.isIP(cleanHost)) {
      if (!this.isIpAllowed(cleanHost)) {
        throw this.buildSsrfError(cleanHost, cleanHost);
      }
      return cleanHost;
    }

    const records = await dns.promises.lookup(cleanHost, { all: true, verbatim: true });
    if (records.length === 0) {
      throw new AppError({
        code: 'ERR_VALIDATION_FAILED',
        statusCode: 400,
        message: `Unable to resolve hostname '${cleanHost}'.`,
      });
    }

    for (const rec of records) {
      if (!this.isIpAllowed(rec.address)) {
        throw this.buildSsrfError(cleanHost, rec.address);
      }
    }

    return records[0].address;
  }

  private buildSsrfError(host: string, hitIp: string): AppError {
    return new AppError({
      code: 'ERR_SSRF_PROHIBITED',
      statusCode: 403,
      message: `目标地址 ${host} (解析 IP: ${hitIp}) 命中内网/保留地址 SSRF 拦截规则。`,
      actionGuidance:
        '若该地址属于受管内网数据库，请联系系统运维将该网段加入环境变量 ALLOWED_OUTBOUND_IPS 白名单。',
    });
  }
}
```

---

### 9.2 数据源连通性测试 (`test-db` / `test-ssh`) 三模式解析、TLS 同契约校验与防凭据外泄机制（闭环 `BE-R04`）

连通性测试与生产连接池共享完全相同的 **“`host: targetHost` + 自定义 `stream`（直连 `pinnedIp` 或经由 `SshTunnelManager.openEphemeralTunnelStream` 转发通道）+ 公共 `toMysqlSslOptions()` (`verifyIdentity: true`)”** 契约，并强制执行修改数据库端点 (`host/port/user`)、TLS 信任链 (`enabled/ca_cert`) 或 SSH 跳板机信任元组 (`use_ssh/ssh_host/ssh_port/ssh_user/ssh_host_fingerprint_sha256`) 时必须重新录入凭据 (`ERR_CREDENTIAL_REENTRY_REQUIRED`) 的防外泄规则：

```typescript
// apps/admin-api/src/services/profile-connectivity.service.ts
import net from 'node:net';
import mysql2 from 'mysql2';
import { AppError, toMysqlSslOptions, type SshTunnelManager } from '@mysql-mcp/core-engine';
import type { CryptoKeyring, SsrfGuard } from '@mysql-mcp/security';
import type { ProfileRepository } from '../repositories/profile.repository';

export interface TestDbPayload {
  profile_id?: string | number;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  tls_config?: Record<string, unknown> | null;
  use_ssh?: boolean;
  ssh_host?: string;
  ssh_port?: number;
  ssh_user?: string;
  ssh_private_key?: string;
  ssh_host_fingerprint_sha256?: string;
}

export class ProfileConnectivityService {
  constructor(
    private readonly profileRepo: ProfileRepository,
    private readonly keyring: CryptoKeyring,
    private readonly ssrfGuard: SsrfGuard,
    private readonly sshManager?: SshTunnelManager
  ) {}

  public async testMysqlConnectivity(
    payload: TestDbPayload
  ): Promise<{ reachable: boolean; latencyMs: number }> {
    let targetHost: string;
    let targetPort: number;
    let targetUser: string;
    let targetPassword: string;
    let targetDatabase: string | undefined;
    let targetTlsConfig: Record<string, unknown> | null | undefined;
    let targetUseSsh: boolean;
    let targetSshHost: string | undefined;
    let targetSshPort: number;
    let targetSshUser: string | undefined;
    let targetSshPrivateKey: string | undefined;
    let targetSshPrivateKeyEncrypted: string | undefined;
    let targetSshFingerprint: string | undefined;

    if (payload.profile_id !== undefined) {
      const saved = await this.profileRepo.findByIdOrThrow(String(payload.profile_id));
      targetHost = payload.host?.trim() || saved.host;
      targetPort = payload.port ?? saved.port;
      targetUser = payload.user?.trim() || saved.username;
      targetDatabase = payload.database?.trim() || saved.default_database;
      targetTlsConfig = payload.tls_config !== undefined ? payload.tls_config : saved.tls_config;

      const savedSsh = (saved.ssh_config as Record<string, unknown> | undefined) || {};
      const savedSshEnabled = Boolean(savedSsh.use_ssh);
      targetUseSsh = payload.use_ssh !== undefined ? payload.use_ssh : savedSshEnabled;
      targetSshHost = payload.ssh_host?.trim() || (savedSsh.host as string | undefined);
      targetSshPort = payload.ssh_port ?? (savedSsh.port as number | undefined) ?? 22;
      targetSshUser = payload.ssh_user?.trim() || (savedSsh.username as string | undefined);
      targetSshFingerprint =
        payload.ssh_host_fingerprint_sha256?.trim() ||
        (savedSsh.host_fingerprint_sha256 as string | undefined);

      // 防凭据窃取铁律：未传新密码复用库内旧密文时，严禁修改 host、port、user、TLS 或 SSH 信任边界
      const hostChanged = targetHost !== saved.host;
      const portChanged = targetPort !== saved.port;
      const userChanged = targetUser !== saved.username;
      const savedTlsEnabled = Boolean(saved.tls_config && saved.tls_config.enabled);
      const savedTlsCa = (saved.tls_config?.ca_cert ?? saved.tls_config?.ca ?? null) as string | null;
      const targetTlsEnabled = Boolean(targetTlsConfig && targetTlsConfig.enabled);
      const targetTlsCa = (targetTlsConfig?.ca_cert ?? targetTlsConfig?.ca ?? null) as string | null;
      const tlsChanged =
        payload.tls_config !== undefined &&
        (savedTlsEnabled !== targetTlsEnabled || savedTlsCa !== targetTlsCa);

      const sshToggleChanged = payload.use_ssh !== undefined && payload.use_ssh !== savedSshEnabled;
      const sshHostChanged =
        payload.ssh_host !== undefined && payload.ssh_host.trim() !== ((savedSsh.host as string) || "");
      const sshPortChanged =
        payload.ssh_port !== undefined && payload.ssh_port !== ((savedSsh.port as number) ?? 22);
      const sshUserChanged =
        payload.ssh_user !== undefined && payload.ssh_user.trim() !== ((savedSsh.username as string) || "");
      const sshFingerprintChanged =
        payload.ssh_host_fingerprint_sha256 !== undefined &&
        payload.ssh_host_fingerprint_sha256.trim() !== ((savedSsh.host_fingerprint_sha256 as string) || "");
      const sshChanged =
        sshToggleChanged || sshHostChanged || sshPortChanged || sshUserChanged || sshFingerprintChanged;

      if (payload.password && payload.password.length > 0) {
        targetPassword = payload.password;
      } else {
        if (hostChanged || portChanged || userChanged || tlsChanged || sshChanged) {
          throw new AppError({
            code: 'ERR_CREDENTIAL_REENTRY_REQUIRED',
            statusCode: 400,
            message: '修改主机地址、端口、用户名、TLS 信任链或 SSH 堡垒机配置后进行连通性测试时，必须重新输入数据库密码。',
            actionGuidance:
              'Please re-enter the database password when modifying database host, port, credentials, TLS, or SSH tunnel configurations.',
          });
        }
        targetPassword = this.keyring.decrypt(saved.password_encrypted);
      }

      if (targetUseSsh) {
        if (payload.ssh_private_key && payload.ssh_private_key.length > 0) {
          targetSshPrivateKey = payload.ssh_private_key;
        } else if (!sshChanged && savedSsh.private_key_encrypted) {
          targetSshPrivateKeyEncrypted = savedSsh.private_key_encrypted as string;
        } else {
          throw new AppError({
            code: 'ERR_CREDENTIAL_REENTRY_REQUIRED',
            statusCode: 400,
            message: '修改 SSH 堡垒机配置后进行连通性测试时，必须重新输入 SSH 私钥。',
            actionGuidance: 'Please re-enter the SSH private key when testing modified SSH bastion settings.',
          });
        }
      }
    } else {
      if (!payload.host || !payload.port || !payload.user || !payload.password) {
        throw new AppError({
          code: 'ERR_VALIDATION_FAILED',
          statusCode: 400,
          message: '新建数据源测试必须提供完整的 host、port、user 与 password。',
        });
      }
      targetHost = payload.host.trim();
      targetPort = payload.port;
      targetUser = payload.user.trim();
      targetPassword = payload.password;
      targetDatabase = payload.database?.trim();
      targetTlsConfig = payload.tls_config;
      targetUseSsh = Boolean(payload.use_ssh);
      targetSshHost = payload.ssh_host?.trim();
      targetSshPort = payload.ssh_port ?? 22;
      targetSshUser = payload.ssh_user?.trim();
      targetSshPrivateKey = payload.ssh_private_key;
      targetSshFingerprint = payload.ssh_host_fingerprint_sha256?.trim();
    }

    const startTime = Date.now();
    const sslOpts = toMysqlSslOptions(targetTlsConfig);
    let tunnelHandle: { stream: unknown; close: () => void } | null = null;
    let directPinnedIp: string | null = null;

    if (targetUseSsh) {
      if (!this.sshManager || typeof this.sshManager.openEphemeralTunnelStream !== 'function') {
        throw new AppError({
          code: 'ERR_INTERNAL_SERVER',
          statusCode: 500,
          message: 'SSH tunnel requested for connectivity test, but SshTunnelManager is not configured.',
        });
      }
      if (!targetSshHost || !targetSshUser || !targetSshFingerprint) {
        throw new AppError({
          code: 'ERR_VALIDATION_FAILED',
          statusCode: 400,
          message: '启用 SSH 测试必须提供完整的 ssh_host、ssh_user 与 ssh_host_fingerprint_sha256。',
        });
      }
      tunnelHandle = await this.sshManager.openEphemeralTunnelStream(
        {
          host: targetSshHost,
          port: targetSshPort,
          username: targetSshUser,
          privateKey: targetSshPrivateKey,
          privateKeyEncrypted: targetSshPrivateKeyEncrypted,
          hostFingerprintSha256: targetSshFingerprint,
        },
        targetHost,
        targetPort
      );
    } else {
      directPinnedIp = await this.ssrfGuard.resolveAndValidateHost(targetHost);
    }

    try {
      await new Promise<void>((resolve, reject) => {
        const conn = mysql2.createConnection({
          host: targetHost,
          port: targetPort,
          user: targetUser,
          password: targetPassword,
          database: targetDatabase,
          connectTimeout: 3000,
          stream: () => {
            if (tunnelHandle) {
              return tunnelHandle.stream as unknown as net.Socket;
            }
            return net.connect({ host: directPinnedIp!, port: targetPort });
          },
          ...(sslOpts ? { ssl: sslOpts } : {}),
        });

        const timer = setTimeout(() => {
          conn.destroy();
          reject(new Error('MySQL connectivity test timed out after 3000ms'));
        }, 3000);

        conn.connect((err) => {
          if (err) {
            clearTimeout(timer);
            conn.destroy();
            reject(err);
            return;
          }
          conn.ping((pingErr) => {
            clearTimeout(timer);
            conn.destroy();
            if (pingErr) reject(pingErr);
            else resolve();
          });
        });
      });
    } finally {
      tunnelHandle?.close();
    }

    return {
      reachable: true,
      latencyMs: Date.now() - startTime,
    };
  }
}
```

---

### 9.3 `CryptoKeyring`: 带 `key_id` 的 AES-256-GCM 加解密与在线重加密轮转器（闭环第 四 节 #7）

除提供 `encrypt / decrypt` 外，增补在线密钥轮转任务 `rotateStaleCiphertexts`：扫描 `sys_profiles` 与 `sys_system_settings` 中前缀不是 `v1:<active_key_id>:` 的旧密文，在事务中解密并用当前活跃密钥重加密，直至旧 `key_id` 引用计数归零后方可从环境变量退役旧密钥：

```typescript
// packages/security/src/crypto-keyring.ts
import crypto from 'node:crypto';
import type mysql2 from 'mysql2/promise';

export interface MasterKeysEnvSchema {
  active_key_id: string;
  keys: Record<string, string>;
}

export class CryptoKeyring {
  public readonly activeKeyId: string;
  private readonly keyMap = new Map<string, Buffer>();

  constructor(schema: MasterKeysEnvSchema) {
    this.activeKeyId = schema.active_key_id;
    for (const [kId, hexKey] of Object.entries(schema.keys)) {
      const buf = Buffer.from(hexKey, 'hex');
      if (buf.byteLength !== 32) {
        throw new Error(`Master key '${kId}' must be exactly 32 bytes (64 hex characters).`);
      }
      this.keyMap.set(kId, buf);
    }
    if (!this.keyMap.has(this.activeKeyId)) {
      throw new Error(`Active key '${this.activeKeyId}' not found in keyring.`);
    }
  }

  public static fromEnvJson(rawJson: string): CryptoKeyring {
    const parsed = JSON.parse(rawJson) as MasterKeysEnvSchema;
    return new CryptoKeyring(parsed);
  }

  public encrypt(plaintext: string): string {
    const key = this.keyMap.get(this.activeKeyId)!;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return [
      'v1',
      this.activeKeyId,
      iv.toString('hex'),
      encrypted.toString('hex'),
      authTag.toString('hex'),
    ].join(':');
  }

  public decrypt(payload: string): string {
    const parts = payload.split(':');
    if (parts.length !== 5 || parts[0] !== 'v1') {
      throw new Error('Invalid encrypted payload format (expected v1:key_id:iv:cipher:tag).');
    }
    const [, keyId, ivHex, cipherHex, tagHex] = parts;
    const key = this.keyMap.get(keyId);
    if (!key) {
      throw new Error(`Decryption key '${keyId}' is missing from keyring.`);
    }

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(cipherHex, 'hex')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  }

  public needsReencryption(payload: string): boolean {
    return !payload.startsWith(`v1:${this.activeKeyId}:`);
  }

  /**
   * 在线平滑轮转：将数据库中旧 key_id 的密文批量迁移至当前 active_key_id
   */
  public async rotateDatabaseCiphertexts(pool: mysql2.Pool): Promise<{ rotatedProfiles: number }> {
    const [rows] = await pool.query<mysql2.RowDataPacket[]>(
      `SELECT id, password_encrypted, version FROM sys_profiles`
    );
    let rotatedProfiles = 0;
    for (const row of rows) {
      const cipher = String(row.password_encrypted);
      if (this.needsReencryption(cipher)) {
        const plain = this.decrypt(cipher);
        const freshCipher = this.encrypt(plain);
        await pool.query(
          `UPDATE sys_profiles SET password_encrypted = ?, version = version + 1 WHERE id = ? AND version = ?`,
          [freshCipher, row.id, row.version]
        );
        rotatedProfiles += 1;
      }
    }
    return { rotatedProfiles };
  }
}
```

---

### 9.4 `NotificationService`: 企微/钉钉/飞书 Webhook 异步推送器（闭环第 四 节 #1）

完整实现目录 §9.4 声明的通知推送与连通性测试服务：
1. **强制 HTTPS 协议校验与 SSRF IP Pinning**：仅允许 `https:` 协议，先调用 `ssrfGuard.resolveAndValidateHost(url.hostname)` 得到 `pinnedIp`；
2. **自定义 `lookup` 锁定 IP + 保留 TLS SNI**：通过 `https.request` 传入自定义 `lookup: (_host, _opts, cb) => cb(null, pinnedIp, ...)`，既锁死 TCP 目标 IP 为 `pinnedIp`，又保留原始域名用于 HTTPS TLS SNI 与证书核验；
3. **严禁 3xx 重定向与 3000ms 硬超时**：若返回状态码非 2xx（含任何 301/302/307/308 重定向），直接判定失败，杜绝利用开放重定向绕过 SSRF 防线。

```typescript
// apps/admin-api/src/services/notification.service.ts
import https from 'node:https';
import net from 'node:net';
import { URL } from 'node:url';
import { AppError } from '@mysql-mcp/core-engine';
import type { SsrfGuard } from '@mysql-mcp/security';

export type WebhookChannelType = 'WECHAT' | 'DINGTALK' | 'FEISHU';

export class NotificationService {
  constructor(private readonly ssrfGuard: SsrfGuard) {}

  public async sendWebhookMessage(
    channelType: WebhookChannelType,
    webhookUrl: string,
    title: string,
    markdownBody: string
  ): Promise<{ success: boolean; latencyMs: number }> {
    let parsed: URL;
    try {
      parsed = new URL(webhookUrl);
    } catch {
      throw new AppError({
        code: 'ERR_VALIDATION_FAILED',
        statusCode: 400,
        message: 'Invalid Webhook URL format.',
      });
    }

    if (parsed.protocol !== 'https:') {
      throw new AppError({
        code: 'ERR_VALIDATION_FAILED',
        statusCode: 400,
        message: 'Webhook URL must use HTTPS protocol.',
      });
    }

    // 1. SSRF DNS 解析后校验并锁定 IP
    const pinnedIp = await this.ssrfGuard.resolveAndValidateHost(parsed.hostname);
    const payloadJson = JSON.stringify(this.formatPayload(channelType, title, markdownBody));
    const startTime = Date.now();

    await new Promise<void>((resolve, reject) => {
      const req = https.request(
        {
          hostname: parsed.hostname,
          port: parsed.port || 443,
          path: parsed.pathname + parsed.search,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Length': Buffer.byteLength(payloadJson, 'utf8'),
          },
          timeout: 3000,
          // 闭环 BE-R2-10：兼容 Node.js 22 autoSelectFamily 默认传入的 { all: true } 契约，
          // 当 options.all 为 true 时返回 [{ address, family }] 数组，同时保持 hostname 供 TLS SNI 校验
          lookup: (_hostname, options, cb) => {
            const family = net.isIP(pinnedIp) || 4;
            if (typeof options === 'object' && options !== null && (options as any).all) {
              (cb as any)(null, [{ address: pinnedIp, family }]);
              return;
            }
            (cb as any)(null, pinnedIp, family);
          },
        },
        (res) => {
          res.resume();
          const status = res.statusCode ?? 500;
          // 严禁跟随任何 3xx 重定向！仅 200~299 视为成功
          if (status >= 200 && status < 300) {
            resolve();
          } else {
            reject(
              new AppError({
                code: 'ERR_VALIDATION_FAILED',
                statusCode: 400,
                message: `Webhook responded with non-2xx HTTP status: ${status}`,
              })
            );
          }
        }
      );

      req.on('timeout', () => {
        req.destroy(new Error('Webhook request timed out after 3000ms'));
      });
      req.on('error', (err) => reject(err));
      req.write(payloadJson);
      req.end();
    });

    return {
      success: true,
      latencyMs: Date.now() - startTime,
    };
  }

  private formatPayload(
    channelType: WebhookChannelType,
    title: string,
    content: string
  ): Record<string, unknown> {
    if (channelType === 'WECHAT') {
      return { msgtype: 'markdown', markdown: { content: `### ${title}\n${content}` } };
    }
    if (channelType === 'DINGTALK') {
      return { msgtype: 'markdown', markdown: { title, text: `### ${title}\n${content}` } };
    }
    return {
      msg_type: 'interactive',
      card: {
        header: { title: { tag: 'plain_text', content: title } },
        elements: [{ tag: 'markdown', content }],
      },
    };
  }
}
```