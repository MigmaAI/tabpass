import { useState, type FormEvent } from 'react';

import { ListRow, ListSection } from '@/components/ios/List';
import { NavBar } from '@/components/ios/NavBar';
import { Pill } from '@/components/ios/Pill';
import { Toggle } from '@/components/ios/Toggle';
import { send, type TabpassState } from '@/lib/api';

import { useNavigation } from '../navigation';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { SiteRows } from '../parts/SiteRows';

/** Which sites agents may use without asking, and which they never may. */
function SitesScreen({ state, onChange }: { state: TabpassState; onChange: () => void }) {
  const { pop, backLabel } = useNavigation();
  const [site, setSite] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);

  const add = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    try {
      await send('addSite', { site, list: submitter?.value === 'blocked' ? 'blocked' : 'allowed' });
      setSite('');
      setError(null);
      onChange();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };

  return (
    <>
      <NavBar title="Sites" back={{ label: backLabel, onClick: pop }} />
      <div className="grid gap-6 px-4 pt-2 pb-8">
        <ListSection footer={state.settings.allowAllSites ? 'Agents use any site without asking.' : 'Agents ask you before each new site.'}>
          <ListRow
            title="Allow every site"
            trailing={
              <Toggle
                label="Allow every site"
                checked={state.settings.allowAllSites}
                onChange={(on) => (on ? setConfirmAll(true) : send('setAllowAllSites', { value: false }).then(onChange))}
              />
            }
          />
        </ListSection>
        <ListSection title="Always allowed">
          <SiteRows sites={state.sites.allowed} list="allowed" onChange={onChange} />
        </ListSection>
        <ListSection title="Blocked" footer="Blocked sites are hidden from agents, even in the list of tabs.">
          <SiteRows sites={state.sites.blocked} list="blocked" onChange={onChange} />
        </ListSection>
        <form onSubmit={add} className="grid gap-2">
          <ListSection title="Add a site" footer={error ? <span className="text-destructive">{error}</span> : undefined}>
            <input
              aria-label="Site"
              placeholder="example.com"
              value={site}
              onChange={(event) => setSite(event.target.value)}
              autoComplete="off"
              className="h-11 w-full bg-transparent px-4 text-[15px] outline-none placeholder:text-muted-foreground"
            />
          </ListSection>
          <div className="flex gap-2 px-1">
            <Pill type="submit" size="sm" variant="secondary" value="allowed">
              Allow
            </Pill>
            <Pill type="submit" size="sm" variant="secondary" value="blocked">
              Block
            </Pill>
          </div>
        </form>
      </div>
      <ConfirmDialog
        open={confirmAll}
        onOpenChange={setConfirmAll}
        title="Allow every site?"
        description="Every agent could then read and use any site you are signed in to, without asking first."
        confirmLabel="Allow every site"
        onConfirm={() => send('setAllowAllSites', { value: true }).then(onChange)}
      />
    </>
  );
}

SitesScreen.displayName = 'SitesScreen';

export { SitesScreen };
