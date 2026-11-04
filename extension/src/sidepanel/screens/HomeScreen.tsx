import { CircleAlertIcon, CircleCheckIcon, LaptopIcon, PlusIcon, ShieldIcon } from 'lucide-react';

import { IconTile } from '@/components/ios/IconTile';
import { ListRow, ListSection } from '@/components/ios/List';
import { Pill } from '@/components/ios/Pill';
import { Toggle } from '@/components/ios/Toggle';
import { send, type TabpassState } from '@/lib/api';
import { ACCESS_LABEL, agentConnectionStatus, timeAgo, usedText } from '@/lib/format';
import { cn } from '@/lib/utils';

import { useNavigation } from '../navigation';
import { SitePromptCard } from '../parts/SitePromptCard';
import { AgentTile } from '@/components/tiles';
import { WelcomeCard } from '../parts/WelcomeCard';

interface ScreenProps {
  state: TabpassState;
  onChange: () => void;
}

function statusLine(state: TabpassState): { text: string; tone: 'ok' | 'wait' | 'off' } {
  if (state.settings.paused) return { text: 'Paused · AI access is off', tone: 'off' };
  if (state.status.state === 'connected') return { text: 'Browser online', tone: 'ok' };
  if (state.status.state === 'offline' || state.status.state === 'disconnected' || state.status.state === 'unavailable') return { text: 'Browser offline', tone: 'off' };
  if (state.status.state === 'error') return { text: state.status.message ?? 'Browser offline', tone: 'off' };
  return { text: 'Connecting browser…', tone: 'wait' };
}

/**
 * Home is a compact control room: brand, browser availability, connected tools, activity, settings.
 */
