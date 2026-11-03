// Nov 2 2026 (Brett): "put an indicator on the areas page showing any issues that don't have photos so i can find them quickly instead of going back and forth to the preview page."
// Pins (the REAL code out of field-inspect.html): the Areas list marks each area that has issues without photos, shows a total above the list, the issue card inside an area carries a
// "no photos" pill, excluded areas do not count, and the marker is only a marker (nothing blocks).
import fs from 'fs';
import vm from 'vm';
const html = fs.readFileSync(new URL('../field-inspect.html', import.meta.url), 'utf8');
let pass = 0, fail = 0;
const t = (n, c, got) => { if (c) pass++; else { fail++; console.log('FAIL:', n, got !== undefined ? 'got ' + JSON.stringify(got).slice(0, 500) : ''); } };

const grab = (from, to) => { const a = html.indexOf(from), b = html.indexOf(to, a); if (a < 0 || b < a) { console.log('FAIL: cannot find', from, 'or', to); process.exit(1); } return html.slice(a, b); };
const code = grab('function issueCount(a){', 'function inspectedCount(') + grab('function areaRow(a, i, n){', 'function openArea(');
const ctx = { S: { reorder: false }, esc: s => String(s == null ? '' : s), hasPending: () => false, areaPill: () => '<pill/>', groupLabel: () => '' };
vm.createContext(ctx); vm.runInContext(code, ctx);

const doc = { areas: [
  { id: 'a1', name: 'Kitchen', issues: [{ id: 'i1', title: 'Disposal', photo_ids: [] }, { id: 'i2', title: 'Filter', photo_ids: ['p1'] }, { id: 'i3', title: 'Sink' }] },
  { id: 'a2', name: 'Living Room', issues: [{ id: 'i4', title: 'Outlet', photo_ids: ['p2'] }] },
  { id: 'a3', name: 'Garage', issues: [] },
  { id: 'a4', name: 'Gone', excluded: true, issues: [{ id: 'i9', title: 'Hidden', photo_ids: [] }] },
] };
t('issues with no photos are found (empty list and missing list both count)', ctx.issuesNoPhoto(doc.areas[0]).map(x => x.id).join() === 'i1,i3', ctx.issuesNoPhoto(doc.areas[0]));
t('an area whose issues all have photos has none', ctx.issuesNoPhoto(doc.areas[1]).length === 0);
t('an area with no issues has none', ctx.issuesNoPhoto(doc.areas[2]).length === 0);
t('the total skips excluded areas', ctx.noPhotoTotal(doc) === 2, ctx.noPhotoTotal(doc));
const r1 = ctx.areaRow(doc.areas[0], 0, 3), r2 = ctx.areaRow(doc.areas[1], 1, 3), r3 = ctx.areaRow(doc.areas[2], 2, 3);
t('Kitchen row is marked with how many issues lack photos', /class="nophoto">⚠ 2 issues without photos</.test(r1), r1);
t('a clean area is not marked', !/nophoto/.test(r2) && !/nophoto/.test(r3));
t('one missing reads in the singular', /⚠ 1 issue without photos/.test(ctx.areaRow({ id: 'x', name: 'X', issues: [{ id: 'i', title: 'T' }] }, 0, 1)));
ctx.S.reorder = true;
t('the marker also shows while reordering', /nophoto/.test(ctx.areaRow(doc.areas[0], 0, 3)));
ctx.S.reorder = false;

// wiring in the page itself
t('the Areas screen prints a total above the list', /var npTot = noPhotoTotal\(doc\);\s*\n\s*if \(npTot\) h \+= '<div class="muted nophoto-sum"/.test(html));
t('the issue card inside an area carries a "no photos" pill', /\(is\.photo_ids\|\|\[\]\)\.length\?'':' <span class="pill warn">⚠ no photos<\/span>'/.test(html));
t('the marker is styled with the warning colour', /\.nophoto\{color:var\(--warn\);font-weight:700\}/.test(html));
const pubGate = html.match(/function publishNow[\s\S]{0,1500}/);
t('publishing does not look at the no-photo count', !pubGate || !/noPhoto/.test(pubGate[0]));

console.log(fail ? `FAIL ${fail}/${pass + fail}` : `ok ${pass}/${pass}`);
process.exit(fail ? 1 : 0);
