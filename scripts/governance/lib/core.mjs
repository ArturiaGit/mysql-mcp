import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

export const hash = value => crypto.createHash('sha256').update(value).digest('hex');
export function git(root, args, optional = false) {
  const r = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (r.status !== 0 && !optional) throw new Error(`git ${args[0]} failed: ${r.stderr}`);
  return r.status === 0 ? r.stdout.trimEnd() : '';
}
export const files = root => git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']).split('\0').filter(Boolean);
export function safePath(p) {
  return typeof p === 'string' && p.length > 0 && !p.includes('\\') && !p.includes('\0') && !path.posix.isAbsolute(p) && !/^[A-Za-z]:/.test(p) && !p.split('/').some(s => s === '..' || s === '.' || s === '.git') && !p.includes('//');
}
export function inputHash(root, names = files(root)) {
  return hash([...new Set(names)].filter(p => !p.startsWith('.governance-evidence/')).sort().map(p => {
    if (!safePath(p)) throw new Error(`unsafe path: ${p}`);
    const full = path.join(root, p);
    if (!fs.existsSync(full)) return `${p}\0DELETED`;
    if (!fs.lstatSync(full).isFile()) throw new Error(`non-regular input: ${p}`);
    return `${p}\0${hash(fs.readFileSync(full))}`;
  }).join('\n'));
}
export function snapshot(root, tree) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'governance-'));
  try {
    const names = tree ? git(root, ['ls-tree', '-r', '--name-only', '-z', tree]).split('\0').filter(Boolean) : files(root);
    for (const p of new Set(names)) {
      if (!safePath(p)) throw new Error(`unsafe snapshot path: ${p}`);
      if (p.startsWith('.governance-evidence/')) continue;
      let data;
      if (tree) {
        const mode = git(root, ['ls-tree', tree, '--', p]).split(' ')[0];
        if (!['100644', '100755'].includes(mode)) throw new Error(`non-regular tracked input: ${p}`);
        const r = spawnSync('git', ['-C', root, 'show', `${tree}:${p}`], { maxBuffer: 32 * 1024 * 1024 });
        if (r.status !== 0) throw new Error(`cannot export ${p}`);
        data = r.stdout;
      } else {
        if (!fs.existsSync(path.join(root, p))) continue;
        if (!fs.lstatSync(path.join(root, p)).isFile()) throw new Error(`non-regular input: ${p}`);
        data = fs.readFileSync(path.join(root, p));
      }
      fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true });
      fs.writeFileSync(path.join(dir, p), data);
    }
    return { dir, env: { ...process.env, GIT_DIR: git(root, ['rev-parse', '--absolute-git-dir']), GIT_WORK_TREE: dir, GOV_SNAPSHOT: '1', GOV_TREE: tree || '' }, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
  } catch (e) { fs.rmSync(dir, { recursive: true, force: true }); throw e; }
}
export function load(root) {
  const result = {};
  for (const key of ['features', 'tasks', 'checks']) {
    const data = JSON.parse(fs.readFileSync(path.join(root, `governance/${key}.json`), 'utf8'));
    if (data.schema_version !== 1 || !Array.isArray(data[key])) throw new Error(`invalid ${key} schema`);
    result[key] = data[key];
  }
  return result;
}
export function requirements(text) { return [...new Set([...text.matchAll(/^\|\s*(R\d+)\s*\|/gm)].map(m => m[1]))]; }
export function statusMarkdown(data) {
  const escape = s => String(s).replaceAll('|', '\\|').replace(/[\r\n]/g, ' ');
  return '# 功能状态（自动生成）\n\n由 `node scripts/governance/report.mjs --write` 生成。实现状态为登记声明，不等于验证或验收。\n本地运行只提供诊断；独立 CI / 人工 / 实机证据尚未认证，不推导完成或合并。\n\n| 功能 | 标题 | 实现（声明） | 验证 | 验收 | 交付 |\n|---|---|---|---|---|---|\n' + [...data.features].sort((a,b) => a.id.localeCompare(b.id, 'en')).map(f => `| ${escape(f.id)} | ${escape(f.title)} | ${escape(f.implementation)} | 未认证 | 未验收 | 未核实 |`).join('\n') + '\n';
}
export function main(fn) { try { fn(); } catch (e) { console.error(`governance: ${e.message}`); process.exitCode = 1; } }
