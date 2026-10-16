import type { ButtonHTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

interface PillProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'plain' | 'destructive';
  size?: 'lg' | 'sm';
}

const VARIANTS = {
  primary: 'bg-primary text-primary-foreground hover:opacity-90',
  secondary: 'bg-secondary text-foreground hover:bg-pressed',
  plain: 'bg-transparent text-tint hover:bg-secondary',
  destructive: 'bg-transparent text-destructive hover:bg-secondary',
};

/** Codex-style pill: ink for the one main action, a soft fill for the rest. */
function Pill({ variant = 'primary', size = 'lg', className, type = 'button', ...props }: PillProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full font-semibold whitespace-nowrap transition outline-none',
        'focus-visible:ring-[3px] focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4',
        size === 'lg' ? 'h-11 px-5 text-[15px]' : 'h-[30px] px-3.5 text-[13px]',
        VARIANTS[variant],
        className
      )}
      {...props}
    />
  );
}

Pill.displayName = 'Pill';

export { Pill };
