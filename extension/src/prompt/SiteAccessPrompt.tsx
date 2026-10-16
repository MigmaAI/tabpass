import { useState } from 'react';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { IconTile } from '@/components/ios/IconTile';
import { Pill } from '@/components/ios/Pill';
import { guideForName } from '@/components/tiles';
import { send, type SitePrompt, type SitePromptDecision } from '@/lib/api';

import { PromptLayout } from './PromptLayout';

const WHAT = {
  read: 'It will read pages on this site, signed in as you.',
  control: 'It will read pages on this site and act on them (click, type, fill forms), signed in as you.',
};

/** "Allow Claude to use figma.com?" One main answer, two quieter ones, rare choices below. */
function SiteAccessPrompt({ prompt }: { prompt: SitePrompt }) {
  const [confirmAll, setConfirmAll] = useState(false);
  const guide = guideForName(prompt.agentLabel);
  const decide = async (decision: SitePromptDecision): Promise<void> => {
    await send('promptDecision', { id: prompt.id, decision });
    window.close();
  };

  return (
    <>
      <PromptLayout
        tile={
          <IconTile color={guide?.color ?? 'var(--primary)'} size="lg" className={guide ? undefined : 'text-primary-foreground'}>
            {guide?.monogram ?? prompt.agentLabel.slice(0, 2)}
          </IconTile>
        }
        title={`Allow ${prompt.agentLabel} to use ${prompt.site}?`}
        message={
          <>
            {WHAT[prompt.access] ?? WHAT.read}
            <span className="mt-1 block break-all">{prompt.url}</span>
          </>
        }
        actions={
          <>
            <Pill autoFocus onClick={() => decide('site')}>
              Always allow
            </Pill>
            <Pill variant="secondary" onClick={() => decide('once')}>
              Allow for 10 minutes
            </Pill>
            <Pill variant="secondary" onClick={() => decide('decline')}>
              Don't allow
            </Pill>
          </>
        }
        footer={
          <>
            <Pill size="sm" variant="destructive" onClick={() => decide('block')}>
              Block this site
            </Pill>
            <Pill size="sm" variant="plain" onClick={() => setConfirmAll(true)}>
              Allow every site
            </Pill>
          </>
        }
      />
      <ConfirmDialog
        open={confirmAll}
        onOpenChange={setConfirmAll}
        title="Allow every site?"
        description="Every agent could then read and use any site you are signed in to, without asking first."
        confirmLabel="Allow every site"
        onConfirm={() => decide('all')}
      />
    </>
  );
}

SiteAccessPrompt.displayName = 'SiteAccessPrompt';

export { SiteAccessPrompt };
