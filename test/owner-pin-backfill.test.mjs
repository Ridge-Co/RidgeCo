// Owner PIN backfill (Sep 26 2026): /owner/pin-suggest (proposes, writes nothing) and /owner/set-pins (validates, then saves).
// Runs the REAL functions from worker.js with stubbed Sheets access, so the rules are tested where they live.
import fs from 'fs';
const src = fs.readFileSync('worker.js', 'utf8');
function grabFn(name) {
  let i = src.indexOf('async function ' + name + '('); if (i < 0) i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  let d = 0, j = src.indexOf('{', i);
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i, j + 1);
}
function grabConst(name) { const i = src.indexOf('const ' + name + ' ='); const e = src.indexOf(';\n', i); return src.slice(i, e + 1); }

function build(sheet) {
  const writes = [];
  const env = {};
  const fetchTab = async (e, tab) => sheet[tab] || [];
  const fetchTabs = async (e, tabs) => tabs.map(t => sheet[t] || []);
  const updateRow = async (e, tab, id, fields) => { if (sheet.__failId && String(id) === String(sheet.__failId)) throw new Error('boom'); writes.push({ tab, id: String(id), fields }); const r = (sheet[tab] || []).find(x => String(x.ID) === String(id)); if (r) Object.assign(r, fields); };
  const json = (data, status = 200) => ({ status, data });
  const code = grabConst('OWNER_PIN_ALPHA') + '\n' + ['ownerOnboardPinCheck','ownerPinPropose','ooPinHolders','ownerPinSuggest','ownerPinSet'].map(grabFn).join('\n') +
    '\nreturn { ownerOnboardPinCheck, ownerPinPropose, ownerPinSuggest, ownerPinSet };';
  const api = new Function('fetchTab', 'fetchTabs', 'updateRow', 'json', code)(fetchTab, fetchTabs, updateRow, json);
  return { ...api, env, writes };
}
let pass = 0, fail = 0;
const t = (n, c, got) => { if (c) pass++; else { fail++; console.log('FAIL:', n, got !== undefined ? 'got ' + JSON.stringify(got) : ''); } };
const FMT = /^[A-Z]{3}\d{5}$/;

// ── pure proposer ──
{
  const { ownerPinPropose, ownerOnboardPinCheck } = build({});
  let r = ownerPinPropose('+14105550142', new Set());
  t('normal PIN: 3 letters + last 5 of phone', FMT.test(r.pin) && r.pin.endsWith('50142') && r.from_phone === true, r);
  r = ownerPinPropose('(410) 555-0142', new Set());
  t('formatted phone works the same', r.pin.endsWith('50142'));
  r = ownerPinPropose('', new Set());
  t('no phone → still a valid PIN (random digits)', FMT.test(r.pin) && r.from_phone === false && ownerOnboardPinCheck(r.pin).ok, r);
  r = ownerPinPropose('410', new Set());
  t('too-short phone → random digits', FMT.test(r.pin) && r.from_phone === false, r);
  r = ownerPinPropose('4105512345', new Set());
  t('phone ending 12345 (a trivial run) → NOT used, random digits instead', FMT.test(r.pin) && !r.pin.endsWith('12345') && r.from_phone === false, r);
  r = ownerPinPropose('4105511111', new Set());
  t('phone ending 11111 → not used', !r.pin.endsWith('11111') && FMT.test(r.pin));
  const taken = new Set(); const seen = new Set();
  for (let i = 0; i < 300; i++) { const x = ownerPinPropose('4105550142', taken); seen.add(x.pin); }
  t('300 owners with the same phone digits still get 300 distinct PINs', seen.size === 300 && !seen.has(''), seen.size);
  // The taken set is honoured: force the letters to a known valid combo first, mark it taken, and the proposer must move on.
  const letters = 'QRS'; const idx = letters.split('').map(c => 'ABCDEFGHJKLMNPQRSTUVWXYZ'.indexOf(c));
  let n = 0; const rnd = () => (n < 3 ? (idx[n++] + 0.5) / 24 : Math.random());
  const pre = new Set(['qrs50142']);
  const alt = ownerPinPropose('4105550142', pre, rnd);
  t('a PIN already in the taken set is skipped (QRS50142 taken → a different one is proposed)', alt.pin !== 'QRS50142' && FMT.test(alt.pin) && alt.pin.endsWith('50142'), alt);
  n = 0;
  const free = ownerPinPropose('4105550142', new Set(), rnd);
  t('...and with nothing taken the same random letters ARE used (proves the check above is real)', free.pin === 'QRS50142', free);
}

