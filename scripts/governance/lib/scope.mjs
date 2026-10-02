import { git } from './core.mjs';

export function registryAt(root, ref, key) {
  const raw = git(root, ['show', `${ref}:governance/${key}.json`], true);
  return raw ? JSON.parse(raw)[key] : [];
}
const fail = message => { throw new Error(message); };
export function trustedBase(root, task, { base, head } = {}) {
  const tip = head || 'HEAD';
  git(root, ['cat-file', '-e', `${tip}^{commit}`]);
  git(root, ['cat-file', '-e', `${task.base_commit}^{commit}`]);
  if (!git(root, ['merge-base', task.base_commit, tip], true) || git(root, ['merge-base', task.base_commit, tip]) !== task.base_commit) fail('task base is not an ancestor of validated commit');
  if (base && head) {
    if (git(root, ['merge-base', base, head]) !== base) fail('CI base is not an ancestor of head');
    return base;
  }
  const remote = git(root, ['rev-parse', '--verify', 'refs/remotes/origin/main^{commit}'], true);
  const prior = registryAt(root, 'HEAD', 'tasks').find(t => t.id === task.id);
  // Local mutable JSON never chooses the comparison boundary. A recorded task base is immutable;
  // rebasing/re-authorizing it requires a separately reviewed task rather than silently advancing it.
  if (prior && prior.base_commit !== task.base_commit) fail('unauthorized task base advancement/change');
  const anchor = remote || prior?.base_commit || git(root, ['rev-parse', 'HEAD']);
  if (remote && git(root, ['merge-base', task.base_commit, remote]) !== task.base_commit) fail('task base advances beyond verified origin/main');
  if (git(root, ['merge-base', anchor, tip]) !== anchor) fail('trusted baseline is not an ancestor; update branch before validation');
  if (base && base !== anchor) fail('local --base cannot override trusted baseline');
  return anchor;
}
export function selectMainTask(root, base, head) {
  const tasks = registryAt(root, head, 'tasks'), previous = registryAt(root, base, 'tasks');
  const features = registryAt(root, head, 'features'), oldFeatures = registryAt(root, base, 'features');
  const paths = git(root, ['diff', '--name-only', '-z', '--no-renames', base, head]).split('\0').filter(Boolean);
  const changedFeatures = features.filter(f => {
    const old = oldFeatures.find(o => o.id === f.id);
    return old && JSON.stringify(old) !== JSON.stringify(f);
  }).map(f => f.id);
  const candidates = tasks.filter(t => ['in_progress','completed'].includes(t.status) && paths.every(n => t.allowed_paths.some(p => n === p || (p.endsWith('/') && n.startsWith(p)))));
  const changedTasks = tasks.filter(t => {
    const old = previous.find(o => o.id === t.id);
    return !old || JSON.stringify(old) !== JSON.stringify(t);
  });
  // Only a changed candidate can identify the merged task. Historical non-candidates
  // may receive PR metadata, but cannot acquire new authorization through that exception.
  if (changedTasks.length) {
    const changedCandidates = changedTasks.filter(t => candidates.some(c => c.id === t.id));
    if (changedCandidates.length !== 1) fail('main delta must identify exactly one associated task; ambiguous/multi-task merge requires explicit split review');
    for (const task of changedTasks.filter(t => !candidates.some(c => c.id === t.id))) {
      const old = previous.find(t => t.id === task.id);
      const { pr, ...definition } = task;
      const { pr: oldPr, ...oldDefinition } = old || {};
      if (!old || JSON.stringify(definition) !== JSON.stringify(oldDefinition)) fail(`main non-candidate task ${task.id} may only change existing PR metadata`);
    }
    return changedCandidates[0];
  }
  const associated = candidates.filter(t => changedFeatures.some(id => t.feature_ids.includes(id)) || paths.some(n => features.some(f => t.feature_ids.includes(f.id) && [...f.implementation_paths,...f.test_paths].some(p => n === p || (p.endsWith('/') && n.startsWith(p))))));
  if (associated.length !== 1) fail('main delta must identify exactly one associated task; ambiguous/multi-task merge requires explicit split review');
  return associated[0];
}
