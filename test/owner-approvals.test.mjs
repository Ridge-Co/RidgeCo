// Owner approvals (queue #138 Phase 1, Nov 17 2026): GET /owner/approvals and POST /owner/approval/respond, behind Config owner_approvals_enabled.
// Drives the REAL worker.js router over a fake Google Sheets with real signed owner session tokens (same harness as owner-write-scope.test.mjs).
// Covers: switch OFF = nothing changes; cards and totals match the sign page; owner A can never see or answer owner B's proposal;
// a saved answer comes before Brett's text; double tap = one text; a signed proposal cannot be declined; failed save = no text;
// refused text = answer still saved + a FAILED telemetry row; a resend clears the answer.
import './_midday-clock.mjs';
import fs from 'fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const wsrc = fs.readFileSync(root + 'worker.js', 'utf8');
let pass = 0, fail = 0;
const t = (name, cond, extra) => { if (cond) pass++; else { fail++; console.log('FAIL:', name, extra === undefined ? '' : JSON.stringify(extra)); } };

function makeStore() {
  const tabs = new Map(); const calls = [];
  const st = { tabs, calls };
  const missing = (name) => ({ error: { code: 400, message: `Unable to parse range: ${name}` } });
  st.handle = async (method, path, body) => {
    calls.push(method + ' ' + path);
    let m;
    if (method === 'GET' && (m = /^\/values\/([^!:?]+)$/.exec(path))) { const n = decodeURIComponent(m[1]); if (!tabs.has(n)) return missing(n); return { range: n, values: tabs.get(n).map(r => r.slice()) }; }
    if (method === 'GET' && (m = /^\/values:batchGet\?(.*)$/.exec(path))) {
      const names = m[1].split('&').map(x => decodeURIComponent(x.replace(/^ranges=/, ''))); const valueRanges = [];
      for (const n of names) { if (!tabs.has(n)) return missing(n); valueRanges.push({ range: n, values: tabs.get(n).map(r => r.slice()) }); }
      return { valueRanges };
    }
    if (method === 'GET' && path.startsWith('?fields=')) return { sheets: [...tabs.keys()].map((title, i) => ({ properties: { sheetId: i + 1, title, gridProperties: { columnCount: 60, rowCount: 1000 } } })) };
    if (method === 'POST' && (m = /^\/values\/([^!:?]+):append/.exec(path))) { const n = decodeURIComponent(m[1]); if (!tabs.has(n)) return missing(n); for (const r of body.values) tabs.get(n).push(r.slice()); return { updates: { updatedRows: body.values.length } }; }
    if (method === 'POST' && path === '/values:batchUpdate') {
      for (const d of body.data) {
        const [tab, cell] = d.range.split('!'); const mm = /^([A-Z]+)(\d+)$/.exec(cell);
        const col = mm[1].split('').reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0) - 1, row = +mm[2] - 1;
        const rows = tabs.get(tab); if (!rows) return missing(tab);
        while (rows.length <= row) rows.push([]); while (rows[row].length <= col) rows[row].push('');
        rows[row][col] = d.values[0][0];
      }
      return { totalUpdatedCells: body.data.length };
    }
    if (method === 'POST' && path === ':batchUpdate') { for (const r of body.requests || []) if (r.addSheet) tabs.set(r.addSheet.properties.title, []); return {}; }
    return { error: { code: 400, message: 'fake sheets: unsupported ' + method + ' ' + path } };
  };
  return st;
}
const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const store = makeStore();
const outbound = []; const twilioCalls = [];
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url; const method = (init && init.method) || 'GET';
  if (url.startsWith('https://oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 'fake-access', expires_in: 3600 }), { status: 200 });
  const m = /^https:\/\/sheets\.googleapis\.com\/v4\/spreadsheets\/TESTSHEET(.*)$/.exec(url);
  if (m) { const b = init && init.body ? JSON.parse(init.body) : undefined; const r = await store.handle(method, decodeURIComponent(m[1]).replace(/%3A/gi, ':'), b); return new Response(JSON.stringify(r), { status: r && r.error ? r.error.code : 200 }); }
  if (/api\.twilio\.com/.test(url)) { twilioCalls.push({ url, body: String((init && init.body) || '') }); return new Response(JSON.stringify({ sid: 'SMTEST', status: 'queued' }), { status: 201 }); }
  outbound.push(method + ' ' + url);
  return new Response(JSON.stringify({ ok: true, id: 'DRIVEFILE', webViewLink: 'x' }), { status: 200 });
};
const worker = (await import(root + 'worker.js')).default;
const BASE = 'https://maintenance-hub.brett-2f8.workers.dev';
const SECRET = 'admin-secret-for-tests-0123456789';
const env = { SHEET_ID: 'TESTSHEET', GOOGLE_SA_KEY: privateKey, GOOGLE_SA_EMAIL: 'sa@test.iam', WORKER_SECRET: SECRET };
let skew = 0; const _realNow = Date.now.bind(Date); Date.now = () => _realNow() + skew;
const call = async (method, path, token, body) => {
  skew += 10000;
  const res = await worker.fetch(new Request(BASE + path, { method, headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { 'X-Auth-Token': token } : {}), body: body === undefined ? undefined : JSON.stringify(body) }), env, { waitUntil() {} });
  let j = null, text = ''; try { text = await res.clone().text(); j = JSON.parse(text); } catch (_) {}
  return { status: res.status, json: j, text };
};
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const mint = (role, id) => { const now = Math.floor(Date.now() / 1000); const body = b64u(JSON.stringify({ role, id, iat: now, exp: now + 3600 })); return body + '.' + crypto.createHmac('sha256', SECRET).update(body).digest('base64url'); };
const tab = (name, headers, rows) => store.tabs.set(name, [headers, ...rows.map(r => headers.map(h => r[h] ?? ''))]);

