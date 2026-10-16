import { useEffect, useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { send, type TabpassState } from '@/lib/api';

import { Section } from './Section';

interface BrowserSectionProps {
  state: TabpassState;
  onChange: () => void;
}

/** This browser's name (agents tell a person's browsers apart by it) and the relay other agents use. */
function BrowserSection({ state, onChange }: BrowserSectionProps) {
  const [name, setName] = useState(state.settings.browserName);
  const [relayUrl, setRelayUrl] = useState(state.settings.relayUrl);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setName(state.settings.browserName), [state.settings.browserName]);
  useEffect(() => setRelayUrl(state.settings.relayUrl), [state.settings.relayUrl]);

  const save = (type: string, payload: Record<string, unknown>) => async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    try {
      await send(type, payload);
      setError(null);
      onChange();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };

  return (
    <Section title="This browser">
      <form onSubmit={save('setBrowserName', { browserName: name })} className="grid gap-1.5">
        <Label htmlFor="browser-name">Name</Label>
        <div className="flex gap-2">
          <Input id="browser-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={60} autoComplete="off" />
          <Button type="submit" variant="outline">
            Save
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">Agents use it to pick between your browsers.</p>
      </form>
      <form onSubmit={save('setRelayUrl', { relayUrl })} className="grid gap-1.5">
        <Label htmlFor="relay-url">Relay for other agents</Label>
        <div className="flex gap-2">
          <Input id="relay-url" value={relayUrl} onChange={(event) => setRelayUrl(event.target.value)} placeholder="wss://relay.example.com/extension" autoComplete="off" />
          <Button type="submit" variant="outline">
            Save
          </Button>
        </div>
        <p className="text-xs text-muted-foreground" role="status">
          {state.status.state === 'connected' ? `Agents reach this browser at ${state.status.mcpUrl}.` : state.status.message ?? ''}
        </p>
      </form>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </Section>
  );
}

BrowserSection.displayName = 'BrowserSection';

export { BrowserSection };
