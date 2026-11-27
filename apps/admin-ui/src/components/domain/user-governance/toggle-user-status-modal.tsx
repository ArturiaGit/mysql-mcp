import type { ConflictErrorDetailsDTO, EntityId, UserListItemDTO } from '@mysql-mcp/shared-types';
import { useEffect, useState } from 'react';
import { isApiClientError } from '@/api/client';
import { buildUpdateUserStatusPayload } from '@/api/schemas/user-administration.schema';
import { updateUserStatus } from '@/api/user-administration';
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
import type { GuardrailViolationInfo } from './guardrail-error-modal';

export interface ToggleUserStatusModalProps {
  target: UserListItemDTO | null;
  onFetchLatestUser: (userId: EntityId, username: string) => Promise<UserListItemDTO | null>;
  onClose: () => void;
  onUpdated: (user: UserListItemDTO, nextStatus: 'ACTIVE' | 'DISABLED', nextVersion: number) => void;
  onGuardrailViolation: (violation: GuardrailViolationInfo) => void;
}

export function ToggleUserStatusModal({
  target,
  onFetchLatestUser,
  onClose,
  onUpdated,
  onGuardrailViolation,
}: ToggleUserStatusModalProps) {
  const [liveTarget, setLiveTarget] = useState<UserListItemDTO | null>(null);
  const [workingVersion, setWorkingVersion] = useState(1);
  const [conflict, setConflict] = useState<ConflictErrorDetailsDTO | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [serverError, setServerError] = useState<{
    code?: string;
    message: string;
    guidance: string;
  } | null>(null);

  useEffect(() => {
    if (target) {
      setLiveTarget(target);
      setWorkingVersion(target.version);
      setConflict(null);
      setSubmitting(false);
      setReloading(false);
      setServerError(null);
    }
  }, [target]);

  const effectiveTarget = liveTarget ?? target;
  const nextStatus: 'ACTIVE' | 'DISABLED' =
    effectiveTarget?.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
  const isDisabling = nextStatus === 'DISABLED';
  const statusAlreadyMatches =
    effectiveTarget !== null &&
    effectiveTarget.status !== 'ACTIVE' &&
    effectiveTarget.status !== 'DISABLED';

  const handleReloadVersion = async () => {
    if (!effectiveTarget || reloading) return;
    setReloading(true);
    setServerError(null);
    try {
      const latest = await onFetchLatestUser(effectiveTarget.id, effectiveTarget.username);
      if (!latest) {
        setServerError({
          code: 'ERR_NOT_FOUND',
          message: '目标用户记录已不存在。',
          guidance: '请关闭窗口并刷新用户列表。',
        });
        return;
      }
      setLiveTarget(latest);
      setWorkingVersion(latest.version);
      setConflict(null);
    } catch {
      setServerError({
        message: '加载最新版本失败。',
        guidance: '请稍后重试。',
      });
    } finally {
      setReloading(false);
    }
  };

  const handleConfirm = async () => {
    if (!effectiveTarget || submitting || reloading || statusAlreadyMatches) return;

    const checked = buildUpdateUserStatusPayload(nextStatus, workingVersion);
    if (!checked.payload) {
      setServerError({ message: checked.error, guidance: '请刷新页面后重试。' });
      return;
    }

    setSubmitting(true);
    setServerError(null);

    try {
      const res = await updateUserStatus(effectiveTarget.id, checked.payload);
      onUpdated(effectiveTarget, nextStatus, res.version);
      onClose();
    } catch (error: unknown) {
      if (isApiClientError(error)) {
        if (error.code === 'ERR_CONCURRENCY_CONFLICT') {
          setConflict(
            error.conflictDetails ?? {
              current_version: workingVersion + 1,
              submitted_version: workingVersion,
            },
          );
        } else if (
          error.code === 'ERR_LAST_SUPER_ADMIN' ||
          error.code === 'ERR_SELF_ACTION_PROHIBITED'
        ) {
          onClose();
          onGuardrailViolation({
            code: error.code,
            message: error.message,
            guidance: error.actionGuidance,
            username: effectiveTarget.username,
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
          message: '状态变更请求未能完成。',
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
        if (!nextOpen && !submitting && !reloading) {
          onClose();
        }
      }}
      onBeforeClose={() => !submitting && !reloading}
      ariaLabelledBy="toggle-status-dialog-title"
      ariaDescribedBy="toggle-status-dialog-desc"
      className="w-[min(500px,calc(100vw-32px))]"
    >
      {effectiveTarget && (
        <div data-testid="toggle-user-status-modal">
          <DialogHeader>
            <div>
              <DialogTitle id="toggle-status-dialog-title">
                {isDisabling ? '确认停用用户账号' : '确认解冻并恢复账号'}
              </DialogTitle>
              <DialogDescription id="toggle-status-dialog-desc">
                目标账号 <span className="font-mono text-fg-main">{effectiveTarget.username}</span>{' '}
                (ID <span className="font-mono tabular-nums">{effectiveTarget.id}</span>，版本{' '}
                <span className="font-mono text-fg-main tabular-nums">v{workingVersion}</span>)
              </DialogDescription>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="关闭账号状态变更窗口"
              disabled={submitting || reloading}
              onClick={onClose}
            >
              <Icon name="x" className="size-4" />
            </Button>
          </DialogHeader>

          <DialogBody className="space-y-3.5">
            <div className="flex items-center justify-between rounded-md border border-border-line bg-bg-surface/60 px-3 py-2.5 text-xs">
              <span className="text-fg-muted">状态流转方向</span>
              <div className="flex items-center gap-2">
                <Badge variant={effectiveTarget.status === 'ACTIVE' ? 'safe' : 'danger'} mono>
                  {effectiveTarget.status}
                </Badge>
                <Icon name="arrow-right" className="size-3.5 text-fg-subtle" />
                <Badge variant={isDisabling ? 'danger' : 'safe'} mono>
                  {nextStatus}
                </Badge>
              </div>
            </div>

            {isDisabling ? (
              <Alert variant="warning">
                停用后，该用户全部活跃 Web 会话将立即失效，数据面在途 SQL 将以{' '}
                <code className="font-mono text-[11px]">ACCOUNT_DISABLED</code> 原因立即中断，且无法再登录控制台或调用
                MCP 工具。
              </Alert>
            ) : (
              <Alert variant="safe">
                解冻后，账号将恢复为 <code className="font-mono text-[11px]">ACTIVE</code> 状态，并继续受既有角色权限与密码策略约束。
              </Alert>
            )}

            {conflict && (
              <Alert variant="warning" role="alert" data-testid="toggle-status-conflict-banner">
                <div className="space-y-2">
                  <div className="font-semibold">
                    版本冲突（ERR_CONCURRENCY_CONFLICT）
                  </div>
                  <p className="text-fg-muted tabular-nums">
                    提交版本 v{conflict.submitted_version} 与远端最新版本 v{conflict.current_version} 不一致。请刷新最新状态后再确认。
                  </p>
                  <Button
                    variant="default"
                    size="xs"
                    disabled={reloading}
                    onClick={() => void handleReloadVersion()}
                  >
                    <Icon
                      name={reloading ? 'loader' : 'refresh'}
                      className={reloading ? 'size-3 animate-spin' : 'size-3'}
                    />
                    <span>刷新最新版本</span>
                  </Button>
                </div>
              </Alert>
            )}

            {serverError && (
              <Alert variant="danger" role="alert" data-testid="toggle-status-server-error">
                <div className="font-medium">
                  {serverError.message}
                  {serverError.code && (
                    <span className="ml-1.5 font-mono text-[11px]">({serverError.code})</span>
                  )}
                </div>
                <div className="mt-0.5 text-fg-muted">{serverError.guidance}</div>
              </Alert>
            )}
          </DialogBody>

          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              disabled={submitting || reloading}
              onClick={onClose}
            >
              取消
            </Button>
            <Button
              variant={isDisabling ? 'destructive' : 'default'}
              size="sm"
              disabled={submitting || reloading || Boolean(conflict) || statusAlreadyMatches}
              data-testid="toggle-status-confirm-btn"
              onClick={() => void handleConfirm()}
            >
              {submitting ? (
                <>
                  <Icon name="loader" className="size-3.5 animate-spin" />
                  <span>正在提交变更…</span>
                </>
              ) : (
                <>
                  <Icon name={isDisabling ? 'user-x' : 'user-check'} className="size-3.5" />
                  <span>{isDisabling ? '确认停用账号' : '确认解冻账号'}</span>
                </>
              )}
            </Button>
          </DialogFooter>
        </div>
      )}
    </Dialog>
  );
}
