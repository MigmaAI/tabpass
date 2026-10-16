import type { IncomingMessage, ServerResponse } from 'node:http';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import type { BrowserHub } from './browser-hub.js';
import type { AgentAccess } from './protocol.js';
import type { ParsedAgentToken } from './tokens.js';
import { SERVER_INSTRUCTIONS, toolsForAccess } from './tools.js';

export const SERVER_NAME = 'migma-tabs';
export const SERVER_VERSION = '0.1.0';

/** Builds a per-request MCP server that exposes the tools this agent may use. */
export function createBrowserMcpServer(hub: BrowserHub, token: ParsedAgentToken, access: AgentAccess | null): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: SERVER_INSTRUCTIONS }
  );

  for (const tool of toolsForAccess(access)) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: { title: tool.title, ...tool.annotations },
      },
      async (args: Record<string, unknown>): Promise<CallToolResult> => {
        const result = await hub.call(token, tool.name, args);
        return { content: result.content, isError: result.isError };
      }
    );
  }

  return server;
}

/** Serves one stateless Streamable HTTP MCP request (same shape as Migma's hosted /mcp route). */
export async function serveMcpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  body: unknown,
  hub: BrowserHub,
  token: ParsedAgentToken,
  access: AgentAccess | null
): Promise<void> {
  const server = createBrowserMcpServer(hub, token, access);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    void transport.close().catch(() => undefined);
    void server.close().catch(() => undefined);
  };
  res.once('close', close);

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  } catch (error) {
    close();
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null }));
    }
    throw error;
  }
}
