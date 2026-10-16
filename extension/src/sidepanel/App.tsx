import { TooltipProvider } from '@/components/ui/tooltip';
import { useTabpassState } from '@/lib/api';

import { ActivitySection } from './components/ActivitySection';
import { AgentsCard } from './components/AgentsCard';
import { BrowserSection } from './components/BrowserSection';
import { Header } from './components/Header';
import { ProviderCard } from './components/ProviderCard';
import { SitePromptCard } from './components/SitePromptCard';
import { SitesSection } from './components/SitesSection';

/**
 * Side panel, top to bottom: anything waiting on the person, the one-click account (Migma),
 * other agents, then folded sections for activity, sites and this browser.
 */
function App() {
  const { state, refresh } = useTabpassState();
  if (!state) return null;

  return (
    <TooltipProvider>
      <Header paused={state.settings.paused} onChange={refresh} />
      <main className="grid grid-cols-[minmax(0,1fr)] gap-3 p-4">
        {state.prompts.map((prompt) => (
          <SitePromptCard key={prompt.id} prompt={prompt} onChange={refresh} />
        ))}
        {state.providers.map((provider) => (
          <ProviderCard key={provider.id} provider={provider} onChange={refresh} />
        ))}
        <AgentsCard state={state} hasProviders={state.providers.length > 0} onChange={refresh} />
        <ActivitySection activity={state.activity} onChange={refresh} />
        <SitesSection state={state} onChange={refresh} />
        <BrowserSection state={state} onChange={refresh} />
      </main>
    </TooltipProvider>
  );
}

App.displayName = 'App';

export { App };
