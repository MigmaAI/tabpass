import { ChevronRightIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

interface ListSectionProps {
  title?: string;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** An inset grouped section: rounded card, rows divided by hairlines, small header and footer. */
function ListSection({ title, footer, children, className }: ListSectionProps) {
  return (
    <section className={cn('grid gap-1.5', className)} aria-label={title}>
      {title && <h2 className="px-4 text-[13px] font-medium text-muted-foreground">{title}</h2>}
      <div className="overflow-hidden rounded-xl bg-card [&>*+*]:border-t [&>*+*]:border-separator">{children}</div>
      {footer && <div className="px-4 text-[12px] leading-snug text-muted-foreground">{footer}</div>}
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
            'truncate text-[15px] leading-5',
            tone === 'tint' && 'text-tint',
            tone === 'destructive' && 'text-destructive'
          )}
        >
          {title}
        </span>
        {subtitle && <span className="truncate text-[13px] leading-[18px] text-muted-foreground">{subtitle}</span>}
      </span>
      {value && <span className="max-w-[45%] shrink-0 truncate text-[15px] text-muted-foreground">{value}</span>}
      {onClick && !trailing && tone === 'default' && <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground/70" aria-hidden />}
    </>
  );
  const area = 'flex min-h-11 min-w-0 flex-1 items-center gap-3 py-2';
  return (
    <div className={cn('flex items-center gap-3 px-4', onClick && 'transition-colors has-[>button:active]:bg-pressed', className)}>
      {onClick ? (
        <button
          type="button"
          onClick={onClick}
          aria-label={label}
          className={cn(area, 'rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/60')}
        >
          {main}
        </button>
      ) : (
        <div className={area} aria-label={label}>
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
