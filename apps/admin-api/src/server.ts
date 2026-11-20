import Fastify from 'fastify';
import {
  createMetadataPool, createMetadataQueryExecutor, createMetadataReadinessCheck, type MetadataDbConfig,
} from '@mysql-mcp/core-engine';

export function createServer(config?: MetadataDbConfig) {
  const app = Fastify({ logger: false });
  const pool = config && createMetadataPool(config);
  const check = pool && createMetadataReadinessCheck(createMetadataQueryExecutor(pool));
  let draining = false;
  app.addHook('preClose', async () => { draining = true; });
  if (pool) app.addHook('onClose', async () => pool.close());
  app.get('/health/live', async (_request, reply) => reply.header('cache-control', 'no-store').send({ status: 'ok' }));
  app.get('/health/ready', async (_request, reply) => {
    const ready = !draining && (await check?.()) === true && !draining;
    return reply.header('cache-control', 'no-store').code(ready ? 200 : 503)
      .send({ status: ready ? 'ready' : 'not_ready' });
  });
  return app;
}
