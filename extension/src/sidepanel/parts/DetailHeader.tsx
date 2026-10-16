import type { ReactNode } from 'react';

interface DetailHeaderProps {
  tile: ReactNode;
  title: string;
  subtitle?: ReactNode;
}

/** A generous identity lockup at the top of detail screens. */
function DetailHeader({ tile, title, subtitle }: DetailHeaderProps) {
  return (
    <div className="grid justify-items-center gap-3 px-3 pt-4 pb-2 text-center">
      {tile}
      <div className="grid min-w-0 max-w-full gap-1 [overflow-wrap:anywhere]">
        <p className="text-[22px] leading-6 font-semibold tracking-[-0.035em]">{title}</p>
        {subtitle && <p className="text-[12px] leading-[17px] text-muted-foreground">{subtitle}</p>}
      </div>
    </div>
  );
}

DetailHeader.displayName = 'DetailHeader';

export { DetailHeader };
