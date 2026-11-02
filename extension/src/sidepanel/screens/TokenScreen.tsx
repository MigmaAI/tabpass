import { useRef, useState, type FormEvent } from 'react';

import { ListSection } from '@/components/ios/List';
import { NavBar } from '@/components/ios/NavBar';
import { Pill } from '@/components/ios/Pill';
import { Segmented } from '@/components/ios/Segmented';
import { send, type Access, type Agent } from '@/lib/api';
import { ACCESS_HINT, ACCESS_LABEL } from '@/lib/format';

import { useNavigation } from '../navigation';

/** Create the private connection used by the copyable prompt. Always starts at Read. */
function TokenScreen({ onChange }: { onChange: () => void }) {
  const { pop, replace, backLabel } = useNavigation();
  const [label, setLabel] = useState('My AI');
  const [access, setAccess] = useState<Access>('read');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (pending.current) return;
    pending.current = true;
    setSaving(true);
    setError(null);
    try {
      const agent = await send<Agent>('addAgent', { label: label.trim(), access });
      onChange();
      replace({ name: 'agent', id: agent.id });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      pending.current = false;
      setSaving(false);
    }
  };

  return (
    <>
      <NavBar title="Connect your AI" back={{ label: backLabel, onClick: pop }} />
      <form onSubmit={submit} className="grid gap-6 px-4 pt-4 pb-8">
        <p className="px-1 text-[14px] leading-5 text-muted-foreground">Choose what your AI can do. Next, copy a prompt and paste it into your AI.</p>
        <ListSection title="Access" footer={ACCESS_HINT[access]}>
          <div className="p-2">
            <Segmented<Access>
              label="Access"
              value={access}
              onChange={(next) => { if (!pending.current) setAccess(next); }}
              options={[
                { value: 'read', label: ACCESS_LABEL.read },
                { value: 'control', label: ACCESS_LABEL.control },
              ]}
            />
          </div>
        </ListSection>
        <ListSection title="Name">
          <input id="agent-name" aria-label="Connection name" value={label} onChange={(event) => setLabel(event.target.value)} disabled={saving} maxLength={40} autoComplete="off" className="field-surface h-11 w-full rounded-[11px] px-3 text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-ring/70" />
        </ListSection>
        {error && <p role="alert" className="px-1 text-[13px] leading-[18px] text-destructive">{error}</p>}
        <Pill type="submit" disabled={saving || !label.trim()} className="justify-self-stretch">
          {saving ? 'Creating…' : 'Continue'}
        </Pill>
      </form>
    </>
  );
}

TokenScreen.displayName = 'TokenScreen';

export { TokenScreen };
