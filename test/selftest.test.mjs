// Selftest auto-verification pass (Optimizer Round 2, item #1, Sep 18 2026): closes the gap
// where dozens of shipped features sit as "Built, not yet live-verified" because a headless
// build session has no WORKER_SECRET to run authed checks. POST /selftest runs two assertion
// layers (endpoint smoke checks + golden business-outcome paths regression-testing real past
// bugs: rule 182 PIN format/dedup, rule 162 WO duplicate-ID guard, rule 174 Payment_Source
// column, rule 192 vendor-bills-invisible-to-QB) and delivers a digest via the real Gmail send.
//
// These tests exercise the PURE/helper logic only — no env, no network, no Sheets, no Gmail —
// extracted straight from worker.js via this repo's sandboxed-eval convention so they can't
// drift from what ships. The impure orchestrators (selftestCallEndpoint, selftestRunGoldenChecks,
// selftestRun, maybeRunDailySelftest) need a live env and are exercised by hand against staging,
// per the task's "don't call live WORKER_SECRET-gated endpoints in this sandbox" constraint.
import fs from 'fs';
const wsrc = fs.readFileSync('worker.js', 'utf8');

function grab(sig) {
  const start = wsrc.indexOf(sig);
  if (start < 0) throw new Error('not found: ' + sig);
  const parenStart = wsrc.indexOf('(', start);
  let pdepth = 0, pi = parenStart;
  for (; pi < wsrc.length; pi++) {
    if (wsrc[pi] === '(') pdepth++;
    else if (wsrc[pi] === ')') { pdepth--; if (!pdepth) break; }
  }
  const open = wsrc.indexOf('{', pi);
  let depth = 0, i = open;
  for (; i < wsrc.length; i++) {
    if (wsrc[i] === '{') depth++;
    else if (wsrc[i] === '}') { depth--; if (!depth) break; }
  }
  return wsrc.slice(start, i + 1);
}

// Bracket-matching array-literal extractor for `const NAME = [ ... ];` — same spirit as grab()
// above but for a data constant rather than a function body.
function grabArrayConst(name) {
  const sig = 'const ' + name + ' = [';
  const start = wsrc.indexOf(sig);
  if (start < 0) throw new Error('not found: ' + sig);
  const open = wsrc.indexOf('[', start);
  let depth = 0, i = open;
  for (; i < wsrc.length; i++) {
    if (wsrc[i] === '[') depth++;
    else if (wsrc[i] === ']') { depth--; if (!depth) break; }
  }
  return wsrc.slice(start, i + 1) + ';';
}

let pass = 0, fail = 0;
const t = (n, c) => { if (c) pass++; else { fail++; console.log('FAIL:', n); } };

// ── Layer 1 list — must stay pure data, and each name must have both a dispatcher and an
// assertion so nothing in the list silently falls through unassessed. ────────────────────────
const checksSrc = grabArrayConst('SELFTEST_ENDPOINT_CHECKS');
const { SELFTEST_ENDPOINT_CHECKS } = new Function(checksSrc + '\nreturn { SELFTEST_ENDPOINT_CHECKS };')();

t('endpoint checklist has 20-40 entries (curated, not exhaustive)',
  SELFTEST_ENDPOINT_CHECKS.length >= 20 && SELFTEST_ENDPOINT_CHECKS.length <= 40);
t('every entry has a name and a path',
  SELFTEST_ENDPOINT_CHECKS.every(c => c && typeof c.name === 'string' && c.name && typeof c.path === 'string' && c.path.startsWith('/')));
{
  const names = SELFTEST_ENDPOINT_CHECKS.map(c => c.name);
  t('no duplicate names in the checklist', new Set(names).size === names.length);
}

const dispatchSrc = grab('async function selftestCallEndpoint(');
const assertSrc = grab('function selftestAssertEndpoint(');
for (const c of SELFTEST_ENDPOINT_CHECKS) {
  t(`'${c.name}' has a dispatcher in selftestCallEndpoint`, dispatchSrc.includes(`case '${c.name}':`));
  t(`'${c.name}' has an assertion (switch case or ARRAY_CHECKS membership) in selftestAssertEndpoint`,
    assertSrc.includes(`case '${c.name}':`) || assertSrc.includes(`'${c.name}'`));
}

