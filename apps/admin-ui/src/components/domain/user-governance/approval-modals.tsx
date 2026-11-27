import type { EntityId, PendingApprovalDTO, RoleDTO } from '@mysql-mcp/shared-types';
import { useEffect, useState, type FormEvent } from 'react';
import { isApiClientError } from '@/api/client';
import {
  canAssignRole,
  PRIVILEGE_ESCALATION_TOOLTIP,
  REJECT_REASON_MAX_LENGTH,
  validateApproveRolesSelection,
  validateRejectReasonInput,
} from '@/api/schemas/user-administration.schema';
import { approvePendingUser, rejectPendingUser } from '@/api/user-administration';
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
  Field,
  FieldError,
  FieldLabel,
  Textarea,
} from '@/components/ui/form-controls';
import { Icon } from '@/components/ui/icon';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/cn';

function formatTimestamp(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function ApprovalSummaryBlock({ approval }: { approval: PendingApprovalDTO }) {
  return (
    <div className="space-y-3 rounded-md border border-border-line bg-bg-surface/60 p-3">
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        <div>
          <div className="text-[11px] text-fg-subtle">申请人账号</div>
          <div className="mt-0.5 font-mono font-medium text-fg-main">{approval.username}</div>
        </div>
        <div>
          <div className="text-[11px] text-fg-subtle">工单 / 用户 ID</div>
          <div className="mt-0.5 font-mono text-fg-main tabular-nums">
            #{approval.id} / UID {approval.user_id}
          </div>
        </div>
        <div>
          <div className="text-[11px] text-fg-subtle">工作邮箱</div>
          <div className="mt-0.5 truncate text-fg-muted">{approval.email ?? '未填写'}</div>
        </div>
        <div>
          <div className="text-[11px] text-fg-subtle">所属部门 · 提交时间</div>
          <div className="mt-0.5 truncate text-fg-muted tabular-nums">
            {approval.department ?? '未填写'} · {formatTimestamp(approval.created_at)}
          </div>
        </div>
      </div>
      <div className="border-t border-border-line pt-2.5">
        <div className="text-[11px] text-fg-subtle">申请背景说明</div>
        <p className="mt-1 text-xs leading-relaxed whitespace-pre-wrap text-fg-main">
          {approval.reason?.trim() ? approval.reason : '申请人未填写背景说明。'}
        </p>
      </div>
    </div>
  );
}

export interface ApprovalApproveModalProps {
  target: PendingApprovalDTO | null;
  roles: readonly RoleDTO[];
  rolesLoading: boolean;
  rolesError: string | null;
  onRetryRoles: () => void;
  actorIsSuperAdmin: boolean;
  onClose: () => void;
  onApproved: (approval: PendingApprovalDTO, assignedRoleNames: string[]) => void;
  onStateConflict: (approval: PendingApprovalDTO) => void;
}

export function ApprovalApproveModal({
  target,
  roles,
  rolesLoading,
  rolesError,
  onRetryRoles,
  actorIsSuperAdmin,
  onClose,
  onApproved,
  onStateConflict,
}: ApprovalApproveModalProps) {
  const [selectedIds, setSelectedIds] = useState<EntityId[]>([]);
  const [validationError, setValidationError] = useState('');
  const [serverError, setServerError] = useState<{
    code?: string;
    message: string;
    guidance: string;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (target) {
      setSelectedIds([]);
      setValidationError('');
      setServerError(null);
      setSubmitting(false);
    }
  }, [target]);

  const toggleRole = (role: RoleDTO) => {
    if (!canAssignRole(role, actorIsSuperAdmin)) return;
    setValidationError('');
    setServerError(null);
    setSelectedIds((prev) =>
      prev.includes(role.id) ? prev.filter((id) => id !== role.id) : [...prev, role.id],
    );
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!target || submitting) return;

    const checked = validateApproveRolesSelection(selectedIds, roles, actorIsSuperAdmin);
    if (!checked.payload) {
      setValidationError(checked.error);
      return;
    }

    setValidationError('');
    setServerError(null);
    setSubmitting(true);

    try {
      await approvePendingUser(target.id, checked.payload);
      const assignedRoleNames = roles
        .filter((role) => checked.payload?.roleIds.includes(role.id))
        .map((role) => role.display_name);
      onApproved(target, assignedRoleNames);
      onClose();
    } catch (error: unknown) {
      if (isApiClientError(error)) {
        if (error.code === 'ERR_APPROVAL_STATE_CONFLICT') {
          setServerError({
            code: error.code,
            message: error.message,
            guidance: '已为您自动刷新最新待审工单列表，请核对工单当前状态。',
          });
          onStateConflict(target);
        } else {
          setServerError({
            code: error.code,
            message: error.message,
            guidance: error.actionGuidance,
          });
        }
      } else {
        setServerError({
          message: '审批通过请求未能完成。',
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
      ariaLabelledBy="approve-dialog-title"
      ariaDescribedBy="approve-dialog-desc"
      className="w-[min(560px,calc(100vw-32px))]"
    >
      {target && (
        <form onSubmit={(event) => void handleSubmit(event)} noValidate data-testid="approve-approval-modal">
          <DialogHeader>
            <div>
              <DialogTitle id="approve-dialog-title">批准注册申请并分配角色</DialogTitle>
              <DialogDescription id="approve-dialog-desc">
                批准后账号将直接激活为 ACTIVE，用户可使用注册时的强密码登录控制台（非乐观更新，等待服务端确认）。
              </DialogDescription>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="关闭批准窗口"
              disabled={submitting}
              onClick={onClose}
            >
              <Icon name="x" className="size-4" />
            </Button>
          </DialogHeader>

          <DialogBody className="space-y-4">
            <ApprovalSummaryBlock approval={target} />

            {serverError && (
              <Alert
                variant={serverError.code === 'ERR_APPROVAL_STATE_CONFLICT' ? 'warning' : 'danger'}
                role="alert"
                data-testid="approve-server-error"
              >
                <div className="font-medium">
                  {serverError.message}
                  {serverError.code && (
                    <span className="ml-1.5 font-mono text-[11px]">({serverError.code})</span>
                  )}
                </div>
                <div className="mt-0.5 text-fg-muted">{serverError.guidance}</div>
              </Alert>
            )}

            <Field invalid={Boolean(validationError)}>
              <div className="flex items-center justify-between gap-2">
                <FieldLabel required>选择初始角色（至少 1 项，来自服务端角色目录）</FieldLabel>
                <span className="font-mono text-[11px] text-fg-subtle tabular-nums">
                  已选 {selectedIds.length} 项
                </span>
              </div>

              {rolesLoading ? (
                <div className="flex items-center gap-2 rounded-md border border-border-line bg-bg-app px-3 py-4 text-xs text-fg-muted">
                  <Icon name="loader" className="size-4 animate-spin text-primary" />
                  <span>正在加载服务端角色列表…</span>
                </div>
              ) : rolesError ? (
                <Alert variant="danger">
                  <div className="flex items-center justify-between gap-2">
                    <span>{rolesError}</span>
                    <Button variant="outline" size="xs" onClick={onRetryRoles}>
                      重试加载
                    </Button>
                  </div>
                </Alert>
              ) : (
                <div
                  className="max-h-56 space-y-1.5 overflow-y-auto rounded-md border border-border-line bg-bg-app p-2"
                  data-testid="approve-roles-list"
                >
                  {roles.map((role) => {
                    const assignable = canAssignRole(role, actorIsSuperAdmin);
                    const checked = selectedIds.includes(role.id);
                    const row = (
                      <label
                        key={role.id}
                        data-testid={`approve-role-option-${role.role_name}`}
                        className={cn(
                          'flex items-start gap-2.5 rounded-md border px-2.5 py-2 text-xs transition-colors',
                          assignable
                            ? checked
                              ? 'cursor-pointer border-primary/40 bg-primary-soft/60'
                              : 'cursor-pointer border-border-line bg-bg-card hover:border-border-strong'
                            : 'cursor-not-allowed border-border-line bg-bg-surface/60 opacity-60',
                        )}
                      >
                        <input
                          type="checkbox"
                          className="mt-0.5 size-3.5 shrink-0 accent-primary disabled:cursor-not-allowed"
                          checked={checked}
                          disabled={!assignable || submitting}
                          data-testid={`approve-role-checkbox-${role.role_name}`}
                          onChange={() => toggleRole(role)}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-medium text-fg-main">{role.display_name}</span>
                            <Badge variant="neutral" dot={false} mono className="px-1.5 py-0 text-[10px]">
                              {role.role_name}
                            </Badge>
                            {!assignable && (
                              <span className="inline-flex items-center gap-1 text-[11px] text-warning">
                                <Icon name="lock" className="size-3" />
                                <span>仅超管可授</span>
                              </span>
                            )}
                          </div>
                          {role.description && (
                            <p className="mt-0.5 text-[11px] text-fg-muted">{role.description}</p>
                          )}
                        </div>
                      </label>
                    );

                    if (!assignable) {
                      return (
                        <Tooltip key={role.id}>
                          <TooltipTrigger asChild>
                            <div tabIndex={0}>{row}</div>
                          </TooltipTrigger>
                          <TooltipContent>{PRIVILEGE_ESCALATION_TOOLTIP}</TooltipContent>
                        </Tooltip>
                      );
                    }
                    return row;
                  })}
                </div>
              )}

              <FieldError data-testid="approve-roles-error">{validationError}</FieldError>
            </Field>
          </DialogBody>

          <DialogFooter>
            <Button variant="outline" size="sm" disabled={submitting} onClick={onClose}>
              取消
            </Button>
            <Button
              type="submit"
              variant="default"
              size="sm"
              disabled={submitting || rolesLoading || Boolean(rolesError)}
              data-testid="approve-confirm-submit-btn"
            >
              {submitting ? (
                <>
                  <Icon name="loader" className="size-3.5 animate-spin" />
                  <span>正在提交批准…</span>
                </>
              ) : (
                <>
                  <Icon name="check" className="size-3.5" />
                  <span>确认批准并激活</span>
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      )}
    </Dialog>
  );
}

export interface ApprovalRejectModalProps {
  target: PendingApprovalDTO | null;
  onClose: () => void;
  onRejected: (approval: PendingApprovalDTO) => void;
  onStateConflict: (approval: PendingApprovalDTO) => void;
}

export function ApprovalRejectModal({
  target,
  onClose,
  onRejected,
  onStateConflict,
}: ApprovalRejectModalProps) {
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState('');
  const [serverError, setServerError] = useState<{
    code?: string;
    message: string;
    guidance: string;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (target) {
      setReason('');
      setReasonError('');
      setServerError(null);
      setSubmitting(false);
    }
  }, [target]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!target || submitting) return;

    const checked = validateRejectReasonInput(reason);
    if (!checked.payload) {
      setReasonError(checked.error);
      return;
    }

    setReasonError('');
    setServerError(null);
    setSubmitting(true);

    try {
      await rejectPendingUser(target.id, checked.payload);
      onRejected(target);
      onClose();
    } catch (error: unknown) {
      if (isApiClientError(error)) {
        if (error.code === 'ERR_APPROVAL_STATE_CONFLICT') {
          setServerError({
            code: error.code,
            message: error.message,
            guidance: '已为您自动刷新最新待审工单列表，请核对工单当前状态。',
          });
          onStateConflict(target);
        } else {
          setServerError({
            code: error.code,
            message: error.message,
            guidance: error.actionGuidance,
          });
        }
      } else {
        setServerError({
          message: '驳回请求未能完成。',
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
      ariaLabelledBy="reject-dialog-title"
      ariaDescribedBy="reject-dialog-desc"
      className="w-[min(540px,calc(100vw-32px))]"
    >
      {target && (
        <form onSubmit={(event) => void handleSubmit(event)} noValidate data-testid="reject-approval-modal">
          <DialogHeader>
            <div>
              <DialogTitle id="reject-dialog-title">驳回用户注册申请</DialogTitle>
              <DialogDescription id="reject-dialog-desc">
                驳回后账号将流转为 REJECTED，申请人可在重新提交页面查看您填写的驳回理由。
              </DialogDescription>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="关闭驳回窗口"
              disabled={submitting}
              onClick={onClose}
            >
              <Icon name="x" className="size-4" />
            </Button>
          </DialogHeader>

          <DialogBody className="space-y-4">
            <ApprovalSummaryBlock approval={target} />

            {serverError && (
              <Alert
                variant={serverError.code === 'ERR_APPROVAL_STATE_CONFLICT' ? 'warning' : 'danger'}
                role="alert"
                data-testid="reject-server-error"
              >
                <div className="font-medium">
                  {serverError.message}
                  {serverError.code && (
                    <span className="ml-1.5 font-mono text-[11px]">({serverError.code})</span>
                  )}
                </div>
                <div className="mt-0.5 text-fg-muted">{serverError.guidance}</div>
              </Alert>
            )}

            <Field invalid={Boolean(reasonError)}>
              <div className="flex items-center justify-between gap-2">
                <FieldLabel htmlFor="reject-reason-textarea" required>
                  驳回理由与补充指引
                </FieldLabel>
                <span className="font-mono text-[11px] text-fg-subtle tabular-nums">
                  {reason.trim().length} / {REJECT_REASON_MAX_LENGTH}
                </span>
              </div>
              <Textarea
                id="reject-reason-textarea"
                data-testid="reject-reason-input"
                maxLength={REJECT_REASON_MAX_LENGTH}
                placeholder="例如：请补充业务主管审批单号，并写明需要查询的目标库表范围。"
                value={reason}
                disabled={submitting}
                aria-invalid={reasonError ? 'true' : 'false'}
                aria-describedby={reasonError ? 'reject-reason-error' : undefined}
                onChange={(event) => {
                  setReason(event.target.value);
                  if (reasonError) setReasonError('');
                }}
              />
              <FieldError id="reject-reason-error" data-testid="reject-reason-error">
                {reasonError}
              </FieldError>
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
              disabled={submitting}
              data-testid="reject-confirm-submit-btn"
            >
              {submitting ? (
                <>
                  <Icon name="loader" className="size-3.5 animate-spin" />
                  <span>正在提交驳回…</span>
                </>
              ) : (
                <>
                  <Icon name="ban" className="size-3.5" />
                  <span>确认驳回申请</span>
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      )}
    </Dialog>
  );
}
