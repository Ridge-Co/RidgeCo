// Repeat-failure units (queue #250 Phase 1, Nov 16 2026). Runs the REAL repeatFailureUnits / repeatUnitsResponse / formatDigestText / buildDigest out of worker.js.
// Run: node test/repeat-units.test.mjs
import './_wo-status-global.mjs';
import fs from 'fs';
const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
let pass = 0, fail = 0;
const t = (n, c, got) => { if (c) pass++; else { fail++; console.log('FAIL:', n, got !== undefined ? 'got ' + JSON.stringify(got).slice(0, 500) : ''); } };
function grabFrom(s, name, isAsync = false) {
  const i = s.indexOf((isAsync ? 'async ' : '') + 'function ' + name + '('); if (i < 0) throw new Error('missing ' + name);
  let d = 0, j = s.indexOf('{', i);
  for (; j < s.length; j++) { if (s[j] === '{') d++; else if (s[j] === '}') { d--; if (!d) break; } }
  return s.slice(i, j + 1);
}
const grab = (n, a) => grabFrom(src, n, a);
const objConst = (prefix) => { const i = src.indexOf(prefix); return src.slice(i, src.indexOf('\n};', i) + 3); };
const a = src.indexOf('// ── Repeat-failure units (Ops_Build_Queue #250'), b = src.indexOf('\nfunction formatDigestText(');
t('repeat block markers exist', a > 0 && b > a);
const block = src.slice(a, b);

const NOW = Date.parse('2026-11-16T15:00:00Z');
const iso = (daysAgo) => new Date(NOW - daysAgo * 86400000).toISOString().slice(0, 10);
let seq = 100;
const wo = (o) => Object.assign({ ID: String(++seq), Property_ID: 'P1', Property_Address: '12 Elm St', Unit_ID: 'U1', Unit_Label: 'A', Trade: 'Plumbing', Created_Date: iso(10), Status: 'Complete', Voided: '', Type: 'tenant', Description: 'secret tenant words', Tenant_ID: 'T9' }, o);

const factory = new Function('h', 'fetchTab', 'json', `
  ${objConst('const QB_TRADE_ALIASES')}
  ${objConst('const QB_TRADE_MAP')}
  ${grab('resolveTrade')}
  ${grab('isHiddenBidCopy')}
  function demoTrue(v) { return String(v || '').toUpperCase() === 'TRUE'; }
  ${grab('demoIsDemoRow')}
  ${grab('demoHide')}
  ${grab('isMissingTabError')}
  ${block}
  return { repeatFailureUnits, repeatUnitsResponse, repeatTradeOf, REPEAT_NOT_REAL_STATUSES, REPEAT_SKIP_TYPES };
`);
const h = { wos: [], err: null };
const fetchTab = async (env, tab) => { if (h.err) throw h.err; return h.wos; };
const json = (data, status = 200) => ({ status, ok: status < 300, body: data });
const W = factory(h, fetchTab, json);
const R = (wos, o) => W.repeatFailureUnits(wos, Object.assign({ nowMs: NOW }, o || {}));

