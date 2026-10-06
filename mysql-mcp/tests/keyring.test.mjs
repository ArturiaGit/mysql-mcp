import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { inspect } from 'node:util';
import { WindowsKeyringProvider } from '../dist/security/keyring.js';

// Test-only interface implementation. It is never exported to production or
// automatically selected by WindowsKeyringProvider.
class InMemoryCredentialProvider {
  #key = randomBytes(32);
  #entries = new Map();

  async getCredential(ref) {
    const entry = this.#entries.get(ref);
    if (!entry) return null;
    const decipher = createDecipheriv('aes-256-gcm', this.#key, entry.iv);
    decipher.setAuthTag(entry.tag);
    return Buffer.concat([decipher.update(entry.data), decipher.final()]).toString('utf8');
  }

  async setCredential(ref, secret) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.#key, iv);
    const data = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    this.#entries.set(ref, { iv, data, tag: cipher.getAuthTag() });
  }

  async deleteCredential(ref) {
    this.#entries.delete(ref);
  }
}

function safeEqual(actual, expected) {
  // A failing test must not print a secret via an assertion diff.
  assert.ok(actual === expected, 'credential value matches expected synthetic fixture');
}

async function exerciseProvider(provider) {
  const ref = `test_${randomUUID()}`;
  const other = `test_${randomUUID()}`;
  const first = randomBytes(24).toString('base64url');
  const replacement = randomBytes(24).toString('base64url');
  try {
    safeEqual(await provider.getCredential(ref), null);
    await provider.setCredential(ref, first);
    await provider.setCredential(other, replacement);
    safeEqual(await provider.getCredential(ref), first);
    await provider.setCredential(ref, replacement);
    safeEqual(await provider.getCredential(ref), replacement);
    await provider.deleteCredential(ref);
    safeEqual(await provider.getCredential(ref), null);
    safeEqual(await provider.getCredential(other), replacement);
    await provider.deleteCredential(ref); // Absent deletion is idempotent.
  } finally {
    await provider.deleteCredential(ref);
    await provider.deleteCredential(other);
  }
}

function childEnvironment() {
  return Object.fromEntries(Object.entries(process.env).filter(([key, value]) =>
    value !== undefined && /^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|HOME|USERPROFILE)$/i.test(key)));
}

// Static code, no passwords in argv/environment; the synthetic fixture is stdin.
const rereadScript = `
let input = '';
for await (const chunk of process.stdin) input += chunk;
try {
  const { moduleUrl, ref, expected } = JSON.parse(input);
  const { WindowsKeyringProvider } = await import(moduleUrl);
  const actual = await new WindowsKeyringProvider().getCredential(ref);
  process.exitCode = actual === expected ? 0 : 1;
} catch {
  process.stderr.write('Credential persistence probe failed.');
  process.exitCode = 1;
}
`;

function rereadInFreshProcess(ref, expected) {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', rereadScript], {
    input: JSON.stringify({
      moduleUrl: new URL('../dist/security/keyring.js', import.meta.url).href, ref, expected
    }),
    encoding: 'utf8', env: childEnvironment(), shell: false, windowsHide: true,
    timeout: 15000, maxBuffer: 65536
  });
  assert.ok(!result.error && result.status === 0, 'fresh-process credential reread succeeds');
  assert.ok(result.stdout === '' && result.stderr === '', 'persistence probe emits no secrets or noise');
}

test('explicit encrypted in-memory interface: isolated save/read/replace/delete', async () => {
  await exerciseProvider(new InMemoryCredentialProvider());
  const left = new InMemoryCredentialProvider();
  const right = new InMemoryCredentialProvider();
  await left.setCredential('isolated', 'synthetic-only');
  safeEqual(await right.getCredential('isolated'), null);
  await left.deleteCredential('isolated');
});

test('runtime validation rejects malformed refs and secrets before loading native code', async () => {
  let loads = 0;
  const provider = new WindowsKeyringProvider(async () => { loads++; throw new Error('must not load'); });
  for (const ref of [null, undefined, 1, {}, '', '../conn', 'mysql-mcp:conn', 'conn\0', 'conn\n', 'conn\r', 'a'.repeat(129)]) {
    for (const operation of [
      () => provider.getCredential(ref), () => provider.setCredential(ref, 'synthetic-only'),
      () => provider.deleteCredential(ref)
    ]) {
      await assert.rejects(operation, error => error.code === 'INVALID_ARGUMENT' && !('cause' in error));
    }
  }
  for (const secret of [null, undefined, 1, {}, '', 'x\0y', '\ud800', 'x'.repeat(1025)]) {
    await assert.rejects(() => provider.setPassword('valid_ref', secret),
      error => error.code === 'INVALID_ARGUMENT' && !('cause' in error));
  }
  assert.equal(loads, 0);
});

