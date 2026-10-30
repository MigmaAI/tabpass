import type { Access, Agent } from './api';

/** Website/OAuth grants are approved at creation; a copied manual link still needs setup. */
export function agentConnectionStatus(agent: Agent, paused: boolean): 'Set up' | 'Paused' | 'Connected' | 'Connecting…' | 'Offline' {
  if (agent.source !== 'web' && agent.source !== 'oauth' && !agent.lastUsedAt) return 'Set up';
  if (paused) return 'Paused';
  if (agent.relay.state === 'connected') return 'Connected';
  if (agent.relay.state === 'connecting') return 'Connecting…';
  return 'Offline';
}

export function timeAgo(timestamp: number | null): string {
  if (!timestamp) return 'never';
  const seconds = Math.round((Date.now() - timestamp) / 1000);
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function usedText(lastUsedAt: number | null): string {
  return lastUsedAt ? `used ${timeAgo(lastUsedAt)}` : 'not used yet';
}

export const ACCESS_LABEL: Record<Access, string> = {
  read: 'Read',
  control: 'Read and act',
};

export const ACCESS_SUMMARY: Record<Access, string> = {
  read: 'Can read your tabs',
  control: 'Can read and act in your tabs',
};

export const ACCESS_HINT: Record<Access, string> = {
  read: 'Lists tabs, reads pages and highlighted text, takes screenshots, pulls design details.',
  control: 'Also opens tabs, clicks, types and fills forms, signed in as you.',
};

/** Chrome's tab group colors, used to mark each agent. */
export const GROUP_COLORS: Record<string, string> = {
  grey: '#71717a',
  blue: '#3b82f6',
  red: '#ef4444',
  yellow: '#eab308',
  green: '#22c55e',
  pink: '#ec4899',
  purple: '#a855f7',
  cyan: '#06b6d4',
  orange: '#f97316',
};

/** A relay on this computer: tools that connect from the cloud cannot reach it. */
export function isLocalRelay(url: string): boolean {
  return /^(https?|wss?):\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(url);
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
