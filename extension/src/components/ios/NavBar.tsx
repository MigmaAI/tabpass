import { ChevronLeftIcon } from 'lucide-react';
import type { ReactNode } from 'react';

interface NavBarProps {
  title: string;
  back?: { label: string; onClick: () => void };
  trailing?: ReactNode;
}

/** Compact editorial navigation for pushed screens. */
function NavBar({ title, back, trailing }: NavBarProps) {
  return (
    <header className="sticky top-0 z-10 grid min-h-14 grid-cols-[1fr_auto_1fr] items-center border-b border-separator bg-background/92 px-2 backdrop-blur-xl">
      <div className="flex">
        {back && (
          <button
            type="button"
            onClick={back.onClick}
            className="flex min-h-11 items-center gap-0.5 rounded-lg pr-2 text-[13px] font-medium text-tint outline-none hover:bg-accent/55 focus-visible:ring-2 focus-visible:ring-ring/70"
          >
            <ChevronLeftIcon className="size-[18px]" strokeWidth={1.8} aria-hidden />
            {back.label}
          </button>
        )}
      </div>
      <h1 className="truncate text-[13px] font-semibold tracking-[0.01em] outline-none">{title}</h1>
      <div className="flex justify-end">{trailing}</div>
    </header>
  );
}

NavBar.displayName = 'NavBar';

export { NavBar };
