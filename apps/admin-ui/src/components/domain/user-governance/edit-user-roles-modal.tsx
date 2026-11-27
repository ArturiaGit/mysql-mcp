import type { EntityId, RoleDTO, UserListItemDTO } from '@mysql-mcp/shared-types';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { isApiClientError } from '@/api/client';
import {
  buildUpdateUserRolesPayload,
  evaluateUserGuardrails,
} from '@/api/schemas/user-administration.schema';
import { updateUserRoles } from '@/api/user-administration';
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
import { Alert, Field, FieldError, FieldLabel } from '@/components/ui/form-controls';
import { Icon } from '@/components/ui/icon';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/cn';
import {
  createInitialEditRolesState,
  discardRoleDraftAndReload,
  loadLatestVersionPreservingRoleDraft,
  recordEditRolesConflict,
  type EditRolesModalState,
} from './governance-modal-state';
import type { GuardrailViolationInfo } from './guardrail-error-modal';

export interface EditUserRolesModalProps {
  target: UserListItemDTO | null;
  currentUserId: EntityId;
  roles: readonly RoleDTO[];
  rolesLoading: boolean;
  rolesError: string | null;
  onRetryRoles: () => void;
  onFetchLatestUser: (userId: EntityId, username: string) => Promise<UserListItemDTO | null>;
  onClose: () => void;
  onUpdated: (user: UserListItemDTO, nextVersion: number) => void;
  onGuardrailViolation: (violation: GuardrailViolationInfo) => void;
}