tab('Properties', ['ID', 'Owner_ID', 'Address', 'Active'], [{ ID: 'P1', Owner_ID: 'O1', Address: '1 Main', Active: 'TRUE' }, { ID: 'P2', Owner_ID: 'O2', Address: '2 Oak', Active: 'TRUE' }]);

const items = (price, extra) => JSON.stringify([{ id: 'i1', area: 'Kitchen', trade: 'Plumbing', description: 'Faucet', variants: [{ key: 'a', label: 'Standard', price }, { key: 'b', label: 'Premium', price: price + 100 }], selected_key: 'a' }, { id: 'i2', description: 'Optional extra', optional: true, variants: [{ key: 'a', label: 'Extra', price: 999 }], selected_key: 'a' }].concat(extra || []));
const SH = ['ID','Property_ID','Unit_ID','Title','Status','Proposal_Text','Proposal_Items_JSON','Sent_Date','Page_First_Viewed','Active','WO_ID','Link_Rev','Line_Items','Owner_Response','Owner_Response_At','Owner_Response_By','Owner_Response_Text'];
const iso = (daysAgo) => new Date(Date.now() - daysAgo * 86400000).toISOString();
tab('Scopes', SH, [
  { ID: 'S1', Property_ID: 'P1', Unit_ID: 'U1', Title: 'Kitchen faucet', Status: 'Proposed', Proposal_Text: 'x', Proposal_Items_JSON: items(500), Sent_Date: iso(3), Active: 'TRUE', Line_Items: '[]' },
  { ID: 'S2', Property_ID: 'P2', Unit_ID: '', Title: 'Other owner job', Status: 'Proposed', Proposal_Text: 'x', Proposal_Items_JSON: items(700), Sent_Date: iso(2), Active: 'TRUE', Line_Items: '[]' },
  { ID: 'S3', Property_ID: 'P1', Unit_ID: '', Title: 'Not sent yet', Status: 'Proposed', Proposal_Text: 'x', Proposal_Items_JSON: items(100), Sent_Date: '', Active: 'TRUE', Line_Items: '[]' },
  { ID: 'S4', Property_ID: 'P1', Unit_ID: '', Title: 'Already signed', Status: 'Pre-approved', Proposal_Text: 'x', Proposal_Items_JSON: items(300), Sent_Date: iso(10), Active: 'TRUE', Line_Items: '[]' },
  { ID: 'S5', Property_ID: 'P1', Unit_ID: '', Title: 'Old answered', Status: 'Proposed', Proposal_Text: 'x', Proposal_Items_JSON: items(300), Sent_Date: iso(200), Active: 'TRUE', Owner_Response: 'declined', Owner_Response_At: iso(150), Line_Items: '[]' },
]);
tab('Scope_Signatures', ['ID','Scope_ID','Signer_Name','Subtotal','Signed_Date','Signed_TS','Active'], [{ ID: 'G1', Scope_ID: 'S4', Signer_Name: 'Olly', Subtotal: '300', Signed_Date: '2026-11-07', Signed_TS: iso(8), Active: 'TRUE' }]);
tab('Units', ['ID','Property_ID','Unit_Label','Active'], [{ ID: 'U1', Property_ID: 'P1', Unit_Label: '3', Active: 'TRUE' }]);
tab('Tenants', ['ID','Property_ID','Unit_ID','First_Name','Last_Name','Phone','Active'], []);
tab('Vendors', ['ID','Name','Phone','Active'], []);
tab('Owners', ['ID','Company'], [{ ID: 'O1', Company: 'One' }, { ID: 'O2', Company: 'Two' }, { ID: 'O3', Company: 'Three' }]);
tab('Config', ['Key','Value'], []);
tab('Ops_Telemetry', ['ID','Timestamp','Source','Job_Type','Skill_Or_Endpoint','Success','Notes'], []);
const OWN1 = mint('owner', 'O1'), OWN2 = mint('owner', 'O2'), OWN3 = mint('owner', 'O3');
const telem = () => (store.tabs.get('Ops_Telemetry') || []).slice(1).map(r => ({ job: r[3], ok: r[5], notes: r[6] }));
const scopeRow = (id) => { const rows = store.tabs.get('Scopes'); const h = rows[0]; const r = rows.find((x, i) => i > 0 && x[0] === id); const o = {}; if (r) h.forEach((k, i) => { o[k] = r[i] || ''; }); return o; };

