import type {
  HTMLAttributes,
  TableHTMLAttributes,
  TdHTMLAttributes,
  ThHTMLAttributes,
} from 'react';
import { cn } from '@/lib/cn';

export function TableContainer({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      tabIndex={0}
      role="region"
      className={cn(
        'relative max-w-full overflow-x-auto focus-visible:outline-2 focus-visible:outline-primary focus-visible:-outline-offset-2',
        className,
      )}
      {...props}
    />
  );
}

export function Table({ className, ...props }: TableHTMLAttributes<HTMLTableElement>) {
  return (
    <table
      className={cn('w-full border-collapse text-left whitespace-nowrap', className)}
      {...props}
    />
  );
}

export function TableHeader({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      className={cn(
        'sticky top-0 z-10 bg-bg-surface/95 backdrop-blur-xs',
        className,
      )}
      {...props}
    />
  );
}

export function TableBody({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn('divide-y divide-border-line', className)} {...props} />;
}

export function TableRow({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn(
        'h-[38px] border-b border-border-line transition-colors duration-150 hover:bg-bg-surface/70 last:border-b-0',
        className,
      )}
      {...props}
    />
  );
}

export function TableHead({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={cn(
        'h-8 border-b border-border-line px-3 text-[11px] font-medium tracking-wider text-fg-muted uppercase first:pl-4 last:pr-4',
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={cn(
        'h-[38px] px-3 py-0 align-middle text-[12px] text-fg-muted first:pl-4 last:pr-4',
        className,
      )}
      {...props}
    />
  );
}