export function EditUserRolesModal({
  target,
  currentUserId,
  roles,
  rolesLoading,
  rolesError,
  onRetryRoles,
  onFetchLatestUser,
  onClose,
  onUpdated,
  onGuardrailViolation,
}: EditUserRolesModalProps) {
  const [state, setState] = useState<EditRolesModalState>(() =>
    createInitialEditRolesState([], 1),
  );
  const [liveTarget, setLiveTarget] = useState<UserListItemDTO | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [reloadingLatest, setReloadingLatest] = useState(false);
  const [serverError, setServerError] = useState<{
    code?: string;
    message: string;
    guidance: string;
  } | null>(null);
  const [versionReloadedNotice, setVersionReloadedNotice] = useState(false);

  useEffect(() => {
    if (target) {
      setLiveTarget(target);
      setState(
        createInitialEditRolesState(
          target.roles.map((role) => role.id),
          target.version,
        ),
      );
      setSubmitting(false);
      setReloadingLatest(false);
      setServerError(null);
      setVersionReloadedNotice(false);
    }
  }, [target]);

  const effectiveTarget = liveTarget ?? target;
  const guardrails = useMemo(
    () => (effectiveTarget ? evaluateUserGuardrails(effectiveTarget, currentUserId) : null),
    [effectiveTarget, currentUserId],
  );

  const roleById = useMemo(() => new Map(roles.map((role) => [role.id, role])), [roles]);

  const remoteRoleLabels = useMemo(
    () =>
      state.remoteRoleIds.map((id) => {
        const found = roleById.get(id);
        return found ? found.display_name : `#${id}`;
      }),
    [state.remoteRoleIds, roleById],
  );

  const toggleRole = (role: RoleDTO) => {
    if (submitting || reloadingLatest) return;
    if (role.role_name === 'SUPER_ADMIN' && guardrails?.superAdminRoleLocked) {
      return;
    }
    setServerError(null);
    setState((prev) => {
      const exists = prev.selectedRoleIds.includes(role.id);
      return {
        ...prev,
        selectedRoleIds: exists
          ? prev.selectedRoleIds.filter((id) => id !== role.id)
          : [...prev.selectedRoleIds, role.id],
      };
    });
  };

  const handleLoadLatestPreservingDraft = async () => {
    if (!effectiveTarget || reloadingLatest) return;
    setReloadingLatest(true);
    setServerError(null);
    try {
      const latest = await onFetchLatestUser(effectiveTarget.id, effectiveTarget.username);
      if (!latest) {
        setServerError({
          code: 'ERR_NOT_FOUND',
          message: '未能加载到该用户的最新记录，可能已被其他管理员删除。',
          guidance: '请关闭弹窗并刷新用户列表。',
        });
        return;
      }
      setLiveTarget(latest);
      setState((prev) =>
        loadLatestVersionPreservingRoleDraft(
          prev,
          latest.roles.map((role) => role.id),
          latest.version,
        ),
      );
      setVersionReloadedNotice(true);
    } catch {
      setServerError({
        message: '加载最新版本失败。',
        guidance: '请稍后重试或刷新页面。',
      });
    } finally {
      setReloadingLatest(false);
    }
  };

  const handleDiscardDraftAndReload = async () => {
    if (!effectiveTarget || reloadingLatest) return;
    setReloadingLatest(true);
    setServerError(null);
    setVersionReloadedNotice(false);
    try {
      const latest = await onFetchLatestUser(effectiveTarget.id, effectiveTarget.username);
      if (!latest) {
        setServerError({
          code: 'ERR_NOT_FOUND',
          message: '该用户记录已不存在。',
          guidance: '请关闭弹窗并刷新用户列表。',
        });
        return;
      }
      setLiveTarget(latest);
      setState(
        discardRoleDraftAndReload(
          latest.roles.map((role) => role.id),
          latest.version,
        ),
      );
    } catch {
      setServerError({
        message: '重载最新角色数据失败。',
        guidance: '请稍后重试。',
      });
    } finally {
      setReloadingLatest(false);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!effectiveTarget || submitting || reloadingLatest) return;

    const checked = buildUpdateUserRolesPayload(state.selectedRoleIds, state.workingVersion);
    if (!checked.payload) {
      setServerError({
        message: checked.error,
        guidance: '请检查所选角色与版本号后重试。',
      });
      return;
    }

    setServerError(null);
    setSubmitting(true);

    try {
      const res = await updateUserRoles(effectiveTarget.id, checked.payload);
      onUpdated(effectiveTarget, res.version);
      onClose();
    } catch (error: unknown) {
      if (isApiClientError(error)) {
        if (error.code === 'ERR_CONCURRENCY_CONFLICT') {
          setVersionReloadedNotice(false);
          setState((prev) => recordEditRolesConflict(prev, error.conflictDetails));
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
          message: '角色变更请求未能完成。',
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
        if (!nextOpen && !submitting && !reloadingLatest) {
          onClose();
        }
      }}
      onBeforeClose={() => !submitting && !reloadingLatest}
      ariaLabelledBy="edit-roles-dialog-title"
      ariaDescribedBy="edit-roles-dialog-desc"
      className="w-[min(560px,calc(100vw-32px))]"
    >
      {effectiveTarget && (
        <form
          onSubmit={(event) => void handleSubmit(event)}
          noValidate
          data-testid="edit-user-roles-modal"
        >
          <DialogHeader>
            <div>
              <DialogTitle id="edit-roles-dialog-title">
                编辑用户角色 · <span className="font-mono">{effectiveTarget.username}</span>
              </DialogTitle>
              <DialogDescription id="edit-roles-dialog-desc">
                全量覆盖更新角色绑定；提交后同步自增 auth_version 并使旧授权快照失效（当前基线版本{' '}
                <span className="font-mono text-fg-main tabular-nums" data-testid="edit-roles-working-version">
                  v{state.workingVersion}
                </span>
                ）。
              </DialogDescription>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="关闭编辑角色窗口"
              disabled={submitting || reloadingLatest}
              onClick={onClose}
            >
              <Icon name="x" className="size-4" />
            </Button>
          </DialogHeader>

          <DialogBody className="space-y-4">
            {/* 409 Optimistic Lock Conflict Banner (Draft Preserved!) */}
            {state.conflict && (
              <Alert variant="warning" role="alert" data-testid="edit-roles-conflict-banner">
                <div className="space-y-2">
                  <div className="font-semibold">
                    检测到并发版本冲突（ERR_CONCURRENCY_CONFLICT）— 已完整保留您的角色草稿
                  </div>
                  <p className="text-fg-muted tabular-nums">
                    您提交的版本为{' '}
                    <span className="font-mono font-semibold text-fg-main">
                      v{state.conflict.submitted_version}
                    </span>
                    ，远端最新版本已更新为{' '}
                    <span className="font-mono font-semibold text-fg-main">
                      v{state.conflict.current_version}
                    </span>
                    。请选择加载最新版本并保留当前勾选草稿后重试，或放弃草稿重载远端配置。
                  </p>
                  <div className="flex flex-wrap items-center gap-2 pt-0.5">
                    <Button
                      variant="default"
                      size="xs"
                      disabled={reloadingLatest}
                      data-testid="edit-roles-load-latest-keep-draft-btn"
                      onClick={() => void handleLoadLatestPreservingDraft()}
                    >
                      <Icon
                        name={reloadingLatest ? 'loader' : 'refresh'}
                        className={reloadingLatest ? 'size-3 animate-spin' : 'size-3'}
                      />
                      <span>加载最新版本并保留草稿</span>
                    </Button>
                    <Button
                      variant="outline"
                      size="xs"
                      disabled={reloadingLatest}
                      data-testid="edit-roles-discard-draft-btn"
                      onClick={() => void handleDiscardDraftAndReload()}
                    >
                      <span>放弃草稿并重载</span>
                    </Button>
                  </div>
                </div>
              </Alert>
            )}

            {versionReloadedNotice && !state.conflict && (
              <Alert variant="info" data-testid="edit-roles-version-reloaded-notice">
                <div className="space-y-1">
                  <div className="font-medium tabular-nums">
                    已同步至最新版本 v{state.workingVersion}，您的本地勾选草稿已完整保留。
                  </div>
                  <div className="text-fg-muted">
                    远端当前已绑定角色：
                    {remoteRoleLabels.length > 0 ? remoteRoleLabels.join('、') : '（无绑定角色）'}
                    。核对无误后可直接点击「保存角色变更」重新提交。
                  </div>
                </div>
              </Alert>
            )}

            {guardrails?.superAdminRoleLocked && guardrails.superAdminRoleLockReason && (
              <Alert variant="info" icon="lock" data-testid="edit-roles-super-admin-lock-notice">
                <div className="font-medium">SUPER_ADMIN 角色已受安全护栏锁定</div>
                <div className="mt-0.5 text-fg-muted">{guardrails.superAdminRoleLockReason}</div>
              </Alert>
            )}

            {serverError && (
              <Alert variant="danger" role="alert" data-testid="edit-roles-server-error">
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
              <div className="flex items-center justify-between gap-2">
                <FieldLabel>分配角色列表（来自服务端角色目录）</FieldLabel>
                <span className="font-mono text-[11px] text-fg-subtle tabular-nums">
                  已选 {state.selectedRoleIds.length} 项
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
                  className="max-h-60 space-y-1.5 overflow-y-auto rounded-md border border-border-line bg-bg-app p-2"
                  data-testid="edit-roles-list"
                >
                  {roles.map((role) => {
                    const checked = state.selectedRoleIds.includes(role.id);
                    const inRemote = state.remoteRoleIds.includes(role.id);
                    const isLocked =
                      role.role_name === 'SUPER_ADMIN' && Boolean(guardrails?.superAdminRoleLocked);
                    const differsFromRemote = checked !== inRemote;

                    const option = (
                      <label
                        key={role.id}
                        data-testid={`edit-role-option-${role.role_name}`}
                        className={cn(
                          'flex items-start gap-2.5 rounded-md border px-2.5 py-2 text-xs transition-colors',
                          isLocked
                            ? 'cursor-not-allowed border-warning/35 bg-warning-soft/50'
                            : checked
                              ? 'cursor-pointer border-primary/40 bg-primary-soft/60'
                              : 'cursor-pointer border-border-line bg-bg-card hover:border-border-strong',
                        )}
                      >
                        <input
                          type="checkbox"
                          className="mt-0.5 size-3.5 shrink-0 accent-primary disabled:cursor-not-allowed"
                          checked={checked}
                          disabled={isLocked || submitting || reloadingLatest}
                          data-testid={`edit-role-checkbox-${role.role_name}`}
                          onChange={() => toggleRole(role)}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-medium text-fg-main">{role.display_name}</span>
                            <Badge variant="neutral" dot={false} mono className="px-1.5 py-0 text-[10px]">
                              {role.role_name}
                            </Badge>
                            {isLocked && (
                              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-warning">
                                <Icon name="lock" className="size-3" />
                                <span>受保护锁定</span>
                              </span>
                            )}
                            {differsFromRemote && (
                              <Badge variant="primary" dot={false} className="px-1.5 py-0 text-[10px]">
                                {checked ? '待新增' : '待移除'}
                              </Badge>
                            )}
                          </div>
                          {role.description && (
                            <p className="mt-0.5 text-[11px] text-fg-muted">{role.description}</p>
                          )}
                        </div>
                      </label>
                    );

                    if (isLocked && guardrails?.superAdminRoleLockReason) {
                      return (
                        <Tooltip key={role.id}>
                          <TooltipTrigger asChild>
                            <div tabIndex={0}>{option}</div>
                          </TooltipTrigger>
                          <TooltipContent>{guardrails.superAdminRoleLockReason}</TooltipContent>
                        </Tooltip>
                      );
                    }
                    return option;
                  })}
                </div>
              )}
              <FieldError />
            </Field>
          </DialogBody>

          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              disabled={submitting || reloadingLatest}
              onClick={onClose}
            >
              取消
            </Button>
            <Button
              type="submit"
              variant="default"
              size="sm"
              disabled={
                submitting ||
                reloadingLatest ||
                rolesLoading ||
                Boolean(rolesError) ||
                Boolean(state.conflict)
              }
              data-testid="edit-roles-submit-btn"
            >
              {submitting ? (
                <>
                  <Icon name="loader" className="size-3.5 animate-spin" />
                  <span>正在保存角色…</span>
                </>
              ) : (
                <>
                  <Icon name="check" className="size-3.5" />
                  <span>保存角色变更</span>
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      )}
    </Dialog>
  );
}
