import { ChevronDownIcon } from 'lucide-react';

import { ConfirmButton } from '@/components/ConfirmButton';
import { CopyField } from '@/components/CopyField';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { send, type Access, type Agent } from '@/lib/api';
import { ACCESS_LABEL, ACCESS_SUMMARY, GROUP_COLORS, usedText } from '@/lib/format';

interface AgentItemProps {
  agent: Agent;
  mcpUrl: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: () => void;
}

/** One token agent: its link to paste into the agent, other ways to connect, access, disconnect. */
function AgentItem({ agent, mcpUrl, open, onOpenChange, onChange }: AgentItemProps) {
  const connectorUrl = `${mcpUrl}/${agent.token}`;
  const claudeCode = `claude mcp add --transport http tabpass ${mcpUrl} \\\n  --header "Authorization: Bearer ${agent.token}"`;
  const config = JSON.stringify(
    { mcpServers: { tabpass: { type: 'http', url: mcpUrl, headers: { Authorization: `Bearer ${agent.token}` } } } },
    null,
    2
  );

  return (
    <li className="rounded-lg border" data-agent={agent.label}>
      <Collapsible open={open} onOpenChange={onOpenChange}>
        <CollapsibleTrigger className="group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50">
          <span className="size-2.5 shrink-0 rounded-sm" style={{ background: GROUP_COLORS[agent.color] ?? GROUP_COLORS.blue }} aria-hidden />
          <span className="grid min-w-0 flex-1">
            <span className="agent-name truncate text-sm font-medium">{agent.label}</span>
            <span className="truncate text-xs text-muted-foreground">
              {ACCESS_SUMMARY[agent.access]} · {usedText(agent.lastUsedAt)}
            </span>
          </span>
          <ChevronDownIcon className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent className="grid gap-4 px-3 pt-1 pb-3">
          <CopyField
            label="Connector URL"
            value={connectorUrl}
            hint="Paste it as a custom MCP connector. Keep it private: it opens your browser."
          />
          <Collapsible>
            <CollapsibleTrigger className="text-left text-xs text-muted-foreground underline-offset-4 hover:underline">
              Connect with a header instead
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-3 grid gap-3">
              <CopyField label="Claude Code" value={claudeCode} multiline />
              <CopyField label="MCP config" value={config} multiline />
            </CollapsibleContent>
          </Collapsible>
          <div className="grid gap-1.5">
            <Label htmlFor={`access-${agent.id}`} className="text-xs text-muted-foreground">
              It can
            </Label>
            <Select
              value={agent.access}
              onValueChange={(access: Access) => send('setAgentAccess', { id: agent.id, access }).then(onChange)}
            >
              <SelectTrigger id={`access-${agent.id}`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="read">{ACCESS_LABEL.read}</SelectItem>
                <SelectItem value="control">{ACCESS_LABEL.control}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end">
            <ConfirmButton
              destructive
              title={`Disconnect ${agent.label}?`}
              description="Its link stops working right away."
              confirmLabel="Disconnect"
              onConfirm={() => send('removeAgent', { id: agent.id }).then(onChange)}
            >
              Disconnect
            </ConfirmButton>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}

AgentItem.displayName = 'AgentItem';

export { AgentItem };
