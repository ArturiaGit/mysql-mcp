import { readMetadataConfig, readPort } from '@mysql-mcp/core-engine';
import { createServer } from './server.js';

async function main(): Promise<void> {
  const port = readPort(process.env.GATEWAY_PORT, 8080);
  const app = createServer(readMetadataConfig(process.env));
  try {
    const address = await app.listen({ host: process.env.GATEWAY_HOST ?? '127.0.0.1', port });
    console.log(`gateway listening on ${address}`);
  } catch (error) {
    await app.close();
    throw error;
  }
  const close = () => { void app.close().catch(() => { process.exitCode = 1; }); };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
}

void main().catch(() => {
  console.error('gateway failed to start');
  process.exitCode = 1;
});
