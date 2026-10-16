import { useState } from 'react';

import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { TabpassState } from '@/lib/api';

import { AgentItem } from './AgentItem';
import { NewAgentForm } from './NewAgentForm';

interface AgentsCardProps {
  state: TabpassState;
  hasProviders: boolean;
  onChange: () => void;
}

function mcpUrlFor(state: TabpassState): string {
  return state.status.mcpUrl ?? state.settings.relayUrl.replace(/^ws/, 'http').replace(/\/extension\/?$/, '/mcp');
}

/** Any MCP agent gets its own link; each one can be cut off on its own. */
function AgentsCard({ state, hasProviders, onChange }: AgentsCardProps) {
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <Card className="gap-4 py-4" aria-labelledby="agents-title">
      <CardHeader className="px-4">
        <CardTitle id="agents-title">{hasProviders ? 'Other agents' : 'Agents'}</CardTitle>
        <CardDescription>Give any MCP agent its own link. You approve each new site.</CardDescription>
        <CardAction>
          <StatusBadge state={state.status.state} />
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-3 px-4">
        {state.agents.length > 0 && (
          <ul className="grid gap-2">
            {state.agents.map((agent) => (
              <AgentItem
                key={agent.id}
                agent={agent}
                mcpUrl={mcpUrlFor(state)}
                open={openId === agent.id}
                onOpenChange={(open) => setOpenId(open ? agent.id : null)}
                onChange={onChange}
              />
            ))}
          </ul>
        )}
        {adding ? (
          <NewAgentForm
            onCancel={() => setAdding(false)}
            onCreated={(agent) => {
              setAdding(false);
              setOpenId(agent.id);
              onChange();
            }}
          />
        ) : (
          <Button variant={hasProviders ? 'outline' : 'default'} onClick={() => setAdding(true)}>
            Connect an agent
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

AgentsCard.displayName = 'AgentsCard';

export { AgentsCard };
