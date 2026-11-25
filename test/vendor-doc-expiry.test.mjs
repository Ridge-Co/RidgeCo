// Queue #113 Phase 1: vendor insurance + license dates are recorded, shown and WARNED on, never blocked, nothing is sent.
import fs from 'fs';
import assert from 'assert';
import test from 'node:test';
const wsrc = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
function grabLine(sig) { const s = wsrc.indexOf(sig); if (s < 0) throw new Error('not found: ' + sig); return wsrc.slice(s, wsrc.indexOf('\n', s)); }
function grabFn(sig) {
  const s = wsrc.indexOf(sig); if (s < 0) throw new Error('not found: ' + sig);
  const open = wsrc.indexOf('{', wsrc.indexOf(')', s));
  let d = 0, i = open;
  for (; i < wsrc.length; i++) { if (wsrc[i] === '{') d++; else if (wsrc[i] === '}') { d--; if (!d) break; } }
  return wsrc.slice(s, i + 1);
}
const pure = new Function([grabLine('const VENDOR_DOC_COLS'), grabLine('const VENDOR_DOC_WARN_DAYS'), grabFn('function vendorDocDayNumber('), grabFn('function vendorDocDateWords('),
  grabFn('function vendorDocOne('), grabFn('function vendorDocStatus('), grabFn('function vendorDocDigestLines(')].join('\n') + '\nreturn { vendorDocStatus, vendorDocDigestLines, vendorDocDayNumber, VENDOR_DOC_COLS };')();
const { vendorDocStatus, vendorDocDigestLines, vendorDocDayNumber } = pure;
const TODAY = '2026-11-24';
const V = (o) => Object.assign({ ID: '1', Name: "Joe's Plumbing" }, o);

test('blank dates are missing, quiet, and never yellow', () => {
  const s = vendorDocStatus(V({}), TODAY);
  assert.strictEqual(s.insurance.state, 'missing'); assert.strictEqual(s.license.state, 'missing');
  assert.deepStrictEqual(s.warnings, []); assert.deepStrictEqual(s.notes, ['No insurance on file', 'No license on file']); assert.strictEqual(s.level, 'missing');
});
test('expired, expiring today, expiring in 30 days, ok at 31 days', () => {
  assert.strictEqual(vendorDocStatus(V({ Insurance_Expiry: '2026-10-03' }), TODAY).insurance.state, 'expired');
  assert.strictEqual(vendorDocStatus(V({ Insurance_Expiry: '2026-11-24' }), TODAY).insurance.state, 'expiring');
  assert.strictEqual(vendorDocStatus(V({ Insurance_Expiry: '2026-12-24' }), TODAY).insurance.state, 'expiring');
  assert.strictEqual(vendorDocStatus(V({ Insurance_Expiry: '2026-12-25' }), TODAY).insurance.state, 'ok');
});
test('the warning reads in plain words with the date', () => {
  const s = vendorDocStatus(V({ Insurance_Expiry: '2026-10-03' }), TODAY);
  assert.deepStrictEqual(s.warnings, ["Joe's Plumbing - insurance expired Oct 3 2026"]); assert.strictEqual(s.level, 'problem');
});
test('M/D/YYYY and a timestamp are read; an unreadable date is a warning, never treated as fine', () => {
  assert.strictEqual(vendorDocStatus(V({ Insurance_Expiry: '10/3/2026' }), TODAY).insurance.state, 'expired');
  assert.strictEqual(vendorDocStatus(V({ Insurance_Expiry: '2027-01-05T00:00:00Z' }), TODAY).insurance.state, 'ok');
  const bad = vendorDocStatus(V({ Insurance_Expiry: 'sometime next year' }), TODAY);
  assert.strictEqual(bad.insurance.state, 'missing'); assert.ok(/could not be read/.test(bad.warnings[0])); assert.strictEqual(bad.level, 'problem');
  assert.strictEqual(vendorDocDayNumber('2026-02-31'), null);
});
test('a workers comp waiver is its own flag and does not replace insurance', () => {
  const s = vendorDocStatus(V({ WC_Waiver_On_File: 'TRUE' }), TODAY);
  assert.strictEqual(s.waiver_on_file, true); assert.strictEqual(s.insurance.state, 'missing');
});
test('license expiring is a yellow warning too', () => {
  const s = vendorDocStatus(V({ Insurance_Expiry: '2027-06-01', License_Expiry: '2026-12-01' }), TODAY);
  assert.strictEqual(s.level, 'soon'); assert.ok(/license expires Dec 1 2026 \(in 7 days\)/.test(s.warnings[0]), s.warnings[0]);
});
test('digest: problems listed per vendor, vendors with nothing on file as ONE count line, inactive skipped', () => {
  const lines = vendorDocDigestLines([V({ Insurance_Expiry: '2026-10-03' }), V({ ID: '2', Name: 'B' }), V({ ID: '3', Name: 'C' }), V({ ID: '4', Name: 'D', Active: 'FALSE', Insurance_Expiry: '2020-01-01' })], TODAY);
  assert.strictEqual(lines.length, 2); assert.ok(/expired Oct 3 2026/.test(lines[0])); assert.ok(/^2 active vendors have no insurance or license date/.test(lines[1]));
});

