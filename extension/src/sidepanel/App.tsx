import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { TooltipProvider } from '@/components/ui/tooltip';
import { useTabpassState, type TabpassState } from '@/lib/api';
import { CLIENTS } from '@/lib/clients';

import { NavigationContext, type Navigation, type Route } from './navigation';
import { ActivityScreen } from './screens/ActivityScreen';
import { AgentScreen } from './screens/AgentScreen';
import { BrowserScreen } from './screens/BrowserScreen';
import { ConnectScreen } from './screens/ConnectScreen';
import { HomeScreen } from './screens/HomeScreen';
import { ProviderScreen } from './screens/ProviderScreen';
import { SitesScreen } from './screens/SitesScreen';
import { TokenScreen } from './screens/TokenScreen';
import { ToolScreen } from './screens/ToolScreen';

/** The title a screen shows, used as the back label of the screen pushed on top of it. */
function titleOf(route: Route, state: TabpassState): string {
  switch (route.name) {
    case 'home':
      return 'Tabpass';
    case 'agent':
      return state.agents.find((agent) => agent.id === route.id)?.label ?? 'Back';
    case 'provider':
      return state.providers.find((provider) => provider.id === route.id)?.name ?? 'Back';
    case 'connect':
      return 'Connect your AI';
    case 'tool':
      return CLIENTS.find((client) => client.id === route.id)?.name ?? 'Back';
    case 'token':
      return 'Connection prompt';
    case 'sites':
      return 'Sites';
    case 'activity':
      return 'Activity';
    case 'browser':
      return 'Browser';
  }
}

function renderScreen(route: Route, state: TabpassState, refresh: () => void) {
  switch (route.name) {
    case 'home':
      return <HomeScreen state={state} onChange={refresh} />;
    case 'agent':
      return <AgentScreen state={state} id={route.id} onChange={refresh} />;
    case 'provider':
      return <ProviderScreen state={state} id={route.id} onChange={refresh} />;
    case 'connect':
      return <ConnectScreen state={state} />;
    case 'tool':
      return <ToolScreen state={state} id={route.id} onChange={refresh} />;
    case 'token':
      return <TokenScreen onChange={refresh} />;
    case 'sites':
      return <SitesScreen state={state} onChange={refresh} />;
    case 'activity':
      return <ActivityScreen state={state} onChange={refresh} />;
    case 'browser':
      return <BrowserScreen state={state} onChange={refresh} />;
  }
}

/** A navigation stack over live state, with focus following the screen the person opens. */
function App() {
  const { state, refresh } = useTabpassState();
  const [stack, setStack] = useState<Route[]>([{ name: 'home' }]);
  const [direction, setDirection] = useState<'push' | 'pop'>('push');
  const screen = useRef<HTMLDivElement>(null);
  const focusedRoute = useRef<Route | null>(null);

  const push = useCallback((route: Route) => {
    setDirection('push');
    setStack((current) => [...current, route]);
  }, []);
  const pop = useCallback(() => {
    setDirection('pop');
    setStack((current) => (current.length > 1 ? current.slice(0, -1) : current));
  }, []);
  const replace = useCallback((route: Route) => {
    setDirection('push');
    setStack((current) => [...current.slice(0, -1), route]);
  }, []);

  const route = stack[stack.length - 1]!;
  useEffect(() => {
    if (focusedRoute.current === route) return;
    const heading = screen.current?.querySelector('h1');
    if (!heading) return;
    focusedRoute.current = route;
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }, [route, state]);
  const below = stack[stack.length - 2];
  const navigation = useMemo<Navigation>(
    () => ({ push, pop, replace, backLabel: below && state ? titleOf(below, state) : 'Back' }),
    [push, pop, replace, below, state]
  );
  if (!state) return <p className="px-5 py-8 text-sm text-muted-foreground" role="status">Opening Tabpass…</p>;

  return (
    <TooltipProvider>
      <NavigationContext.Provider value={navigation}>
        <div ref={screen} key={`${stack.length}-${route.name}`} className={stack.length > 1 || direction === 'pop' ? (direction === 'push' ? 'screen-push' : 'screen-pop') : undefined}>
          {renderScreen(route, state, refresh)}
        </div>
      </NavigationContext.Provider>
    </TooltipProvider>
  );
}

App.displayName = 'App';

export { App };
