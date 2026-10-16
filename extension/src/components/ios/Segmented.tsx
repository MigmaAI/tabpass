import { RadioGroup as RadioGroupPrimitive } from 'radix-ui';

import { cn } from '@/lib/utils';

interface SegmentedProps<T extends string> {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
  className?: string;
}

/** The iOS segmented control, as an accessible radio group. */
function Segmented<T extends string>({ value, options, onChange, label, className }: SegmentedProps<T>) {
  return (
    <RadioGroupPrimitive.Root
      value={value}
      onValueChange={(next) => onChange(next as T)}
      aria-label={label}
      className={cn('grid auto-cols-fr grid-flow-col gap-1 rounded-xl border border-border bg-secondary/75 p-1', className)}
    >
      {options.map((option) => (
        <RadioGroupPrimitive.Item
          key={option.value}
          value={option.value}
          className={cn(
            'min-h-9 rounded-lg px-2 text-[12px] font-semibold text-muted-foreground transition outline-none',
            'focus-visible:ring-2 focus-visible:ring-ring/60',
            'data-[state=checked]:bg-card data-[state=checked]:text-foreground data-[state=checked]:shadow-[0_2px_8px_rgba(41,38,41,0.09)]'
          )}
        >
          {option.label}
        </RadioGroupPrimitive.Item>
      ))}
    </RadioGroupPrimitive.Root>
  );
}

Segmented.displayName = 'Segmented';

export { Segmented };
