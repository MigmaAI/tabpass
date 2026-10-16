import { CircleAlertIcon, CircleCheckIcon, LaptopIcon, PlusIcon, ShieldIcon } from 'lucide-react';

import { IconTile } from '@/components/ios/IconTile';
import { ListRow, ListSection } from '@/components/ios/List';
import { Pill } from '@/components/ios/Pill';
import { Toggle } from '@/components/ios/Toggle';
import { send, type TabpassState } from '@/lib/api';
import { ACCESS_LABEL, timeAgo, usedText } from '@/lib/format';
import { cn } from '@/lib/utils';

import { useNavigation } from '../navigation';
import { SitePromptCard } from '../parts/SitePromptCard';
import { Suggestion } from '../parts/Suggestion';
import { AgentTile } from '@/components/tiles';
import { WelcomeCard } from '../parts/WelcomeCard';

interface ScreenProps {
  state: TabpassState;
  onChange: () => void;
}

function statusLine(state: TabpassState): { text: string; tone: 'ok' | 'wait' | 'off' } {
  if (state.settings.paused) return { text: 'Paused. No agent can use this browser.', tone: 'off' };
  if (state.status.state === 'connected') return { text: `Connected · ${state.settings.browserName}`, tone: 'ok' };
  if (state.status.state === 'error') return { text: state.status.message ?? 'Not connected', tone: 'off' };
  return { text: 'Connecting…', tone: 'wait' };
}

/**
 * Home, top to bottom: who is connected and the off switch; anything waiting on the person; a
 * one-click suggestion for the site they are on; then Migma, AI tools, recent activity, settings.
 */
function HomeScreen({ state, onChange }: ScreenProps) {
  const { push } = useNavigation();
  const status = statusLine(state);
  const recent = state.activity.slice(0, 3);
  const version = chrome.runtime.getManifest().version;

  return (
    <div className="grid gap-5 px-4 pt-3 pb-8">
      <header className="flex items-center justify-between gap-3 px-1 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <img src="/icons/icon-48.png" alt="" width={40} height={40} className="size-10 shrink-0 rounded-xl" />
          <div className="grid min-w-0 gap-0.5">
            <h1 className="text-[25px] leading-8 font-bold tracking-[-0.02em]">Tabpass</h1>
            <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground" role="status">
              <span
                aria-hidden
                className={cn('size-2 rounded-full', status.tone === 'ok' ? 'bg-success' : status.tone === 'wait' ? 'bg-warning' : 'bg-muted-foreground')}
              />
              {status.text}
            </p>
          </div>
        </div>
        <Toggle
          checked={!state.settings.paused}
          onChange={(on) => send('setPaused', { paused: !on }).then(onChange)}
          label="Let agents use this browser"
        />
      </header>

      {!state.settings.welcomed && <WelcomeCard onChange={onChange} />}
      {state.prompts.map((prompt) => (
        <SitePromptCard key={prompt.id} prompt={prompt} onChange={onChange} />
      ))}
      <Suggestion state={state} onChange={onChange} />

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

      <ListSection
        title="AI tools"
        footer={state.agents.length === 0 ? 'Claude, ChatGPT, Cursor, Codex and any other MCP tool can connect.' : undefined}
      >
        {state.agents.map((agent) => (
          <ListRow
            key={agent.id}
            icon={<AgentTile agent={agent} />}
            title={agent.label}
            subtitle={`${ACCESS_LABEL[agent.access]} · ${usedText(agent.lastUsedAt)}`}
            value={agent.relay.state === 'connected' ? undefined : 'Offline'}
            onClick={() => push({ name: 'agent', id: agent.id })}
            label={agent.label}
          />
        ))}
        <ListRow
          icon={
            <IconTile color="var(--tint)">
              <PlusIcon />
            </IconTile>
          }
          title="Connect an AI tool"
          tone="tint"
          onClick={() => push({ name: 'connect' })}
        />
      </ListSection>

      <ListSection title="Activity">
        {recent.length === 0 ? (
          <ListRow title={<span className="text-muted-foreground">What your agents do shows up here.</span>} />
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

      <ListSection>
        <ListRow
          icon={
            <IconTile color="var(--success)">
              <ShieldIcon />
            </IconTile>
          }
          title="Sites"
          value={state.settings.allowAllSites ? 'All allowed' : `${state.sites.allowed.length} allowed`}
          onClick={() => push({ name: 'sites' })}
        />
        <ListRow
          icon={
            <IconTile color="var(--muted-foreground)">
              <LaptopIcon />
            </IconTile>
          }
          title="This browser"
          value={state.settings.browserName}
          onClick={() => push({ name: 'browser' })}
        />
      </ListSection>

      <p className="text-center text-[12px] text-muted-foreground">Tabpass {version} · Open source by Migma</p>
    </div>
  );
}

HomeScreen.displayName = 'HomeScreen';

export { HomeScreen };
