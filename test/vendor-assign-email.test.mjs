// Nov 5 2026 — Brett: "Send them an email when assigned. Just something basic with a link to the work order, which would be
// on their portal. Period. That will just give us one more point of contact for them."
// Runs the REAL vendorAssignEmailPlan / vendorAssignEmailBuild / sendVendorAssignEmail from worker.js against fakes, plus static
// checks on the assignVendor wiring (called once per assignment, response carries vendor_email_detail, nothing swallowed).
import fs from 'fs';
import assert from 'node:assert';
const w = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
function grab(sig) {
  const i = w.indexOf(sig); if (i < 0) throw new Error('missing ' + sig);
  let d = 0, j = w.indexOf('{', w.indexOf(')', i));
  for (; j < w.length; j++) { if (w[j] === '{') d++; else if (w[j] === '}') { d--; if (!d) break; } }
  return w.slice(i, j + 1);
}
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

// real toggle helpers (so the property "vendor texts" switch is the production one, not a stand-in)
const toggleSrc = w.slice(w.indexOf('const smsToggleOn ='), w.indexOf('\n', w.indexOf('const smsToggleOn =')))
  + '\n' + w.slice(w.indexOf('const PROPERTY_TOGGLES = ['), w.indexOf('function propToggleOn(')) + grab('function propToggleOn(')
  + '\n' + grab('function smsPropertyGateFlags(');

function harness({ gmailThrows = false, staged = false, auditThrows = false, failureThrows = false } = {}) {
  const calls = { mail: [], audit: [], failures: [] };
  const deps = {
    _escHtml: new Function(grab('function _escHtml(') + '\nreturn _escHtml;')(),
    vendorFirstName: v => (v && (v.First_Name || (v.Name || '').split(' ')[0])) || 'there',
    vendorPortalLink: new Function(grab('function vendorPortalLink(') + '\nreturn vendorPortalLink;')(),
    gmailSendEmail: async (env, m) => { calls.mail.push(m); if (gmailThrows) throw new Error('gmail 401'); return staged ? { staged: true, sent: false } : { id: 'g1' }; },
    logMessageAudit: async (env, a) => { calls.audit.push(a); if (auditThrows) throw new Error('sheet down'); },
    reportFailure: async (env, f) => { calls.failures.push(f); if (failureThrows) throw new Error('ledger down'); },
  };
  const names = Object.keys(deps);
  const body = toggleSrc + '\n' + grab('function vendorAssignEmailPlan(') + '\n' + grab('function vendorAssignEmailBuild(') + '\n' + grab('async function sendVendorAssignEmail(')
    + '\nreturn { vendorAssignEmailPlan, vendorAssignEmailBuild, sendVendorAssignEmail };';
  const api = new Function(...names, body)(...names.map(k => deps[k]));
  return Object.assign({ calls }, api);
}

const LIVE = { TWILIO_ENABLED: 'TRUE', TWILIO_TEST_MODE: 'FALSE' };
const V = { ID: '7', Name: 'Cesar Diaz', First_Name: 'Cesar', Email: 'cesar@example.com', Language: 'en' };
const WO = { ID: 'WO-1300', Trade: 'Plumbing', Description: 'Leak under sink', Checklist: '[]' };

