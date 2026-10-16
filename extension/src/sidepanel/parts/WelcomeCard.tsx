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
        <p className="flex items-center gap-2 text-[18px] font-semibold tracking-[-0.025em]"><ShieldCheckIcon className="size-[18px] text-tint" strokeWidth={1.8} />Your tabs. Your say.</p>
        <p className="text-[13px] leading-[18px] text-muted-foreground">
          Tabpass shares a page only with AI tools you connect, and only on sites you allow. Tab titles and links are shared with them so they can find the right tab.
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
