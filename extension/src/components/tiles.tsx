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
  zed: { src: '/icons/clients/zed.svg', background: '#f2f1eb', className: 'p-[6px]' },
  cline: { src: '/icons/clients/cline.svg', background: '#eee7f7', className: 'p-[6px]' },
  goose: { src: '/icons/clients/goose.svg', background: '#efedeb', className: 'p-[5px]' },
  'lm-studio': { src: '/icons/clients/lmstudio.svg', background: '#eeeef8', className: 'p-[5px]' },
  opencode: { src: '/icons/clients/opencode.svg', background: '#f1f0ea', className: 'p-[6px]' },
  warp: { src: '/icons/clients/warp.svg', background: '#e7eef6', className: 'p-[6px]' },
  perplexity: { src: '/icons/clients/perplexity.svg', background: '#efedeb', className: 'p-[6px]' },
  'le-chat': { src: '/icons/clients/mistral.svg', background: '#fff3dc', className: 'p-[5px]' },
  jetbrains: { src: '/icons/clients/jetbrains.svg', background: '#eee9f4', className: 'p-[6px]' },
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
