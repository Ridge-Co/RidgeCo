// Owner tenant roster (Oct 14 2026, Brett): importer/updater planning rules, the dates guard, the moved-out SMS gate and the
// Eastern-day background-WO rule. Pure functions are sliced out of worker.js and run directly (no Sheets, no network).
import fs from 'fs';
import assert from 'node:assert';
const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
function grab(name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  let d = 0, j = src.indexOf('{', src.indexOf(')', i));
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i, j + 1);
}
function grabConst(name) {
  const i = src.indexOf('const ' + name + ' =');
  if (i < 0) throw new Error('missing const ' + name);
  let j = src.indexOf('\n', i);
  if (src[src.indexOf('=', i) + 2] === '{') { let d = 0; for (j = src.indexOf('{', i); j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } } j = src.indexOf(';', j); }
  return src.slice(i, j + 1);
}
const lib = new Function(
  grabConst('QB_ADDR_WORDS') + '\n' + grabConst('ROSTER_MAX_ROWS') + '\n' +
  ['qbNormAddress', 'normalizePhone', 'firstPhone', 'tenantMovedOut', 'rosterNormDate', 'rosterUnitKey', 'rosterNameKey', 'rosterSplitName', 'rosterNameFields',
    'rosterFindProperty', 'rosterPlan', 'tenantDatesError', 'isBackgroundWO', 'isTenantCurrent', 'smsGateDecision', 'tenantForQueuedText'].map(grab).join('\n') +
  '\nreturn { rosterNormDate, rosterPlan, tenantDatesError, isBackgroundWO, isTenantCurrent, smsGateDecision, tenantMovedOut, tenantForQueuedText, rosterFindProperty };'
)();
const { rosterNormDate, rosterPlan, tenantDatesError, isBackgroundWO, isTenantCurrent, smsGateDecision, tenantMovedOut, tenantForQueuedText } = lib;

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

// ---------------- dates ----------------
eq(rosterNormDate('2026-10-01'), '2026-10-01', 'ISO date');
eq(rosterNormDate('10/1/2026'), '2026-10-01', 'M/D/YYYY');
eq(rosterNormDate('10/01/26'), '2026-10-01', 'M/D/YY');
eq(rosterNormDate(''), '', 'blank is blank');
eq(rosterNormDate('2026-02-30'), null, 'Feb 30 is not a date');
eq(rosterNormDate('13/1/2026'), null, 'month 13 is not a date');
eq(rosterNormDate('soon'), null, 'text is not a date');

// ---------------- tenantDatesError (the refuse-without-dates rule used by /tenant/add, bulk importer, onboarding) ----------------
ok(tenantDatesError({}) !== '', 'no move-in date refused');
ok(tenantDatesError({ Move_In_Date: '' }) !== '', 'blank move-in refused');
ok(tenantDatesError({ Move_In_Date: 'abc' }).includes('not a real date'), 'junk move-in refused');
eq(tenantDatesError({ Move_In_Date: '2026-10-01' }), '', 'good move-in accepted');
ok(tenantDatesError({ Move_In_Date: '2026-10-01', Active: 'FALSE' }).includes('Move-out'), 'a tenant added as already gone needs a move-out date');
eq(tenantDatesError({ Move_In_Date: '2026-10-01', Active: 'FALSE', Move_Out_Date: '2026-10-05' }), '', 'former tenant with both dates ok');
ok(tenantDatesError({ Move_In_Date: '2026-10-10', Move_Out_Date: '2026-10-05' }).includes('before'), 'move-out before move-in refused');

// ---------------- isBackgroundWO: Eastern calendar day ----------------
const t1 = { Move_In_Date: '2026-10-01' };
ok(isBackgroundWO(t1, { Created_Date: '2026-09-30T23:30:00.000Z' }) === true, 'created Sep 30 7:30pm ET = background');
ok(isBackgroundWO(t1, { Created_Date: '2026-10-01T01:00:00.000Z' }) === true, 'created Sep 30 9pm ET (01:00 UTC Oct 1) = background (the old UTC compare got this wrong)');
ok(isBackgroundWO(t1, { Created_Date: '2026-10-01T04:30:00.000Z' }) === false, 'created Oct 1 12:30am ET = the tenant\'s');
ok(isBackgroundWO(t1, { Created_Date: '2026-10-01' }) === false, 'date-only on the move-in day = the tenant\'s');
ok(isBackgroundWO(t1, { Created_Date: '2026-09-15' }) === true, 'date-only earlier = background');
ok(isBackgroundWO({ Move_In_Date: '' }, { Created_Date: '2020-01-01' }) === false, 'no move-in date = not background (legacy)');

