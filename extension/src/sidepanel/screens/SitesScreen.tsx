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
      <NavBar title="Website access" back={{ label: backLabel, onClick: pop }} />
      <div className="grid gap-6 px-4 pt-4 pb-8">
        <p className="px-1 text-[13px] leading-[18px] text-muted-foreground">Choose which websites your AI can access.</p>
        <ListSection footer={state.settings.allowAllSites ? 'Connected AI can access any website except those you block.' : 'Your AI must ask before accessing a new website.'}>
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
        <ListSection title="Blocked" footer="Your AI cannot see blocked websites, even in the tab list.">
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
              className="field-surface h-12 w-full rounded-xl px-3 text-[14px] outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/70"
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
        description="Connected AI could read websites you are signed in to without asking first. AI with “Read and act” access could also click and type. Blocked websites stay blocked."
        confirmLabel="Allow every site"
        onConfirm={() => send('setAllowAllSites', { value: true }).then(onChange)}
      />
    </>
  );
}

SitesScreen.displayName = 'SitesScreen';

export { SitesScreen };
