import { ChevronDownIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { Card } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

interface SectionProps {
  title: string;
  meta?: string;
  children: ReactNode;
}

/** A card that stays folded until needed: secondary settings never crowd the main job. */
function Section({ title, meta, children }: SectionProps) {
  return (
    <Card className="gap-0 py-0">
      <Collapsible>
        <CollapsibleTrigger className="group flex w-full items-center gap-2 rounded-xl px-4 py-3.5 text-left text-sm font-semibold outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
          {title}
          {meta && <span className="font-normal text-muted-foreground">{meta}</span>}
          <ChevronDownIcon className="ml-auto size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent className="grid gap-4 px-4 pb-4">{children}</CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

Section.displayName = 'Section';

export { Section };
