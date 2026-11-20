import { hashPassword, type CryptoKeyring } from '@mysql-mcp/security';
import { createMetadataQueryExecutor, withMetadataTransaction, type MetadataPool, type MetadataRow, type MetadataQueryExecutor } from '@mysql-mcp/core-engine';
import { z } from 'zod';
import { hasStrongPassword } from './auth-domain.js';

const businessTables = [
  'sys_users', 'sys_roles', 'sys_user_roles', 'sys_user_approvals', 'sys_pats', 'sys_profiles', 'sys_role_profiles',
  'sys_role_database_acls', 'sys_role_table_acls', 'sys_rate_limits', 'sys_audit_logs',
  'sys_anonymous_security_logs', 'sys_rate_limit_revisions',
] as const;
// PROVISIONAL (RD-08 #1): seed new databases only. Existing limits are preserved.
const initialGlobalBurstCapacity = 10;
const roles = [
  ['SUPER_ADMIN', '超级管理员', 100, 1000, 30_000, -1, 10],
  ['SECURITY_ADMIN', '安全管理员', 100, 1000, 20_000, 120, 5],
  ['DBA', '数据库管理员', 100, 1000, 30_000, 120, 8],
  ['ANALYST', '数据分析师', 50, 500, 15_000, 60, 5],
  ['DEVELOPER', '业务研发人员', 50, 500, 15_000, 60, 5],
] as const;
const channelType = z.enum(['FEISHU', 'DINGTALK', 'WECHAT']);
const notificationSettings = z.object({ schemaVersion: z.literal(1), channels: z.array(z.object({
  channelType, enabled: z.boolean(), webhookUrl: z.string(), secret: z.string().nullable(), alertEvents: z.array(z.string()),
})) });

export interface BootstrapCredentials { username: string; password: string; email?: string | null; }
interface SettingRow extends MetadataRow { setting_value: string; is_encrypted: number; }

export class BootstrapService {
  private readonly db: MetadataQueryExecutor;

  constructor(private readonly pool: MetadataPool, private readonly keyring: CryptoKeyring) {
    this.db = createMetadataQueryExecutor(pool);
  }

  async initialize(credentials?: BootstrapCredentials): Promise<void> {
    const marker = await this.marker(this.db);
    if (marker === 'READY') {
      await this.assertReady(this.db);
      return;
    }
    if (marker !== 'PENDING' || !credentials || !/^[A-Za-z0-9_-]{3,64}$/.test(credentials.username) ||
        !hasStrongPassword(credentials.password) || !z.email().max(128).nullable().safeParse(credentials.email ?? null).success) {
      throw new Error('Metadata bootstrap requires a valid marker and initial administrator configuration');
    }
    const hash = await hashPassword(credentials.password);
    await withMetadataTransaction(this.pool, async (db) => {
      const state = await this.marker(db, true);
      if (state === 'READY') { await this.assertReady(db); return; }
      if (state !== 'PENDING') throw new Error('Invalid metadata bootstrap marker');
      for (const table of businessTables) {
        const [rows] = await db.query(`SELECT 1 FROM ${table} LIMIT 1`);
        if (rows.length > 0) throw new Error('PENDING metadata database contains business data');
      }
      const [settings] = await db.query('SELECT 1 FROM sys_system_settings WHERE setting_key <> ? LIMIT 1', ['bootstrap_state']);
      if (settings.length > 0) throw new Error('PENDING metadata database contains settings');
      for (const [role, display, defaultLimit, maxLimit, timeout, qpm, inflight] of roles) {
        await db.query(
          'INSERT INTO sys_roles (role_name, display_name, is_builtin, default_limit, max_limit, max_timeout_ms, user_qpm_limit, max_inflight_concurrency) VALUES (?, ?, 1, ?, ?, ?, ?, ?)',
          [role, display, defaultLimit, maxLimit, timeout, qpm, inflight],
        );
      }
      await db.query("INSERT INTO sys_rate_limits (scope_type, scope_id, qpm_limit, burst_capacity, loop_breaker_threshold, loop_breaker_window_sec, revision, version) VALUES ('GLOBAL', 0, 60, ?, 3, 30, 0, 1)", [initialGlobalBurstCapacity]);
      const channels = channelType.options.map(type => ({ channelType: type, enabled: false, webhookUrl: '', secret: null, alertEvents: [] }));
      await db.query('INSERT INTO sys_system_settings (setting_key, setting_value, is_encrypted) VALUES (?, ?, 1)',
        ['notification_channels', this.keyring.encrypt(JSON.stringify({ schemaVersion: 1, channels }))]);
      await db.query("INSERT INTO sys_users (username, password_hash, email, status, must_change_password) VALUES (?, ?, ?, 'ACTIVE', 1)",
        [credentials.username, hash, credentials.email ?? null]);
      const [[inserted]] = await db.query<(MetadataRow & { id: string })[]>('SELECT CAST(LAST_INSERT_ID() AS CHAR) AS id');
      if (!inserted) throw new Error('Missing initial administrator ID');
      await db.query('INSERT INTO sys_user_roles (user_id, role_id) SELECT ?, id FROM sys_roles WHERE role_name = ?', [inserted.id, 'SUPER_ADMIN']);
      await db.query("INSERT INTO sys_user_approvals (user_id, action, reason, operator_id, target_type, target_id, decided_at) VALUES (?, 'CONFIG_UPDATE', 'System bootstrap initial super-admin', 0, 'USER', ?, UTC_TIMESTAMP(3))", [inserted.id, inserted.id]);
      await db.query('UPDATE sys_system_settings SET setting_value = ?, version = version + 1 WHERE setting_key = ? AND setting_value = ?', ['READY', 'bootstrap_state', 'PENDING']);
    });
  }

  async isReady(): Promise<boolean> {
    try {
      if (await this.marker(this.db) !== 'READY') return false;
      await this.assertReady(this.db);
      return true;
    } catch { return false; }
  }

  private async marker(db: MetadataQueryExecutor, lock = false) {
    const [[row]] = await db.query<SettingRow[]>(
      `SELECT setting_value, is_encrypted FROM sys_system_settings WHERE setting_key = ?${lock ? ' FOR UPDATE' : ''}`, ['bootstrap_state'],
    );
    return row?.is_encrypted === 0 ? row.setting_value : undefined;
  }

  private async assertReady(db: MetadataQueryExecutor): Promise<void> {
    const [admins] = await db.query("SELECT 1 FROM sys_roles r JOIN sys_user_roles ur ON ur.role_id = r.id JOIN sys_users u ON u.id = ur.user_id WHERE r.role_name = 'SUPER_ADMIN' AND r.is_builtin = 1 AND u.status = 'ACTIVE' LIMIT 1");
    const [limits] = await db.query("SELECT 1 FROM sys_rate_limits WHERE scope_type = 'GLOBAL' AND scope_id = 0");
    const [[setting]] = await db.query<SettingRow[]>('SELECT setting_value, is_encrypted FROM sys_system_settings WHERE setting_key = ?', ['notification_channels']);
    if (admins.length !== 1 || limits.length !== 1 || setting?.is_encrypted !== 1) throw new Error('Metadata bootstrap requires manual recovery');
    const decoded: unknown = JSON.parse(this.keyring.decrypt(setting.setting_value));
    notificationSettings.parse(decoded);
  }
}
