// Oct 19 2026 — approving an estimate after the job is already done must be able to SKIP the vendor "job approved" text.
// Runs the REAL approveEstimate from worker.js against in-memory fakes, plus static checks on the index.html checkbox.
import fs from 'fs';
import assert from 'node:assert';
const w = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function grab(sig, src) {
  src = src || w;
  const i = src.indexOf(sig); if (i < 0) throw new Error('missing ' + sig);
  let d = 0, j = src.indexOf('{', src.indexOf(')', i));
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i, j + 1);
}
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

function harness({ smsThrows = false } = {}) {
  const calls = { sms: [], writes: [], stage: [], telemetry: [] };
  const deps = {
    json: (o, s) => ({ body: o, status: s || 200 }),
    fetchTabs: async () => [[{ ID: 'E1', WO_ID: 'WO-1', Version: '1', Status: 'Pending', Vendor_ID: '3', Active: 'TRUE' }], [{ ID: 'WO-1' }]],
    addonEstimateActionBlock: () => '',
    findWO: (rows, id) => rows.find(r => r.ID === id),
    sheetsRequest: async (env, method, path, body) => { if (method === 'GET') return { values: [['ID', 'Status', 'Approved_By', 'Approved_Date', 'Approval_Note'], ['E1', 'Pending']] }; calls.writes.push(body); return {}; },
    setApprovalStage: async (env, a) => { calls.stage.push(a); },
    notifyVendorTemplated: async (env, key, wo, vendor) => { calls.sms.push([key, wo, vendor]); if (smsThrows) throw new Error('twilio down'); return { sent: true }; },
    logTelemetry: async (env, row) => { calls.telemetry.push(row); },
  };
  const names = Object.keys(deps);
  const fn = new Function(...names, grab('async function approveEstimate(') + '\nreturn approveEstimate;')(...names.map(k => deps[k]));
  return { fn, calls };
}

// default: vendor IS texted (unchanged behaviour)
{ const { fn, calls } = harness(); const r = await fn({}, { wo_id: 'WO-1', approved_by: 'brett' });
  ok(calls.sms.length === 1 && calls.sms[0][0] === 'vendor_estimate_approved', 'default approve texts the vendor');
  ok(r.body.vendor_sms === 'sent' && r.body.vendor_sms_skipped === false, 'result says sent, not skipped'); }

// skip: no text, approval still saved, stage still moves, note records why
for (const v of [true, 'true', 'TRUE']) {
  const { fn, calls } = harness(); const r = await fn({}, { wo_id: 'WO-1', skip_vendor_sms: v });
  ok(calls.sms.length === 0, 'skip_vendor_sms=' + v + ' sends NO vendor text');
  ok(r.body.success === true && r.body.vendor_sms_skipped === true && /skipped/.test(r.body.vendor_sms), 'result reports the skip (not "no vendor")');
  ok(calls.stage.length === 1 && calls.stage[0].stage === 'Approved', 'approval stage still set when the text is skipped');
  const noteWrite = JSON.stringify(calls.writes[0]);
  ok(/vendor not texted/.test(noteWrite), 'Approval_Note records that the vendor was not texted');
}
// anything else does NOT skip
for (const v of [false, 'false', undefined, 0, '']) {
  const { fn, calls } = harness(); await fn({}, { wo_id: 'WO-1', skip_vendor_sms: v });
  ok(calls.sms.length === 1, 'skip_vendor_sms=' + String(v) + ' still texts the vendor');
}
// deposit variant is skipped too
{ const { fn, calls } = harness(); await fn({}, { wo_id: 'WO-1', request_deposit: true, skip_vendor_sms: true }); ok(calls.sms.length === 0, 'deposit approval can skip the text too'); }
// a failing text is surfaced and logged, approval kept
{ const { fn, calls } = harness({ smsThrows: true }); const r = await fn({}, { wo_id: 'WO-1' });
  ok(r.body.success === true && /text failed: twilio down/.test(r.body.vendor_sms), 'a failed vendor text is reported, not swallowed');
  ok(calls.telemetry.length === 1 && calls.telemetry[0].Success === 'FALSE', 'failed vendor text logged to telemetry'); }

// UI
ok(/id="est-skip-sms-/.test(html) && /Do NOT text the vendor/.test(html), 'index.html has the "Do NOT text the vendor" checkbox');
const ui = grab('function approveEstimateUI(', html);
ok(/skip_vendor_sms/.test(ui) && /est-skip-sms-/.test(ui), 'approveEstimateUI reads the checkbox and posts skip_vendor_sms');
console.log('estimate-skip-vendor-sms: ' + n + ' checks passed');