// ── selftestAssertEndpoint — pure grading logic ───────────────────────────────────────────
const { selftestAssertEndpoint } = new Function(assertSrc + '\nreturn { selftestAssertEndpoint };')();

t('an ARRAY_CHECKS name passes on a real 200 + array', selftestAssertEndpoint('properties', 200, [{ ID: 'P1' }]).ok);
t('an ARRAY_CHECKS name fails when the body is not an array', !selftestAssertEndpoint('properties', 200, { oops: true }).ok);
t('an ARRAY_CHECKS name fails on a non-200 status even with a valid-looking array', !selftestAssertEndpoint('vendors', 500, []).ok);
t('health passes on ok:true + sheet_tail + tabs object', selftestAssertEndpoint('health', 200, { ok: true, sheet_tail: 'x', tabs: {} }).ok);
t('health fails when ok is not strictly true', !selftestAssertEndpoint('health', 200, { ok: 'yes', sheet_tail: 'x', tabs: {} }).ok);
t('health fails when sheet_tail is missing', !selftestAssertEndpoint('health', 200, { ok: true, tabs: {} }).ok);
t('twilio_account_status treats 503 (not configured) as an acceptable pass, not a failure',
  selftestAssertEndpoint('twilio_account_status', 503, { error: 'not configured' }).ok);
t('twilio_account_status still fails on an unexpected status', !selftestAssertEndpoint('twilio_account_status', 500, {}).ok);
t('qb_payables fails when ok is missing even on 200', !selftestAssertEndpoint('qb_payables', 200, { rows: [] }).ok);
t('an unrecognized name falls to the default explicit fail — never an accidental pass',
  !selftestAssertEndpoint('totally_unknown_name', 200, { anything: true }).ok);

// ── selftestCheckPinFormatAndDedup — rule 182 regression guard ───────────────────────────
const { selftestCheckPinFormatAndDedup } = new Function(grab('function selftestCheckPinFormatAndDedup(') + '\nreturn { selftestCheckPinFormatAndDedup };')();

{
  const tenants = [{ ID: 'T1', PIN: 'ABC12345', Active: 'TRUE' }, { ID: 'T2', PIN: 'XYZ98765', Active: 'TRUE' }];
  const r = selftestCheckPinFormatAndDedup([], [], [], tenants);
  t('well-formed, unique PINs pass clean', r.ok && r.bad_format_count === 0 && r.duplicate_count === 0);
}
{
  const tenants = [{ ID: 'T1', PIN: 'old-format-pin', Active: 'TRUE' }];
  const r = selftestCheckPinFormatAndDedup([], [], [], tenants);
  t('a legacy/malformed PIN is caught, not silently accepted', !r.ok && r.bad_format_count === 1);
}
{
  // the actual rule-182 shape: two tenants sharing one identical PIN.
  const tenants = [{ ID: 'T1', PIN: 'ABC12345', Active: 'TRUE' }, { ID: 'T2', PIN: 'ABC12345', Active: 'TRUE' }];
  const r = selftestCheckPinFormatAndDedup([], [], [], tenants);
  t('a duplicate PIN shared across two tenants is caught', !r.ok && r.duplicate_count === 1);
}
{
  const tenants = [{ ID: 'T1', PIN: 'BAD-PIN', Active: 'FALSE' }];
  const r = selftestCheckPinFormatAndDedup([], [], [], tenants);
  t('an inactive row with a malformed PIN is skipped, not flagged', r.ok);
}
{
  const tenants = [{ ID: 'T1', PIN: '', Active: 'TRUE' }];
  const r = selftestCheckPinFormatAndDedup([], [], [], tenants);
  t('a blank PIN is a pre-existing separate gap, not flagged by this check', r.ok);
}
{
  // duplicate detection is cross-tab, per the doc comment.
  const vendors = [{ ID: 'V1', PIN: 'ABC12345', Active: 'TRUE' }];
  const tenants = [{ ID: 'T1', PIN: 'ABC12345', Active: 'TRUE' }];
  const r = selftestCheckPinFormatAndDedup(vendors, [], [], tenants);
  t('duplicate detection spans tabs (Vendors vs Tenants), not just within one', !r.ok && r.duplicate_count === 1);
}

// ── selftestCheckWoDuplicateIds — rule 162 regression guard ───────────────────────────────
const { selftestCheckWoDuplicateIds } = new Function(grab('function selftestCheckWoDuplicateIds(') + '\nreturn { selftestCheckWoDuplicateIds };')();

