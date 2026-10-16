import { ChevronRightIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

interface ListSectionProps {
  title?: string;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** A quiet section with a clear label and flat, scan-friendly rows. */
function ListSection({ title, footer, children, className }: ListSectionProps) {
  return (
    <section className={cn('grid gap-2', className)} aria-label={title}>
      {title && <h2 className="px-1 text-[12px] font-semibold tracking-[0.035em] text-muted-foreground">{title}</h2>}
      <div className="overflow-hidden">{children}</div>
      {footer && <div className="px-1 text-[12px] leading-[17px] text-muted-foreground">{footer}</div>}
    </section>
  );
}

interface ListRowProps {
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Muted text before the chevron, e.g. "3 allowed". */
  value?: ReactNode;
  /** Anything on the trailing edge: a toggle, a pill button. Replaces the chevron. */
  trailing?: ReactNode;
  onClick?: () => void;
  tone?: 'default' | 'tint' | 'destructive';
  className?: string;
  label?: string;
}

/**
 * One 44pt row. With onClick it shows a chevron and opens something; a trailing element (a toggle,
 * a pill button) sits beside the tappable area instead of the chevron.
 */
function ListRow({ icon, title, subtitle, value, trailing, onClick, tone = 'default', className, label }: ListRowProps) {
  const main = (
    <>
      {icon}
      <span className="grid min-w-0 flex-1 text-left">
        <span
          className={cn(
            'truncate text-[14px] leading-5 font-medium',
            tone === 'tint' && 'text-tint',
            tone === 'destructive' && 'text-destructive'
          )}
        >
          {title}
        </span>
        {subtitle && <span className="truncate text-[12px] leading-[17px] text-muted-foreground">{subtitle}</span>}
      </span>
      {value && <span className="max-w-[45%] shrink-0 truncate text-[12px] font-medium text-muted-foreground">{value}</span>}
      {onClick && !trailing && tone === 'default' && <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground/55" strokeWidth={1.7} aria-hidden />}
    </>
  );
  const area = 'flex min-h-12 min-w-0 flex-1 items-center gap-3 py-2.5';
  return (
    <div className={cn('flex items-center gap-3 px-1', onClick && 'transition-colors hover:bg-accent/45 has-[>button:active]:bg-pressed', className)}>
      {onClick ? (
        <button
          type="button"
          onClick={onClick}
          aria-label={label}
          className={cn(area, 'rounded-lg px-2 outline-none focus-visible:ring-2 focus-visible:ring-ring/70')}
        >
          {main}
        </button>
      ) : (
        <div className={`${area} px-2`} aria-label={label}>
          {main}
        </div>
      )}
      {trailing}
    </div>
  );
}

ListSection.displayName = 'ListSection';
ListRow.displayName = 'ListRow';

export { ListRow, ListSection };
