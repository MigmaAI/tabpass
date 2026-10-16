import { useRef } from 'react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
}

/** shadcn/ui AlertDialog, worded like an iOS alert. */
function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel, destructive = false, onConfirm }: ConfirmDialogProps) {
  const opener = useRef<HTMLElement | null>(null);
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent
        className="max-w-[320px] rounded-[18px] border-border bg-popover shadow-[0_24px_64px_rgba(33,31,33,0.24)]"
        onOpenAutoFocus={() => { opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }}
        onCloseAutoFocus={(event) => {
          if (opener.current?.isConnected) {
            event.preventDefault();
            opener.current.focus();
          }
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="rounded-[10px]">Cancel</AlertDialogCancel>
          <AlertDialogAction variant={destructive ? 'destructive' : 'default'} className="rounded-[10px]" onClick={onConfirm}>
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

ConfirmDialog.displayName = 'ConfirmDialog';

export { ConfirmDialog };
