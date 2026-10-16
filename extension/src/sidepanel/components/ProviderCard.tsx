import { Loader2Icon } from 'lucide-react';

import { ConfirmButton } from '@/components/ConfirmButton';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { send, type Access, type Provider } from '@/lib/api';
import { ACCESS_LABEL, usedText } from '@/lib/format';

interface ProviderCardProps {
  provider: Provider;
  onChange: () => void;
}

/**
 * One-click connect with an account (Migma). Not connected: one button. Waiting: where to finish.
 * Connected: who it is, what it may do, and a way out.
 */
function ProviderCard({ provider, onChange }: ProviderCardProps) {
  const { account } = provider;
  const run = (type: string, payload: Record<string, unknown> = {}): void => {
    send(type, { provider: provider.id, ...payload }).then(onChange);
  };
  const state = account ? (account.relay.state === 'connected' ? account.status.state : account.relay.state) : null;

  return (
    <Card className="gap-4 py-4" aria-labelledby={`provider-${provider.id}`}>
      <CardHeader className="px-4">
        <CardTitle id={`provider-${provider.id}`}>{provider.name}</CardTitle>
        <CardDescription>
          {account
            ? `Connected as ${account.email ?? account.name ?? account.id}`
            : `Let ${provider.name}'s AI use your open tabs for context and design ideas.`}
        </CardDescription>
        {state && (
          <CardAction>
            <StatusBadge state={state} />
          </CardAction>
        )}
      </CardHeader>

      <CardContent className="grid gap-3 px-4">
        {provider.notice && !account && <p className="text-sm text-destructive">{provider.notice}</p>}

        {!account && !provider.pending && (
          <Button onClick={() => run('startConnect')}>Connect to {provider.name}</Button>
        )}

        {!account && provider.pending && (
          <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm">
            <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
            <span className="flex-1">Finish in the {provider.name} tab that opened.</span>
            <Button variant="ghost" size="sm" onClick={() => run('cancelConnect')}>
              Cancel
            </Button>
          </div>
        )}

        {account && (
          <>
            {account.status.message && account.status.state !== 'connected' && (
              <p className="text-xs text-muted-foreground">{account.status.message}</p>
            )}
            <div className="grid gap-1.5">
              <Label htmlFor={`access-${provider.id}`} className="text-xs text-muted-foreground">
                It can
              </Label>
              <Select value={account.access} onValueChange={(access: Access) => run('setAccountAccess', { access })}>
                <SelectTrigger id={`access-${provider.id}`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="read">{ACCESS_LABEL.read}</SelectItem>
                  <SelectItem value="control">{ACCESS_LABEL.control}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">{usedText(account.lastUsedAt)}</span>
              <ConfirmButton
                destructive
                title={`Disconnect ${provider.name}?`}
                description={`${provider.name} loses access to this browser right away. You can connect again any time.`}
                confirmLabel="Disconnect"
                onConfirm={() => run('disconnectAccount')}
              >
                Disconnect
              </ConfirmButton>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

ProviderCard.displayName = 'ProviderCard';

export { ProviderCard };
