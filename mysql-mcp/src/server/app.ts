import Fastify from 'fastify';
import { homedir } from 'node:os';
import path from 'node:path';
import { LocalAuth } from './auth.js';
import { ConnectionService, JsonMetadataStorage, type MetadataStorage, type ConnectionTester } from './connections.js';
import type { ICredentialProvider } from '../security/keyring.js';
import { ServerError, sanitizeError } from './errors.js';
import { registerRoutes } from './routes.js';
import { ChangeManager } from '../changes/manager.js';
import type { ChangeStorage } from '../changes/journal.js';
import type { WriteSessionFactory } from '../sql/write-driver.js';
import { registerChangeRoutes } from './changes.js';
import { createMcpServer, type McpServerOptions } from '../mcp/server.js';

export interface LocalServerOptions {
  port?: number;
  metadataFile?: string;
  storage?: MetadataStorage;
  credentials?: ICredentialProvider;
  tester?: ConnectionTester;
  testTimeoutMs?: number;
  now?: () => number;
  changeStorage?: ChangeStorage;
  changeFile?: string;
  writeSessionFactory?: WriteSessionFactory;
  changeTimeoutMs?: number;
  onLocalCode?: (code: string) => void;
}
function metadataFile(): string {
  const root = process.platform === 'win32' ? process.env['LOCALAPPDATA'] ?? homedir() : homedir();
  return path.join(root, 'mysql-mcp', 'connections.json');
}

// Factory is explicit and has no listener; importing the aggregate module is inert.
export async function createLocalServer(options: LocalServerOptions = {}) {
  let port = options.port ?? 3210;
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new ServerError('INVALID_ARGUMENT');
  const storage = options.storage ?? new JsonMetadataStorage(options.metadataFile ?? metadataFile());
  const connections = new ConnectionService(storage, options.credentials, options.tester, options.testTimeoutMs);
  try { await connections.initialize(); }
  catch (error) { await storage.close?.().catch(() => {}); throw error; }
  const changes = new ChangeManager({ connections,
    storage: options.changeStorage ?? new JsonMetadataStorage(options.changeFile ?? path.join(path.dirname(options.metadataFile ?? metadataFile()), 'changes.json')),
    sessionFactory: options.writeSessionFactory, timeoutMs: options.changeTimeoutMs, now: options.now,
    managementUrl: () => `http://127.0.0.1:${port}` });
  try { await changes.initialize(); }
  catch (error) { await changes.close().catch(() => {}); await connections.close(); throw error; }
  const auth = new LocalAuth(options.now);
  const app = Fastify({ logger: false, bodyLimit: 16 * 1024,
    requestTimeout: 10_000, connectionTimeout: 10_000, routerOptions: { maxParamLength: 128 }, trustProxy: false });
  app.addHook('onRequest', async (request, reply) => {
    reply.header('cache-control', 'no-store').header('x-content-type-options', 'nosniff')
      .header('referrer-policy', 'no-referrer');
    const host = request.headers.host;
    if (port === 0 || (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`)) throw new ServerError('FORBIDDEN');
    // Exact origin equality includes host and port; forwarded headers are ignored.
    const origin = request.headers.origin;
    if (origin !== undefined && origin !== `http://${host}`) throw new ServerError('FORBIDDEN');
    if (request.headers['sec-fetch-site'] === 'cross-site') throw new ServerError('FORBIDDEN');
    const login = request.method === 'POST' && request.url === '/api/v1/session';
    if (!login) {
      const mutate = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
      const csrf = request.headers['x-csrf-token'];
      auth.authenticate(request.headers.cookie, typeof csrf === 'string' ? csrf : undefined, mutate);
    }
  });
  app.setErrorHandler((error, _request, reply) => {
    const status = error && typeof error === 'object' && 'statusCode' in error ? error.statusCode : undefined;
    const safe = sanitizeError(error instanceof ServerError ? error :
      typeof status === 'number' && status >= 400 && status < 500 ? new ServerError('INVALID_ARGUMENT') : error);
    reply.code(safe.status).send(safe.body);
  });
  app.setNotFoundHandler(async () => { throw new ServerError('NOT_FOUND'); });
  app.addHook('onClose', async () => { auth.clear(); await changes.close(); await connections.close(); });
  registerRoutes(app, auth, connections);
  registerChangeRoutes(app, auth, changes);
  let started = false;
  return Object.freeze({
    inject: app.inject.bind(app),
    issueLocalCode: (): string => auth.issueLocalCode(),
    // Explicit same-process composition: both entrances share one approval authority.
    createMcpServer: (mcp: Omit<McpServerOptions, 'connections' | 'changes'> = {}) => createMcpServer({ ...mcp, connections, changes }),
    async start(): Promise<{ host: '127.0.0.1'; port: number }> {
      if (started) throw new ServerError('STATE_CONFLICT');
      // No caller-supplied listen options or raw Fastify instance escape this wrapper.
      await app.listen({ host: '127.0.0.1', port });
      started = true;
      const address = app.server.address();
      if (!address || typeof address === 'string') { await app.close(); throw new ServerError('SERVICE_UNAVAILABLE'); }
      port = address.port;
      try {
        const code = auth.issueLocalCode();
        (options.onLocalCode ?? (value => process.stderr.write(`Local login code (single use, 5 minutes): ${value}\n`)))(code);
      } catch { await app.close(); throw new ServerError('SERVICE_UNAVAILABLE'); }
      return { host: '127.0.0.1', port };
    },
    close: (): Promise<void> => app.close()
  });
}
