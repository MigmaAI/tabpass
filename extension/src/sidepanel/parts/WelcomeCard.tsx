import { ShieldCheckIcon } from 'lucide-react';

import { Pill } from '@/components/ios/Pill';
import { send } from '@/lib/api';

/**
 * Shown once: what leaves the browser, and when. The Chrome Web Store asks for this to be
 * visible in the product, not only in the privacy policy.
 */
function WelcomeCard({ onChange }: { onChange: () => void }) {
  return (
    <div className="grid gap-3 rounded-xl bg-card p-4" role="note">
      <div className="flex gap-3">
        <ShieldCheckIcon className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
        <p className="text-[13px] leading-[18px] text-muted-foreground">
          <span className="block text-[15px] leading-5 font-semibold text-foreground">You stay in charge</span>
          Tabpass shares a page only with AI tools you connect, and only on sites you allow. Tab titles and links are shared with
          them so they can find the right tab.
        </p>
      </div>
      <Pill size="sm" variant="secondary" className="justify-self-start" onClick={() => send('dismissWelcome').then(onChange)}>
        Got it
      </Pill>
    </div>
  );
}

WelcomeCard.displayName = 'WelcomeCard';

export { WelcomeCard };
