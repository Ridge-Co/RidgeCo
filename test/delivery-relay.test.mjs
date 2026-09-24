// deliveryRelay (CAP-036 #6, Sep 24 2026) — replaces deliveries.html's old sms: URI (which only
// ever opened the ADMIN's own phone's native messaging app; nothing was sent through Ridge Co's
// number, and there was no email at all — "SAFE class, no Twilio, no customer send" was the
// Phase 0 design). Structural/source checks, same convention as welcome-send.test.mjs and
// tenant-dispatch-whole-property.test.mjs — this file's heavy Sheets/Twilio/Gmail I/O makes a
// fully mocked-fetch test not worth the setup; live-verified separately against staging where
// the tooling allows it.
import fs from 'fs';
import assert from 'node:assert';
const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
function grab(name) {
  const i = src.indexOf('async function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  let d = 0, j = src.indexOf('{', src.indexOf(')', i));
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i, j + 1);
}

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const fnBody = grab('deliveryRelay');

// ---- route is actually registered ----
{
  ok(src.includes("path === '/delivery/relay'") && src.includes('deliveryRelay(env, body)'), 'POST /delivery/relay is wired to deliveryRelay in the router');
}

// ---- required fields ----
{
  ok(/if \(!id\) return json\(\{ ?error: ?'id required' ?\}, ?400\)/.test(fnBody), 'id is required');
  ok(/if \(!message\) return json\(\{ ?error: ?'message required' ?\}, ?400\)/.test(fnBody), 'message is required — this is Brett-typed/edited text, not auto-generated server-side');
  ok(fnBody.includes("No delivery"), 'a missing delivery id gets a clear 404, not a silent crash');
}

// ---- actually sends via the real chokepoints, not a client-side draft ----
{
  ok(fnBody.includes('await sendSMS(env,'), "sends the SMS via the sendSMS chokepoint (same admin-triggered direct-send pattern as sendPinMessage/welcomeSend's non-gated sends), not a client-side sms: URI");
  ok(fnBody.includes('await gmailSendEmail(env,'), 'emails the tenant via the gmailSendEmail chokepoint when they have an email on file — no new send infrastructure');
}

// ---- email is opportunistic, never blocks the SMS send ----
{
  const tryIdx = fnBody.indexOf('try {');
  const emailIdx = fnBody.indexOf('gmailSendEmail(env,');
  ok(tryIdx >= 0 && tryIdx < emailIdx, 'the email send is wrapped in its own try/catch');
  ok(fnBody.includes('emailSent = false'), 'a failed email send is recorded as not-sent rather than throwing and aborting the whole request (the SMS may have already gone out)');
}

// ---- recipient priority mirrors deliveries.html's client-side relayTarget() exactly, so the
// button's preview text and the actual send target the same person ----
{
  const tenantIdx = fnBody.indexOf("d.Onsite_Contact === 'tenant' && tenant && tenant.Phone");
  const backupIdx = fnBody.indexOf('d.Onsite_Contact_Phone');
  const fallbackIdx = fnBody.indexOf('else if (tenant && tenant.Phone)');
  ok(tenantIdx >= 0 && backupIdx > tenantIdx && fallbackIdx > backupIdx, 'priority order is: onsite tenant with phone -> manual backup contact phone -> fall back to tenant phone, matching relayTarget() in deliveries.html');
}

// ---- preview_only short-circuits before any real send (same preview-then-send convention as
// sendPinMessage/tenantManualUpdate) ----
{
  const previewIdx = fnBody.indexOf('if (body.preview_only)');
  const smsIdx = fnBody.indexOf('await sendSMS(env,');
  ok(previewIdx >= 0 && previewIdx < smsIdx, 'preview_only returns before sendSMS is ever called');
}

console.log(`delivery-relay: ${n}/${n} passing`);
