// NO CRON ANYWHERE (permanent rule, Brett, Oct 12 2026): Apps Script (apps-script/hub-scheduler/HubScheduler.gs) is the only clock.
// Guards the repo-level pieces: no `schedule:`/cron in any workflow, `crons = []` in wrangler.toml, and the JOBS table in the
// script stays the single, complete list (every Hub job has a row with the registry's default time; every GitHub row points at a
// real, hand-runnable workflow). The Apps Script behaviour itself is covered by apps-script/hub-scheduler/test.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
let pass = 0, fail = 0;
const t = (n, c, x) => { if (c) pass++; else { fail++; console.log('FAIL:', n, x === undefined ? '' : JSON.stringify(x)); } };
const worker = fs.readFileSync(root + 'worker.js', 'utf8');
const gs = fs.readFileSync(root + 'apps-script/hub-scheduler/HubScheduler.gs', 'utf8');
const wfDir = root + '.github/workflows/';

for (const f of fs.readdirSync(wfDir)) {
  const txt = fs.readFileSync(wfDir + f, 'utf8');
  t(`${f}: no schedule:/cron timer`, !/^\s*schedule:/m.test(txt) && !/^\s*-?\s*cron:/m.test(txt));
}
const toml = fs.readFileSync(root + 'wrangler.toml', 'utf8').split('\n').filter(l => !/^\s*#/.test(l)).join('\n');
t('wrangler.toml: crons = [] (explicitly empty)', /\[triggers\]\s*\n\s*crons\s*=\s*\[\s*\]/.test(toml) && !/crons\s*=\s*\[\s*["']/.test(toml));

// the JOBS table: parse the literal rows
const tbl = gs.slice(gs.indexOf('var JOBS = ['), gs.indexOf('// ═══ 2. FIXED SETTINGS'));
const rows = [...tbl.matchAll(/^\s*\{ name: '(\w+)',\s+run: '(\w+)'(.*)\},?\s*$/gm)].map(m => ({ name: m[1], run: m[2], rest: m[3] }));
t('JOBS table parses (34 rows)', rows.length === 34, rows.length);
const names = rows.map(r => r.name);
t('JOBS names unique', new Set(names).size === names.length);
const hubRows = rows.filter(r => r.run === 'hub').map(r => r.name);
const regSrc = worker.slice(worker.indexOf('const SCHED_JOBS = ['), worker.indexOf('// Pure. Is this one job due'));
const reg = [...regSrc.matchAll(/\{ name: '(\w+)',/g)].map(m => m[1]);
t('every Hub job in SCHED_JOBS has a row in the JOBS table (and vice versa), same order', JSON.stringify(reg) === JSON.stringify(hubRows), { reg, hubRows });
for (const r of rows.filter(r => r.run === 'github')) {
  const wf = /workflow: '([^']+)'/.exec(r.rest)[1];
  const f = wfDir + wf;
  t(`${r.name}: ${wf} exists and has workflow_dispatch`, /repo: 'brett332\/data'/.test(r.rest) || (fs.existsSync(f) && /^\s*workflow_dispatch:/m.test(fs.readFileSync(f, 'utf8'))));
}
for (const bad of ['crons', 'cron:', 'CronTrigger']) t(`HubScheduler.gs has no "${bad}" outside comments`, !gs.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).some(l => l.includes(bad)));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
