// welcomeSend (Sep 14 2026) — distinct from sendPinMessage (which sends portal credentials):
// this is a warm intro that never includes a PIN, goes through the real gated pipeline
// (smsGatedSend) instead of a direct sendSMS, and only marks Welcome_Sent on an ACTUAL sent
// message — not on a gate-blocked or failed one. Structural/source checks (heavy Sheets I/O
// makes a full mocked-fetch test not worth the setup here, matching this codebase's own
// convention — see releaseMessageQueue/cronSweep, verified live instead).
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
const fnBody = grab('welcomeSend');

// ---- never a PIN in the welcome text — that's sendPinMessage's job, not this one's ----
{
  ok(!/\$\{pin\}/.test(fnBody) && !fnBody.includes('recipient.PIN'), 'the welcome message template never references a PIN — distinct purpose from sendPinMessage');
}

// ---- goes through the real gate, not a direct sendSMS ----
{
  ok(fnBody.includes('smsGatedSend('), 'welcomeSend sends via smsGatedSend (Global/Property/Customer/Tenant or Global/Vendor gate, Test Mode, Message_Queue)');
  ok(!fnBody.includes('await sendSMS(env'), 'welcomeSend never calls the raw sendSMS path — that would bypass Test Mode and the gate entirely');
}

// ---- correct message_type per recipient type ----
{
  ok(fnBody.includes("message_type: 'tenant_welcome'"), 'tenant sends use message_type tenant_welcome');
  ok(fnBody.includes("message_type: 'vendor_welcome'"), 'vendor sends use message_type vendor_welcome');
}

// ---- Welcome_Sent is only written AFTER confirming the message actually sent (or was
// correctly queued for quiet hours — see the regression guard below for that distinction) ----
{
  const guardIdx = fnBody.indexOf('!r.sent && !r.held_for_quiet_hours');
  const writeIdx = fnBody.indexOf("Welcome_Sent: 'TRUE'");
  ok(guardIdx >= 0, 'a not-sent guard exists at all');
  ok(writeIdx >= 0, 'the Welcome_Sent write exists at all');
  ok(guardIdx < writeIdx, 'the not-sent guard is positioned BEFORE the Welcome_Sent write — a genuinely blocked or failed send can never falsely mark someone as welcomed');
}

// ---- tenant gate is given real property/owner, not left to default-open ----
{
  ok(fnBody.includes('property, owner, message_body'), 'tenant sendOpts passes the real property/owner objects to smsGatedSend, not leaving those gates to silently default open');
}

// ---- editable override: body.message, when given, still overrides the default, but now gets
// the same per-recipient token substitution the template default gets (Sep 17 2026 fix — a
// bulk send's edited text used to go out completely raw, so a batch either sent every
// recipient literally the same unpersonalized string, or the literal text "{FirstName}" if
// Brett left the template's own tokens in place expecting them to fill in per person) ----
{
  ok(fnBody.includes('body.message ? renderTemplate(String(body.message), tokens) : defaultMsg'), 'an explicit message in the request body still overrides the generated default, but is run through renderTemplate with that recipient\'s own tokens first — a bulk edit is no longer sent completely raw');
}

// ---- invalid type is rejected, not silently mishandled ----
{
  ok(fnBody.includes("Invalid type. Use: tenant or vendor"), 'an unrecognized type gets a clear error, not a silent fall-through');
}

// ---- regression guard (Sep 15 2026, live-testing): a quiet-hours hold is a SUCCESS, not an
// error — same bug class already fixed once today in createVendorRequest/processVendorNudges.
// A message held for quiet hours WILL send once quiet hours end; treating it as a failure gave
// a false "Send failed" 502 AND skipped the Welcome_Sent write entirely. ----
{
  ok(fnBody.includes('!r.sent && !r.held_for_quiet_hours'), 'the error-return guard checks held_for_quiet_hours too, not just r.sent — a quiet-hours hold no longer reports as a failure');
  ok(!fnBody.includes('if (!r.sent) return json') , 'the old sent-only guard is gone, not left alongside the fixed one');
}

// ---- regression guard: tokens must be the single hoisted variable renderTemplate uses below,
// not re-declared inside a branch (which would shadow it and silently reintroduce today's bug —
// a custom message rendering with no tokens available) ----
{
  ok(fnBody.includes('let tokens = {}'), 'tokens is declared once, hoisted above both branches');
  ok(!fnBody.includes('const tokens ='), 'neither branch re-declares tokens with const — that would shadow the hoisted one');
}

console.log(`welcome-send: ${n}/${n} passing`);
