import type { HTMLAttributes, ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import { cn } from '@/lib/cn';

export interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  className?: string;
  children: ReactNode;
}

function isOutsideRect(clientX: number, clientY: number, rect: DOMRect): boolean {
  return (
    clientX < rect.left ||
    clientX > rect.right ||
    clientY < rect.top ||
    clientY > rect.bottom
  );
}

export function Sheet({
  open,
  onOpenChange,
  ariaLabel,
  ariaLabelledBy,
  className,
  children,
}: SheetProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const invokerRef = useRef<HTMLElement | null>(null);
  const pressedOutsideRef = useRef(false);
  const onOpenChangeRef = useRef(onOpenChange);

  onOpenChangeRef.current = onOpenChange;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      if (!dialog.open) {
        invokerRef.current =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
        dialog.showModal();
      }
    } else if (dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleClose = () => {
      dialog.returnValue = '';
      onOpenChangeRef.current(false);
      const invoker = invokerRef.current;
      invokerRef.current = null;
      if (invoker && invoker.isConnected) {
        queueMicrotask(() => {
          if (document.activeElement === document.body || document.activeElement === null) {
            invoker.focus();
          }
        });
      }
    };

    dialog.addEventListener('close', handleClose);
    return () => {
      dialog.removeEventListener('close', handleClose);
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      onPointerDown={(event) => {
        const dialog = dialogRef.current;
        if (!dialog) return;
        pressedOutsideRef.current = isOutsideRect(
          event.clientX,
          event.clientY,
          dialog.getBoundingClientRect(),
        );
      }}
      onPointerUp={(event) => {
        if (!pressedOutsideRef.current) return;
        pressedOutsideRef.current = false;
        const dialog = dialogRef.current;
        if (!dialog) return;
        if (isOutsideRect(event.clientX, event.clientY, dialog.getBoundingClientRect())) {
          dialog.close();
        }
      }}
      className={cn('inspect-sheet-dialog', className)}
    >
      {open ? children : null}
    </dialog>
  );
}

export function SheetHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'sticky top-0 z-10 flex shrink-0 items-start justify-between gap-3 border-b border-border-line bg-bg-card px-5 py-4',
        className,
      )}
      {...props}
    />
  );
}

export function SheetBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('min-h-0 flex-1 overflow-y-auto px-5 py-4', className)} {...props} />
  );
}

export function SheetFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'sticky bottom-0 z-10 flex shrink-0 items-center justify-end gap-2 border-t border-border-line bg-bg-card px-5 py-3',
        className,
      )}
      {...props}
    />
  );
}
