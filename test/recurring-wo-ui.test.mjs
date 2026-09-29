// Recurring WO UI wiring (index.html) — structural checks, same style as the other UI tests.
import fs from 'fs';
const h = fs.readFileSync('index.html', 'utf8');
let pass = 0, fail = 0; const t = (n, c) => { if (c) pass++; else { fail++; console.log('FAIL:', n); } };
for (const id of ['tmpl-rec-on','tmpl-rec-box','tmpl-preset','tmpl-ftype','tmpl-finterval','tmpl-fweekday','tmpl-fnth','tmpl-fdom','tmpl-start','tmpl-end','tmpl-lead','tmpl-vendor','tmpl-season-on','tmpl-season-start','tmpl-season-end','tmpl-targets','tmpl-tgt-prop','tmpl-tgt-unit','tmpl-notify-tenant','tmpl-snippet','modal-post-now','pn-target','pn-desc','pn-save','unit-rec-section'])
  t('element #' + id, h.includes('id="' + id + '"'));
for (const fn of ['recurDescribe','recurSummaryHtml','recurFillForm','recurReadForm','previewRecurrence','openPostNowModal','submitPostNow','copyTemplate','loadUnitRecurring','unitLinkTemplate','insertTemplateSnippet','saveDescAsSnippet','addTemplateTarget','applyRecurrencePreset'])
  t('function ' + fn, h.includes('function ' + fn + '('));
t('tenant override defaults off', /id="tmpl-notify-tenant">/.test(h) && !/id="tmpl-notify-tenant"[^>]*checked/.test(h));
t('save routes Targets/schedule fields', /recurReadForm\(\)/.test(h) && /Object\.keys\(rec\.fields\)/.test(h));
t('post-now uses confirm on open WO', /needs_confirm/.test(h));
t('unit detail loads recurring section', /loadUnitRecurring\(propId, unitId\)/.test(h));
console.log(`recurring-wo-ui: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
