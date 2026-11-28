import type { CurrentUserResponseDTO } from '@mysql-mcp/shared-types';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { handleLogout } from '@/api/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { ToastViewport } from '@/components/ui/toast';
import { useHealthProbe } from '@/hooks/useHealthProbe';
import { getUserStatusLabel } from '@/lib/user-display';
import { useShellStore } from '@/stores/useShellStore';

export type AuthTopbarStatusVariant = 'safe' | 'warning' | 'danger';

export interface AuthTopbarStatusPresentation {
  label: string;
  title: CurrentUserResponseDTO['status'];
  variant: AuthTopbarStatusVariant;
}

export function getAuthTopbarStatusPresentation(
  status: CurrentUserResponseDTO['status'],
): AuthTopbarStatusPresentation {
  return {
    label: getUserStatusLabel(status),
    title: status,
    variant: status === 'ACTIVE' ? 'safe' : status === 'PENDING' ? 'warning' : 'danger',
  };
}

export interface AuthLayoutProps {
  pageLabel: string;
  user?: CurrentUserResponseDTO;
  children: ReactNode;
}

export function AuthLayout({ pageLabel, user, children }: AuthLayoutProps) {
  const theme = useShellStore((state) => state.theme);
  const toggleTheme = useShellStore((state) => state.toggleTheme);
  const { data: health, isFetching } = useHealthProbe();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [loggingOut, setLoggingOut] = useState(false);

  const isReady = health?.ready.ok === true;
  const isLive = health?.live.ok === true;
  const nextThemeLabel = theme === 'dark' ? '切换至浅色主题' : '切换至暗色主题';
  const statusBadge = user ? getAuthTopbarStatusPresentation(user.status) : null;

  const onLogout = async () => {
    setLoggingOut(true);
    await handleLogout(queryClient, {
      navigate: (targetUrl) => navigate(targetUrl, { replace: true }),
    });
    setLoggingOut(false);
  };

  return (
    <div className="flex min-h-dvh flex-col bg-bg-app text-fg-main">
      <a href="#auth-main-content" className="skip-link">
        跳转至主内容
      </a>

      <header
        data-testid="auth-topbar"
        className="sticky top-0 z-20 flex h-14 w-full items-center justify-between gap-3 border-b border-border-line bg-bg-app/95 px-4 backdrop-blur-xs lg:px-6"
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-md border border-primary/35 bg-primary-soft text-primary">
            <Icon name="shield" className="size-[18px]" />
          </span>
          <div className="min-w-0">
            <div className="truncate text-[14px] leading-tight font-semibold tracking-tight text-fg-main">
              MySQL MCP<span className="text-primary">.</span>
            </div>
            <div className="mt-0.5 font-mono text-[9px] tracking-[0.16em] text-fg-subtle uppercase">
              GATEWAY CONSOLE
            </div>
          </div>
          <span aria-hidden="true" className="mx-1 hidden h-4 w-px bg-border-line sm:inline-block" />
          <span className="hidden truncate text-xs text-fg-muted sm:inline">{pageLabel}</span>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Badge
            variant={isReady ? 'safe' : isLive ? 'warning' : 'danger'}
            pulse={isReady}
            mono
            data-testid="topbar-health-badge"
            className="hidden sm:inline-flex"
          >
            {isFetching && !health
              ? 'PROBING :8081'
              : isReady
                ? 'ADMIN-API READY'
                : isLive
                  ? 'ADMIN-API NOT READY'
                  : 'ADMIN-API OFFLINE'}
          </Badge>

          {user && statusBadge && (
            <>
              <span className="hidden items-center gap-1.5 rounded-md border border-border-line bg-bg-card px-2.5 py-1 text-xs md:inline-flex">
                <Icon name="user-check" className="size-3.5 text-primary" />
                <span className="font-mono text-fg-main">{user.username}</span>
                <Badge
                  variant={statusBadge.variant}
                  title={statusBadge.title}
                  data-testid="auth-topbar-user-status-badge"
                  className="px-1.5 py-0 text-[10px]"
                >
                  {statusBadge.label}
                </Badge>
              </span>

              <Button
                variant="outline"
                size="sm"
                data-testid="auth-logout-btn"
                disabled={loggingOut}
                onClick={() => void onLogout()}
              >
                <Icon
                  name={loggingOut ? 'loader' : 'logout'}
                  className={loggingOut ? 'size-3.5 animate-spin' : 'size-3.5'}
                />
                <span>退出登录</span>
              </Button>
            </>
          )}

          <Button
            variant="ghost"
            size="icon"
            data-testid="theme-toggle-btn"
            aria-label={nextThemeLabel}
            title={nextThemeLabel}
            onClick={toggleTheme}
          >
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} className="size-4" />
          </Button>
        </div>
      </header>

      <main
        id="auth-main-content"
        tabIndex={-1}
        className="flex flex-1 flex-col items-center justify-center px-4 py-8 outline-none"
      >
        {children}
      </main>

      <footer className="border-t border-border-line px-4 py-3 text-center font-mono text-[11px] text-fg-subtle">
        ZERO-TRUST CONTROL PLANE · HTTPONLY SESSION · STRICT CSRF PROTECTION
      </footer>

      <ToastViewport />
    </div>
  );
}
