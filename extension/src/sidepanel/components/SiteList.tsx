import { XIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { send } from '@/lib/api';

interface SiteListProps {
  title: string;
  sites: string[];
  list: 'allowed' | 'blocked';
  onChange: () => void;
}

function SiteList({ title, sites, list, onChange }: SiteListProps) {
  return (
    <div className="grid gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{title}</span>
      {sites.length === 0 ? (
        <p className="text-sm text-muted-foreground">None yet.</p>
      ) : (
        <ul className="grid gap-1" aria-label={title}>
          {sites.map((site) => (
            <li key={site} className="flex items-center gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate">{site}</span>
              <Button variant="ghost" size="icon-xs" aria-label={`Remove ${site}`} onClick={() => send('removeSite', { site, list }).then(onChange)}>
                <XIcon />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

SiteList.displayName = 'SiteList';

export { SiteList };
