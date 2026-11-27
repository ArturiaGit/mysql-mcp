import type { UserListItemDTO } from '@mysql-mcp/shared-types';
import { useEffect, useState, type FormEvent } from 'react';
import { isApiClientError } from '@/api/client';
import { deleteUserAccount } from '@/api/user-administration';
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
import type { GuardrailViolationInfo } from './guardrail-error-modal';

export interface DeleteUserModalProps {
  target: UserListItemDTO | null;
  onClose: () => void;
  onDeleted: (user: UserListItemDTO) => void;
  onGuardrailViolation: (violation: GuardrailViolationInfo) => void;
}

export function DeleteUserModal({
  target,
  onClose,
  onDeleted,
  onGuardrailViolation,
}: DeleteUserModalProps) {
  const [confirmInput, setConfirmInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<{
    code?: string;
    message: string;
    guidance: string;
  } | null>(null);

  useEffect(() => {
    if (target) {
      setConfirmInput('');
      setSubmitting(false);
      setServerError(null);
    }
  }, [target]);

  const matched = Boolean(target && confirmInput.trim() === target.username);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!target || !matched || submitting) return;

    setSubmitting(true);
    setServerError(null);

    try {
      await deleteUserAccount(target.id);
      onDeleted(target);
      onClose();
    } catch (error: unknown) {
      if (isApiClientError(error)) {
        if (
          error.code === 'ERR_LAST_SUPER_ADMIN' ||
          error.code === 'ERR_SELF_ACTION_PROHIBITED'
        ) {
          onClose();
          onGuardrailViolation({
            code: error.code,
            message: error.message,
            guidance: error.actionGuidance,
            username: target.username,
          });
        } else {
          setServerError({
            code: error.code,
            message: error.message,
            guidance: error.actionGuidance,
          });
        }
      } else {
        setServerError({
          message: '删除用户请求未能完成。',
          guidance: '请检查网络连接或稍后重试。',
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={Boolean(target)}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !submitting) {
          onClose();
        }
      }}
      onBeforeClose={() => !submitting}
      ariaLabelledBy="delete-user-dialog-title"
      ariaDescribedBy="delete-user-dialog-desc"
      className="w-[min(500px,calc(100vw-32px))]"
    >
      {target && (
        <form
          onSubmit={(event) => void handleSubmit(event)}
          noValidate
          data-testid="delete-user-modal"
        >
          <DialogHeader>
            <div>
              <DialogTitle id="delete-user-dialog-title">永久删除用户账号</DialogTitle>
              <DialogDescription id="delete-user-dialog-desc">
                此操作不可撤销，请仔细核对目标用户{' '}
                <span className="font-mono text-fg-main">{target.username}</span> (ID{' '}
                <span className="font-mono tabular-nums">{target.id}</span>)。
              </DialogDescription>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="关闭删除确认窗口"
              disabled={submitting}
              onClick={onClose}
            >
              <Icon name="x" className="size-4" />
            </Button>
          </DialogHeader>

          <DialogBody className="space-y-4">
            <Alert variant="danger">
              物理删除将级联清除该用户账号、角色绑定、名下全部 PAT 个人访问令牌及 USER 级限流覆盖配置，并以{' '}
              <code className="font-mono text-[11px]">USER_DELETED</code> 立即中断该用户在途 SQL 查询。
            </Alert>

            {serverError && (
              <Alert variant="danger" role="alert" data-testid="delete-user-server-error">
                <div className="font-medium">
                  {serverError.message}
                  {serverError.code && (
                    <span className="ml-1.5 font-mono text-[11px]">({serverError.code})</span>
                  )}
                </div>
                <div className="mt-0.5 text-fg-muted">{serverError.guidance}</div>
              </Alert>
            )}

            <Field>
              <FieldLabel htmlFor="delete-user-confirm-input" required>
                请输入目标用户名 <code className="font-mono text-fg-main">{target.username}</code>{' '}
                以确认删除
              </FieldLabel>
              <Input
                id="delete-user-confirm-input"
                data-testid="delete-user-confirm-input"
                autoComplete="off"
                spellCheck={false}
                placeholder={target.username}
                value={confirmInput}
                disabled={submitting}
                className="font-mono"
                onChange={(event) => setConfirmInput(event.target.value)}
              />
            </Field>
          </DialogBody>

          <DialogFooter>
            <Button variant="outline" size="sm" disabled={submitting} onClick={onClose}>
              取消
            </Button>
            <Button
              type="submit"
              variant="destructive"
              size="sm"
              disabled={!matched || submitting}
              data-testid="delete-user-confirm-btn"
            >
              {submitting ? (
                <>
                  <Icon name="loader" className="size-3.5 animate-spin" />
                  <span>正在删除…</span>
                </>
              ) : (
                <>
                  <Icon name="trash" className="size-3.5" />
                  <span>确认永久删除</span>
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      )}
    </Dialog>
  );
}
