// Tests for scripts/silent-failure-lint.mjs (no-silent-failures phase B, Oct 20 2026).
// Fault injection for the linter itself: each silent pattern must be FOUND, each legitimate pattern must NOT be, and the ratchet must fail when a count goes up.
import { scanSource, scanHtml, mask, compare, totals, countRepo, CATEGORIES } from '../scripts/silent-failure-lint.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ FAIL: ' + m); } };
const cats = (src) => scanSource(src).filter(f => !f.allowed).map(f => f.category);
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('Patterns that ARE silent failures');
ok(eq(cats('try { x(); } catch (e) {}'), ['empty']), 'empty catch');
ok(eq(cats('try { x(); } catch (_) { }'), ['empty']), 'empty catch with a space');
ok(eq(cats('try { x(); } catch {}'), ['empty']), 'optional-binding empty catch');
ok(eq(cats('try { x(); } catch (e) { /* non-fatal */ }'), ['empty']), 'comment-only catch ("non-fatal") is still empty');
ok(eq(cats('try { x(); } catch (e) {\n  // ignore\n}'), ['empty']), 'line-comment-only catch');
ok(eq(cats("try { x(); } catch (e) { console.error('boom', e); }"), ['log-only']), 'console-only catch');
ok(eq(cats('try { x(); } catch (e) { console.log(e); console.warn(e); }'), ['log-only']), 'two console statements only');
ok(eq(cats('try { x(); } catch (e) { return null; }'), ['return-default']), 'return null');
ok(eq(cats('try { x(); } catch (e) { return []; }'), ['return-default']), 'return []');
ok(eq(cats('for (;;) { try { x(); } catch (e) { continue; } }'), ['return-default']), 'continue');
ok(eq(cats('p.catch(() => null)'), ['swallow-catch']), '.catch(() => null)');
ok(eq(cats('p.catch(() => [])'), ['swallow-catch']), '.catch(() => [])');
ok(eq(cats('p.catch(() => ({}))'), ['swallow-catch']), '.catch(() => ({}))');
ok(eq(cats('p.catch(() => {})'), ['swallow-catch']), '.catch(() => {})');
ok(eq(cats('p.catch(function(){})'), ['swallow-catch']), '.catch(function(){})');
ok(eq(cats('p.catch(function(){ return null; })'), ['swallow-catch']), '.catch(function(){ return null })');
ok(eq(cats('p.catch(e => console.log(e))'), ['swallow-catch']), '.catch(e => console.log(e))');
ok(eq(cats('const d = await r.json().catch(() => ({}));'), ['swallow-catch']), 'await r.json().catch(() => ({}))');

console.log('Patterns that are NOT silent failures');
ok(eq(cats('try { x(); } catch (e) { throw e; }'), []), 'rethrow');
ok(eq(cats('try { x(); } catch (e) { await reportFailure(env, { where: "x", err: e }); }'), []), 'reports the failure');
ok(eq(cats('try { x(); } catch (e) { return { ok: false, error: String(e) }; }'), []), 'returns an error object');
ok(eq(cats('try { x(); } catch (e) { errors.push(e.message); }'), []), 'collects the error');
ok(eq(cats('p.catch(e => { report(e); })'), []), '.catch that reports');
ok(eq(cats('p.catch(e => handle(e))'), []), '.catch(e => handle(e))');
ok(eq(cats('p.catch(() => fallback())'), []), '.catch that calls something');

console.log('The silent-ok marker');
ok(eq(cats('try { JSON.parse(s); } catch (e) { /* silent-ok: probe, a bad value just means unset */ }'), []), 'marker inside the catch');
ok(eq(cats('try { JSON.parse(s); } catch (e) {} // silent-ok: probe, a bad value means unset'), []), 'marker on the same line');
ok(eq(cats('// silent-ok: probe, a bad value means unset\ntry { JSON.parse(s); } catch (e) {}'), ['empty']), 'a marker on the line ABOVE no longer exempts the next catch');
ok(eq(cats('try {\n  x();\n} catch (e) {\n  // silent-ok: probe, a bad value means unset\n}'), []), 'marker on its own line inside the braces');
ok(eq(cats('x(); // silent-ok: probe, a bad value means unset\ntry { y(); } catch (e) {}'), ['empty']), 'a trailing comment ending the previous line does not exempt the next catch');
ok(eq(cats('try { y(); }\ncatch (e) { /* silent-ok: probe, a bad value means unset */ }'), []), 'marker inside braces with the catch token on its own line');
ok(eq(cats('try { x(); } catch (e) { /* silent-ok: fine */ }'), ['empty']), 'a 2-word reason is rejected');
ok(eq(cats('try { x(); } catch (e) { /* silent-ok */ }'), ['empty']), 'a bare marker is rejected');
ok(eq(cats('// silent-ok: probe, a bad value means unset\n\n\n\ntry { x(); } catch (e) {}'), ['empty']), 'a marker far above does not count');
ok(eq(cats('p.catch(() => null); // silent-ok: optional lookup, absence is normal'), []), 'marker on a .catch line');

