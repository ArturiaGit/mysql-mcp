import Fastify from 'fastify';
import { z } from 'zod';
import { createMetadataPool, createMetadataQueryExecutor, type MetadataDbConfig } from '@mysql-mcp/core-engine';
import { CryptoKeyring } from '@mysql-mcp/security';
import { AuthService } from './auth-service.js';
import { registerAuthRoutes } from './auth-routes.js';
import { BootstrapService } from './bootstrap-service.js';
import { ApiError, errorBody } from './errors.js';

const keyringConfig = z.object({ active_key_id: z.string(), keys: z.record(z.string(), z.string()) });

export function createServer(config?: MetadataDbConfig, env: NodeJS.ProcessEnv = process.env) {
  const proxies = env.TRUSTED_PROXY_CIDRS?.split(',').map(value => value.trim()).filter(Boolean);
  const app = Fastify({ logger: false, trustProxy: proxies?.length ? proxies : false });
  const pool = config && createMetadataPool(config);
  const secret = env.ADMIN_API_SECRET;
  let initialized = false;
  let draining = false;
  let bootstrap: BootstrapService | undefined;
  if (pool && secret && Buffer.byteLength(secret) >= 32) {
    const auth = new AuthService(pool, createMetadataQueryExecutor(pool), secret);
    app.addHook('onReady', async () => {
      try {
        const raw: unknown = JSON.parse(env.GATEWAY_MASTER_KEYS ?? 'null');
        const keys = keyringConfig.parse(raw);
        bootstrap = new BootstrapService(pool, new CryptoKeyring(keys.active_key_id, keys.keys));
        const password = env.BOOTSTRAP_ADMIN_PASSWORD ?? env.INITIAL_ADMIN_PASSWORD;
        await bootstrap.initialize(password ? {
          username: env.BOOTSTRAP_ADMIN_USERNAME ?? 'admin', password, email: env.BOOTSTRAP_ADMIN_EMAIL ?? null,
        } : undefined);
        initialized = true;
      } catch {
        // No raw driver errors, connection options, or bootstrap material enter logs.
        console.warn('admin-api metadata initialization failed; readiness remains closed');
      }
    });
    app.register(async (authRoutes) => {
      await registerAuthRoutes(authRoutes, { service: auth, secureCookies: env.NODE_ENV === 'production', ready: () => initialized && !draining });
    });
  }
  app.setErrorHandler((error, _request, reply) => {
    const status = error instanceof Error && 'statusCode' in error ? error.statusCode : undefined;
    const result = error instanceof ApiError ? error : typeof status === 'number' && status >= 400 && status < 500
      ? new ApiError(status, 'ERR_VALIDATION_FAILED') : new ApiError(500, 'ERR_INTERNAL_SERVER');
    const retry = result.details?.retry_after_sec;
    if (retry !== undefined) reply.header('retry-after', String(retry));
    return reply.code(result.statusCode).send(errorBody(result));
  });
  app.addHook('preClose', async () => { draining = true; });
  if (pool) app.addHook('onClose', async () => pool.close());
  app.get('/health/live', async (_request, reply) => reply.header('cache-control', 'no-store').send({ status: 'ok' }));
  app.get('/health/ready', async (_request, reply) => {
    const ready = initialized && !draining && await bootstrap?.isReady() === true && !draining;
    return reply.header('cache-control', 'no-store').code(ready ? 200 : 503)
      .send({ status: ready ? 'ready' : 'not_ready' });
  });
  return app;
}
