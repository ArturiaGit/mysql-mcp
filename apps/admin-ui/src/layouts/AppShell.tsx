import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { ToastViewport } from '@/components/ui/toast';
import { TooltipProvider } from '@/components/ui/tooltip';
import { cn } from '@/lib/cn';
import { useCommandStore } from '@/stores/useCommandStore';
import { useShellStore } from '@/stores/useShellStore';
import { CommandPalette } from './CommandPalette';
import { Sidebar, type SidebarProps } from './Sidebar';
import { Topbar, type TopbarProps } from './Topbar';

export interface AppShellProps {
  sidebar: SidebarProps;
  topbar: TopbarProps;
  children: ReactNode;
}

export function AppShell({ sidebar, topbar, children }: AppShellProps) {
  const sidebarCollapsed = useShellStore((state) => state.sidebarCollapsed);
  const mobileNavOpen = useShellStore((state) => state.mobileNavOpen);
  const syncViewport = useShellStore((state) => state.syncViewport);
  const openPalette = useCommandStore((state) => state.openPalette);

  useEffect(() => {
    const handleResize = () => syncViewport(window.innerWidth);
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [syncViewport]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (document.querySelectorAll('dialog[open]').length === 0) {
          openPalette();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [openPalette]);

  return (
    <TooltipProvider delayDuration={200}>
      <div className="min-h-dvh bg-bg-app text-fg-main">
        <a href="#main-content" className="skip-link">
          跳转至主内容
        </a>

        <Sidebar {...sidebar} />

        <div
          className={cn(
            'min-w-0 transition-[margin-left] duration-180 ease-out',
            sidebarCollapsed ? 'lg:ml-16' : 'lg:ml-60',
          )}
          inert={mobileNavOpen}
          aria-hidden={mobileNavOpen ? true : undefined}
        >
          <Topbar {...topbar} />
          <main
            id="main-content"
            tabIndex={-1}
            className="mx-auto max-w-[1560px] px-4 py-5 outline-none lg:px-6"
          >
            {children}
          </main>
        </div>

        <CommandPalette />
        <ToastViewport />
      </div>
    </TooltipProvider>
  );
}