// ---------------- isTenantCurrent / tenantMovedOut ----------------
const etToday = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const addDays = (d, k) => new Date(Date.parse(d + 'T12:00:00Z') + k * 86400000).toISOString().slice(0, 10);
ok(isTenantCurrent({ ID: '1', Active: 'TRUE', Move_Out_Date: etToday }) === true, 'moving out TODAY = still current through today');
ok(isTenantCurrent({ ID: '1', Active: 'TRUE', Move_Out_Date: addDays(etToday, -1) }) === false, 'moved out yesterday = not current');
ok(isTenantCurrent({ ID: '1', Active: 'TRUE', Move_Out_Date: addDays(etToday, 30) }) === true, 'future move-out = current');
ok(isTenantCurrent({ ID: '1', Active: 'FALSE' }) === false, 'inactive not current');
ok(tenantMovedOut({ Active: 'FALSE' }) && !tenantMovedOut({ Active: 'TRUE' }) && !tenantMovedOut({}) && !tenantMovedOut(null), 'tenantMovedOut basics (partial objects are not "moved out")');

// ---------------- SMS gate: moved-out tenants are blocked ----------------
const open = { global: true, propertyOn: true, ownerOn: true, tenantOn: true, tenantOptOut: false, kind: 'tenant' };
ok(smsGateDecision(open).sendOk === true, 'baseline open gate sends');
const g = smsGateDecision({ ...open, tenantMovedOut: true });
ok(!g.sendOk && g.gateSnapshot.includes('Tenant moved out'), 'moved-out tenant is blocked even with every toggle ON');
ok(smsGateDecision({ ...open, kind: 'vendor', vendorOn: true, tenantMovedOut: true }).sendOk === true, 'moved-out flag only affects tenant messages');
// queue re-resolution prefers the current row over an old row with the same number
const oldRow = { ID: '5', Phone: '+14435550101', Property_ID: 'P1', Active: 'FALSE' };
const newRow = { ID: '9', Phone: '(443) 555-0101', Property_ID: 'P1', Active: 'TRUE' };
eq(tenantForQueuedText([oldRow, newRow], '+14435550101', 'P1').ID, '9', 'same phone twice: the CURRENT tenant wins');
eq(tenantForQueuedText([oldRow], '+14435550101', 'P1').ID, '5', 'only the old row exists: it is returned (and then gated as moved out)');

// ---------------- rosterPlan ----------------
const TODAY = '2026-10-14';
const props = [
  { ID: '31', Address: '525 S Catherine St', Owner_ID: '1', Active: 'TRUE' },
  { ID: '32', Address: '1599 Ingleside Ave', Owner_ID: '1', Active: 'TRUE' },
  { ID: '33', Address: '9 Multi Ct', Owner_ID: '1', Active: 'TRUE' },
  { ID: '90', Address: '77 Other Owner Rd', Owner_ID: '2', Active: 'TRUE' },
];
const units = [{ ID: 'U1', Property_ID: '33', Unit_Label: 'Apt 1', Active: 'TRUE' }, { ID: 'U2', Property_ID: '33', Unit_Label: 'Apt 2', Active: 'TRUE' }];
const T = (o) => Object.assign({ Active: 'TRUE', Unit_ID: '', Email: '', Move_In_Date: '2025-01-01', Move_Out_Date: '' }, o);
const base = () => [
  T({ ID: '59', First_Name: 'Old', Last_Name: 'Tenant', Phone: '+14435550001', Property_ID: '31' }),
  T({ ID: '116', First_Name: 'Cheryl', Last_Name: 'Wagstaf', Phone: '+14432246801', Property_ID: '32' }),
  T({ ID: '200', First_Name: 'Un', Last_Name: 'Rel', Phone: '+14435550999', Property_ID: '90' }),
];
const plan = (rows, tenants, extra) => rosterPlan(Object.assign({ ownerId: '1', today: TODAY, rows, properties: props, units, tenants: tenants || base(), consent: false, batch: 'RB-T' }, extra || {}));
const row = (o) => Object.assign({ property: '525 S. Catherine St', first_name: '', last_name: '', phone: '', email: '', move_in_date: '', move_out_date: '' }, o);

