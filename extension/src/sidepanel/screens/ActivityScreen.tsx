import { CircleAlertIcon, CircleCheckIcon } from 'lucide-react';

import { ListRow, ListSection } from '@/components/ios/List';
import { NavBar } from '@/components/ios/NavBar';
import { send, type TabpassState } from '@/lib/api';
import { timeAgo } from '@/lib/format';

import { useNavigation } from '../navigation';

/** Everything agents did lately, failures included. */
function ActivityScreen({ state, onChange }: { state: TabpassState; onChange: () => void }) {
  const { pop, backLabel } = useNavigation();
  return (
    <>
      <NavBar
        title="Activity"
        back={{ label: backLabel, onClick: pop }}
        trailing={
          state.activity.length > 0 ? (
            <button type="button" className="h-9 rounded-md px-2 text-[15px] text-tint" onClick={() => send('clearActivity').then(onChange)}>
              Clear
            </button>
          ) : undefined
        }
      />
      <div className="grid gap-6 px-4 pt-2 pb-8">
        <ListSection>
          {state.activity.length === 0 && <ListRow title={<span className="text-muted-foreground">Nothing yet.</span>} />}
          {state.activity.map((entry, index) => (
            <ListRow
              key={`${entry.at}-${index}`}
              icon={entry.ok ? <CircleCheckIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden /> : <CircleAlertIcon className="size-4 shrink-0 text-destructive" aria-hidden />}
              title={`${entry.agent} · ${entry.tool.replace(/_/g, ' ')}`}
              subtitle={entry.ok ? [entry.site, timeAgo(entry.at)].filter(Boolean).join(' · ') : <span className="text-destructive">{entry.detail}</span>}
            />
          ))}
        </ListSection>
      </div>
    </>
  );
}

ActivityScreen.displayName = 'ActivityScreen';

export { ActivityScreen };
