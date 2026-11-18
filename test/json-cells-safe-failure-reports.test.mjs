// Phase 7b (SAFE half) of the silent-failure burn-down (Nov 18 2026): JSON.parse fallbacks on config cells, notes and outside text.
// Source checks plus two small runs of the real functions: an unreadable cell keeps the same fallback AND is reported once.
// The money cells (line items, proposals, estimates, receipts on a bill) are the GATED second half of 7b.
// Run: node test/json-cells-safe-failure-reports.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'worker.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ FAIL: ' + m); } };
const has = (re, m) => ok(re.test(src), m);
const cell = (where, sev) => new RegExp("parseJsonCell\\([^\\n]*where: '" + where + "'[^\\n]*severity: '" + sev + "'");

console.log('Reports at the right severity');
has(cell('receiptCardLabelsFromCfg', 'P2'), 'receipt card labels config reported P2');
has(cell('scopeGet:Source_Refs', 'P2'), 'scope source refs (read) reported P2');
has(cell('scopeIngest:Source_Refs', 'P2'), 'scope source refs (add) reported P2');
has(cell('triageSla:Triage_SLA_Hours', 'P2'), 'triage SLA hours reported P2 (the old comment claimed triageWorkOrder reported it, it only reports keywords)');
has(cell('vendorWorkorders:Access_Trade_Defaults', 'P1'), 'vendor trade access defaults reported P1');
has(cell('woSharedRead:Access_Trade_Defaults', 'P1'), 'shared-link trade access defaults reported P1');
has(cell('processRecurringWorkOrders:Last_Skips', 'P1'), 'recurring skip memory reported P1');
has(cell('backfillItemsSummary:Items', 'P2'), 'backfill Items cell reported P2 (it was only a comment)');
has(cell('inspStrConfig:STR_GUARD_FIXTURE', 'P2'), 'STR guard fixture reported P2 (was console only)');
has(/softFail\(env, 'approveReceiptQueue:learn_vendor_default', e, \{ severity: 'P2'/, 'a vendor default that cannot be learned is reported');

console.log('Behaviour kept');
has(/let srcs = parseJsonCell\(s\.Source_Refs, \[\][^\n]*if \(!Array\.isArray\(srcs\)\) srcs = \[\];/, 'source refs still fall back to an empty list');
has(/const d = JSON\.parse\(cfg\.receipt_vendor_defaults \|\| '\{\}'\); d\[vk\] = category;/, 'vendor defaults still parsed strictly, so a corrupt map is never overwritten by a one-entry map');
has(/skips = parseJsonCell\(tpl\.Last_Skips, \{\}[^\n]*\) \|\| \{\};/, 'skips still fall back to an empty object');

console.log('Reasoned silent-ok (outside text, validity checks)');
const okReasons = [
  /function scopeParseJSON[^\n]*silent-ok: callers treat null as an unreadable model answer/,
  /silent-ok: a model answer that is not valid JSON is the validity result/,
  /silent-ok: an unreadable pricing_config value is refused/,
  /silent-ok: model text is often not pure JSON/,
  /silent-ok: text from a model or web page that is not JSON is expected/,
  /silent-ok: a malformed JSON-LD block on an outside web page is skipped/,
];
okReasons.forEach((re, i) => has(re, 'silent-ok reason ' + (i + 1) + ' present'));

console.log('Runs of the real functions');
const grab = (name) => { const m = new RegExp('(?:async )?function ' + name + '\\([^\\n]*\\n?[\\s\\S]*?\\n}\\n|function ' + name + '\\([^\\n]*\\}\\n').exec(src); return m && m[0]; };
const notes = [];
const parseJsonCell = (c, fb, o) => { o = o || {}; if (c === undefined || c === null || String(c).trim() === '') return fb; try { return JSON.parse(c); } catch (e) { notes.push(o.where + '|' + o.severity); return fb; } };
const labelsSrc = grab('receiptCardLabelsFromCfg');
const slaSrc = grab('triageSla');
ok(!!labelsSrc && !!slaSrc, 'both functions found in worker.js');
if (labelsSrc && slaSrc) {
  const TRIAGE_SLA_DEFAULT = { emergency: 2, urgent: 8, routine: 72, cosmetic: 168 };
  const TRIAGE_TIERS = Object.keys(TRIAGE_SLA_DEFAULT);
  const triageCfgGet = (cfg, k) => cfg[k];
  const f = new Function('parseJsonCell', 'TRIAGE_SLA_DEFAULT', 'TRIAGE_TIERS', 'triageCfgGet', labelsSrc + '\n' + slaSrc + '\nreturn { receiptCardLabelsFromCfg, triageSla };')(parseJsonCell, TRIAGE_SLA_DEFAULT, TRIAGE_TIERS, triageCfgGet);
  ok(JSON.stringify(f.receiptCardLabelsFromCfg('{"1234":"Truck"}', {})) === '{"1234":"Truck"}', 'good labels parse as before');
  ok(JSON.stringify(f.receiptCardLabelsFromCfg('', {})) === '{}' && notes.length === 0, 'blank labels give {} and report nothing');
  ok(JSON.stringify(f.receiptCardLabelsFromCfg('[1,2]', {})) === '{}', 'an array is not a label map: {} as before');
  ok(JSON.stringify(f.receiptCardLabelsFromCfg('{oops', {})) === '{}' && notes.length === 1 && notes[0] === 'receiptCardLabelsFromCfg|P2', 'corrupt labels give {} and report once at P2');
  notes.length = 0;
  ok(f.triageSla({ Triage_SLA_Hours: '{"urgent": 4}' }, {}).urgent === 4 && f.triageSla({ Triage_SLA_Hours: '{"urgent": 4}' }, {}).emergency === 2, 'a good SLA override applies and the rest keep defaults');
  ok(f.triageSla({}, {}).urgent === 8 && notes.length === 0, 'no SLA setting keeps defaults and reports nothing');
  ok(f.triageSla({ Triage_SLA_Hours: 'not json' }, {}).urgent === 8 && notes.length === 1 && notes[0] === 'triageSla:Triage_SLA_Hours|P2', 'a bad SLA setting keeps defaults and is reported once');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
