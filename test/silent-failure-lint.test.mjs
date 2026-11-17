// Silent-failure lint (Nov 17 2026): the CI gate from context/NO_SILENT_FAILURES_PROGRAM_v1.0.md section 7.
// 1) the detector on fixtures (what counts as swallowing, what is allowed), 2) the ratchet on a throwaway folder,
// 3) the real repo: no file has more silent handlers than scripts/silent-failure-baseline.json allows.
// Run: node test/silent-failure-lint.test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scan, run } from '../scripts/silent-failure-lint.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const t = (name, cond, extra) => { if (cond) pass++; else { fail++; console.log('FAIL:', name, extra === undefined ? '' : JSON.stringify(extra)); } };
const n = (src) => scan(src).findings.length;

// 1. detector ------------------------------------------------------------------------------------------------------
t('empty catch is flagged', n('try { a(); } catch (e) {}') === 1);
t('bare catch {} is flagged', n('try { a(); } catch {}') === 1);
t('comment-only catch is flagged', n('try { a(); } catch (e) { /* ignore */ }') === 1);
t('line-comment-only catch is flagged', n('try { a(); } catch (e) {\n  // fine\n}') === 1);
t('log-only catch is flagged', n("try { a(); } catch (e) { console.error('boom', e.message); }") === 1);
t('.catch(() => {}) is flagged', n('p.catch(() => {});') === 1);
t('.catch(() => null) is flagged', n('p.catch(() => null);') === 1);
t('.catch(_ => []) is flagged', n('p.catch(_ => []);') === 1);
t('.catch(function(){}) counts once', n('p.catch(function(){});') === 1);
t('a catch that reports is NOT flagged', n("try { a(); } catch (e) { await reportFailure(env, { where: 'x' }); }") === 0);
t('a catch that rethrows is NOT flagged', n('try { a(); } catch (e) { throw e; }') === 0);
t('a catch that logs AND returns an error is NOT flagged', n("try { a(); } catch (e) { console.error(e); return json({ error: 'x' }, 500); }") === 0);
t('.catch that reports is NOT flagged', n("p.catch(e => window.hubReportFailure('x', e));") === 0);
t('silent-ok with a real reason exempts it', n('try { localStorage.x = 1; } catch (e) {}   // silent-ok: storage blocked in private mode') === 0);
{ const r = scan('try { a(); } catch (e) {}   // silent-ok: fine');
  t('silent-ok with a short reason does not exempt and is reported', r.findings.length === 1 && r.badReasons.length === 1, r); }
t('two handlers on two lines count two', n('try{a()}catch(e){}\ntry{b()}catch(e){}') === 2);

// 2. ratchet on a throwaway folder -----------------------------------------------------------------------------------
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfl-'));
  const base = path.join(dir, 'baseline.json');
  fs.writeFileSync(path.join(dir, 'a.js'), 'try{a()}catch(e){}\n');
  t('update writes the baseline', run(dir, base, true).code === 0 && JSON.parse(fs.readFileSync(base, 'utf8'))['a.js'] === 1);
  t('same count passes', run(dir, base).code === 0);
  fs.writeFileSync(path.join(dir, 'a.js'), 'try{a()}catch(e){}\ntry{b()}catch(e){}\n');
  { const r = run(dir, base); t('one MORE silent handler fails and names the file and line', r.code === 1 && r.out.some(l => /a\.js:2/.test(l)), r.out); }
  fs.writeFileSync(path.join(dir, 'b.html'), '<script>p.catch(()=>{})</script>\n');
  fs.writeFileSync(path.join(dir, 'a.js'), '');
  { const r = run(dir, base); t('a brand-new file with a silent handler fails (baseline 0)', r.code === 1 && r.out.some(l => /b\.html/.test(l)), r.out); }
  fs.writeFileSync(path.join(dir, 'b.html'), '');
  { const r = run(dir, base); t('fewer than the baseline passes and says to lock it in', r.code === 0 && r.lower.includes('a.js'), r); }
  { const r = run(dir, path.join(dir, 'missing.json')); t('a missing baseline is exit 2 (the lint broke), never a silent pass', r.code === 2, r); }
  fs.rmSync(dir, { recursive: true, force: true });
}

// 3. the real repo ---------------------------------------------------------------------------------------------------
{ const r = run(root, path.join(root, 'scripts', 'silent-failure-baseline.json'));
  t('repo: no file has more silent handlers than its baseline', r.code === 0, r.out); }

console.log(`silent-failure-lint: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
