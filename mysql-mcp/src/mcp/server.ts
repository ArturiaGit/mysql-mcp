import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ReadToolService, readTools, type ReadConnections } from './tools.js';
import type { ReadSessionFactory } from '../sql/driver.js';
import { BudgetTransport } from './transport.js';

export interface McpServerOptions { connections?: ReadConnections; sessionFactory?: ReadSessionFactory; timeoutMs?: number }

// Deliberately independent of index.ts, which re-exports these factories.
const SERVER_INFO = Object.freeze({ name: 'mysql-mcp', version: '0.1.0-alpha.0' });

/** Creates an inert protocol server; database access requires explicit dependencies. */
export async function createMcpServer(options: McpServerOptions = {}): Promise<Server> {
  const [{ Server }, { ListToolsRequestSchema, CallToolRequestSchema, McpError, ErrorCode }] =
    await Promise.all([
      import('@modelcontextprotocol/sdk/server/index.js'),
      import('@modelcontextprotocol/sdk/types.js')
    ]);
  const server = new Server(SERVER_INFO, { capabilities: { tools: {} } });
  const tools = new ReadToolService(options.connections, options.sessionFactory, options.timeoutMs);
  const connect = server.connect.bind(server);
  server.connect = transport => connect(new BudgetTransport(transport));
  const shutdown = server.close.bind(server);
  server.close = async () => { tools.close(); await shutdown(); };
  server.onclose = () => { tools.close(); };
  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: readTools() }));
  server.setRequestHandler(CallToolRequestSchema, (request, extra) => {
    if (!readTools().some(tool => tool.name === request.params.name)) {
      // Never echo a supplied name or arguments (which may contain secrets).
      throw new McpError(ErrorCode.MethodNotFound, 'Tool is not available.');
    }
    return tools.call(request.params.name, request.params.arguments, extra.signal);
  });
  return server;
}

/** Explicit stdio startup; the caller owns the returned server and may close it. */
export async function startStdioServer(options: McpServerOptions = {}): Promise<Server> {
  const server = await createMcpServer(options);
  const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
  const transport = new StdioServerTransport();
  const close = (): void => { void server.close().catch(() => { process.exitCode = 1; }); };
  const cleanup = (): void => {
    process.stdin.off('end', close);
    process.off('SIGINT', close);
    process.off('SIGTERM', close);
  };
  const onclose = server.onclose;
  server.onclose = () => { onclose?.(); cleanup(); };
  server.onerror = () => { process.stderr.write('MCP protocol error.\n'); };
  process.stdin.once('end', close);
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
  try {
    await server.connect(transport);
    return server;
  } catch {
    cleanup();
    await transport.close();
    throw new Error('MCP stdio startup failed.');
  }
}

// Importing this module (including through index.ts) never starts the server.
const isDirectExecution = process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isDirectExecution) {
  void startStdioServer().catch(() => {
    process.stderr.write('MCP stdio startup failed.\n');
    process.exitCode = 1;
  });
}
