import { useState } from 'react';

import { Pill } from '@/components/ios/Pill';
import { send, type Access, type AgentPrompt as AgentPromptData } from '@/lib/api';

import { NamedClientTile } from '@/components/tiles';

import { AccessChoice } from './AccessChoice';
import { PromptLayout } from './PromptLayout';

/**
 * An AI tool wants to connect: either it is signing in through the relay (MCP OAuth), or a
 * website that supports Tabpass asked. Starts at Read; the person picks.
 */
function AgentPrompt({ prompt }: { prompt: AgentPromptData }) {
  const [access, setAccess] = useState<Access>('read');
  const decide = async (decision: 'connect' | 'cancel'): Promise<void> => {
    await send('agentDecision', { id: prompt.id, decision, access });
    window.close();
  };
  const from = prompt.viaRelay
    ? `Signing in through ${prompt.relayHost}${prompt.returnsTo ? `, back to ${prompt.returnsTo}` : ''}.`
    : `${prompt.site} asked to connect.`;

  return (
    <PromptLayout
      tile={<NamedClientTile name={prompt.name} size="lg" />}
      title={`Connect ${prompt.name} to your browser?`}
      message={
        <>
          {from} It will see your tab titles, and ask you before using each new site.
          {prompt.replaces && <span className="mt-1 block">This replaces its current connection.</span>}
          {prompt.requestedAccess === 'control' && <span className="mt-1 block">It asked to read and act.</span>}
        </>
      }
      actions={
        <>
          <Pill autoFocus onClick={() => decide('connect')}>
            Connect
          </Pill>
          <Pill variant="secondary" onClick={() => decide('cancel')}>
            Don't connect
          </Pill>
        </>
      }
    >
      <AccessChoice value={access} onChange={setAccess} />
    </PromptLayout>
  );
}

AgentPrompt.displayName = 'AgentPrompt';

export { AgentPrompt };
