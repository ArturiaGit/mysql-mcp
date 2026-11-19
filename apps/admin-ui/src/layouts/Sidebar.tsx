import { useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Icon, type IconName } from '@/components/ui/icon';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useHealthProbe } from '@/hooks/useHealthProbe';
import { cn } from '@/lib/cn';
import { useShellStore } from '@/stores/useShellStore';

export interface SidebarNavItem {
  id: string;
  label: string;
  icon: IconName;
  badge?: string;
  active?: boolean;
  href?: string;
  onClick?: () => void;
}

export interface SidebarNavGroup {
  label: string;
  items: SidebarNavItem[];
}

export interface SidebarProps {
  workspaceCode: string;
  workspaceTitle: string;
  workspaceCaption: string;
  navGroups: SidebarNavGroup[];
  footerNote?: {
    title: string;
    description: string;
    actionLabel: string;
    onAction: () => void;
  };
  onBrandClick?: () => void;
}

export function Sidebar({
  workspaceCode,
  workspaceTitle,
  workspaceCaption,
  navGroups,
  footerNote,
  onBrandClick,
}: SidebarProps) {
  const collapsed = useShellStore((state) => state.sidebarCollapsed);
  const mobileNavOpen = useShellStore((state) => state.mobileNavOpen);
  const setMobileNavOpen = useShellStore((state) => state.setMobileNavOpen);
  const { data: health } = useHealthProbe();

  useEffect(() => {
    if (!mobileNavOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMobileNavOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mobileNavOpen, setMobileNavOpen]);

  const isReady = health?.ready.ok === true;
  const isLive = health?.live.ok === true;
  const healthLabel = isReady
    ? 'admin-api Ready'
    : isLive
      ? 'admin-api Degraded'
      : 'admin-api Offline';

  return (
    <>
      {mobileNavOpen && (
        <button
          type="button"
          aria-label="关闭侧边导航"
          onClick={() => setMobileNavOpen(false)}
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-[1px] lg:hidden"
        />
      )}

      <aside
        id="app-sidebar"
        aria-label="主导航"
        data-collapsed={collapsed ? 'true' : 'false'}
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex flex-col border-r border-border-line bg-bg-sidebar',
          'transition-[width,transform] duration-180 ease-out',
          // Mobile drawer (< 1024px): always 240px when open, translated off-screen when closed
          'w-60',
          mobileNavOpen ? 'translate-x-0' : '-translate-x-full',
          // Desktop (>= 1024px): always visible, width 240px or 64px
          'lg:translate-x-0',
          collapsed ? 'lg:w-16' : 'lg:w-60',
        )}
      >
        {/* Brand header aligned with 56px Topbar */}
        <div
          className={cn(
            'flex h-14 shrink-0 items-center gap-2.5 border-b border-border-line px-4',
            collapsed && 'lg:justify-center lg:px-0',
          )}
        >
          <button
            type="button"
            onClick={() => {
              setMobileNavOpen(false);
              onBrandClick?.();
            }}
            className="flex min-w-0 items-center gap-2.5 text-left"
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-md border border-primary/35 bg-primary-soft text-primary">
              <Icon name="shield" className="size-[18px]" />
            </span>
            <span className={cn('min-w-0', collapsed && 'lg:hidden')}>
              <span className="block truncate text-[14px] leading-tight font-semibold tracking-tight text-fg-main">
                MySQL MCP<span className="text-primary">.</span>
              </span>
              <span className="mt-0.5 block font-mono text-[9px] tracking-[0.16em] text-fg-subtle uppercase">
                GATEWAY CONSOLE
              </span>
            </span>
          </button>
        </div>

        {/* Scrollable navigation region */}
        <div
          className={cn(
            'flex-1 overflow-y-auto px-3 py-3.5',
            collapsed && 'lg:px-2',
          )}
        >
          <div
            className={cn(
              'mb-4 flex items-center gap-2.5 rounded-md border border-border-line bg-bg-card p-2',
              collapsed && 'lg:hidden',
            )}
          >
            <span className="grid size-7 shrink-0 place-items-center rounded-sm border border-border-line bg-bg-surface font-mono text-[11px] font-medium text-fg-muted">
              {workspaceCode}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium text-fg-main">{workspaceTitle}</div>
              <div className="truncate text-[11px] text-fg-subtle">{workspaceCaption}</div>
            </div>
            <Icon name="box" className="size-3.5 text-fg-subtle" />
          </div>

          {navGroups.map((group) => (
            <div key={group.label} className="mb-4 last:mb-0">
              <p
                className={cn(
                  'mb-1.5 px-2.5 font-mono text-[10px] tracking-[0.14em] text-fg-subtle uppercase',
                  collapsed && 'lg:hidden',
                )}
              >
                {group.label}
              </p>
              <nav aria-label={group.label} className="flex flex-col gap-0.5">
                {group.items.map((item) => {
                  const content = (
                    <>
                      <Icon name={item.icon} className="size-4 shrink-0" />
                      <span className={cn('truncate', collapsed && 'lg:hidden')}>
                        {item.label}
                      </span>
                      {item.badge && (
                        <span
                          className={cn(
                            'ml-auto font-mono text-[10px] tabular-nums',
                            item.active ? 'text-primary' : 'text-fg-subtle',
                            collapsed && 'lg:hidden',
                          )}
                        >
                          {item.badge}
                        </span>
                      )}
                    </>
                  );

                  const itemClasses = cn(
                    'flex h-8 w-full items-center gap-2.5 rounded-md border px-2.5 text-left text-xs transition-colors duration-150 cursor-pointer',
                    collapsed && 'lg:justify-center lg:px-0',
                    item.active
                      ? 'border-primary/25 bg-primary-soft font-medium text-primary'
                      : 'border-transparent text-fg-muted hover:bg-bg-surface hover:text-fg-main',
                  );

                  const element = item.href ? (
                    <a
                      key={item.id}
                      href={item.href}
                      aria-current={item.active ? 'page' : undefined}
                      aria-label={collapsed ? item.label : undefined}
                      onClick={(event) => {
                        if (item.onClick) {
                          event.preventDefault();
                          item.onClick();
                        }
                        setMobileNavOpen(false);
                      }}
                      className={itemClasses}
                    >
                      {content}
                    </a>
                  ) : (
                    <button
                      key={item.id}
                      type="button"
                      aria-current={item.active ? 'page' : undefined}
                      aria-label={collapsed ? item.label : undefined}
                      onClick={() => {
                        item.onClick?.();
                        setMobileNavOpen(false);
                      }}
                      className={itemClasses}
                    >
                      {content}
                    </button>
                  );

                  if (collapsed) {
                    return (
                      <Tooltip key={item.id}>
                        <TooltipTrigger asChild>{element}</TooltipTrigger>
                        <TooltipContent side="right" className="hidden lg:block">
                          {item.label}
                        </TooltipContent>
                      </Tooltip>
                    );
                  }

                  return element;
                })}
              </nav>
            </div>
          ))}
        </div>

        {/* Footer note & real admin-api health indicator */}
        <div className="shrink-0 border-t border-border-line p-3">
          {footerNote && (
            <div
              className={cn(
                'mb-3 rounded-md border border-border-line bg-bg-card p-2.5',
                collapsed && 'lg:hidden',
              )}
            >
              <div className="flex items-center gap-1.5 text-xs font-medium text-fg-main">
                <Icon name="code" className="size-3.5 text-primary" />
                <span>{footerNote.title}</span>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-fg-muted">
                {footerNote.description}
              </p>
              <button
                type="button"
                onClick={footerNote.onAction}
                className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
              >
                <span>{footerNote.actionLabel}</span>
                <Icon name="arrow-right" className="size-3" />
              </button>
            </div>
          )}

          <div
            className={cn(
              'flex items-center justify-between gap-2',
              collapsed && 'lg:justify-center',
            )}
          >
            <div className="flex min-w-0 items-center gap-2">
              <span
                aria-hidden="true"
                className={cn(
                  'size-2 shrink-0 rounded-full',
                  isReady ? 'bg-safe' : isLive ? 'bg-warning' : 'bg-danger',
                )}
              />
              <span
                className={cn(
                  'truncate text-[11px] font-medium text-fg-main',
                  collapsed && 'lg:hidden',
                )}
              >
                {healthLabel}
              </span>
            </div>
            <Badge
              variant={isReady ? 'safe' : isLive ? 'warning' : 'danger'}
              dot={false}
              mono
              className={cn('px-1.5 py-0 text-[10px]', collapsed && 'lg:hidden')}
            >
              {isReady ? 'READY' : isLive ? 'LIVE' : 'DOWN'}
            </Badge>
          </div>
          <div
            className={cn(
              'mt-1.5 flex items-center justify-between font-mono text-[10px] text-fg-subtle tabular-nums',
              collapsed && 'lg:hidden',
            )}
          >
            <span>CONSOLE v0.1.0</span>
            <span>{health ? `${health.ready.latencyMs}ms` : '—'}</span>
          </div>
        </div>
      </aside>
    </>
  );
}
