// Phase 7c (batch 3) of the silent-failure burn-down (Nov 18 2026): a corrupt checklist now reports on the invoice "Work completed" path too,
// a corrupt recurring-template Targets cell is reported, and a failed Config read is reported (throttled). Fallbacks are unchanged.
// Source checks plus runs of the real helpers.
// Run: node test/workdone-config-failure-reports.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'worker.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ FAIL: ' + m); } };
const has = (re, m) => ok(re.test(src), m);

console.log('env and the WO id reach the checklist parser on the invoice path');
has(/function workDoneFromChecklist\(raw, env, ref\) \{[^}]*parseChecklistItems\(raw, env, ref\)/s, 'workDoneFromChecklist passes env and ref to parseChecklistItems');
has(/function workDoneBlock\(wo, env\) \{\n  const wd = workDoneFromChecklist\(wo && wo\.Checklist, env, wo && wo\.ID\);/, 'workDoneBlock passes env and the WO id');
has(/function workDoneWarnings\(wo, env\) \{\n  const wd = workDoneFromChecklist\(wo && wo\.Checklist, env, wo && wo\.ID\);/, 'workDoneWarnings passes env and the WO id');
has(/function buildLaborDescription\(billRow, timeEntries, wo, env\) \{/, 'buildLaborDescription takes env');
has(/buildLaborDescription\(billRow, timeEntries, wo, env\)\.slice\(0, 3800\)/, 'buildInvoiceLines passes env to buildLaborDescription');
has(/out\.block = workDoneBlock\(wo, env\);\n    workDoneWarnings\(wo, env\)/, 'the final-invoice work-done block passes env');
has(/workDoneWarnings\(wo, env\)\.forEach\(w => warnings\.push\(w\)\);/, 'the invoice preview passes env to workDoneWarnings');

console.log('Recurring template targets and Config reads report');
has(/function recurTargets\(tpl, env\) \{\n  const a = parseJsonCell\(String\(\(tpl && tpl\.Targets\) \|\| ''\), \[\], \{ env, where: 'recurTargets:Targets', ref: String\(\(tpl && tpl\.ID\) \|\| ''\), severity: 'P1' \}\);/, 'recurTargets goes through parseJsonCell at P1 with the template id');
const rtCalls = (src.match(/(?<!function )recurTargets\([^)]*\)/g) || []);
ok(rtCalls.length === 5 && rtCalls.every(c => /, env\)$/.test(c)), 'all 5 recurTargets callers pass env (' + rtCalls.length + ' calls)');
has(/softFail\(env, 'fetchConfig:Config', e, \{ severity: 'P1', source: 'read'/, 'fetchConfig reports a failed Config read at P1');
has(/if \(n - _cfgFailAt > 300000\) \{ _cfgFailAt = n;/, 'the fetchConfig report is throttled to once per 5 minutes per isolate');

console.log('Runs of the real helpers');
const grab = (kw, name) => { const i = src.indexOf(kw + ' ' + name + '('); let d = 0, j = src.indexOf('{', i); for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } } return src.slice(i, j + 1); };
const notes = [];
const parseJsonCell = (c, fb, o) => { o = o || {}; if (c === undefined || c === null || String(c).trim() === '') return fb; try { return JSON.parse(c); } catch (e) { notes.push(o.where + '|' + o.severity + '|' + o.ref); return fb; } };
const looksLikeAccessDetail = (s) => /code|key/i.test(String(s || ''));
const checklistItemPastTense = (it) => it.t ? 'Done: ' + it.t : '';
const fns = [grab('function', 'parseChecklistItems'), grab('function', 'workDoneFromChecklist'), grab('function', 'workDoneBlock')].join('\n');
let H;
try { H = new Function('parseJsonCell', 'looksLikeAccessDetail', 'checklistItemPastTense', fns + '\nreturn { workDoneBlock };')(parseJsonCell, looksLikeAccessDetail, checklistItemPastTense); } catch (e) { H = null; console.log('  (could not load helpers: ' + e.message + ')'); }
ok(!!H, 'the real work-done helpers load');
if (H) {
  const env = {};
  ok(H.workDoneBlock({ ID: 'WO-1', Checklist: '[{"t":"Fix sink","done":true}]' }, env).startsWith('Work completed:') && notes.length === 0, 'a good checklist: a work-completed block, nothing reported');
  ok(H.workDoneBlock({ ID: 'WO-2', Checklist: '' }, env) === '' && notes.length === 0, 'a blank checklist: no block, nothing reported');
  ok(H.workDoneBlock({ ID: 'WO-3', Checklist: '[oops' }, env) === '' && notes.length === 1 && notes[0] === 'parseChecklistItems|P1|WO-3', 'a corrupt checklist: still no block (as before) but reported at P1 with the WO id');
}

const cfgReports = [];
const softFail = async (env, where, e, o) => { cfgReports.push(where + '|' + o.severity); return { ok: false }; };
let down = true;
const sheetsRequest = async () => { if (down) throw new Error('sheets down'); return { values: [['a', '1'], ['b']] }; };
const C = new Function('sheetsRequest', 'softFail', grab('async function', 'fetchConfig').replace(/^/, 'let _cfgFailAt = 0;\n') + '\nreturn fetchConfig;')(sheetsRequest, softFail);
const run = async () => {
  const r1 = await C({});
  ok(JSON.stringify(r1) === '{}' && cfgReports.length === 1 && cfgReports[0] === 'fetchConfig:Config|P1', 'a failed Config read: still {} and reported once at P1');
  await C({}); await C({});
  ok(cfgReports.length === 1, 'repeated failures inside 5 minutes are not reported again (an outage cannot flood the sheet)');
  down = false;
  const r2 = await C({});
  ok(r2.a === '1' && r2.b === '' && cfgReports.length === 1, 'a good read: the settings, nothing reported');
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
};
run();
