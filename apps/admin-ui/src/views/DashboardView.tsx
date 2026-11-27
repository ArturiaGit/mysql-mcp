import { useEffect } from 'react';
import { Link } from 'react-router';
import { usePasswordPolicy } from '@/api/auth';
import { PROVISIONAL_RD_08_PASSWORD_DAYS_POLICY } from '@/api/schemas/auth.schema';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/form-controls';
import { Icon } from '@/components/ui/icon';
import { useActiveUser } from '@/guards/auth-guards';
import { useHealthProbe } from '@/hooks/useHealthProbe';
import { ConsoleShell } from '@/layouts/ConsoleShell';

export default function DashboardView() {
  const user = useActiveUser();
  const { data: health, isFetching, refetch } = useHealthProbe();
  const { data: policy } = usePasswordPolicy(true);

  useEffect(() => {
    document.title = '工作台大盘 | MySQL MCP Gateway Console';
  }, []);

  const daysText =
    policy === undefined
      ? '加载中…'
      : !policy.isExpirationEnabled ||
          policy.daysRemaining === PROVISIONAL_RD_08_PASSWORD_DAYS_POLICY.disabledValue
        ? '永不过期（已关闭）'
        : `${policy.daysRemaining} 天`;

  return (
    <ConsoleShell sectionLabel="运维与监控" pageLabel="工作台大盘">
      <div className="space-y-4" data-testid="dashboard-view">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-mono text-[10px] tracking-[0.16em] text-primary uppercase">
              MYSQL MCP GATEWAY · AUTHENTICATED SESSION
            </div>
            <h1 className="mt-1 text-xl font-semibold text-fg-main">
              欢迎回来，{user.username}
            </h1>
            <p className="mt-1 text-xs text-fg-muted">
              当前会话已通过四级安全守卫（Auth → Status → MustChangePwd → Role），管控面实时直连后端。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link to="/developer/pats">
                <Icon name="key" className="size-3.5" />
                <span>个人访问令牌</span>
              </Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link to="/developer/config">
                <Icon name="terminal" className="size-3.5" />
                <span>客户端接入配置</span>
              </Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link to="/change-password">
                <Icon name="lock" className="size-3.5" />
                <span>密码与轮换策略</span>
              </Link>
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={isFetching}
              onClick={() => void refetch()}
            >
              <Icon name="refresh" className={isFetching ? 'size-3.5 animate-spin' : 'size-3.5'} />
              <span>刷新健康探针</span>
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>
                  <Icon name="user-check" className="size-4 text-safe" />
                  <span>当前会话身份</span>
                </CardTitle>
                <CardDescription>EntityId (string) · 64 位精度安全</CardDescription>
              </div>
              <Badge variant="safe" mono>
                {user.status}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-1.5 font-mono text-xs tabular-nums">
              <div className="flex justify-between gap-2">
                <span className="text-fg-subtle">ID</span>
                <span className="text-fg-main" data-testid="dashboard-user-id">
                  {user.id}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-fg-subtle">ROLES</span>
                <span className="text-fg-main">{user.roles.join(', ')}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-fg-subtle">VERSION</span>
                <span className="text-fg-main">v{user.version}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>
                  <Icon name="clock" className="size-4 text-primary" />
                  <span>密码有效期状态</span>
                </CardTitle>
                <CardDescription>可配置 30~180 天轮换周期</CardDescription>
              </div>
              <Badge
                variant={
                  policy && !policy.isExpirationEnabled
                    ? 'warning'
                    : user.is_password_expired
                      ? 'danger'
                      : 'safe'
                }
                mono
              >
                {policy && !policy.isExpirationEnabled ? 'NO EXPIRY' : 'PROTECTED'}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-1.5 font-mono text-xs tabular-nums">
              <div className="flex justify-between gap-2">
                <span className="text-fg-subtle">剩余有效天数</span>
                <span className="text-fg-main">{daysText}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-fg-subtle">强制改密标记</span>
                <span className="text-fg-main">{user.must_change_password ? 'TRUE' : 'FALSE'}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>
                  <Icon name="heart-pulse" className="size-4 text-primary" />
                  <span>管控面探针 (:8081)</span>
                </CardTitle>
                <CardDescription>/health/live · /health/ready</CardDescription>
              </div>
              <Badge variant={health?.ready.ok ? 'safe' : 'warning'} mono>
                {health?.ready.ok ? 'READY' : 'PROBING'}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-1.5 font-mono text-xs tabular-nums">
              <div className="flex justify-between gap-2">
                <span className="text-fg-subtle">LIVE</span>
                <span className="text-fg-main">
                  {health ? `${health.live.statusText.toUpperCase()} · ${health.live.latencyMs}ms` : '—'}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-fg-subtle">READY</span>
                <span className="text-fg-main">
                  {health ? `${health.ready.statusText.toUpperCase()} · ${health.ready.latencyMs}ms` : '—'}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </ConsoleShell>
  );
}
