import type { ReactNode } from 'react';

interface SuggestionCardProps {
  tile: ReactNode;
  title: string;
  subtitle: string;
  action: ReactNode;
}

function SuggestionCard({ tile, title, subtitle, action }: SuggestionCardProps) {
  return (
    <div className="grid gap-3 border-t border-tint/25 bg-background px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]" role="note" aria-label={title}>
      <div className="flex items-center gap-3">
        <span className="shrink-0">{tile}</span>
        <span className="grid min-w-0 gap-1">
          <span className="text-[14px] leading-[18px] font-semibold">{title}</span>
          <span className="text-[13px] leading-[18px] text-muted-foreground">{subtitle}</span>
        </span>
      </div>
      {action}
    </div>
  );
}

SuggestionCard.displayName = 'SuggestionCard';

export { SuggestionCard };
