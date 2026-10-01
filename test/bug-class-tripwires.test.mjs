// Bug-class tripwires (Oct 2026). Free, no-AI, runs in the normal test suite.
// Pattern: RATCHET. Each risky pattern has a baseline count measured when this file was written.
// A NEW occurrence fails the test, forcing a conscious look; removing occurrences is always fine
// (lower BASELINE here when you do). ZERO baselines are hard rules.
// Sources: FEATURE_LOG regression rules (secrets never in routes, btoa/Latin-1 gh-broker bug,
// empty-POST-body 500s rule 167, header-name column lookups).
import fs from 'fs';
import assert from 'node:assert';
const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
let n = 0;
function ratchet(name, re, baseline, why) {
  const found = (src.match(re) || []).length;
  assert.ok(found <= baseline, `${name}: ${found} occurrences, baseline ${baseline}. ${why} If this is intentional and safe, raise the baseline in test/bug-class-tripwires.test.mjs and say why in the PR.`);
  n++;
}
// Hard rules (baseline 0): committed credentials.
ratchet('GitHub token literal', /\b(ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g, 0, 'Never commit tokens.');
ratchet('Google API key literal', /AIza[0-9A-Za-z_-]{30,}/g, 0, 'Never commit API keys.');
ratchet('LLM key literal', /\bsk-[A-Za-z0-9]{30,}/g, 0, 'Never commit API keys.');
ratchet('eval()', /\beval\(/g, 0, 'No eval in the Worker.');
ratchet('secret/PIN console.log', /console\.log\([^)]*(PIN|token|secret)/gi, 0, 'Never log secrets or PINs.');
// Ratchets: existing debt is tolerated, new debt is not.
ratchet('unguarded header-column indexOf', /=\s*\w+\.indexOf\('[^']+'\)\s*;/g, 15, 'Column lookups must handle -1 (missing header) and be by header name, not index.');
ratchet('btoa()', /\bbtoa\(/g, 12, 'btoa throws on non-Latin-1 text (gh-broker bug class). Use a UTF-8-safe encoder for text.');
ratchet('bare await request.json()', /await\s+request\.json\(\)(?!\s*\))/g, 1, 'Empty POST bodies must not 500 (rule 167). Wrap in try/catch.');
console.log(`bug-class-tripwires: ${n}/${n} passing`);
