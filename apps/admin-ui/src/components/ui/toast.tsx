import { cn } from '@/lib/cn';
import { useToastStore, type ToastTone } from '@/stores/useToastStore';
import { Button } from './button';
import { Icon, type IconName } from './icon';

const TONE_ICON: Record<ToastTone, { name: IconName; className: string }> = {
  safe: { name: 'check-circle', className: 'text-safe' },
  warning: { name: 'alert-triangle', className: 'text-warning' },
  danger: { name: 'shield-alert', className: 'text-danger' },
  info: { name: 'shield', className: 'text-primary' },
};

export function ToastViewport() {
  const toasts = useToastStore((state) => state.toasts);
  const dismiss = useToastStore((state) => state.dismiss);

  return (
    <div
      role="region"
      aria-label="操作通知"
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed right-5 bottom-5 z-50 flex max-w-[min(400px,calc(100vw-32px))] flex-col gap-2"
    >
      {toasts.map((toast) => {
        const iconCfg = TONE_ICON[toast.tone];
        return (
          <div
            key={toast.id}
            className={cn(
              'pointer-events-auto flex min-w-[260px] items-start gap-2.5 rounded-md border border-border-line bg-bg-surface px-3.5 py-2.5 text-xs text-fg-main shadow-[var(--shadow-popover)]',
            )}
          >
            <Icon name={iconCfg.name} className={cn('mt-0.5 size-4', iconCfg.className)} />
            <div className="min-w-0 flex-1">
              <div className="font-medium text-fg-main">{toast.title}</div>
              {toast.description && (
                <div className="mt-0.5 text-[11px] text-fg-muted">{toast.description}</div>
              )}
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              className="-mr-1 -mt-0.5 size-6 shrink-0"
              aria-label="关闭通知"
              onClick={() => dismiss(toast.id)}
            >
              <Icon name="x" className="size-3.5" />
            </Button>
          </div>
        );
      })}
    </div>
  );
}