function HomeScreen({ state, onChange }: ScreenProps) {
  const { push } = useNavigation();
  const status = statusLine(state);
  const recent = state.activity.slice(0, 3);
  const version = chrome.runtime.getManifest().version;

  return (
    <div className="grid gap-6 px-4 pt-4 pb-8">
      <header className="grid min-w-0 gap-3 pb-2">
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2.5">
            <img src="/icons/icon-48.png" alt="" width={32} height={32} className="size-8 shrink-0 rounded-[9px]" />
            <h1 className="text-[22px] leading-7 font-semibold tracking-[-0.035em] outline-none">Tabpass</h1>
          </div>
          <Toggle checked={!state.settings.paused} onChange={(on) => send('setPaused', { paused: !on }).then(onChange)} label="Allow AI access" />
        </div>

        <div className="flex min-w-0 items-center gap-2 px-1">
          <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', status.tone === 'ok' ? 'bg-success' : status.tone === 'wait' ? 'bg-warning' : 'bg-muted-foreground')} />
          <p className="min-w-0 text-[12px] leading-[17px] text-muted-foreground [overflow-wrap:anywhere]" role="status">{status.text}</p>
        </div>
      </header>

      {!state.settings.welcomed && <WelcomeCard onChange={onChange} />}
      {state.prompts.map((prompt) => (
        <SitePromptCard key={prompt.id} prompt={prompt} onChange={onChange} />
      ))}

      <section className="grid gap-3 px-1" aria-label="Connect your AI">
        <div className="grid gap-1">
          <h2 className="text-[18px] font-semibold tracking-[-0.025em]">Connect your AI</h2>
          <p className="text-[13px] leading-[18px] text-muted-foreground">Copy a private prompt into an AI that can use MCP servers. Let it help with your open tabs, with no Tabpass sign-in.</p>
        </div>
        <Pill className="justify-self-stretch" onClick={() => push({ name: 'token' })}>Create connection prompt</Pill>
      </section>

      {state.providers.map((provider) => (
        <ListSection key={provider.id} title={provider.name} footer={provider.notice ?? undefined}>
          <ListRow
            icon={
              <IconTile color="var(--primary)" className="text-primary-foreground">
                M
              </IconTile>
            }
            title={provider.name}
            subtitle={
              provider.account
                ? (provider.account.email ?? provider.account.name ?? provider.account.id)
                : provider.pending
                  ? 'Finish in the tab that opened'
                  : 'Let its AI use your tabs'
            }
            value={provider.account ? (provider.account.status.state === 'connected' ? 'On' : 'Retrying') : undefined}
            trailing={
              !provider.account && !provider.pending ? (
                <Pill size="sm" onClick={() => send('startConnect', { provider: provider.id }).then(onChange)}>
                  Connect
                </Pill>
              ) : undefined
            }
            onClick={() => push({ name: 'provider', id: provider.id })}
            label={`${provider.name} connection`}
          />
        </ListSection>
      ))}

      <section className="grid gap-3" aria-label="Connected apps">
        <div className="flex items-end justify-between px-1">
          <div>
            <h2 className="text-[14px] font-semibold tracking-[-0.02em]">Connected apps</h2>
          </div>
          {state.agents.length > 0 && <span className="text-[12px] text-muted-foreground">{state.agents.length} saved</span>}
        </div>
        <div className="overflow-hidden">
        {state.agents.map((agent) => (
          <ListRow
            key={agent.id}
            icon={<AgentTile agent={agent} />}
            title={agent.label}
            subtitle={[ACCESS_LABEL[agent.access], agent.lastUsedAt ? usedText(agent.lastUsedAt) : null].filter(Boolean).join(' · ')}
            value={agentConnectionStatus(agent, state.settings.paused)}
            onClick={() => push({ name: 'agent', id: agent.id })}
            label={agent.label}
          />
        ))}
          {state.agents.length === 0 && <p className="px-1 text-[12px] leading-[17px] text-muted-foreground">No apps connected yet.</p>}
        </div>
        <Pill variant="secondary" size="sm" className="w-fit" onClick={() => push({ name: 'connect' })}>
          <PlusIcon />App setup options
        </Pill>
      </section>

      <section className="grid grid-cols-2 gap-2" aria-label="Controls">
        <button type="button" onClick={() => push({ name: 'sites' })} className="flex min-w-0 items-center gap-2.5 rounded-lg py-2 text-left outline-none transition-colors hover:bg-accent/45 focus-visible:ring-2 focus-visible:ring-ring/70">
          <ShieldIcon className="ml-1 size-[18px] shrink-0 text-tint" strokeWidth={1.8} />
          <span className="min-w-0"><span className="block text-[13px] font-semibold">Website access</span><span className="block text-[12px] text-muted-foreground">{state.settings.allowAllSites ? 'All allowed' : `${state.sites.allowed.length} allowed`}</span></span>
        </button>
        <button type="button" onClick={() => push({ name: 'browser' })} className="flex min-w-0 items-center gap-2.5 rounded-lg py-2 text-left outline-none transition-colors hover:bg-accent/45 focus-visible:ring-2 focus-visible:ring-ring/70">
          <LaptopIcon className="ml-1 size-[18px] shrink-0 text-muted-foreground" strokeWidth={1.8} />
          <span className="min-w-0"><span className="block text-[13px] font-semibold">Settings</span><span className="block truncate text-[12px] text-muted-foreground">{state.settings.browserName}</span></span>
        </button>
      </section>

      <ListSection title="Activity">
        {recent.length === 0 ? (
          <ListRow title={<span className="text-muted-foreground">No activity yet.</span>} />
        ) : (
          recent.map((entry, index) => (
            <ListRow
              key={`${entry.at}-${index}`}
              icon={entry.ok ? <CircleCheckIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden /> : <CircleAlertIcon className="size-4 shrink-0 text-destructive" aria-hidden />}
              title={`${entry.agent} · ${entry.tool.replace(/_/g, ' ')}`}
              subtitle={
                entry.ok ? (
                  [entry.site, timeAgo(entry.at)].filter(Boolean).join(' · ')
                ) : (
                  <span className="text-destructive">{entry.detail}</span>
                )
              }
            />
          ))
        )}
        {state.activity.length > recent.length && <ListRow title="See all" value={String(state.activity.length)} onClick={() => push({ name: 'activity' })} />}
      </ListSection>

      <p className="text-center text-[12px] text-muted-foreground">Open source by Migma · v{version}</p>
    </div>
  );
}

HomeScreen.displayName = 'HomeScreen';

export { HomeScreen };
