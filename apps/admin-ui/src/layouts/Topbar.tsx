import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/form-controls';
import { Icon } from '@/components/ui/icon';
import { useHealthProbe } from '@/hooks/useHealthProbe';
import { useCommandStore } from '@/stores/useCommandStore';
import { useShellStore } from '@/stores/useShellStore';

export interface TopbarProps {
  sectionLabel: string;
  pageLabel: string;
  badgeText?: string;
  onOpenHelp?: () => void;
  rightSlot?: ReactNode;
}

export function Topbar({
  sectionLabel,
  pageLabel,
  badgeText,
  onOpenHelp,
  rightSlot,
}: TopbarProps) {
  const theme = useShellStore((state) => state.theme);
  const toggleTheme = useShellStore((state) => state.toggleTheme);
  const sidebarCollapsed = useShellStore((state) => state.sidebarCollapsed);
  const toggleSidebarCollapsed = useShellStore((state) => state.toggleSidebarCollapsed);
  const mobileNavOpen = useShellStore((state) => state.mobileNavOpen);
  const setMobileNavOpen = useShellStore((state) => state.setMobileNavOpen);
  const openPalette = useCommandStore((state) => state.openPalette);
  const { data: health, isFetching } = useHealthProbe();

  const isReady = health?.ready.ok === true;
  const isLive = health?.live.ok === true;
  const nextThemeLabel = theme === 'dark' ? '切换至浅色主题' : '切换至暗色主题';

  return (
    <header
      data-testid="app-topbar"
      className="sticky top-0 z-20 flex h-14 w-full items-center justify-between gap-3 border-b border-border-line bg-bg-app/95 px-4 backdrop-blur-xs lg:px-6"
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden"
          aria-label={mobileNavOpen ? '关闭导航菜单' : '打开导航菜单'}
          aria-controls="app-sidebar"
          aria-expanded={mobileNavOpen}
          onClick={() => setMobileNavOpen(!mobileNavOpen)}
        >
          <Icon name="menu" className="size-4" />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className="hidden lg:inline-flex"
          aria-label={sidebarCollapsed ? '展开侧边栏' : '折叠侧边栏'}
          aria-pressed={sidebarCollapsed}
          title={sidebarCollapsed ? '展开侧边栏' : '折叠侧边栏'}
          onClick={toggleSidebarCollapsed}
        >
          <Icon name={sidebarCollapsed ? 'panel-open' : 'panel-close'} className="size-4" />
        </Button>

        <nav aria-label="面包屑导航" className="flex min-w-0 items-center gap-1.5 text-xs">
          <span className="hidden truncate text-fg-muted sm:inline">{sectionLabel}</span>
          <Icon name="chevron-right" className="hidden size-3.5 text-fg-subtle sm:block" />
          <strong className="truncate font-medium text-fg-main">{pageLabel}</strong>
          {badgeText && (
            <Badge variant="primary" dot={false} mono className="ml-1 px-1.5 py-0 text-[10px]">
              {badgeText}
            </Badge>
          )}
        </nav>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <Badge
          variant={isReady ? 'safe' : isLive ? 'warning' : 'danger'}
          pulse={isReady}
          mono
          data-testid="topbar-health-badge"
          className="hidden md:inline-flex"
        >
          {isFetching && !health
            ? 'PROBING :8081'
            : isReady
              ? 'ADMIN-API READY'
              : isLive
                ? 'ADMIN-API NOT READY'
                : 'ADMIN-API OFFLINE'}
        </Badge>

        <button
          type="button"
          data-testid="command-palette-trigger"
          aria-label="打开全局指令面板"
          aria-haspopup="dialog"
          onClick={openPalette}
          className="inline-flex h-8 items-center gap-2 rounded-md border border-border-line bg-bg-card px-2.5 text-xs text-fg-muted transition-colors duration-150 hover:border-border-strong hover:text-fg-main sm:min-w-[196px] cursor-pointer"
        >
          <Icon name="search" className="size-3.5 text-fg-subtle" />
          <span className="hidden sm:inline">搜索组件或操作…</span>
          <span className="hidden flex-1 sm:inline" />
          <Kbd className="hidden sm:inline-flex">Ctrl K</Kbd>
        </button>

        <span aria-hidden="true" className="h-5 w-px bg-border-line" />

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

        {onOpenHelp && (
          <Button
            variant="ghost"
            size="icon"
            data-testid="help-dialog-trigger"
            aria-label="帮助与快捷键"
            title="帮助与快捷键"
            onClick={onOpenHelp}
          >
            <Icon name="help" className="size-4" />
          </Button>
        )}

        {rightSlot}
      </div>
    </header>
  );
}
