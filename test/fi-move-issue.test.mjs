// Nov 2 2026 - move an issue from one area to another on the Field Inspection phone page, keeping everything recorded on it.
// Brett: on the Lyndale inspection a Basement issue was really an Exterior Rear issue; he could not move it (with its info) to the right area.
// Runs the REAL moveIssueInDoc / moveIssueSheet / moveIssueTo code out of field-inspect.html and pins:
//   - the SAME issue (same id, every field incl. flags, sent marks, work-order flag, type, trade, severity, edits made in the open editor) lands in the new area
//   - its photos come along; photos still used by something that stays behind stay too; no photo is lost or duplicated
//   - nothing else changes (other issues, other areas, equipment, notes, order) and the issue count is conserved
//   - refusals (same area, excluded area, 60-issue cap, issue missing, duplicate id elsewhere) change NOTHING and say why
//   - a failed/refused move never marks the inspection changed (no needless re-save, no un-publish)
import fs from 'fs';
import vm from 'vm';
const html = fs.readFileSync(new URL('../field-inspect.html', import.meta.url), 'utf8');
const a = html.indexOf('// ---- move an issue to another area'), b = html.indexOf('// ---- brands ----', a);
if (a < 0 || b < a) { console.log('FAIL: could not find the move-issue block'); process.exit(1); }
const fnSrc = (name) => { const i = html.indexOf('function ' + name + '('); let d = 0, j = html.indexOf('{', i); for (; j < html.length; j++) { if (html[j] === '{') d++; else if (html[j] === '}') { d--; if (!d) break; } } return html.slice(i, j + 1); };
const code = [fnSrc('findArea'), fnSrc('issueCount'), fnSrc('groupLabel'), fnSrc('esc'), html.slice(a, b)].join('\n');
let pass = 0, fail = 0;
const t = (n, c, got) => { if (c) pass++; else { fail++; console.log('FAIL:', n, got !== undefined ? 'got ' + JSON.stringify(got).slice(0, 400) : ''); } };

const mkDoc = () => ({ v: 1, property: { address: '3809 Lyndale Ave N' }, areas: [
  { id: 'ar_base', name: 'Basement', group: 'interior', condition: 'poor', excluded: false, notes: 'damp smell',
    issues: [
      { id: 'is_a', title: 'Water coming through wall', trade: 'exterior_site', severity: 'high', detail: 'Stains on the north wall, damp floor.', likely_cause: 'Grade slopes toward the house', recommended_fix: 'Regrade and extend downspout', fix_source: 'inspector', wo: true, issue_type: 'Grading', flag_send: true, sent: { at: '2026-11-02T15:00:00Z', to: 'Josiah' }, photo_ids: ['ph_1', 'ph_2'] },
      { id: 'is_b', title: 'Loose handrail', trade: 'carpentry', severity: 'low', detail: '', likely_cause: '', recommended_fix: 'Tighten', photo_ids: ['ph_2'] },
    ],
    photo_ids: ['ph_1', 'ph_2', 'ph_3'], equipment: [{ id: 'eq_1', kind: 'water_heater', brand: 'Rheem', photo_ids: ['ph_3'] }], pending_text: '', dictation: [] },
  { id: 'ar_rear', name: 'Exterior Rear', group: 'exterior', condition: 'not_inspected', excluded: false, issues: [{ id: 'is_c', title: 'Cracked step', trade: 'structural', severity: 'medium', photo_ids: ['ph_9'] }], photo_ids: ['ph_9'], equipment: [], notes: '' },
  { id: 'ar_off', name: 'Garage', group: 'exterior', condition: 'na', excluded: true, issues: [], photo_ids: [], equipment: [] },
] });
function mk(doc, editingIssue, areaId) {
  const calls = { sheets: [], toasts: [], mut: 0, renders: 0, closed: 0 };
  const S = { rec: { doc, dirty: false }, areaId: areaId || 'ar_base', busy: {} };
  const sb = { console, JSON, Object, Array, String, Number, Math, S, editing: editingIssue,
    COND_LABEL: { good: 'Good', fair: 'Fair', poor: 'Poor', nothing_to_do: 'Nothing to do', not_inspected: 'Not inspected', na: 'N/A' },
    curArea: () => sb.findArea(S.rec.doc, S.areaId),
    claim: (k) => { if (S.busy[k]) return false; S.busy[k] = true; return true; }, release: (k) => { delete S.busy[k]; },
    mut: (fn) => { fn(S.rec.doc); S.rec.dirty = true; calls.mut++; },
    openSheet: (h) => calls.sheets.push(h), closeSheet: () => { calls.closed++; }, render: () => { calls.renders++; }, renderIssueSheet: () => {}, openArea: () => {},
    toast: (m) => calls.toasts.push(m) };
  vm.createContext(sb); vm.runInContext(code, sb);
  return { sb, S, calls, doc };
}
const issueIds = (doc) => doc.areas.flatMap(a => (a.issues || []).map(i => i.id)).sort().join();
const area = (doc, id) => doc.areas.find(a => a.id === id);

