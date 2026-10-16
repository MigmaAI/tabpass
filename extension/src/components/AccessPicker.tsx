import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import type { Access } from '@/lib/api';
import { ACCESS_HINT, ACCESS_LABEL } from '@/lib/format';

interface AccessPickerProps {
  value: Access;
  onChange: (access: Access) => void;
  idPrefix: string;
}

/** Read or Read and act, with what each one allows. Read is always the default. */
function AccessPicker({ value, onChange, idPrefix }: AccessPickerProps) {
  return (
    <RadioGroup value={value} onValueChange={(next) => onChange(next as Access)} aria-label="Access" className="gap-2">
      {(['read', 'control'] as const).map((access) => (
        <Label
          key={access}
          htmlFor={`${idPrefix}-${access}`}
          className="flex cursor-pointer items-start gap-3 rounded-md border p-3 font-normal has-[[data-state=checked]]:border-primary"
        >
          <RadioGroupItem id={`${idPrefix}-${access}`} value={access} className="mt-0.5" />
          <span className="grid gap-1">
            <span className="text-sm font-medium">{ACCESS_LABEL[access]}</span>
            <span className="text-xs leading-snug text-muted-foreground">{ACCESS_HINT[access]}</span>
          </span>
        </Label>
      ))}
    </RadioGroup>
  );
}

AccessPicker.displayName = 'AccessPicker';

export { AccessPicker };
