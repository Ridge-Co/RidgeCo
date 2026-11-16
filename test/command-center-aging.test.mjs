// Queue #181: aging buckets + SLA targets on command-center.html. Runs the REAL agingModel / renderAging out of the page.
// Read-only page change: no new request, no write, no hand-written status array, shared rc-ui parts loaded with guards.
import fs from 'fs';
const src = fs.readFileSync('command-center.html', 'utf8');
function grab(s, sig) {
  const start = s.indexOf(sig); if (start < 0) throw new Error('not found: ' + sig);
  const open = s.indexOf('{', start); let depth = 0, i = open;
  for (; i < s.length; i++) { if (s[i] === '{') depth++; else if (s[i] === '}') { depth--; if (!depth) break; } }
  return s.slice(start, i + 1);
}
let pass = 0, fail = 0;
const t = (n, c) => { if (c) pass++; else { fail++; console.log('FAIL:', n); } };
const slaLine = src.match(/^const SLA_DAYS=\{[^}]*\};/m);
t('SLA_DAYS is one line', !!slaLine);
const model = new Function(slaLine[0] + '\n' + grab(src, 'function agingModel(') + '\nreturn { agingModel, SLA_DAYS };')();
const NOW = Date.parse('2026-11-16T12:00:00Z'), DAY = 86400000;
const ago = n => new Date(NOW - n * DAY).toISOString();
const w = (age, extra = {}) => ({ ID: 'W' + age + (extra.Priority || ''), Created_Date: ago(age), Priority: 'Normal', Status: 'Vendor Assigned', ...extra });
const bucketOf = age => { const m = model.agingModel([w(age)], NOW); return Object.keys(m.b).find(k => m.b[k] === 1); };

// 1. boundary ages
t('age 0 in 0-2', bucketOf(0) === 'b0_2'); t('age 2 in 0-2', bucketOf(2) === 'b0_2');
t('age 3 in 3-7', bucketOf(3) === 'b3_7'); t('age 7 in 3-7', bucketOf(7) === 'b3_7');
t('age 8 in 8-14', bucketOf(8) === 'b8_14'); t('age 14 in 8-14', bucketOf(14) === 'b8_14');
t('age 15 in 15+', bucketOf(15) === 'b15p'); t('age 400 in 15+', bucketOf(400) === 'b15p');
t('a date in the future is age 0, not negative', bucketOf(-3) === 'b0_2');

// 2. missing / garbage dates are counted, never dropped, never age 0
{
  const m = model.agingModel([w(1), { ID: 'X', Priority: 'Normal', Status: 'Vendor Assigned' }, { ID: 'Y', Created_Date: 'garbage', Priority: 'Normal' }, { ID: 'Z', Created_Date: null }], NOW);
  t('no-date count is 3', m.nodate === 3); t('no-date rows not in any bucket', Object.values(m.b).reduce((a, b) => a + b, 0) === 1);
  t('buckets + no-date = total', Object.values(m.b).reduce((a, b) => a + b, 0) + m.nodate === m.total);
  t('no-date rows never past target', m.past.length === 0);
}

// 3. SLA targets
{
  t('placeholder targets are 1/3/7/14', JSON.stringify(model.SLA_DAYS) === '{"urgent":1,"high":3,"normal":7,"low":14}');
  const p = (pri, age, extra) => model.agingModel([w(age, { Priority: pri, ...extra })], NOW).past.length;
  t('urgent at age 2 is past target', p('Urgent', 2) === 1); t('urgent at age 1 is not (target 1, equal is not over)', p('Urgent', 1) === 0);
  t('normal at age 2 is not', p('Normal', 2) === 0); t('normal at 7 not, at 8 is', p('Normal', 7) === 0 && p('Normal', 8) === 1);
  t('high at 4 is', p('High', 4) === 1); t('low at 14 not, at 15 is', p('Low', 14) === 0 && p('Low', 15) === 1);
  t('priority is case-insensitive', p('URGENT', 2) === 1 && p('urgent', 2) === 1);
  t('On Hold never past target', p('Urgent', 30, { Status: 'On Hold' }) === 0);
  t('On Hold still counted in its bucket', model.agingModel([w(30, { Status: 'On Hold' })], NOW).b.b15p === 1);
}

// 4. blank / unknown priority = normal, and surfaced
{
  const m = model.agingModel([w(9, { Priority: '' }), w(9, { Priority: undefined }), w(9, { Priority: 'Whenever' }), w(2, { Priority: 'Normal' })], NOW);
  t('3 blank/unknown priorities counted', m.nopri === 3); t('they are checked against normal (age 9 > 7)', m.past.length === 3 && m.past.every(x => x.pri === 'normal'));
}

// 5. ordering: worst overrun first
{
  const m = model.agingModel([w(9), w(40, { Priority: 'Low' }), w(5, { Priority: 'Urgent' })], NOW);
  t('past sorted by days over target', m.past.map(x => x.over).join() === '26,4,2');
}
t('empty / null input is safe', model.agingModel([], NOW).total === 0 && model.agingModel(null, NOW).total === 0);

// 6. the page wiring
t('wo-status.js loaded before use, with a guard', /<script src="wo-status\.js"><\/script>/.test(src) && /data-wo-status-guard/.test(src));
t('rc-ui.css and rc-ui.js loaded at ?v=1 with a guard', /rc-ui\.css\?v=1/.test(src) && /rc-ui\.js\?v=1/.test(src) && /data-rc-ui-guard/.test(src));
t('population comes from WOStatus.sets.OPEN_WORK', /WOStatus\.sets\.OPEN_WORK/.test(grab(src, 'function renderAging(')));
t('card goes right after the stuck-work card', src.includes("html+=staleCard(d.stale);\n  html+='<div id=\"aging-slot\"></div>';"));
t('renderAging runs after the page body is written', src.includes("document.getElementById('body').innerHTML=html;\n  renderAging(d,addr);"));
t('error state has a Retry that reloads', /RC\.error\(slot,\{[^}]*onRetry/.test(grab(src, 'function renderAging(')));
t('empty state uses RC.empty', /RC\.empty\(slot/.test(grab(src, 'function renderAging(')));
t('failure falls back to a visible message, never a blank gap', /Could not work out aging/.test(grab(src, 'function renderAging(')));
// 7. read-only: nothing in the new block fetches or writes
const block = src.slice(src.indexOf('// ── Aging buckets'), src.indexOf('function render(d)'));
t('new block makes no network call', !/fetch\(|XMLHttpRequest|api\(|sendBeacon|method\s*:/.test(block));
t('new block has no hand-written status array', !/\[\s*['"](Complete|Paid|Invoiced|Cancelled|On Hold|Open|Vendor Assigned)['"]\s*,/.test(block));
t('only one On Hold equality, no status list', (block.match(/On Hold/g) || []).length >= 1 && !/DONE\s*=/.test(block));
t('every sheet value is escaped with h()', /h\(p\.id\)/.test(block) && /h\(addr\(w\)\)/.test(block) && /h\(w\.Trade/.test(block));
// 8. existing pieces untouched
t('stuck-work card and its call still there', /function staleCard\(/.test(src) && /html\+=staleCard\(d\.stale\);/.test(src));
t('header aging 7d+ count still there', /aging 7d\+/.test(src));
console.log(`command-center aging: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
