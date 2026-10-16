import { Loader2Icon } from 'lucide-react';
import { useState } from 'react';

import { IconTile } from '@/components/ios/IconTile';
import { ListRow, ListSection } from '@/components/ios/List';
import { NavBar } from '@/components/ios/NavBar';
import { Pill } from '@/components/ios/Pill';
import { Segmented } from '@/components/ios/Segmented';
import { send, type Access, type TabpassState } from '@/lib/api';
import { ACCESS_HINT, ACCESS_LABEL, usedText } from '@/lib/format';

import { useNavigation } from '../navigation';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { DetailHeader } from '../parts/DetailHeader';

const STATE_TEXT: Record<string, string> = {
  connected: 'Connected',
  connecting: 'Connecting',
  unavailable: 'Retrying',
  error: 'Not connected',
  disconnected: 'Disconnected',
  offline: 'Offline',
};

/** Migma (or another account provider): one click to connect, then who, what it may do, and out. */
function ProviderScreen({ state, id, onChange }: { state: TabpassState; id: string; onChange: () => void }) {
  const { pop, backLabel } = useNavigation();
  const [confirm, setConfirm] = useState(false);
  const provider = state.providers.find((candidate) => candidate.id === id);
  if (!provider) return null;
  const { account } = provider;
  const run = (type: string, payload: Record<string, unknown> = {}): void => {
    send(type, { provider: provider.id, ...payload }).then(onChange);
  };
  const live = account ? (account.relay.state === 'connected' ? account.status.state : account.relay.state) : null;

  return (
    <>
      <NavBar title={provider.name} back={{ label: backLabel, onClick: pop }} />
      <div className="grid gap-6 px-4 pt-2 pb-8">
        <DetailHeader
          tile={
            <IconTile color="var(--primary)" size="lg" className="text-primary-foreground">
              M
            </IconTile>
          }
          title={provider.name}
          subtitle={account ? `Connected as ${account.email ?? account.name ?? account.id}` : `${provider.name}'s AI uses your open tabs for context and design ideas.`}
        />

        {provider.notice && !account && <p className="text-center text-[13px] text-destructive">{provider.notice}</p>}

        {!account && !provider.pending && (
          <Pill className="justify-self-stretch" onClick={() => run('startConnect')}>
            Connect to {provider.name}
          </Pill>
        )}
        {!account && provider.pending && (
          <ListSection footer={`Sign in to ${provider.name} in the tab that opened. It closes by itself.`}>
            <ListRow
              icon={<Loader2Icon className="size-5 animate-spin text-muted-foreground" aria-hidden />}
              title="Waiting for you to finish"
              trailing={
                <Pill size="sm" variant="secondary" onClick={() => run('cancelConnect')}>
                  Cancel
                </Pill>
              }
            />
          </ListSection>
        )}

        {account && (
          <>
            <ListSection title="It can" footer={ACCESS_HINT[account.access]}>
              <div className="p-2">
                <Segmented<Access>
                  label="Access"
                  value={account.access}
                  onChange={(access) => run('setAccountAccess', { access })}
                  options={[
                    { value: 'read', label: ACCESS_LABEL.read },
                    { value: 'control', label: ACCESS_LABEL.control },
                  ]}
                />
              </div>
            </ListSection>
            <ListSection title="Connection" footer={account.status.state !== 'connected' ? account.status.message : undefined}>
              <ListRow title="Status" value={STATE_TEXT[live ?? 'connecting'] ?? live} />
              <ListRow title="Last used" value={usedText(account.lastUsedAt).replace(/^used /, '')} />
            </ListSection>
            <ListSection>
              <ListRow title={`Disconnect ${provider.name}`} tone="destructive" onClick={() => setConfirm(true)} />
            </ListSection>
          </>
        )}
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Disconnect ${provider.name}?`}
        description={`${provider.name} loses access to this browser right away. You can connect again any time.`}
        confirmLabel="Disconnect"
        destructive
        onConfirm={() => run('disconnectAccount')}
      />
    </>
  );
}

ProviderScreen.displayName = 'ProviderScreen';

export { ProviderScreen };
