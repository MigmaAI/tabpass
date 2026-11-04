import { useRef, useState, type FormEvent } from 'react';

import { ListSection } from '@/components/ios/List';
import { NavBar } from '@/components/ios/NavBar';
import { Pill } from '@/components/ios/Pill';
import { Segmented } from '@/components/ios/Segmented';
import { send, type Access, type Agent } from '@/lib/api';
import { ACCESS_HINT, ACCESS_LABEL } from '@/lib/format';

import { useNavigation } from '../navigation';

const SUGGESTED = ['Claude', 'ChatGPT', 'Cursor', 'Codex'];

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
      <NavBar title="Connection prompt" back={{ label: backLabel, onClick: pop }} />
      <form onSubmit={submit} className="grid gap-6 px-4 pt-4 pb-8">
        <div className="grid gap-1 px-1"><h2 className="text-[23px] leading-7 font-semibold tracking-[-0.04em]">Choose its access</h2><p className="text-[13px] leading-[18px] text-muted-foreground">Next, copy the private prompt into your AI. You can change its access or disconnect at any time.</p></div>
        <ListSection title="Connection name" footer="So you can recognize it later.">
          <input
            id="agent-name"
            aria-label="Connection name"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="My AI"
            disabled={saving}
            maxLength={40}
            autoFocus
            autoComplete="off"
            className="field-surface h-12 w-full rounded-xl px-3 text-[14px] outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/70"
          />
        </ListSection>
        <div className="-mt-3 flex flex-wrap gap-1.5 px-1">
          {SUGGESTED.map((name) => (
            <Pill key={name} type="button" size="sm" variant="secondary" disabled={saving} onClick={() => setLabel(name)}>
              {name}
            </Pill>
          ))}
        </div>
        <ListSection title="It can" footer={ACCESS_HINT[access]}>
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
        {error && <p role="alert" className="px-1 text-[13px] leading-[18px] text-destructive">{error}</p>}
        <Pill type="submit" disabled={saving || !label.trim()} className="justify-self-stretch">
          {saving ? 'Creating…' : 'Create connection prompt'}
        </Pill>
      </form>
    </>
  );
}

TokenScreen.displayName = 'TokenScreen';

export { TokenScreen };