// ---- the two wrappers, run with stubs ----
function wrapper(name, stubs) {
  const names = Object.keys(stubs);
  return new Function(...names, grabFn('async function ' + name + '(') + '\nreturn ' + name + ';')(...names.map(n => stubs[n]));
}
const jsonRes = (o, status = 200) => ({ status, async json() { return o; }, clone() { return this; } });
const baseStubs = (extra) => Object.assign({ json: jsonRes, softFail: async () => ({}), etTodayISO: () => TODAY, vendorDocStatus, fetchTab: async () => [V({ Insurance_Expiry: '2026-10-03' })], logWOAudit: async () => {} }, extra);

test('/assign wrapper: assignment answer kept, warnings added, history line written, NOT blocked', async () => {
  const audits = [];
  const f = wrapper('assignVendorWithDocCheck', baseStubs({ assignVendor: async () => jsonRes({ success: true, vendor_sms: true }), logWOAudit: async (...a) => { audits.push(a); } }));
  const out = await f({}, { wo_id: 'WO-1', vendor_id: '1' });
  const d = await out.json();
  assert.strictEqual(d.success, true); assert.strictEqual(d.vendor_sms, true); assert.strictEqual(d.doc_warnings.length, 1);
  assert.strictEqual(audits.length, 1); assert.strictEqual(audits[0][4], 'Vendor_Docs');
});
test('/assign wrapper: a failed assignment passes straight through, no doc work', async () => {
  let read = 0;
  const f = wrapper('assignVendorWithDocCheck', baseStubs({ assignVendor: async () => jsonRes({ error: 'WO not found' }, 404), fetchTab: async () => { read++; return []; } }));
  const out = await f({}, { wo_id: 'x', vendor_id: '1' });
  assert.strictEqual(out.status, 404); assert.strictEqual(read, 0);
});
test('/assign wrapper: a failing check is REPORTED in the answer and the assignment still succeeds', async () => {
  const fails = [];
  const f = wrapper('assignVendorWithDocCheck', baseStubs({ assignVendor: async () => jsonRes({ success: true }), fetchTab: async () => { throw new Error('quota'); }, softFail: async (...a) => { fails.push(a[1]); } }));
  const d = await (await f({}, { wo_id: 'WO-1', vendor_id: '1' })).json();
  assert.strictEqual(d.success, true); assert.ok(/Could not check/.test(d.doc_check_error)); assert.deepStrictEqual(fails, ['assign:doc-check']);
});
test('/assign wrapper: no warning, no history line', async () => {
  const audits = [];
  const f = wrapper('assignVendorWithDocCheck', baseStubs({ assignVendor: async () => jsonRes({ success: true }), fetchTab: async () => [V({ Insurance_Expiry: '2028-01-01' })], logWOAudit: async (...a) => { audits.push(a); } }));
  const d = await (await f({}, { wo_id: 'WO-1', vendor_id: '1' })).json();
  assert.deepStrictEqual(d.doc_warnings, []); assert.strictEqual(audits.length, 0);
});
const vuStubs = (extra) => Object.assign({ json: jsonRes, softFail: async () => ({}), VENDOR_DOC_WATCHED: [], fetchTab: async () => [V({ Insurance_Expiry: '2026-01-01' })], updateRow: async () => jsonRes({ success: true }), logTelemetry: async () => {} }, extra);
function vuWrapper(extra) {
  const watched = grabLine('const VENDOR_DOC_WATCHED').replace('const VENDOR_DOC_WATCHED = ', 'return ').replace(/;$/, ';');
  const W = new Function(watched)();
  return wrapper('vendorUpdateLoggingDocs', vuStubs(Object.assign({ VENDOR_DOC_WATCHED: W }, extra)));
}
test('/vendor/update: a doc-date change is logged with old and new value, save unchanged', async () => {
  const logs = [];
  const f = vuWrapper({ logTelemetry: async (_e, r) => { logs.push(r); } });
  const out = await f({}, { id: '1', fields: { Insurance_Expiry: '2027-01-01' } });
  assert.strictEqual((await out.json()).success, true);
  assert.strictEqual(logs.length, 1); assert.strictEqual(logs[0].Job_Type, 'vendor_doc_change'); assert.ok(/"2026-01-01" -> "2027-01-01"/.test(logs[0].Notes));
});
test('/vendor/update: an unrelated edit logs nothing and reads nothing extra', async () => {
  let reads = 0, logs = 0;
  const f = vuWrapper({ fetchTab: async () => { reads++; return []; }, logTelemetry: async () => { logs++; } });
  await f({}, { id: '1', fields: { Phone: '5551234' } });
  assert.strictEqual(reads, 0); assert.strictEqual(logs, 0);
});
test('/vendor/update: a failed log is reported in the answer, the save stands', async () => {
  const f = vuWrapper({ logTelemetry: async () => { throw new Error('sheet down'); } });
  const d = await (await f({}, { id: '1', fields: { License_Expiry: '2027-02-02' } })).json();
  assert.strictEqual(d.success, true); assert.ok(/could not be logged/.test(d.doc_log_error));
});
test('wiring: routes, columns and digest', () => {
  assert.ok(/if \(path === '\/assign'\)\s+return await assignVendorWithDocCheck\(env, body\);/.test(wsrc));
  assert.ok(/path === '\/vendor\/update'\)\s+\{ await ensureColumns\(env, 'Vendors', .*VENDOR_DOC_COLS\)\); return await vendorUpdateLoggingDocs\(env, body\); \}/.test(wsrc));
  assert.ok(/vendorDocs: vendorDocDigestLines\(activeRows\(vendors\), today\),/.test(wsrc));
  assert.ok(/▶ VENDOR DOCUMENTS/.test(wsrc));
  const assign = grabFn('async function assignVendor(');
  assert.ok(!/vendorDocStatus/.test(assign), 'assignVendor itself is untouched (other tests run it alone)');
});
test('nothing here sends a message or blocks: no sms / email / 4xx in the new code', () => {
  const block = wsrc.slice(wsrc.indexOf('// ── VENDOR INSURANCE + LICENSE EXPIRY'), wsrc.indexOf('// ── QUICKBOOKS → HUB VENDOR SYNC (Oct 5 2026)'));
  assert.ok(!/smsGatedSend|gmailSendEmail|sendSms|json\(\{[^}]*\}, 4\d\d\)/.test(block));
});
test('Hub screen: the Edit Vendor box has the fields and saves them; the Assign box shows the warning line and still assigns', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  for (const id of ['ev-ins-expiry', 'ev-ins-url', 'ev-lic-number', 'ev-lic-expiry', 'ev-lic-url', 'ev-wc-waiver', 'ev-wc-waiver-date', 'ev-wc-waiver-url', 'assign-doc-warning'])
    assert.ok(html.includes('id="' + id + '"'), id);
  for (const col of ['Insurance_Expiry', 'Insurance_Cert_URL', 'License_Number', 'License_Expiry', 'License_Doc_URL', 'WC_Waiver_On_File', 'WC_Waiver_Date', 'WC_Waiver_Doc_URL'])
    assert.ok(html.includes(col + ':document.getElementById('), 'saved: ' + col);
  assert.ok(/You can still assign\./.test(html));
  const submit = html.slice(html.indexOf('function submitAssign()'), html.indexOf('function submitAssign()') + 700);
  assert.ok(/api\('POST','\/assign',\{wo_id:assignWOId,vendor_id:vendorId\}\)/.test(submit) && !/doc_warnings[^\n]*return/.test(submit), 'the button never waits on or is blocked by the warning');
});
