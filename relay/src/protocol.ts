/**
 * Wire protocol between the relay and the Tabpass extension (one WebSocket per browser and relay).
 * The extension mirrors these shapes in `extension/public/lib/relay-client.js`; bump
 * PROTOCOL_VERSION on any breaking change to either side.
 */

export const PROTOCOL_VERSION = 1;

export type AgentAccess = 'read' | 'control';

/** An agent the user connected in the extension's side panel. The relay only ever sees the hash. */
export interface AgentGrant {
  tokenHash: string;
  label: string;
  access: AgentAccess;
}

/** Proof that this browser is connected to a person's account at a provider such as Migma. */
export interface AccountCredential {
  connectionId: string;
  secret: string;
}

/**
 * ok: verified. invalid: the provider does not know this connection (revoked or deleted).
 * unavailable: the provider could not be asked; keep the credential and retry.
 * unsupported: this relay has no account provider configured.
 */
export type AccountStatus = 'ok' | 'invalid' | 'unavailable' | 'unsupported';

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
  /** Shown to agents when a person has several browsers, e.g. "Chrome on Mac". */
  browserName: string;
  agents: AgentGrant[];
  account?: AccountCredential;
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

/** The user focused this browser; account calls go to the most recently active browser. */
export interface ActiveMessage {
  type: 'active';
}

export type ExtensionMessage = HelloMessage | AgentsMessage | ResultMessage | PingMessage | ActiveMessage;

// Relay -> extension
export interface WelcomeMessage {
  type: 'welcome';
  browserId: string;
  mcpUrl: string;
  account?: { status: AccountStatus; name?: string };
}

export interface CallMessage {
  type: 'call';
  id: string;
  tool: string;
  args: Record<string, unknown>;
  /** Set for calls from a token agent. */
  tokenHash?: string;
  /** Set for calls made through the browser's account (e.g. Migma). `via` names the client, if known. */
  account?: { via?: string };
}

export interface AccountUpdateMessage {
  type: 'account';
  status: AccountStatus;
  name?: string;
}

export interface PongMessage {
  type: 'pong';
}

export interface RelayErrorMessage {
  type: 'error';
  message: string;
}

export type RelayMessage =
  | WelcomeMessage
  | CallMessage
  | AccountUpdateMessage
  | PongMessage
  | RelayErrorMessage;

const MAX_LABEL_LENGTH = 60;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const BROWSER_KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const CONNECTION_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const SECRET_PATTERN = /^[A-Za-z0-9_-]{32,256}$/;

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

function parseAccount(value: unknown): AccountCredential | null | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return null;
  const { connectionId, secret } = value;
  if (typeof connectionId !== 'string' || !CONNECTION_ID_PATTERN.test(connectionId)) return null;
  if (typeof secret !== 'string' || !SECRET_PATTERN.test(secret)) return null;
  return { connectionId, secret };
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
      const account = parseAccount(data.account);
      if (
        typeof data.protocol !== 'number' ||
        typeof data.browserKey !== 'string' ||
        !BROWSER_KEY_PATTERN.test(data.browserKey) ||
        typeof data.extensionVersion !== 'string' ||
        !agents ||
        account === null
      ) {
        return null;
      }
      const browserName =
        typeof data.browserName === 'string' && data.browserName.trim() ? data.browserName.trim().slice(0, MAX_LABEL_LENGTH) : 'Chrome';
      return {
        type: 'hello',
        protocol: data.protocol,
        browserKey: data.browserKey,
        extensionVersion: data.extensionVersion.slice(0, 32),
        browserName,
        agents,
        ...(account ? { account } : {}),
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
    case 'active':
      return { type: 'active' };
    default:
      return null;
  }
}
