// Oct 29 2026 (Brett): inspection review fixes in field-inspect.html - owner picker that finds Premier, leftover-dictation handling,
// and "preview before publish". Extracts the real page functions and runs them with a tiny fake page state.
import fs from 'fs';
const html = fs.readFileSync(new URL('../field-inspect.html', import.meta.url), 'utf8');
const grab = (a, b) => { const i = html.indexOf(a), j = html.indexOf(b, i); if (i < 0 || j < 0) throw new Error('not found: ' + a); return html.slice(i, j); };
let pass = 0, fail = 0;
const t = (n, c, got) => { if (c) pass++; else { fail++; console.log('FAIL:', n, got !== undefined ? 'got ' + JSON.stringify(got) : ''); } };

// ---- owner search ----
const src = grab('function nz(s){', 'function loadProps(){') + grab('// Oct 29 2026: a word still matches', 'function pickNewOwner');
const mk = (owners) => new Function('S', src + '; return { ownerMatches, bookingOwnerSuggest, tokHit };')({ dir: { owners, properties: [], units: [] } });
const owners = [{ id: '1', name: 'Phoenix Estates' }, { id: '25', name: 'Premier Property Management' }, { id: '3', name: 'Goldszmidt Properties' }];
{
  const o = mk(owners);
  t('exact word finds Premier', o.ownerMatches('premier').map(x => x.id).join() === '25');
  t('"Premiere" (the brand spelling) still finds Premier', o.ownerMatches('Premiere').map(x => x.id).join() === '25', o.ownerMatches('Premiere'));
  t('"Premiere Property Management and Investment" does not crash and finds nothing wrong', Array.isArray(o.ownerMatches('Premiere Property Management and Investment')));
  t('short words stay exact (no loose matching)', o.ownerMatches('pho').length === 1 && o.ownerMatches('xyz').length === 0);
  t('empty search lists all owners', o.ownerMatches('').length === 3);
  t('booking customer suggests the owner', (o.bookingOwnerSuggest({ booking: { customer_name: 'Premier Property Management' } }) || {}).id === '25');
  t('booking spelled Premiere still suggests it', (o.bookingOwnerSuggest({ booking: { customer_name: 'Premiere Property Management' } }) || {}).id === '25');
  t('no booking -> no suggestion', o.bookingOwnerSuggest({}) === null);
  t('unrelated booking customer -> no suggestion', o.bookingOwnerSuggest({ booking: { customer_name: 'Zeta Holdings' } }) === null);
  const none = new Function('S', src + '; return { ownerMatches, bookingOwnerSuggest };')({ dir: null });
  t('no directory loaded -> empty, no crash', none.ownerMatches('premier').length === 0 && none.bookingOwnerSuggest({ booking: { customer_name: 'Premier' } }) === null);
}

// ---- leftover dictation ----
{
  const code = grab('function hasPending(a){', 'function areaRow(') + grab('function handleDictation(', 'function blockFixHtml');
  const area = { id: 'ar1', name: 'Exterior Rear', pending_text: '  fix the door closer  ', dictation: [] };
  const toasts = [];
  const S = { rec: { doc: { areas: [area] } } };
  const fn = new Function('S', 'findArea', 'mut', 'render', 'toast', '$', code + '; return { hasPending, handleDictation };')(S, (d, id) => d.areas.find(a => a.id === id), (f) => f(S.rec.doc), () => {}, (m) => toasts.push(m), () => null);
  t('whitespace-only is not leftover', fn.hasPending({ pending_text: '   \n ' }) === false);
  t('real text is leftover', fn.hasPending(area) === true);
  fn.handleDictation('ar1');
  t('mark handled clears the box', area.pending_text === '');
  t('mark handled KEEPS the text in the notes log (nothing lost)', area.dictation.length === 1 && area.dictation[0].text.trim() === 'fix the door closer', area.dictation);
  t('toast says what happened', toasts.length === 1 && /marked handled/.test(toasts[0]), toasts);
  fn.handleDictation('ar1');
  t('second tap on a clear area does nothing', area.dictation.length === 1);
}

// ---- preview before publish ----
{
  const code = grab('function previewSeen(){', 'function handleDictation(');
  const S = { rec: { id: 'fi_x', base_rev: 5, dirty: false, doc: {} }, previewed: null };
  const opened = []; let blocked = false;
  const win = { open: (u) => { opened.push(u); return blocked ? null : {}; } };
  const fn = new Function('S', 'window', 'reportUrl', 'toast', 'render', code + '; return { previewSeen, previewReport };')(S, win, () => 'https://x/inspection-report.html?r=TOK', () => {}, () => {});
  t('not previewed -> publish locked', fn.previewSeen() === false);
  fn.previewReport();
  t('preview opens the saved DRAFT report url', opened.length === 1 && opened[0] === 'https://x/inspection-report.html?r=TOK', opened);
  t('previewed this rev -> publish unlocked', fn.previewSeen() === true);
  S.rec.base_rev = 6;
  t('any later save changes the rev -> must preview again', fn.previewSeen() === false);
  S.rec.base_rev = 5; S.rec.dirty = true;
  t('unsaved changes -> locked', fn.previewSeen() === false);
  S.rec.dirty = false; S.previewed = null; blocked = true; fn.previewReport();
  t('pop-up blocked -> NOT counted as previewed', fn.previewSeen() === false);
  S.rec.dirty = true; opened.length = 0; blocked = false; fn.previewReport();
  t('cannot preview while unsaved (nothing opened)', opened.length === 0);
}

// ---- wiring ----
t('publish button is locked until previewed', html.includes("(chk.blocks.length||!seen)?' disabled'"));
t('publishNow itself refuses without a preview', html.includes("if (!previewSeen()){ toast('Preview the report first (Step 1)')"));
t('owner picker loads the directory itself', html.includes('ensureDir(paintOwnerPicker2)'));
t('area list uses the trimmed check', html.includes("(hasPending(a)?' · <span"));
console.log(`fi-review-fixes: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