// ── suggest ──
{
  const sheet = {
    Owners: [
      { ID: '1', First_Name: 'Amy', Phone: '+14106158842', PIN: '', Active: 'TRUE' },
      { ID: '2', First_Name: 'Bo', Phone: '+14438864174', PIN: 'BOB64174', Active: 'TRUE' },
      { ID: '3', First_Name: '', Phone: '', PIN: '', Active: 'TRUE', Company: 'Ridge Co' },
      { ID: '4', First_Name: 'Cy', Phone: '+14106158842', PIN: '', Active: 'TRUE' },
    ],
    Owner_Users: [], Vendors: [{ ID: '9', PIN: 'AAB58842', Active: 'TRUE' }], Tenants: [{ ID: '5', PIN: 'Q', Active: 'TRUE' }],
  };
  const a = build(sheet);
  let r = await a.ownerPinSuggest(a.env, { owner_ids: ['1', '2', '3', '99'] });
  const rows = r.data.rows;
  t('suggest writes nothing', a.writes.length === 0);
  t('owner without a PIN gets a proposal ending in their phone digits', FMT.test(rows[0].proposed_pin) && rows[0].proposed_pin.endsWith('58842'), rows[0]);
  t('owner WITH a PIN is skipped by default (backfill only)', rows[1].skipped === 'Already has a PIN' && rows[1].proposed_pin === '', rows[1]);
  t('owner with no first name is flagged (login needs a first name)', /first name/i.test(rows[2].note), rows[2]);
  t('owner with no phone still gets a valid proposal', FMT.test(rows[2].proposed_pin), rows[2]);
  t('unknown owner id is reported, not thrown', rows[3].error === 'Owner not found', rows[3]);
  r = await a.ownerPinSuggest(a.env, { owner_ids: ['2'], overwrite: true });
  t('overwrite:true proposes a replacement for an owner who has a PIN', FMT.test(r.data.rows[0].proposed_pin) && r.data.rows[0].proposed_pin !== 'BOB64174', r.data.rows[0]);
  r = await a.ownerPinSuggest(a.env, { owner_ids: ['1', '4'] });
  t('two owners sharing a phone number get different PINs in one batch', r.data.rows[0].proposed_pin !== r.data.rows[1].proposed_pin, r.data.rows);
  t('a PIN already held by another login is never proposed (vendor AAB58842)', r.data.rows.every(x => x.proposed_pin.toUpperCase() !== 'AAB58842'));
  r = await a.ownerPinSuggest(a.env, { owner_ids: [] });
  t('empty selection → 400', r.status === 400);
}

