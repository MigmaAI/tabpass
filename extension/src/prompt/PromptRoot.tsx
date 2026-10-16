import { useEffect, useState } from 'react';

import { send, type ConnectPrompt as ConnectPromptData, type SitePrompt } from '@/lib/api';

import { ConnectPrompt } from './ConnectPrompt';
import { SiteAccessPrompt } from './SiteAccessPrompt';

type Loaded = { kind: 'site'; prompt: SitePrompt } | { kind: 'connect'; prompt: ConnectPromptData } | { kind: 'gone' };

/** prompt.html?id=… asks about a site; prompt.html?connect=… asks to connect an account. */
function PromptRoot() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    send('getState').then((state) => {
      const site = state.prompts.find((prompt) => prompt.id === params.get('id'));
      const connect = state.connectPrompts.find((prompt) => prompt.id === params.get('connect'));
      if (site) {
        document.title = `Allow ${site.agentLabel} on ${site.site}?`;
        setLoaded({ kind: 'site', prompt: site });
      } else if (connect) {
        document.title = `Connect to ${connect.providerName}?`;
        setLoaded({ kind: 'connect', prompt: connect });
      } else {
        setLoaded({ kind: 'gone' });
      }
    });
  }, []);

  if (!loaded) return null;
  if (loaded.kind === 'site') return <SiteAccessPrompt prompt={loaded.prompt} />;
  if (loaded.kind === 'connect') return <ConnectPrompt prompt={loaded.prompt} />;
  return (
    <main className="grid min-h-screen place-content-center p-6 text-center text-sm text-muted-foreground">
      This request is no longer waiting. You can close this window.
    </main>
  );
}

PromptRoot.displayName = 'PromptRoot';

export { PromptRoot };
