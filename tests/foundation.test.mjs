import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer as createAdmin } from '../apps/admin-api/dist/server.js';
import { createServer as createGateway } from '../apps/gateway/dist/server.js';
import { createMetadataQueryExecutor, readMetadataConfig, readPort } from '../packages/core-engine/dist/index.js';

test('invalid or partial configuration is rejected and details are not logged', () => {
  assert.equal(readMetadataConfig({}), undefined);
  assert.throws(() => readMetadataConfig({ METADATA_DB_USER: 'local' }), /are both required/);
  assert.throws(() => readPort('65536', 8080), /Invalid port/);
  assert.throws(() => createMetadataQueryExecutor({ close: async () => {} }), /Expected a MetadataPool/);
});
for (const [name, create] of [['admin-api', createAdmin], ['gateway', createGateway]]) {
  test(`${name}: without database configuration only liveness passes`, async (t) => {
    const server = create();
    t.after(() => server.close());
    const live = await server.inject('/health/live');
    const ready = await server.inject('/health/ready');
    assert.equal(live.statusCode, 200);
    assert.deepEqual(live.json(), { status: 'ok' });
    assert.equal(ready.statusCode, 503);
    assert.equal(ready.headers['cache-control'], 'no-store');
    assert.deepEqual(ready.json(), { status: 'not_ready' });
  });
}
