import type { EntityId } from '@mysql-mcp/shared-types';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/form-controls';
import { Icon } from '@/components/ui/icon';
import { Sheet, SheetBody, SheetFooter, SheetHeader } from '@/components/ui/sheet';
import { copyToClipboard } from '@/lib/clipboard';
import { useToastStore } from '@/stores/useToastStore';

export type AuditLogStatus =
  | 'SUCCESS'
  | 'BLOCKED_AST'
  | 'BLOCKED_ACL'
  | 'BLOCKED_CONCURRENCY'
  | 'BLOCKED_RATE'
  | 'CANCELED'
  | 'FAILED_MYSQL'
  | 'TIMEOUT';

/**
 * Strictly aligns with physical columns of `sys_audit_logs`
 * (AGENTS.md §3.3 #10 & FRONTEND_ARCHITECTURE_SPEC.md §5.3).
 */
export interface AuditLogInspectRecord {
  id: EntityId;
  query_instance_id: string;
  session_id: string;
  created_at: string;
  client_ip: string;
  username: string;
  profile_name: string;
  sql_text: string;
  status: AuditLogStatus;
  latency_ms: number;
  rows_affected: number;
  error_message: string | null;
}

const STATUS_BADGE: Record<
  AuditLogStatus,
  { label: string; variant: NonNullable<BadgeProps['variant']> }
> = {
  SUCCESS: { label: 'SUCCESS', variant: 'safe' },
  BLOCKED_AST: { label: 'BLOCKED_AST', variant: 'danger' },
  BLOCKED_ACL: { label: 'BLOCKED_ACL', variant: 'danger' },
  BLOCKED_CONCURRENCY: { label: 'BLOCKED_CONCURRENCY', variant: 'warning' },
  BLOCKED_RATE: { label: 'BLOCKED_RATE', variant: 'warning' },
  CANCELED: { label: 'CANCELED', variant: 'neutral' },
  FAILED_MYSQL: { label: 'FAILED_MYSQL', variant: 'danger' },
  TIMEOUT: { label: 'TIMEOUT', variant: 'warning' },
};

export interface InspectSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  record: AuditLogInspectRecord | null;
  demoNotice?: string;
}

