import { useState } from 'react';
import { CheckIcon, ChevronDownIcon, CopyIcon } from 'lucide-react';

import { CopyRow } from '@/components/ios/CopyRow';
import { ListRow, ListSection } from '@/components/ios/List';
import { NavBar } from '@/components/ios/NavBar';
import { Pill } from '@/components/ios/Pill';
import { Segmented } from '@/components/ios/Segmented';
import { send, type Access, type Agent, type TabpassState } from '@/lib/api';
import { connectionPrompt, tokenSetup } from '@/lib/clients';
import { ACCESS_HINT, ACCESS_LABEL, agentConnectionStatus, hostOf, isLocalRelay, timeAgo, usedText } from '@/lib/format';

import { useNavigation } from '../navigation';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { DetailHeader } from '../parts/DetailHeader';
import { AgentTile } from '@/components/tiles';

function origin(agent: Agent): string {
  if (agent.source === 'oauth') return agent.lastUsedAt ? `Signed in from ${agent.returnsTo ?? 'an AI tool'}` : 'Access approved';
  if (agent.source === 'web' && agent.origin) return `Connected by ${hostOf(agent.origin)}`;
  return agent.lastUsedAt ? 'Connected with a link' : 'Connection link created';
}

function setupState(agent: Agent): string {
  if (agent.lastUsedAt) return usedText(agent.lastUsedAt).replace(/^used /, '');
  return agent.source === 'oauth' || agent.source === 'web' ? 'Access approved' : 'Waiting for AI setup';
}

/** One AI tool: what it may do, where it connects, and the way out. */
function AgentScreen({ state, id, onChange }: { state: TabpassState; id: string; onChange: () => void }) {
  const { pop, backLabel } = useNavigation();
  const [confirm, setConfirm] = useState(false);
  const [copying, setCopying] = useState(false);
  const [copiedAccess, setCopiedAccess] = useState<Access | null>(null);
  const [copyError, setCopyError] = useState(false);
  const agent = state.agents.find((candidate) => candidate.id === id);
  if (!agent) return null;
  const setup = tokenSetup(agent.mcpUrl, agent.token);
  const manual = agent.source !== 'oauth' && agent.source !== 'web';
  const availabilityHint = state.settings.paused
    ? 'AI access is paused. Turn it on from the home screen before using the prompt.'
    : agent.relay.state === 'connecting'
      ? 'Browser is still connecting. Wait until it is online before using the prompt.'
      : agent.relay.state !== 'connected'
        ? 'Browser is offline. Wait until it is online before using the prompt.'
        : null;
  const connectionHint = [
    isLocalRelay(agent.mcpUrl) ? 'This server runs on your computer. Cloud AI apps cannot reach it; use a public server in This browser.' : null,
    availabilityHint,
  ].filter(Boolean).join(' ');
  const copyPrompt = async (): Promise<void> => {
    setCopying(true);
    setCopyError(false);
    try {
      await navigator.clipboard.writeText(connectionPrompt(agent.mcpUrl, agent.token, agent.access));
      setCopiedAccess(agent.access);
    } catch {
      setCopiedAccess(null);
      setCopyError(true);
    } finally {
      setCopying(false);
    }
  };

  return (
    <>
      <NavBar title={agent.label} back={{ label: backLabel, onClick: pop }} />
      <div className="grid gap-6 px-4 pt-2 pb-8">
        <DetailHeader tile={<AgentTile agent={agent} size="lg" />} title={agent.label} subtitle={`${origin(agent)} · ${agentConnectionStatus(agent, state.settings.paused)}`} />

        {manual && (
          <section className="grid gap-3 px-1" aria-label="Connection prompt">
            <div className="grid gap-1">
              <h2 className="text-[18px] font-semibold tracking-[-0.025em]">Paste this into your AI</h2>
              <p className="text-[13px] leading-[18px] text-muted-foreground">The prompt gives your AI a private link to your open tabs. It needs tools that can call an MCP server; some apps need setup in their settings first.</p>
            </div>
            {connectionHint && <p role="status" className="text-[12px] leading-[17px] text-muted-foreground">{connectionHint}</p>}
            <Pill onClick={copyPrompt} disabled={copying} className="justify-self-stretch">
              {copiedAccess === agent.access ? <CheckIcon /> : <CopyIcon />}
              {copying ? 'Copying…' : 'Copy connection prompt'}
            </Pill>
            {copiedAccess === agent.access && <p role="status" className="text-[12px] leading-[17px] text-muted-foreground">Copied. Paste it into your AI when the browser is online.</p>}
            {copyError && <p role="alert" className="text-[12px] leading-[17px] text-destructive">Could not copy the prompt. Try Copy connection prompt again.</p>}
            <p className="text-[12px] leading-[17px] text-muted-foreground">Anyone with this private link has the access you allow. Disconnect to revoke it.</p>
          </section>
        )}

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
          <ListRow title="Status" value={agentConnectionStatus(agent, state.settings.paused)} />
          <ListRow title="Browser" value={agent.relay.state === 'connected' ? 'Online' : 'Offline'} />
          <ListRow
            title={agent.lastUsedAt ? 'Last used' : 'Setup'}
            value={setupState(agent)}
          />
          <ListRow title="Relay" value={hostOf(agent.mcpUrl)} />
          <ListRow title="Added" value={timeAgo(agent.createdAt)} />
        </ListSection>

        {manual && (
          <details className="group min-w-0">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between rounded-lg px-1 text-[13px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/70 [&::-webkit-details-marker]:hidden">
              Advanced setup <ChevronDownIcon className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
            </summary>
            <div className="grid gap-2 pt-2">
              <CopyRow label="Private server URL" value={setup.connectorUrl} />
              <CopyRow label="Header" value={setup.header} />
              <CopyRow label="MCP config" value={setup.json} multiline />
            </div>
          </details>
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
