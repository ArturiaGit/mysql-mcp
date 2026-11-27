import type { EntityId, UserListItemDTO, UserStatus } from '@mysql-mcp/shared-types';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { isApiClientError } from '@/api/client';
import {
  buildUsersSearchParams,
  evaluateUserGuardrails,
  PAGE_SIZE_OPTIONS,
  parseUsersSearchParams,
  type UsersSearchQuery,
} from '@/api/schemas/user-administration.schema';
import {
  fetchUsersList,
  useRolesCatalog,
  useUsersList,
  usersListQueryKey,
} from '@/api/user-administration';
import {
  DeleteUserModal,
  EditUserRolesModal,
  GuardrailErrorModal,
  ResetPasswordModal,
  ToggleUserStatusModal,
  type GuardrailViolationInfo,
} from '@/components/domain/user-governance';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Alert,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Input,
  Select,
} from '@/components/ui/form-controls';
import { Icon } from '@/components/ui/icon';
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useActiveUser } from '@/guards/auth-guards';
import { ConsoleShell } from '@/layouts/ConsoleShell';
import { useToastStore } from '@/stores/useToastStore';

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

function getStatusBadgeConfig(status: UserStatus): {
  label: UserStatus;
  variant: 'safe' | 'danger' | 'warning' | 'neutral';
} {
  switch (status) {
    case 'ACTIVE':
      return { label: 'ACTIVE', variant: 'safe' };
    case 'DISABLED':
      return { label: 'DISABLED', variant: 'danger' };
    case 'PENDING':
      return { label: 'PENDING', variant: 'warning' };
    case 'REJECTED':
      return { label: 'REJECTED', variant: 'neutral' };
  }
}