// ── the plan (gates) ──
{
  const h = harness();
  ok(h.vendorAssignEmailPlan({ cfg: LIVE, vendor: V, property: {} }).send === true, 'all gates open → send');
  const noMail = h.vendorAssignEmailPlan({ cfg: LIVE, vendor: Object.assign({}, V, { Email: '  ' }), property: {} });
  ok(!noMail.send && noMail.status === 'skipped' && /no email address/.test(noMail.reason), 'no email on file → skipped, with the reason in words');
  const bad = h.vendorAssignEmailPlan({ cfg: LIVE, vendor: Object.assign({}, V, { Email: 'cesar@' }), property: {} });
  ok(!bad.send && bad.status === 'failed' && /not valid/.test(bad.reason), 'a malformed address is a FAILURE (surfaced), not a quiet skip');
  const two = h.vendorAssignEmailPlan({ cfg: LIVE, vendor: Object.assign({}, V, { Email: 'a@x.com, b@x.com' }), property: {} });
  ok(two.status === 'failed', 'two addresses in one field is refused, never sent as a list');
  ok(h.vendorAssignEmailPlan({ cfg: { TWILIO_ENABLED: 'FALSE', TWILIO_TEST_MODE: 'FALSE' }, vendor: V, property: {} }).status === 'skipped', 'master messaging switch OFF → no email');
  ok(h.vendorAssignEmailPlan({ cfg: { TWILIO_ENABLED: '', TWILIO_TEST_MODE: 'FALSE' }, vendor: V, property: {} }).send === false, 'master switch unset → no email');
  const tm = h.vendorAssignEmailPlan({ cfg: { TWILIO_ENABLED: 'TRUE', TWILIO_TEST_MODE: 'TRUE' }, vendor: V, property: {} });
  ok(!tm.send && /Test Mode/.test(tm.reason), 'Test Mode ON → no email to a real vendor (an email has no test redirect)');
  ok(h.vendorAssignEmailPlan({ cfg: { TWILIO_ENABLED: 'TRUE' }, vendor: V, property: {} }).send === false, 'Test Mode unset defaults to ON, like the text side');
  ok(h.vendorAssignEmailPlan({ cfg: LIVE, vendor: Object.assign({}, V, { SMS_Enabled: 'FALSE' }), property: {} }).send === false, "vendor's own messaging switch OFF → no email");
  ok(h.vendorAssignEmailPlan({ cfg: LIVE, vendor: V, property: { SMS_Vendors_Enabled: 'FALSE' } }).send === false, "property's vendor-texts switch OFF → no email");
  ok(h.vendorAssignEmailPlan({ cfg: LIVE, vendor: V, property: { SMS_Vendors_Enabled: '' } }).send === true, 'property switch blank = ON');
  ok(h.vendorAssignEmailPlan({ cfg: LIVE, vendor: Object.assign({}, V, { SMS_OptOut: 'TRUE' }), property: {} }).send === true, 'a STOP text opt-out is a text rule; it does not block the email');
}

// ── the content ──
{
  const h = harness();
  const m = h.vendorAssignEmailBuild({ woId: 'WO-1300', trade: 'Plumbing', address: '12 Oak St Apt 2', vendor: V, link: 'https://ridge-co.github.io/RidgeCo/vendor.html?wo=WO-1300' });
  ok(m.language === 'en' && m.subject === 'New work order assigned — WO WO-1300', 'English subject');
  ok(m.html.includes('href="https://ridge-co.github.io/RidgeCo/vendor.html?wo=WO-1300"'), 'carries the portal link');
  ok(m.html.includes('Hi Cesar') && m.html.includes('12 Oak St Apt 2') && m.html.includes('Plumbing'), 'greets by first name, shows address and trade');
  ok(!/lockbox|tenant|code|phone/i.test(m.html), 'NO lockbox code or tenant contact in the email (those unlock in the portal after Accept)');
  ok(!/wo\.html|share/i.test(m.html), 'never a no-login share link');
  const es = h.vendorAssignEmailBuild({ woId: 'WO-1300', trade: 'Plumbing', address: '12 Oak St', vendor: Object.assign({}, V, { Language: 'es' }), link: 'https://x/y' });
  ok(es.language === 'es' && /Nuevo trabajo asignado/.test(es.subject) && /Ver la orden de trabajo/.test(es.html), 'Spanish vendor gets Spanish');
  const evil = h.vendorAssignEmailBuild({ woId: 'WO-1', trade: '<script>x</script>', address: '"><img src=x>', vendor: Object.assign({}, V, { First_Name: '<b>Hi</b>' }), link: 'https://x/y' });
  ok(!evil.html.includes('<script>') && !evil.html.includes('<img src=x>') && !evil.html.includes('<b>Hi</b>'), 'every inserted value is HTML-escaped');
  const bare = h.vendorAssignEmailBuild({ woId: 'WO-1', trade: '', address: '', vendor: { Name: '' }, link: 'https://x/y' });
  ok(bare.html.includes('Hi there') && !bare.html.includes('( )') && !bare.html.includes(' at <b>'), 'missing trade/address/name still reads cleanly');
}