console.log('The scanner is not fooled by strings, regexes, templates, comments');
ok(eq(cats('const s = "try { } catch (e) {}";'), []), 'catch inside a double-quoted string');
ok(eq(cats("const s = 'catch (e) {}';"), []), 'catch inside a single-quoted string');
ok(eq(cats('const s = `catch (e) {}`;'), []), 'catch inside a template literal');
ok(eq(cats('const s = `a ${ (()=>{ try { x(); } catch (e) {} })() } b`;'), ['empty']), 'real catch inside a ${ } expression IS found');
ok(eq(cats('// catch (e) {}\nconst a = 1;'), []), 'catch inside a line comment');
ok(eq(cats('/* catch (e) {} */ const a = 1;'), []), 'catch inside a block comment');
ok(eq(cats('const re = /catch (e) {}/; const q = "a";'), []), 'catch inside a regex literal');
ok(eq(cats('const re = /["\']/g; try { x(); } catch (e) {}'), ['empty']), 'a regex containing quotes does not swallow the rest of the line');
ok(eq(cats('const a = 4 / 2; const b = 8 / 4; try { x(); } catch (e) {}'), ['empty']), 'division is not mistaken for a regex');
ok(eq(cats("const t = `x`; try { y(); } catch (e) { report(e); }"), []), 'code after a template is still parsed');
ok(eq(cats('try { x(); } catch (e) { if (e.code === 1) { return null; } throw e; }'), []), 'nested braces: a conditional return is not "return-default"');
ok(eq(cats('function f(){ try { a(); } catch (e) { throw e; } try { b(); } catch (e) {} }'), ['empty']), 'two catches, only the empty one counts');

