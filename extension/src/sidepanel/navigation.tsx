import { createContext, useContext } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'agent'; id: string }
  | { name: 'provider'; id: string }
  | { name: 'connect' }
  | { name: 'tool'; id: string }
  | { name: 'token' }
  | { name: 'sites' }
  | { name: 'activity' }
  | { name: 'browser' };

export interface Navigation {
  push: (route: Route) => void;
  pop: () => void;
  /** Swap the current screen for another (e.g. a form for the thing it created). */
  replace: (route: Route) => void;
  /** Label for the back button: the title of the screen underneath. */
  backLabel: string;
}

export const NavigationContext = createContext<Navigation>({
  push: () => undefined,
  pop: () => undefined,
  replace: () => undefined,
  backLabel: 'Back',
});

export function useNavigation(): Navigation {
  return useContext(NavigationContext);
}