// 1. switch OFF: nothing changes ----------------------------------------------------------------------------------------
{
  const g = await call('GET', '/owner/approvals', OWN1);
  t('OFF: GET answers enabled:false with no cards', g.status === 200 && g.json && g.json.enabled === false && g.json.cards.length === 0, g);
  const p = await call('POST', '/owner/approval/respond', OWN1, { scope_id: 'S1', action: 'decline', text: 'no thanks', name: 'Olly' });
  t('OFF: POST answers 404 not_available and writes nothing', p.status === 404 && p.json.error === 'not_available' && scopeRow('S1').Owner_Response === '', p);
}
store.tabs.set('Config', [['Key', 'Value'], ['owner_approvals_enabled', 'TRUE'], ['TWILIO_ENABLED', 'TRUE'], ['TWILIO_TEST_MODE', 'FALSE'], ['ADMIN_SMS_PHONE', '+14105550100']]);
env.TWILIO_SID = 'ACTEST'; env.TWILIO_API_SID = 'SKTEST'; env.TWILIO_API_KEY = 'k'; env.TWILIO_AUTH = 'x'; env.TWILIO_FROM = '+14105550199';

// 2. the cards ---------------------------------------------------------------------------------------------------------
let link1 = '';
{
  const g = await call('GET', '/owner/approvals', OWN1);
  const ids = (g.json.cards || []).map(c => c.scope_id).sort().join();
  t('ON: owner O1 sees S1 (waiting) and S4 (signed), not S2 (another owner), S3 (never sent) or S5 (answered over 90 days ago)', g.status === 200 && g.json.enabled === true && ids === 'S1,S4', g.json);
  const c1 = g.json.cards.find(c => c.scope_id === 'S1'), c4 = g.json.cards.find(c => c.scope_id === 'S4');
  t('S1 is waiting with property, unit label, title and a sign link; S4 is approved with no link', c1.state === 'waiting' && c1.property === '1 Main' && c1.unit === '3' && c1.title === 'Kitchen faucet' && /scope-proposal\.html\?t=/.test(c1.link) && c4.state === 'approved' && !c4.link, g.json);
  t('the waiting count is 1', g.json.waiting === 1, g.json);
  link1 = c1.link;
  const view = await call('GET', '/scope-proposal/view?preview=1&t=' + new URL(c1.link).searchParams.get('t'), null);
  t('the card total equals the total on the sign page (500, the optional extra not counted)', c1.total === 500 && view.json && view.json.subtotal === 500, { card: c1.total, view: view.json && view.json.subtotal });
  t('the answer carries no vendor cost, estimate or sum fields', !/Estimate_Amount|vendor_cost|Line_Items|Current_Estimate|rc_materials|"total_spend"|"sum"|"grand_total"/.test(g.text), g.text.slice(0, 300));
  const g3 = await call('GET', '/owner/approvals', OWN3);
  t('an owner with no proposals gets an empty list (the page shows "Nothing is waiting on you")', g3.status === 200 && g3.json.enabled === true && g3.json.cards.length === 0, g3.json);
  const spoof = await call('GET', '/owner/approvals?owner_id=O1', OWN2);
  t('owner O2 naming owner O1 in the query is refused 403', spoof.status === 403, spoof);
  const noAuth = await call('GET', '/owner/approvals', null);
  t('no token: refused', noAuth.status === 401 || noAuth.status === 403, noAuth.status);
}