console.log('Oct 20 review: stricter rules');
ok(eq(cats('try { x(); } catch (e) { console.error(e); return; }'), ['log-and-bail']), 'console.error then return');
ok(eq(cats('for (;;) { try { x(); } catch (e) { console.warn("bad", e); continue; } }'), ['log-and-bail']), 'console.warn then continue');
ok(eq(cats('for (;;) { try { x(); } catch (e) { console.log(e); break; } }'), ['log-and-bail']), 'console.log then break');
ok(eq(cats('try { x(); } catch (e) { console.error(e); return null; }'), ['log-and-bail']), 'console then return null');
ok(eq(cats('try { x(); } catch (e) { console.error(e); return { ok: false }; }'), ['log-and-bail']), 'console then return a literal object');
ok(eq(cats('try { x(); } catch (e) { console.error(e); return { ok: false, error: String(e) }; }'), []), 'console then return the error is NOT flagged');
ok(eq(cats('try { x(); } catch (e) { console.error(e); report(e); }'), []), 'console plus a real report is fine');
ok(eq(cats('try { x(); } catch (e) { console.log(a) b.c(); }'), []), 'console call followed by other code is not "log-only"');
ok(eq(cats('try { x(); } catch (e) { return { ok: false }; }'), ['return-literal']), 'return { ok: false }');
ok(eq(cats('try { x(); } catch (e) { return -1; }'), ['return-literal']), 'return -1');
ok(eq(cats("try { x(); } catch (e) { return 'n/a'; }"), ['return-literal']), "return 'n/a'");
ok(eq(cats('try { x(); } catch (e) { return { a: [], b: 0 }; }'), ['return-literal']), 'return nested literal object');
ok(eq(cats('try { x(); } catch (e) { return { ok: false, error: e.message }; }'), []), 'return an object carrying the error is fine');
ok(eq(cats('try { x(); } catch (e) { v = null; }'), ['return-literal']), 'x = null; only');
ok(eq(cats('try { x(); } catch (e) { v = void 0; }'), ['return-literal']), 'x = void 0; only');
ok(eq(cats('try { x(); } catch (e) { void 0; }'), ['return-literal']), 'void 0; only');
ok(eq(cats('try { x(); } catch (e) { v = null; report(e); }'), []), 'assign plus report is fine');
ok(eq(cats('p.catch(noop)'), ['swallow-literal']), '.catch(noop)');
ok(eq(cats('p.catch(_noop)'), ['swallow-literal']), '.catch(_noop)');
ok(eq(cats('p.catch(e => ({ ok: false }))'), ['swallow-literal']), '.catch(e => ({ok:false}))');
ok(eq(cats("p.catch(() => 'n/a')"), ['swallow-literal']), ".catch(() => 'n/a')");
ok(eq(cats('p.catch(() => -1)'), ['swallow-literal']), '.catch(() => -1)');
ok(eq(cats('p.catch(function(e){ return { ok: false }; })'), ['swallow-literal']), '.catch(function(){ return {ok:false} })');
ok(eq(cats('p.catch(e => ({ ok: false, error: e.message }))'), []), '.catch(e => ({ok:false, error:e.message})) carries the error: fine');
ok(eq(cats('p.catch(reportIt)'), []), '.catch(namedHandler) is fine');
ok(eq(cats('p.then(ok, () => {})'), ['then-noop']), '.then(x, () => {})');
ok(eq(cats('p.then(ok, function(){ return null; })'), ['then-noop']), '.then(x, function(){ return null })');
ok(eq(cats('p.then(ok, function(e){ console.error(e); })'), ['then-noop']), '.then(x, log-only)');
ok(eq(cats('p.then(ok, noop)'), ['then-noop']), '.then(x, noop)');
ok(eq(cats('p.then(function(a){ return f(a, b); })'), []), '.then with one argument is fine');
ok(eq(cats('p.then(ok, e => report(e))'), []), '.then(x, reporter) is fine');
ok(eq(cats('p.then((a, b) => f(a), e => { report(e); })'), []), '.then with commas inside the first handler and a real second handler');
ok(eq(cats('p.catch(() => null); // silent-ok: optional lookup, absence is normal'), []), 'marker on a .catch line (still)');
ok(eq(cats('// silent-ok: optional lookup, absence is normal\np.catch(() => null);'), ['swallow-catch']), 'marker on the line above a .catch does not count');
ok(eq(cats('p.then(ok, () => {}); // silent-ok: optional lookup, absence is normal'), []), 'marker on a .then line');
const ih = (h) => scanHtml(h).filter(f => !f.allowed).map(f => f.category);
ok(eq(ih('<button onclick="try{go()}catch(e){}">x</button>'), ['inline-handler']), 'inline onclick with an empty catch');
ok(eq(ih("<a onclick='go().catch(function(){})'>x</a>"), ['inline-handler']), 'inline onclick with a swallowing .catch');
ok(eq(ih('<button onclick="try{go()}catch(e){/* silent-ok: demo button, nothing to report */}">x</button>'), []), 'inline handler with a marker');
ok(eq(ih('<button onclick="go()">x</button>'), []), 'a plain inline handler is fine');
ok(eq(ih('<p>\n<button onchange="try{go()}catch(e){return null}">x</button>'), ['inline-handler']) && scanHtml('<p>\n<button onchange="try{go()}catch(e){return null}">x</button>')[0].line === 2, 'inline handler is reported on its real line');

console.log('Line numbers and HTML');
ok(scanSource('a\nb\ntry { x(); } catch (e) {}\n')[0].line === 3, 'line number is right');
const html = '<html>\n<script src="x.js"></script>\n<script>\nfoo();\ntry { x(); } catch (e) {}\n</script>\n<script type="application/json">{"a":"catch (e) {}"}</script>';
const hf = scanHtml(html);
ok(hf.length === 1 && hf[0].line === 5 && hf[0].category === 'empty', 'inline <script> offender is reported at its real file line', hf);
ok(scanHtml('<script src="a.js">try { } catch(e){}</script>').length === 0, '<script src> bodies are ignored');