t('unique WO IDs pass clean', selftestCheckWoDuplicateIds([{ ID: 'WO-1' }, { ID: 'WO-2' }]).ok);
t('a double-tap-style duplicate WO ID is caught (rule 162/WO-1192 shape)',
  !selftestCheckWoDuplicateIds([{ ID: 'WO-1192' }, { ID: 'WO-1192' }]).ok);
t('an empty work-order list is not itself a failure', selftestCheckWoDuplicateIds([]).ok);
t('rows missing an ID are ignored rather than crashing', selftestCheckWoDuplicateIds([{}, { ID: 'WO-1' }]).ok);

// ── selftestCheckPaymentSourceColumn — rule 174 regression guard ─────────────────────────
const { selftestCheckPaymentSourceColumn } = new Function(grab('function selftestCheckPaymentSourceColumn(') + '\nreturn { selftestCheckPaymentSourceColumn };')();

t('passes when Payment_Source is present in the headers', selftestCheckPaymentSourceColumn(['ID', 'Payment_Source', 'Amount']).ok);
t('fails when Payment_Source is missing (the exact rule-174 regression)', !selftestCheckPaymentSourceColumn(['ID', 'Amount']).ok);
t('fails safely (not a throw) on a non-array input', !selftestCheckPaymentSourceColumn(null).ok);

// ── selftestSummarizeVendorBillsQbReachable — rule 192 regression guard ──────────────────
const { selftestSummarizeVendorBillsQbReachable } = new Function(grab('function selftestSummarizeVendorBillsQbReachable(') + '\nreturn { selftestSummarizeVendorBillsQbReachable };')();

t('no sampled vendors (nothing to check) is not itself a failure', selftestSummarizeVendorBillsQbReachable([]).ok);
t('all sampled vendors reachable passes', selftestSummarizeVendorBillsQbReachable([{ vendor_id: 'V1', ok: true }, { vendor_id: 'V2', ok: true }]).ok);
t('one unreachable sampled vendor fails the whole check (the rule-192 shape: a real bill silently invisible)',
  !selftestSummarizeVendorBillsQbReachable([{ vendor_id: 'V1', ok: true }, { vendor_id: 'V2', ok: false, error: 'not found' }]).ok);

// ── selftestAggregateResults — pure tally, both layers combined ──────────────────────────
const { selftestAggregateResults } = new Function(grab('function selftestAggregateResults(') + '\nreturn { selftestAggregateResults };')();

{
  const ep = [{ name: 'a', ok: true }, { name: 'b', ok: false, reason: 'boom' }];
  const golden = [{ name: 'c', ok: true }];
  const agg = selftestAggregateResults(ep, golden);
  t('aggregate totals combine both layers', agg.total === 3);
  t('aggregate passed count is correct', agg.passed === 2);
  t('aggregate failed count is correct', agg.failed === 1);
  t('failures array carries the failing name+reason through', agg.failures.length === 1 && agg.failures[0].name === 'b' && agg.failures[0].reason === 'boom');
}
{
  const agg = selftestAggregateResults([], []);
  t('an empty run aggregates to zero/zero without throwing', agg.total === 0 && agg.passed === 0 && agg.failed === 0);
}

// ── selftestComposeDigest — plain-English pass/fail summary ──────────────────────────────
const { selftestComposeDigest } = new Function(grab('function selftestComposeDigest(') + '\nreturn { selftestComposeDigest };')();

{
  const agg = { total: 2, passed: 2, failed: 0, failures: [] };
  const d = selftestComposeDigest(agg, [{ name: 'a', ok: true, path: '/a', reason: 'fine' }], [{ name: 'b', ok: true, reason: 'fine' }], '2026-09-18');
  t('an all-green digest reports all-green, not a failing section', /all green/.test(d) && !/FAILING/.test(d));
  t('an all-green digest still lists the endpoint and golden-path sections', /ENDPOINTS/.test(d) && /GOLDEN PATHS/.test(d));
}
{
  const agg = { total: 2, passed: 1, failed: 1, failures: [{ name: 'x', reason: 'broke' }] };
  const d = selftestComposeDigest(agg, [{ name: 'x', ok: false, path: '/x', reason: 'broke' }], [], '2026-09-18');
  t('a failing digest surfaces a FAILING section naming the failure', /FAILING/.test(d) && /x — broke/.test(d));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
