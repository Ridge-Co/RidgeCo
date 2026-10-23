// D-14 (Oct 23 2026): the broker's prod write token must be able to update failure-ledger rows, and ONLY via the existing failUpdate handler.
import fs from 'fs';
import assert from 'node:assert';
const w = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const m = w.match(/const HUB_PROD_WRITE_PATHS = \[([^\]]*)\];/);
assert.ok(m, 'found HUB_PROD_WRITE_PATHS');
assert.ok(m[1].includes("'/failure/update'"), '/failure/update is on the broker write allow-list');
// nothing money / QuickBooks / SMS / auth on that list
assert.ok(!/'\/(qb|sms|twilio|login|auth|session)[^']*'/i.test(m[1]), 'allow-list has no QuickBooks/SMS/login path');
assert.ok(/path === '\/failure\/update'\)\s*return await failUpdate\(env, body\)/.test(w), '/failure/update still routes to failUpdate');
console.log('broker-failure-update: all checks passed');
