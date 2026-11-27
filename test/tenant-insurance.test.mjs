// Queue #136: renters-insurance record. Pure functions + wiring pins, run against the live worker.js / index.html source.
import fs from 'fs';
const src = fs.readFileSync('worker.js', 'utf8'), html = fs.readFileSync('index.html', 'utf8');
function grab(name, from = src) {
  let i = from.indexOf('async function ' + name + '('); if (i < 0) i = from.indexOf('function ' + name + '('); if (i < 0) throw new Error('missing ' + name);
  let d = 0, j = from.indexOf('{', i); for (; j < from.length; j++) { if (from[j] === '{') d++; else if (from[j] === '}') { d--; if (!d) break; } }
  return from.slice(i, j + 1);
}
const consts = src.match(/const TENANT_INSURANCE_COLS[\s\S]*?const TENANT_INSURANCE_MAX_BYTES[^\n]*\n/)[0];
const { tenantInsuranceStatus, tenantInsurancePlan, tenantInsuranceChangeNote, TENANT_INSURANCE_COLS, TENANT_INSURANCE_MIME } = new Function(consts + grab('tenantInsuranceStatus') + grab('tenantInsurancePlan') + grab('tenantInsuranceChangeNote') + '\nreturn {tenantInsuranceStatus,tenantInsurancePlan,tenantInsuranceChangeNote,TENANT_INSURANCE_COLS,TENANT_INSURANCE_MIME};')();
let pass = 0, fail = 0; const t = (n, c, x) => { if (c) pass++; else { fail++; console.log('FAIL:', n, x === undefined ? '' : JSON.stringify(x)); } };

t('blank tenant = none (no tag)', tenantInsuranceStatus({}, '2026-11-26').state === 'none');
t('null tenant = none', tenantInsuranceStatus(null, '2026-11-26').state === 'none');
t('carrier only = on_file', tenantInsuranceStatus({ Renters_Ins_Carrier: 'State Farm' }, '2026-11-26').state === 'on_file');
t('future expiry = on_file', tenantInsuranceStatus({ Renters_Ins_Carrier: 'X', Renters_Ins_Expiry: '2027-01-01' }, '2026-11-26').state === 'on_file');
t('expiry today is still on_file', tenantInsuranceStatus({ Renters_Ins_Expiry: '2026-11-26' }, '2026-11-26').state === 'on_file');
t('past expiry = expired', tenantInsuranceStatus({ Renters_Ins_Expiry: '2026-11-25' }, '2026-11-26').state === 'expired');
t('certificate only = on_file', tenantInsuranceStatus({ Renters_Ins_Cert_File_ID: 'abc' }, '2026-11-26').state === 'on_file');
t('unparseable expiry never marks expired', tenantInsuranceStatus({ Renters_Ins_Carrier: 'X', Renters_Ins_Expiry: 'soon' }, '2026-11-26').state === 'on_file');

const now = '2026-11-26T12:00:00.000Z';
let p = tenantInsurancePlan({ Renters_Ins_Carrier: '  Lemonade ', Renters_Ins_Expiry: '2027-03-01', Renters_Ins_Policy_Ref: 'P-1' }, 'admin', now);
t('plan trims and stamps', !p.error && p.fields.Renters_Ins_Carrier === 'Lemonade' && p.fields.Renters_Ins_Updated_At === now && p.fields.Renters_Ins_Updated_By === 'admin', p);
t('plan refuses a caller-set certificate id', !!tenantInsurancePlan({ Renters_Ins_Cert_File_ID: 'x' }, 'a', now).error);
t('plan refuses a caller-set Updated_By', !!tenantInsurancePlan({ Renters_Ins_Updated_By: 'x' }, 'a', now).error);
t('plan refuses 2026-02-30', !!tenantInsurancePlan({ Renters_Ins_Expiry: '2026-02-30' }, 'a', now).error);
t('plan refuses 03/01/2027', !!tenantInsurancePlan({ Renters_Ins_Expiry: '03/01/2027' }, 'a', now).error);
t('plan allows clearing the expiry', tenantInsurancePlan({ Renters_Ins_Expiry: '' }, 'a', now).fields.Renters_Ins_Expiry === '');
t('plan refuses a 121-char carrier', !!tenantInsurancePlan({ Renters_Ins_Carrier: 'x'.repeat(121) }, 'a', now).error);
t('no insurance keys = no fields and no stamp', Object.keys(tenantInsurancePlan({ First_Name: 'A' }, 'a', now).fields).length === 0);
const note = tenantInsuranceChangeNote('7', { Renters_Ins_Carrier: 'A', Renters_Ins_Policy_Ref: 'SECRET-123' }, { Renters_Ins_Carrier: 'B', Renters_Ins_Policy_Ref: 'SECRET-999' });
t('history note shows carrier change', /Carrier: "A" -> "B"/.test(note), note);
t('history note never carries the policy ref', !/SECRET/.test(note) && /policy ref changed/.test(note), note);
t('certificate types are image or pdf only', TENANT_INSURANCE_MIME.every(m => m.startsWith('image/') || m === 'application/pdf') && !TENANT_INSURANCE_MIME.includes('text/html'));
t('six additive columns, ensureColumns-able', TENANT_INSURANCE_COLS.length === 6 && TENANT_INSURANCE_COLS.every(c => c.startsWith('Renters_Ins_')));

