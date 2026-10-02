import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

export const hash = value => crypto.createHash('sha256').update(value).digest('hex');
export function snapshotContentHash(bytes, mode = '100644') {
  const text = bytes.toString('utf8');
  const normalized = !bytes.includes(0) && Buffer.from(text).equals(bytes) ? text.replaceAll('\r\n','\n') : bytes;
  return `${mode}:${hash(normalized)}`;
}
export function worktreeModes(root, names, refOverride) {
  const ref = refOverride || process.env.GOV_TREE;
  const rows = git(root,ref ? ['ls-tree','-r','-z',ref] : ['ls-files','--stage','-z']).split('\0').filter(Boolean);
  const indexed = new Map(rows.map(row => { const split = row.indexOf('\t'); return [row.slice(split+1),row.slice(0,split).split(' ')[0]]; }));
  const filemode = !ref && git(root,['config','--get','core.filemode'],true) === 'true' && process.platform !== 'win32';
  return Object.fromEntries(names.filter(n=>ref || fs.existsSync(path.join(root,n))).map(n=>[n,filemode ? ((fs.statSync(path.join(root,n)).mode & 0o111) ? '100755' : '100644') : indexed.get(n) || (n.startsWith('.githooks/') ? '100755' : '100644')]));
}
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
    const sourceModes = worktreeModes(root,names,tree);
    for (const p of new Set(names)) {
      if (!safePath(p)) throw new Error(`unsafe snapshot path: ${p}`);
      if (p.startsWith('.governance-evidence/')) continue;
      let data;
      if (tree) {
        const mode = sourceModes[p];
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
      const mode = sourceModes[p];
      fs.chmodSync(path.join(dir,p),mode === '100755' ? 0o755 : 0o644);
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
