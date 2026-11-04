import { ArrowRightIcon } from 'lucide-react';

import { Pill } from '@/components/ios/Pill';
import { send, type TabpassState } from '@/lib/api';
import { CLIENTS } from '@/lib/clients';
import { agentConnectionStatus } from '@/lib/format';

import { useNavigation } from '../navigation';

import { SuggestionCard } from './SuggestionCard';
import { guideForName, ToolTile } from '@/components/tiles';
import { useActiveTabUrl } from './useActiveTab';

function secureOrigin(value: string): string | null {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' ? parsed.origin : null;
  } catch {
    return null;
  }
}

/** Show the active site's saved connection, or offer setup when it has no grant. */
function Suggestion({ state, onChange }: { state: TabpassState; onChange: () => void }) {
  const url = useActiveTabUrl();
  const { push } = useNavigation();
  const activeOrigin = url ? secureOrigin(url) : null;
  if (!activeOrigin) return null;

  const guide = CLIENTS.find((client) => client.matches?.some((match) => secureOrigin(match) === activeOrigin));
  if (guide) {
    // A website's grant belongs to its exact origin, regardless of its chosen display name.
    // Legacy manual/OAuth clients have no website origin, so retain their used-name match.
    const agent = state.agents.find((candidate) => candidate.source === 'web' && secureOrigin(candidate.origin ?? '') === activeOrigin)
      ?? state.agents.find((candidate) => candidate.source !== 'web' && guideForName(candidate.label)?.id === guide.id && candidate.lastUsedAt);
    if (agent) {
      const status = agentConnectionStatus(agent, state.settings.paused);
      const subtitle = status === 'Paused' ? 'Browser access is paused. Turn it on above.'
        : status === 'Offline' ? 'Browser offline. Your connection is saved.'
        : status === 'Connecting…' ? 'Connecting to your browser…'
        : agent.access === 'control' ? 'Can read and use pages you allow.' : 'Can read pages you allow.';
      return (
        <SuggestionCard
          tile={<ToolTile guide={guide} />}
          title={`${guide.name} ${status.toLowerCase()}`}
          subtitle={subtitle}
          action={<Pill variant="secondary" className="w-full" onClick={() => push({ name: 'agent', id: agent.id })}>Manage connection</Pill>}
        />
      );
    }
    return (
      <SuggestionCard
        tile={<ToolTile guide={guide} />}
        title={`${guide.name} detected`}
        subtitle={`Give ${guide.name}’s AI access to your browser.`}
        action={
          <Pill
            className="w-full"
            onClick={() => {
              if (guide.action) void chrome.tabs.create({ url: guide.action.href(state.mcpUrl) });
              else push({ name: 'tool', id: guide.id });
            }}
          >
            {guide.action ? `Connect ${guide.name}` : `Set up ${guide.name}`} <ArrowRightIcon aria-hidden />
          </Pill>
        }
      />
    );
  }

  const provider = state.providers.find(
    (candidate) => !candidate.account && !candidate.pending && secureOrigin(candidate.connectUrl) === activeOrigin,
  );
  if (!provider) return null;
  return (
    <SuggestionCard
      tile={<span className="inline-flex size-7 items-center justify-center rounded-[7px] bg-primary text-[12px] font-bold text-primary-foreground">M</span>}
      title={`${provider.name} detected`}
      subtitle={`Give ${provider.name}’s AI access to your browser.`}
      action={<Pill className="w-full" onClick={() => send('startConnect', { provider: provider.id }).then(onChange)}>Connect {provider.name} <ArrowRightIcon aria-hidden /></Pill>}
    />
  );
}

Suggestion.displayName = 'Suggestion';

export { Suggestion };
