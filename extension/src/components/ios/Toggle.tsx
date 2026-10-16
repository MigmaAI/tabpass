import { Switch as SwitchPrimitive } from 'radix-ui';

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  id?: string;
}

/** A compact, tactile on/off control in Tabpass charcoal. */
function Toggle({ checked, onChange, label, id }: ToggleProps) {
  return (
    <SwitchPrimitive.Root
      id={id}
      checked={checked}
      onCheckedChange={onChange}
      aria-label={label}
      className="relative inline-flex h-7 w-12 shrink-0 rounded-full border border-border bg-secondary transition-colors duration-200 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/60 data-[state=checked]:border-success data-[state=checked]:bg-success"
    >
      <SwitchPrimitive.Thumb className="pointer-events-none mt-[2px] ml-[2px] block size-[22px] rounded-full bg-white shadow-[0_2px_6px_rgba(0,0,0,0.18)] transition-transform duration-200 ease-[var(--ease-ios)] data-[state=checked]:translate-x-5" />
    </SwitchPrimitive.Root>
  );
}

Toggle.displayName = 'Toggle';

export { Toggle };
