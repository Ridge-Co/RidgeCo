// Oct 21 2026: the Branch policy guard now fails a PR into main that edits the BUILD_VERSION line (the #1 cause of PR conflicts).
// Runs the real .github/scripts/guard-check.sh against throwaway git repos.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import assert from 'node:assert';
const script = path.resolve(new URL('../.github/scripts/guard-check.sh', import.meta.url).pathname);
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const sh = (cwd, ...a) => execFileSync('git', a, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
function repo() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-')); sh(d, 'init', '-q', '-b', 'main');
  sh(d, 'config', 'user.email', 't@t'); sh(d, 'config', 'user.name', 't');
  fs.writeFileSync(path.join(d, 'worker.js'), "// x\nconst BUILD_VERSION = '2026-10-21.02-base';\nconsole.log(1);\n");
  sh(d, 'add', '.'); sh(d, 'commit', '-q', '-m', 'base');
  sh(d, 'update-ref', 'refs/remotes/origin/main', 'HEAD'); // the guard compares against origin/main
  sh(d, 'checkout', '-q', '-b', 'fix/x'); return d;
}
function run(d, body = '') {
  const r = spawnSync('bash', [script], { cwd: d, env: { ...process.env, BASE_REF: 'main', HEAD_REF: 'fix/x', PR_BODY: body }, encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}
let d = repo();
fs.appendFileSync(path.join(d, 'worker.js'), 'console.log(2);\n'); sh(d, 'commit', '-qam', 'real change');
let r = run(d); ok(r.code === 0, 'a PR that does not touch BUILD_VERSION passes: ' + r.out.slice(-120));
d = repo();
fs.writeFileSync(path.join(d, 'worker.js'), fs.readFileSync(path.join(d, 'worker.js'), 'utf8').replace('2026-10-21.02-base', '2026-10-21.03-mine')); sh(d, 'commit', '-qam', 'bump');
r = run(d); ok(r.code === 1 && /edits the BUILD_VERSION line/.test(r.out), 'a PR that bumps BUILD_VERSION fails with a clear message');
r = run(d, 'Deliberate base change.\nallow-build-version-edit: true\n'); ok(r.code === 0, 'the PR-body override lets a deliberate change through');
// main moving its own BUILD_VERSION must NOT make an untouched PR fail (three-dot diff = only the PR's own changes)
d = repo(); fs.appendFileSync(path.join(d, 'worker.js'), 'console.log(3);\n'); sh(d, 'commit', '-qam', 'pr change');
sh(d, 'checkout', '-q', 'main');
fs.writeFileSync(path.join(d, 'worker.js'), fs.readFileSync(path.join(d, 'worker.js'), 'utf8').replace('2026-10-21.02-base', '2026-10-21.09-other-session')); sh(d, 'commit', '-qam', 'main moved');
sh(d, 'update-ref', 'refs/remotes/origin/main', 'HEAD'); sh(d, 'checkout', '-q', 'fix/x');
r = run(d); ok(r.code === 0, "main changing BUILD_VERSION after the branch was cut does not fail the PR: " + r.out.slice(-120));
console.log('guard-check: ' + n + ' checks passed');
