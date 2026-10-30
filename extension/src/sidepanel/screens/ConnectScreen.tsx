import { ChevronDownIcon } from 'lucide-react';

import { CopyRow } from '@/components/ios/CopyRow';
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

/** Private prompt first, then app-specific setup for clients that need it. */
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
      <NavBar title="Connect your AI" back={{ label: backLabel, onClick: pop }} />
      <div className="grid gap-6 px-4 pt-4 pb-8">
        <div className="grid gap-2 px-1">
          <h2 className="text-[22px] leading-7 font-semibold tracking-[-0.03em]">Start with a prompt</h2>
          <p className="text-[13px] leading-[18px] text-muted-foreground">Create a private connection prompt, then paste it into an AI that can call MCP servers. No Tabpass sign-in needed.</p>
          <Pill className="mt-1 justify-self-stretch" onClick={() => push({ name: 'token' })}>Create connection prompt</Pill>
        </div>
        <ListSection title="App setup options" footer="Some apps need a connector added in settings before they can use your tabs. Choose your app for its setup steps.">{tools.slice(0, POPULAR).map(row)}</ListSection>
        <details className="group min-w-0">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between rounded-lg px-1 text-[13px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/70 [&::-webkit-details-marker]:hidden">
            More tools <ChevronDownIcon className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <div className="pt-2">{tools.slice(POPULAR).map(row)}</div>
        </details>
        <details className="group min-w-0">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between rounded-lg px-1 text-[13px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/70 [&::-webkit-details-marker]:hidden">
            Manual setup <ChevronDownIcon className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <div className="grid min-w-0 gap-2 pt-2">
            <CopyRow value={state.mcpUrl} label="Server URL" />
            <p className="px-1 text-[12px] leading-[17px] text-muted-foreground">
              {isLocalRelay(state.mcpUrl)
                ? 'This server runs on your computer. Online services such as Claude and ChatGPT cannot connect to it.'
                : 'In your AI’s settings, add an MCP server and paste this URL. Then approve the connection in Tabpass.'}
            </p>
          </div>
        </details>
      </div>
    </>
  );
}

ConnectScreen.displayName = 'ConnectScreen';

export { ConnectScreen };
