import { useEffect, useState } from 'react';

import { send, type AgentPrompt as AgentPromptData, type ConnectPrompt, type SitePrompt } from '@/lib/api';

import { AccountPrompt } from './AccountPrompt';
import { AgentPrompt } from './AgentPrompt';
import { SiteAccessPrompt } from './SiteAccessPrompt';

type Loaded =
  | { kind: 'site'; prompt: SitePrompt }
  | { kind: 'account'; prompt: ConnectPrompt }
  | { kind: 'agent'; prompt: AgentPromptData }
  | { kind: 'gone' };

/** prompt.html?id=… asks about a site, ?connect=… about an account, ?agent=… about an AI tool. */
function PromptRoot() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    send('getState').then((state) => {
      const site = state.prompts.find((prompt) => prompt.id === params.get('id'));
      const account = state.connectPrompts.find((prompt) => prompt.id === params.get('connect'));
      const agent = state.agentPrompts.find((prompt) => prompt.id === params.get('agent'));
      if (site) {
        document.title = `Allow ${site.agentLabel} on ${site.site}?`;
        setLoaded({ kind: 'site', prompt: site });
      } else if (account) {
        document.title = `Connect to ${account.providerName}?`;
        setLoaded({ kind: 'account', prompt: account });
      } else if (agent) {
        document.title = `Connect ${agent.name}?`;
        setLoaded({ kind: 'agent', prompt: agent });
      } else {
        setLoaded({ kind: 'gone' });
      }
    });
  }, []);

  if (!loaded) return null;
  if (loaded.kind === 'site') return <SiteAccessPrompt prompt={loaded.prompt} />;
  if (loaded.kind === 'account') return <AccountPrompt prompt={loaded.prompt} />;
  if (loaded.kind === 'agent') return <AgentPrompt prompt={loaded.prompt} />;
  return (
    <main className="grid min-h-screen place-content-center p-6 text-center text-[13px] text-muted-foreground">
      This request is no longer waiting. You can close this window.
    </main>
  );
}

PromptRoot.displayName = 'PromptRoot';

export { PromptRoot };
