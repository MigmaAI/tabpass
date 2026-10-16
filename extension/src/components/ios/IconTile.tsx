import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

interface IconTileProps {
  /** One or two letters, or an icon. */
  children: ReactNode;
  color: string;
  size?: 'sm' | 'lg';
  className?: string;
}

/** A precise logo tile, optically aligned across genuine and fallback marks. */
function IconTile({ children, color, size = 'sm', className }: IconTileProps) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden font-semibold text-white [&_svg]:size-4',
        size === 'sm' ? 'size-10 rounded-[12px] text-[12px] [&_svg]:size-[18px]' : 'size-[60px] rounded-[18px] text-lg [&_svg]:size-7',
        className
      )}
      style={{ background: color }}
    >
      {children}
    </span>
  );
}

IconTile.displayName = 'IconTile';

export { IconTile };
