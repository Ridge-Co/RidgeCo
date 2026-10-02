// WO checklist quick entry + wide description + overlay-drag-close fix (Oct 1 2026).
// Source-grab style (like test/vendor-task-requests.test.mjs): pulls the REAL shipped functions out of
// index.html / worker.js and runs them, plus structural checks on the HTML/CSS. The real-browser
// behaviour is covered by test/manual-verify-wo-checklist-entry-ui.mjs.
import fs from 'fs';
import assert from 'node:assert';
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const wsrc = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');

function grab(src, name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing function ' + name);
  let d = 0, j = src.indexOf('{', i);
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i, j + 1);
}
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

// ---- tiny fake DOM so the real helpers run unmodified ----
const els = {};
const mk = (id, value = '') => (els[id] = { id, value, style: {}, scrollHeight: 300, scrollTop: 0, textContent: '', focus() { this.focused = true; } });
const toasts = [];
const env = `
  var document = { getElementById: function(id){ return __els[id] || null; } };
  var toast = function(m,t){ __toasts.push(m); };
  var window = {};
`;
const code = ['parseChecklistPaste', 'checklistRefresh', 'checklistAppendLines', 'clQuickAdd', 'clQuickKey', 'clQuickPaste', 'checklistFromText', 'checklistToText', 'overlayShouldClose', 'growDescArea']
  .map((f) => grab(html, f)).join('\n');
const lib = new Function('__els', '__toasts', env + code + '\nreturn {parseChecklistPaste, checklistAppendLines, clQuickAdd, clQuickKey, clQuickPaste, checklistFromText, checklistToText, overlayShouldClose, growDescArea, checklistRefresh};')(els, toasts);

// ---- parser ----
const P = lib.parseChecklistPaste;
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m + ' (got ' + JSON.stringify(a) + ')');
eq(P('- a\n* b\n• c\n– d\n— e'), ['a', 'b', 'c', 'd', 'e'], 'bullet markers - * • – — are stripped');
eq(P('1. one\n2) two\n10. ten'), ['one', 'two', 'ten'], 'numbered markers "1. " and "1) " are stripped');
eq(P('[ ] a\n[x] b\n[X] c\n☐ d\n✓ e\n☑ f\n✔ g'), ['a', 'b', 'c', 'd', 'e', 'f', 'g'], 'checkbox markers [ ] [x] ☐ ✓ are stripped');
eq(P('- [ ] nested marker'), ['nested marker'], 'combined "- [ ] " marker stripped');
eq(P('a\n\n   \n\t\nb\n'), ['a', 'b'], 'blank / whitespace-only lines are skipped');
eq(P('a\r\nb\r\n\r\nc\rd'), ['a', 'b', 'c', 'd'], 'CRLF and bare CR are normalised');
eq(P('  padded item  '), ['padded item'], 'items are trimmed');
eq(P('same\nsame'), ['same', 'same'], 'no de-duping');
eq(P('2.5 inch pipe\n-5 degrees\n3 coats of paint\n1.5 hours'), ['2.5 inch pipe', '-5 degrees', '3 coats of paint', '1.5 hours'], 'does not eat real text that merely starts with a digit or hyphen');
eq(P('- \n[ ] \nreal'), ['real'], 'lines that are only a marker are skipped');
eq(P(''), [], 'empty string -> []'); eq(P(null), [], 'null -> []');
ok(/subtask|LATER phase/i.test(html.slice(html.indexOf('function parseChecklistPaste') - 600, html.indexOf('function parseChecklistPaste'))), 'a code comment says subtasks/drag-reorder should extend this one parser');

// ---- append, never replace ----
mk('wo-checklist', 'Existing one\nExisting two'); mk('wo-checklist-quick', '');
els['wo-checklist-quick'].value = '- New item';
lib.clQuickAdd('wo-checklist');
ok(els['wo-checklist'].value === 'Existing one\nExisting two\nNew item', 'quick add appends at the END, existing lines untouched');
ok(els['wo-checklist-quick'].value === '' && els['wo-checklist-quick'].focused === true, 'quick-add clears and keeps focus');
els['wo-checklist-quick'].value = '   ';
lib.clQuickAdd('wo-checklist');
ok(els['wo-checklist'].value === 'Existing one\nExisting two\nNew item', 'blank quick-add adds nothing');
els['wo-checklist'].value = 'A\nB\n\n\n';   // trailing blank lines must not create gaps
lib.checklistAppendLines('wo-checklist', ['C', 'D']);
ok(els['wo-checklist'].value === 'A\nB\nC\nD', 'append drops trailing blank lines first, so no empty gap');
els['wo-checklist'].value = '';
lib.checklistAppendLines('wo-checklist', ['first']);
ok(els['wo-checklist'].value === 'first', 'append into an empty list does not add a leading newline');
// paste handler
els['wo-checklist'].value = 'keep me'; els['wo-checklist-quick'].value = '';
let prevented = false;
lib.clQuickPaste({ clipboardData: { getData: () => '- x\r\n2) y\r\n\r\n[ ] z\r\n' }, preventDefault() { prevented = true; }, target: els['wo-checklist-quick'] }, 'wo-checklist');
ok(prevented && els['wo-checklist'].value === 'keep me\nx\ny\nz', 'multi-line paste appends ALL lines and keeps existing text');
ok(toasts.includes('3 items added'), 'multi-line paste toasts "3 items added"');
prevented = false;
lib.clQuickPaste({ clipboardData: { getData: () => 'one single line\n' }, preventDefault() { prevented = true; }, target: els['wo-checklist-quick'] }, 'wo-checklist');
ok(!prevented, 'single-line paste is left to the browser (not hijacked)');
let enterPrevented = false; els['wo-checklist-quick'].value = 'via enter';
lib.clQuickKey({ key: 'Enter', preventDefault() { enterPrevented = true; } }, 'wo-checklist');
ok(enterPrevented && /via enter$/.test(els['wo-checklist'].value), 'Enter key adds the item and is prevented from doing anything else');
els['wo-checklist-quick'].value = 'composing'; const before = els['wo-checklist'].value;
lib.clQuickKey({ key: 'Enter', isComposing: true, preventDefault() {} }, 'wo-checklist');
ok(els['wo-checklist'].value === before, 'Enter during IME composition does not add');

