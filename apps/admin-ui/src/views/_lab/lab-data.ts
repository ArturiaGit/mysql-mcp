import type { AuditLogInspectRecord } from '@/layouts/InspectSheet';

export interface LabAuditRow extends AuditLogInspectRecord {
  initials: string;
  filterGroup: 'allowed' | 'blocked' | 'slow';
}

export const LAB_AUDIT_RECORDS: readonly LabAuditRow[] = [
  {
    id: '900719925474099306',
    query_instance_id: 'qi_demo_0006',
    session_id: 'sess_mcp_019a2f',
    created_at: '2026-11-19T14:32:08Z',
    client_ip: '10.24.18.42',
    username: 'chenmo',
    initials: 'CM',
    profile_name: 'production_readonly',
    sql_text: 'SELECT id, name FROM users LIMIT 100',
    status: 'SUCCESS',
    latency_ms: 24,
    rows_affected: 100,
    error_message: null,
    filterGroup: 'allowed',
  },
  {
    id: '900719925474099305',
    query_instance_id: 'qi_demo_0005',
    session_id: 'sess_mcp_019a2e',
    created_at: '2026-11-19T14:31:56Z',
    client_ip: '10.24.19.107',
    username: 'agent_07',
    initials: 'A7',
    profile_name: 'production_readonly',
    sql_text: 'SELECT SLEEP(10)',
    status: 'BLOCKED_AST',
    latency_ms: 0,
    rows_affected: 0,
    error_message:
      'ERR_AST_FORBIDDEN_SYNTAX: Disallowed function SLEEP() rejected by read-only AST firewall before database dispatch.',
    filterGroup: 'blocked',
  },
  {
    id: '900719925474099304',
    query_instance_id: 'qi_demo_0004',
    session_id: 'sess_mcp_019a2d',
    created_at: '2026-11-19T14:31:42Z',
    client_ip: '10.24.18.88',
    username: 'linqian',
    initials: 'LQ',
    profile_name: 'finance_readonly',
    sql_text: 'SELECT * FROM finance.salary_2026 LIMIT 50',
    status: 'BLOCKED_ACL',
    latency_ms: 0,
    rows_affected: 0,
    error_message:
      'ERR_AST_TABLE_DENIED: Target table finance.salary_2026 matched denylist rule finance.salary_*. Denylist overrides allowlist.',
    filterGroup: 'blocked',
  },
  {
    id: '900719925474099303',
    query_instance_id: 'qi_demo_0003',
    session_id: 'sess_mcp_019a2c',
    created_at: '2026-11-19T14:31:27Z',
    client_ip: '10.24.18.42',
    username: 'chenmo',
    initials: 'CM',
    profile_name: 'production_readonly',
    sql_text: 'SELECT order_id, amount FROM orders LIMIT 100',
    status: 'SUCCESS',
    latency_ms: 38,
    rows_affected: 100,
    error_message: null,
    filterGroup: 'allowed',
  },
  {
    id: '900719925474099302',
    query_instance_id: 'qi_demo_0002',
    session_id: 'sess_mcp_019a2b',
    created_at: '2026-11-19T14:30:59Z',
    client_ip: '10.24.20.15',
    username: 'databot',
    initials: 'DB',
    profile_name: 'analytics_readonly',
    sql_text: 'SELECT region, SUM(total) FROM sales GROUP BY region LIMIT 20',
    status: 'SUCCESS',
    latency_ms: 1286,
    rows_affected: 20,
    error_message: null,
    filterGroup: 'slow',
  },
  {
    id: '900719925474099301',
    query_instance_id: 'qi_demo_0001',
    session_id: 'sess_mcp_019a2a',
    created_at: '2026-11-19T14:30:41Z',
    client_ip: '10.24.18.88',
    username: 'linqian',
    initials: 'LQ',
    profile_name: 'production_readonly',
    sql_text:
      'WITH recent AS (SELECT id FROM orders LIMIT 50) SELECT * FROM recent LIMIT 50',
    status: 'SUCCESS',
    latency_ms: 16,
    rows_affected: 50,
    error_message: null,
    filterGroup: 'allowed',
  },
] as const;

export interface ColorSwatchMeta {
  cssVar: string;
  label: string;
  tokenName: string;
}

export const LAB_COLOR_SWATCHES: readonly ColorSwatchMeta[] = [
  { cssVar: '--color-primary', label: '主色', tokenName: 'primary' },
  { cssVar: '--color-safe', label: '安全', tokenName: 'safe' },
  { cssVar: '--color-warning', label: '预警', tokenName: 'warning' },
  { cssVar: '--color-danger', label: '阻断', tokenName: 'danger' },
  { cssVar: '--color-secret', label: '凭据', tokenName: 'secret' },
  { cssVar: '--color-fg-muted', label: '中性', tokenName: 'fg-muted' },
] as const;
