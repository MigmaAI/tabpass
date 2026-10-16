import { CheckIcon, CopyIcon } from 'lucide-react';
import { useState } from 'react';

import { cn } from '@/lib/utils';

interface CopyRowProps {
  value: string;
  label?: string;
  multiline?: boolean;
}

/** A value with a Copy button, sized to sit inside a list section. */
function CopyRow({ value, label, multiline = false }: CopyRowProps) {
  const [copied, setCopied] = useState(false);
  const copy = async (): Promise<void> => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="flex min-h-11 min-w-0 items-start gap-3 rounded-xl bg-secondary/65 px-3 py-3">
      <span className="grid min-w-0 flex-1 gap-0.5">
        {label && <span className="text-[13px] text-muted-foreground">{label}</span>}
        <code
          title={value}
          className={cn('font-mono text-[12px] leading-[18px]', multiline ? 'overflow-x-auto whitespace-pre' : 'truncate')}
        >
          {value}
        </code>
      </span>
      <button
        type="button"
        onClick={copy}
        aria-label={`Copy ${label ?? 'value'}`}
        className="-my-1 inline-flex min-h-9 shrink-0 items-center gap-1 rounded-lg px-2 text-[12px] font-semibold outline-none hover:bg-pressed focus-visible:ring-2 focus-visible:ring-ring/60 [&_svg]:size-3.5"
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

CopyRow.displayName = 'CopyRow';

export { CopyRow };
