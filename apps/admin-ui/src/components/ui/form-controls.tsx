import type {
  ComponentProps,
  HTMLAttributes,
  InputHTMLAttributes,
  LabelHTMLAttributes,
  SelectHTMLAttributes,
} from 'react';
import { cn } from '@/lib/cn';
import { Icon, type IconName } from './icon';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'min-w-0 overflow-hidden rounded-lg border border-border-line bg-bg-card',
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex items-start justify-between gap-3 px-4 pt-4 pb-3', className)}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn(
        'flex items-center gap-2 text-[14px] leading-5 font-semibold text-fg-main',
        className,
      )}
      {...props}
    />
  );
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('mt-1 text-xs text-fg-muted', className)} {...props} />;
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-4 pb-4', className)} {...props} />;
}

export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-2 border-t border-border-line px-4 py-2.5',
        className,
      )}
      {...props}
    />
  );
}

export function FieldGroup({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-3', className)} {...props} />;
}

export function Field({
  invalid,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { invalid?: boolean }) {
  return (
    <div
      data-invalid={invalid ? 'true' : undefined}
      className={cn('flex flex-col gap-1.5', className)}
      {...props}
    />
  );
}

export function FieldLabel({
  required,
  className,
  children,
  ...props
}: LabelHTMLAttributes<HTMLLabelElement> & { required?: boolean }) {
  return (
    <label
      className={cn('text-xs font-medium text-fg-muted', className)}
      {...props}
    >
      {children}
      {required && (
        <span aria-hidden="true" className="ml-0.5 text-primary">
          *
        </span>
      )}
    </label>
  );
}

export function FieldHint({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-xs text-fg-subtle', className)} {...props} />;
}

export function FieldError({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      role="alert"
      className={cn('text-xs text-danger empty:hidden', className)}
      {...props}
    />
  );
}

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'h-8 w-full min-w-0 rounded-md border border-border-strong bg-bg-app px-2.5 text-[13px] text-fg-main placeholder:text-fg-subtle',
        'transition-colors duration-150 hover:border-fg-muted',
        'aria-[invalid=true]:border-danger',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'h-8 w-full min-w-0 rounded-md border border-border-strong bg-bg-app px-2.5 text-[13px] text-fg-main',
        'transition-colors duration-150 hover:border-fg-muted',
        'aria-[invalid=true]:border-danger',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

export interface SwitchProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'role'> {
  labelId?: string;
}

export function Switch({ className, labelId, checked, ...props }: SwitchProps) {
  return (
    <label className={cn('relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center', className)}>
      <input
        type="checkbox"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        checked={checked}
        className="peer absolute inset-0 z-10 m-0 size-full cursor-pointer opacity-0"
        {...props}
      />
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none block h-5 w-9 rounded-full border border-border-strong bg-bg-surface transition-colors duration-150',
          'peer-checked:border-primary peer-checked:bg-primary',
          'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary',
          'after:absolute after:top-0.5 after:left-0.5 after:size-3.5 after:rounded-full after:bg-fg-muted after:transition-transform after:duration-150',
          'peer-checked:after:translate-x-4 peer-checked:after:bg-on-primary',
        )}
      />
    </label>
  );
}

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: string;
}

export function Checkbox({ id, label, className, ...props }: CheckboxProps) {
  return (
    <label
      htmlFor={id}
      className={cn(
        'inline-flex min-h-7 cursor-pointer items-center gap-2 text-xs text-fg-muted select-none',
        className,
      )}
    >
      <input
        id={id}
        type="checkbox"
        className="size-3.5 shrink-0 cursor-pointer accent-primary"
        {...props}
      />
      <span>{label}</span>
    </label>
  );
}

export function Kbd({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        'inline-flex h-[18px] items-center rounded-sm border border-border-line bg-bg-surface px-1.5 font-mono text-[10px] leading-none text-fg-muted',
        className,
      )}
      {...props}
    />
  );
}

export interface AlertProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'info' | 'warning' | 'danger' | 'safe';
  icon?: IconName;
}

const ALERT_STYLES: Record<NonNullable<AlertProps['variant']>, { box: string; icon: IconName }> = {
  info: { box: 'border-primary/30 bg-primary-soft text-primary', icon: 'shield' },
  warning: { box: 'border-warning/35 bg-warning-soft text-warning', icon: 'alert-triangle' },
  danger: { box: 'border-danger/35 bg-danger-soft text-danger', icon: 'shield-ban' },
  safe: { box: 'border-safe/30 bg-safe-soft text-safe', icon: 'check-circle' },
};

export function Alert({
  variant = 'info',
  icon,
  className,
  children,
  ...props
}: AlertProps) {
  const style = ALERT_STYLES[variant];
  return (
    <div
      className={cn(
        'flex items-start gap-2.5 rounded-md border px-3 py-2.5 text-xs leading-relaxed',
        style.box,
        className,
      )}
      {...props}
    >
      <Icon name={icon ?? style.icon} className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
