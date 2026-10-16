import { IconTile } from '@/components/ios/IconTile';
import type { Agent } from '@/lib/api';
import { CLIENTS, type ClientGuide } from '@/lib/clients';
import { GROUP_COLORS } from '@/lib/format';

/** The catalog entry an agent was named after ("Claude Code" → Claude Code's tile), if any. */
export function guideForName(name: string): ClientGuide | undefined {
  const wanted = name.trim().toLowerCase();
  return CLIENTS.find((client) => client.name.toLowerCase() === wanted);
}

export function AgentTile({ agent, size = 'sm' }: { agent: Agent; size?: 'sm' | 'lg' }) {
  const guide = guideForName(agent.label);
  return (
    <IconTile color={guide?.color ?? GROUP_COLORS[agent.color] ?? GROUP_COLORS.blue} size={size}>
      {guide?.monogram ?? agent.label.slice(0, 2)}
    </IconTile>
  );
}

export function ToolTile({ guide, size = 'sm' }: { guide: ClientGuide; size?: 'sm' | 'lg' }) {
  return (
    <IconTile color={guide.color} size={size}>
      {guide.monogram}
    </IconTile>
  );
}

AgentTile.displayName = 'AgentTile';
ToolTile.displayName = 'ToolTile';
