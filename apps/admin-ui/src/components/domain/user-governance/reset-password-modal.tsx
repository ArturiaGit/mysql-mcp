import type { EntityId, UserListItemDTO } from '@mysql-mcp/shared-types';
import { useEffect, useState, type FormEvent } from 'react';
import { isApiClientError } from '@/api/client';
import { validateResetPasswordDraft } from '@/api/schemas/user-administration.schema';
import { resetUserPassword } from '@/api/user-administration';
import { PasswordStrengthPanel } from '@/components/auth/PasswordStrengthPanel';
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
import {
  Alert,
  Checkbox,
  Field,
  FieldError,
  FieldHint,
  FieldLabel,
  Input,
} from '@/components/ui/form-controls';
import { Icon } from '@/components/ui/icon';
import { copyToClipboard } from '@/lib/clipboard';
import { cn } from '@/lib/cn';
import {
  applyLatestVersionPreservingResetDraft,
  createInitialResetPasswordState,
  enterResetPasswordReveal,
  recordResetPasswordConflict,
  wipeResetPasswordSecrets,
  type ResetPasswordModalState,
} from './governance-modal-state';

export interface ResetPasswordModalProps {
  target: UserListItemDTO | null;
  onFetchLatestUser: (userId: EntityId, username: string) => Promise<UserListItemDTO | null>;
  onClose: () => void;
  onPasswordReset: (user: UserListItemDTO, nextVersion: number) => void;
}

