import { ChevronLeftIcon } from 'lucide-react';
import type { ReactNode } from 'react';

interface NavBarProps {
  title: string;
  back?: { label: string; onClick: () => void };
  trailing?: ReactNode;
}

/** The pushed screen's bar: back on the leading edge, title centered. */
function NavBar({ title, back, trailing }: NavBarProps) {
  return (
    <header className="sticky top-0 z-10 grid h-11 grid-cols-[1fr_auto_1fr] items-center bg-background/85 px-2 backdrop-blur-xl">
      <div className="flex">
        {back && (
          <button
            type="button"
            onClick={back.onClick}
            className="flex h-9 items-center gap-0.5 rounded-md pr-2 text-[15px] text-tint outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            <ChevronLeftIcon className="size-5" aria-hidden />
            {back.label}
          </button>
        )}
      </div>
      <h1 className="truncate text-[15px] font-semibold">{title}</h1>
      <div className="flex justify-end">{trailing}</div>
    </header>
  );
}

NavBar.displayName = 'NavBar';

export { NavBar };
