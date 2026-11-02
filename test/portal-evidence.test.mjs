// Portal proof of use (Oct 23 2026): who counts as "has used their portal", and the activity stamp.
import fs from 'fs';
const src = fs.readFileSync('worker.js', 'utf8');
function grab(name) {
  let i = src.indexOf('async function ' + name + '(');
  if (i < 0) i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  let d = 0, j = src.indexOf('{', i);
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i, j + 1);
}
let pass = 0, fail = 0;
const t = (n, c) => { if (c) pass++; else { fail++; console.log('FAIL:', n); } };

const store = { Tenants: [], Vendors: [], Owners: [] }, upd = [], tele = [], ens = [];
let readThrows = false, writeThrows = false, reads = 0;
const mk = new Function('fetchTab', 'ensureColumns', 'updateRowVerified', 'logTelemetry',
  'const PORTAL_LOGIN_COLS=["First_Login_Date","Last_Login_Date","Login_Count","Login_Evidence"];\n' +
  'const PORTAL_TAB_BY_ROLE={tenant:"Tenants",vendor:"Vendors",owner:"Owners"};\nconst PORTAL_ACT_RECHECK_MS=12*3600*1000;\nconst __portalActSeen=new Map();\n' +
  grab('stampPortalActivity') + '\n' + grab('portalEvidenceFromRecords') + '\nreturn { stampPortalActivity, portalEvidenceFromRecords };');
const { stampPortalActivity, portalEvidenceFromRecords } = mk(
  async (env, tab) => { reads++; if (readThrows) throw new Error('Sheets read failed'); return store[tab]; },
  async (env, tab, cols) => { ens.push(tab); },
  async (env, tab, id, f) => { if (writeThrows) throw new Error('did not keep'); upd.push({ tab, id, f }); },
  async (env, rec) => { tele.push(rec); });

// ---- evidence rules
const d = {
  vendors: [{ ID: '2', Name: 'Alex Busey' }, { ID: '4', Name: 'Oscar Padilla' }, { ID: '6', Name: 'Allen George' }, { ID: '9', Name: 'TEST-Gina' }, { ID: '30', Name: 'Pat Dup' }, { ID: '31', Name: 'Pat Dup' }],
  tenants: [{ ID: '10', First_Name: 'Matt' }, { ID: '87', First_Name: 'Matt' }, { ID: '28', First_Name: 'Abby' }, { ID: '103', First_Name: 'Lance', Last_Name: 'Serafica' }, { ID: '5', First_Name: 'Zed', Last_Name: 'Quiet' }],
  timeEntries: [{ Role: 'hub', Entered_By_ID: 'hub' }, { Role: 'vendor', Entered_By_ID: '6', Start_DateTime: '2026-07-01T10:00:00Z' }],
  receipts: [{ Role: 'hub', Added_By_ID: 'hub', Date: '2026-08-04' }, { Role: 'vendor', Added_By_ID: '2', Date: '2026-09-28' }],
  estimates: [{ Created_By: 'admin', Created_Date: '2026-09-01' }, { Created_By: 'Allen George', Created_Date: '2026-09-16T22:45:30Z' }],
  woAudit: [
    { Changed_By: 'Oscar Padilla', Changed_By_Role: 'vendor', Field: 'Status', New_Value: 'Accepted', Timestamp: '2026-08-15' },
    { Changed_By: 'Oscar Padilla', Changed_By_Role: 'vendor', Field: 'Status', New_Value: 'Declined', Notes: 'Declined via SMS reply', Timestamp: '2026-08-16' },
    { Changed_By: 'Alex Busey', Changed_By_Role: 'vendor', Field: 'Status', New_Value: 'Complete', Timestamp: '2026-08-30' },
    { Changed_By: 'Abby', Changed_By_Role: 'tenant', Field: 'Notes', New_Value: 'hot water', Timestamp: '2026-10-21T10:00:00Z' },
    { Changed_By: 'Matt', Changed_By_Role: 'tenant', Field: 'Notes', New_Value: 'x', Timestamp: '2026-10-01' },
    { Changed_By: 'Pat Dup', Changed_By_Role: 'vendor', Field: 'Status', New_Value: 'Complete', Timestamp: '2026-10-01' },
    { Changed_By: 'Admin', Changed_By_Role: 'admin', Field: 'Status', New_Value: 'Complete', Timestamp: '2026-10-01' },
  ],
  workOrders: [
    { Type: 'tenant', Tenant_ID: '103', Created_By: 'Lance Serafica', Created_Date: '2026-09-22T00:00:00Z' },
    { Type: 'tenant', Tenant_ID: '87', Created_By: 'Matt', Created_Date: '2026-09-21T00:00:00Z' },
    { Type: 'manual', Tenant_ID: '5', Created_By: 'Zed', Created_Date: '2026-09-21' },
    { Type: 'tenant', Tenant_ID: '5', Created_By: 'admin', Created_Date: '2026-09-21' },
  ],
};
const ev = portalEvidenceFromRecords(d);
const has = k => ev.has(k);
t('vendor time entry counts', has('vendor|6'));
t('admin ("hub") time entry does not count', !ev.has('vendor|hub'));
t('vendor receipt counts', has('vendor|2'));
t('vendor-created estimate counts', ev.get('vendor|6').kinds.includes('estimates'));
t('admin estimate does not count for anyone', ![...ev.keys()].some(k => /admin/i.test(k)));
t('vendor Accepted/Declined only (could be a text reply) does NOT count', !has('vendor|4'));
t('vendor Complete status counts', ev.get('vendor|2').kinds.includes('job status updates'));
t('tenant note on a work order counts', has('tenant|28'));
t('ambiguous first name "Matt" is not guessed from an audit note', !ev.get('tenant|10'));
t('tenant who created a WO counts by Tenant_ID even if the first name is shared', has('tenant|87') && ev.get('tenant|87').kinds.includes('created work orders'));
t('tenant full-name WO creator counts', has('tenant|103'));
t('WO typed manual / created by admin never counts', !has('tenant|5'));
t('test vendors are ignored', !has('vendor|9'));
t('two vendors with the same name are not guessed', !has('vendor|30') && !has('vendor|31'));
t('last-used date is the newest action', ev.get('vendor|6').last === '2026-09-16');
t('evidence text says it is prior use', /^prior use \(before login tracking\): /.test(ev.get('vendor|6').text));

