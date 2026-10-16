import { Pill } from '@/components/ios/Pill';
import { send, type SitePrompt, type SitePromptDecision } from '@/lib/api';

interface SitePromptCardProps {
  prompt: SitePrompt;
  onChange: () => void;
}

/** The same question as the prompt window, for when the side panel is already open. */
function SitePromptCard({ prompt, onChange }: SitePromptCardProps) {
  const decide = (decision: SitePromptDecision): void => {
    send('promptDecision', { id: prompt.id, decision }).then(onChange);
  };
  return (
    <div role="alert" className="grid gap-3 rounded-xl bg-card p-4 ring-1 ring-tint/40">
      <div className="grid gap-0.5">
        <p className="text-[15px] font-semibold">
          {prompt.agentLabel} wants to use {prompt.site}
        </p>
        <p className="truncate text-[13px] text-muted-foreground">{prompt.url}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Pill size="sm" onClick={() => decide('site')}>
          Always allow
        </Pill>
        <Pill size="sm" variant="secondary" onClick={() => decide('once')}>
          Allow for 10 min
        </Pill>
        <Pill size="sm" variant="plain" onClick={() => decide('decline')}>
          Don't allow
        </Pill>
      </div>
    </div>
  );
}

SitePromptCard.displayName = 'SitePromptCard';

export { SitePromptCard };