// ── set ──
{
  const mk = () => ({
    Owners: [
      { ID: '1', First_Name: 'Amy', PIN: '', Active: 'TRUE' },
      { ID: '2', First_Name: 'Bo', PIN: 'BOB64174', Active: 'TRUE' },
      { ID: '3', First_Name: 'Cy', PIN: '', Active: 'TRUE' },
      { ID: '4', First_Name: 'Di', PIN: '', Active: 'TRUE' },
      { ID: '5', First_Name: 'Old', PIN: 'OLD11122', Active: 'FALSE' },
    ],
    Owner_Users: [{ ID: '7', PIN: 'SUB55566', Active: 'TRUE' }],
    Vendors: [{ ID: '9', PIN: 'VEN99988', Active: 'TRUE' }],
    Tenants: [{ ID: '5', PIN: 'TEN33344', Active: 'TRUE' }],
  });
  let sheet = mk(), a = build(sheet);
  let r = await a.ownerPinSet(a.env, { assignments: [{ owner_id: '1', pin: 'amy58842' }] });
  t('a valid PIN is saved, uppercased', r.data.saved === 1 && sheet.Owners[0].PIN === 'AMY58842' && a.writes[0].fields.PIN === 'AMY58842', r.data);
  r = await a.ownerPinSet(a.env, { assignments: [{ owner_id: '3', pin: 'abc1234' }, { owner_id: '3', pin: 'ABC12345' }, { owner_id: '3', pin: 'AAA48213' }] });
  t('bad format / simple run / same-letter PINs are rejected, nothing written', r.data.saved === 0 && r.data.results.every(x => !x.ok && x.error) && a.writes.length === 1, r.data);
  for (const [who, pin] of [['a vendor', 'VEN99988'], ['a tenant', 'TEN33344'], ['an owner sub-user', 'SUB55566'], ['another owner', 'BOB64174']]) {
    r = await a.ownerPinSet(a.env, { assignments: [{ owner_id: '3', pin }] });
    t('PIN already used by ' + who + ' is refused', r.data.results[0].ok === false && /already used/.test(r.data.results[0].error) && sheet.Owners[2].PIN === '', r.data.results[0]);
  }
  r = await a.ownerPinSet(a.env, { assignments: [{ owner_id: '2', pin: 'BOB64174' }] });
  t('re-saving an owner\'s OWN current PIN is fine (not a conflict with themselves)', r.data.results[0].ok === true);
  r = await a.ownerPinSet(a.env, { assignments: [{ owner_id: '3', pin: 'OLD11122' }] });
  t('an INACTIVE login\'s PIN is reusable (same rule the selftest uses)', r.data.results[0].ok === true, r.data.results[0]);
  sheet = mk(); a = build(sheet);
  r = await a.ownerPinSet(a.env, { assignments: [{ owner_id: '1', pin: 'XYZ48213' }, { owner_id: '3', pin: 'XYZ48213' }, { owner_id: '4', pin: 'QRS90417' }] });
  t('the same PIN given to two owners in one batch: first wins, second refused, third still saved', r.data.saved === 2 && r.data.results[0].ok && !r.data.results[1].ok && /same PIN/.test(r.data.results[1].error) && r.data.results[2].ok, r.data.results);
  t('one bad row never blocks the good ones', sheet.Owners[3].PIN === 'QRS90417' && sheet.Owners[2].PIN === '');
  r = await a.ownerPinSet(a.env, { assignments: [{ owner_id: '404', pin: 'ZZZ48213' }] });
  t('unknown owner is reported', r.data.results[0].error === 'Owner not found');
  r = await a.ownerPinSet(a.env, { assignments: [] });
  t('empty → 400', r.status === 400);
  sheet = mk(); sheet.__failId = '4'; a = build(sheet);
  r = await a.ownerPinSet(a.env, { assignments: [{ owner_id: '4', pin: 'QRS90417' }, { owner_id: '1', pin: 'MNP73519' }] });
  t('a write failure is reported per owner and the rest still save', r.data.results[0].ok === false && /Could not save/.test(r.data.results[0].error) && r.data.results[1].ok === true, r.data.results);
}

// ── wiring ──
const publicList = src.slice(src.indexOf('const PUBLIC_PATHS = ['), src.indexOf('if (!PUBLIC_PATHS.includes(path))'));
['/owner/pin-suggest', '/owner/set-pins'].forEach(p => t('admin-only (NOT public): ' + p, !publicList.includes("'" + p + "'")));
t('routes are wired', src.includes("path === '/owner/pin-suggest'") && src.includes("path === '/owner/set-pins'"));
t('staging test token can only save PINs onto TEST- owners', /path === '\/owner\/set-pins'[\s\S]{0,400}isTestRecord\(env, 'Owners'/.test(src));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