console.log('Ratchet');
const base = { 'a.js': { empty: 3, 'log-only': 1 }, 'b.js': { empty: 2 } };
ok(compare({ 'a.js': { empty: 3, 'log-only': 1 }, 'b.js': { empty: 2 } }, base).ups.length === 0, 'same counts: pass');
ok(compare({ 'a.js': { empty: 2, 'log-only': 1 }, 'b.js': { empty: 2 } }, base).ups.length === 0, 'lower counts: pass');
ok(compare({ 'a.js': { empty: 2, 'log-only': 1 }, 'b.js': { empty: 2 } }, base).downs.length === 1, 'lower counts are reported as improvements');
ok(compare({ 'a.js': { empty: 4, 'log-only': 1 }, 'b.js': { empty: 2 } }, base).ups[0].now === 4, 'one more empty catch: FAIL');
ok(compare({ 'a.js': { empty: 3, 'log-only': 1 }, 'b.js': { empty: 2 }, 'c.js': { empty: 1 } }, base).ups[0].file === 'c.js', 'offender in a brand-new file: FAIL');
ok(compare({ 'a.js': { empty: 3, 'log-only': 1, 'swallow-catch': 1 }, 'b.js': { empty: 2 } }, base).ups[0].category === 'swallow-catch', 'a new category in an old file: FAIL');
ok(compare({ 'a.js': { empty: 1, 'log-only': 1 }, 'b.js': { empty: 4 } }, base).ups.length === 1, 'cannot trade one file\'s improvement against another file\'s regression');
ok(eq(CATEGORIES, ['empty', 'log-only', 'return-default', 'swallow-catch', 'log-and-bail', 'return-literal', 'swallow-literal', 'then-noop', 'inline-handler']), 'categories are the documented nine');

console.log('Repo baseline is honest');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const bp = join(root, 'scripts', 'silent-failure-baseline.json');
let baseline = null; try { baseline = JSON.parse(readFileSync(bp, 'utf8')); } catch (e) { baseline = null; }
ok(baseline && baseline.files, 'scripts/silent-failure-baseline.json exists and parses');
if (baseline) {
  const cur = countRepo(root);
  const { ups } = compare(cur.files, baseline.files);
  ok(ups.length === 0, 'current repo adds no silent failures over the baseline' + (ups.length ? ' ' + JSON.stringify(ups.slice(0, 5)) : ''));
  const t = totals(cur.files), b = totals(baseline.files);
  ok(Object.keys(t).every(k => t[k] <= b[k]), 'totals never exceed the baseline totals');
}
console.log('CLI --baseline');
{
  const { spawnSync } = await import('node:child_process');
  const { writeFileSync, mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(join(tmpdir(), 'sfl-'));
  const strict = join(dir, 'strict.json'), loose = join(dir, 'loose.json'), cli = join(root, 'scripts', 'silent-failure-lint.mjs');
  const cur = countRepo(root);
  writeFileSync(loose, JSON.stringify({ files: cur.files }));
  const r1 = spawnSync('node', [cli, '--baseline', loose], { encoding: 'utf8' });
  ok(r1.status === 0, '--baseline <path>: current repo passes against a baseline equal to it');
  if (cur.offenders.length) {
    const f0 = cur.offenders[0]; const lowered = JSON.parse(JSON.stringify(cur.files)); lowered[f0.file][f0.category]--; if (!lowered[f0.file][f0.category]) delete lowered[f0.file][f0.category];
    writeFileSync(strict, JSON.stringify({ files: lowered }));
    const r2 = spawnSync('node', [cli, '--baseline', strict], { encoding: 'utf8' });
    ok(r2.status === 1 && /ADDS silent failures/.test(r2.stderr), '--baseline <path>: a stricter (base) baseline makes the same tree FAIL, whatever the head baseline says');
  }
  const r3 = spawnSync('node', [cli, '--baseline', join(dir, 'nope.json')], { encoding: 'utf8' });
  ok(r3.status === 2 && /missing/.test(r3.stderr), '--baseline with a missing file exits 2 with a message');
  const wf = readFileSync(join(root, '.github', 'workflows', 'silent-failure-guard.yml'), 'utf8');
  ok(/git show "origin\/\$\{BASE_REF\}:scripts\/silent-failure-baseline\.json"/.test(wf) && /--baseline "\$\{RUNNER_TEMP\}\/base-baseline\.json"/.test(wf), 'the CI workflow compares against the base branch baseline');
}
console.log(`\nsilent-failure-lint: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
