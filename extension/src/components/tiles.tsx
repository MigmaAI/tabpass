import { AppWindowIcon, BotIcon, Code2Icon, PlugIcon, TerminalIcon } from 'lucide-react';

import { IconTile } from '@/components/ios/IconTile';
import type { Agent } from '@/lib/api';
import { CLIENTS, type ClientGuide, type ClientKind } from '@/lib/clients';
import { GROUP_COLORS } from '@/lib/format';

const CLIENT_ICONS: Partial<Record<string, { src: string; background: string; className?: string }>> = {
  claude: { src: '/icons/clients/claude.svg', background: '#f2e7df', className: 'p-[5px]' },
  'claude-code': { src: '/icons/clients/claude.svg', background: '#f2e7df', className: 'p-[5px]' },
  chatgpt: { src: '/icons/clients/chatgpt.svg', background: '#fff' },
  cursor: { src: '/icons/clients/cursor.png', background: '#18181b', className: 'p-1' },
  codex: { src: '/icons/clients/codex.png', background: '#fff' },
  'gemini-cli': { src: '/icons/clients/gemini.png', background: '#fff', className: 'p-1' },
  windsurf: { src: '/icons/clients/windsurf.svg', background: '#111827' },
  'copilot-cli': { src: '/icons/clients/copilot.svg', background: '#fff', className: 'p-[5px]' },
  vscode: { src: '/icons/clients/vscode.svg', background: '#fff', className: 'p-1' },
};

function KindIcon({ kind }: { kind: ClientKind }) {
  if (kind === 'cli') return <TerminalIcon />;
  if (kind === 'ide') return <Code2Icon />;
  if (kind === 'app' || kind === 'web') return <AppWindowIcon />;
  return <PlugIcon />;
}

function ClientTile({ guide, size }: { guide: ClientGuide; size: 'sm' | 'lg' }) {
  const icon = CLIENT_ICONS[guide.id];

  return (
    <IconTile color={icon?.background ?? guide.color} size={size}>
      {icon ? (
        <img
          alt=""
          className={`size-full rounded-[inherit] object-contain ${icon.className ?? ''}`}
          src={icon.src}
        />
      ) : (
        <KindIcon kind={guide.kind} />
      )}
    </IconTile>
  );
}

/** The catalog entry an agent was named after ("Claude Code" → Claude Code's tile), if any. */
export function guideForName(name: string): ClientGuide | undefined {
  const wanted = name.trim().toLowerCase();
  return CLIENTS.find((client) => client.name.toLowerCase() === wanted);
}

export function AgentTile({ agent, size = 'sm' }: { agent: Agent; size?: 'sm' | 'lg' }) {
  return <NamedClientTile name={agent.label} fallbackColor={GROUP_COLORS[agent.color]} size={size} />;
}

export function ToolTile({ guide, size = 'sm' }: { guide: ClientGuide; size?: 'sm' | 'lg' }) {
  return <ClientTile guide={guide} size={size} />;
}

export function NamedClientTile({
  name,
  fallbackColor = 'var(--primary)',
  size = 'sm',
}: {
  name: string;
  fallbackColor?: string;
  size?: 'sm' | 'lg';
}) {
  const guide = guideForName(name);
  if (guide) return <ClientTile guide={guide} size={size} />;

  return (
    <IconTile color={fallbackColor} size={size} className={fallbackColor === 'var(--primary)' ? 'text-primary-foreground' : undefined}>
      <BotIcon />
    </IconTile>
  );
}

AgentTile.displayName = 'AgentTile';
ToolTile.displayName = 'ToolTile';
NamedClientTile.displayName = 'NamedClientTile';