// 3. another owner cannot answer, including by changing ids -------------------------------------------------------------
{
  const before = telem().length;
  const r1 = await call('POST', '/owner/approval/respond', OWN2, { scope_id: 'S1', action: 'decline', text: 'not mine', name: 'Mallory' });
  t('O2 answering O1\'s proposal: 403, nothing saved, no text', r1.status === 403 && scopeRow('S1').Owner_Response === '' && twilioCalls.length === 0, r1);
  const r2 = await call('POST', '/owner/approval/respond', OWN2, { scope_id: 'S1', owner_id: 'O1', action: 'decline', text: 'not mine', name: 'Mallory' });
  t('O2 sending owner_id O1 in the body: 403', r2.status === 403 && scopeRow('S1').Owner_Response === '', r2);
  const r3 = await call('POST', '/owner/approval/respond', OWN1, { scope_id: 'S2', action: 'decline', text: 'not mine', name: 'Olly' });
  t('O1 answering O2\'s proposal: 403', r3.status === 403 && scopeRow('S2').Owner_Response === '', r3);
  const r4 = await call('POST', '/owner/approval/respond', OWN1, { scope_id: 'S3', action: 'decline', text: 'never sent', name: 'Olly' });
  t('a proposal that was never sent cannot be answered', r4.status === 403 && scopeRow('S3').Owner_Response === '', r4);
  const denied = telem().slice(before).filter(x => x.job === 'owner_approval_denied' && x.ok === 'FALSE');
  t('every refusal left a FAILED telemetry row (3 from the handler, 1 from the router for the spoofed owner_id)', denied.length === 3 && telem().slice(before).some(x => x.job === 'session_identity_mismatch' && x.ok === 'FALSE'), telem().slice(before));
}

// 4. validation ---------------------------------------------------------------------------------------------------------
{
  const noText = await call('POST', '/owner/approval/respond', OWN1, { scope_id: 'S1', action: 'decline', text: '', name: 'Olly' });
  const noName = await call('POST', '/owner/approval/respond', OWN1, { scope_id: 'S1', action: 'decline', text: 'too dear', name: '' });
  const badAct = await call('POST', '/owner/approval/respond', OWN1, { scope_id: 'S1', action: 'approve', text: 'x yes', name: 'Olly' });
  t('a decline needs a reason, a name, and a real action', noText.status === 400 && noName.status === 400 && badAct.status === 400 && scopeRow('S1').Owner_Response === '' && twilioCalls.length === 0, [noText.status, noName.status, badAct.status]);
}