test('provider construction is lazy and error objects never retain raw causes or paths', async () => {
  let loads = 0;
  const marker = 'SYNTHETIC_SECRET_MARKER';
  const raw = new Error(`${marker} at D:\\private\\native.node`);
  const provider = new WindowsKeyringProvider(async () => { loads++; throw raw; });
  assert.equal(loads, 0);
  for (const operation of [
    () => provider.getPassword('valid_ref'),
    () => provider.setPassword('valid_ref', 'synthetic-only'),
    () => provider.deletePassword('valid_ref')
  ]) {
    await assert.rejects(operation, error => {
      assert.equal(error.code, 'CREDENTIAL_STORE_UNAVAILABLE');
      assert.ok(!('cause' in error));
      const rendered = `${error.message}\n${error.stack}\n${inspect(error)}\n${JSON.stringify(error)}`;
      assert.ok(!rendered.includes(marker) && !rendered.includes('D:\\private'));
      return true;
    });
  }
  assert.equal(loads, process.platform === 'win32' ? 3 : 0);
});

if (process.platform === 'win32') {
  test('Windows native adapter namespaces entries and sanitizes every native failure', async () => {
    const store = new InMemoryCredentialProvider();
    const seen = [];
    class Entry {
      constructor(service, username) {
        seen.push([service, username]);
        this.ref = service;
      }
      async getPassword() { return (await store.getCredential(this.ref)) ?? undefined; }
      async setPassword(secret) { await store.setCredential(this.ref, secret); }
      async deletePassword() { await store.deleteCredential(this.ref); return true; }
    }
    const provider = new WindowsKeyringProvider(async () => ({ AsyncEntry: Entry }));
    await exerciseProvider(provider);
    assert.ok(seen.every(([service, username]) => service.startsWith('mysql-mcp:test_') && username === 'mysql-mcp'));
    for (const failure of ['constructor', 'getPassword', 'setPassword', 'deletePassword']) {
      const fail = () => { throw new Error('SYNTHETIC_SECRET_MARKER /private/native.node'); };
      class BrokenEntry {
        constructor() { if (failure === 'constructor') fail(); }
        async getPassword() { return failure === 'getPassword' ? fail() : undefined; }
        async setPassword() { if (failure === 'setPassword') fail(); }
        async deletePassword() { if (failure === 'deletePassword') fail(); return false; }
      }
      const broken = new WindowsKeyringProvider(async () => ({ AsyncEntry: BrokenEntry }));
      const operation = failure === 'setPassword' ? () => broken.setCredential('valid_ref', 'synthetic-only') :
        failure === 'deletePassword' ? () => broken.deleteCredential('valid_ref') : () => broken.getCredential('valid_ref');
      await assert.rejects(operation, error => error.code === 'CREDENTIAL_STORE_UNAVAILABLE' &&
        !('cause' in error) && !inspect(error).includes('SYNTHETIC_SECRET_MARKER') && !inspect(error).includes('/private'));
    }
  });

  test('REAL Windows Credential Manager CRUD and fresh Node process persistence', { timeout: 45000 }, async () => {
    const provider = new WindowsKeyringProvider();
    const ref = `test_${randomUUID()}`;
    const first = randomBytes(24).toString('base64url');
    const replacement = randomBytes(24).toString('base64url');
    try {
      safeEqual(await provider.getCredential(ref), null);
      await provider.setPassword(ref, first);
      safeEqual(await provider.getPassword(ref), first);
      rereadInFreshProcess(ref, first);
      await provider.setCredential(ref, replacement);
      safeEqual(await provider.getCredential(ref), replacement);
      rereadInFreshProcess(ref, replacement);
      await provider.deletePassword(ref);
      safeEqual(await provider.getCredential(ref), null);
      rereadInFreshProcess(ref, null);
      await provider.deleteCredential(ref);
    } finally {
      await provider.deleteCredential(ref);
    }
  });
} else {
  test('non-Windows explicitly injected memory provider is NOT a native persistence claim', async () => {
    await exerciseProvider(new InMemoryCredentialProvider());
    let loads = 0;
    const windows = new WindowsKeyringProvider(async () => { loads++; throw new Error('must not load'); });
    await assert.rejects(() => windows.getCredential('valid_ref'), { code: 'CREDENTIAL_STORE_UNAVAILABLE' });
    assert.equal(loads, 0);
  });
}
