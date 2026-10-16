import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { send, type SitePrompt, type SitePromptDecision } from '@/lib/api';

interface SitePromptCardProps {
  prompt: SitePrompt;
  onChange: () => void;
}

/** The same choice as the prompt window, for when the side panel is already open. */
function SitePromptCard({ prompt, onChange }: SitePromptCardProps) {
  const decide = (decision: SitePromptDecision): void => {
    send('promptDecision', { id: prompt.id, decision }).then(onChange);
  };

  return (
    <Card role="alert" className="gap-3 border-primary py-4">
      <CardHeader className="px-4">
        <CardTitle className="text-sm">
          {prompt.agentLabel} wants to use {prompt.site}
        </CardTitle>
        <CardDescription className="truncate text-xs">{prompt.url}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2 px-4">
        <Button size="sm" onClick={() => decide('site')}>
          Always allow
        </Button>
        <Button size="sm" variant="outline" onClick={() => decide('once')}>
          Allow for 10 min
        </Button>
        <Button size="sm" variant="ghost" onClick={() => decide('decline')}>
          Decline
        </Button>
      </CardContent>
    </Card>
  );
}

SitePromptCard.displayName = 'SitePromptCard';

export { SitePromptCard };
