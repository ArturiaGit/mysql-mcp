import { useEffect } from 'react';
import { Link } from 'react-router';
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
import { useHealthProbe } from '@/hooks/useHealthProbe';
import { AppShell } from '@/layouts/AppShell';
import type { SidebarNavGroup } from '@/layouts/Sidebar';

export interface FoundationStatusViewProps {
  unavailableRoute?: boolean;
}

export default function FoundationStatusView({
  unavailableRoute = false,
}: FoundationStatusViewProps) {
  const { data: health, isFetching, refetch } = useHealthProbe();

  useEffect(() => {
    document.title = unavailableRoute
      ? '路由不可用 | MySQL MCP Gateway Console'
      : '工程底座状态 (M0) | MySQL MCP Gateway Console';
  }, [unavailableRoute]);

  const navGroups: SidebarNavGroup[] = [
    {
      label: 'FOUNDATION (M0)',
      items: [
        {
          id: 'status',
          label: '底座健康状态',
          icon: 'server',
          active: !unavailableRoute,
          href: '/',
        },
        ...(import.meta.env.DEV
          ? [
              {
                id: 'lab',
                label: '组件实验室 /_lab',
                icon: 'palette' as const,
                badge: 'DEV',
                href: '/_lab',
              },
            ]
          : []),
      ],
    },
  ];

  return (
    <AppShell
      sidebar={{
        workspaceCode: 'M0',
        workspaceTitle: 'Gateway Console',
        workspaceCaption: 'Foundation Shell v0.1.0',
        navGroups,
      }}
      topbar={{
        sectionLabel: 'Control Plane',
        pageLabel: unavailableRoute ? '路由不可用' : 'M0 工程底座与健康探针',
        badgeText: import.meta.env.DEV ? 'DEV' : 'PROD',
      }}
    >
      <div className="space-y-4">
        {unavailableRoute && (
          <Alert variant="warning" data-testid="route-unavailable-banner">
            当前路径未在生产构建中挂载（例如开发态组件实验室 /_lab 仅在 DEV 模式启用）。
          </Alert>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-mono text-[10px] tracking-[0.16em] text-primary uppercase">
              MYSQL MCP GATEWAY · M0 FOUNDATION
            </div>
            <h1 className="mt-1 text-xl font-semibold text-fg-main">
              管控平台前端骨架已就绪
            </h1>
            <p className="mt-1 text-xs text-fg-muted">
              当前里程碑交付全局骨架、OKLCH 设计令牌、紧凑组件库与真实 admin-api:8081 健康探针。
            </p>
          </div>
          <div className="flex items-center gap-2">
            {import.meta.env.DEV && (
              <Button variant="default" asChild>
                <Link to="/_lab">
                  <Icon name="palette" className="size-3.5" />
                  <span>进入 /_lab 组件实验室</span>
                </Link>
              </Button>
            )}
            <Button
              variant="outline"
              disabled={isFetching}
              onClick={() => void refetch()}
            >
              <Icon name="refresh" className={isFetching ? 'size-3.5 animate-spin' : 'size-3.5'} />
              <span>刷新探针</span>
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {[
            { key: 'live', title: 'Liveness 存活探针', endpoint: '/health/live', result: health?.live },
            { key: 'ready', title: 'Readiness 就绪探针 (MySQL)', endpoint: '/health/ready', result: health?.ready },
          ].map(({ key, title, endpoint, result }) => (
            <Card key={key}>
              <CardHeader>
                <div>
                  <CardTitle>
                    <Icon name="heart-pulse" className="size-4 text-primary" />
                    <span>{title}</span>
                  </CardTitle>
                  <CardDescription>
                    <code className="font-mono">{`GET ${endpoint}`}</code>
                  </CardDescription>
                </div>
                <Badge variant={result?.ok ? 'safe' : result ? 'danger' : 'neutral'} mono>
                  {result ? result.statusText.toUpperCase() : 'PROBING'}
                </Badge>
              </CardHeader>
              <CardContent className="font-mono text-xs text-fg-muted tabular-nums">
                {result
                  ? `HTTP ${result.httpStatus ?? 'ERR'} · ${result.latencyMs}ms · ${result.checkedAt}`
                  : '正在连接真实 admin-api:8081…'}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