// 5. a question, then a decline, double tap, signed ---------------------------------------------------------------------
{
  const q = await call('POST', '/owner/approval/respond', OWN1, { scope_id: 'S1', action: 'question', text: 'Can the faucet be brushed nickel?', name: 'Olly Owner' });
  const row = scopeRow('S1');
  t('a question is saved (response, who, when, text) and the card stays waiting with question_asked', q.status === 200 && q.json.saved === true && row.Owner_Response === 'question' && row.Owner_Response_By === 'Olly Owner' && /brushed nickel/.test(row.Owner_Response_Text) && !!row.Owner_Response_At, { q: q.json, row });
  t('Brett got exactly one text, plain ASCII, one piece, naming the property and job', twilioCalls.length === 1 && /1\+Main|1%20Main|1 Main/.test(decodeURIComponent(twilioCalls[0].body.replace(/\+/g, ' '))) && decodeURIComponent(twilioCalls[0].body.replace(/\+/g, ' ')).includes('QUESTION'), twilioCalls.map(c => c.body.slice(0, 400)));
  { const txt = decodeURIComponent(twilioCalls[0].body.replace(/\+/g, ' ')).replace(/^.*Body=/, '').split('&')[0]; t('the text is plain ASCII and one SMS piece (160 or fewer characters)', /^[\x20-\x7E]+$/.test(txt) && txt.length <= 160, txt); }
  const g = await call('GET', '/owner/approvals', OWN1);
  t('the list shows the question flag and still waiting', g.json.cards.find(c => c.scope_id === 'S1').state === 'waiting' && g.json.cards.find(c => c.scope_id === 'S1').question_asked === true, g.json.cards);
  const d1 = await call('POST', '/owner/approval/respond', OWN1, { scope_id: 'S1', action: 'decline', text: 'Too expensive for now', name: 'Olly Owner' });
  t('decline saved: state declined and one more text (two in all: one question, one decline)', d1.status === 200 && d1.json.state === 'declined' && scopeRow('S1').Owner_Response === 'declined' && twilioCalls.length === 2, { d1: d1.json, n: twilioCalls.length });
  const d2 = await call('POST', '/owner/approval/respond', OWN1, { scope_id: 'S1', action: 'decline', text: 'Too expensive for now', name: 'Olly Owner' });
  t('double tap within 2 minutes: same answer, flagged duplicate, NO second text', d2.status === 200 && d2.json.duplicate === true && twilioCalls.length === 2, { d2: d2.json, n: twilioCalls.length });
  const g2 = await call('GET', '/owner/approvals', OWN1);
  const c = g2.json.cards.find(x => x.scope_id === 'S1');
  t('after a decline the card is in the answered group with the reason, and the waiting count is 0', c.state === 'declined' && c.response_text === 'Too expensive for now' && !c.link && g2.json.waiting === 0, g2.json);
  const hist = telem().filter(x => /^owner_approval_(declined|question)$/.test(x.job) && x.ok === 'TRUE');
  t('the history keeps both answers (telemetry rows)', hist.length === 2, hist);
  t('a delivered text is marked on the row (Owner_Response_Alerted)', !!scopeRow('S1').Owner_Response_Alerted, scopeRow('S1'));
  // gate D2 (Nov 17 2026): saved but never texted (read-back quota-blocked, owner told "try again"). The same answer again sends the text once, then is a plain duplicate.
  const atBefore = scopeRow('S1').Owner_Response_At;
  { const rows = store.tabs.get('Scopes'); const ci = rows[0].indexOf('Owner_Response_Alerted'); rows.find((x, i) => i > 0 && x[0] === 'S1')[ci] = ''; }
  const d3 = await call('POST', '/owner/approval/respond', OWN1, { scope_id: 'S1', action: 'decline', text: 'Too expensive for now', name: 'Olly Owner' });
  t('saved-but-not-texted retry: Brett is texted now, the answer is not re-saved, and the row is marked', d3.status === 200 && d3.json.alerted === true && twilioCalls.length === 3 && scopeRow('S1').Owner_Response_At === atBefore && !!scopeRow('S1').Owner_Response_Alerted, { d3: d3.json, n: twilioCalls.length });
  const d4 = await call('POST', '/owner/approval/respond', OWN1, { scope_id: 'S1', action: 'decline', text: 'Too expensive for now', name: 'Olly Owner' });
  t('after that, a further tap is a plain duplicate with no text', d4.json.duplicate === true && twilioCalls.length === 3, { d4: d4.json, n: twilioCalls.length });
}
{
  const before = twilioCalls.length;
  const s = await call('POST', '/owner/approval/respond', OWN1, { scope_id: 'S4', action: 'decline', text: 'changed my mind', name: 'Olly' });
  t('a signed proposal cannot be declined afterward (409), nothing saved, no text', s.status === 409 && s.json.error === 'already_signed' && scopeRow('S4').Owner_Response === '' && twilioCalls.length === before, s);
}

// 6. resend puts the card back to waiting ------------------------------------------------------------------------------
{
  t('scopeProposalSend clears the owner response when it stamps a resend (source check)', /_clearResp[\s\S]{0,400}Owner_Response: '', Owner_Response_At: '', Owner_Response_By: '', Owner_Response_Text: ''/.test(wsrc) && /\.\.\._clearResp/.test(wsrc));
  const rows = store.tabs.get('Scopes'); const h = rows[0]; const r = rows.find((x, i) => i > 0 && x[0] === 'S1');
  ['Owner_Response', 'Owner_Response_At', 'Owner_Response_By', 'Owner_Response_Text'].forEach(k => { r[h.indexOf(k)] = ''; });   // what the resend writes
  const g = await call('GET', '/owner/approvals', OWN1);
  t('after the resend clears it the card is waiting again', g.json.cards.find(c => c.scope_id === 'S1').state === 'waiting', g.json.cards);
}

