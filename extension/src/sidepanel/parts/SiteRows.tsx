import { MinusIcon } from 'lucide-react';

import { ListRow } from '@/components/ios/List';
import { send } from '@/lib/api';

interface SiteRowsProps {
  sites: string[];
  list: 'allowed' | 'blocked';
  onChange: () => void;
}

/** Sites with the iOS red minus to remove one. */
function SiteRows({ sites, list, onChange }: SiteRowsProps) {
  if (!sites.length) return <ListRow title={<span className="text-muted-foreground">None yet</span>} />;
  return (
    <>
      {sites.map((site) => (
        <ListRow
          key={site}
          title={site}
          trailing={
            <button
              type="button"
              aria-label={`Remove ${site}`}
              onClick={() => send('removeSite', { site, list }).then(onChange)}
              className="inline-flex size-6 items-center justify-center rounded-full bg-destructive text-white outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
            >
              <MinusIcon className="size-3.5" strokeWidth={3} />
            </button>
          }
        />
      ))}
    </>
  );
}

SiteRows.displayName = 'SiteRows';

export { SiteRows };
