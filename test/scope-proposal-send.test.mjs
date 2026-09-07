// B-210 follow-on: "Send estimate" emails the shareable proposal link to the CONFIRMED PAYOR
// (never the Realtor/PM referral source — those are kept in separate Properties.Source_* fields
// on purpose). These pin the two pure pieces scopeProposalSend relies on: recipient resolution
// (scopeProposalResolveRecipient) and the email HTML (buildScopeProposalEmailHtml). The
// I/O-heavy orchestration around them (fetchTabs/gmailSendEmail/Sheets writes) isn't unit-tested
// here, same convention as every other Sheets/QB-backed handler in this suite — those are
// smoke-verified live instead.
import fs from 'fs';
import assert from 'node:assert';
const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');

function grab(name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  let d = 0, j = src.indexOf('{', src.indexOf(')', i));
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i, j + 1);
}
const scopeProposalResolveRecipient = new Function(grab('scopeProposalResolveRecipient') + '\nreturn scopeProposalResolveRecipient;')();
const buildScopeProposalEmailHtml = new Function(grab('buildScopeProposalEmailHtml') + '\nreturn buildScopeProposalEmailHtml;')();

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

// ---- scopeProposalResolveRecipient ----

// (1) Normal case: property has an Owner_ID, that owner has an Email ⇒ resolves.
let owners = [{ ID: '5', First_Name: 'Jamuna', Last_Name: 'Yalamanchili', Email: 'jamuna@example.com' }];
let prop = { ID: '11', Owner_ID: '5' };
let r = scopeProposalResolveRecipient(prop, owners);
ok(r.owner && r.owner.ID === '5', 'resolves the owner row by Property.Owner_ID');
ok(r.email === 'jamuna@example.com', 'resolves the owner\'s Email');

// (2) No Owner_ID on the property at all ⇒ no owner, no email — this is exactly the "confirm
// the payor first" gate case (step 6 not done yet).
prop = { ID: '11', Owner_ID: '' };
r = scopeProposalResolveRecipient(prop, owners);
ok(r.owner === null, 'no Owner_ID ⇒ no owner resolved');
ok(r.email === '', 'no Owner_ID ⇒ no email');

// (3) Owner_ID points at a row that isn't in the Owners list (deleted/merged) ⇒ same as no owner.
prop = { ID: '11', Owner_ID: '999' };
r = scopeProposalResolveRecipient(prop, owners);
ok(r.owner === null, 'Owner_ID with no matching row ⇒ no owner resolved');
ok(r.email === '', 'Owner_ID with no matching row ⇒ no email');

// (4) Owner exists but has no Email on file (phone-only owner) ⇒ owner resolves, email is empty
// — the send must be blocked, not silently mailed to "".
owners = [{ ID: '5', First_Name: 'Jamuna', Last_Name: 'Yalamanchili', Phone: '4105551234', Email: '' }];
prop = { ID: '11', Owner_ID: '5' };
r = scopeProposalResolveRecipient(prop, owners);
ok(r.owner && r.owner.ID === '5', 'owner still resolves even with no email');
ok(r.email === '', 'phone-only owner ⇒ empty email, caller must gate on this');

// (5) Whitespace-only Email is treated as absent (mirrors the ownerBillingStatus() .trim() check).
owners = [{ ID: '5', Email: '   ' }];
r = scopeProposalResolveRecipient({ ID: '11', Owner_ID: '5' }, owners);
ok(r.email === '', 'whitespace-only Email is treated as no email');

// (6) No property at all (defensive — scope's Property_ID didn't match anything) ⇒ safe, no throw.
r = scopeProposalResolveRecipient(null, owners);
ok(r.owner === null && r.email === '', 'null property is handled without throwing');

// (7) Referral source fields on the property must never leak in as the recipient — resolution
// only ever looks at Owner_ID/Owners, confirming the "Realtor ≠ payor" separation holds here too.
owners = [{ ID: '5', Email: 'owner@example.com' }];
prop = { ID: '11', Owner_ID: '5', Source_Email: 'realtor@example.com', Source_Name: 'Some Realtor' };
r = scopeProposalResolveRecipient(prop, owners);
ok(r.email === 'owner@example.com', 'resolves the owner\'s email, never Properties.Source_Email');

// ---- buildScopeProposalEmailHtml ----

const html = buildScopeProposalEmailHtml({ ownerName: 'Jamuna', addr: '931 St Paul St Apt 2F', url: 'https://ridge-co.github.io/RidgeCo/scope-proposal.html?t=abc123' });
ok(html.includes('Jamuna'), 'greets the owner by name');
ok(html.includes('931 St Paul St Apt 2F'), 'names the property address');
ok(html.includes('https://ridge-co.github.io/RidgeCo/scope-proposal.html?t=abc123'), 'embeds the real proposal link');
ok(html.includes('View &amp; Sign Estimate') || html.includes('View & Sign Estimate'), 'has a clear call-to-action label');

// Missing owner name falls back to "there" (same convention as buildArReportEmailHtml's
// "Hi there," fallback), rather than emailing "Hi ," with a visible gap.
const htmlNoName = buildScopeProposalEmailHtml({ ownerName: '', addr: '123 Main St', url: 'https://x/y' });
ok(htmlNoName.includes('Hi there,'), 'falls back to "there" when no owner name is available');

console.log(`scope-proposal-send: ${n} passed, 0 failed`);
