// Tenant portal note box (Sep 16 2026) — the note UI has always said "Sent to your property
// manager" but addWONote never actually notified anyone. This covers the fix: a real admin
// ping fires specifically for tenant-authored notes, without disturbing the vendor/owner note
// paths that already worked correctly.
import fs from 'fs';
import assert from 'node:assert';
const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
function grabAsync(name) {
  const i = src.indexOf('async function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  let d = 0, j = src.indexOf('{', src.indexOf(')', i));
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i, j + 1);
}

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

const body = grabAsync('addWONote');
{
  ok(body.includes("body.author_role === 'tenant'"), 'a tenant-authored note is checked specifically, not every note author');
  ok(body.indexOf("author_role === 'tenant'") < body.indexOf('notify_owner_status_note'), 'the tenant-notify block runs independently of (and before) the existing owner-notify-on-hold block, so neither depends on the other');
}
{
  const tenantBlock = body.slice(body.indexOf("author_role === 'tenant'"), body.indexOf('notify_owner_status_note'));
  ok(tenantBlock.includes('config.admin_phone'), 'the tenant note alert goes to the admin phone, matching every other real-time Brett-facing alert in this file');
  ok(tenantBlock.includes('sendSMS(env, config.admin_phone'), 'uses the plain admin-ping sendSMS call, not the gated tenant/owner/vendor pipeline (this is an internal alert, not a customer-facing message)');
  ok(!tenantBlock.includes('smsGatedSend'), 'does not route through smsGatedSend/Message_Queue -- admin pings elsewhere in this file (vendor-reply relay, nudge cap alert) use the same plain sendSMS pattern');
  ok(tenantBlock.includes('try') && tenantBlock.includes('catch'), 'wrapped so a failed alert never blocks the note itself from saving (matches the existing owner-notify block\'s own non-fatal convention)');
}
{
  // Regression guard: the fix must not have been bolted onto the existing owner-only block in a
  // way that would fire the tenant alert for an owner-authored note too, or vice versa.
  const ownerBlockStart = body.indexOf('notify_owner_status_note');
  const ownerBlock = body.slice(ownerBlockStart);
  ok(!ownerBlock.slice(0, ownerBlock.indexOf('}\n}')).includes("author_role === 'tenant'"), 'the owner-notify block is untouched -- still gated on its own explicit notify_owner_status_note flag, not on author_role');
}

console.log(`tenant-note-notify: ${n}/${n} passing`);
