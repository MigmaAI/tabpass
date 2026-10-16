import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { send } from '@/lib/api';

interface HeaderProps {
  paused: boolean;
  onChange: () => void;
}

/** Brand plus the one switch that stops every agent at once. */
function Header({ paused, onChange }: HeaderProps) {
  const toggle = (on: boolean): void => {
    send('setPaused', { paused: !on }).then(onChange);
  };

  return (
    <header className="sticky top-0 z-10 flex items-center gap-2 border-b bg-background/95 px-4 py-3 backdrop-blur">
      <img src="/icons/icon-32.png" alt="" width={20} height={20} />
      <h1 className="text-sm font-semibold">Tabpass</h1>
      <div className="ml-auto flex items-center gap-2">
        <Label htmlFor="agents-on" className="text-xs font-normal text-muted-foreground">
          {paused ? 'Paused' : 'On'}
        </Label>
        <Switch id="agents-on" checked={!paused} onCheckedChange={toggle} aria-label="Let agents use this browser" />
      </div>
    </header>
  );
}

Header.displayName = 'Header';

export { Header };