// ---- activity stamp
store.Vendors = [{ ID: '6', First_Login_Date: '', Login_Evidence: '' }, { ID: '7', First_Login_Date: '2026-09-01T00:00:00Z' }, { ID: '8', Login_Evidence: 'prior use: x' }];
await stampPortalActivity({}, 'vendor', '6', '/estimate');
t('first activity writes Login_Evidence', upd.length === 1 && /^portal use: vendor session called \/estimate on 20\d\d-/.test(upd[0].f.Login_Evidence));
t('login columns are created first', ens.includes('Vendors'));
const readsAfter = reads;
await stampPortalActivity({}, 'vendor', '6', '/time-entry/add');
t('same person again within 12 h costs no Sheets read and no write', reads === readsAfter && upd.length === 1);
await stampPortalActivity({}, 'vendor', '7', '/status');
t('someone with a recorded login is not touched', upd.length === 1);
await stampPortalActivity({}, 'vendor', '8', '/status');
t('someone with evidence already is not overwritten', upd.length === 1);
await stampPortalActivity({}, 'vendor', '999', '/status');
t('unknown id writes nothing', upd.length === 1 && tele.length === 0);
await stampPortalActivity({}, 'admin', '1', '/x');
t('non-portal roles are ignored', upd.length === 1);
store.Tenants = [{ ID: '4' }];
writeThrows = true;
let threw = false;
try { await stampPortalActivity({}, 'tenant', '4', '/workorder'); } catch (e) { threw = true; }
t('a failed stamp never throws (the request must still work)', !threw);
t('a failed stamp is logged loudly', tele.length === 1 && tele[0].Success === 'FALSE' && tele[0].Job_Type === 'portal_activity_stamp_failed' && /Tenants 4/.test(tele[0].Notes));
writeThrows = false;
await stampPortalActivity({}, 'tenant', '4', '/workorder');
t('after a failure it tries again on the next request', upd.length === 2 && upd[1].tab === 'Tenants');
readThrows = true;
await stampPortalActivity({}, 'owner', '1', '/owner-workorders');
t('a failed read is also logged, not swallowed', tele.length === 2 && /Owners 1/.test(tele[1].Notes));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
