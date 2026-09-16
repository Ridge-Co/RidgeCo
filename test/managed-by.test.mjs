// Managed_By owner toggle (Sep 16 2026) — an owner can claim a WO as their own (Ridge Co won't
// dispatch a vendor to it) and hand it back, bidirectionally, via the existing owner-update
// path. Covers the two real enforcement points: the allow-list gate and assignVendor's block.
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

{
  const scopeLine = src.split('\n').find(l => l.includes('OWNER_EDITABLE_FIELDS = ['));
  ok(!!scopeLine && scopeLine.includes("'Managed_By'"), 'Managed_By is in the owner-editable allow-list, so ownerUpdateWO will accept it');
}

const updateBody = grabAsync('ownerUpdateWO');
{
  ok(updateBody.includes("!['RidgeCo','Owner'].includes(allowed.Managed_By)"), 'a bad Managed_By value is rejected rather than silently written -- several other code paths branch on this field being exactly one of two strings');
  ok(updateBody.includes("ensureColumns(env, 'Work_Orders', ['Managed_By'])"), 'the column is ensured on first real write, matching the existing Hold_Reason convention, not assumed to already exist');
}

const assignBody = grabAsync('assignVendor');
{
  const guardIdx = assignBody.indexOf("wo.Managed_By === 'Owner'");
  ok(guardIdx >= 0, 'assignVendor refuses to assign a vendor to a WO the owner has claimed as their own');
  ok(guardIdx < assignBody.indexOf('vendors.find'), 'the guard runs before the vendor is even resolved, so it blocks regardless of which vendor was picked');
}

console.log(`managed-by: ${n}/${n} passing`);
