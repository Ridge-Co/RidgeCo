// Static guard (no-silent-failures A2): every Hub page loads the failure reporter, so a new page cannot ship without it.
// Run: node test/failure-reporter-wiring.test.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };
// Static legal/marketing pages with no script of their own are exempt; adding a page to this list needs a reason.
const EXEMPT = new Set(['eula.html', 'privacy-policy.html', 'privacy.html', 'terms.html', 'proposal-3101gibbons-8fk3q2.html', 'proposal-inspection-pricing-82676e.html']);
const pages = readdirSync(root).filter(f => f.endsWith('.html'));
for (const f of pages) {
  if (EXEMPT.has(f)) continue;
  const s = readFileSync(join(root, f), 'utf8');
  ok(/<script src="failure-reporter\.js"><\/script>/.test(s), f + ' must include <script src="failure-reporter.js"></script> (no-silent-failures)');
  ok(s.indexOf('failure-reporter.js') < s.indexOf('</head>'), f + ': the reporter must load in <head>, before page scripts');
}
const rep = readFileSync(join(root, 'failure-reporter.js'), 'utf8');
ok(!/catch\s*\([a-z]*\)\s*\{\s*\}/.test(rep), 'failure-reporter.js has no empty catch blocks');
ok(!/location\.search|location\.href/.test(rep.replace(/params = new URLSearchParams\(location\.search\)/, '')), 'failure-reporter.js never reads the URL query into a report');
ok(/\/failure\/report/.test(rep) && /MAX_REPORTS/.test(rep), 'reporter posts to /failure/report and is capped');
const nav = pages.filter(f => /id="rc-nav-jump"/.test(readFileSync(join(root, f), 'utf8')));
for (const f of nav) ok(/value="failures\.html"/.test(readFileSync(join(root, f), 'utf8')), f + ' Jump-to menu lists Needs Attention');
ok(/failures\.html/.test(readFileSync(join(root, 'index.html'), 'utf8')), 'the Hub menu links to Needs Attention');
console.log(`failure-reporter-wiring: ${pass} passed, ${fail} failed`); if (fail) process.exit(1);
