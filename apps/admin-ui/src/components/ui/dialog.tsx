import type { HTMLAttributes, ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import { cn } from '@/lib/cn';

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Return false to prevent closing (e.g. unconfirmed one-time PAT safeguard).
   */
  onBeforeClose?: () => boolean;
  dismissOnBackdrop?: boolean;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  ariaDescribedBy?: string;
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

export function Dialog({
  open,
  onOpenChange,
  onBeforeClose,
  dismissOnBackdrop = true,
  ariaLabel,
  ariaLabelledBy,
  ariaDescribedBy,
  className,
  children,
}: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const invokerRef = useRef<HTMLElement | null>(null);
  const pressedOutsideRef = useRef(false);
  const onOpenChangeRef = useRef(onOpenChange);
  const onBeforeCloseRef = useRef(onBeforeClose);

  onOpenChangeRef.current = onOpenChange;
  onBeforeCloseRef.current = onBeforeClose;

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

    const handleCancel = (event: Event) => {
      if (onBeforeCloseRef.current && onBeforeCloseRef.current() === false) {
        event.preventDefault();
        return;
      }
      // Allow native Esc close, then sync React state on 'close'
    };

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

    dialog.addEventListener('cancel', handleCancel);
    dialog.addEventListener('close', handleClose);
    return () => {
      dialog.removeEventListener('cancel', handleCancel);
      dialog.removeEventListener('close', handleClose);
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      aria-describedby={ariaDescribedBy}
      onPointerDown={(event) => {
        if (!dismissOnBackdrop) {
          pressedOutsideRef.current = false;
          return;
        }
        const dialog = dialogRef.current;
        if (!dialog) return;
        pressedOutsideRef.current = isOutsideRect(
          event.clientX,
          event.clientY,
          dialog.getBoundingClientRect(),
        );
      }}
      onPointerUp={(event) => {
        if (!dismissOnBackdrop || !pressedOutsideRef.current) {
          pressedOutsideRef.current = false;
          return;
        }
        pressedOutsideRef.current = false;
        const dialog = dialogRef.current;
        if (!dialog) return;
        if (isOutsideRect(event.clientX, event.clientY, dialog.getBoundingClientRect())) {
          if (onBeforeCloseRef.current && onBeforeCloseRef.current() === false) {
            return;
          }
          dialog.close();
        }
      }}
      className={cn(
        'm-auto w-[min(520px,calc(100vw-32px))] max-h-[calc(100dvh-40px)] overflow-auto rounded-lg border border-border-line bg-bg-card p-0 text-fg-main shadow-[var(--shadow-modal)]',
        className,
      )}
    >
      {open ? children : null}
    </dialog>
  );
}

export function DialogHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex items-start justify-between gap-3 border-b border-border-line px-5 py-4',
        className,
      )}
      {...props}
    />
  );
}

export function DialogTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2
      className={cn('text-[15px] leading-[22px] font-semibold text-fg-main', className)}
      {...props}
    />
  );
}

export function DialogDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('mt-1 text-xs text-fg-muted', className)} {...props} />;
}

export function DialogBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-5 py-4', className)} {...props} />;
}

export function DialogFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex items-center justify-end gap-2 border-t border-border-line px-5 py-3',
        className,
      )}
      {...props}
    />
  );
}
