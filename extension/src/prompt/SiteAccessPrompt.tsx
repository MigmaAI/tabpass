import { useState } from 'react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { send, type SitePrompt, type SitePromptDecision } from '@/lib/api';

const WHAT = {
  read: 'It will read pages on this site, signed in as you.',
  control: 'It will read pages on this site and act on them (click, type, fill forms), signed in as you.',
};

/** "Allow Claude to use figma.com?" One primary answer, two quieter ones, rare choices below. */
function SiteAccessPrompt({ prompt }: { prompt: SitePrompt }) {
  const [confirmAll, setConfirmAll] = useState(false);

  const decide = async (decision: SitePromptDecision): Promise<void> => {
    await send('promptDecision', { id: prompt.id, decision });
    window.close();
  };

  return (
    <main className="grid min-h-screen content-center gap-6 p-6">
      <div className="grid gap-2">
        <img src="/icons/icon-48.png" alt="" width={32} height={32} />
        <h1 className="text-lg leading-snug font-semibold">
          Allow {prompt.agentLabel} to use {prompt.site}?
        </h1>
        <p className="text-sm text-muted-foreground">{WHAT[prompt.access] ?? WHAT.read}</p>
        <p className="text-xs break-all text-muted-foreground">{prompt.url}</p>
      </div>
      <div className="grid gap-2">
        <Button size="lg" autoFocus onClick={() => decide('site')}>
          Always allow
        </Button>
        <Button size="lg" variant="outline" onClick={() => decide('once')}>
          Allow for 10 min
        </Button>
        <Button size="lg" variant="outline" onClick={() => decide('decline')}>
          Decline
        </Button>
      </div>
      <div className="flex gap-2">
        <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => decide('block')}>
          Block this site
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setConfirmAll(true)}>
          Allow every site
        </Button>
      </div>
      <AlertDialog open={confirmAll} onOpenChange={setConfirmAll}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Allow every site?</AlertDialogTitle>
            <AlertDialogDescription>Every agent could then read and use any site you are signed in to, without asking first.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => decide('all')}>Allow every site</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}

SiteAccessPrompt.displayName = 'SiteAccessPrompt';

export { SiteAccessPrompt };
