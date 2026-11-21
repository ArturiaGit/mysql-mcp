import type { PatListItemDTO, ProfileOptionDTO } from '@mysql-mcp/shared-types';
import { useCallback, useEffect, useReducer, useRef } from 'react';
import { isApiClientError } from '@/api/client';
import { createPat } from '@/api/pats';
import {
  PAT_EXPIRES_MAX_DAYS,
  PAT_EXPIRES_MIN_DAYS,
  PAT_EXPIRES_PRESET_DAYS,
  PAT_NAME_MAX_LENGTH,
  validateCreatePatForm,
} from '@/api/schemas/pat.schema';
import { ClientSnippetGenerator } from '@/components/domain/client-snippet';
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
  FieldGroup,
  FieldHint,
  FieldLabel,
  Input,
} from '@/components/ui/form-controls';
import { Icon } from '@/components/ui/icon';
import { copyToClipboard } from '@/lib/clipboard';
import { useToastStore } from '@/stores/useToastStore';
import {
  canClosePatModalSafely,
  createInitialPatModalState,
  maskPatToken,
  patModalReducer,
} from './pat-modal-state';

export interface PatCreateModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profiles?: readonly ProfileOptionDTO[];
  /**
   * Called after POST /api/v1/pats succeeds so the parent list can refresh.
   * Receives ONLY non-sensitive PatListItemDTO metadata — NEVER rawToken.
   */
  onPatCreated?: (pat: PatListItemDTO) => void;
}