export function InspectSheet({
  open,
  onOpenChange,
  record,
  demoNotice,
}: InspectSheetProps) {
  const pushToast = useToastStore((state) => state.push);

  const handleCopySql = async () => {
    if (!record) return;
    const copied = await copyToClipboard(record.sql_text);
    pushToast(
      copied ? '已复制脱敏 SQL' : '无法访问剪贴板',
      copied ? `query_instance_id: ${record.query_instance_id}` : '请手动选中代码文本并复制。',
      copied ? 'safe' : 'warning',
    );
  };

  const handleCopyEventId = async () => {
    if (!record) return;
    const copied = await copyToClipboard(record.query_instance_id);
    pushToast(
      copied ? '已复制事件 ID' : '无法访问剪贴板',
      record.query_instance_id,
      copied ? 'safe' : 'warning',
    );
  };

  const statusMeta = record ? STATUS_BADGE[record.status] : null;
  const isSlow = record !== null && record.status === 'SUCCESS' && record.latency_ms >= 1000;

  return (
    <Sheet
      open={open && record !== null}
      onOpenChange={onOpenChange}
      ariaLabelledBy="inspect-sheet-title"
    >
      {record && statusMeta && (
        <div
          data-testid="inspect-sheet-content"
          className="flex h-full min-h-0 flex-col"
        >
          <SheetHeader>
            <div className="min-w-0">
              <div className="mb-1 flex items-center gap-1.5 font-mono text-[10px] tracking-[0.14em] text-primary uppercase">
                <span aria-hidden="true" className="size-1.5 rounded-[1px] bg-primary" />
                <span>AUDIT LOG INSPECTOR</span>
              </div>
              <h2
                id="inspect-sheet-title"
                className="text-[15px] leading-5 font-semibold text-fg-main"
              >
                审计流水详情
              </h2>
              <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[11px] text-fg-muted tabular-nums">
                <span>{record.query_instance_id}</span>
                <button
                  type="button"
                  onClick={() => void handleCopyEventId()}
                  className="inline-flex items-center gap-1 text-primary hover:underline cursor-pointer"
                  aria-label="复制 query_instance_id"
                >
                  <Icon name="copy" className="size-3" />
                  <span>复制 ID</span>
                </button>
              </div>
            </div>

            <Button
              variant="ghost"
              size="icon"
              aria-label="关闭审计详情抽屉"
              onClick={() => onOpenChange(false)}
            >
              <Icon name="x" className="size-4" />
            </Button>
          </SheetHeader>

          <SheetBody className="space-y-4">
            {/* Execution outcome badges */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={statusMeta.variant} mono>
                  {statusMeta.label}
                </Badge>
                {isSlow && (
                  <Badge variant="warning" mono>
                    {`SLOW: ${record.latency_ms.toLocaleString('en-US')}ms`}
                  </Badge>
                )}
              </div>
              <span className="font-mono text-[11px] text-fg-subtle tabular-nums">
                {record.created_at}
              </span>
            </div>

            {/* Physical metadata card */}
            <section aria-labelledby="inspect-meta-heading" className="rounded-md border border-border-line bg-bg-app p-3.5">
              <h3
                id="inspect-meta-heading"
                className="mb-3 text-xs font-semibold text-fg-main"
              >
                事件元数据 (sys_audit_logs)
              </h3>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                <div>
                  <dt className="text-[11px] text-fg-subtle">记录 ID (EntityId)</dt>
                  <dd className="mt-0.5 font-mono text-xs text-fg-main tabular-nums">
                    {record.id}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] text-fg-subtle">会话 ID (session_id)</dt>
                  <dd className="mt-0.5 break-all font-mono text-xs text-fg-main">
                    {record.session_id}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] text-fg-subtle">关联用户 (username)</dt>
                  <dd className="mt-0.5 text-xs font-medium text-fg-main">{record.username}</dd>
                </div>
                <div>
                  <dt className="text-[11px] text-fg-subtle">目标数据源 (profile_name)</dt>
                  <dd className="mt-0.5 font-mono text-xs text-fg-main">{record.profile_name}</dd>
                </div>
                <div>
                  <dt className="text-[11px] text-fg-subtle">客户端 IP (client_ip)</dt>
                  <dd className="mt-0.5 font-mono text-xs text-fg-main tabular-nums">
                    {record.client_ip}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] text-fg-subtle">执行耗时 / 影响行数</dt>
                  <dd className="mt-0.5 font-mono text-xs text-fg-main tabular-nums">
                    {`${record.latency_ms} ms · ${record.rows_affected} rows`}
                  </dd>
                </div>
              </dl>
            </section>

            {/* Desensitized SQL text */}
            <section aria-labelledby="inspect-sql-heading">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 id="inspect-sql-heading" className="text-xs font-semibold text-fg-main">
                  脱敏 SQL 文本 (sql_text)
                </h3>
                <span className="font-mono text-[10px] text-fg-subtle">READ-ONLY</span>
              </div>
              <div className="overflow-hidden rounded-md border border-border-line bg-bg-app">
                <pre
                  tabIndex={0}
                  className="max-h-56 overflow-auto p-3 font-mono text-xs leading-relaxed text-fg-main"
                >
                  {record.sql_text}
                </pre>
              </div>
            </section>

            {/* Error message (only when present in sys_audit_logs) */}
            {record.error_message && (
              <section aria-labelledby="inspect-err-heading">
                <h3 id="inspect-err-heading" className="mb-2 text-xs font-semibold text-fg-main">
                  异常与阻断说明 (error_message)
                </h3>
                <Alert variant={statusMeta.variant === 'warning' ? 'warning' : 'danger'}>
                  <span className="break-words font-mono text-xs">{record.error_message}</span>
                </Alert>
              </section>
            )}

            {demoNotice && <Alert variant="info">{demoNotice}</Alert>}
          </SheetBody>

          <SheetFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              关闭
            </Button>
            <Button variant="default" onClick={() => void handleCopySql()}>
              <Icon name="copy" className="size-3.5" />
              <span>复制脱敏 SQL</span>
            </Button>
          </SheetFooter>
        </div>
      )}
    </Sheet>
  );
}
