import { useState, type FormEvent } from 'react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { send, type TabpassState } from '@/lib/api';

import { Section } from './Section';
import { SiteList } from './SiteList';

interface SitesSectionProps {
  state: TabpassState;
  onChange: () => void;
}

function SitesSection({ state, onChange }: SitesSectionProps) {
  const [site, setSite] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);

  const add = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    try {
      await send('addSite', { site, list: submitter?.value === 'blocked' ? 'blocked' : 'allowed' });
      setSite('');
      setError(null);
      onChange();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };

  const setAllowAll = (value: boolean): void => {
    if (value) setConfirmAll(true);
    else send('setAllowAllSites', { value: false }).then(onChange);
  };

  return (
    <Section title="Sites">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="allow-all" className="font-normal">
          Allow every site without asking
        </Label>
        <Switch id="allow-all" checked={state.settings.allowAllSites} onCheckedChange={setAllowAll} />
      </div>
      <SiteList title="Always allowed" sites={state.sites.allowed} list="allowed" onChange={onChange} />
      <SiteList title="Blocked" sites={state.sites.blocked} list="blocked" onChange={onChange} />
      <form onSubmit={add} className="flex gap-2">
        <Input aria-label="Site" placeholder="example.com" value={site} onChange={(event) => setSite(event.target.value)} autoComplete="off" />
        <Button type="submit" variant="outline" value="allowed">
          Allow
        </Button>
        <Button type="submit" variant="outline" value="blocked">
          Block
        </Button>
      </form>
      {error && <p className="text-sm text-destructive">{error}</p>}

      <AlertDialog open={confirmAll} onOpenChange={setConfirmAll}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Allow every site?</AlertDialogTitle>
            <AlertDialogDescription>Every agent could then read and use any site you are signed in to, without asking first.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => send('setAllowAllSites', { value: true }).then(onChange)}>Allow every site</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Section>
  );
}

SitesSection.displayName = 'SitesSection';

export { SitesSection };
