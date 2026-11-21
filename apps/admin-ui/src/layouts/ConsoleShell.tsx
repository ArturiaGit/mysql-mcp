import type { SystemRole } from '@mysql-mcp/shared-types';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { handleLogout } from '@/api/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Icon, type IconName } from '@/components/ui/icon';
import { useActiveUser } from '@/guards/auth-guards';
import { AppShell } from './AppShell';
import type { SidebarNavGroup } from './Sidebar';

interface NavRouteDef {
  id: string;
  label: string;
  icon: IconName;
  to: string;
  roles?: readonly SystemRole[];
}

const OPERATIONS_NAV: readonly NavRouteDef[] = [
  { id: 'dashboard', label: '工作台大盘', icon: 'grid', to: '/dashboard' },
  {
    id: 'audits',
    label: '全链路审计',
    icon: 'activity',
    to: '/audits',
    roles: ['SUPER_ADMIN', 'SECURITY_ADMIN'],
  },
];

const GOVERNANCE_NAV: readonly NavRouteDef[] = [
  {
    id: 'approvals',
    label: '审批工单中心',
    icon: 'user-check',
    to: '/approvals',
    roles: ['SUPER_ADMIN', 'SECURITY_ADMIN'],
  },
  { id: 'users', label: '用户与角色', icon: 'users', to: '/users', roles: ['SUPER_ADMIN'] },
  {
    id: 'policies',
    label: '策略与 ACL',
    icon: 'shield',
    to: '/policies',
    roles: ['SUPER_ADMIN', 'SECURITY_ADMIN'],
  },
  {
    id: 'limits',
    label: '双重漏斗限流',
    icon: 'sliders',
    to: '/limits',
    roles: ['SUPER_ADMIN', 'SECURITY_ADMIN'],
  },
  {
    id: 'profiles',
    label: '数据源 Profile',
    icon: 'database',
    to: '/profiles',
    roles: ['SUPER_ADMIN', 'DBA'],
  },
  {
    id: 'notifications',
    label: '系统告警通知',
    icon: 'mail',
    to: '/settings/notifications',
    roles: ['SUPER_ADMIN', 'SECURITY_ADMIN'],
  },
];

const DEVELOPER_NAV: readonly NavRouteDef[] = [
  { id: 'pats', label: '个人访问令牌', icon: 'key', to: '/developer/pats' },
  { id: 'config', label: '客户端接入配置', icon: 'terminal', to: '/developer/config' },
  { id: 'password', label: '密码与轮换策略', icon: 'lock', to: '/change-password' },
];

function hasAnyRole(userRoles: readonly SystemRole[], required?: readonly SystemRole[]): boolean {
  if (!required || required.length === 0) return true;
  return required.some((role) => userRoles.includes(role));
}

export interface ConsoleShellProps {
  sectionLabel: string;
  pageLabel: string;
  children: ReactNode;
}

export function ConsoleShell({ sectionLabel, pageLabel, children }: ConsoleShellProps) {
  const user = useActiveUser();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [loggingOut, setLoggingOut] = useState(false);

  const mapGroup = (label: string, defs: readonly NavRouteDef[]): SidebarNavGroup | null => {
    const items = defs
      .filter((def) => hasAnyRole(user.roles, def.roles))
      .map((def) => ({
        id: def.id,
        label: def.label,
        icon: def.icon,
        href: def.to,
        active: location.pathname === def.to,
        onClick: () => navigate(def.to),
      }));
    return items.length > 0 ? { label, items } : null;
  };

  const navGroups: SidebarNavGroup[] = [
    mapGroup('OPERATIONS', OPERATIONS_NAV),
    mapGroup('GOVERNANCE', GOVERNANCE_NAV),
    mapGroup('DEVELOPER & ACCOUNT', DEVELOPER_NAV),
    ...(import.meta.env.DEV
      ? [
          {
            label: 'DEV TOOLS',
            items: [
              {
                id: 'lab',
                label: '组件实验室 /_lab',
                icon: 'palette' as const,
                badge: 'DEV',
                href: '/_lab',
                active: location.pathname === '/_lab',
                onClick: () => navigate('/_lab'),
              },
            ],
          },
        ]
      : []),
  ].filter((group): group is SidebarNavGroup => group !== null);

  const onLogout = async () => {
    setLoggingOut(true);
    await handleLogout(queryClient, {
      navigate: (targetUrl) => navigate(targetUrl, { replace: true }),
    });
    setLoggingOut(false);
  };

  const primaryRole = user.roles[0] ?? 'ACTIVE';

  return (
    <AppShell
      sidebar={{
        workspaceCode: primaryRole.slice(0, 3),
        workspaceTitle: user.username,
        workspaceCaption: user.roles.join(' · ') || 'ACTIVE USER',
        navGroups,
        onBrandClick: () => navigate('/dashboard'),
      }}
      topbar={{
        sectionLabel,
        pageLabel,
        badgeText: primaryRole,
        rightSlot: (
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild className="hidden md:inline-flex">
              <Link to="/change-password">
                <Icon name="lock" className="size-3.5" />
                <span className="font-mono text-xs">{user.username}</span>
                <Badge variant="safe" dot={false} mono className="px-1.5 py-0 text-[10px]">
                  {primaryRole}
                </Badge>
              </Link>
            </Button>
            <Button
              variant="outline"
              size="sm"
              data-testid="console-logout-btn"
              disabled={loggingOut}
              onClick={() => void onLogout()}
            >
              <Icon
                name={loggingOut ? 'loader' : 'logout'}
                className={loggingOut ? 'size-3.5 animate-spin' : 'size-3.5'}
              />
              <span>退出登录</span>
            </Button>
          </div>
        ),
      }}
    >
      {children}
    </AppShell>
  );
}
