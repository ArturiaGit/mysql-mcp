import { readFileSync, readdirSync } from 'node:fs';

const milestoneIds = Array.from({ length: 8 }, (_, index) => `M${index}`);

function readMilestoneStatuses(section, pattern, label, errors) {
  const statuses = new Map();
  for (const match of section.matchAll(pattern)) {
    const { id, status } = match.groups;
    if (statuses.has(id)) errors.push(`${label}: duplicate ${id}`);
    statuses.set(id, status);
  }
  for (const id of milestoneIds) {
    if (!statuses.has(id)) errors.push(`${label}: missing valid ${id} status`);
  }
  return statuses;
}

export function checkMilestoneProgress(todo, readme) {
  const errors = [];
  const todoTable = todo.split(/^## 模块总览与文件路由表\s*$/m)[1]?.split(/^## /m)[0] ?? '';
  const roadmap = readme.split(/^## 路线图 \(Roadmap\)\s*$/m)[1]?.split(/^## /m)[0] ?? '';
  const todoStatuses = readMilestoneStatuses(todoTable,
    /^\|[ \t]*\*\*(?<id>M[0-7])\*\*[ \t]*\|[^\r\n]*\|[ \t]*`\[(?<status>[x ])\]`[ \t]*\|[ \t]*\r?$/gm,
    'TODO.md milestone table', errors);
  const readmeStatuses = readMilestoneStatuses(roadmap,
    /^- \[(?<status>[x ])\] \*\*(?<id>M[0-7])\*\*/gm, 'README.md Roadmap', errors);

  for (const id of milestoneIds) {
    const expected = todoStatuses.get(id);
    const actual = readmeStatuses.get(id);
    if (expected !== undefined && actual !== undefined && expected !== actual) {
      errors.push(`README.md Roadmap ${id}: expected [${expected}] from TODO.md, found [${actual}]`);
    }
  }

  const badgeUrls = [...readme.split(/^## /m, 1)[0].matchAll(/!\[[^\]\r\n]*\]\((https:\/\/img\.shields\.io\/badge\/[^\s)]+)\)/g)]
    .map(([, url]) => url);
  if (badgeUrls.some((url) => url.includes('--m0'))) {
    errors.push('README.md badges: remove the obsolete --m0 marker');
  }
  const milestoneBadges = badgeUrls.filter((url) => url.startsWith('https://img.shields.io/badge/milestone-'));
  const latest = milestoneIds.findLast((id) => todoStatuses.get(id) === 'x');
  if (latest && (milestoneBadges.length !== 1 ||
      !milestoneBadges[0].startsWith(`https://img.shields.io/badge/milestone-${latest}%20Done-`))) {
    errors.push(`README.md badges: expected exactly one milestone badge for ${latest} Done from TODO.md`);
  } else if (!latest && milestoneBadges.length > 0) {
    errors.push('README.md badges: TODO.md has no completed milestone');
  }
  return errors;
}

if (import.meta.main) {
  const root = new URL('../../', import.meta.url);
  const read = (p) => readFileSync(new URL(p, root), 'utf8');
  const json = (p) => JSON.parse(read(p));
  const packages = ['apps', 'packages'].flatMap((group) =>
    readdirSync(new URL(`${group}/`, root), { withFileTypes: true }).filter((entry) => entry.isDirectory())
      .map(({ name }) => ({ group, name, manifest: json(`${group}/${name}/package.json`) })));
  const byName = new Map(packages.map((entry) => [entry.manifest.name, entry]));
  const rootManifest = json('package.json');
  const versions = { mysql2: '3.24.6', fastify: '5.12.8', 'node-sql-parser': '5.4.0', '@node-rs/argon2': '2.0.2', ssh2: '1.16.0', typescript: '5.9.3' };
  const errors = checkMilestoneProgress(read('TODO.md'), read('README.md'));
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
}
