import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { APP_NAME, APP_VERSION, createApplication } from 'mysql-mcp';

const readJson = async name => JSON.parse(await readFile(new URL(`../${name}`, import.meta.url), 'utf8'));
const pkg = await readJson('package.json');
const lock = await readJson('package-lock.json');
const config = await readJson('tsconfig.json');

test('built ESM entry matches package metadata and creates an inert application', () => {
  assert.equal(APP_NAME, pkg.name);
  assert.equal(APP_VERSION, pkg.version);
  assert.equal(pkg.type, 'module');
  assert.deepEqual(createApplication(), { name: APP_NAME, version: APP_VERSION });
});

test('lockfile matches all exact direct dependency versions', () => {
  assert.equal(lock.lockfileVersion, 3);
  assert.equal(lock.name, pkg.name);
  assert.equal(lock.version, pkg.version);
  for (const group of ['dependencies', 'devDependencies']) {
    assert.deepEqual(lock.packages[''][group], pkg[group]);
    for (const [name, version] of Object.entries(pkg[group])) {
      assert.match(version, /^\d+\.\d+\.\d+$/);
      assert.equal(lock.packages[`node_modules/${name}`].version, version);
    }
  }
});

test('strict NodeNext compilation cannot silently disable type safety', () => {
  assert.equal(config.compilerOptions.target, 'ES2022');
  assert.equal(config.compilerOptions.module, 'NodeNext');
  assert.equal(config.compilerOptions.moduleResolution, 'NodeNext');
  for (const option of [
    'strict', 'noImplicitAny', 'strictNullChecks', 'strictFunctionTypes',
    'strictBindCallApply', 'strictPropertyInitialization', 'noImplicitThis',
    'alwaysStrict', 'noUnusedLocals', 'noUnusedParameters', 'noImplicitReturns',
    'noFallthroughCasesInSwitch', 'noUncheckedIndexedAccess', 'noEmitOnError',
    'forceConsistentCasingInFileNames', 'declaration', 'declarationMap', 'sourceMap'
  ]) assert.equal(config.compilerOptions[option], true, option);
});

test('application metadata rejects mutation', () => {
  const app = createApplication();
  assert.ok(Object.isFrozen(app));
  assert.throws(() => { app.version = 'modified'; }, TypeError);
  assert.throws(() => { app.name = 'modified'; }, TypeError);
  assert.deepEqual(app, { name: APP_NAME, version: APP_VERSION });
});

test('application descriptor rejects unplanned runtime state', () => {
  const app = createApplication();
  assert.throws(() => { app.connection = {}; }, TypeError);
  assert.throws(() => { delete app.name; }, TypeError);
  assert.deepEqual(Object.keys(app).sort(), ['name', 'version']);
});

test('instances cannot share mutable application state', () => {
  const first = createApplication();
  const second = createApplication();
  assert.notEqual(first, second);
  assert.throws(() => Object.assign(first, { database: 'unplanned' }), TypeError);
  assert.deepEqual(second, { name: APP_NAME, version: APP_VERSION });
});
