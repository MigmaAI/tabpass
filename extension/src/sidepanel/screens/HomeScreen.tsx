import { ChevronDownIcon, SettingsIcon } from 'lucide-react';

import { IconTile } from '@/components/ios/IconTile';
import { ListRow, ListSection } from '@/components/ios/List';
import { Pill } from '@/components/ios/Pill';
import { AgentTile, ToolTile } from '@/components/tiles';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { send, type TabpassState } from '@/lib/api';
import { CLIENTS } from '@/lib/clients';
import { ACCESS_LABEL, agentConnectionStatus, usedText } from '@/lib/format';
import { cn } from '@/lib/utils';

import { useNavigation } from '../navigation';
import { SitePromptCard } from '../parts/SitePromptCard';
import { WelcomeCard } from '../parts/WelcomeCard';

const HOME_TOOLS = ['claude', 'chatgpt', 'codex', 'cursor', 'hermes', 'openclaw']
  .flatMap((id) => CLIENTS.filter((client) => client.id === id));

interface ScreenProps {
  state: TabpassState | null;
  onChange: () => void;
}

function statusLine(state: TabpassState): { text: string; tone: 'ok' | 'wait' | 'off' } {
  if (state.settings.paused) return { text: 'Browser access paused', tone: 'off' };
  if (state.status.state === 'connected') return { text: `Connected · ${state.settings.browserName}`, tone: 'ok' };
  if (state.status.state === 'error') return { text: state.status.message ?? 'Browser offline', tone: 'off' };
  if (['offline', 'disconnected', 'unavailable'].includes(state.status.state)) return { text: 'Browser offline', tone: 'off' };
  return { text: 'Connecting…', tone: 'wait' };
}

/** One connection prompt action, visible app guides, and saved connections. */
function HomeScreen({ state, onChange }: ScreenProps) {
  const { push } = useNavigation();
  const status = state ? statusLine(state) : { text: 'Opening Tabpass…', tone: 'wait' as const };
  const connectionCount = state ? state.agents.length + state.providers.filter((provider) => provider.account).length : 0;

  return (
    <div className="grid gap-5 px-5 pt-3 pb-8" aria-busy={!state}>
      <header className="flex min-w-0 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', status.tone === 'ok' ? 'bg-success' : status.tone === 'wait' ? 'bg-warning' : 'bg-muted-foreground')} />
          <p className="min-w-0 text-[12px] leading-[17px] text-muted-foreground [overflow-wrap:anywhere]" role="status">{status.text}</p>
        </div>
        <Pill variant="plain" size="sm" className="shrink-0 px-2" aria-label="Settings" disabled={!state} onClick={() => push({ name: 'browser' })}>
          <SettingsIcon />
        </Pill>
      </header>

      {state && !state.settings.welcomed && <WelcomeCard onChange={onChange} />}
      {state?.prompts.map((prompt) => (
        <SitePromptCard key={prompt.id} prompt={prompt} onChange={onChange} />
      ))}

      <section className="grid gap-5 pt-2" aria-label="Connect your AI">
        <div className="grid gap-2">
          <h1 className="text-[28px] leading-[32px] font-semibold tracking-[-0.045em] outline-none">Your tabs, in your AI.</h1>
          <p className="text-[14px] leading-5 text-muted-foreground">Give your AI access to the pages you have open.</p>
        </div>
        <div className="grid gap-2.5">
          <Pill className="justify-self-stretch" disabled={!state} onClick={() => push({ name: 'token' })}>Connect your AI</Pill>
          <p className="text-center text-[12px] leading-[17px] text-muted-foreground">You choose which sites it can use.</p>
        </div>
      </section>

      <section className="grid gap-2" aria-label="AI apps">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[12px] font-semibold text-muted-foreground">AI apps</h2>
          <Pill variant="plain" size="sm" className="px-1" disabled={!state} onClick={() => push({ name: 'connect' })}>More tools</Pill>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {HOME_TOOLS.map((guide) => (
            <Pill key={guide.id} aria-label={`Set up ${guide.name}`} variant="plain" className="min-w-0 flex-col gap-2 px-1 py-2 text-[12px] text-foreground" disabled={!state} onClick={() => push({ name: 'tool', id: guide.id })}>
              <ToolTile guide={guide} />
              {guide.name}
            </Pill>
          ))}
        </div>
      </section>

      {state && (connectionCount > 0 || state.providers.length > 0) && (
        <Collapsible defaultOpen className="group border-t border-border pt-2">
          <CollapsibleTrigger className="flex min-h-12 w-full items-center gap-2 rounded-lg text-left text-[13px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/70">
            <span className="flex-1">Connections</span>
            <span className="text-muted-foreground">{connectionCount}</span>
            <ChevronDownIcon aria-hidden className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
          </CollapsibleTrigger>
          <CollapsibleContent>
            {state.providers.map((provider) => (
              <ListSection key={provider.id} title={provider.name} footer={provider.notice ?? undefined}>
                <ListRow
                  icon={<IconTile color="var(--primary)" className="text-primary-foreground">M</IconTile>}
                  title={provider.name}
                  subtitle={provider.account ? (provider.account.email ?? provider.account.name ?? provider.account.id) : provider.pending ? 'Finish in the tab that opened' : 'Let its AI use your tabs'}
                  value={provider.account ? (provider.account.status.state === 'connected' ? 'On' : 'Retrying') : undefined}
                  trailing={!provider.account && !provider.pending ? <Pill size="sm" onClick={() => send('startConnect', { provider: provider.id }).then(onChange)}>Connect</Pill> : undefined}
                  onClick={() => push({ name: 'provider', id: provider.id })}
                  label={`${provider.name} connection`}
                />
              </ListSection>
            ))}
            {state.agents.map((agent) => (
              <ListRow
                key={agent.id}
                icon={<AgentTile agent={agent} />}
                title={agent.label}
                subtitle={`${ACCESS_LABEL[agent.access]} · ${usedText(agent.lastUsedAt)}`}
                value={agentConnectionStatus(agent, state.settings.paused)}
                onClick={() => push({ name: 'agent', id: agent.id })}
                label={agent.label}
              />
            ))}
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}

HomeScreen.displayName = 'HomeScreen';

export { HomeScreen };
