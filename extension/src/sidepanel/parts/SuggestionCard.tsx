import type { ReactNode } from 'react';

interface SuggestionCardProps {
  tile: ReactNode;
  title: string;
  subtitle: string;
  action: ReactNode;
}

function SuggestionCard({ tile, title, subtitle, action }: SuggestionCardProps) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-card px-4 py-3" role="note">
      {tile}
      <span className="grid min-w-0 flex-1">
        <span className="truncate text-[15px] font-semibold">{title}</span>
        <span className="truncate text-[13px] text-muted-foreground">{subtitle}</span>
      </span>
      {action}
    </div>
  );
}

SuggestionCard.displayName = 'SuggestionCard';

export { SuggestionCard };