// ---- done/why survive: appended text flows through the EXISTING checklistFromText ----
const prevJson = JSON.stringify([
  { t: 'Replace faucet cartridge', done: true, code: '', why: '' },
  { t: 'Re-caulk around sink', done: false, code: 'parts', why: 'need silicone' },
]);
mk('ewo-checklist', lib.checklistToText(prevJson)); mk('ewo-checklist-quick', '');
els['ewo-checklist-quick'].value = 'Touch up paint'; lib.clQuickAdd('ewo-checklist');
els['ewo-checklist-quick'].value = ''; lib.clQuickPaste({ clipboardData: { getData: () => '* Haul debris\n☐ Send photos' }, preventDefault() {}, target: els['ewo-checklist-quick'] }, 'ewo-checklist');
const saved = JSON.parse(lib.checklistFromText(els['ewo-checklist'].value, prevJson));
ok(saved.length === 5 && saved[0].done === true && saved[1].code === 'parts' && saved[1].why === 'need silicone', 'appending then saving keeps the vendor done/code/why on unchanged lines');
ok(saved.slice(2).every((i) => i.done === false && i.code === '' && i.why === ''), 'new lines are undone with no reason');
ok(saved.map((i) => i.t).join('|') === 'Replace faucet cartridge|Re-caulk around sink|Touch up paint|Haul debris|Send photos', 'order preserved: existing first, new appended');
ok(lib.checklistFromText('', prevJson) === '', 'empty textarea still saves as empty (unchanged behaviour)');
ok(/checklistFromText\(\(document\.getElementById\('ewo-checklist'\)\|\|\{value:''\}\)\.value, _woPrev\.Checklist\|\|''\)/.test(html), 'Edit save still goes through checklistFromText(text, existingJson)');
ok(html.includes("api('POST','/wo/checklist'"), 'Edit save still posts to /wo/checklist');
ok(/checklist:checklistFromText\(\(document\.getElementById\('wo-checklist'\)/.test(html), 'New WO create still uses checklistFromText');

// ---- DOM order: checklist block directly follows the description, in both modals ----
function modalBlock(id) { const s = html.indexOf('id="' + id + '"'); const e = html.indexOf('<!--', s + 10); return html.slice(s, e); }
for (const [modal, desc, cl] of [['modal-new-wo', 'wo-desc', 'wo-checklist'], ['modal-edit-wo', 'ewo-description', 'ewo-checklist']]) {
  const b = modalBlock(modal);
  const di = b.indexOf('id="' + desc + '"'), ci = b.indexOf('id="' + cl + '"'), qi = b.indexOf('id="' + cl + '-quick"');
  ok(di > 0 && qi > di && ci > qi, modal + ': description, then quick-add input, then checklist textarea');
  ok(new RegExp('id="' + desc + '"[^>]*></textarea></div>\\s*<div class="form-group full" id="' + cl + '-block"').test(b), modal + ': the checklist block is the very next field after the description');
  ok(b.split('id="' + cl + '"').length === 2, modal + ': exactly one checklist textarea (old bottom row removed)');
  ok(b.indexOf('id="' + cl + '"') < b.indexOf(modal === 'modal-new-wo' ? 'id="wo-notes"' : 'id="ewo-notes"'), modal + ': checklist is above the Notes field');
  ok(b.includes("onkeydown=\"clQuickKey(event,'" + cl + "')\"") && b.includes("onpaste=\"clQuickPaste(event,'" + cl + "')\"") && b.includes("clQuickAdd('" + cl + "')"), modal + ': quick-add input + Add button are wired');
}

// ---- CSS width rules ----
ok(/\.modal\.modal-wide\s*\{[^}]*max-width:\s*min\(1000px,\s*96vw\)/.test(html), 'wide modal rule: max-width min(1000px, 96vw)');
ok(/\.wo-desc-area\s*\{[^}]*width:\s*100%[^}]*box-sizing:\s*border-box[^}]*min-height:\s*160px/.test(html), 'description textareas: width 100%, border-box, min-height 160px');
ok(/\.wo-detail-desc\s*\{[^}]*width:\s*100%[^}]*max-height:\s*min\(60vh,\s*520px\)/.test(html), 'detail description: full width, max-height min(60vh, 520px)');
ok(/@media \(max-width: 600px\) \{ \.modal-overlay\.modal-overlay-wide \{ padding: 8px; \} \.modal-overlay-wide > \.modal \{ padding: 14px;/.test(html), 'phones: overlay padding 8px, modal padding 14px for the wide modals');
ok(/@media \(max-width: 600px\) \{ \.form-grid \{ grid-template-columns: 1fr;/.test(html), 'form-grid still collapses to 1 column on phones');
ok(/\.modal \{[^}]*max-width: 580px/.test(html), 'base .modal width untouched (580px) so unrelated modals are NOT widened');
for (const id of ['modal-new-wo', 'modal-edit-wo', 'modal-wo-detail']) ok(new RegExp('class="modal-overlay modal-overlay-wide" id="' + id + '">\\s*<div class="modal modal-wide">').test(html), id + ' uses the wide classes (no inline max-width)');
ok((html.match(/modal-overlay-wide" id=/g) || []).length === 3, 'only the three WO modals opt in');
ok(/id="wo-desc" class="wo-desc-area"/.test(html) && /id="ewo-description" class="wo-desc-area"/.test(html), 'both description textareas use .wo-desc-area');
ok(!/max-height:220px;overflow-y:auto">' \+\s*\n\s*linkify\(wo\.Description/.test(html), 'detail description no longer has the 220px cap');
ok(/growDescArea\(ta\)/.test(grab(html, 'openEditWOModal')) , 'edit modal grows the description through the shared helper');
// auto-grow function
const ta = { style: {}, scrollHeight: 500 }; lib.growDescArea(ta); ok(ta.style.height === '500px', 'growDescArea grows to content');
ta.scrollHeight = 40; lib.growDescArea(ta); ok(ta.style.height === '160px', 'growDescArea never shrinks below 160px');

// ---- overlay close logic ----
const O = lib.overlayShouldClose, ov = {}, inner = {};
ok(O(ov, ov, ov) === true, 'press + release on the bare overlay closes');
ok(O(ov, ov, inner) === false, '[BUG] press started inside the modal, released on overlay (drag-select) does NOT close');
ok(O(ov, ov, null) === false, 'no recorded press -> does not close');
ok(O(inner, ov, ov) === false, 'click inside the modal never closes');
const wire = html.slice(html.indexOf('var _ovDownTarget'), html.indexOf('var _ovDownTarget') + 900);
ok(/\['pointerdown','mousedown','touchstart'\]/.test(wire) && /capture:true/.test(wire), 'press target is tracked in the capture phase for mouse, pointer and touch');
ok(/overlayShouldClose\(e\.target, m, down\)/.test(wire), 'the overlay click handler uses overlayShouldClose with the tracked press');
ok(!/m\.addEventListener\('click',function\(e\)\{if\(e\.target===m\)/.test(html), 'the old unconditional target===overlay close handler is gone');
ok(!/<div class="modal-overlay[^>]*onclick/.test(html), 'no modal overlay carries its own inline onclick close handler');
ok(!/keydown[^}]{0,200}closeModal|Escape[^}]{0,120}closeModal/.test(html), 'no Escape-key / blur / mouseleave handler closes a modal (only the rc lightbox listens for Escape)');
ok(/function openModal\(id\)\{[^}]*afterModalOpen\(id\)/.test(html), 'openModal sizes description/checklist boxes after the modal is visible');
ok(/var clTa = document\.getElementById\('wo-checklist'\); if\(clTa\) clTa\.value='';/.test(grab(html, 'openNewWOModal')), 'opening New WO clears the checklist (no leftovers)');

// ---- worker: estimate-to-WO conversion writes the shape the Hub/vendor read ----
const scopeToWO = grab(wsrc, 'scopeToWO').replace('async function', 'function');
ok(/\{ t: \(it\.area/.test(scopeToWO) && /done: false, code: '', why: ''/.test(scopeToWO), 'scopeToWO writes checklist items as {t, done, code, why}');
ok(!/\{ text: \(it\.area/.test(scopeToWO), 'scopeToWO no longer writes {text, done} (rendered blank everywhere)');
ok(/BUILD_VERSION = '\d{4}-\d{2}-\d{2}\.\d+-[a-z-]+'/.test(wsrc), 'BUILD_VERSION bumped because worker.js changed');

console.log('wo-checklist-entry: ' + n + '/' + n + ' passing');
