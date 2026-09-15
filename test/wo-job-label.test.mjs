// woJobLabel — Brett: two same-trade, same-address jobs read identically in a tenant/vendor
// text ("your General job at 123 Test St") with no way to tell them apart. This builds a
// short "Trade job (short description)" label used across tenant_job_assigned/scheduled/
// completed (truncated to 60 chars, matching the WO card list's own truncation convention)
// and the vendor dispatch text (full untruncated description — vendors need the real detail
// and have portal access as a backup, per Brett's own lower-priority framing for that side).
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
const { woJobLabel } = new Function(grab('woJobLabel') + '\nreturn { woJobLabel };')();

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

{
  const wo = { Trade: 'Landscaping', Description: 'Cut the grass in yard #4' };
  ok(woJobLabel(wo) === 'Landscaping job (Cut the grass in yard #4)', 'short description passes through unchanged, matching Brett\'s own example');
}
{
  const wo = { Trade: 'Roofing', Description: 'Repair leaks into Apt 3' };
  ok(woJobLabel(wo) === 'Roofing job (Repair leaks into Apt 3)', 'a second trade/description combination formats the same way');
}
{
  // The exact collision case Brett named: two "General" jobs at the same address, only
  // distinguishable by what they actually are.
  const woA = { Trade: 'General', Description: 'Repair the front steps' };
  const woB = { Trade: 'General', Description: 'Diagnose the leak that fell on the tenant\'s bed this morning' };
  ok(woJobLabel(woA) !== woJobLabel(woB), 'two same-trade jobs with different descriptions never produce the same label');
}
{
  const longDesc = 'A'.repeat(80);
  const wo = { Trade: 'General', Description: longDesc };
  const label = woJobLabel(wo);
  ok(label.length < ('General job (' + longDesc + ')').length, 'a long description is truncated, not sent in full to the tenant');
  ok(label.endsWith('…)'), 'a truncated description is marked with an ellipsis so it reads as shortened, not cut off silently');
}
{
  const wo = { Trade: 'Plumbing', Description: '' };
  ok(woJobLabel(wo) === 'Plumbing job', 'a blank description falls back to just "Trade job", never an empty parenthetical');
}
{
  const wo = { Trade: '', Description: 'stuff' };
  ok(woJobLabel(wo) === 'General job (stuff)', 'a blank Trade falls back to "General", matching the default used elsewhere in the Hub');
}
{
  ok(woJobLabel(null) === 'General job', 'a null/missing WO never throws — fails safe to a generic label');
}

console.log(`wo-job-label: ${n}/${n} passing`);