// 7. a failed save: no text, owner told, failure logged -------------------------------------------------------------------
{
  const realFetch = globalThis.fetch; const before = twilioCalls.length; const tb = telem().length;
  globalThis.fetch = async (input, init) => { const u = typeof input === 'string' ? input : input.url; if (/sheets\.googleapis\.com/.test(u) && /batchUpdate/.test(u) && (init && init.method) === 'POST' && /Owner_Response|"values"/.test(String(init && init.body))) return new Response(JSON.stringify({ error: { code: 500, message: 'boom' } }), { status: 500 }); return realFetch(input, init); };
  const r = await call('POST', '/owner/approval/respond', OWN1, { scope_id: 'S1', action: 'decline', text: 'will not save', name: 'Olly' });
  globalThis.fetch = realFetch;
  t('a write that fails: 500 "Not saved, try again.", no text sent', r.status === 500 && /Not saved/.test(r.json.error) && twilioCalls.length === before, r);
  t('the failed save is logged as a FAILED telemetry row', telem().slice(tb).some(x => x.job === 'owner_approval_save_failed' && x.ok === 'FALSE'), telem().slice(tb));
}

// 8. a refused text still leaves the flag and a failed-alert row ----------------------------------------------------------
{
  store.tabs.set('Config', [['Key', 'Value'], ['owner_approvals_enabled', 'TRUE'], ['TWILIO_ENABLED', 'FALSE']]);
  const before = twilioCalls.length; const tb = telem().length;
  const r = await call('POST', '/owner/approval/respond', OWN1, { scope_id: 'S1', action: 'question', text: 'Is this covered by warranty?', name: 'Olly' });
  t('text refused (switch off): the answer is still saved and the owner is told it was saved', r.status === 200 && r.json.saved === true && r.json.alerted === false && scopeRow('S1').Owner_Response === 'question' && twilioCalls.length === before, r);
  t('...and the missed text is logged as a FAILED row so it shows up', telem().slice(tb).some(x => x.job === 'owner_approval_alert_failed' && x.ok === 'FALSE'), telem().slice(tb));
}

// 9. wiring tripwires -----------------------------------------------------------------------------------------------------
{
  const ownerLine = wsrc.split('\n').find(l => /^\s*owner:\s*\['\/(demo\/test-send','\/demo\/test-status','\/)?owner-by-pin'/.test(l)) || '';
  t('both new paths are in the owner role scope', ownerLine.includes("'/owner/approvals'") && ownerLine.includes("'/owner/approval/respond'"));
  t('neither path is public or on the production write allow-list', !/PUBLIC_PATHS = \[[^\]]*owner\/approval/.test(wsrc) && !/HUB_PROD_WRITE_PATHS[^\n]*owner\/approval/.test(wsrc));
  t('owner identity comes from the session (rosterOwnerId), never the body, for owner sessions', /async function ownerApprovalRespond[\s\S]{0,300}rosterOwnerId\(callerRole, callerSessionId, body, null\)/.test(wsrc));
  t('the feature is behind owner_approvals_enabled, blank = OFF', /String\(\(cfg && cfg\.owner_approvals_enabled\) \|\| ''\)\.trim\(\)\.toUpperCase\(\) === 'TRUE'/.test(wsrc));
  const html = fs.readFileSync(root + 'owner.html', 'utf8');
  t('owner.html has the Approvals tab, hidden until the feature is on, and an error state with Try again', /id="tabApprovals" style="display:none"/.test(html) && /oaT\('retry'\)/.test(html));
  t('owner.html shows no sums: no total/sum/balance across jobs in the Approvals code', !/reduce\([^)]*total|oaState\.cards\.reduce|sumTotal|grandTotal|spend/i.test(html.slice(html.indexOf('Approvals tab (queue #138'), html.indexOf('var tenantRosterPanel'))));
  t('owner.html words go through the English/Spanish list (OA_STR)', /var OA_STR = \{\s*en:/.test(html) && /es:\s*\{ tab:'APROBACIONES'/.test(html));
}

console.log(`\nowner-approvals: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
