import { useState } from 'react';

import { CopyRow } from '@/components/ios/CopyRow';
import { ListRow, ListSection } from '@/components/ios/List';
import { NavBar } from '@/components/ios/NavBar';
import { Segmented } from '@/components/ios/Segmented';
import { send, type Access, type Agent, type TabpassState } from '@/lib/api';
import { tokenSetup } from '@/lib/clients';
import { ACCESS_HINT, ACCESS_LABEL, hostOf, timeAgo, usedText } from '@/lib/format';

import { useNavigation } from '../navigation';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { DetailHeader } from '../parts/DetailHeader';
import { AgentTile } from '@/components/tiles';

function origin(agent: Agent): string {
  if (agent.source === 'oauth') return `Signed in from ${agent.returnsTo ?? 'an AI tool'}`;
  if (agent.source === 'web' && agent.origin) return `Connected by ${hostOf(agent.origin)}`;
  return 'Connected with a link';
}

/** One AI tool: what it may do, where it connects, and the way out. */
function AgentScreen({ state, id, onChange }: { state: TabpassState; id: string; onChange: () => void }) {
  const { pop, backLabel } = useNavigation();
  const [confirm, setConfirm] = useState(false);
  const agent = state.agents.find((candidate) => candidate.id === id);
  if (!agent) return null;
  const setup = tokenSetup(agent.mcpUrl, agent.token);

  return (
    <>
      <NavBar title={agent.label} back={{ label: backLabel, onClick: pop }} />
      <div className="grid gap-6 px-4 pt-2 pb-8">
        <DetailHeader tile={<AgentTile agent={agent} size="lg" />} title={agent.label} subtitle={`${origin(agent)} · ${usedText(agent.lastUsedAt)}`} />

        <ListSection title="It can" footer={ACCESS_HINT[agent.access]}>
          <div className="p-2">
            <Segmented<Access>
              label="Access"
              value={agent.access}
              onChange={(access) => send('setAgentAccess', { id: agent.id, access }).then(onChange)}
              options={[
                { value: 'read', label: ACCESS_LABEL.read },
                { value: 'control', label: ACCESS_LABEL.control },
              ]}
            />
          </div>
        </ListSection>

        <ListSection title="Connection">
          <ListRow title="Status" value={agent.relay.state === 'connected' ? 'Connected' : 'Offline'} />
          <ListRow title="Relay" value={hostOf(agent.mcpUrl)} />
          <ListRow title="Added" value={timeAgo(agent.createdAt)} />
        </ListSection>

        {agent.source !== 'oauth' && agent.source !== 'web' && (
          <ListSection title="Its link" footer="The link carries a key. Anyone with it can use your tabs, so keep it private.">
            <CopyRow label="Link" value={setup.connectorUrl} />
            <CopyRow label="Header" value={setup.header} />
            <CopyRow label="MCP config" value={setup.json} multiline />
          </ListSection>
        )}

        <ListSection>
          <ListRow title="Disconnect" tone="destructive" onClick={() => setConfirm(true)} />
        </ListSection>
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Disconnect ${agent.label}?`}
        description="It loses access right away. You can connect it again any time."
        confirmLabel="Disconnect"
        destructive
        onConfirm={() =>
          send('removeAgent', { id: agent.id }).then(() => {
            onChange();
            pop();
          })
        }
      />
    </>
  );
}

AgentScreen.displayName = 'AgentScreen';

export { AgentScreen };
