import { Badge } from '@/components/ui/badge';
import type { ConnectionState } from '@/lib/api';
import { cn } from '@/lib/utils';

const TEXT: Record<ConnectionState, string> = {
  connected: 'Connected',
  connecting: 'Connecting',
  offline: 'Offline',
  error: 'Not connected',
  unavailable: 'Retrying',
  disconnected: 'Disconnected',
};

const DOT: Record<ConnectionState, string> = {
  connected: 'bg-success',
  connecting: 'bg-warning',
  unavailable: 'bg-warning',
  offline: 'bg-destructive',
  error: 'bg-destructive',
  disconnected: 'bg-muted-foreground',
};

function StatusBadge({ state }: { state: ConnectionState }) {
  return (
    <Badge variant="outline" className="gap-1.5 font-normal text-muted-foreground" role="status">
      <span className={cn('size-1.5 rounded-full', DOT[state])} aria-hidden />
      {TEXT[state]}
    </Badge>
  );
}

StatusBadge.displayName = 'StatusBadge';

export { StatusBadge };
