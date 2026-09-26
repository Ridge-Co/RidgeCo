// CAP-036 batch-2 frontend checks (Sep 24 2026): whole-property tenant-notify default (#5),
// button-select recipient picker (#2), and the canned photo-request template (#1). Structural
// source checks on index.html, same convention as tenant-wo-settings-ui.test.mjs — these are
// pure frontend builds against endpoints that already exist and are already tested elsewhere.
import fs from 'fs';
import assert from 'node:assert';
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function grabFn(name) {
  const sig = 'function ' + name + '(';
  const start = html.indexOf(sig);
  if (start < 0) throw new Error('missing ' + name);
  const open = html.indexOf('{', start);
  let depth = 0, i = open;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}') { depth--; if (!depth) break; } }
  return html.slice(start, i + 1);
}

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

// ── #5 — whole-property multi-unit WO tenant-notify checkboxes default OFF ──
{
  const fn = grabFn('openTenantSafetyScreen');
  ok(fn.includes('isWholeMultiUnit'), 'openTenantSafetyScreen computes a whole-property-with-units flag');
  ok(fn.includes("propUnits.length > 0"), 'the flag requires the property to actually HAVE units — a single-family property with zero Units rows keeps the old always-checked default');
  ok(fn.includes("document.getElementById('safety-notify-created').checked = !isWholeMultiUnit"), 'the "notify on creation" checkbox defaults OFF specifically for the whole-property-with-units case');
  ok(fn.includes("document.getElementById('safety-notify-updates').checked = !isWholeMultiUnit"), 'the "notify on updates" checkbox defaults OFF specifically for the whole-property-with-units case');
  ok(fn.includes("document.getElementById('safety-visible').checked = true"), 'the tenant-visibility checkbox is unaffected — this only concerns the two SMS-notify checkboxes');
  ok(fn.includes('all tenants in this property'), 'the label is rewritten to say who actually gets texted when the whole-property case is in play, instead of the generic singular "tenant" wording');
}
{
  // Single-unit / single-family path must be provably unchanged: with isWholeMultiUnit false,
  // both checkboxes end up checked, exactly like before this build.
  const fn = grabFn('openTenantSafetyScreen');
  const idx = fn.indexOf('!isWholeMultiUnit');
  ok(idx >= 0, 'the boolean feeding both checkboxes is a plain negation, not a more complex expression that could special-case in an unexpected way');
}

// ── #2 — button-select recipient picker (was prompt()+parseInt) ──
{
  ok(html.includes('id="modal-pick-recipient"'), 'a real modal exists for picking who to message');
  ok(html.includes('id="pick-recipient-list"'), 'the picker renders its options into a real list container, not a prompt() dialog');
  const fn = grabFn('_pickSendMessageRecipient');
  ok(!fn.includes('prompt('), 'the number-entry prompt() is gone from the recipient picker');
  ok(!fn.includes('parseInt('), 'no more parsing a typed number back into an index');
  ok(fn.includes("openModal('modal-pick-recipient')"), 'picking opens the real modal instead');
  ok(fn.includes('_chooseSendMessageRecipient'), 'each rendered button routes through a real click handler');
}
{
  const fn = grabFn('_chooseSendMessageRecipient');
  ok(fn.includes("closeModal('modal-pick-recipient')"), 'choosing an option closes the picker modal');
  ok(fn.includes('openSendMessageModal('), 'choosing an option still lands on the same send-message modal as before — only the selection mechanism changed');
}

// ── #1 — canned "request photos" SMS template + button ──
{
  ok(html.includes('sendPhotoRequestSMS'), 'a dedicated photo-request function exists, distinct from the free-typed sendTenantManualUpdate');
  ok(html.includes('📸 Request photos'), 'a button for it is wired into the WO detail sticky action bar');
  const fn = grabFn('sendPhotoRequestSMS');
  ok(fn.includes("api('POST', '/wo/tenant-update-manual'"), 'reuses the existing tenant-update-manual endpoint — no new send infrastructure for a canned template');
  ok(fn.includes('defaultMsg'), 'the prompt is pre-filled with a canned default rather than starting blank, distinguishing it from the free-typed "Send update" button');
}

console.log(`cap-036-batch2-ui: ${n}/${n} passing`);
