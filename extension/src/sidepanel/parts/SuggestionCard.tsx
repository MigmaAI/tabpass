import type { ReactNode } from 'react';

interface SuggestionCardProps {
  tile: ReactNode;
  title: string;
  subtitle: string;
  action: ReactNode;
}

function SuggestionCard({ tile, title, subtitle, action }: SuggestionCardProps) {
  return (
    <div className="flex items-center gap-3 border-y border-tint/25 bg-accent/35 px-3 py-3" role="note">
      {tile}
      <span className="grid min-w-0 flex-1">
        <span className="truncate text-[14px] font-semibold">{title}</span>
        <span className="truncate text-[12px] text-muted-foreground">{subtitle}</span>
      </span>
      {action}
    </div>
  );
}

SuggestionCard.displayName = 'SuggestionCard';

export { SuggestionCard };
