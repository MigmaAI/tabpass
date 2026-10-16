import { ExternalLinkIcon, TriangleAlertIcon } from 'lucide-react';

import { CopyRow } from '@/components/ios/CopyRow';
import { ListRow, ListSection } from '@/components/ios/List';
import { NavBar } from '@/components/ios/NavBar';
import { Pill } from '@/components/ios/Pill';
import { send, type Agent, type TabpassState } from '@/lib/api';
import { CLIENTS, tokenSetup } from '@/lib/clients';
import { isLocalRelay } from '@/lib/format';

import { useNavigation } from '../navigation';
import { DetailHeader } from '../parts/DetailHeader';
import { ToolTile } from '@/components/tiles';

/** How to connect one tool: its one-click button when it has one, else a few short steps. */
function ToolScreen({ state, id, onChange }: { state: TabpassState; id: string; onChange: () => void }) {
  const { pop, backLabel } = useNavigation();
  const guide = CLIENTS.find((client) => client.id === id);
  if (!guide) return null;

  // Tools without OAuth get a link with its own key, made once and shown in the steps.
  const keyed = guide.oauth ? null : state.agents.find((agent) => agent.label === guide.name && agent.source === 'manual');
  const url = guide.oauth ? state.mcpUrl : keyed ? tokenSetup(keyed.mcpUrl, keyed.token).connectorUrl : null;
  const unreachable = guide.needsPublicUrl && isLocalRelay(state.mcpUrl);

  return (
    <>
      <NavBar title={guide.name} back={{ label: backLabel, onClick: pop }} />
      <div className="grid gap-6 px-4 pt-2 pb-8">
        <DetailHeader tile={<ToolTile guide={guide} size="lg" />} title={guide.name} subtitle={guide.note} />

        {unreachable && (
          <div className="flex gap-3 rounded-xl bg-card p-4 text-[13px] leading-[18px]" role="alert">
            <TriangleAlertIcon className="size-5 shrink-0 text-warning" aria-hidden />
            {guide.name} connects from the internet, so it cannot reach a relay on this computer. Use a public relay under This
            browser.
          </div>
        )}

        {!url && (
          <Pill
            onClick={() => send<Agent>('addAgent', { label: guide.name, access: 'read' }).then(onChange)}
            className="justify-self-stretch"
          >
            Make a link for {guide.name}
          </Pill>
        )}

        {url && guide.action && (
          <Pill onClick={() => chrome.tabs.create({ url: guide.action!.href(url) })} className="justify-self-stretch">
            {guide.action.label}
          </Pill>
        )}

        {url && (
          <ListSection title={guide.action ? 'Or set it up yourself' : 'Set it up'}>
            {guide.steps(url).map((step, index) => (
              <div key={step.text} className="grid">
                <ListRow
                  icon={
                    <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary text-[12px] font-semibold">
                      {index + 1}
                    </span>
                  }
                  title={<span className="whitespace-normal">{step.text}</span>}
                />
                {step.copy && <CopyRow value={step.copy} multiline={step.copy.includes('\n')} />}
              </div>
            ))}
          </ListSection>
        )}

        {guide.docsUrl && (
          <Pill variant="plain" size="sm" className="justify-self-center" onClick={() => chrome.tabs.create({ url: guide.docsUrl! })}>
            {guide.name} docs <ExternalLinkIcon />
          </Pill>
        )}
      </div>
    </>
  );
}

ToolScreen.displayName = 'ToolScreen';

export { ToolScreen };
