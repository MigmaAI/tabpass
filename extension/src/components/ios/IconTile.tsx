import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

interface IconTileProps {
  /** One or two letters, or an icon. */
  children: ReactNode;
  color: string;
  size?: 'sm' | 'lg';
  className?: string;
}

/** The rounded-square app tile from iOS Settings, used to recognize each tool at a glance. */
function IconTile({ children, color, size = 'sm', className }: IconTileProps) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 items-center justify-center font-semibold text-white [&_svg]:size-4',
        size === 'sm' ? 'size-7 rounded-[7px] text-[11px]' : 'size-14 rounded-[14px] text-lg [&_svg]:size-7',
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