export function ResetPasswordModal({
  target,
  onFetchLatestUser,
  onClose,
  onPasswordReset,
}: ResetPasswordModalProps) {
  const [state, setState] = useState<ResetPasswordModalState>(() =>
    createInitialResetPasswordState(1),
  );
  const [passwordError, setPasswordError] = useState('');
  const [serverError, setServerError] = useState<{
    code?: string;
    message: string;
    guidance: string;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [versionReloadedNotice, setVersionReloadedNotice] = useState(false);

  // Reset and wipe all in-memory temporary password material whenever target changes or closes
  useEffect(() => {
    if (target) {
      setState(createInitialResetPasswordState(target.version));
      setPasswordError('');
      setServerError(null);
      setSubmitting(false);
      setReloading(false);
      setVersionReloadedNotice(false);
    } else {
      setState(wipeResetPasswordSecrets(1));
    }

    return () => {
      setState(wipeResetPasswordSecrets(1));
    };
  }, [target]);

  const handleCloseAndWipe = () => {
    if (submitting || reloading) return;
    setState(wipeResetPasswordSecrets(1));
    setPasswordError('');
    setServerError(null);
    setVersionReloadedNotice(false);
    onClose();
  };

  const handleLoadLatestPreservingDraft = async () => {
    if (!target || reloading) return;
    setReloading(true);
    setServerError(null);
    try {
      const latest = await onFetchLatestUser(target.id, target.username);
      if (!latest) {
        setServerError({
          code: 'ERR_NOT_FOUND',
          message: '目标用户记录已不存在。',
          guidance: '请关闭窗口并刷新用户列表。',
        });
        return;
      }
      setState((prev) => applyLatestVersionPreservingResetDraft(prev, latest.version));
      setVersionReloadedNotice(true);
    } catch {
      setServerError({
        message: '加载最新版本号失败。',
        guidance: '请稍后重试。',
      });
    } finally {
      setReloading(false);
    }
  };

  const handleDiscardDraftAndReload = async () => {
    if (!target || reloading) return;
    setReloading(true);
    setServerError(null);
    setPasswordError('');
    setVersionReloadedNotice(false);
    try {
      const latest = await onFetchLatestUser(target.id, target.username);
      if (!latest) {
        setServerError({
          code: 'ERR_NOT_FOUND',
          message: '目标用户记录已不存在。',
          guidance: '请关闭窗口并刷新用户列表。',
        });
        return;
      }
      setState(createInitialResetPasswordState(latest.version));
    } catch {
      setServerError({
        message: '重置草稿并加载最新版本失败。',
        guidance: '请稍后重试。',
      });
    } finally {
      setReloading(false);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!target || submitting || reloading || state.phase !== 'form') return;

    const checked = validateResetPasswordDraft({
      mode: state.mode,
      manualPassword: state.manualPassword,
      mustChangePassword: state.mustChangePassword,
      version: state.workingVersion,
    });

    if (!checked.payload) {
      setPasswordError(checked.passwordError);
      return;
    }

    setPasswordError('');
    setServerError(null);
    setSubmitting(true);

    try {
      const response = await resetUserPassword(target.id, checked.payload);
      setState((prev) =>
        enterResetPasswordReveal(prev, response.temporaryPassword, response.version),
      );
      onPasswordReset(target, response.version);
    } catch (error: unknown) {
      if (isApiClientError(error)) {
        if (error.code === 'ERR_CONCURRENCY_CONFLICT') {
          setVersionReloadedNotice(false);
          setState((prev) => recordResetPasswordConflict(prev, error.conflictDetails));
        } else {
          setServerError({
            code: error.code,
            message: error.message,
            guidance: error.actionGuidance,
          });
        }
      } else {
        setServerError({
          message: '重置密码请求未能完成。',
          guidance: '请检查网络连接或稍后重试。',
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopyTemporaryPassword = async () => {
    if (!state.revealedPassword) return;
    const ok = await copyToClipboard(state.revealedPassword);
    if (ok) {
      setState((prev) => ({ ...prev, copied: true }));
    }
  };

  return (
    <Dialog
      open={Boolean(target)}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          handleCloseAndWipe();
        }
      }}
      onBeforeClose={() => !submitting && !reloading}
      ariaLabelledBy="reset-password-dialog-title"
      ariaDescribedBy="reset-password-dialog-desc"
      className="w-[min(560px,calc(100vw-32px))]"
    >
      {target && state.phase === 'form' && (
        <form
          onSubmit={(event) => void handleSubmit(event)}
          noValidate
          data-testid="reset-password-modal"
        >
          <DialogHeader>
            <div>
              <DialogTitle id="reset-password-dialog-title">
                重置用户登录密码 · <span className="font-mono">{target.username}</span>
              </DialogTitle>
              <DialogDescription id="reset-password-dialog-desc">
                提交后立即清退该用户全部 Web 会话并中断在途 SQL（保留名下 PAT 与 USER 限流配置；当前版本{' '}
                <span className="font-mono text-fg-main tabular-nums" data-testid="reset-password-working-version">
                  v{state.workingVersion}
                </span>
                ）。
              </DialogDescription>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="关闭重置密码窗口"
              disabled={submitting || reloading}
              onClick={handleCloseAndWipe}
            >
              <Icon name="x" className="size-4" />
            </Button>
          </DialogHeader>

          <DialogBody className="space-y-4">
            {/* 409 Optimistic Lock Conflict Banner — Preserves Password & Checkbox Draft */}
            {state.conflict && (
              <Alert variant="warning" role="alert" data-testid="reset-password-conflict-banner">
                <div className="space-y-2">
                  <div className="font-semibold">
                    检测到并发版本冲突（ERR_CONCURRENCY_CONFLICT）— 已完整保留您的密码与选项草稿
                  </div>
                  <p className="text-fg-muted tabular-nums">
                    提交版本{' '}
                    <span className="font-mono font-semibold text-fg-main">
                      v{state.conflict.submitted_version}
                    </span>{' '}
                    已过期，远端最新版本为{' '}
                    <span className="font-mono font-semibold text-fg-main">
                      v{state.conflict.current_version}
                    </span>
                    。可加载最新版本并保留当前密码草稿直接重试，或放弃草稿重载。
                  </p>
                  <div className="flex flex-wrap items-center gap-2 pt-0.5">
                    <Button
                      variant="default"
                      size="xs"
                      disabled={reloading}
                      data-testid="reset-password-load-latest-keep-draft-btn"
                      onClick={() => void handleLoadLatestPreservingDraft()}
                    >
                      <Icon
                        name={reloading ? 'loader' : 'refresh'}
                        className={reloading ? 'size-3 animate-spin' : 'size-3'}
                      />
                      <span>加载最新版本并保留草稿</span>
                    </Button>
                    <Button
                      variant="outline"
                      size="xs"
                      disabled={reloading}
                      data-testid="reset-password-discard-draft-btn"
                      onClick={() => void handleDiscardDraftAndReload()}
                    >
                      <span>放弃草稿并重载</span>
                    </Button>
                  </div>
                </div>
              </Alert>
            )}

            {versionReloadedNotice && !state.conflict && (
              <Alert variant="info" data-testid="reset-password-version-reloaded-notice">
                已更新至最新版本 <span className="font-mono tabular-nums">v{state.workingVersion}</span>
                ，您填写的临时密码和强制改密勾选草稿已完整保留，可直接提交。
              </Alert>
            )}

            {serverError && (
              <Alert variant="danger" role="alert" data-testid="reset-password-server-error">
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
              <FieldLabel>临时密码生成方式</FieldLabel>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  disabled={submitting || reloading}
                  data-testid="reset-mode-auto-btn"
                  onClick={() => {
                    setPasswordError('');
                    setState((prev) => ({ ...prev, mode: 'auto' }));
                  }}
                  className={cn(
                    'flex flex-col items-start rounded-md border px-3 py-2 text-left text-xs transition-colors cursor-pointer',
                    state.mode === 'auto'
                      ? 'border-primary/45 bg-primary-soft/60 text-fg-main'
                      : 'border-border-line bg-bg-app text-fg-muted hover:border-border-strong',
                  )}
                >
                  <span className="font-medium text-fg-main">服务端自动生成（推荐）</span>
                  <span className="mt-0.5 text-[11px] text-fg-muted">
                    由后端加密随机数生成 16 位高强度临时口令
                  </span>
                </button>
                <button
                  type="button"
                  disabled={submitting || reloading}
                  data-testid="reset-mode-manual-btn"
                  onClick={() => {
                    setPasswordError('');
                    setState((prev) => ({ ...prev, mode: 'manual' }));
                  }}
                  className={cn(
                    'flex flex-col items-start rounded-md border px-3 py-2 text-left text-xs transition-colors cursor-pointer',
                    state.mode === 'manual'
                      ? 'border-primary/45 bg-primary-soft/60 text-fg-main'
                      : 'border-border-line bg-bg-app text-fg-muted hover:border-border-strong',
                  )}
                >
                  <span className="font-medium text-fg-main">手动指定临时密码</span>
                  <span className="mt-0.5 text-[11px] text-fg-muted">
                    自定义符合强密码策略的 8~64 位口令
                  </span>
                </button>
              </div>
            </Field>

            {state.mode === 'manual' && (
              <Field invalid={Boolean(passwordError)}>
                <FieldLabel htmlFor="reset-manual-password-input" required>
                  自定义临时密码
                </FieldLabel>
                <div className="flex items-center gap-1.5">
                  <Input
                    id="reset-manual-password-input"
                    data-testid="reset-manual-password-input"
                    type={state.showManualPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    spellCheck={false}
                    placeholder="8~64 位，包含大小写字母、数字与特殊符号"
                    value={state.manualPassword}
                    disabled={submitting || reloading}
                    aria-invalid={passwordError ? 'true' : 'false'}
                    aria-describedby="reset-password-strength-panel reset-manual-password-error"
                    className="font-mono"
                    onChange={(event) => {
                      setPasswordError('');
                      setState((prev) => ({ ...prev, manualPassword: event.target.value }));
                    }}
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label={state.showManualPassword ? '隐藏临时密码' : '显示临时密码'}
                    disabled={submitting || reloading}
                    onClick={() =>
                      setState((prev) => ({
                        ...prev,
                        showManualPassword: !prev.showManualPassword,
                      }))
                    }
                  >
                    <Icon name={state.showManualPassword ? 'eye-off' : 'eye'} className="size-3.5" />
                  </Button>
                </div>
                <FieldError id="reset-manual-password-error" data-testid="reset-manual-password-error">
                  {passwordError}
                </FieldError>
                <PasswordStrengthPanel
                  id="reset-password-strength-panel"
                  password={state.manualPassword}
                />
              </Field>
            )}

            <div className="rounded-md border border-border-line bg-bg-surface/60 px-3 py-2.5">
              <Checkbox
                id="reset-must-change-checkbox"
                data-testid="reset-must-change-checkbox"
                checked={state.mustChangePassword}
                disabled={submitting || reloading}
                label="强制用户下次登录时立即修改密码（推荐开启）"
                onChange={(event) =>
                  setState((prev) => ({ ...prev, mustChangePassword: event.target.checked }))
                }
              />
              <FieldHint className="mt-1 pl-5.5">
                {state.mustChangePassword
                  ? '用户使用临时密码登录后将被 MustChangePwdGuard 锁定至改密页，完成改密后方可进入控制台。'
                  : '关闭后，用户使用该临时密码可直接进入控制台，无需首次登录改密。'}
              </FieldHint>
            </div>
          </DialogBody>

          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              disabled={submitting || reloading}
              onClick={handleCloseAndWipe}
            >
              取消
            </Button>
            <Button
              type="submit"
              variant="default"
              size="sm"
              disabled={submitting || reloading || Boolean(state.conflict)}
              data-testid="reset-password-submit-btn"
            >
              {submitting ? (
                <>
                  <Icon name="loader" className="size-3.5 animate-spin" />
                  <span>正在重置密码…</span>
                </>
              ) : (
                <>
                  <Icon name="key" className="size-3.5" />
                  <span>确认重置并生成临时密码</span>
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      )}

      {target && state.phase === 'reveal' && state.revealedPassword !== null && (
        <div data-testid="reset-password-reveal-modal">
          <DialogHeader>
            <div>
              <div className="mb-1.5 flex items-center gap-2">
                <Badge variant="safe" className="tabular-nums">
                  密码已重置 · v{state.workingVersion}
                </Badge>
              </div>
              <DialogTitle id="reset-password-dialog-title">
                临时密码已生成 · <span className="font-mono">{target.username}</span>
              </DialogTitle>
              <DialogDescription id="reset-password-dialog-desc">
                请立即复制并通过安全通道交付给用户；关闭窗口后系统不会保留或再次显示该明文。
              </DialogDescription>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="关闭并清除临时密码"
              data-testid="reset-reveal-close-x-btn"
              onClick={handleCloseAndWipe}
            >
              <Icon name="x" className="size-4" />
            </Button>
          </DialogHeader>

          <DialogBody className="space-y-4">
            <Alert variant="warning" data-testid="reset-reveal-warning-banner">
              <strong>一次性明文展示：</strong>临时密码仅暂存于本弹窗组件内存，不写入任何浏览器存储或查询缓存。点击完成或关闭弹窗瞬间将立即清空内存明文。
            </Alert>

            <div className="rounded-md border border-border-strong bg-bg-app p-3">
              <div className="flex items-center justify-between gap-2 text-[11px] text-fg-subtle">
                <span>一次性临时密码</span>
                <span className="font-mono">
                  {state.mustChangePassword ? '下次登录强制改密' : '允许直接使用'}
                </span>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <code
                  data-testid="reset-temporary-password-output"
                  className="min-w-0 flex-1 overflow-x-auto rounded-sm border border-border-line bg-bg-card px-2.5 py-1.5 font-mono text-[13px] font-semibold tracking-wide text-fg-main select-all"
                >
                  {state.showRevealedPassword
                    ? state.revealedPassword
                    : '•'.repeat(state.revealedPassword.length)}
                </code>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label={state.showRevealedPassword ? '隐藏临时密码' : '显示临时密码'}
                  data-testid="reset-reveal-toggle-visibility-btn"
                  onClick={() =>
                    setState((prev) => ({
                      ...prev,
                      showRevealedPassword: !prev.showRevealedPassword,
                    }))
                  }
                >
                  <Icon
                    name={state.showRevealedPassword ? 'eye-off' : 'eye'}
                    className="size-3.5"
                  />
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  data-testid="reset-reveal-copy-btn"
                  onClick={() => void handleCopyTemporaryPassword()}
                >
                  <Icon name={state.copied ? 'check' : 'copy'} className="size-3.5" />
                  <span>{state.copied ? '已复制' : '一键复制'}</span>
                </Button>
              </div>
            </div>
          </DialogBody>

          <DialogFooter>
            <Button
              variant="default"
              size="sm"
              data-testid="reset-reveal-done-btn"
              onClick={handleCloseAndWipe}
            >
              已完成交付，关闭并清除明文
            </Button>
          </DialogFooter>
        </div>
      )}
    </Dialog>
  );
}
