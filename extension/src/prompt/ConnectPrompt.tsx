import { useState } from 'react';

import { AccessPicker } from '@/components/AccessPicker';
import { Button } from '@/components/ui/button';
import { send, type Access, type ConnectPrompt as ConnectPromptData } from '@/lib/api';

function who(account: { id: string; email?: string; name?: string }): string {
  return account.email ?? account.name ?? account.id;
}

/**
 * Shown when a provider's site (e.g. a button inside Migma) asks to connect this browser.
 * The decision happens here, in Tabpass's own window, never on the website.
 */
function ConnectPrompt({ prompt }: { prompt: ConnectPromptData }) {
  const [access, setAccess] = useState<Access>('read');

  const decide = async (decision: 'connect' | 'cancel'): Promise<void> => {
    await send('connectDecision', { id: prompt.id, decision, access });
    window.close();
  };

  return (
    <main className="grid min-h-screen content-center gap-6 p-6">
      <div className="grid gap-2">
        <img src="/icons/icon-48.png" alt="" width={32} height={32} />
        <h1 className="text-lg leading-snug font-semibold">Connect this browser to {prompt.providerName}?</h1>
        <p className="text-sm text-muted-foreground">
          {prompt.providerName}'s AI will use your tabs as {who(prompt.account)}. You still approve each new site.
        </p>
        {prompt.replaces && prompt.replaces.id !== prompt.account.id && (
          <p className="text-sm text-warning">This replaces {who(prompt.replaces)}.</p>
        )}
      </div>
      <div className="grid gap-2">
        <span className="text-sm font-medium">It can</span>
        <AccessPicker idPrefix="connect" value={access} onChange={setAccess} />
      </div>
      <div className="grid gap-2">
        <Button size="lg" autoFocus onClick={() => decide('connect')}>
          Connect
        </Button>
        <Button size="lg" variant="outline" onClick={() => decide('cancel')}>
          Cancel
        </Button>
      </div>
    </main>
  );
}

ConnectPrompt.displayName = 'ConnectPrompt';

export { ConnectPrompt };
