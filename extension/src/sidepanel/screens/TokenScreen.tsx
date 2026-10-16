import { useState, type FormEvent } from 'react';

import { ListSection } from '@/components/ios/List';
import { NavBar } from '@/components/ios/NavBar';
import { Pill } from '@/components/ios/Pill';
import { Segmented } from '@/components/ios/Segmented';
import { send, type Access, type Agent } from '@/lib/api';
import { ACCESS_HINT, ACCESS_LABEL } from '@/lib/format';

import { useNavigation } from '../navigation';

const SUGGESTED = ['Claude', 'ChatGPT', 'Cursor', 'Codex'];

/** For tools that cannot sign in: a link with its own key. Always starts at Read. */
function TokenScreen({ onChange }: { onChange: () => void }) {
  const { pop, replace, backLabel } = useNavigation();
  const [label, setLabel] = useState('');
  const [access, setAccess] = useState<Access>('read');
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    try {
      const agent = await send<Agent>('addAgent', { label, access });
      onChange();
      replace({ name: 'agent', id: agent.id });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };

  return (
    <>
      <NavBar title="Link with a key" back={{ label: backLabel, onClick: pop }} />
      <form onSubmit={submit} className="grid gap-6 px-4 pt-2 pb-8">
        <ListSection title="Name" footer={error ? <span className="text-destructive">{error}</span> : 'So you know which tool it is.'}>
          <input
            id="agent-name"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Claude"
            maxLength={40}
            autoFocus
            autoComplete="off"
            className="h-11 w-full bg-transparent px-4 text-[15px] outline-none placeholder:text-muted-foreground"
          />
        </ListSection>
        <div className="-mt-3 flex flex-wrap gap-1.5 px-1">
          {SUGGESTED.map((name) => (
            <Pill key={name} type="button" size="sm" variant="secondary" onClick={() => setLabel(name)}>
              {name}
            </Pill>
          ))}
        </div>
        <ListSection title="It can" footer={ACCESS_HINT[access]}>
          <div className="p-2">
            <Segmented<Access>
              label="Access"
              value={access}
              onChange={setAccess}
              options={[
                { value: 'read', label: ACCESS_LABEL.read },
                { value: 'control', label: ACCESS_LABEL.control },
              ]}
            />
          </div>
        </ListSection>
        <Pill type="submit" className="justify-self-stretch">
          Make the link
        </Pill>
      </form>
    </>
  );
}

TokenScreen.displayName = 'TokenScreen';

export { TokenScreen };
