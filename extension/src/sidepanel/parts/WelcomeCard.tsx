import { ArrowRightIcon, ShieldCheckIcon } from 'lucide-react';

import { Pill } from '@/components/ios/Pill';
import { send } from '@/lib/api';

/**
 * Shown once: what leaves the browser, and when. The Chrome Web Store asks for this to be
 * visible in the product, not only in the privacy policy.
 */
function WelcomeCard({ onChange }: { onChange: () => void }) {
  return (
    <div className="grid gap-3 px-1 py-2" role="note">
      <div className="relative grid gap-2">
        <p className="flex items-start gap-2 text-[18px] leading-6 font-semibold tracking-[-0.025em]"><ShieldCheckIcon className="mt-0.5 size-[18px] shrink-0 text-tint" strokeWidth={1.8} />Give your AI access to your browser</p>
        <p className="text-[13px] leading-[18px] text-muted-foreground">
          Ask it to read pages, compare tabs, or use what’s open.
        </p>
        <p className="text-[12px] leading-[17px] text-muted-foreground">
          Connected AI can see your tab titles and links. You approve each website before it can read pages or click and type.
        </p>
      </div>
      <Pill size="sm" variant="secondary" className="w-fit" onClick={() => send('dismissWelcome').then(onChange)}>
        Got it <ArrowRightIcon />
      </Pill>
    </div>
  );
}

WelcomeCard.displayName = 'WelcomeCard';

export { WelcomeCard };
