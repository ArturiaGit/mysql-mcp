import type { PendingApprovalDTO } from '@mysql-mcp/shared-types';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { isApiClientError } from '@/api/client';
import {
  buildApprovalsSearchParams,
  PAGE_SIZE_OPTIONS,
  parseApprovalsSearchParams,
  type ApprovalsSearchQuery,
} from '@/api/schemas/user-administration.schema';
import {
  pendingApprovalsQueryKey,
  usePendingApprovals,
  useRolesCatalog,
  usersListQueryKey,
} from '@/api/user-administration';
import {
  ApprovalApproveModal,
  ApprovalRejectModal,
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

export default function ApprovalsView() {
  const currentUser = useActiveUser();
  const queryClient = useQueryClient();
  const pushToast = useToastStore((state) => state.push);
  const [searchParams, setSearchParams] = useSearchParams();

  const query = useMemo(() => parseApprovalsSearchParams(searchParams), [searchParams]);
  const actorIsSuperAdmin = currentUser.roles.includes('SUPER_ADMIN');

  const {
    data: approvalsPage,
    isLoading,
    isFetching,
    error,
    refetch,
  } = usePendingApprovals(currentUser.id, query);

  const {
    data: roles = [],
    isLoading: rolesLoading,
    error: rolesFetchError,
    refetch: refetchRoles,
  } = useRolesCatalog(currentUser.id);

  const [approveTarget, setApproveTarget] = useState<PendingApprovalDTO | null>(null);
  const [rejectTarget, setRejectTarget] = useState<PendingApprovalDTO | null>(null);

  useEffect(() => {
    document.title = '审批工单中心 | MySQL MCP Gateway Console';
  }, []);

  const updateQuery = (patch: Partial<ApprovalsSearchQuery>) => {
    const next: ApprovalsSearchQuery = { ...query, ...patch };
    setSearchParams(buildApprovalsSearchParams(next), { replace: true });
  };

  // If the current page became empty after deciding the last ticket on that page, clamp back smoothly
  useEffect(() => {
    if (
      approvalsPage &&
      approvalsPage.items.length === 0 &&
      query.page > 1 &&
      approvalsPage.totalPages < query.page
    ) {
      const clampedPage = Math.max(1, approvalsPage.totalPages);
      setSearchParams(
        buildApprovalsSearchParams({ ...query, page: clampedPage }),
        { replace: true },
      );
    }
  }, [approvalsPage, query, setSearchParams]);

  const items = approvalsPage?.items ?? [];
  const total = approvalsPage?.total ?? 0;
  const totalPages = Math.max(1, approvalsPage?.totalPages ?? 1);

  const errorMessage = error
    ? isApiClientError(error)
      ? `${error.message}${error.actionGuidance ? ` ${error.actionGuidance}` : ''}`
      : '无法加载待审批工单列表，请稍后重试。'
    : null;

  const rolesErrorMessage = rolesFetchError
    ? isApiClientError(rolesFetchError)
      ? `${rolesFetchError.message} ${rolesFetchError.actionGuidance}`
      : '无法加载角色目录，请重试。'
    : null;

  const refreshAll = () => {
    void queryClient.invalidateQueries({ queryKey: pendingApprovalsQueryKey(currentUser.id) });
    void queryClient.invalidateQueries({ queryKey: usersListQueryKey(currentUser.id) });
  };

  return (
    <ConsoleShell sectionLabel="安全与管控" pageLabel="审批工单中心">
      <div className="space-y-4" data-testid="approvals-view">
        {/* Page Header */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-mono text-[10px] tracking-[0.16em] text-primary uppercase">
              SECURITY &amp; GOVERNANCE / APPROVAL QUEUE
            </div>
            <h1 className="mt-1 text-xl font-semibold text-fg-main">审批工单中心</h1>
            <p className="mt-1 text-xs text-fg-muted">
              审核自主注册及驳回重提账号申请，批准时须分配服务端真实角色；全部审批变更严格等待服务端事务确认（非乐观更新）。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={isFetching}
              data-testid="approvals-refresh-btn"
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

        {/* High-density KPI Strip */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Card>
            <CardContent className="pt-3.5 pb-3.5">
              <div className="flex items-center justify-between text-xs text-fg-muted">
                <span>待审批注册工单</span>
                <Icon name="user-check" className="size-3.5 text-warning" />
              </div>
              <div
                className="mt-1.5 font-mono text-2xl font-semibold text-fg-main tabular-nums"
                data-testid="approvals-total-count"
              >
                {total}
              </div>
              <div className="mt-0.5 text-[11px] text-fg-subtle tabular-nums">
                当前第 {query.page} / {totalPages} 页 · 每页 {query.pageSize} 条
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-3.5 pb-3.5">
              <div className="flex items-center justify-between text-xs text-fg-muted">
                <span>可选角色目录</span>
                <Icon name="shield" className="size-3.5 text-primary" />
              </div>
              <div className="mt-1.5 font-mono text-2xl font-semibold text-fg-main tabular-nums">
                {roles.length}
              </div>
              <div className="mt-0.5 text-[11px] text-fg-subtle">
                实时读取自服务端角色策略表（无硬编码角色）
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-3.5 pb-3.5">
              <div className="flex items-center justify-between text-xs text-fg-muted">
                <span>审批授权边界</span>
                <Icon name="lock" className="size-3.5 text-safe" />
              </div>
              <div className="mt-1.5 font-mono text-sm font-semibold text-fg-main">
                {actorIsSuperAdmin ? 'SUPER_ADMIN 全角色可授' : 'SECURITY_ADMIN 提权受限'}
              </div>
              <div className="mt-1 text-[11px] text-fg-subtle">
                {actorIsSuperAdmin
                  ? '可分配全部系统角色并激活待审账号'
                  : '禁止授予 SUPER_ADMIN 角色，仅可分配非超管角色'}
              </div>
            </CardContent>
          </Card>
        </div>

        {errorMessage && (
          <Alert variant="danger" data-testid="approvals-error-alert">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>{errorMessage}</span>
              <Button variant="outline" size="xs" onClick={() => void refetch()}>
                重试加载
              </Button>
            </div>
          </Alert>
        )}

        {/* 38px Dense Pending Approvals Table */}
        <Card>
          <CardHeader className="border-b border-border-line pb-3">
            <div>
              <CardTitle>
                <Icon name="user-check" className="size-4 text-primary" />
                <span>待审注册申请列表</span>
              </CardTitle>
              <CardDescription>
                按提交时间倒序展示处于 PENDING 状态的工单；支持批准赋权激活或填写理由驳回。
              </CardDescription>
            </div>
            <Badge variant={total > 0 ? 'warning' : 'safe'} mono>
              {total} PENDING
            </Badge>
          </CardHeader>

          <CardContent className="p-0">
            {isLoading ? (
              <div
                data-testid="approvals-loading-state"
                className="flex items-center justify-center gap-2 py-12 text-xs text-fg-muted"
              >
                <Icon name="loader" className="size-4 animate-spin text-primary" />
                <span>正在加载待审批工单…</span>
              </div>
            ) : items.length === 0 ? (
              <div
                data-testid="approvals-empty-state"
                className="flex flex-col items-center justify-center px-6 py-12 text-center"
              >
                <span className="grid size-10 place-items-center rounded-md border border-border-line bg-bg-surface text-safe">
                  <Icon name="check-circle" className="size-5" />
                </span>
                <p className="mt-3 text-sm font-medium text-fg-main">当前无待审批注册工单</p>
                <p className="mt-1 max-w-md text-xs text-fg-muted">
                  所有用户注册与重新提交申请均已处理完毕；当有新申请入队时，将在此列表实时呈现。
                </p>
              </div>
            ) : (
              <TableContainer aria-label="待审批注册工单列表" className="max-h-[560px]">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>工单 ID</TableHead>
                      <TableHead>申请人</TableHead>
                      <TableHead>工作邮箱</TableHead>
                      <TableHead>所属部门</TableHead>
                      <TableHead>申请理由</TableHead>
                      <TableHead>提交时间</TableHead>
                      <TableHead className="text-right">审核操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((item) => (
                      <TableRow
                        key={item.id}
                        data-testid="approval-table-row"
                        data-approval-id={item.id}
                        data-username={item.username}
                      >
                        <TableCell className="font-mono text-[11px] text-fg-subtle tabular-nums">
                          #{item.id}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-medium text-fg-main">
                              {item.username}
                            </span>
                            <span className="font-mono text-[10px] text-fg-subtle tabular-nums">
                              UID:{item.user_id}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate">
                          {item.email ?? <span className="text-fg-subtle">—</span>}
                        </TableCell>
                        <TableCell className="max-w-[160px] truncate">
                          {item.department ?? <span className="text-fg-subtle">—</span>}
                        </TableCell>
                        <TableCell
                          className="max-w-[280px] truncate text-fg-main"
                          title={item.reason ?? undefined}
                        >
                          {item.reason?.trim() ? (
                            item.reason
                          ) : (
                            <span className="text-fg-subtle">未填写</span>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-[11px] tabular-nums">
                          {formatTimestamp(item.created_at)}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="inline-flex items-center justify-end gap-1.5">
                            <Button
                              variant="default"
                              size="xs"
                              data-testid={`approve-ticket-btn-${item.username}`}
                              onClick={() => setApproveTarget(item)}
                            >
                              <Icon name="check" className="size-3" />
                              <span>批准</span>
                            </Button>
                            <Button
                              variant="destructive"
                              size="xs"
                              data-testid={`reject-ticket-btn-${item.username}`}
                              onClick={() => setRejectTarget(item)}
                            >
                              <Icon name="ban" className="size-3" />
                              <span>驳回</span>
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </CardContent>

          <CardFooter className="flex-wrap text-xs text-fg-muted">
            <div className="font-mono text-[11px] tabular-nums" data-testid="approvals-pagination-info">
              共 {total} 条待审工单 · 第 {query.page} / {totalPages} 页
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
                data-testid="approvals-prev-page-btn"
                onClick={() => updateQuery({ page: Math.max(1, query.page - 1) })}
              >
                <Icon name="chevron-left" className="size-3" />
                <span>上一页</span>
              </Button>
              <Button
                variant="outline"
                size="xs"
                disabled={query.page >= totalPages || isFetching}
                data-testid="approvals-next-page-btn"
                onClick={() => updateQuery({ page: Math.min(totalPages, query.page + 1) })}
              >
                <span>下一页</span>
                <Icon name="chevron-right" className="size-3" />
              </Button>
            </div>
          </CardFooter>
        </Card>

        <ApprovalApproveModal
          target={approveTarget}
          roles={roles}
          rolesLoading={rolesLoading}
          rolesError={rolesErrorMessage}
          onRetryRoles={() => void refetchRoles()}
          actorIsSuperAdmin={actorIsSuperAdmin}
          onClose={() => setApproveTarget(null)}
          onApproved={(approval, assignedRoleNames) => {
            refreshAll();
            pushToast(
              '已批准并激活账号',
              `用户「${approval.username}」已激活并分配角色：${assignedRoleNames.join('、')}。`,
              'safe',
            );
          }}
          onStateConflict={() => {
            refreshAll();
          }}
        />

        <ApprovalRejectModal
          target={rejectTarget}
          onClose={() => setRejectTarget(null)}
          onRejected={(approval) => {
            refreshAll();
            pushToast(
              '已驳回注册申请',
              `用户「${approval.username}」状态已流转为 REJECTED，可补充信息后重提。`,
              'warning',
            );
          }}
          onStateConflict={() => {
            refreshAll();
          }}
        />
      </div>
    </ConsoleShell>
  );
}
