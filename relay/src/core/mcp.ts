import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import type { BrowserDirectory } from './directory.js';
import type { AgentAccess, ToolResult } from './protocol.js';
import type { ParsedAgentToken } from './tokens.js';
import { SERVER_INSTRUCTIONS, toolsForAccess, type BrowserToolDefinition } from './tools.js';

export const SERVER_NAME = 'tabpass';
export const SERVER_VERSION = '0.3.0';

/**
 * Registers browser tools on any MCP server. A provider's own MCP server (e.g. Migma's) uses this
 * with `accountTools()` and a `call` that reaches the relay, so people get browser tools next to
 * the provider's other tools under one connector.
 */
export function registerBrowserTools(
  server: McpServer,
  tools: BrowserToolDefinition[],
  call: (tool: string, args: Record<string, unknown>) => Promise<ToolResult>
): void {
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: { title: tool.title, ...tool.annotations },
      },
      async (args: Record<string, unknown>): Promise<CallToolResult> => {
        const result = await call(tool.name, args);
        return { content: result.content, isError: result.isError };
      }
    );
  }
}

/** A per-request MCP server exposing the tools this token agent may use. */
export function createTokenMcpServer(directory: BrowserDirectory, token: ParsedAgentToken, access: AgentAccess | null): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: SERVER_INSTRUCTIONS });
  registerBrowserTools(server, toolsForAccess(access), (tool, args) => directory.callAgent(token, tool, args));
  return server;
}

/** Serves one stateless Streamable HTTP MCP request with Web-standard Request/Response. */
export async function serveMcp(request: Request, server: McpServer, parsedBody: unknown): Promise<Response> {
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  try {
    await server.connect(transport);
    return await transport.handleRequest(request, { parsedBody });
  } finally {
    // JSON mode resolves only once every response is ready, so closing here cuts nothing short.
    void transport.close().catch(() => undefined);
    void server.close().catch(() => undefined);
  }
}
