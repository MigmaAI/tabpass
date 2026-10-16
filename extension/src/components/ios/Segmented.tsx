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
      className={cn('grid auto-cols-fr grid-flow-col gap-0.5 rounded-[9px] bg-secondary p-0.5', className)}
    >
      {options.map((option) => (
        <RadioGroupPrimitive.Item
          key={option.value}
          value={option.value}
          className={cn(
            'h-8 rounded-[7px] px-2 text-[13px] font-medium text-foreground transition outline-none',
            'focus-visible:ring-2 focus-visible:ring-ring/60',
            'data-[state=checked]:bg-card data-[state=checked]:shadow-[0_1px_3px_rgba(0,0,0,0.12),0_0_0_0.5px_rgba(0,0,0,0.04)]',
            'dark:data-[state=checked]:bg-[#636366]'
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
