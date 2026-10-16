import { Segmented } from '@/components/ios/Segmented';
import type { Access } from '@/lib/api';
import { ACCESS_HINT, ACCESS_LABEL } from '@/lib/format';

/** Read or Read and act, with what the choice allows. Read is the default everywhere. */
function AccessChoice({ value, onChange }: { value: Access; onChange: (access: Access) => void }) {
  return (
    <div className="grid gap-2">
      <Segmented<Access>
        label="Access"
        value={value}
        onChange={onChange}
        options={[
          { value: 'read', label: ACCESS_LABEL.read },
          { value: 'control', label: ACCESS_LABEL.control },
        ]}
      />
      <p className="px-2 pb-1 text-[12px] leading-snug text-muted-foreground">{ACCESS_HINT[value]}</p>
    </div>
  );
}

AccessChoice.displayName = 'AccessChoice';

export { AccessChoice };
