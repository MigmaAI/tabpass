import { ChevronDownIcon, KeyRoundIcon } from 'lucide-react';

import { CopyRow } from '@/components/ios/CopyRow';
import { IconTile } from '@/components/ios/IconTile';
import { ListRow, ListSection } from '@/components/ios/List';
import { NavBar } from '@/components/ios/NavBar';
import { Pill } from '@/components/ios/Pill';
import type { TabpassState } from '@/lib/api';
import { CLIENTS, type ClientGuide } from '@/lib/clients';
import { isLocalRelay } from '@/lib/format';

import { useNavigation } from '../navigation';
import { ToolTile } from '@/components/tiles';

const KIND: Record<ClientGuide['kind'], string> = { web: 'Website', app: 'App', ide: 'Editor', cli: 'Terminal', other: 'Any tool' };
const POPULAR = 6;

/** One link for every tool, then each tool with its one-click button or short steps. */
function ConnectScreen({ state }: { state: TabpassState }) {
  const { push, pop, backLabel } = useNavigation();
  const tools = CLIENTS.filter((client) => client.id !== 'other');
  const row = (guide: ClientGuide) => (
    <ListRow
      key={guide.id}
      icon={<ToolTile guide={guide} />}
      title={guide.name}
      subtitle={KIND[guide.kind]}
      onClick={() => push({ name: 'tool', id: guide.id })}
      label={guide.name}
      trailing={
        guide.action && guide.oauth ? (
          <Pill size="sm" variant="secondary" onClick={() => chrome.tabs.create({ url: guide.action!.href(state.mcpUrl) })}>
            Add
          </Pill>
        ) : undefined
      }
    />
  );

  return (
    <>
      <NavBar title="Connect an AI tool" back={{ label: backLabel, onClick: pop }} />
      <div className="grid gap-6 px-4 pt-4 pb-8">
        <div className="grid gap-2 px-1">
          <h2 className="font-serif text-[28px] leading-8 tracking-[-0.03em]">One link. Any AI.</h2>
          <p className="text-[13px] leading-[18px] text-muted-foreground">Copy the link or choose a tool below.</p>
        </div>
        <div className="grid min-w-0 gap-2">
          <CopyRow value={state.mcpUrl} label="Tabpass link" />
          <p className="px-1 text-[12px] leading-[17px] text-muted-foreground">
            {isLocalRelay(state.mcpUrl)
              ? 'This relay runs on this computer, so tools that work from the cloud (Claude, ChatGPT) cannot reach it.'
              : 'Paste it wherever a tool asks for an MCP server or connector. You approve it here the first time.'}
          </p>
        </div>
        <ListSection title="Popular">{tools.slice(0, POPULAR).map(row)}</ListSection>
        <details className="group min-w-0">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between rounded-lg px-1 text-[13px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/70 [&::-webkit-details-marker]:hidden">
            More tools <ChevronDownIcon className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <div className="pt-2">{tools.slice(POPULAR).map(row)}</div>
        </details>
        <ListSection title="Without sign-in" footer="For tools that cannot sign in. The link carries a key, so keep it private.">
          <ListRow
            icon={
              <IconTile color="#8e8e93">
                <KeyRoundIcon />
              </IconTile>
            }
            title="Make a link with a key"
            onClick={() => push({ name: 'token' })}
          />
        </ListSection>
      </div>
    </>
  );
}

ConnectScreen.displayName = 'ConnectScreen';

export { ConnectScreen };
