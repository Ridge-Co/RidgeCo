// Phase 5 of the silent-failure burn-down (Nov 17 2026): PIN lockout, session token, pricing config, payment log, owner invites, access requests.
// Source checks: each failure site that used to swallow now reports (or carries a reasoned silent-ok), and sign-in behaviour is unchanged.
// Run: node test/auth-session-pin-failure-reports.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'worker.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ FAIL: ' + m); } };
const has = (re, m) => ok(re.test(src), m);
const sev = (where, s, v = 'e') => new RegExp("softFail\\(env, '" + where + "', " + v + ", \\{[^}]*severity: '" + s + "'");

console.log('PIN lockout');
has(sev('checkPinLockout', 'P0'), 'unreadable lockout sheet reported P0');
has(/softFail\(env, 'checkPinLockout'[^\n]*return \{ locked: false, fail_count: 0 \}/, 'sign-in behaviour unchanged (still lets the attempt through)');
has(sev('recordPinFailure', 'P0'), 'an uncounted wrong PIN reported P0');
has(/softFail\(env, 'recordPinFailure'[^\n]*return \{ fail_count: 0, locked: false \}/, 'recordPinFailure result unchanged');
has(sev('clearPinLockout', 'P1'), 'a failed lockout reset reported P1');

console.log('Session token');
has(/catch\(e\)\{ return null; \} \/\/ silent-ok: a token that cannot be decoded is rejected as signed out/, 'undecodable token still rejected, with a reasoned silent-ok');

console.log('Pricing config');
has(sev('getPricingConfig:env', 'P1'), 'corrupt PRICING_CONFIG reported P1');
has(sev('getPricingConfig:sheet', 'P1'), 'corrupt or unreadable sheet pricing reported P1');

console.log('Payments and owners');
has(sev('payAuthLog', 'P0'), 'a payment log write failure reported P0');
has(/softFail\(env, 'payAuthLog'[^\n]*return false;/, 'payAuthLog still returns false for its caller');
has(sev('ownerOnboardSubmit:releaseInvite', 'P1', 'e2'), 'a stuck owner invite reported P1');
has(sev('ownerOnboardSubmit:markUsed', 'P1'), 'an invite not marked used reported P1');
has(sev('ownerOnboardInviteCreate:newId', 'P2'), 'owner invite id read-back failure reported');

console.log('Vendor access and Gmail');
has(sev('vendorRequestPropertyAccess:adminText', 'P0'), 'admin text failure reported P0');
has(sev('vendorAccessRequestApprove:listAppend', 'P1'), 'approved access not added to the vendor list reported P1');
has(sev('gmailOAuthCallback:tokenUpdated', 'P2'), 'Gmail reconnect time save failure reported');
ok((src.match(/silent-ok: an unreadable (reply|id token)/g) || []).length >= 3, 'Gmail unreadable replies carry reasoned silent-ok');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
