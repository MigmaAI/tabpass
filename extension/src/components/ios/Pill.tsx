import type { ButtonHTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

interface PillProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'plain' | 'destructive';
  size?: 'lg' | 'sm';
}

const VARIANTS = {
  primary: 'bg-primary text-primary-foreground hover:bg-primary/90',
  secondary: 'bg-secondary text-foreground hover:bg-pressed',
  plain: 'bg-transparent text-tint hover:bg-accent/55',
  destructive: 'bg-transparent text-destructive hover:bg-secondary',
};

/** Codex-style pill: ink for the one main action, a soft fill for the rest. */
function Pill({ variant = 'primary', size = 'lg', className, type = 'button', ...props }: PillProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-[11px] font-semibold whitespace-nowrap transition-[transform,background-color,box-shadow] duration-200 outline-none',
        'focus-visible:ring-[3px] focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4',
        size === 'lg' ? 'min-h-11 px-5 text-[14px]' : 'min-h-9 px-3 text-[12px]',
        VARIANTS[variant],
        className
      )}
      {...props}
    />
  );
}

Pill.displayName = 'Pill';

export { Pill };
