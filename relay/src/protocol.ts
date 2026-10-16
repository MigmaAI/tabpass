/**
 * Wire protocol between the relay and the Migma Tabs extension (one WebSocket per browser).
 * The extension mirrors these shapes in `extension/lib/relay-client.js`; bump PROTOCOL_VERSION
 * on any breaking change to either side.
 */

export const PROTOCOL_VERSION = 1;

export type AgentAccess = 'read' | 'control';

/** An agent the user connected in the extension's side panel. The relay only ever sees the hash. */
export interface AgentGrant {
  tokenHash: string;
  label: string;
  access: AgentAccess;
}

export interface TextContent {
  type: 'text';
  text: string;
}

export interface ImageContent {
  type: 'image';
  data: string;
  mimeType: string;
}

export type ToolContent = TextContent | ImageContent;

export interface ToolResult {
  content: ToolContent[];
  isError?: boolean;
}

// Extension -> relay
export interface HelloMessage {
  type: 'hello';
  protocol: number;
  browserKey: string;
  extensionVersion: string;
  agents: AgentGrant[];
}

export interface AgentsMessage {
  type: 'agents';
  agents: AgentGrant[];
}

export interface ResultMessage {
  type: 'result';
  id: string;
  result: ToolResult;
}

export interface PingMessage {
  type: 'ping';
}

export type ExtensionMessage = HelloMessage | AgentsMessage | ResultMessage | PingMessage;

// Relay -> extension
export interface WelcomeMessage {
  type: 'welcome';
  browserId: string;
  mcpUrl: string;
}

export interface CallMessage {
  type: 'call';
  id: string;
  tokenHash: string;
  tool: string;
  args: Record<string, unknown>;
}

export interface PongMessage {
  type: 'pong';
}

export interface RelayErrorMessage {
  type: 'error';
  message: string;
}

export type RelayMessage = WelcomeMessage | CallMessage | PongMessage | RelayErrorMessage;

const MAX_LABEL_LENGTH = 60;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const BROWSER_KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseAgents(value: unknown): AgentGrant[] | null {
  if (!Array.isArray(value) || value.length > 50) return null;
  const agents: AgentGrant[] = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    const { tokenHash, label, access } = item;
    if (typeof tokenHash !== 'string' || !HASH_PATTERN.test(tokenHash)) return null;
    if (typeof label !== 'string' || label.length === 0) return null;
    if (access !== 'read' && access !== 'control') return null;
    agents.push({ tokenHash, label: label.slice(0, MAX_LABEL_LENGTH), access });
  }
  return agents;
}

function parseContent(value: unknown): ToolContent[] | null {
  if (!Array.isArray(value)) return null;
  const content: ToolContent[] = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    if (item.type === 'text' && typeof item.text === 'string') {
      content.push({ type: 'text', text: item.text });
    } else if (
      item.type === 'image' &&
      typeof item.data === 'string' &&
      typeof item.mimeType === 'string' &&
      /^image\/(png|jpeg|webp)$/.test(item.mimeType)
    ) {
      content.push({ type: 'image', data: item.data, mimeType: item.mimeType });
    } else {
      return null;
    }
  }
  return content;
}

/** Validates an untrusted frame from the extension. Returns null for anything malformed. */
export function parseExtensionMessage(raw: string): ExtensionMessage | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(data)) return null;

  switch (data.type) {
    case 'hello': {
      const agents = parseAgents(data.agents);
      if (
        typeof data.protocol !== 'number' ||
        typeof data.browserKey !== 'string' ||
        !BROWSER_KEY_PATTERN.test(data.browserKey) ||
        typeof data.extensionVersion !== 'string' ||
        !agents
      ) {
        return null;
      }
      return {
        type: 'hello',
        protocol: data.protocol,
        browserKey: data.browserKey,
        extensionVersion: data.extensionVersion.slice(0, 32),
        agents,
      };
    }
    case 'agents': {
      const agents = parseAgents(data.agents);
      return agents ? { type: 'agents', agents } : null;
    }
    case 'result': {
      if (typeof data.id !== 'string' || !isRecord(data.result)) return null;
      const content = parseContent(data.result.content);
      if (!content) return null;
      return {
        type: 'result',
        id: data.id,
        result: { content, isError: data.result.isError === true },
      };
    }
    case 'ping':
      return { type: 'ping' };
    default:
      return null;
  }
}
