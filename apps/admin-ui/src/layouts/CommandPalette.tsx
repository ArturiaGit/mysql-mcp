import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { Kbd } from '@/components/ui/form-controls';
import { Icon } from '@/components/ui/icon';
import { HEALTH_QUERY_KEY } from '@/hooks/useHealthProbe';
import { useCommandStore, type CommandItem } from '@/stores/useCommandStore';
import { useShellStore } from '@/stores/useShellStore';

export function CommandPalette() {
  const open = useCommandStore((state) => state.open);
  const setOpen = useCommandStore((state) => state.setOpen);
  const registeredCommands = useCommandStore((state) => state.commands);
  const toggleTheme = useShellStore((state) => state.toggleTheme);
  const queryClient = useQueryClient();

  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const allCommands = useMemo<CommandItem[]>(() => {
    const builtins: CommandItem[] = [
      {
        id: 'global-toggle-theme',
        title: '切换明暗主题',
        tag: 'APPEARANCE',
        keywords: 'theme dark light 主题 暗色 浅色',
        iconName: 'sun',
        action: () => toggleTheme(),
      },
      {
        id: 'global-refresh-health',
        title: '重新探测 admin-api:8081 健康状态',
        tag: 'HEALTH',
        keywords: 'health live ready 探针 后端 8081 mysql',
        iconName: 'heart-pulse',
        action: () => {
          void queryClient.invalidateQueries({ queryKey: HEALTH_QUERY_KEY });
        },
      },
    ];

    const seen = new Set(registeredCommands.map((item) => item.id));
    return [...registeredCommands, ...builtins.filter((item) => !seen.has(item.id))];
  }, [registeredCommands, toggleTheme, queryClient]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allCommands;
    return allCommands.filter((item) =>
      `${item.title} ${item.tag} ${item.keywords}`.toLowerCase().includes(q),
    );
  }, [allCommands, query]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
      queueMicrotask(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  const execute = (item: CommandItem | undefined) => {
    if (!item) return;
    setOpen(false);
    item.action();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      ariaLabel="全局指令面板"
      className="mt-[min(18vh,140px)] w-[min(540px,calc(100vw-32px))]"
    >
      <div
        data-testid="command-palette-dialog"
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            if (filtered.length > 0) {
              setActiveIndex((prev) => (prev + 1) % filtered.length);
            }
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            if (filtered.length > 0) {
              setActiveIndex((prev) => (prev - 1 + filtered.length) % filtered.length);
            }
          } else if (event.key === 'Enter') {
            event.preventDefault();
            execute(filtered[activeIndex] ?? filtered[0]);
          }
        }}
      >
        <div className="flex items-center gap-2.5 border-b border-border-line px-4">
          <Icon name="search" className="size-4 text-fg-subtle" />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索组件、视图、设计令牌或快捷操作…"
            aria-label="搜索组件与操作"
            autoComplete="off"
            className="h-12 w-full border-0 bg-transparent text-[13px] text-fg-main outline-none placeholder:text-fg-subtle focus-visible:outline-none"
          />
          <Kbd>ESC</Kbd>
        </div>

        <div className="max-h-[340px] overflow-y-auto p-2" role="listbox" aria-label="匹配指令">
          {filtered.length === 0 ? (
            <div className="py-8 text-center text-xs text-fg-muted">
              没有匹配的组件或操作
            </div>
          ) : (
            filtered.map((item, index) => {
              const isSelected = index === activeIndex;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => execute(item)}
                  className={
                    isSelected
                      ? 'flex w-full items-center gap-2.5 rounded-md bg-bg-surface px-3 py-2 text-left text-xs text-fg-main cursor-pointer'
                      : 'flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-xs text-fg-muted hover:bg-bg-surface hover:text-fg-main cursor-pointer'
                  }
                >
                  <Icon name={item.iconName} className="size-4 text-fg-subtle" />
                  <span className="min-w-0 flex-1 truncate">{item.title}</span>
                  <span className="font-mono text-[10px] tracking-wide text-fg-subtle">
                    {item.tag}
                  </span>
                </button>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border-line px-4 py-2 text-[11px] text-fg-subtle">
          <span className="inline-flex items-center gap-2">
            <span>
              <Kbd>↑</Kbd> <Kbd>↓</Kbd> 导航
            </span>
            <span>
              <Kbd>↵</Kbd> 执行
            </span>
          </span>
          <span className="font-mono text-[10px]">Ctrl / ⌘ K</span>
        </div>
      </div>
    </Dialog>
  );
}
