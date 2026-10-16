import { Button } from '@/components/ui/button';
import { send, type ActivityEntry } from '@/lib/api';
import { timeAgo } from '@/lib/format';

import { Section } from './Section';

interface ActivitySectionProps {
  activity: ActivityEntry[];
  onChange: () => void;
}

function ActivitySection({ activity, onChange }: ActivitySectionProps) {
  return (
    <Section title="Activity" meta={activity.length ? `· ${activity.length}` : undefined}>
      {activity.length === 0 ? (
        <p className="text-sm text-muted-foreground">What your agents do shows up here.</p>
      ) : (
        <ul className="grid divide-y text-sm" aria-label="Activity">
          {activity.slice(0, 30).map((entry, index) => (
            <li key={`${entry.at}-${index}`} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-0.5 py-2">
              <span className="truncate">
                {entry.agent} · {entry.tool.replace(/_/g, ' ')}
                {entry.site ? ` · ${entry.site}` : ''}
              </span>
              <span className="text-xs text-muted-foreground">{timeAgo(entry.at)}</span>
              {!entry.ok && <span className="col-span-2 text-xs text-destructive">{entry.detail}</span>}
            </li>
          ))}
        </ul>
      )}
      {activity.length > 0 && (
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={() => send('clearActivity').then(onChange)}>
            Clear
          </Button>
        </div>
      )}
    </Section>
  );
}

ActivitySection.displayName = 'ActivitySection';

export { ActivitySection };
