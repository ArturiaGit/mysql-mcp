import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md border font-medium',
    'transition-colors duration-150 ease-out cursor-pointer select-none',
    'disabled:pointer-events-none disabled:opacity-45 disabled:cursor-not-allowed',
  ].join(' '),
  {
    variants: {
      variant: {
        default:
          'border-primary bg-primary text-on-primary hover:opacity-90 active:translate-y-px',
        secondary:
          'border-border-line bg-bg-surface text-fg-main hover:bg-bg-hover hover:border-border-strong',
        outline:
          'border-border-line bg-bg-card text-fg-main hover:bg-bg-hover hover:border-border-strong',
        ghost:
          'border-transparent bg-transparent text-fg-muted hover:bg-bg-hover hover:text-fg-main',
        destructive:
          'border-danger/35 bg-danger-soft text-danger hover:border-danger/60 hover:bg-danger/20',
      },
      size: {
        xs: 'h-7 px-2.5 text-[11px]',
        sm: 'h-8 px-3 text-xs',
        md: 'h-9 px-3.5 text-[13px]',
        icon: 'size-8 p-0',
        'icon-sm': 'size-7 p-0',
      },
    },
    defaultVariants: {
      variant: 'outline',
      size: 'sm',
    },
  },
);

export interface ButtonProps
  extends ComponentProps<'button'>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({
  className,
  variant,
  size,
  asChild = false,
  type = 'button',
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp
      type={asChild ? undefined : type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}
