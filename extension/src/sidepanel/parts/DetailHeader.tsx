import type { ReactNode } from 'react';

interface DetailHeaderProps {
  tile: ReactNode;
  title: string;
  subtitle?: ReactNode;
}

/** Big tile, name and one line: the top of a detail screen, like an iOS contact or app page. */
function DetailHeader({ tile, title, subtitle }: DetailHeaderProps) {
  return (
    <div className="grid justify-items-center gap-2 pt-2 text-center">
      {tile}
      <div className="grid gap-0.5">
        <p className="text-[20px] leading-6 font-semibold tracking-[-0.01em]">{title}</p>
        {subtitle && <p className="text-[13px] text-muted-foreground">{subtitle}</p>}
      </div>
    </div>
  );
}

DetailHeader.displayName = 'DetailHeader';

export { DetailHeader };