// the cutover shape: old tenant leaves Sep 30, new tenant arrives Oct 1
let p = plan([row({ first_name: 'Old', last_name: 'Tenant', phone: '443-555-0001', move_out_date: '2026-09-30' }), row({ first_name: 'Chelsea', last_name: 'Deane', phone: '(804) 335-8583', move_in_date: '2026-10-01' })]);
ok(p.ok, 'cutover pair validates: ' + JSON.stringify(p.errors.concat(p.rows.flatMap(r => r.errors))));
eq(p.rows.map(r => r.status), ['move_out', 'move_in'], 'statuses');
ok(p.rows[0].write.future === false, 'past move-out is immediate');
const ins = p.rows[1].write.fields;
eq([ins.Active, ins.Move_In_Date, ins.SMS_Enabled, ins.SMS_Consent, ins.Property_ID, ins.Welcome_Sent, ins.Phone], ['TRUE', '2026-10-01', 'FALSE', 'pending', '31', '', '+18043358583'], 'arrival: dated, SMS off + consent pending when the box is not ticked, welcome not sent');
ok(!('SMS_OptOut' in ins) || ins.SMS_OptOut === undefined, 'the tool never sets SMS_OptOut (that is the tenant\'s own STOP)');
p = plan([row({ first_name: 'Chelsea', last_name: 'Deane', phone: '8043358583', move_in_date: '10/1/2026' }), row({ first_name: 'Old', last_name: 'Tenant', phone: '4435550001', move_out_date: '9/30/2026' })], null, { consent: true });
eq([p.rows[0].write.fields.SMS_Enabled, p.rows[0].write.fields.SMS_Consent], ['TRUE', 'attested'], 'consent box ticked -> SMS on + attested');
ok(p.ok, 'order of rows in the file does not matter');

// new tenant without a move-in date is refused; so is a missing move-out target
p = plan([row({ first_name: 'No', last_name: 'Date', phone: '4435559999' })]);
ok(!p.ok && p.rows[0].errors[0].includes('Move-in date is required'), 'arrival without move-in date refused');
p = plan([row({ first_name: 'Ghost', last_name: 'Person', phone: '4435558888', move_out_date: '2026-09-30' })]);
ok(!p.ok && p.rows[0].errors[0].includes('nobody to move out'), 'move-out with no matching tenant refused');
p = plan([row({ first_name: 'Both', last_name: 'Dates', phone: '4435557777', move_in_date: '2026-10-01', move_out_date: '2026-12-01' })]);
ok(!p.ok, 'a brand-new tenant cannot carry a move-out date');
p = plan([row({ first_name: 'Bad', last_name: 'Date', phone: '4435556666', move_in_date: '2026-13-01' })]);
ok(!p.ok && p.rows[0].errors.some(e => e.includes('not a real date')), 'impossible date refused');
p = plan([row({ first_name: 'Far', last_name: 'Future', phone: '4435556655', move_in_date: '2031-01-01' })]);
ok(!p.ok && p.rows[0].errors.some(e => e.includes('out of range')), 'a move-in years ahead is a typo, refused');
p = plan([row({ first_name: 'No', last_name: 'Phone', move_in_date: '2026-10-01' })]);
ok(!p.ok && p.rows[0].errors.some(e => e.includes('Phone number is required')), 'arrival needs a phone');
p = plan([row({ first_name: 'Bad', last_name: 'Phone', phone: '12345', move_in_date: '2026-10-01' })]);
ok(!p.ok, 'invalid phone refused');

// new move-in before the previous tenant left is blocked (no backdating into their work orders)
p = plan([row({ first_name: 'Old', last_name: 'Tenant', phone: '4435550001', move_out_date: '2026-10-05' }), row({ first_name: 'New', last_name: 'One', phone: '4435550002', move_in_date: '2026-10-01' })]);
ok(!p.ok && p.rows[1].errors[0].includes('before the previous tenant'), 'move-in before the old tenant\'s move-out refused');
p = plan([row({ first_name: 'Old', last_name: 'Tenant', phone: '4435550001', move_out_date: '2026-10-05' }), row({ first_name: 'New', last_name: 'One', phone: '4435550002', move_in_date: '2026-10-05' })]);
ok(p.ok, 'move-in on the same day the old tenant leaves is fine');

// future move-out: only recorded + flagged, tenant stays active
p = plan([row({ first_name: 'Old', last_name: 'Tenant', phone: '4435550001', move_out_date: '2026-12-31' })]);
ok(p.ok && p.rows[0].write.future === true && p.counts.future_move_out === 1, 'future move-out is flagged as future');

// name fix amends, never blanks
p = plan([row({ property: '1599 Ingleside', first_name: 'Cheryl', last_name: 'Wagstaff', phone: '(443) 224-6801' })]);
ok(p.ok && p.rows[0].status === 'name_fix', 'same phone, new spelling = name fix without any date');
eq(p.rows[0].write.fields, { Last_Name: 'Wagstaff' }, 'only the changed part is written (amend, not overwrite)');
ok(p.rows[0].warnings.some(w => w.includes('Matched')), 'prefix address match is announced');
p = plan([row({ property: '1599 Ingleside Ave', first_name: 'Cheryl', phone: '(443) 224-6801' })]);
eq(p.rows[0].status, 'unchanged', 'first name only and nothing different = unchanged');
p = plan([row({ property: '1599 Ingleside Ave', first_name: 'Cheryl', last_name: 'Wagstaf', phone: '(443) 224-6801' })]);
eq(p.rows[0].status, 'unchanged', 'identical row = untouched');

