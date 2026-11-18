// Phase 7b (GATED money half) of the silent-failure burn-down (Nov 18 2026): JSON.parse fallbacks on money cells
// (scope line items, proposal items and signed selections, add-on items, estimate lines, receipts on a vendor bill).
// An unreadable money cell keeps the same fallback as before AND is now reported at P1. Source checks plus runs of the real helpers.
// Run: node test/json-cells-money-failure-reports.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'worker.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ FAIL: ' + m); } };
const has = (re, m) => ok(re.test(src), m);
const cell = (where) => new RegExp("parseJsonCell\\([^\\n]*where: '" + where + "'[^\\n]*severity: 'P1'");

console.log('Every money cell reports at P1');
['scopeParseItems', 'scopeProposalView:Proposal_Items_JSON', 'scopeProposalView:Selections_JSON', 'scopeSigResolveParties:Selections_JSON',
 'ownerApprovalTotal', 'addonParseItems', 'addonList:Line_Items', 'estimateSubtotalOf', 'retranslateEstimate:Line_Items',
 'generateEstimateText:Line_Items', 'buildInvoiceLines:Receipts_JSON', 'qbAttachReceipts:Receipts_JSON'].forEach(w => has(cell(w), w + ' reported P1'));
has(/softFail\(env, 'generateEstimateText:integrityClause', e, \{ severity: 'P1'/, 'a failed Estimates read in generateEstimateText is reported too');

console.log('env is passed down to every caller');
const calls = (name, def) => { const re = new RegExp('\\b' + name + '\\(', 'g'); const all = src.match(re) || []; return all.length; };
const withEnv = (re) => (src.match(re) || []).length;
ok(withEnv(/(?<!function )scopeParseItems\(\w+, env\)/g) === 11, 'all 11 scopeParseItems callers pass env');
ok(withEnv(/(?<!function )addonParseItems\(\w+, env\)/g) === 4, 'all 4 addonParseItems callers pass env');
ok(withEnv(/_inEn\.timeEntries, env\)/g) === 5, 'all 5 buildInvoiceLines callers pass env');
has(/ownerApprovalTotal\(s\.Proposal_Items_JSON, env\)/, 'owner approval cards pass env');
has(/ownerApprovalCards\(scopes, props, units, sigs, ownerId, Date\.now\(\), env\)/, 'ownerApprovals passes env to the cards');
has(/estimateSubtotalOf\(approved\[0\], env\)/, 'the billing ceiling passes env to the estimate subtotal');
has(/woMaxCeiling\(wo, await fetchTab\(env, 'Estimates'\), env\)/, 'maxPriceGateResponse passes env to the ceiling');

console.log('Behaviour kept (same fallbacks, same type checks)');
has(/function scopeParseItems\(s, env\) \{[^\n]*return Array\.isArray\(a\) \? a : \[\]; \}/, 'scope items still come back as an array');
has(/function addonParseItems\(child, env\) \{[^\n]*return Array\.isArray\(a\) \? a : \[\]; \}/, 'add-on items still come back as an array');
has(/return Array\.isArray\(li\) \? li\.reduce\(/, 'an estimate whose lines are not a list still totals 0');
has(/const lines = parseJsonCell\(est\.Line_Items[^\n]*\n\s*if \(!Array\.isArray\(lines\) \|\| !lines\.length\) return json\(\{ error: 'Estimate has no line items' \}, 400\);/, 're-translate still refuses an estimate with no readable lines');
ok(!/catch \(_\) \{ return null; \}\n?\s*if \(!Array\.isArray\(items\) \|\| !items\.length\) return null;/.test(src), 'the old swallowing parse in ownerApprovalTotal is gone');

console.log('Runs of the real helpers');
const notes = [];
const parseJsonCell = (c, fb, o) => { o = o || {}; if (c === undefined || c === null || String(c).trim() === '') return fb; try { return JSON.parse(c); } catch (e) { notes.push(o.where + '|' + o.severity + '|' + o.ref); return fb; } };
const grab = (name) => { const i = src.indexOf('function ' + name + '('); if (i < 0) return null; let d = 0, j = src.indexOf('{', i); for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } } return src.slice(i, j + 1); };
const f = new Function('parseJsonCell', 'OWNER_NOOP', ['scopeParseItems', 'addonParseItems', 'estimateSubtotalOf', 'ownerApprovalTotal'].map(grab).join('\n') + '\nreturn { scopeParseItems, addonParseItems, estimateSubtotalOf, ownerApprovalTotal };')(parseJsonCell, null);
const env = {};
ok(f.scopeParseItems({ ID: 'S1', Line_Items: '[{"id":"a"}]' }, env).length === 1 && notes.length === 0, 'good scope items parse, nothing reported');
ok(f.scopeParseItems({ ID: 'S1', Line_Items: '' }, env).length === 0 && notes.length === 0, 'blank scope items give [] quietly');
ok(f.scopeParseItems({ ID: 'S2', Line_Items: '{"a":1}' }, env).length === 0, 'scope items that are not a list give []');
ok(f.scopeParseItems({ ID: 'S3', Line_Items: '[oops' }, env).length === 0 && notes.length === 1 && notes[0] === 'scopeParseItems|P1|S3', 'corrupt scope items give [] and report once at P1 with the scope id');
notes.length = 0;
ok(f.addonParseItems({ ID: 'W9', Addon_Items_JSON: '[bad' }, env).length === 0 && notes[0] === 'addonParseItems|P1|W9', 'corrupt add-on items give [] and report P1');
notes.length = 0;
ok(f.estimateSubtotalOf({ Subtotal: '$1,250.50' }, env) === 1250.5 && notes.length === 0, 'a stored subtotal still wins and reads nothing');
ok(f.estimateSubtotalOf({ ID: 'E1', Subtotal: '', Line_Items: '[{"amount":"100"},{"amount":50.25}]' }, env) === 150.25, 'lines are totalled when there is no subtotal');
ok(f.estimateSubtotalOf({ ID: 'E2', Subtotal: '', Line_Items: '{"a":1}' }, env) === 0, 'lines that are not a list total 0 (as before)');
ok(f.estimateSubtotalOf({ ID: 'E3', Subtotal: '', Line_Items: '[oops' }, env) === 0 && notes.length === 1 && notes[0] === 'estimateSubtotalOf|P1|E3', 'corrupt lines total 0 and report P1 (the billing ceiling falls back to the max price)');
notes.length = 0;
ok(f.ownerApprovalTotal('', env) === null && notes.length === 0, 'blank proposal items: no total, nothing reported');
ok(f.ownerApprovalTotal('[oops', env) === null && notes.length === 1 && notes[0].startsWith('ownerApprovalTotal|P1'), 'corrupt proposal items: no total ("Open to see price") and reported P1');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
