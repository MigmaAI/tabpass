import { Switch as SwitchPrimitive } from 'radix-ui';

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  id?: string;
}

/** The iOS switch: 51×31, green when on. */
function Toggle({ checked, onChange, label, id }: ToggleProps) {
  return (
    <SwitchPrimitive.Root
      id={id}
      checked={checked}
      onCheckedChange={onChange}
      aria-label={label}
      className="relative inline-flex h-[31px] w-[51px] shrink-0 rounded-full bg-secondary transition-colors duration-200 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/60 data-[state=checked]:bg-success"
    >
      <SwitchPrimitive.Thumb className="pointer-events-none mt-[2px] ml-[2px] block size-[27px] rounded-full bg-white shadow-[0_3px_8px_rgba(0,0,0,0.15),0_3px_1px_rgba(0,0,0,0.06)] transition-transform duration-200 ease-[var(--ease-ios)] data-[state=checked]:translate-x-5" />
    </SwitchPrimitive.Root>
  );
}

Toggle.displayName = 'Toggle';

export { Toggle };
