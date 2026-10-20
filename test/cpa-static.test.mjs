// Phase C batch pa (Oct 20 2026): the 12 big Hub pages have no swallowed errors left. Static guard using the lint's own scanner,
// plus checks that the P1-ish conversions (money/data paths) really report and warn instead of looking successful.
// Run: node test/cpa-static.test.mjs
import { readFileSync } from 'node:fs';
import { countRepo } from '../scripts/silent-failure-lint.mjs';
import { ROOT, makeOk } from './cpa-helpers.mjs';
const T = makeOk();
const FILES = ['index.html', 'command-center.html', 'action-center.html', 'proposals.html', 'owner.html', 'owner-onboard.html', 'scope-creator.html',
  'receipt-reconciler.html', 'fix-check.html', 'field-inspect.html', 'owner-submit.html', 'bulk-importer.html'];
const { offenders } = countRepo(ROOT, FILES);
T.ok(offenders.length === 0, 'no swallowed errors remain in the batch-pa pages', offenders.slice(0, 5));
const text = Object.fromEntries(FILES.map(f => [f, readFileSync(ROOT + '/' + f, 'utf8')]));
// every page that now reports must actually load the reporter that defines window.hubReportFailure
for (const f of FILES) {
  if (/hubReportFailure/.test(text[f])) T.ok(/<script src="failure-reporter\.js"><\/script>/.test(text[f]), f + ' loads failure-reporter.js');
}
// every silent-ok marker carries a real reason (3+ words) - the lint enforces this too, this keeps it honest per file
for (const f of FILES) for (const m of text[f].matchAll(/silent-ok:([^*\n]*)/g)) T.ok(m[1].trim().split(/\s+/).length >= 3, f + ' silent-ok reason too short: ' + m[1]);
// P1 sites: these specific converted spots must stay converted
const idx = text['index.html'];
T.ok(/index:invoice-memo-save/.test(idx) && /index:bulk-invoice-memo-save/.test(idx), 'invoice memo save failures are reported');
T.ok(/index:bulk-vendor-permission/.test(idx) && /FAILED\. Select those again/.test(idx), 'bulk vendor permission failures are reported and shown');
T.ok(/index:log-attachment/.test(idx), 'photo log-attachment failure is reported');
T.ok(/index:bulk-void-bill-lookup/.test(idx) && /throw e; \}\)/.test(idx), 'bulk void bill lookup failure is rethrown to the visible handler');
T.ok(/index:trade-defaults-parse-save/.test(idx) && /index:trade-defaults-parse-remove/.test(idx), 'damaged trade defaults are never overwritten');
T.ok(/index:bill-receipts-json-edit/.test(idx), 'damaged receipts list is never edited-and-saved');
T.ok(/index:invoice-review-context/.test(idx) && /index:payables-context/.test(idx), 'invoice review and payables report failed context loads');
T.ok(/scope-creator:log-attachment/.test(text['scope-creator.html']), 'scope photo log-attachment failure is reported');
T.ok(/receipt-reconciler:context-load/.test(text['receipt-reconciler.html']), 'receipt reconciler reports failed context loads');
T.ok(/command-center:unreadable-response/.test(text['command-center.html']) && /action-center:unreadable-response/.test(text['action-center.html']) && /proposals:unreadable-response/.test(text['proposals.html']), 'unparseable 200 answers are reported and thrown, not returned as null');
T.done('cpa-static');
