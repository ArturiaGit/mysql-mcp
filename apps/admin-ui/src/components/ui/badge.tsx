import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 text-[11px] leading-4 font-medium whitespace-nowrap',
  {
    variants: {
      variant: {
        safe: 'border-safe/30 bg-safe-soft text-safe',
        warning: 'border-warning/30 bg-warning-soft text-warning',
        danger: 'border-danger/30 bg-danger-soft text-danger',
        secret: 'border-secret/30 bg-secret-soft text-secret',
        primary: 'border-primary/30 bg-primary-soft text-primary',
        neutral: 'border-border-line bg-bg-surface text-fg-muted',
      },
    },
    defaultVariants: {
      variant: 'neutral',
    },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  dot?: boolean;
  pulse?: boolean;
  mono?: boolean;
}

export function Badge({
  className,
  variant,
  dot = true,
  pulse = false,
  mono = false,
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(badgeVariants({ variant }), mono && 'font-mono tabular-nums', className)}
      {...props}
    >
      {dot && (
        <span
          aria-hidden="true"
          className={cn(
            'size-1.5 shrink-0 rounded-full bg-current',
            pulse && 'animate-pulse',
          )}
        />
      )}
      {children}
    </span>
  );
}
