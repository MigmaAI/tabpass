import { useState } from 'react';

import { IconTile } from '@/components/ios/IconTile';
import { Pill } from '@/components/ios/Pill';
import { send, type Access, type ConnectPrompt } from '@/lib/api';

import { AccessChoice } from './AccessChoice';
import { PromptLayout } from './PromptLayout';

function who(account: { id: string; email?: string; name?: string }): string {
  return account.email ?? account.name ?? account.id;
}

/**
 * A provider's site (e.g. "Use my browser" inside Migma) asked to connect this browser. The
 * decision is made here, in Tabpass's own window, never on the website.
 */
function AccountPrompt({ prompt }: { prompt: ConnectPrompt }) {
  const [access, setAccess] = useState<Access>('read');
  const decide = async (decision: 'connect' | 'cancel'): Promise<void> => {
    await send('connectDecision', { id: prompt.id, decision, access });
    window.close();
  };
  return (
    <PromptLayout
      tile={
        <IconTile color="var(--primary)" size="lg" className="text-primary-foreground">
          M
        </IconTile>
      }
      title={`Connect this browser to ${prompt.providerName}?`}
      message={
        <>
          {prompt.providerName}'s AI will use your tabs as {who(prompt.account)}. You still approve each new site.
          {prompt.replaces && prompt.replaces.id !== prompt.account.id && (
            <span className="mt-1 block font-medium text-warning">This replaces {who(prompt.replaces)}.</span>
          )}
        </>
      }
      actions={
        <>
          <Pill autoFocus onClick={() => decide('connect')}>
            Connect
          </Pill>
          <Pill variant="secondary" onClick={() => decide('cancel')}>
            Cancel
          </Pill>
        </>
      }
    >
      <AccessChoice value={access} onChange={setAccess} />
    </PromptLayout>
  );
}

AccountPrompt.displayName = 'AccountPrompt';

export { AccountPrompt };
