// An invoice for an unlinked property lands on the OWNER's ledger. That is silent, and
// unlike the owner record it does not fix itself on first send — nothing in the send path
// ever creates a property sub-customer. These assertions run the real function out of
// worker.js, so the wording and the conditions can't drift from what ships.
import fs from 'fs';
const src = fs.readFileSync('worker.js', 'utf8');

function grab(name) {
  const start = src.indexOf('\nfunction ' + name + '(');
  if (start < 0) throw new Error('not found: ' + name);
  const open = src.indexOf('{', start);
  let depth = 0, i = open;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) break; }
  }
  return src.slice(start + 1, i + 1);
}

const ctx = new Function(
  grab('qbPropertyDisplayName') + grab('qbUnitLabel') + grab('qbOwnerDisplayName') +
  grab('qbResolveBillTo') + grab('qbUnitDisplayName') + grab('qbBillToNote') +
  'return { qbBillToNote, qbResolveBillTo };'
)();
const { qbBillToNote, qbResolveBillTo } = ctx;

let pass = 0, fail = 0;
const t = (n, c) => { if (c) { pass++; } else { fail++; console.log('FAIL:', n); } };

const owner = { ID: 'O1', Billing_Name: 'Goldszmidt Properties' };
const prop  = { ID: 'P1', Address: '928 N Calvert St', Owner_ID: 'O1' };
const unit  = { ID: 'U1', Unit_Label: '3R', Property_ID: 'P1' };

// The case Brett is in right now: brand new property, owner not yet invoiced.
const fresh = qbBillToNote(qbResolveBillTo(owner, prop, null), prop, null);
t('warns when a real address is billing at owner level', !!fresh);
t('names the owner it will land on', fresh.includes('Goldszmidt Properties'));
t('names the address it should have landed on', fresh.includes('928 N Calvert St'));
t('says the send creates the owner but not the property',
  fresh.includes('the owner gets created in QuickBooks by this send, but the property does not'));
t('does not tell him to stop — the invoice itself is correct', fresh.includes('Sending it now is fine'));

// Owner already linked: the excuse changes, the problem does not.
const linked = qbBillToNote(qbResolveBillTo({ ...owner, QBO_Customer_ID: '12' }, prop, null), prop, null);
t('still warns once the owner is linked', !!linked);
t('and stops blaming the missing owner', !linked.includes('gets created in QuickBooks by this send'));
t('saying the property has no sub-customer', linked.includes('no QuickBooks sub-customer yet'));

// A unit on the work order should be named in full, so he knows how deep it should nest.
const withUnit = qbBillToNote(qbResolveBillTo(owner, prop, unit), prop, unit);
t('includes the unit when the job is in one', withUnit.includes('928 N Calvert St Apt 3R'));

// Silence in every state that is already right.
t('silent once the property is linked',
  qbBillToNote(qbResolveBillTo(owner, { ...prop, QBO_Customer_ID: '55' }, null), prop, null) === '');
t('silent once the unit is linked',
  qbBillToNote(qbResolveBillTo(owner, prop, { ...unit, QBO_Customer_ID: '56' }), prop, unit) === '');
t('silent at property level even with an unlinked unit — unit nesting is optional',
  qbBillToNote(qbResolveBillTo(owner, { ...prop, QBO_Customer_ID: '55' }, unit), prop, unit) === '');

// No address means nothing to nest under; a warning there would be noise he can't act on.
t('silent when the property has no address', qbBillToNote(qbResolveBillTo(owner, {}, null), {}, null) === '');
t('silent when there is no property at all', qbBillToNote(qbResolveBillTo(owner, null, null), null, null) === '');
t('survives a missing owner', typeof qbBillToNote(qbResolveBillTo(null, prop, null), prop, null) === 'string');

// It has to reach both paths — the preview AND the confirm response share one array.
t('the note is pushed into the shared warnings array', /if \(billToNote\) warnings\.push\(billToNote\)/.test(src));
t('and is computed before the preview returns',
  src.indexOf('const billToNote = qbBillToNote') < src.indexOf('return json({ preview: {'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
