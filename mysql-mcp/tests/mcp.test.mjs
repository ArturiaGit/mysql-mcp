import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { createMcpServer, startStdioServer } from '../dist/mcp/server.js';

const serverPath = fileURLToPath(new URL('../dist/mcp/server.js', import.meta.url));
const root = fileURLToPath(new URL('../', import.meta.url));

function childEnvironment() {
  return Object.fromEntries(Object.entries(process.env).filter(([key, value]) =>
    value !== undefined && /^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|HOME|USERPROFILE)$/i.test(key)));
}

async function bounded(promise, timeout = 10000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Protocol test timed out.')), timeout); })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

async function waitForExit(pid) {
  const end = Date.now() + 3000;
  while (isAlive(pid) && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(!isAlive(pid), 'stdio child has exited without a residual process');
}

// SDK 1.32.0 has no public stdout accessor. Observe the actual SDK child stream
// only in tests, without replacing its framing/parser or production transport.
class ObservedStdioTransport extends StdioClientTransport {
  stdout = '';
  child;
  async start() {
    await super.start();
    this.child = this._process;
    assert.ok(this.child?.stdout, 'SDK child stdout is available for protocol-only observation');
    this.child.stdout.on('data', chunk => { this.stdout += chunk.toString('utf8'); });
  }
}

test('direct imports are inert: no native load, listener, stdout, or stdin consumption', { timeout: 15000 }, () => {
  const script = `
import { Server as NetServer } from 'node:net';
process.dlopen = () => { throw new Error('Unexpected native load.'); };
NetServer.prototype.listen = () => { throw new Error('Unexpected listener.'); };
const originalOn = process.stdin.on;
process.stdin.on = function(event, ...args) {
  if (event === 'data') throw new Error('Unexpected stdin consumption.');
  return originalOn.call(this, event, ...args);
};
await import('./dist/security/keyring.js');
await import('./dist/mcp/server.js');
await import('./dist/index.js');
`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: root, env: childEnvironment(), shell: false, windowsHide: true,
    encoding: 'utf8', timeout: 10000, maxBuffer: 65536
  });
  assert.ok(!result.error && result.status === 0, 'inert import probe exits successfully');
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
});

test('MCP factory is explicit, independent and does not connect a transport', async () => {
  assert.equal(typeof startStdioServer, 'function');
  const first = await createMcpServer();
  const second = await createMcpServer();
  try {
    assert.notEqual(first, second);
    assert.equal(first.transport, undefined);
    assert.equal(second.transport, undefined);
  } finally {
    await first.close();
    await second.close();
  }
});

test('REAL SDK stdio: initialize, ping, seven tools, safe refusal, clean stdout and shutdown', { timeout: 25000 }, async () => {
  const transport = new ObservedStdioTransport({
    command: process.execPath, args: [serverPath], cwd: root,
    env: childEnvironment(), stderr: 'pipe'
  });
  let stderr = '';
  transport.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });
  const client = new Client({ name: 'mysql-mcp-prototype-test', version: '1.0.0' }, { capabilities: {} });
  const errors = [];
  client.onerror = error => errors.push(error);
  let pid;
  try {
    await bounded(client.connect(transport)); // Real initialize/initialized handshake.
    pid = transport.pid;
    assert.ok(Number.isInteger(pid));
    assert.deepEqual(client.getServerVersion(), { name: 'mysql-mcp', version: '0.1.0-alpha.0' });
    assert.deepEqual(client.getServerCapabilities(), { tools: {} });
    assert.deepEqual(await bounded(client.ping()), {});
    const listed = await bounded(client.listTools());
    assert.deepEqual(listed.tools.map(tool => tool.name), ['list_connections', 'list_databases', 'list_tables', 'describe_table', 'query', 'request_change', 'get_change_status']);
    for (const tool of listed.tools) assert.equal(tool.inputSchema.additionalProperties, false);
    const invalid = await bounded(client.callTool({ name: 'query', arguments: { password: 'SYNTHETIC_SECRET_MARKER' } }));
    assert.equal(invalid.isError, true);
    assert.equal(JSON.parse(invalid.content[0].text).error.code, 'INVALID_ARGUMENT');
    const unavailable = await bounded(client.callTool({ name: 'list_connections', arguments: {} }));
    assert.equal(unavailable.isError, true);
    assert.equal(JSON.parse(unavailable.content[0].text).error.code, 'SERVICE_UNAVAILABLE');
    for (const name of ['approve_change', 'password', 'unknown_SYNTHETIC_SECRET_MARKER']) {
      await assert.rejects(() => bounded(client.callTool({ name, arguments: {} })), error => {
        assert.ok(error instanceof McpError);
        assert.equal(error.code, ErrorCode.MethodNotFound);
        assert.ok(!error.message.includes(name));
        assert.ok(error.message.includes('Tool is not available.'));
        return true;
      });
    }
    assert.equal(errors.length, 0, 'SDK parser encounters no non-protocol stdout');
  } finally {
    pid ??= transport.pid;
    try {
      await bounded(client.close(), 6000);
    } finally {
      try {
        await bounded(transport.close(), 6000);
        if (pid) await waitForExit(pid);
      } finally {
        // Even an assertion/timeout failure must not leave our test child alive.
        if (pid && isAlive(pid)) {
          transport.child?.kill('SIGKILL');
          await waitForExit(pid);
        }
      }
    }
  }
  assert.equal(stderr, '');
  const lines = transport.stdout.trim().split('\n');
  assert.ok(lines.length >= 7, 'all expected JSON-RPC responses were observed');
  for (const line of lines) {
    const message = JSON.parse(line);
    assert.equal(message.jsonrpc, '2.0');
    assert.ok('result' in message || 'error' in message || 'method' in message);
  }
  assert.ok(!transport.stdout.includes('SYNTHETIC_SECRET_MARKER'));
  // EOF shutdown was graceful; SDK did not need to terminate/kill the server.
  assert.equal(transport.child.exitCode, 0);
  assert.equal(transport.child.signalCode, null);
});
test('malformed stdio input logs only a fixed diagnostic on stderr', () => {
  const result = spawnSync(process.execPath, [serverPath], {
    cwd: root, env: childEnvironment(), shell: false, windowsHide: true,
    input: '{invalid SYNTHETIC_SECRET_MARKER}\n', encoding: 'utf8', timeout: 10000, maxBuffer: 65536
  });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'MCP protocol error.\n');
});
test('raw stdio oversized request ID is not echoed or dispatched', () => {
  const id = 'x'.repeat(1_048_576);
  const result = spawnSync(process.execPath, [serverPath], {
    cwd: root, env: childEnvironment(), shell: false, windowsHide: true,
    input: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'list_connections', arguments: {} } }) + '\n',
    encoding: 'utf8', timeout: 10000, maxBuffer: 65536
  });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'MCP protocol error.\n');
});
