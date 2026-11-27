import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Alert } from '@/components/ui/form-controls';
import { Icon } from '@/components/ui/icon';

export interface GuardrailViolationInfo {
  code: 'ERR_LAST_SUPER_ADMIN' | 'ERR_SELF_ACTION_PROHIBITED';
  message: string;
  guidance: string;
  username?: string;
}

export interface GuardrailErrorModalProps {
  violation: GuardrailViolationInfo | null;
  onClose: () => void;
}

export function GuardrailErrorModal({ violation, onClose }: GuardrailErrorModalProps) {
  const isLastSuperAdmin = violation?.code === 'ERR_LAST_SUPER_ADMIN';

  return (
    <Dialog
      open={Boolean(violation)}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
      ariaLabelledBy="guardrail-error-title"
      ariaDescribedBy="guardrail-error-desc"
      className="w-[min(500px,calc(100vw-32px))]"
    >
      {violation && (
        <div data-testid="guardrail-error-modal">
          <DialogHeader>
            <div>
              <div className="mb-1.5 flex items-center gap-2">
                <Badge variant="danger" mono>
                  {violation.code}
                </Badge>
              </div>
              <DialogTitle id="guardrail-error-title">
                {isLastSuperAdmin ? '已触发最后超管防自残保护' : '已触发本人账号操作保护'}
              </DialogTitle>
              <DialogDescription id="guardrail-error-desc">
                后端事务锁校验已拦截本次变更，系统已自动刷新最新用户状态列表。
              </DialogDescription>
            </div>
            <Button variant="ghost" size="icon-sm" aria-label="关闭保护提示" onClick={onClose}>
              <Icon name="x" className="size-4" />
            </Button>
          </DialogHeader>

          <DialogBody className="space-y-3">
            <Alert variant="danger" icon="shield-alert">
              <div className="font-semibold">{violation.message}</div>
              <div className="mt-1 text-fg-muted">{violation.guidance}</div>
            </Alert>
            <div className="rounded-md border border-border-line bg-bg-surface/60 px-3 py-2.5 text-xs text-fg-muted">
              {isLastSuperAdmin ? (
                <p>
                  安全规则：MySQL MCP 网关要求任意时刻至少保留 <span className="font-mono text-fg-main tabular-nums">1</span>{' '}
                  名处于 <span className="font-mono text-fg-main">ACTIVE</span> 状态的{' '}
                  <span className="font-mono text-fg-main">SUPER_ADMIN</span>，以防管控面永久锁死。请先为其他活跃管理员授予超管角色后再操作
                  {violation.username ? `「${violation.username}」` : ''}。
                </p>
              ) : (
                <p>
                  安全规则：无论系统中存在多少名其他超级管理员，均禁止对当前登录账号自身执行停用、删除或移除自身{' '}
                  <span className="font-mono text-fg-main">SUPER_ADMIN</span> 角色操作。
                </p>
              )}
            </div>
          </DialogBody>

          <DialogFooter>
            <Button variant="default" size="sm" data-testid="guardrail-error-ok-btn" onClick={onClose}>
              我已了解
            </Button>
          </DialogFooter>
        </div>
      )}
    </Dialog>
  );
}