// unmatched row with no dates is refused (the force-the-date rule)
p = plan([row({ property: '1599 Ingleside Ave', first_name: 'Brand', last_name: 'New', phone: '4435550123' })]);
ok(!p.ok, 'no dates + no existing tenant = refused');

// ownership: another owner's property is not addressable
p = plan([row({ property: '77 Other Owner Rd', first_name: 'X', last_name: 'Y', phone: '4435550200', move_in_date: '2026-10-01' })]);
ok(!p.ok && p.rows[0].errors[0].includes('not one of your properties'), 'cannot touch another owner\'s property');
p = plan([row({ property_id: '90', first_name: 'X', last_name: 'Y', phone: '4435550200', move_in_date: '2026-10-01' })]);
ok(!p.ok, 'cannot name another owner\'s property id either');
p = plan([row({ property: '77 Other Owner Rd', first_name: 'Un', last_name: 'Rel', phone: '4435550999', move_out_date: '2026-09-30' })], null, { ownerId: '1' });
ok(!p.ok, 'cannot move out another owner\'s tenant');

// a phone that is a current tenant elsewhere is refused unless that tenant leaves in the same file
p = plan([row({ property: '1599 Ingleside Ave', first_name: 'Jen', last_name: 'Elle', phone: '4435550001', move_in_date: '2026-10-01' })]);
ok(!p.ok && p.rows[0].errors[0].includes('already a current tenant'), 'phone already current at another address is refused');
p = plan([row({ first_name: 'Old', last_name: 'Tenant', phone: '4435550001', move_out_date: '2026-09-30' }), row({ property: '1599 Ingleside Ave', first_name: 'Same', last_name: 'Person', phone: '4435550001', move_in_date: '2026-10-01' })]);
ok(p.ok, 'same person moving from one address to another in one file is fine (move-out + move-in)');

// units
p = plan([row({ property: '9 Multi Ct', first_name: 'U', last_name: 'One', phone: '4435550301', move_in_date: '2026-10-01' })]);
ok(!p.ok && p.rows[0].errors[0].includes('has units'), 'property with units requires a unit');
p = plan([row({ property: '9 Multi Ct', unit: 'unit 2', first_name: 'U', last_name: 'Two', phone: '4435550302', move_in_date: '2026-10-01' })]);
ok(p.ok && p.rows[0].write.fields.Unit_ID === 'U2', '"unit 2" matches "Apt 2"');
p = plan([row({ property: '9 Multi Ct', unit: 'Apt 9', first_name: 'U', last_name: 'Nine', phone: '4435550309', move_in_date: '2026-10-01' })]);
ok(!p.ok && p.rows[0].errors[0].includes('not found'), 'unknown unit refused');

// duplicates in one file
p = plan([row({ first_name: 'A', last_name: 'One', phone: '4435550401', move_in_date: '2026-10-01' }), row({ first_name: 'A', last_name: 'One', phone: '4435550401', move_in_date: '2026-10-01' })]);
ok(!p.ok, 'the same new tenant twice in one file is refused');

// re-running an applied file changes nothing
const after = base().map(t => t.ID === '59' ? { ...t, Active: 'FALSE', Move_Out_Date: '2026-09-30' } : t).concat([T({ ID: '300', First_Name: 'Chelsea', Last_Name: 'Deane', Phone: '+18043358583', Property_ID: '31', Move_In_Date: '2026-10-01' })]);
p = plan([row({ first_name: 'Old', last_name: 'Tenant', phone: '4435550001', move_out_date: '2026-09-30' }), row({ first_name: 'Chelsea', last_name: 'Deane', phone: '8043358583', move_in_date: '2026-10-01' })], after);
ok(p.ok && p.rows[0].status === 'already_done' && p.rows[1].status === 'unchanged', 're-run is a no-op (idempotent): ' + JSON.stringify(p.rows.map(r => r.status)));
p = plan([row({ first_name: 'Old', last_name: 'Tenant', phone: '4435550001', move_out_date: '2026-09-29' })], after);
ok(!p.ok, 'moving out an already-gone tenant on a DIFFERENT date is refused, not rewritten');

// file-level limits
ok(!plan([]).ok, 'empty file refused');
ok(!plan(new Array(201).fill(row({ first_name: 'A', phone: '4435550001', move_in_date: '2026-10-01' }))).ok, 'over 200 rows refused');

console.log(n + ' assertions passed');