export function PatCreateModal({
  open,
  onOpenChange,
  profiles = [],
  onPatCreated,
}: PatCreateModalProps) {
  const pushToast = useToastStore((state) => state.push);
  const [state, dispatch] = useReducer(patModalReducer, undefined, createInitialPatModalState);

  const nameInputRef = useRef<HTMLInputElement>(null);
  const expiresInputRef = useRef<HTMLInputElement>(null);
  const copyBtnRef = useRef<HTMLButtonElement>(null);
  const keepBtnRef = useRef<HTMLButtonElement>(null);
  const requestSeqRef = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;

  const clearSecretAndReset = useCallback(() => {
    requestSeqRef.current += 1;
    dispatch({ type: 'RESET_AND_CLEAR_SECRET' });
  }, []);

  useEffect(() => {
    if (open) {
      clearSecretAndReset();
      queueMicrotask(() => nameInputRef.current?.focus());
    } else {
      clearSecretAndReset();
    }
  }, [open, clearSecretAndReset]);

  // Ensure in-memory rawToken is cleared unconditionally on unmount
  useEffect(() => {
    return () => {
      requestSeqRef.current += 1;
      dispatch({ type: 'RESET_AND_CLEAR_SECRET' });
    };
  }, []);

  const handleBeforeClose = useCallback((): boolean => {
    const current = stateRef.current;
    if (current.submitting) {
      return false;
    }
    if (canClosePatModalSafely(current)) {
      clearSecretAndReset();
      return true;
    }
    dispatch({ type: 'SHOW_DISCARD_PROMPT' });
    queueMicrotask(() => keepBtnRef.current?.focus());
    return false;
  }, [clearSecretAndReset]);

  const handleRequestClose = () => {
    if (handleBeforeClose()) {
      onOpenChange(false);
    }
  };

  const handleForceDiscardAndClose = () => {
    clearSecretAndReset();
    onOpenChange(false);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (state.submitting || state.phase === 'reveal') {
      return;
    }

    const validation = validateCreatePatForm({
      name: state.name,
      expiresDaysInput: state.expiresDaysInput,
    });
    if (!validation.payload) {
      dispatch({
        type: 'SET_VALIDATION_ERRORS',
        nameError: validation.nameError,
        expiresError: validation.expiresError,
      });
      if (validation.nameError) {
        nameInputRef.current?.focus();
      } else if (validation.expiresError) {
        expiresInputRef.current?.focus();
      }
      return;
    }

    dispatch({ type: 'SUBMIT_START' });
    const seq = ++requestSeqRef.current;

    try {
      const response = await createPat(validation.payload);
      if (seq !== requestSeqRef.current) {
        return;
      }
      dispatch({
        type: 'SUBMIT_SUCCESS',
        pat: response.pat,
        rawToken: response.rawToken,
      });
      onPatCreated?.(response.pat);
      queueMicrotask(() => copyBtnRef.current?.focus());
    } catch (error: unknown) {
      if (seq !== requestSeqRef.current) {
        return;
      }
      const message = isApiClientError(error)
        ? `${error.message}${error.actionGuidance ? ` ${error.actionGuidance}` : ''}`
        : '令牌签发失败，请稍后重试。';
      dispatch({ type: 'SUBMIT_ERROR', message });
    }
  };

  const handleCopyRawToken = async () => {
    if (!state.rawToken) return;
    const ok = await copyToClipboard(state.rawToken);
    pushToast(
      ok ? '已复制个人访问令牌明文' : '无法访问剪贴板',
      ok
        ? '请立即保存至安全的本地密钥管理器，关闭弹窗后系统将不再展示。'
        : '请手动选中令牌框内容并使用快捷键复制。',
      ok ? 'safe' : 'warning',
    );
  };

  const isReveal = state.phase === 'reveal' && state.rawToken !== null;
  const formattedExpiry = state.createdPat?.expires_at
    ? new Date(state.createdPat.expires_at).toLocaleString('zh-CN', {
        hour12: false,
      })
    : `${state.expiresDaysInput} 天后过期`;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          clearSecretAndReset();
        }
        onOpenChange(next);
      }}
      onBeforeClose={handleBeforeClose}
      dismissOnBackdrop
      ariaLabelledBy="pat-create-dialog-title"
      ariaDescribedBy="pat-create-dialog-description"
      className={isReveal ? 'w-[min(600px,calc(100vw-32px))]' : 'w-[min(480px,calc(100vw-32px))]'}
    >
      <div data-testid="pat-create-modal" data-phase={state.phase}>
        <DialogHeader>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <DialogTitle id="pat-create-dialog-title">
                {isReveal ? '个人访问令牌已签发' : '签发新个人访问令牌 (PAT)'}
              </DialogTitle>
              {isReveal && (
                <Badge variant="secret" mono>
                  单次展示
                </Badge>
              )}
            </div>
            <DialogDescription id="pat-create-dialog-description">
              {isReveal && state.createdPat
                ? `${state.createdPat.name} · 到期时间 ${formattedExpiry}`
                : '系统将生成 256-bit 高熵令牌并仅以 HMAC-SHA-256 哈希落库，明文仅本次展示一次。'}
            </DialogDescription>
          </div>
          <Button
            variant="ghost"
            size="icon"
            data-testid="pat-modal-close-btn"
            aria-label="关闭令牌弹窗"
            disabled={state.submitting}
            onClick={handleRequestClose}
          >
            <Icon name="x" className="size-4" />
          </Button>
        </DialogHeader>

        {!isReveal ? (
          <form onSubmit={(event) => void handleSubmit(event)} noValidate>
            <DialogBody>
              <div className="mb-3 grid size-9 place-items-center rounded-md border border-secret/30 bg-secret-soft text-secret">
                <Icon name="key" className="size-4" />
              </div>

              <FieldGroup>
                {state.submitError && (
                  <Alert variant="danger" data-testid="pat-create-error-alert">
                    {state.submitError}
                  </Alert>
                )}

                <Field invalid={Boolean(state.nameError)}>
                  <FieldLabel htmlFor="pat-name-input" required>
                    令牌名称
                  </FieldLabel>
                  <Input
                    ref={nameInputRef}
                    id="pat-name-input"
                    data-testid="pat-name-input"
                    value={state.name}
                    maxLength={PAT_NAME_MAX_LENGTH}
                    placeholder="例如：Cursor-Agent-Dev / CI-Readonly"
                    autoComplete="off"
                    disabled={state.submitting}
                    aria-invalid={Boolean(state.nameError)}
                    aria-describedby="pat-name-error"
                    onChange={(event) =>
                      dispatch({ type: 'SET_NAME', value: event.target.value })
                    }
                  />
                  <FieldError id="pat-name-error">{state.nameError}</FieldError>
                </Field>

                <Field invalid={Boolean(state.expiresError)}>
                  <FieldLabel htmlFor="pat-expires-days-input" required>
                    有效天数（{PAT_EXPIRES_MIN_DAYS}~{PAT_EXPIRES_MAX_DAYS} 天）
                  </FieldLabel>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Input
                      ref={expiresInputRef}
                      id="pat-expires-days-input"
                      data-testid="pat-expires-days-input"
                      type="number"
                      inputMode="numeric"
                      min={PAT_EXPIRES_MIN_DAYS}
                      max={PAT_EXPIRES_MAX_DAYS}
                      step={1}
                      value={state.expiresDaysInput}
                      disabled={state.submitting}
                      aria-invalid={Boolean(state.expiresError)}
                      aria-describedby="pat-expires-error"
                      className="w-28 font-mono tabular-nums"
                      onChange={(event) =>
                        dispatch({ type: 'SET_EXPIRES_DAYS', value: event.target.value })
                      }
                    />
                    <div className="flex flex-wrap items-center gap-1" role="group" aria-label="快捷有效期选项">
                      {PAT_EXPIRES_PRESET_DAYS.map((days) => {
                        const active = state.expiresDaysInput === String(days);
                        return (
                          <Button
                            key={days}
                            variant={active ? 'secondary' : 'outline'}
                            size="xs"
                            disabled={state.submitting}
                            onClick={() =>
                              dispatch({ type: 'SET_EXPIRES_DAYS', value: String(days) })
                            }
                            className="font-mono tabular-nums"
                          >
                            {days}天
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                  <FieldHint>默认 90 天，最长不超过 365 天；到期后须重新签发。</FieldHint>
                  <FieldError id="pat-expires-error">{state.expiresError}</FieldError>
                </Field>

                <Alert variant="info" icon="shield">
                  签发的令牌自动继承您当前角色授权的数据源与库表 ACL 策略；密码过期或账号停用时将同步失效。
                </Alert>
              </FieldGroup>
            </DialogBody>

            <DialogFooter>
              <Button
                variant="outline"
                disabled={state.submitting}
                onClick={handleRequestClose}
              >
                取消
              </Button>
              <Button
                type="submit"
                variant="default"
                data-testid="pat-create-submit-btn"
                disabled={state.submitting}
              >
                <Icon
                  name={state.submitting ? 'loader' : 'key'}
                  className={state.submitting ? 'size-3.5 animate-spin' : 'size-3.5'}
                />
                <span>{state.submitting ? '签发中…' : '签发新令牌'}</span>
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <div>
            <DialogBody className="space-y-3.5">
              {/* Red Danger Banner for single-time reveal */}
              <Alert variant="danger" data-testid="pat-reveal-danger-banner">
                <strong>请立即复制并妥善保存此令牌明文。</strong>
                系统仅在数据库保留不可逆哈希摘要，关闭此窗口后明文将立即从内存清零且永远无法再次查看。
              </Alert>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-fg-muted">个人访问令牌明文</span>
                  <div className="flex items-center gap-1.5">
                    <Button
                      variant="ghost"
                      size="xs"
                      data-testid="pat-toggle-mask-btn"
                      onClick={() => dispatch({ type: 'TOGGLE_SECRET_MASK' })}
                    >
                      <Icon name={state.secretMasked ? 'eye' : 'eye-off'} className="size-3.5" />
                      <span>{state.secretMasked ? '显示明文' : '掩码隐藏'}</span>
                    </Button>
                    <Button
                      ref={copyBtnRef}
                      variant="default"
                      size="xs"
                      data-testid="pat-copy-raw-btn"
                      onClick={() => void handleCopyRawToken()}
                    >
                      <Icon name="copy" className="size-3.5" />
                      <span>一键复制明文</span>
                    </Button>
                  </div>
                </div>

                <div
                  data-testid="pat-secret-output"
                  aria-label="新签发的个人访问令牌"
                  className="rounded-md border border-danger/35 bg-bg-app p-3 font-mono text-xs break-all text-fg-main select-all"
                >
                  {state.secretMasked && state.rawToken
                    ? maskPatToken(state.rawToken)
                    : state.rawToken}
                </div>
              </div>

              {/* State 1 (签发即时态): Immediate client config snippet with in-memory rawToken */}
              <div className="rounded-md border border-border-line bg-bg-surface/40 p-3">
                <ClientSnippetGenerator
                  profiles={profiles}
                  issuedToken={state.rawToken}
                  compact
                />
              </div>

              <Checkbox
                id="pat-backup-confirm-checkbox"
                data-testid="pat-backup-confirm-checkbox"
                checked={state.backupConfirmed}
                onChange={(event) =>
                  dispatch({
                    type: 'SET_BACKUP_CONFIRMED',
                    checked: event.target.checked,
                  })
                }
                label="我已复制并妥善保存此令牌。我了解关闭后系统无法再次显示该令牌。"
              />

              {/* Exit Interception Panel */}
              {state.discardPromptVisible && (
                <div
                  role="alertdialog"
                  aria-labelledby="pat-discard-title"
                  aria-describedby="pat-discard-reason"
                  data-testid="pat-discard-prompt"
                  className="rounded-md border border-warning/40 bg-warning-soft p-3 text-xs text-warning"
                >
                  <p id="pat-discard-title" className="font-semibold">
                    尚未确认保存令牌明文
                  </p>
                  <p id="pat-discard-reason" className="mt-1 leading-relaxed">
                    当前令牌明文尚未确认保存。关闭窗口仅清除屏幕上的明文显示，不会吊销该令牌。确认放弃保存此令牌明文？
                  </p>
                  <div className="mt-2.5 flex items-center justify-end gap-2">
                    <Button
                      variant="destructive"
                      size="xs"
                      data-testid="pat-force-discard-btn"
                      aria-describedby="pat-discard-reason"
                      onClick={handleForceDiscardAndClose}
                    >
                      清除明文并关闭
                    </Button>
                    <Button
                      ref={keepBtnRef}
                      variant="outline"
                      size="xs"
                      data-testid="pat-keep-saving-btn"
                      aria-describedby="pat-discard-reason"
                      onClick={() => {
                        dispatch({ type: 'HIDE_DISCARD_PROMPT' });
                        copyBtnRef.current?.focus();
                      }}
                    >
                      继续保存
                    </Button>
                  </div>
                </div>
              )}
            </DialogBody>

            <DialogFooter>
              <Button
                variant="default"
                data-testid="pat-done-btn"
                disabled={!state.backupConfirmed}
                onClick={handleForceDiscardAndClose}
              >
                <Icon name="check" className="size-3.5" />
                <span>已保存，完成</span>
              </Button>
            </DialogFooter>
          </div>
        )}
      </div>
    </Dialog>
  );
}
