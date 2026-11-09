// Pre-build design gate (Nov 3 2026): context/PRE_BUILD_GATE_v1.0.md must stay complete and must stay wired into CLAUDE.md,
// and every PR note dated 20261104 or later must carry a "## Pre-build gate" section.
// Run: node test/pre-build-gate.test.mjs
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
let pass = 0, fail = 0;
const t = (n, c, x) => { if (c) pass++; else { fail++; console.log('FAIL:', n, x === undefined ? '' : JSON.stringify(x)); } };
const gate = fs.readFileSync(root + 'context/PRE_BUILD_GATE_v1.0.md', 'utf8');
const claude = fs.readFileSync(root + 'CLAUDE.md', 'utf8');

const items = [...gate.matchAll(/^- \*\*([BCD]\d+) ([^*]+)\*\*(?: `QB`)? - (.+?)  \n  \*shapes:\* `([^`]+)` \| \*default:\* (.+?)  \n  \*evidence:\* (.+)$/gm)];
const bullets = [...gate.slice(0, gate.indexOf('## Dogfood')).matchAll(/^- \*\*([BCD]\d+) /gm)];
t('every item bullet parses (question, shapes, default, evidence)', items.length === bullets.length && items.length >= 60, { parsed: items.length, bullets: bullets.length });
const ids = items.map(m => m[1]);
t('item ids are unique', new Set(ids).size === ids.length);
t('all three groups are present', ['B', 'C', 'D'].every(g => ids.some(i => i[0] === g)));
t('the standing parameters C1-C17 are all there', Array.from({ length: 17 }, (_, i) => 'C' + (i + 1)).every(c => ids.includes(c)));
for (const m of items) {
  t(`${m[1]}: question is a real question`, /\?/.test(m[3]), m[3].slice(-40));
  t(`${m[1]}: has a default answer`, m[5].trim().length > 8);
  t(`${m[1]}: cites evidence`, /(rule \d+|FL-|FL |note |CM |QB|AG |CLAUDE|BRANCH_POLICY|CURRENT)/.test(m[6]), m[6].slice(0, 60));
}
t('the five late-request classes are named', ['fix / move / reorder / relink', 'who else is told', 'money carry-through', 'photo handling', 'show it where I already look'].every(s => gate.includes(s)));
t('the run steps are present (tag shape, walk items, pre-answer from defaults, PR note, close the loop)', ['Tag the feature', 'Walk every item', 'Pre-answer', '## Pre-build gate', '## Late requests'].every(s => gate.includes(s)));
t('the heartbeat dogfood section is present', /Dogfood: the gate run on the overnight heartbeat/.test(gate));
t('CLAUDE.md makes the gate mandatory', /MANDATORY: pre-build design gate/.test(claude) && /PRE_BUILD_GATE_v1\.0\.md/.test(claude));
t('CLAUDE.md still has NO CRON and the silent-failure rule', /NO CRON ANYWHERE/.test(claude) && /NOTHING EVER FAILS SILENTLY/.test(claude));

const notesDir = root + 'context/notes/';
const late = fs.readdirSync(notesDir).filter(f => /^\d{8}-.+\.md$/.test(f) && f.slice(0, 8) >= '20261104');
for (const f of late) {
  const txt = fs.readFileSync(notesDir + f, 'utf8');
  t(`${f}: has "## Pre-build gate"`, /^## Pre-build gate\s*$/m.test(txt));
}
console.log(`\n${pass} passed, ${fail} failed (${late.length} note(s) dated 20261104+ checked)`);
process.exit(fail ? 1 : 0);
