import type { PatListItemDTO } from '@mysql-mcp/shared-types';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { isApiClientError } from '@/api/client';
import { PATS_QUERY_KEY, useMyPats, useMyProfileOptions } from '@/api/pats';
import { PatCreateModal, PatRevokeModal } from '@/components/domain/pat-modal';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Alert,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
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
import { ConsoleShell } from '@/layouts/ConsoleShell';
import { useToastStore } from '@/stores/useToastStore';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function formatUtcTimestamp(iso: string | null): string {
  if (!iso) return '—';
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

function getPatStatus(pat: PatListItemDTO, nowMs: number): {
  kind: 'active' | 'expiring' | 'expired';
  label: string;
  variant: 'safe' | 'warning' | 'danger';
} {
  if (!pat.expires_at) {
    return { kind: 'active', label: 'ACTIVE', variant: 'safe' };
  }
  const expiresMs = Date.parse(pat.expires_at);
  if (Number.isNaN(expiresMs)) {
    return { kind: 'active', label: 'ACTIVE', variant: 'safe' };
  }
  if (expiresMs <= nowMs) {
    return { kind: 'expired', label: 'EXPIRED', variant: 'danger' };
  }
  if (expiresMs - nowMs <= SEVEN_DAYS_MS) {
    return { kind: 'expiring', label: 'EXPIRING', variant: 'warning' };
  }
  return { kind: 'active', label: 'ACTIVE', variant: 'safe' };
}

export default function MyTokensView() {
  const queryClient = useQueryClient();
  const pushToast = useToastStore((state) => state.push);
  const { data: pats = [], isLoading, isFetching, error, refetch } = useMyPats();
  const { data: profileOptions = [] } = useMyProfileOptions();

  const [createOpen, setCreateOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<PatListItemDTO | null>(null);

  useEffect(() => {
    document.title = '个人访问令牌 (PAT) | MySQL MCP Gateway Console';
  }, []);

  const summary = useMemo(() => {
    const nowMs = Date.now();
    let activeCount = 0;
    let expiringSoonCount = 0;
    let expiredCount = 0;

    for (const pat of pats) {
      const status = getPatStatus(pat, nowMs);
      if (status.kind === 'expired') {
        expiredCount += 1;
      } else {
        activeCount += 1;
        if (status.kind === 'expiring') {
          expiringSoonCount += 1;
        }
      }
    }

    return {
      total: pats.length,
      activeCount,
      expiringSoonCount,
      expiredCount,
      nowMs,
    };
  }, [pats]);

  const errorMessage = error
    ? isApiClientError(error)
      ? `${error.message}${error.actionGuidance ? ` ${error.actionGuidance}` : ''}`
      : '无法加载个人访问令牌列表，请稍后重试。'
    : null;

  return (
    <ConsoleShell sectionLabel="开发者自服务" pageLabel="个人访问令牌 (PAT)">
      <div className="mx-auto max-w-4xl space-y-4" data-testid="my-tokens-view">
        {/* Page Header */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-mono text-[10px] tracking-[0.16em] text-primary uppercase">
              DEVELOPER / PERSONAL ACCESS TOKENS
            </div>
            <h1 className="mt-1 text-xl font-semibold text-fg-main">个人访问令牌 (PAT)</h1>
            <p className="mt-1 text-xs text-fg-muted">
              用于 Claude Desktop、Codex 及自动化客户端认证接入 MCP 数据面网关；服务端仅存储不可逆 HMAC-SHA-256 哈希。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link to="/developer/config">
                <Icon name="terminal" className="size-3.5" />
                <span>客户端接入配置</span>
              </Link>
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={isFetching}
              onClick={() => void refetch()}
            >
              <Icon name="refresh" className={isFetching ? 'size-3.5 animate-spin' : 'size-3.5'} />
              <span>刷新</span>
            </Button>
            <Button
              variant="default"
              size="sm"
              data-testid="open-create-pat-btn"
              onClick={() => setCreateOpen(true)}
            >
              <Icon name="plus" className="size-3.5" />
              <span>签发新令牌</span>
            </Button>
          </div>
        </div>

        {/* Summary KPI Strip */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Card>
            <CardContent className="pt-3.5 pb-3.5">
              <div className="flex items-center justify-between text-xs text-fg-muted">
                <span>当前有效令牌</span>
                <Icon name="key" className="size-3.5 text-secret" />
              </div>
              <div
                className="mt-1.5 font-mono text-2xl font-semibold text-fg-main tabular-nums"
                data-testid="pat-active-count"
              >
                {summary.activeCount}
              </div>
              <div className="mt-0.5 text-[11px] text-fg-subtle tabular-nums">
                列表总计 {summary.total} 枚（含过期 {summary.expiredCount} 枚）
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-3.5 pb-3.5">
              <div className="flex items-center justify-between text-xs text-fg-muted">
                <span>7 天内即将到期</span>
                <Icon name="clock" className="size-3.5 text-warning" />
              </div>
              <div className="mt-1.5 font-mono text-2xl font-semibold text-fg-main tabular-nums">
                {summary.expiringSoonCount}
              </div>
              <div className="mt-0.5 text-[11px] text-fg-subtle">
                建议提前轮换并吊销旧客户端凭据
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-3.5 pb-3.5">
              <div className="flex items-center justify-between text-xs text-fg-muted">
                <span>凭据安全基线</span>
                <Icon name="shield" className="size-3.5 text-safe" />
              </div>
              <div className="mt-1.5 font-mono text-sm font-semibold text-fg-main">
                HMAC-SHA-256 · 单次展示
              </div>
              <div className="mt-1 text-[11px] text-fg-subtle">
                列表仅返回脱敏前缀，明文绝不落库或二次回显
              </div>
            </CardContent>
          </Card>
        </div>

        {errorMessage && (
          <Alert variant="danger" data-testid="pats-error-alert">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>{errorMessage}</span>
              <Button variant="outline" size="xs" onClick={() => void refetch()}>
                重试加载
              </Button>
            </div>
          </Alert>
        )}

        {/* Dense PAT Table */}
        <Card>
          <CardHeader className="border-b border-border-line pb-3">
            <div>
              <CardTitle>
                <Icon name="key" className="size-4 text-primary" />
                <span>我的令牌列表</span>
              </CardTitle>
              <CardDescription>
                仅展示当前登录账号名下未吊销的个人访问令牌；吊销后立即生效并写入安全审计日志。
              </CardDescription>
            </div>
            <Badge variant="neutral" dot={false} mono>
              {pats.length} ITEMS
            </Badge>
          </CardHeader>

          <CardContent className="p-0">
            {isLoading ? (
              <div
                data-testid="pats-loading-state"
                className="flex items-center justify-center gap-2 py-12 text-xs text-fg-muted"
              >
                <Icon name="loader" className="size-4 animate-spin text-primary" />
                <span>正在加载个人访问令牌…</span>
              </div>
            ) : pats.length === 0 ? (
              <div
                data-testid="pats-empty-state"
                className="flex flex-col items-center justify-center px-6 py-12 text-center"
              >
                <span className="grid size-10 place-items-center rounded-md border border-border-line bg-bg-surface text-fg-muted">
                  <Icon name="key" className="size-5" />
                </span>
                <p className="mt-3 text-sm font-medium text-fg-main">暂无个人访问令牌</p>
                <p className="mt-1 max-w-md text-xs text-fg-muted">
                  签发首枚个人访问令牌后，即可在 Claude Desktop、Codex 或 cURL 中安全接入您有权的 MySQL 数据源。
                </p>
                <Button
                  variant="default"
                  size="sm"
                  className="mt-4"
                  onClick={() => setCreateOpen(true)}
                >
                  <Icon name="plus" className="size-3.5" />
                  <span>立即签发新令牌</span>
                </Button>
              </div>
            ) : (
              <TableContainer aria-label="个人访问令牌列表">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>令牌名称</TableHead>
                      <TableHead>前缀标识</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead>创建时间</TableHead>
                      <TableHead>最近使用</TableHead>
                      <TableHead>到期时间</TableHead>
                      <TableHead className="text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pats.map((pat) => {
                      const status = getPatStatus(pat, summary.nowMs);
                      return (
                        <TableRow
                          key={pat.id}
                          data-testid="pat-table-row"
                          data-pat-id={pat.id}
                        >
                          <TableCell className="font-medium text-fg-main">{pat.name}</TableCell>
                          <TableCell>
                            <code
                              data-testid="pat-row-prefix"
                              className="rounded-sm border border-border-line bg-bg-app px-1.5 py-0.5 font-mono text-[11px] text-fg-main"
                            >
                              {pat.token_prefix}…
                            </code>
                          </TableCell>
                          <TableCell>
                            <Badge variant={status.variant} mono>
                              {status.label}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-mono text-[11px] tabular-nums">
                            {formatUtcTimestamp(pat.created_at)}
                          </TableCell>
                          <TableCell className="font-mono text-[11px] tabular-nums">
                            {pat.last_used_at ? formatUtcTimestamp(pat.last_used_at) : '尚未使用'}
                          </TableCell>
                          <TableCell className="font-mono text-[11px] tabular-nums">
                            {formatUtcTimestamp(pat.expires_at)}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="destructive"
                              size="xs"
                              data-testid={`revoke-pat-btn-${pat.id}`}
                              aria-label={`吊销令牌 ${pat.name}`}
                              onClick={() => setRevokeTarget(pat)}
                            >
                              <Icon name="shield-ban" className="size-3" />
                              <span>吊销</span>
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </CardContent>
        </Card>

        <PatCreateModal
          open={createOpen}
          onOpenChange={setCreateOpen}
          profiles={profileOptions}
          onPatCreated={() => {
            void queryClient.invalidateQueries({ queryKey: PATS_QUERY_KEY });
          }}
        />

        <PatRevokeModal
          target={revokeTarget}
          onClose={() => setRevokeTarget(null)}
          onRevoked={(revoked) => {
            void queryClient.invalidateQueries({ queryKey: PATS_QUERY_KEY });
            pushToast(
              '个人访问令牌已吊销',
              `令牌「${revoked.name}」(${revoked.token_prefix}…) 已作废并记录审计。`,
              'safe',
            );
          }}
        />
      </div>
    </ConsoleShell>
  );
}