// ── 1. the Lyndale case ──
{
  const doc = mkDoc(), before = JSON.parse(JSON.stringify(doc));
  const orig = JSON.parse(JSON.stringify(area(doc, 'ar_base').issues[0]));
  const c = mk(doc, JSON.parse(JSON.stringify(orig)));
  // Brett edits the issue in the open editor first (the unsaved edits must come along)
  c.sb.editing.detail = 'Stains on the north wall, damp floor. Water enters at the rear step.'; c.sb.editing.severity = 'urgent';
  c.sb.moveIssueTo('ar_rear');
  const base = area(doc, 'ar_base'), rear = area(doc, 'ar_rear');
  const moved = rear.issues.find(i => i.id === 'is_a');
  t('the issue is now in Exterior Rear and gone from the Basement', !!moved && !base.issues.some(i => i.id === 'is_a'), [base.issues.map(i => i.id), rear.issues.map(i => i.id)]);
  t('same id, and every field kept (title, trade, cause, fix, type, work-order flag, send flag, sent mark, source)', moved.id === 'is_a' && moved.title === orig.title && moved.trade === orig.trade && moved.likely_cause === orig.likely_cause && moved.recommended_fix === orig.recommended_fix && moved.issue_type === orig.issue_type && moved.wo === true && moved.flag_send === true && JSON.stringify(moved.sent) === JSON.stringify(orig.sent) && moved.fix_source === 'inspector', moved);
  t('edits made in the open editor travel with it', moved.detail.endsWith('rear step.') && moved.severity === 'urgent', moved);
  t('its two photos are now on the Exterior Rear area (existing photo kept, none duplicated)', rear.photo_ids.join() === 'ph_9,ph_1,ph_2', rear.photo_ids);
  t('ph_2 is still used by the loose handrail left in the Basement, so it STAYS there; ph_1 (only this issue) leaves; ph_3 (equipment) stays', base.photo_ids.join() === 'ph_2,ph_3', base.photo_ids);
  t('the issue keeps its photo list', moved.photo_ids.join() === 'ph_1,ph_2', moved.photo_ids);
  t('issue count conserved, ids unique', issueIds(doc) === 'is_a,is_b,is_c', issueIds(doc));
  t('the other issues and areas are byte-for-byte unchanged', JSON.stringify(base.issues[0]) === JSON.stringify(before.areas[0].issues[1]) && JSON.stringify(rear.issues[0]) === JSON.stringify(before.areas[1].issues[0]) && JSON.stringify(doc.areas[2]) === JSON.stringify(before.areas[2]) && JSON.stringify(base.equipment) === JSON.stringify(before.areas[0].equipment) && base.notes === 'damp smell', 'diff');
  t('moving into a not-yet-inspected area marks it "fair" (same as adding an issue there by hand)', rear.condition === 'fair');
  t('the Basement condition is left alone', base.condition === 'poor');
  t('the inspection is marked changed exactly once (so it saves to the server)', c.S.rec.dirty === true && c.calls.mut === 1);
  const sheet = c.calls.sheets[c.calls.sheets.length - 1];
  t('confirmation names the new area, says the info and photos came along, offers to go there', /Moved/.test(sheet) && /Exterior Rear/.test(sheet) && /2 photos/.test(sheet) && /openArea\('ar_rear'\)/.test(sheet), sheet);
  t('editor state is cleared and the screen redrawn', c.sb.editing === null && c.calls.renders >= 1);
}
// ── 2. the picker ──
{
  const doc = mkDoc(); const c = mk(doc, JSON.parse(JSON.stringify(area(doc, 'ar_base').issues[0])));
  c.sb.moveIssueSheet();
  const sheet = c.calls.sheets[0];
  t('picker lists the other live areas with issue counts, not the current one, not excluded ones', /Exterior Rear/.test(sheet) && /1 issue/.test(sheet) && !/Garage/.test(sheet) && !/moveIssueTo\('ar_base'\)/.test(sheet), sheet);
  t('picker says what travels with it', /keeps all its details/.test(sheet) && /2 photos/.test(sheet));
  t('opening the picker changes nothing', c.S.rec.dirty === false && c.calls.mut === 0);
}
// ── 3. refusals change nothing ──
function refuse(label, mutate, toId, expect) {
  const doc = mkDoc(); const iss = JSON.parse(JSON.stringify(area(doc, 'ar_base').issues[0]));
  const c = mk(doc, iss); if (mutate) mutate(doc, c);
  const snap = JSON.stringify(doc);
  c.sb.moveIssueTo(toId);
  t(label + ': nothing changed', JSON.stringify(doc) === snap && c.S.rec.dirty === false && c.calls.mut === 0, [c.S.rec.dirty, c.calls.mut]);
  t(label + ': says why', c.calls.toasts.some(m => expect.test(m)), c.calls.toasts);
}
refuse('same area', null, 'ar_base', /different area/);
refuse('excluded area', null, 'ar_off', /not applicable/);
refuse('unknown area', null, 'ar_zzz', /different area/);
refuse('target full (60 issues)', (doc) => { area(doc, 'ar_rear').issues = Array.from({ length: 60 }, (_, i) => ({ id: 'is_f' + i, title: 'x', trade: 'general', severity: 'low' })); }, 'ar_rear', /most issues/);
refuse('issue already gone from the source', (doc) => { area(doc, 'ar_base').issues.splice(0, 1); }, 'ar_rear', /no longer in Basement/);
refuse('same id exists in another area', (doc) => { area(doc, 'ar_rear').issues.push({ id: 'is_a', title: 'dup', trade: 'general', severity: 'low' }); }, 'ar_rear', /more than one area/);
{
  const doc = mkDoc(); const iss = JSON.parse(JSON.stringify(area(doc, 'ar_base').issues[0])); iss.title = '   ';
  const c = mk(doc, iss); c.sb.moveIssueTo('ar_rear');
  t('blank title is refused before anything moves', c.calls.mut === 0 && area(doc, 'ar_base').issues.length === 2 && c.calls.toasts.some(m => /title/.test(m)), c.calls.toasts);
  const c2 = mk(mkDoc(), iss); c2.sb.moveIssueSheet();
  t('...and the picker will not open with a blank title', c2.calls.sheets.length === 0 && c2.calls.toasts.some(m => /title/.test(m)));
}
// ── 4. a double tap cannot move it twice ──
{
  const doc = mkDoc(); const c = mk(doc, JSON.parse(JSON.stringify(area(doc, 'ar_base').issues[0])));
  c.S.busy.mvis = true; c.sb.moveIssueTo('ar_rear');
  t('a second tap while a move is running is ignored', c.calls.mut === 0 && issueIds(doc) === 'is_a,is_b,is_c');
}
// ── 5. photo edge cases ──
{
  const doc = mkDoc(); const iss = area(doc, 'ar_base').issues[0]; iss.photo_ids = ['ph_1', 'ph_9'];   // ph_9 already on the target
  const c = mk(doc, JSON.parse(JSON.stringify(iss))); c.sb.moveIssueTo('ar_rear');
  t('a photo already on the target is not duplicated', area(doc, 'ar_rear').photo_ids.filter(p => p === 'ph_9').length === 1 && area(doc, 'ar_rear').photo_ids.join() === 'ph_9,ph_1', area(doc, 'ar_rear').photo_ids);
  const doc2 = mkDoc(); const iss2 = area(doc2, 'ar_base').issues[0]; iss2.photo_ids = [];
  const c2 = mk(doc2, JSON.parse(JSON.stringify(iss2))); c2.sb.moveIssueTo('ar_rear');
  t('an issue with no photos moves cleanly and the confirmation does not mention photos', c2.calls.mut === 1 && !/photo/i.test(c2.calls.sheets[c2.calls.sheets.length - 1]), c2.calls.sheets[c2.calls.sheets.length - 1]);
  t('...and area photo lists are untouched', area(doc2, 'ar_base').photo_ids.join() === 'ph_1,ph_2,ph_3' && area(doc2, 'ar_rear').photo_ids.join() === 'ph_9');
  // moving the last issue out of a Poor area warns that the condition may be stale
  const doc3 = mkDoc(); area(doc3, 'ar_base').issues.splice(1, 1);
  const c3 = mk(doc3, JSON.parse(JSON.stringify(area(doc3, 'ar_base').issues[0]))); c3.sb.moveIssueTo('ar_rear');
  t('moving the last issue out of an area still marked Poor says so (the condition is not changed silently)', /still marked “Poor”/.test(c3.calls.sheets[c3.calls.sheets.length - 1]) && area(doc3, 'ar_base').condition === 'poor');
}
// ── 6. wiring ──
{
  t('the issue editor offers "Move to another area…" only for existing issues', /if \(!is\.isNew\) h \+= '<div class="btns"><button class="btn block" id="ie-move" onclick="moveIssueSheet\(\)">Move to another area…/.test(html));
  t('moving uses the same mut() path as every edit (autosave, offline queue, un-publish rules apply)', /mut\(function\(doc\)\{ res = moveIssueInDoc\(doc, is, a\.id, areaId\); \}\)/.test(html));
}
console.log(`fi-move-issue: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
