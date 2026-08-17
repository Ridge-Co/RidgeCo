// Access-code sharing fix (Aug 2026): "828 S Charles St's electronic door code isn't showing
// on the WO in the Hub at all" + "let me mark ONE code Brett-only regardless of its type."
// Two real bugs/gaps, two fixes:
//   1. getWOLockboxes' TYPE_MAP only recognized a handful of legacy Key_Type strings — a code
//      saved under the CURRENT vocabulary (Building-FrontDoorCode, Unit-DoorCode, ...) fell
//      through to a raw/garbled label, and the admin Hub's WO-detail widget filtered by the
//      single literal string 'Lockbox', so anything else — including every electronic code —
//      was invisible there, not just mislabeled. TYPE_MAP now covers both vocabularies.
//   2. There was no way to mark an individual code (independent of its type) as never shown to
//      a vendor. Keys.Visibility + enrichWO's per-row filter add that, with the one exception
//      Brett asked for: still visible if the WO's assigned vendor IS his own in-house record.
// These run the REAL getWOLockboxes function extracted from worker.js so the test can't drift
// from what ships. enrichWO's per-code filter (which composes getWOLockboxes' `visibility`
// field with Vendors.In_House) is checked as source-guard assertions — same style already used
// elsewhere in this suite for the larger, harder-to-sandbox functions — since fully executing
// enrichWO drags in resolveTrade/QB_TRADE_MAP/isTenantCurrent, unrelated to what's being tested.
import fs from 'fs';
const wsrc = fs.readFileSync('worker.js', 'utf8');

function grab(src, sig) {
  const start = src.indexOf(sig);
  if (start < 0) throw new Error('not found: ' + sig);
  // Find the function body's opening brace AFTER the parameter list closes — not the first
  // '{' textually, which would be wrong for a signature with an object-literal default param
  // like `function enrichWO(..., opts={}, ...)`.
  const parenStart = src.indexOf('(', start);
  let pdepth = 0, pi = parenStart;
  for (; pi < src.length; pi++) {
    if (src[pi] === '(') pdepth++;
    else if (src[pi] === ')') { pdepth--; if (!pdepth) break; }
  }
  const open = src.indexOf('{', pi);
  let depth = 0, i = open;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) break; }
  }
  return src.slice(start, i + 1);
}

let pass = 0, fail = 0;
const t = (n, c) => { if (c) pass++; else { fail++; console.log('FAIL:', n); } };

const glbSrc = grab(wsrc, 'function getWOLockboxes(');
const { getWOLockboxes } = new Function(glbSrc + '\nreturn { getWOLockboxes };')();

const key = (over) => Object.assign({ ID: 'K1', Property_ID: 'P1', Active: 'TRUE', Key_Code: '1234' }, over);

// ── Problem 1: current-vocabulary types must resolve to a real label, not fall through ──
{
  const [row] = getWOLockboxes([key({ Key_Type: 'Building-FrontDoorCode' })], 'P1', '', '');
  t('828-S-Charles-style electronic front-door code gets a real label', row && /electronic/i.test(row.label));
  t('and is not silently dropped — it has a code', row && row.code === '1234');
}
{
  const [row] = getWOLockboxes([key({ Key_Type: 'Unit-DoorCode', Unit_ID: 'U1' })], 'P1', 'U1', '');
  t('current-scheme unit electronic code also resolves, not garbled', row && /electronic/i.test(row.label));
}
{
  // legacy literal 'Lockbox' — the ONLY type the old admin-widget filter recognized — must
  // still work after the broadening (no regression for old data).
  const [row] = getWOLockboxes([key({ Key_Type: 'Lockbox' })], 'P1', '', '');
  t('legacy literal Lockbox type still resolves correctly (no regression)', row && /lockbox/i.test(row.label));
}
{
  // A genuinely unknown/未来 type must not crash — falls back to the raw string, never throws.
  const [row] = getWOLockboxes([key({ Key_Type: 'Some-Brand-New-Type' })], 'P1', '', '');
  t('an unrecognized type falls back to its raw string rather than throwing', row && row.label.includes('Some-Brand-New-Type'));
}

// ── Problem 2 (part A): the code carries its own visibility, independent of type ──
{
  const rows = getWOLockboxes([
    key({ ID: 'K1', Key_Type: 'Unit-DoorCode', Unit_ID: 'U1', Visibility: 'Brett Only', Key_Code: '9999' }),
    key({ ID: 'K2', Key_Type: 'Building-Lockbox', Visibility: '', Key_Code: '5555' }),
  ], 'P1', 'U1', '');
  const byId = Object.fromEntries(rows.map(r => [r.id, r]));
  t('a code explicitly marked Brett Only carries that flag through', byId.K1.visibility === 'Brett Only');
  t('a code with no override carries a blank visibility (= Auto)', byId.K2.visibility === '');
  t('visibility is per-code — marking one Brett-only does not touch the other', byId.K2.visibility !== 'Brett Only');
}

// ── Problem 2 (part B): enrichWO applies the per-code filter, with the in-house exception ──
const enrich = grab(wsrc, 'function enrichWO(');
t('rawLockboxes is filtered by visibility, not passed straight through unfiltered',
  /rawLockboxes\.filter\(lb => lb\.visibility !== 'Brett Only'\)/.test(enrich));
t('the filter is skipped (nothing hidden) when the assigned vendor is Brett\'s own in-house record',
  /vendorInHouse \? rawLockboxes : rawLockboxes\.filter/.test(enrich));
t('vendorInHouse is resolved from the ACTUAL assigned vendor (Vendor_ID), not assumed',
  /vendorInHouse = String\(v\.In_House\|\|''\)\.toUpperCase\(\) === 'TRUE'/.test(enrich));
t('the filter runs unconditionally (every external render), not only when opts.vendorView is set — '
  + 'admin never calls enrichWO at all, so this can only ever affect vendor/tenant/owner/shared-link views',
  !/opts\.vendorView.*visibleLockboxes|visibleLockboxes.*opts\.vendorView/.test(enrich));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
