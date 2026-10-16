import { ExternalLinkIcon } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';

import { ListRow, ListSection } from '@/components/ios/List';
import { NavBar } from '@/components/ios/NavBar';
import { Pill } from '@/components/ios/Pill';
import { send, type TabpassState } from '@/lib/api';
import { hostOf } from '@/lib/format';

import { useNavigation } from '../navigation';

const REPO = 'https://github.com/migmaai/tabpass';

/** This browser's name, the relay it uses, what it shares, and where the code lives. */
function BrowserScreen({ state, onChange }: { state: TabpassState; onChange: () => void }) {
  const { pop, backLabel } = useNavigation();
  const [name, setName] = useState(state.settings.browserName);
  const [relayUrl, setRelayUrl] = useState(state.settings.relayUrl);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setName(state.settings.browserName), [state.settings.browserName]);
  useEffect(() => setRelayUrl(state.settings.relayUrl), [state.settings.relayUrl]);

  const save = (type: string, payload: Record<string, unknown>) => async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    try {
      await send(type, payload);
      setError(null);
      onChange();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };
  const field = 'field-surface h-12 min-w-0 flex-1 rounded-xl px-3 text-[14px] outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/70';

  return (
    <>
      <NavBar title="This browser" back={{ label: backLabel, onClick: pop }} />
      <div className="grid gap-6 px-4 pt-4 pb-8">
        <div className="grid gap-1 px-1"><h2 className="text-[23px] leading-7 font-semibold tracking-[-0.04em]">This browser, clearly identified.</h2><p className="text-[12px] leading-[17px] text-muted-foreground">Name it for your AI tools and choose how it stays reachable.</p></div>
        <form onSubmit={save('setBrowserName', { browserName: name })}>
          <ListSection title="Name" footer="Agents use it to pick between your browsers.">
            <div className="flex items-center pr-2">
              <input id="browser-name" aria-label="Browser name" value={name} onChange={(event) => setName(event.target.value)} maxLength={60} className={field} />
              <Pill type="submit" size="sm" variant="secondary">
                Save
              </Pill>
            </div>
          </ListSection>
        </form>
        <form onSubmit={save('setRelayUrl', { relayUrl })}>
          <ListSection
            title="Relay"
            footer={
              error ? (
                <span className="text-destructive">{error}</span>
              ) : state.status.state === 'connected' ? (
                `Connected. AI tools reach this browser through ${hostOf(state.mcpUrl)}.`
              ) : (
                (state.status.message ?? 'Connecting…')
              )
            }
          >
            <div className="flex items-center pr-2">
              <input
                id="relay-url"
                aria-label="Relay address"
                value={relayUrl}
                onChange={(event) => setRelayUrl(event.target.value)}
                placeholder="wss://tabs.migma.ai/extension"
                autoComplete="off"
                className={`${field} font-mono text-[13px]`}
              />
              <Pill type="submit" size="sm" variant="secondary">
                Save
              </Pill>
            </div>
          </ListSection>
        </form>
        <ListSection title="What leaves this browser">
          <ListRow
            title={
              <span className="text-[13px] leading-[18px] whitespace-normal text-muted-foreground">
                Page text, screenshots and highlighted text go only to AI tools you connected, only on sites you allow, through the relay
                above. Tab titles and links go to them so they can find a tab. Nothing is sold or used for ads.
              </span>
            }
          />
          <ListRow title="Privacy policy" onClick={() => chrome.tabs.create({ url: `${REPO}/blob/main/PRIVACY.md` })} trailing={<ExternalLinkIcon className="size-4 text-muted-foreground" />} />
        </ListSection>
        <ListSection title="About">
          <ListRow title="Version" value={chrome.runtime.getManifest().version} />
          <ListRow title="Source code" value="GitHub" onClick={() => chrome.tabs.create({ url: REPO })} trailing={<ExternalLinkIcon className="size-4 text-muted-foreground" />} />
        </ListSection>
      </div>
    </>
  );
}

BrowserScreen.displayName = 'BrowserScreen';

export { BrowserScreen };
