import type { ReactNode } from 'react';

interface PromptLayoutProps {
  tile: ReactNode;
  title: string;
  message: ReactNode;
  children?: ReactNode;
  actions: ReactNode;
  footer?: ReactNode;
}

/** A focused consent sheet sized for the extension's compact prompt window. */
function PromptLayout({ tile, title, message, children, actions, footer }: PromptLayoutProps) {
  return (
    <main className="mx-auto grid min-h-screen w-full max-w-sm content-center gap-5 px-6 py-7">
      <div className="grid min-w-0 justify-items-center gap-3 pb-2 text-center [overflow-wrap:anywhere]">
        {tile}
        <h1 className="max-w-[17ch] text-[24px] leading-[27px] font-semibold tracking-[-0.04em]">{title}</h1>
        <div className="max-w-[34ch] text-[12px] leading-[17px] text-muted-foreground">{message}</div>
      </div>
      {children}
      <div className="grid gap-2.5">{actions}</div>
      {footer && <div className="flex justify-center gap-1">{footer}</div>}
    </main>
  );
}

PromptLayout.displayName = 'PromptLayout';

export { PromptLayout };