export default function UsersView() {
  const currentUser = useActiveUser();
  const queryClient = useQueryClient();
  const pushToast = useToastStore((state) => state.push);
  const [searchParams, setSearchParams] = useSearchParams();

  const query = useMemo(() => parseUsersSearchParams(searchParams), [searchParams]);
  const [searchInput, setSearchInput] = useState(query.search);

  useEffect(() => {
    setSearchInput(query.search);
  }, [query.search]);

  useEffect(() => {
    document.title = '用户与角色管理 | MySQL MCP Gateway Console';
  }, []);

  const {
    data: usersPage,
    isLoading,
    isFetching,
    error,
    refetch,
  } = useUsersList(currentUser.id, query);

  const {
    data: roles = [],
    isLoading: rolesLoading,
    error: rolesFetchError,
    refetch: refetchRoles,
  } = useRolesCatalog(currentUser.id);

  const [editRolesTarget, setEditRolesTarget] = useState<UserListItemDTO | null>(null);
  const [toggleStatusTarget, setToggleStatusTarget] = useState<UserListItemDTO | null>(null);
  const [resetPwdTarget, setResetPwdTarget] = useState<UserListItemDTO | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UserListItemDTO | null>(null);
  const [guardrailViolation, setGuardrailViolation] = useState<GuardrailViolationInfo | null>(null);

  const updateQuery = useCallback(
    (patch: Partial<UsersSearchQuery>) => {
      const next: UsersSearchQuery = { ...query, ...patch };
      setSearchParams(buildUsersSearchParams(next), { replace: true });
    },
    [query, setSearchParams],
  );

  // Clamp out-of-range page after deleting the last row on a later page
  useEffect(() => {
    if (
      usersPage &&
      usersPage.items.length === 0 &&
      query.page > 1 &&
      usersPage.totalPages < query.page
    ) {
      const clampedPage = Math.max(1, usersPage.totalPages);
      setSearchParams(
        buildUsersSearchParams({ ...query, page: clampedPage }),
        { replace: true },
      );
    }
  }, [usersPage, query, setSearchParams]);

  const refreshUsersList = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: usersListQueryKey(currentUser.id) });
  }, [queryClient, currentUser.id]);

  const handleFetchLatestUser = useCallback(
    async (userId: EntityId, username: string): Promise<UserListItemDTO | null> => {
      const latestPage = await fetchUsersList({
        page: 1,
        pageSize: 50,
        search: username,
        status: '',
        role: '',
      });
      refreshUsersList();
      return latestPage.items.find((item) => item.id === userId) ?? null;
    },
    [refreshUsersList],
  );

  const handleSearchSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    updateQuery({ search: searchInput.trim(), page: 1 });
  };

  const hasActiveFilters = Boolean(query.search || query.status || query.role);
  const items = usersPage?.items ?? [];
  const total = usersPage?.total ?? 0;
  const totalPages = Math.max(1, usersPage?.totalPages ?? 1);

  const errorMessage = error
    ? isApiClientError(error)
      ? `${error.message}${error.actionGuidance ? ` ${error.actionGuidance}` : ''}`
      : '无法加载用户列表，请稍后重试。'
    : null;

  const rolesErrorMessage = rolesFetchError
    ? isApiClientError(rolesFetchError)
      ? `${rolesFetchError.message} ${rolesFetchError.actionGuidance}`
      : '无法加载角色目录，请重试。'
    : null;

  const handleGuardrailViolation = (violation: GuardrailViolationInfo) => {
    refreshUsersList();
    setGuardrailViolation(violation);
  };

  return (
    <ConsoleShell sectionLabel="安全与管控" pageLabel="用户与角色">
      <div className="space-y-4" data-testid="users-view">
        {/* Page Header (Strictly NO fabricated inviteUser button) */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-mono text-[10px] tracking-[0.16em] text-primary uppercase">
              SECURITY &amp; GOVERNANCE / USER LIFECYCLE
            </div>
            <h1 className="mt-1 text-xl font-semibold text-fg-main">用户与角色管理</h1>
            <p className="mt-1 text-xs text-fg-muted">
              全量用户角色绑定、启停治理、临时密码重置与物理删除；系统强制执行最后活跃超管防自残与本人操作保护。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link to="/approvals">
                <Icon name="user-check" className="size-3.5" />
                <span>审批工单中心</span>
              </Link>
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={isFetching}
              data-testid="users-refresh-btn"
              onClick={() => void refetch()}
            >
              <Icon
                name="refresh"
                className={isFetching ? 'size-3.5 animate-spin' : 'size-3.5'}
              />
              <span>刷新列表</span>
            </Button>
          </div>
        </div>

        {/* Guardrail Policy Banner */}
        <Alert variant="info" icon="shield">
          <span className="font-medium text-fg-main">防自残与并发锁序保护已启用：</span>
          <span className="text-fg-muted">
            当前登录账号自身与最后 1 名活跃 SUPER_ADMIN 均禁用停用、删除及取消超管角色；待审 / 已驳回账号须通过审批中心流转，不可直接启停。
          </span>
        </Alert>

        {errorMessage && (
          <Alert variant="danger" data-testid="users-error-alert">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>{errorMessage}</span>
              <Button variant="outline" size="xs" onClick={() => void refetch()}>
                重试加载
              </Button>
            </div>
          </Alert>
        )}

        {/* Dense Users Table Card with URL-SSOT Filter Bar */}
        <Card>
          <CardHeader className="flex-col gap-3 border-b border-border-line pb-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>
                <Icon name="users" className="size-4 text-primary" />
                <span>用户账号台账</span>
              </CardTitle>
              <CardDescription>
                筛选条件与分页实时同步至 URL 查询参数；所有修改携带乐观锁版本号（409 冲突完整保留草稿）。
              </CardDescription>
            </div>
            <Badge variant="neutral" dot={false} mono>
              {total} USERS
            </Badge>
          </CardHeader>

          {/* Compact Filter Bar */}
          <div className="flex flex-wrap items-center gap-2 border-b border-border-line bg-bg-surface/40 px-4 py-2.5">
            <form
              onSubmit={handleSearchSubmit}
              className="flex min-w-[220px] flex-1 items-center gap-1.5 sm:max-w-xs"
            >
              <div className="relative flex-1">
                <Icon
                  name="search"
                  className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-fg-subtle"
                />
                <Input
                  type="search"
                  aria-label="搜索用户名或邮箱"
                  placeholder="搜索用户名或邮箱…"
                  value={searchInput}
                  data-testid="users-search-input"
                  className="h-7 pl-8 text-xs"
                  onChange={(event) => {
                    const nextVal = event.target.value;
                    setSearchInput(nextVal);
                    if (nextVal === '' && query.search !== '') {
                      updateQuery({ search: '', page: 1 });
                    }
                  }}
                />
              </div>
              <Button type="submit" variant="secondary" size="xs" data-testid="users-search-submit-btn">
                搜索
              </Button>
            </form>

            <Select
              aria-label="按账号状态筛选"
              data-testid="users-status-filter"
              className="h-7 w-[140px] px-2 text-xs"
              value={query.status}
              onChange={(event) => {
                const value = event.target.value as UserStatus | '';
                updateQuery({ status: value, page: 1 });
              }}
            >
              <option value="">全部状态</option>
              <option value="ACTIVE">ACTIVE (活跃)</option>
              <option value="DISABLED">DISABLED (已停用)</option>
              <option value="PENDING">PENDING (待审批)</option>
              <option value="REJECTED">REJECTED (已驳回)</option>
            </Select>

            <Select
              aria-label="按角色筛选"
              data-testid="users-role-filter"
              className="h-7 w-[176px] px-2 text-xs"
              value={query.role}
              onChange={(event) => updateQuery({ role: event.target.value, page: 1 })}
            >
              <option value="">全部角色</option>
              {roles.map((role) => (
                <option key={role.id} value={role.role_name}>
                  {role.display_name} ({role.role_name})
                </option>
              ))}
            </Select>

            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="xs"
                data-testid="users-clear-filters-btn"
                onClick={() => {
                  setSearchInput('');
                  updateQuery({ search: '', status: '', role: '', page: 1 });
                }}
              >
                <Icon name="x" className="size-3" />
                <span>清空筛选</span>
              </Button>
            )}
          </div>

          <CardContent className="p-0">
            {isLoading ? (
              <div
                data-testid="users-loading-state"
                className="flex items-center justify-center gap-2 py-12 text-xs text-fg-muted"
              >
                <Icon name="loader" className="size-4 animate-spin text-primary" />
                <span>正在加载用户台账…</span>
              </div>
            ) : items.length === 0 ? (
              <div
                data-testid="users-empty-state"
                className="flex flex-col items-center justify-center px-6 py-12 text-center"
              >
                <span className="grid size-10 place-items-center rounded-md border border-border-line bg-bg-surface text-fg-muted">
                  <Icon name="users" className="size-5" />
                </span>
                <p className="mt-3 text-sm font-medium text-fg-main">
                  {hasActiveFilters ? '未找到匹配筛选条件的用户' : '暂无用户记录'}
                </p>
                <p className="mt-1 max-w-md text-xs text-fg-muted">
                  {hasActiveFilters
                    ? '请调整搜索关键词、状态或角色筛选条件后重试。'
                    : '新用户需先通过自主注册提交审批工单。'}
                </p>
                {hasActiveFilters && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-4"
                    onClick={() => {
                      setSearchInput('');
                      updateQuery({ search: '', status: '', role: '', page: 1 });
                    }}
                  >
                    清空筛选条件
                  </Button>
                )}
              </div>
            ) : (
              <TableContainer aria-label="用户与角色列表" className="max-h-[560px]">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>用户 / ID</TableHead>
                      <TableHead>邮箱 · 部门</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead>绑定角色</TableHead>
                      <TableHead>版本</TableHead>
                      <TableHead>更新时间</TableHead>
                      <TableHead className="text-right">治理操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((rowUser) => {
                      const guardrails = evaluateUserGuardrails(rowUser, currentUser.id);
                      const statusConfig = getStatusBadgeConfig(rowUser.status);

                      return (
                        <TableRow
                          key={rowUser.id}
                          data-testid="user-table-row"
                          data-user-id={rowUser.id}
                          data-username={rowUser.username}
                          data-user-version={String(rowUser.version)}
                        >
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono font-medium text-fg-main">
                                {rowUser.username}
                              </span>
                              <span className="font-mono text-[10px] text-fg-subtle tabular-nums">
                                #{rowUser.id}
                              </span>
                              {guardrails.isSelf && (
                                <Badge
                                  variant="primary"
                                  dot={false}
                                  className="px-1.5 py-0 text-[10px]"
                                  data-testid={`user-self-badge-${rowUser.username}`}
                                >
                                  本人
                                </Badge>
                              )}
                              {guardrails.isLastSuperAdmin && (
                                <Badge
                                  variant="warning"
                                  dot={false}
                                  className="px-1.5 py-0 text-[10px]"
                                  data-testid={`user-last-super-badge-${rowUser.username}`}
                                >
                                  唯一超管
                                </Badge>
                              )}
                            </div>
                          </TableCell>

                          <TableCell className="max-w-[220px] truncate">
                            <span className="text-fg-muted">{rowUser.email ?? '—'}</span>
                            {rowUser.department && (
                              <span className="ml-1.5 text-[11px] text-fg-subtle">
                                · {rowUser.department}
                              </span>
                            )}
                          </TableCell>

                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              <Badge
                                variant={statusConfig.variant}
                                mono
                                data-testid={`user-status-badge-${rowUser.username}`}
                              >
                                {statusConfig.label}
                              </Badge>
                              {rowUser.must_change_password && (
                                <Badge
                                  variant="warning"
                                  dot={false}
                                  className="px-1.5 py-0 text-[10px]"
                                >
                                  待改密
                                </Badge>
                              )}
                              {rowUser.is_password_expired && (
                                <Badge
                                  variant="danger"
                                  dot={false}
                                  className="px-1.5 py-0 text-[10px]"
                                >
                                  密码过期
                                </Badge>
                              )}
                            </div>
                          </TableCell>

                          <TableCell>
                            <div
                              className="flex flex-wrap items-center gap-1"
                              data-testid={`user-roles-cell-${rowUser.username}`}
                            >
                              {rowUser.roles.length > 0 ? (
                                rowUser.roles.map((role) => (
                                  <Badge
                                    key={role.id}
                                    variant={role.role_name === 'SUPER_ADMIN' ? 'secret' : 'neutral'}
                                    dot={false}
                                    mono
                                    className="px-1.5 py-0 text-[10px]"
                                  >
                                    {role.role_name}
                                  </Badge>
                                ))
                              ) : (
                                <span className="text-[11px] text-fg-subtle">无角色</span>
                              )}
                            </div>
                          </TableCell>

                          <TableCell className="font-mono text-[11px] text-fg-muted tabular-nums">
                            v{rowUser.version}
                          </TableCell>

                          <TableCell className="font-mono text-[11px] tabular-nums">
                            {formatTimestamp(rowUser.updated_at)}
                          </TableCell>

                          <TableCell className="text-right">
                            <div className="inline-flex items-center justify-end gap-1.5">
                              {/* Edit Roles */}
                              <Button
                                variant="outline"
                                size="xs"
                                data-testid={`edit-roles-btn-${rowUser.username}`}
                                onClick={() => setEditRolesTarget(rowUser)}
                              >
                                <Icon name="shield" className="size-3" />
                                <span>角色</span>
                              </Button>

                              {/* Status Toggle (ONLY for ACTIVE/DISABLED; PENDING/REJECTED routed to /approvals) */}
                              {guardrails.isManageableStatus ? (
                                rowUser.status === 'ACTIVE' ? (
                                  guardrails.canDisable ? (
                                    <Button
                                      variant="outline"
                                      size="xs"
                                      data-testid={`toggle-status-btn-${rowUser.username}`}
                                      onClick={() => setToggleStatusTarget(rowUser)}
                                    >
                                      <Icon name="user-x" className="size-3" />
                                      <span>停用</span>
                                    </Button>
                                  ) : (
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <span
                                          tabIndex={0}
                                          className="inline-flex cursor-not-allowed"
                                          data-testid={`toggle-status-guard-wrap-${rowUser.username}`}
                                        >
                                          <Button
                                            variant="outline"
                                            size="xs"
                                            disabled
                                            data-testid={`toggle-status-btn-${rowUser.username}`}
                                            aria-label={`停用 ${rowUser.username}（已受保护禁用）`}
                                          >
                                            <Icon name="lock" className="size-3" />
                                            <span>停用</span>
                                          </Button>
                                        </span>
                                      </TooltipTrigger>
                                      <TooltipContent
                                        data-testid={`toggle-status-tooltip-${rowUser.username}`}
                                      >
                                        {guardrails.disableReason}
                                      </TooltipContent>
                                    </Tooltip>
                                  )
                                ) : (
                                  <Button
                                    variant="secondary"
                                    size="xs"
                                    data-testid={`toggle-status-btn-${rowUser.username}`}
                                    onClick={() => setToggleStatusTarget(rowUser)}
                                  >
                                    <Icon name="user-check" className="size-3" />
                                    <span>解冻</span>
                                  </Button>
                                )
                              ) : rowUser.status === 'PENDING' ? (
                                <Button
                                  variant="ghost"
                                  size="xs"
                                  asChild
                                  data-testid={`go-approval-link-${rowUser.username}`}
                                >
                                  <Link to="/approvals">
                                    <Icon name="external-link" className="size-3" />
                                    <span>去审批</span>
                                  </Link>
                                </Button>
                              ) : (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span
                                      tabIndex={0}
                                      className="inline-flex items-center px-1.5 text-[11px] text-fg-subtle"
                                    >
                                      审批流转
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    已驳回账号需由申请人重新提交并经审批中心批准后激活，不支持直接启停。
                                  </TooltipContent>
                                </Tooltip>
                              )}

                              {/* Reset Password */}
                              <Button
                                variant="outline"
                                size="xs"
                                data-testid={`reset-password-btn-${rowUser.username}`}
                                onClick={() => setResetPwdTarget(rowUser)}
                              >
                                <Icon name="key" className="size-3" />
                                <span>重置密码</span>
                              </Button>

                              {/* Delete User (Guarded for self and last SUPER_ADMIN) */}
                              {guardrails.canDelete ? (
                                <Button
                                  variant="destructive"
                                  size="xs"
                                  data-testid={`delete-user-btn-${rowUser.username}`}
                                  onClick={() => setDeleteTarget(rowUser)}
                                >
                                  <Icon name="trash" className="size-3" />
                                  <span>删除</span>
                                </Button>
                              ) : (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span
                                      tabIndex={0}
                                      className="inline-flex cursor-not-allowed"
                                      data-testid={`delete-user-guard-wrap-${rowUser.username}`}
                                    >
                                      <Button
                                        variant="destructive"
                                        size="xs"
                                        disabled
                                        data-testid={`delete-user-btn-${rowUser.username}`}
                                        aria-label={`删除 ${rowUser.username}（已受保护禁用）`}
                                      >
                                        <Icon name="lock" className="size-3" />
                                        <span>删除</span>
                                      </Button>
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent
                                    data-testid={`delete-user-tooltip-${rowUser.username}`}
                                  >
                                    {guardrails.deleteReason}
                                  </TooltipContent>
                                </Tooltip>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </CardContent>

          <CardFooter className="flex-wrap text-xs text-fg-muted">
            <div className="font-mono text-[11px] tabular-nums" data-testid="users-pagination-info">
              共 {total} 位用户 · 第 {query.page} / {totalPages} 页
            </div>
            <div className="flex items-center gap-2">
              <label className="inline-flex items-center gap-1.5 text-[11px] text-fg-subtle">
                <span>每页</span>
                <Select
                  aria-label="每页显示条数"
                  className="h-7 w-[72px] px-2 font-mono text-[11px] tabular-nums"
                  value={String(query.pageSize)}
                  onChange={(event) => {
                    const nextSize = Number.parseInt(event.target.value, 10);
                    if (Number.isSafeInteger(nextSize)) {
                      updateQuery({ page: 1, pageSize: nextSize });
                    }
                  }}
                >
                  {PAGE_SIZE_OPTIONS.map((size) => (
                    <option key={size} value={String(size)}>
                      {size}
                    </option>
                  ))}
                </Select>
              </label>
              <Button
                variant="outline"
                size="xs"
                disabled={query.page <= 1 || isFetching}
                data-testid="users-prev-page-btn"
                onClick={() => updateQuery({ page: Math.max(1, query.page - 1) })}
              >
                <Icon name="chevron-left" className="size-3" />
                <span>上一页</span>
              </Button>
              <Button
                variant="outline"
                size="xs"
                disabled={query.page >= totalPages || isFetching}
                data-testid="users-next-page-btn"
                onClick={() => updateQuery({ page: Math.min(totalPages, query.page + 1) })}
              >
                <span>下一页</span>
                <Icon name="chevron-right" className="size-3" />
              </Button>
            </div>
          </CardFooter>
        </Card>

        <EditUserRolesModal
          target={editRolesTarget}
          currentUserId={currentUser.id}
          roles={roles}
          rolesLoading={rolesLoading}
          rolesError={rolesErrorMessage}
          onRetryRoles={() => void refetchRoles()}
          onFetchLatestUser={handleFetchLatestUser}
          onClose={() => setEditRolesTarget(null)}
          onUpdated={(updatedUser, nextVersion) => {
            refreshUsersList();
            pushToast(
              '用户角色已更新',
              `账号「${updatedUser.username}」角色绑定已更新至版本 v${nextVersion}。`,
              'safe',
            );
          }}
          onGuardrailViolation={handleGuardrailViolation}
        />

        <ToggleUserStatusModal
          target={toggleStatusTarget}
          onFetchLatestUser={handleFetchLatestUser}
          onClose={() => setToggleStatusTarget(null)}
          onUpdated={(updatedUser, nextStatus, nextVersion) => {
            refreshUsersList();
            pushToast(
              nextStatus === 'DISABLED' ? '账号已停用' : '账号已解冻',
              `账号「${updatedUser.username}」已变更为 ${nextStatus}（v${nextVersion}）。`,
              nextStatus === 'DISABLED' ? 'warning' : 'safe',
            );
          }}
          onGuardrailViolation={handleGuardrailViolation}
        />

        <ResetPasswordModal
          target={resetPwdTarget}
          onFetchLatestUser={handleFetchLatestUser}
          onClose={() => setResetPwdTarget(null)}
          onPasswordReset={(updatedUser, nextVersion) => {
            refreshUsersList();
            pushToast(
              '临时密码已重置',
              `账号「${updatedUser.username}」登录口令已更新至 v${nextVersion}，旧会话已清退。`,
              'safe',
            );
          }}
        />

        <DeleteUserModal
          target={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={(deletedUser) => {
            refreshUsersList();
            pushToast(
              '用户账号已永久删除',
              `账号「${deletedUser.username}」及其关联凭据已级联清理。`,
              'warning',
            );
          }}
          onGuardrailViolation={handleGuardrailViolation}
        />

        <GuardrailErrorModal
          violation={guardrailViolation}
          onClose={() => setGuardrailViolation(null)}
        />
      </div>
    </ConsoleShell>
  );
}