// ── 1. the flag rules ──
{
  let r = R([wo({}), wo({}), wo({})]);
  t('3 real WOs on one unit in the window are flagged', r.length === 1 && r[0].wo_count === 3 && r[0].why.includes('unit_count'), r);
  r = R([wo({ Trade: 'Plumbing' }), wo({ Trade: 'Electrical' })]);
  t('2 WOs of DIFFERENT trades are not flagged', r.length === 0, r);
  r = R([wo({ Trade: 'Plumbing' }), wo({ Trade: 'plumbing' })]);
  t('2 WOs of the SAME trade are flagged (case-insensitive trade)', r.length === 1 && r[0].why.some(x => x.startsWith('same_trade:Plumbing')), r);
  r = R([wo({ Trade: 'Plumbing' }), wo({ Trade: 'Electrical' }), wo({ Trade: 'HVAC' })]);
  t('3 WOs of three trades are flagged by the unit total, not the trade rule', r.length === 1 && r[0].why.join() === 'unit_count', r);
  r = R([wo({ Trade: '' }), wo({ Trade: '' })]);
  t('2 WOs with a blank trade are NOT a same-trade repeat (Unspecified never counts)', r.length === 0, r);
  r = R([wo({ Trade: 'Gizmo repair' }), wo({ Trade: 'Thingamajig' })]);
  t('two different unknown trades are not folded into one "General" system', r.length === 0, r);
  r = R([wo({ Trade: 'Gizmo repair' }), wo({ Trade: 'gizmo repair' })]);
  t('the same unknown trade twice IS a repeat', r.length === 1, r);
  r = R([wo({ Unit_ID: 'U1' }), wo({ Unit_ID: 'U2' }), wo({ Unit_ID: 'U3' })]);
  t('WOs spread across different units are never combined', r.length === 0, r);
  r = R([wo({ Unit_ID: '', Unit_Label: 'B' }), wo({ Unit_ID: '', Unit_Label: 'b' }), wo({ Unit_ID: '', Unit_Label: 'B ' })]);
  t('no Unit_ID: grouped by property + unit label', r.length === 1 && r[0].wo_count === 3, r);
  r = R([wo({ Unit_ID: '', Unit_Label: '' }), wo({ Unit_ID: '', Unit_Label: '' }), wo({ Unit_ID: '', Unit_Label: '' })]);
  t('property-wide WOs (no unit) are skipped', r.length === 0, r);
  r = R([wo({}), wo({}), wo({})], { minWos: 4, minSameTrade: 99 });
  t('thresholds are honored', r.length === 0, r);
}
// ── 2. what never counts ──
{
  const base = [wo({}), wo({})];   // 2 same-trade WOs: flagged on their own
  const flaggedWith = (extra) => R(base.concat([extra]))[0].wo_count;
  t('control: base pair counts 2', R(base)[0].wo_count === 2);
  t('Voided=TRUE does not count', flaggedWith(wo({ Voided: 'TRUE' })) === 2);
  for (const ty of ['addon', 'delivery', 'turnover', 'recurring']) t(ty + ' type does not count', flaggedWith(wo({ Type: ty })) === 2);
  t('a WO with a Recurring_Template_ID does not count', flaggedWith(wo({ Recurring_Template_ID: 'RT-1' })) === 2);
  t('hidden bid-group copy does not count', flaggedWith(wo({ Duplicated_From: '5', Bid_Group_ID: 'BG-1', Bid_Winner: '' })) === 2);
  t('the bid WINNER does count', flaggedWith(wo({ Duplicated_From: '5', Bid_Group_ID: 'BG-1', Bid_Winner: 'TRUE' })) === 3);
  for (const s of ['Cancelled', 'Canceled', 'Void', 'Declined']) t('status ' + s + ' does not count', flaggedWith(wo({ Status: s })) === 2);
  for (const s of ['Paid', 'Closed', 'New', 'In Progress', 'On Hold']) t('status ' + s + ' counts (real work)', flaggedWith(wo({ Status: s })) === 3);
  t('older than the window does not count', flaggedWith(wo({ Created_Date: iso(91) })) === 2);
  t('exactly at the window edge counts', flaggedWith(wo({ Created_Date: iso(90) })) === 3);
  t('unparseable date does not count', flaggedWith(wo({ Created_Date: 'garbage' })) === 2);
  t('blank date does not count', flaggedWith(wo({ Created_Date: '' })) === 2);
  t('a future-dated row does not count', flaggedWith(wo({ Created_Date: iso(-30) })) === 2);
  t('the exclusion status list is built from the status sets, not a hand-written list', /WOStatus\.sets\.DEAD/.test(block) && /WOStatus\.sets\.CLOSED_FINAL/.test(block));
  t('Paid and Closed are not in the excluded set', !W.REPEAT_NOT_REAL_STATUSES.includes('Paid') && !W.REPEAT_NOT_REAL_STATUSES.includes('Closed'), W.REPEAT_NOT_REAL_STATUSES);
  t('bad input never throws', R(null).length === 0 && R([null, undefined, {}, 'x']).length === 0);
}
// ── 3. ranking, cap, output shape, privacy ──
{
  const many = [];
  for (let u = 1; u <= 8; u++) for (let n = 0; n < (u % 2 ? 3 : 2) + (u === 4 ? 3 : 0); n++) many.push(wo({ Unit_ID: 'U' + u, Unit_Label: 'Unit ' + u, Trade: n % 3 ? 'Plumbing' : n % 2 ? 'HVAC' : 'Electrical', Created_Date: iso(u + n) }));
  const r = R(many);
  t('capped at top 5', r.length === 5, r.length);
  t('sorted by count (the 5-WO unit first)', r[0].unit.endsWith('Unit 4') && r[0].wo_count === 5 && r.every((x, i) => i === 0 || r[i - 1].wo_count >= x.wo_count), r.map(x => x.wo_count));
  const one = R([wo({ Description: 'Tenant Maria Lopez 410-555-0123 code 4411', Notes: 'lockbox 9999', Customer_Total: '555.55', Vendor_Cost: '300' }), wo({}), wo({})])[0];
  t('output has only unit, count, trades, why, ids, date, tag', JSON.stringify(Object.keys(one).sort()) === JSON.stringify(['last_created', 'tag', 'trades', 'unit', 'why', 'wo_count', 'wo_ids']), Object.keys(one));
  const flat = JSON.stringify(one);
  t('no tenant name, phone, code, notes or money in the output', !/Maria|410-555|4411|9999|555\.55|300|secret tenant|T9/.test(flat), flat);
  t('tag text is the one the brief asked for', one.tag === 'consider root-cause / replace-vs-repair');
  t('label is address + unit, last_created is a plain date', one.unit === '12 Elm St A' && /^\d{4}-\d{2}-\d{2}$/.test(one.last_created), one);
}
// ── 4. the endpoint: clamps, read-only, errors are loud ──
{
  h.wos = [wo({}), wo({}), wo({ Is_Demo: 'TRUE' }), wo({ ID: 'DO5' })]; h.err = null;
  let r = await W.repeatUnitsResponse({}, new URL('https://x/repeat-units'));
  t('endpoint ok:true with the units array, defaults 90/3', r.status === 200 && r.body.ok === true && Array.isArray(r.body.units) && r.body.window_days === 90 && r.body.min_wos === 3, r.body);
  t('demo rows never count', r.body.units.length === 1 && r.body.units[0].wo_count === 2, r.body);
  r = await W.repeatUnitsResponse({}, new URL('https://x/repeat-units?days=99999&min=0'));
  t('days clamps to 365 and min to 2', r.body.window_days === 365 && r.body.min_wos === 2, r.body);
  r = await W.repeatUnitsResponse({}, new URL('https://x/repeat-units?days=1&min=999'));
  t('days clamps up to 7 and min down to 20', r.body.window_days === 7 && r.body.min_wos === 20, r.body);
  r = await W.repeatUnitsResponse({}, new URL('https://x/repeat-units?days=abc&min=xyz'));
  t('junk params fall back to defaults, not an error', r.status === 200 && r.body.window_days === 90 && r.body.min_wos === 3, r.body);
  h.err = new Error('Sheets API error on GET /values/Work_Orders: Unable to parse range: Work_Orders');
  r = await W.repeatUnitsResponse({}, new URL('https://x/repeat-units'));
  t('missing Work_Orders tab is an empty list', r.status === 200 && r.body.count === 0, r);
  h.err = new Error('Sheets API error on GET /values/Work_Orders: boom');
  let threw = false; try { await W.repeatUnitsResponse({}, new URL('https://x/repeat-units')); } catch (e) { threw = true; }
  t('a real read error is thrown (loud), never an empty "all clear"', threw);
  t('the block has no write call (no addRow/updateRow/sheetsRequest POST/sendSMS/gmail)', !/addRow|updateRow|sheetsRequest|sendSMS|gmailSend|ensureTab|ensureColumns|appendRow/.test(block.replace(/\/\/[^\n]*/g, '')));
}
// ── 5. the digest: additive, byte-identical when nothing is flagged, errors shown ──
{
  const newFmt = grab('formatDigestText');
  // "Today's" digest = the new function with the added section cut out (everything else in formatDigestText is untouched). A one-off run of this same comparison against
  // `git show main:worker.js` (the real pre-change function) was also made while building this PR and matched byte for byte.
  const blockRe = /  if \(\(d\.repeatUnits && d\.repeatUnits\.length\) \|\| d\.repeatUnitsError\) \{[\s\S]*?\n  \}\n(?=  L\.push\('▶ NEEDS YOU TODAY'\);)/;
  t('the added digest section is one self-contained block', blockRe.test(newFmt));
  const oldFmt = newFmt.replace(blockRe, '');
  const mk = (s) => new Function(s + '\nreturn formatDigestText;')();
  const fNew = mk(newFmt), fOld = mk(oldFmt);
  const d = { stamp: 'Mon, Nov 16, 2026', healthAlerts: [], stuckReceipts: [], followups: ['one fix check'], followupsError: '', overdue: ['WO-1 · x'], dueToday: [], onHold: [], urgent: [], pendingBills: [], billsTotal: 0, wins: [], pulse: { properties: 1, tenants: 2, vendors: 3, open_wos: 4 } };
  t('nothing flagged: digest text is byte-identical to today (field absent)', fNew(d) === fOld(d));
  t('nothing flagged: digest text is byte-identical to today (empty list, no error)', fNew(Object.assign({}, d, { repeatUnits: [], repeatUnitsError: '' })) === fOld(d));
  const unit = { unit: '12 Elm St A', wo_count: 4, trades: { Plumbing: 3, HVAC: 1 }, why: ['unit_count'], wo_ids: ['1', '2', '3', '4', '5', '6', '7'], last_created: '2026-11-10', tag: 'consider root-cause / replace-vs-repair' };
  const txt = fNew(Object.assign({}, d, { repeatUnits: [unit], repeatUnitsError: '' }));
  t('flagged: section shows with unit, count, trades, last date, ids and the tag', /▶ REPEAT-FAILURE UNITS/.test(txt) && /12 Elm St A: 4 WOs \(Plumbing x3, HVAC x1\) · last 2026-11-10 · WO-1 WO-2 WO-3 WO-4 WO-5 WO-6 \+1 more — consider root-cause \/ replace-vs-repair/.test(txt), txt);
  t('flagged: the section sits after the fix-checks and before NEEDS YOU TODAY', txt.indexOf('TENANT FIX-CHECKS') < txt.indexOf('REPEAT-FAILURE UNITS') && txt.indexOf('REPEAT-FAILURE UNITS') < txt.indexOf('NEEDS YOU TODAY'));
  t('the rest of the digest is unchanged when a section is added', txt.replace(/▶ REPEAT-FAILURE UNITS[\s\S]*?\n\n/, '') === fOld(d));
  const et = fNew(Object.assign({}, d, { repeatUnits: [], repeatUnitsError: 'boom' }));
  t('error: shown in the digest as a warning', /▶ REPEAT-FAILURE UNITS/.test(et) && /⚠ Could not check repeat-failure units: boom/.test(et), et);

  // buildDigest wiring with the real function and stubbed collaborators
  const mkBuild = (repeatImpl) => new Function('h', 'repeatFailureUnits', 'fetchTab', `
    const WOStatus = globalThis.WOStatus; const OPEN_WO_STATUSES = WOStatus.sets.ACTIVE; const DIGEST_CLOSED = WOStatus.sets.DIGEST_CLOSED;
    const etTodayISO = () => '2026-11-16', daysAgoISO = () => '2026-11-12', etStamp = () => 'stamp';
    const demoHide = x => x, activeRows = r => r;
    const computeTelemetryMetrics = () => ({ byJob: {} }), readTelemetryRows = async () => [], fetchConfig = async () => ({});
    const fuDigestLines = async () => ({ lines: [], error: '' });
    ${grab('buildDigest', true)}
    return buildDigest;
  `)(h, repeatImpl, async () => []);
  const ok = await mkBuild(() => [unit])({});
  t('buildDigest carries repeatUnits and an empty error', Array.isArray(ok.repeatUnits) && ok.repeatUnits.length === 1 && ok.repeatUnitsError === '', ok.repeatUnits);
  const bad = await mkBuild(() => { throw new Error('kaboom'); })({});
  t('buildDigest: a throw in the new code leaves the rest of the digest intact and records the error', bad.repeatUnitsError === 'kaboom' && Array.isArray(bad.repeatUnits) && bad.repeatUnits.length === 0 && bad.pulse && bad.overdue && Array.isArray(bad.overdue), bad);
  const text = fNew(bad);
  t('buildDigest error flows into the text', /Could not check repeat-failure units: kaboom/.test(text) && /▶ NEEDS YOU TODAY/.test(text) && /▶ PULSE/.test(text), text);
  t('buildDigest reuses the already-loaded work orders (no extra Sheets read)', /repeatFailureUnits\(wos\)/.test(src) && !/fetchTab\(env, ?'Work_Orders'\)[\s\S]{0,60}repeatFailureUnits/.test(src.slice(src.indexOf('async function buildDigest'), src.indexOf('async function staleWos'))));
}
// ── 6. wiring: admin only, self-test covered ──
{
  const pub = src.slice(src.indexOf('const PUBLIC_PATHS = ['), src.indexOf('];', src.indexOf('const PUBLIC_PATHS = [')));
  const roles = src.slice(src.indexOf('const ROLE_SCOPES = {'), src.indexOf('\n};', src.indexOf('const ROLE_SCOPES = {')));
  const prod = src.match(/const HUB_PROD_WRITE_PATHS = \[[^\]]*\]/)[0];
  t('/repeat-units not public, not in any role scope (tenant/owner/vendor get 403), not a prod write path', !pub.includes("'/repeat-units'") && !roles.includes("'/repeat-units'") && !prod.includes('/repeat-units'));
  t('/repeat-units routed exactly once, GET', src.split("path === '/repeat-units'").length === 2);
  t("self-test lists it, dispatches it and asserts it", src.includes("{ name: 'repeat_units', path: '/repeat-units' }") && src.includes("case 'repeat_units': return await repeatUnitsResponse") && src.includes("case 'repeat_units':\n      if (status"));
  t('no new cron / SCHED job / SMS added by this change', !/repeat[_-]units[\s\S]{0,40}(every_min|kind: 'interval'|crons)/.test(src));
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
