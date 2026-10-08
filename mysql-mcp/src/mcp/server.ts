import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ReadToolService, readTools, type ReadConnections } from './tools.js';
import type { ReadSessionFactory } from '../sql/driver.js';
import { BudgetTransport } from './transport.js';
import { ChangeToolService, changeTools } from './change-tools.js';
import type { ChangeManager } from '../changes/manager.js';
import { nativeEligible, probeNative, type NativeApprovalOptions } from './native.js';

export interface McpServerOptions {
  connections?: ReadConnections; sessionFactory?: ReadSessionFactory; timeoutMs?: number;
  changes?: ChangeManager; nativeApproval?: NativeApprovalOptions;
}

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
  const changes = new ChangeToolService(options.changes);
  const probe = new AbortController();
  let nativeIdentity: string | undefined;
  const identity = (): string => JSON.stringify({ client: server.getClientVersion(), capabilities: server.getClientCapabilities(), mode: options.nativeApproval?.permissionMode });
  server.oninitialized = () => {
    const client = server.getClientVersion();
    if (!changes.session || !client || !server.getClientCapabilities()?.elicitation || !nativeEligible(client.name, client.version, options.nativeApproval)) return;
    const expected = identity();
    const timer = setTimeout(() => probe.abort(), 60_000);
    const elicit = (params: Parameters<typeof server.elicitInput>[0], signal: AbortSignal) =>
      server.elicitInput(params, { signal, timeout: 60_000 });
    void probeNative(elicit, probe.signal).then(verified => {
      if (verified && !probe.signal.aborted && identity() === expected) {
        nativeIdentity = expected;
        options.changes?.setNativeElicitor(changes.session!, (params, signal) => {
          if (identity() !== nativeIdentity) return Promise.reject(new Error('Native approval eligibility changed.'));
          return elicit(params, signal);
        });
      }
    }).catch(() => {}).finally(() => clearTimeout(timer));
  };
  const connect = server.connect.bind(server);
  server.connect = transport => connect(new BudgetTransport(transport));
  const shutdown = server.close.bind(server);
  server.close = async () => { probe.abort(); changes.close(); tools.close(); await shutdown(); };
  server.onclose = () => { probe.abort(); changes.close(); tools.close(); };
  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: [...readTools(), ...changeTools()] }));
  server.setRequestHandler(CallToolRequestSchema, (request, extra) => {
    if (![...readTools(), ...changeTools()].some(tool => tool.name === request.params.name)) {
      // Never echo a supplied name or arguments (which may contain secrets).
      throw new McpError(ErrorCode.MethodNotFound, 'Tool is not available.');
    }
    return changeTools().some(tool => tool.name === request.params.name)
      ? changes.call(request.params.name, request.params.arguments, extra.signal)
      : tools.call(request.params.name, request.params.arguments, extra.signal);
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
