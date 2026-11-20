import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from 'react-router';
import { registerUnauthorizedHandler, sanitizeReturnUrl } from '@/api/client';
import { RouteErrorBoundary } from '@/components/RouteErrorBoundary';
import { ProtectedRoute } from '@/guards/auth-guards';

const LoginView = lazy(() => import('@/views/auth/LoginView'));
const RegisterView = lazy(() => import('@/views/auth/RegisterView'));
const ChangePasswordView = lazy(() => import('@/views/auth/ChangePasswordView'));
const PendingApprovalView = lazy(() => import('@/views/auth/PendingApprovalView'));
const ResubmitApprovalView = lazy(() => import('@/views/auth/ResubmitApprovalView'));
const AccountDisabledView = lazy(() => import('@/views/auth/AccountDisabledView'));
const DashboardView = lazy(() => import('@/views/DashboardView'));
const ModulePlaceholderView = lazy(() => import('@/views/ModulePlaceholderView'));
const RouteUnavailableView = lazy(() => import('@/views/RouteUnavailableView'));

const DesignSystemLabView = import.meta.env.DEV
  ? lazy(() => import('@/views/_lab/DesignSystemLabView'))
  : null;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: false,
    },
  },
});

function ViewLoadingFallback() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg-app font-mono text-xs text-fg-muted">
      Loading console view…
    </div>
  );
}

function UnauthorizedBridge() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  useEffect(() => {
    registerUnauthorizedHandler((currentPath) => {
      qc.removeQueries({ queryKey: ['auth'] });
      const safeReturn = sanitizeReturnUrl(currentPath, '/dashboard');
      const target =
        safeReturn === '/dashboard' || safeReturn === '/login'
          ? '/login'
          : `/login?returnUrl=${encodeURIComponent(safeReturn)}`;
      navigate(target, { replace: true });
    });
    return () => registerUnauthorizedHandler(null);
  }, [navigate, qc]);

  return null;
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <UnauthorizedBridge />
        <RouteErrorBoundary>
          <Suspense fallback={<ViewLoadingFallback />}>
            <Routes>
              {/* L0 Public Auth Routes */}
              <Route path="/login" element={<LoginView />} />
              <Route path="/register" element={<RegisterView />} />

              {/* L1 + L2 Restricted Account Lifecycle Views (Never trigger MustChangePwdGuard) */}
              <Route
                path="/approvals/wait"
                element={
                  <ProtectedRoute allowedStatuses={['PENDING']}>
                    <PendingApprovalView />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/approvals/re"
                element={
                  <ProtectedRoute allowedStatuses={['REJECTED']}>
                    <ResubmitApprovalView />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/forbidden"
                element={
                  <ProtectedRoute allowedStatuses={['DISABLED']}>
                    <AccountDisabledView />
                  </ProtectedRoute>
                }
              />

              {/* L1 + L2 Active Password Change & Policy View */}
              <Route
                path="/change-password"
                element={
                  <ProtectedRoute allowedStatuses={['ACTIVE']} bypassPasswordGuard>
                    <ChangePasswordView />
                  </ProtectedRoute>
                }
              />

              {/* L1 -> L2 -> L3 -> L4 Protected Console Routes */}
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route
                path="/dashboard"
                element={
                  <ProtectedRoute>
                    <DashboardView />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/audits"
                element={
                  <ProtectedRoute requiredRoles={['SUPER_ADMIN', 'SECURITY_ADMIN']}>
                    <ModulePlaceholderView
                      sectionLabel="运维与监控"
                      pageLabel="全链路审计"
                      milestone="M7"
                      description="全链路 SQL 审计流水与物理字段排查抽屉"
                    />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/approvals"
                element={
                  <ProtectedRoute requiredRoles={['SUPER_ADMIN', 'SECURITY_ADMIN']}>
                    <ModulePlaceholderView
                      sectionLabel="安全与管控"
                      pageLabel="审批工单中心"
                      milestone="M3"
                      description="待审批与历史注册工单审核"
                    />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/users"
                element={
                  <ProtectedRoute requiredRoles={['SUPER_ADMIN']}>
                    <ModulePlaceholderView
                      sectionLabel="安全与管控"
                      pageLabel="用户与角色"
                      milestone="M3"
                      description="用户全生命周期管理与超管防自残保护"
                    />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/policies"
                element={
                  <ProtectedRoute requiredRoles={['SUPER_ADMIN', 'SECURITY_ADMIN']}>
                    <ModulePlaceholderView
                      sectionLabel="安全与管控"
                      pageLabel="策略与 ACL"
                      milestone="M5"
                      description="角色模板、库级与表级黑白名单策略"
                    />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/limits"
                element={
                  <ProtectedRoute requiredRoles={['SUPER_ADMIN', 'SECURITY_ADMIN']}>
                    <ModulePlaceholderView
                      sectionLabel="安全与管控"
                      pageLabel="双重漏斗限流"
                      milestone="M5"
                      description="全局配额桶、用户专属配额与死循环熔断"
                    />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/profiles"
                element={
                  <ProtectedRoute requiredRoles={['SUPER_ADMIN', 'DBA']}>
                    <ModulePlaceholderView
                      sectionLabel="安全与管控"
                      pageLabel="数据源 Profile"
                      milestone="M4"
                      description="MySQL 数据源、SSH 隧道与三模式连通性测试"
                    />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/settings/notifications"
                element={
                  <ProtectedRoute requiredRoles={['SUPER_ADMIN', 'SECURITY_ADMIN']}>
                    <ModulePlaceholderView
                      sectionLabel="安全与管控"
                      pageLabel="系统告警通知"
                      milestone="M7"
                      description="企业微信 / 钉钉 / 飞书 Webhook 告警渠道"
                    />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/developer/pats"
                element={
                  <ProtectedRoute>
                    <ModulePlaceholderView
                      sectionLabel="开发者自服务"
                      pageLabel="个人访问令牌 (PAT)"
                      milestone="M2"
                      description="个人访问令牌签发与单次展示保护弹窗"
                    />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/developer/config"
                element={
                  <ProtectedRoute>
                    <ModulePlaceholderView
                      sectionLabel="开发者自服务"
                      pageLabel="客户端接入配置"
                      milestone="M2"
                      description="MCP 客户端三态配置片段生成器"
                    />
                  </ProtectedRoute>
                }
              />

              {/* Development-only Design System Lab */}
              <Route
                path="/_lab"
                element={
                  import.meta.env.DEV && DesignSystemLabView ? (
                    <DesignSystemLabView />
                  ) : (
                    <RouteUnavailableView />
                  )
                }
              />

              <Route path="*" element={<RouteUnavailableView />} />
            </Routes>
          </Suspense>
        </RouteErrorBoundary>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
