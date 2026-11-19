// Guided request flow, language and wiring checks (queue #116). Every question, option, emergency and self-check must exist in English AND Spanish;
// Brett's summary is always English (built from fixed options); the pages fall back to the old form if the flow cannot load.
// Run: node test/intake-flow-i18n.test.mjs
import fs from 'node:fs';
import assert from 'node:assert';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const RC = require('../intake-flow.js');
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const nz = s => typeof s === 'string' && s.trim().length > 1;

ok(RC.EMERGENCIES.length === 8, 'the default emergency list has the eight agreed items');
RC.EMERGENCIES.forEach(e => ok(nz(e.en) && nz(e.es) && e.en !== e.es, 'emergency has English and Spanish: ' + e.id));
RC.TRADES.forEach(t => ok(nz(t.v) && nz(t.en) && nz(t.es), 'trade has English and Spanish: ' + t.v));
for (const [trade, qs] of Object.entries(RC.BANK)) {
  ok(qs.length <= 4, 'AC: at most 4 follow-up questions for ' + trade);
  qs.forEach(q => {
    ok(nz(q.id) && nz(q.en) && nz(q.es), trade + ' question has English and Spanish: ' + q.id);
    q.options.forEach(o => ok(nz(o.v) && nz(o.en) && nz(o.es), trade + '/' + q.id + ' option has English and Spanish: ' + o.v));
  });
}
ok(RC.TRADES.every(t => RC.BANK[t.v]), 'every trade the form offers has a question set');
RC.SELF_CHECKS.forEach(c => {
  ok(nz(c.en) && nz(c.es) && c.en !== c.es, 'self-check has English and Spanish: ' + c.id);
  ok(!/\bgas\b|water heater|pilot|panel cover|screwdriver|remove the cover/i.test(c.en), 'self-check never involves gas, water heaters or opening a panel: ' + c.id);
});
ok(RC.SELF_CHECKS.length === 4, 'only the four approved self-checks exist');
ok(Object.keys(RC.UI.en).sort().join() === Object.keys(RC.UI.es).sort().join(), 'every screen string exists in both languages');
Object.keys(RC.UI.en).forEach(k => ok(nz(RC.UI.es[k]), 'Spanish string present: ' + k));

// summary: always English, from fixed options, lists each question and answer
{
  const s = RC.buildSummary('Plumbing', { what: 'leak', where: 'kitchen', stopped: 'yes', when: 'today' }, {});
  ok(s.lines.length === 4 && s.text.includes('What is wrong: A leak or drip') && s.text.includes('Where in the home: Kitchen') && !/[áéíóúñ¿]/.test(s.text), 'AC4/AC7: the summary lists each question and answer, in English');
  const e = RC.buildSummary('Electrical', { what: 'outlet' }, { emergency: 'Smell of gas', selfCheck: 'gfci' });
  ok(e.lines[0] === 'EMERGENCY: Smell of gas' && e.text.includes('Self-check tried: gfci'), 'an emergency leads the summary; a tried self-check is noted');
  ok(RC.buildSummary('Nonsense', {}, {}).lines.length === 0, 'an unknown trade does not throw');
  ok(RC.selfCheckFor('Electrical', { what: 'outlet' }).id === 'gfci' && RC.selfCheckFor('Plumbing', { what: 'leak' }) === null, 'self-checks only appear for their trade and answer');
}

// wiring: the pages keep the old form unless the server turns the flow on, and fall back when the file is missing or throws
const sub = fs.readFileSync(new URL('../submit.html', import.meta.url), 'utf8');
const ten = fs.readFileSync(new URL('../tenant.html', import.meta.url), 'utf8');
for (const [name, src] of [['submit.html', sub], ['tenant.html', ten]]) {
  ok(src.includes('<script src="intake-flow.js"></script>'), name + ' loads the shared flow');
  ok(/intake_guided/.test(src) && /RCIntake\.mount\(/.test(src), name + ' mounts it only from the server flag');
  ok(/window\.RCIntake\)/.test(src) && /catch \(e\)/.test(src) && /hubReportFailure/.test(src), name + ' falls back to the old form (and reports it) when the flow is missing or throws');
  ok(/intake: body\.intake/.test(src), name + ' sends the intake object with the request');
  ok(/\/intake\/deflected/.test(src), name + ' logs "That fixed it"');
}
ok(sub.includes('onclick="submitRequest()"') && ten.includes('onclick="submitNewRequest()"'), 'the old submit buttons are untouched (AC1: switch OFF = today)');
const flow = fs.readFileSync(new URL('../intake-flow.js', import.meta.url), 'utf8');
ok(/data-a="send"[^>]*\(S\.busy \? ' disabled'/.test(flow) && /if \(S\.busy\) return;/.test(flow), 'AC8: Send is disabled on the first tap and a second tap does nothing');
ok(/S\.error = T\('failed'\)/.test(flow) && !/S\.answers = \{\}[^;]*catch/.test(flow), 'AC5: a failed send keeps the answers and shows Retry');
ok(/emFail/.test(flow) && /tel:/.test(flow), 'the emergency screen shows the call button and a failure message');
ok(!/alert\(|confirm\(|prompt\(/.test(flow), 'no browser pop-ups');
console.log(`intake-flow-i18n: ${n}/${n} passing`);
