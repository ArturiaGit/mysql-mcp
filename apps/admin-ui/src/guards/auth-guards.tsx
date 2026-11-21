import type { CurrentUserResponseDTO, SystemRole, UserStatus } from '@mysql-mcp/shared-types';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { useCurrentUser } from '@/api/auth';
import { isApiClientError, sanitizeReturnUrl } from '@/api/client';
import { resetSessionCacheOnUnauthorized } from '@/api/session-cache';
import { Button } from '@/components/ui/button';
import { Alert, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/form-controls';
import { Icon } from '@/components/ui/icon';
import { AuthLayout } from '@/layouts/AuthLayout';
import { evaluateGuardPipeline, statusHomePath } from './guard-decision';

const AuthUserContext = createContext<CurrentUserResponseDTO | null>(null);

export function useAuthenticatedUser(): CurrentUserResponseDTO {
  const user = useContext(AuthUserContext);
  if (!user) {
    throw new Error('useAuthenticatedUser must be used inside AuthGuard');
  }
  return user;
}

export function useActiveUser(): Extract<CurrentUserResponseDTO, { status: 'ACTIVE' }> {
  const user = useAuthenticatedUser();
  if (user.status !== 'ACTIVE') {
    throw new Error(`Expected ACTIVE user inside guard, received ${user.status}`);
  }
  return user;
}

function UnauthorizedRedirect({ to }: { to: string }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  useEffect(() => {
    resetSessionCacheOnUnauthorized(queryClient);
    navigate(to, { replace: true });
  }, [navigate, queryClient, to]);

  return null;
}

/**
 * L1 AuthGuard:
 * - 401 -> abort in-flight requests, clear entire query cache, and redirect to /login?returnUrl=...
 * - Network timeout / 5xx -> NEVER kick to /login; show full-viewport reconnect card
 * - 403 ERR_AUTH_ACCOUNT_DISABLED -> redirect to /forbidden
 * - 200 -> provide CurrentUserResponseDTO to downstream guards
 */
export function AuthGuard({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { data: user, isPending, isError, error, refetch, isFetching } = useCurrentUser();

  if (isPending) {
    return (
      <AuthLayout pageLabel="身份会话核验">
        <Card className="w-full max-w-[440px]">
          <CardContent className="flex items-center gap-3 py-6">
            <Icon name="loader" className="size-4 animate-spin text-primary" />
            <div className="min-w-0">
              <div className="text-xs font-medium text-fg-main">正在核验安全会话…</div>
              <div className="mt-0.5 font-mono text-[11px] text-fg-muted">GET /api/v1/auth/me</div>
            </div>
          </CardContent>
        </Card>
      </AuthLayout>
    );
  }

  if (isError) {
    if (isApiClientError(error)) {
      if (error.status === 401) {
        const currentPath = `${location.pathname}${location.search}${location.hash}`;
        const safeReturn = sanitizeReturnUrl(currentPath, '/dashboard');
        const target =
          safeReturn === '/dashboard'
            ? '/login'
            : `/login?returnUrl=${encodeURIComponent(safeReturn)}`;
        return <UnauthorizedRedirect to={target} />;
      }

      if (error.status === 403 && error.code === 'ERR_AUTH_ACCOUNT_DISABLED') {
        return <Navigate to="/forbidden" replace />;
      }
    }

    // Network error / timeout / 5xx: MUST stay in viewport and offer retry (never kick to /login)
    const errorMessage = isApiClientError(error)
      ? error.message
      : '无法连接到管控面服务，请检查网络与后端运行状态。';
    const errorGuidance = isApiClientError(error)
      ? error.actionGuidance
      : '请稍后点击重新连接，当前页面状态已保留。';

    return (
      <AuthLayout pageLabel="网关连接异常">
        <Card className="w-full max-w-[480px]" data-testid="gateway-network-error-card">
          <CardHeader>
            <div>
              <CardTitle>
                <Icon name="alert-triangle" className="size-4 text-warning" />
                <span>网关网络连接异常</span>
              </CardTitle>
              <CardDescription>管控面暂未响应，已保留当前会话视图</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert variant="warning">
              <div className="font-medium">{errorMessage}</div>
              <div className="mt-1 text-fg-muted">{errorGuidance}</div>
            </Alert>
            <div className="flex items-center justify-end gap-2">
              <Button variant="default" disabled={isFetching} onClick={() => void refetch()}>
                <Icon name="refresh" className={isFetching ? 'size-3.5 animate-spin' : 'size-3.5'} />
                <span>重新连接</span>
              </Button>
            </div>
          </CardContent>
        </Card>
      </AuthLayout>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <AuthUserContext.Provider value={user}>{children}</AuthUserContext.Provider>;
}

/**
 * L2 StatusGuard:
 * Strictly runs BEFORE MustChangePwdGuard so PENDING/REJECTED/DISABLED users
 * are routed exclusively by `user.status` and NEVER enter /change-password.
 */
export function StatusGuard({
  allowedStatuses = ['ACTIVE'],
  children,
}: {
  allowedStatuses?: readonly UserStatus[];
  children: ReactNode;
}) {
  const user = useAuthenticatedUser();
  if (!allowedStatuses.includes(user.status)) {
    return <Navigate to={statusHomePath(user)} replace />;
  }
  return <>{children}</>;
}

/**
 * L3 MustChangePwdGuard:
 * ONLY executes for ACTIVE users. Redirects to /change-password whenever
 * `must_change_password === true || is_password_expired === true`.
 */
export function MustChangePwdGuard({ children }: { children: ReactNode }) {
  const user = useAuthenticatedUser();
  const location = useLocation();

  if (user.status !== 'ACTIVE') {
    return <Navigate to={statusHomePath(user)} replace />;
  }

  const decision = evaluateGuardPipeline(user, {
    currentPath: `${location.pathname}${location.search}${location.hash}`,
    allowedStatuses: ['ACTIVE'],
  });

  if (decision.kind === 'redirect') {
    return <Navigate to={decision.to} replace />;
  }

  return <>{children}</>;
}

/**
 * L4 RoleGuard:
 * Checks RBAC SystemRole permissions for ACTIVE + password-valid users.
 */
export function RoleGuard({
  requiredRoles,
  children,
}: {
  requiredRoles?: readonly SystemRole[];
  children: ReactNode;
}) {
  const user = useActiveUser();
  const location = useLocation();

  const decision = evaluateGuardPipeline(user, {
    currentPath: `${location.pathname}${location.search}${location.hash}`,
    allowedStatuses: ['ACTIVE'],
    requiredRoles,
  });

  if (decision.kind === 'forbidden') {
    return (
      <AuthLayout pageLabel="权限不足 (403)" user={user}>
        <Card className="w-full max-w-[500px]" data-testid="rbac-forbidden-card">
          <CardHeader>
            <div>
              <CardTitle>
                <Icon name="shield-ban" className="size-4 text-danger" />
                <span>权限不足 (ERR_RBAC_FORBIDDEN)</span>
              </CardTitle>
              <CardDescription>当前角色无权访问此管理模块</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert variant="danger">
              <div>
                访问此路由需要以下角色之一：
                <span className="ml-1 font-mono">{decision.requiredRoles.join(', ')}</span>
              </div>
              <div className="mt-1 text-fg-muted">
                当前账号角色：
                <span className="ml-1 font-mono">
                  {user.roles.length > 0 ? user.roles.join(', ') : 'NONE'}
                </span>
              </div>
            </Alert>
            <div className="flex justify-end">
              <Button variant="default" asChild>
                <Link to="/dashboard">
                  <Icon name="arrow-left" className="size-3.5" />
                  <span>返回工作台大盘</span>
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </AuthLayout>
    );
  }

  return <>{children}</>;
}

/**
 * Convenience composition enforcing the strict serial pipeline:
 * AuthGuard -> StatusGuard -> MustChangePwdGuard (ACTIVE only) -> RoleGuard
 */
export function ProtectedRoute({
  allowedStatuses = ['ACTIVE'],
  bypassPasswordGuard = false,
  requiredRoles,
  children,
}: {
  allowedStatuses?: readonly UserStatus[];
  bypassPasswordGuard?: boolean;
  requiredRoles?: readonly SystemRole[];
  children: ReactNode;
}) {
  const isActiveOnly = allowedStatuses.length === 1 && allowedStatuses[0] === 'ACTIVE';

  if (!isActiveOnly) {
    return (
      <AuthGuard>
        <StatusGuard allowedStatuses={allowedStatuses}>{children}</StatusGuard>
      </AuthGuard>
    );
  }

  if (bypassPasswordGuard) {
    return (
      <AuthGuard>
        <StatusGuard allowedStatuses={['ACTIVE']}>{children}</StatusGuard>
      </AuthGuard>
    );
  }

  return (
    <AuthGuard>
      <StatusGuard allowedStatuses={['ACTIVE']}>
        <MustChangePwdGuard>
          <RoleGuard requiredRoles={requiredRoles}>{children}</RoleGuard>
        </MustChangePwdGuard>
      </StatusGuard>
    </AuthGuard>
  );
}
