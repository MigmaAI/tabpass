// Typed access to the service worker (public/background.js). The UI never touches storage
// directly: it asks the worker for state and sends it requests.

import { useCallback, useEffect, useRef, useState } from 'react';

export type Access = 'read' | 'control';
export type ConnectionState = 'connected' | 'connecting' | 'offline' | 'error' | 'unavailable' | 'disconnected';

export interface Agent {
  id: string;
  label: string;
  access: Access;
  token: string;
  color: string;
  createdAt: number;
  lastUsedAt: number | null;
}

export interface RelayStatus {
  state: ConnectionState;
  message?: string;
  mcpUrl?: string;
}

export interface ProviderAccount {
  id: string;
  email: string | null;
  name: string | null;
  access: Access;
  connectedAt: number;
  lastUsedAt: number | null;
  status: { state: ConnectionState; name?: string | null; message?: string };
  relay: RelayStatus;
}

export interface Provider {
  id: string;
  name: string;
  connectUrl: string;
  pending: boolean;
  notice: string | null;
  account: ProviderAccount | null;
}

export interface SitePrompt {
  id: string;
  agentLabel: string;
  access: Access;
  site: string;
  url: string;
}

export interface ConnectPrompt {
  id: string;
  provider: string;
  providerName: string;
  account: { id: string; email?: string; name?: string };
  replaces: { id: string; email?: string; name?: string } | null;
}

export interface ActivityEntry {
  at: number;
  agent: string;
  tool: string;
  site: string;
  ok: boolean;
  detail?: string;
}

export interface TabpassState {
  settings: { relayUrl: string; paused: boolean; allowAllSites: boolean; browserName: string };
  status: RelayStatus;
  agents: Agent[];
  providers: Provider[];
  sites: { allowed: string[]; blocked: string[] };
  prompts: SitePrompt[];
  connectPrompts: ConnectPrompt[];
  activity: ActivityEntry[];
}

export type SitePromptDecision = 'once' | 'site' | 'all' | 'decline' | 'block';

interface WorkerResponse<T> {
  ok: boolean;
  result?: T;
  error?: string;
}

/** Sends a request to the service worker; rejects with its error message. */
export async function send<T = TabpassState>(type: string, payload: Record<string, unknown> = {}): Promise<T> {
  const response = (await chrome.runtime.sendMessage({ type, ...payload })) as WorkerResponse<T> | undefined;
  if (!response?.ok) throw new Error(response?.error ?? 'Something went wrong.');
  return response.result as T;
}

/**
 * Live state: refetched on every storage change and every 30s (so "used 2m ago" stays honest).
 * Requests overlap; only the newest may land, or an older answer could paint stale state.
 */
export function useTabpassState(): { state: TabpassState | null; refresh: () => void } {
  const [state, setState] = useState<TabpassState | null>(null);
  const seq = useRef(0);

  const refresh = useCallback((): void => {
    const current = ++seq.current;
    send('getState')
      .then((next) => {
        if (current === seq.current) setState(next);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    refresh();
    const onChange = (): void => refresh();
    chrome.storage.onChanged.addListener(onChange);
    const timer = setInterval(refresh, 30_000);
    return () => {
      chrome.storage.onChanged.removeListener(onChange);
      clearInterval(timer);
    };
  }, [refresh]);

  return { state, refresh };
}
