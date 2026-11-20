import { readFileSync, readdirSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const json = (p) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));
const packages = ['apps', 'packages'].flatMap((group) =>
  readdirSync(new URL(`${group}/`, root), { withFileTypes: true }).filter((entry) => entry.isDirectory())
    .map(({ name }) => ({ group, name, manifest: json(`${group}/${name}/package.json`) })));
const byName = new Map(packages.map((entry) => [entry.manifest.name, entry]));
const rootManifest = json('package.json');
const versions = { mysql2: '3.24.6', fastify: '5.12.8', 'node-sql-parser': '5.4.0', '@node-rs/argon2': '2.0.2', ssh2: '1.16.0', typescript: '5.9.3' };
const errors = [];
const dependencyFields = ['dependencies', 'peerDependencies', 'optionalDependencies', 'devDependencies'];
for (const [name, version] of Object.entries(versions)) {
  if ((rootManifest.dependencies[name] ?? rootManifest.devDependencies[name]) !== version) errors.push(`Root must pin ${name}@${version}`);
}
for (const entry of packages) {
  const { group, name, manifest } = entry;
  for (const field of dependencyFields) {
    for (const [dep, value] of Object.entries(manifest[field] ?? {})) {
      const internal = byName.get(dep);
      if (Object.hasOwn(versions, dep) && versions[dep] !== value) errors.push(`${name} must pin ${dep}@${versions[dep]}`);
      if (internal && value !== 'workspace:*') errors.push(`${name}: ${dep} must use workspace:*`);
      if (internal?.group === 'apps' && group === 'packages') errors.push(`${name} cannot depend on ${dep}`);
      if (name === 'admin-ui' && internal && internal.name !== 'shared-types') errors.push(`${name} cannot depend on ${dep}`);
      if (name === 'shared-types') errors.push(`${name} cannot declare ${field}: ${dep}`);
    }
  }
  if (name === 'shared-types') {
    const output = json('packages/shared-types/tsconfig.json').compilerOptions;
    if (output.emitDeclarationOnly !== true || manifest.main || manifest.module || manifest.browser || manifest.bin ||
        JSON.stringify(manifest.exports) !== JSON.stringify({ '.': { types: './dist/index.d.ts' } })) {
      errors.push('shared-types must export declarations only');
    }
  }
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Workspace policy PASS (${packages.length} packages)`);
}
