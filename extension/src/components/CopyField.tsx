import { CheckIcon, CopyIcon } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';

interface CopyFieldProps {
  label: string;
  value: string;
  hint?: string;
  multiline?: boolean;
}

function CopyField({ label, value, hint, multiline = false }: CopyFieldProps) {
  const [copied, setCopied] = useState(false);

  const copy = async (): Promise<void> => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="grid min-w-0 gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <Button type="button" variant="ghost" size="xs" onClick={copy} aria-label={`Copy ${label}`}>
          {copied ? <CheckIcon /> : <CopyIcon />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      {multiline ? (
        <pre className="overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-xs leading-relaxed">{value}</pre>
      ) : (
        <code title={value} className="block truncate rounded-md bg-muted px-3 py-2 font-mono text-xs">
          {value}
        </code>
      )}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

CopyField.displayName = 'CopyField';

export { CopyField };
