// vendorPortalLink — deep-links a vendor SMS into their own PIN-gated portal (vendor.html),
// filtered to the specific WO. Deliberately NOT the no-login shareable-link mechanism
// (woShareLink/wo.html) — that flow's /wo/shared read handler explicitly skips the accept-gate
// (its own comment: "deliberately NOT passing vendorView:true... that would also turn on the
// accept-gate"), so it would hand over the lockbox code and tenant phone with no Accept tap
// required, silently defeating the exact promise the dispatch text itself makes. This test
// exists mainly to lock in WHICH link generator vendor_job_assigned uses, since picking the
// wrong one here is a real, easy-to-miss access-control regression, not just a wording choice.
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
const { vendorPortalLink } = new Function(grab('vendorPortalLink') + '\nreturn { vendorPortalLink };')();

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

{
  ok(vendorPortalLink('WO-1196') === 'https://ridge-co.github.io/RidgeCo/vendor.html?wo=WO-1196', 'links straight to vendor.html, not wo.html (the no-login/no-accept-gate share mechanism)');
}
{
  ok(!vendorPortalLink('WO-1196').includes('wo.html'), 'never generates a wo.html shareable link — that path skips the accept-gate entirely');
}
{
  const link = vendorPortalLink('WO-42 test');
  ok(!link.includes(' '), 'a WO id needing escaping is URL-encoded, not concatenated raw');
}

// Confirm the actual call site in assignVendor uses this helper, not woShareLink/woShareLinkUrl
// — a regression here would silently reintroduce the accept-gate bypass without any test
// noticing unless it specifically checks which generator is wired in.
{
  const fnBody = grab('assignVendor');
  ok(fnBody.includes('vendorPortalLink('), 'assignVendor calls vendorPortalLink for the dispatch text link');
  ok(!fnBody.includes('woShareLink'), 'assignVendor never calls the no-login share-link generator');
}

console.log(`vendor-portal-link: ${n}/${n} passing`);
