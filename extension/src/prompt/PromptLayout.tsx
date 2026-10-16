import type { ReactNode } from 'react';

interface PromptLayoutProps {
  tile: ReactNode;
  title: string;
  message: ReactNode;
  children?: ReactNode;
  actions: ReactNode;
  footer?: ReactNode;
}

/** An iOS alert, sized for a small popup window: tile, question, details, stacked answers. */
function PromptLayout({ tile, title, message, children, actions, footer }: PromptLayoutProps) {
  return (
    <main className="mx-auto grid min-h-screen w-full max-w-sm content-center gap-6 p-6">
      <div className="grid justify-items-center gap-3 text-center">
        {tile}
        <h1 className="text-[20px] leading-6 font-semibold tracking-[-0.01em]">{title}</h1>
        <div className="text-[13px] leading-[18px] text-muted-foreground">{message}</div>
      </div>
      {children}
      <div className="grid gap-2">{actions}</div>
      {footer && <div className="flex justify-center gap-1">{footer}</div>}
    </main>
  );
}

PromptLayout.displayName = 'PromptLayout';

export { PromptLayout };