// Wiring pins
t('admin update routes insurance keys to the guarded writer', /startsWith\('Renters_Ins_'\)\)\) return await tenantInsuranceUpdate/.test(src));
t('insurance update uses ensureColumns, never ensureTab', /ensureColumns\(env, 'Tenants', TENANT_INSURANCE_COLS\)/.test(src) && !/ensureTab\(env, 'Tenants'/.test(src));
t('insurance writes are read back (updateRowVerified)', (grab('tenantInsuranceUpdate') + grab('tenantInsuranceCert')).split('updateRowVerified').length >= 4);
const pub = src.slice(src.indexOf('const PUBLIC_PATHS'), src.indexOf('];', src.indexOf('const PUBLIC_PATHS')));
const roles = src.slice(src.indexOf('const ROLE_SCOPES = {'), src.indexOf('\n};', src.indexOf('const ROLE_SCOPES = {')));
t('POST cert route exists', /path === '\/tenant\/insurance-cert'\)\s+return await tenantInsuranceCert\(/.test(src));
t('cert + update routes are in NO PUBLIC_PATHS and NO ROLE_SCOPES list', !/insurance-cert|\/tenant\/update/.test(pub + roles));
const viewer = grab('tenantInsuranceCertView');
t('viewer refuses every role session', /if \(callerRole\) return json\(\{ error: 'Not found' \}, 404\)/.test(viewer));
t('viewer never shares the file', !/driveShareAnyone/.test(viewer + grab('tenantInsuranceCert')));
t('cert upload goes to a private _Internal folder', /_Internal — Tenant Insurance/.test(grab('tenantInsuranceCert')));
t('staging write guard covers the cert route (TEST- tenants only)', /path === '\/tenant\/insurance-cert'\) return await isTestRecord\(env, 'Tenants', _b\.tenant_id\)/.test(src));
t('no swallowing catches in the insurance code', !/catch\s*\(\w*\)\s*\{\s*\}/.test(consts + grab('tenantInsuranceUpdate') + grab('tenantInsuranceCert') + viewer));
// Nothing external reads the columns
for (const fn of ['enrichWO', 'tenantSessionFields', 'ownerRosterList']) t(fn + ' does not mention insurance columns', !/Renters_Ins/.test(grab(fn)));
t('no reminder or requirement is wired to the columns (reserved Config keys read by nothing)', (src.match(/Renters_Ins_Required|Renters_Ins_Reminders_Enabled/g) || []).length === 0 || !/getConfig[^\n]*Renters_Ins_(Required|Reminders)/.test(src));
t('nothing sends a text or email for insurance', !/smsGatedSend[^\n]*Renters_Ins|Renters_Ins[^\n]*smsGatedSend/.test(src));
// Hub
t('modal block present, collapsed by default, real button + sibling hidden file input', /<details id="et-ins-block"/.test(html) && /id="et-ins-file" accept="image\/\*,application\/pdf" style="display:none"/.test(html) && !/<label[^>]*>[^<]*<input type="file" id="et-ins-file"/.test(html));
t('no capture= on the insurance file input', !/id="et-ins-file"[^>]*capture/.test(html));
t('list shows a tag only when there is something to say', /function tenantInsTag[\s\S]{0,700}return '';/.test(html));
t('Hub save sends the three editable fields', /Renters_Ins_Carrier:document\.getElementById\('et-ins-carrier'\)\.value,Renters_Ins_Expiry:/.test(html));
t('Hub state helper matches the Worker (none/on_file/expired)', ['none', 'on_file', 'expired'].every(w => grab('tenantInsState', html).includes(w)));
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
