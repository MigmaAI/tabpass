import { Pill } from '@/components/ios/Pill';
import { send, type TabpassState } from '@/lib/api';
import { CLIENTS } from '@/lib/clients';

import { useNavigation } from '../navigation';

import { SuggestionCard } from './SuggestionCard';
import { guideForName, ToolTile } from '@/components/tiles';
import { useActiveTabUrl } from './useActiveTab';

/**
 * One-click setup for the site the person is on: on claude.ai, "Add Tabpass to Claude" opens
 * Claude's add-connector dialog already filled in; on Migma, "Connect" pairs the account.
 */
function Suggestion({ state, onChange }: { state: TabpassState; onChange: () => void }) {
  const url = useActiveTabUrl();
  const { push } = useNavigation();
  if (!url) return null;

  const provider = state.providers.find((candidate) => !candidate.account && !candidate.pending && url.startsWith(new URL(candidate.connectUrl).origin));
  if (provider) {
    return (
      <SuggestionCard
        tile={<span className="inline-flex size-7 items-center justify-center rounded-[7px] bg-primary text-[12px] font-bold text-primary-foreground">M</span>}
        title={`Use this browser with ${provider.name}`}
        subtitle="One click, no setup."
        action={<Pill size="sm" onClick={() => send('startConnect', { provider: provider.id }).then(onChange)}>Connect</Pill>}
      />
    );
  }

  const guide = CLIENTS.find((client) => client.matches?.some((prefix) => url.startsWith(prefix)));
  if (!guide || state.agents.some((agent) => guideForName(agent.label)?.id === guide.id)) return null;
  const open = (): void => {
    if (guide.action) void chrome.tabs.update({ url: guide.action.href(state.mcpUrl) });
    else push({ name: 'tool', id: guide.id });
  };
  return (
    <SuggestionCard
      tile={<ToolTile guide={guide} />}
      title={`Add Tabpass to ${guide.name}`}
      subtitle={guide.action ? 'Opens it ready to add. You approve here.' : 'Takes about a minute.'}
      action={
        <Pill size="sm" onClick={open}>
          {guide.action ? 'Add' : 'Show me'}
        </Pill>
      }
    />
  );
}

Suggestion.displayName = 'Suggestion';

export { Suggestion };
