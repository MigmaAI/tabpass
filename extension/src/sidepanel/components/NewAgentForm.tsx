import { useState, type FormEvent } from 'react';

import { AccessPicker } from '@/components/AccessPicker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { send, type Access, type Agent } from '@/lib/api';

const SUGGESTED_NAMES = ['Claude', 'ChatGPT', 'Cursor', 'Codex'];

interface NewAgentFormProps {
  onCreated: (agent: Agent) => void;
  onCancel: () => void;
}

/** Name it, pick what it may do, get its link. A new agent always starts at Read. */
function NewAgentForm({ onCreated, onCancel }: NewAgentFormProps) {
  const [label, setLabel] = useState('');
  const [access, setAccess] = useState<Access>('read');
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    try {
      onCreated(await send<Agent>('addAgent', { label, access }));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };

  return (
    <form onSubmit={submit} className="grid gap-4 rounded-lg border p-3">
      <div className="grid gap-2">
        <Label htmlFor="agent-name">Name</Label>
        <Input id="agent-name" value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Claude" maxLength={40} autoFocus autoComplete="off" />
        <div className="flex flex-wrap gap-1.5">
          {SUGGESTED_NAMES.map((name) => (
            <Button key={name} type="button" variant="secondary" size="xs" className="rounded-full" onClick={() => setLabel(name)}>
              {name}
            </Button>
          ))}
        </div>
      </div>
      <div className="grid gap-2">
        <span className="text-sm font-medium">It can</span>
        <AccessPicker idPrefix="new-agent" value={access} onChange={setAccess} />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">Connect</Button>
      </div>
    </form>
  );
}

NewAgentForm.displayName = 'NewAgentForm';

export { NewAgentForm };