// ── sending ──
(async () => {
  {
    const h = harness();
    const r = await h.sendVendorAssignEmail({}, { woId: 'WO-1300', wo: WO, vendor: V, property: {}, address: '12 Oak St', cfg: LIVE });
    ok(r.status === 'sent' && r.to === 'cesar@example.com', 'happy path: sent');
    ok(h.calls.mail.length === 1 && h.calls.mail[0].to === 'cesar@example.com', 'exactly one email, to the vendor');
    ok(h.calls.audit.length === 1 && h.calls.audit[0].channel === 'email' && h.calls.audit[0].outcome === 'sent' && h.calls.audit[0].messageType === 'vendor_job_assigned', 'written to the work order audit as a sent email');
    ok(h.calls.failures.length === 0, 'nothing reported as a failure');
  }
  {
    const h = harness();
    const r = await h.sendVendorAssignEmail({}, { woId: 'WO-1300', wo: WO, vendor: V, property: {}, address: '12 Oak St', cfg: { TWILIO_ENABLED: 'TRUE', TWILIO_TEST_MODE: 'TRUE' } });
    ok(r.status === 'skipped' && h.calls.mail.length === 0 && h.calls.audit.length === 0 && h.calls.failures.length === 0, 'gated: nothing sent, reason returned, not treated as a failure');
  }
  {
    const h = harness();
    const r = await h.sendVendorAssignEmail({}, { woId: 'WO-1300', wo: WO, vendor: Object.assign({}, V, { Email: 'nope' }), property: {}, address: 'x', cfg: LIVE });
    ok(r.status === 'failed' && h.calls.mail.length === 0 && h.calls.failures.length === 1 && h.calls.failures[0].where === 'vendor_assign_email', 'bad address: failed, nothing sent, reported to the failure ledger');
  }
  {
    const h = harness({ gmailThrows: true });
    const r = await h.sendVendorAssignEmail({}, { woId: 'WO-1300', wo: WO, vendor: V, property: {}, address: 'x', cfg: LIVE });
    ok(r.status === 'failed' && /gmail 401/.test(r.reason), 'Gmail failure: returned as failed WITH the cause, never thrown');
    ok(h.calls.failures.length === 1 && h.calls.failures[0].severity === 'P2' && /WO-1300/.test(h.calls.failures[0].ref), 'Gmail failure is reported (P2) against the work order');
    ok(h.calls.audit.length === 1 && h.calls.audit[0].outcome === 'failed', 'Gmail failure is also on the work order audit trail');
  }
  {
    const h = harness({ gmailThrows: true, auditThrows: true, failureThrows: true });
    const r = await h.sendVendorAssignEmail({}, { woId: 'WO-1300', wo: WO, vendor: V, property: {}, address: 'x', cfg: LIVE });
    ok(r.status === 'failed' && /could not be written to the audit log/.test(r.reason), 'even when the ledger AND the audit write fail, it still returns failed, in words, and does not throw');
  }
  {
    const h = harness({ auditThrows: true });
    const r = await h.sendVendorAssignEmail({}, { woId: 'WO-1300', wo: WO, vendor: V, property: {}, address: 'x', cfg: LIVE });
    ok(r.status === 'sent' && /could not be written to the work order audit log/.test(r.reason), 'email went out but the audit row failed: still sent, and the gap is stated');
    ok(h.calls.failures.length === 1 && h.calls.failures[0].where === 'vendor_assign_email_audit', 'the missing audit row is reported, not swallowed');
  }
  {
    const h = harness({ staged: true });
    const r = await h.sendVendorAssignEmail({}, { woId: 'WO-1300', wo: WO, vendor: V, property: {}, address: 'x', cfg: LIVE });
    ok(r.status === 'skipped' && /STAGING/.test(r.reason), 'staging stub is reported as skipped, never as sent');
  }

  // ── wiring in assignVendor ──
  {
    const fn = grab('async function assignVendor(');
    ok((fn.match(/sendVendorAssignEmail\(/g) || []).length === 1, 'assignVendor sends the email in exactly one place');
    ok(/vendor_email_detail: vendorEmailDetail/.test(fn), 'the response carries vendor_email_detail so a skipped/failed email is visible');
    ok(/if \(notify\) \{|else if \(notify\) \{/.test(fn), 'respects the same notify switch as the text (notify:false = nothing is sent)');
    ok(/Vendor_Email_Sent: vendorEmailSent \? 'TRUE' : 'FALSE'/.test(fn), 'records whether the email went out so a repeat Assign to the same vendor does not email twice');
    ok(/ensureColumns\(env, 'Work_Orders', \['Vendor_Email_Sent'\]\)/.test(fn), 'creates the Vendor_Email_Sent column before writing it');
    ok(!/catch\s*\(\s*_?\s*\)\s*\{\s*\}/.test(fn.slice(fn.indexOf('Nov 5 2026'))), 'no empty catch in the new code');
    ok(!fn.includes('woShareLink'), 'still never uses the no-login share link');
  }
  {
    const block = w.slice(w.indexOf('function vendorAssignEmailPlan('), w.indexOf('// What WILL / WOULD happen for one cancelled copy'));
    ok(!/catch\s*(\(\s*_?\s*\))?\s*\{\s*\}/.test(block), 'no swallowing catch anywhere in the new email functions');
    ok(!/gmailSendEmailWithAttachment|gmailSendEmailMulti/.test(block), 'plain one-recipient email, no attachments, no cc');
  }
  console.log(`vendor-assign-email: ${n}/${n} passing`);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
