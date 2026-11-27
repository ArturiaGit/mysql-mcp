import type { PatListItemDTO } from '@mysql-mcp/shared-types';
import { useEffect, useRef, useState } from 'react';
import { isApiClientError } from '@/api/client';
import { revokePat } from '@/api/pats';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Alert, Field, FieldLabel, Input } from '@/components/ui/form-controls';
import { Icon } from '@/components/ui/icon';

export interface PatRevokeModalProps {
  target: PatListItemDTO | null;
  onClose: () => void;
  onRevoked: (pat: PatListItemDTO) => void;
}

const CONFIRM_KEYWORD = 'REVOKE';

export function PatRevokeModal({ target, onClose, onRevoked }: PatRevokeModalProps) {
  const [confirmText, setConfirmText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const cancelBtnRef = useRef<HTMLButtonElement>(null);

  const open = target !== null;

  useEffect(() => {
    if (open) {
      setConfirmText('');
      setSubmitting(false);
      setErrorMessage('');
      queueMicrotask(() => cancelBtnRef.current?.focus());
    }
  }, [open, target?.id]);

  const handleConfirm = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!target || submitting || confirmText !== CONFIRM_KEYWORD) {
      return;
    }

    setSubmitting(true);
    setErrorMessage('');

    try {
      await revokePat(target.id);
      setSubmitting(false);
      onRevoked(target);
      onClose();
    } catch (error: unknown) {
      setSubmitting(false);
      if (isApiClientError(error)) {
        setErrorMessage(
          `${error.message}${error.actionGuidance ? ` ${error.actionGuidance}` : ''}`,
        );
      } else {
        setErrorMessage('吊销请求失败，请检查网络后重试。');
      }
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !submitting) {
          onClose();
        }
      }}
      onBeforeClose={() => !submitting}
      ariaLabelledBy="pat-revoke-dialog-title"
      ariaDescribedBy="pat-revoke-dialog-desc"
      className="w-[min(460px,calc(100vw-32px))]"
    >
      <div data-testid="pat-revoke-modal">
        <DialogHeader>
          <div className="min-w-0">
            <DialogTitle id="pat-revoke-dialog-title">吊销个人访问令牌？</DialogTitle>
            <DialogDescription id="pat-revoke-dialog-desc">
              此操作不可逆，吊销后使用该令牌的 MCP 客户端将立即失去访问权限。
            </DialogDescription>
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="关闭吊销确认弹窗"
            disabled={submitting}
            onClick={onClose}
          >
            <Icon name="x" className="size-4" />
          </Button>
        </DialogHeader>

        <form onSubmit={(event) => void handleConfirm(event)} noValidate>
          <DialogBody className="space-y-3">
            {target && (
              <div className="rounded-md border border-border-line bg-bg-app px-3 py-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-fg-subtle">目标令牌</span>
                  <span className="font-medium text-fg-main" data-testid="revoke-target-name">
                    {target.name}
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <span className="text-fg-subtle">令牌前缀</span>
                  <span className="font-mono text-fg-muted">{target.token_prefix}…</span>
                </div>
              </div>
            )}

            <Alert variant="danger">
              吊销将立即写入审计日志并作废该令牌；如需继续接入 MCP 网关，必须重新签发新令牌。
            </Alert>

            {errorMessage && (
              <Alert variant="danger" data-testid="pat-revoke-error-alert">
                {errorMessage}
              </Alert>
            )}

            <Field>
              <FieldLabel htmlFor="pat-revoke-confirm-input" required>
                输入 <code className="font-mono text-fg-main">{CONFIRM_KEYWORD}</code> 以确认吊销
              </FieldLabel>
              <Input
                id="pat-revoke-confirm-input"
                data-testid="pat-revoke-confirm-input"
                className="font-mono"
                placeholder={CONFIRM_KEYWORD}
                autoComplete="off"
                spellCheck={false}
                disabled={submitting}
                value={confirmText}
                onChange={(event) => setConfirmText(event.target.value)}
              />
            </Field>
          </DialogBody>

          <DialogFooter>
            <Button
              ref={cancelBtnRef}
              variant="outline"
              disabled={submitting}
              onClick={onClose}
            >
              取消
            </Button>
            <Button
              type="submit"
              variant="destructive"
              data-testid="pat-revoke-confirm-btn"
              disabled={submitting || confirmText !== CONFIRM_KEYWORD}
            >
              <Icon
                name={submitting ? 'loader' : 'shield-ban'}
                className={submitting ? 'size-3.5 animate-spin' : 'size-3.5'}
              />
              <span>{submitting ? '正在吊销…' : '确认吊销令牌'}</span>
            </Button>
          </DialogFooter>
        </form>
      </div>
    </Dialog>
  );
}
