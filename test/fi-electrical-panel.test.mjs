// Nov 2 2026 (Brett): "the electric panel section [should] read the panel model info from the photo just like the appliance photo processing."
// Pins the new `electrical_panel` equipment kind end to end on the Hub side and in the pages:
//   - the label reader is told it is looking at a panel, asked for brand / model / AMPERAGE / SPACES, and is told not to take a single breaker's rating
//   - what comes back is normalized onto an electrical_panel record (amperage + spaces kept; panel fields never leak onto other kinds)
//   - loose names from dictation / the AI ("breaker box", "service panel", "load center", "fuse box") all become electrical_panel
//   - the doc validator accepts the kind, the phone page and the public report know the kind and its two extra fields
//   - the other appliances' reading is unchanged
import fs from 'fs';
import { world } from './_fi-world.mjs';
const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const phone = fs.readFileSync(new URL('../field-inspect.html', import.meta.url), 'utf8');
const report = fs.readFileSync(new URL('../inspection-report.html', import.meta.url), 'utf8');
let pass = 0, fail = 0;
const t = (n, c, got) => { if (c) pass++; else { fail++; console.log('FAIL:', n, got !== undefined ? 'got ' + JSON.stringify(got).slice(0, 400) : ''); } };
const R = (status, bytes, ct) => ({ ok: status < 300, status, body: 'BYTES', headers: { get: () => ct }, arrayBuffer: async () => bytes.buffer });

// ── 1. normalizing ──
{
  const w = world();
  const e = w.fiNormalizeEquipment({ kind: 'electrical_panel', brand: 'Square D', model: 'QO130L200PG', amperage: '200A', spaces: '30', notes: '120/240V single phase', filter_size: '16x25', fuel: 'gas', tonnage: '3' });
  t('panel record keeps brand, model, amperage, spaces, notes', e && e.kind === 'electrical_panel' && e.brand === 'Square D' && e.model === 'QO130L200PG' && e.amperage === '200A' && e.spaces === '30' && e.notes === '120/240V single phase', e);
  t('furnace-only fields do not leak onto a panel', e && !('filter_size' in e) && !('fuel' in e) && !('tonnage' in e), e);
  const f = w.fiNormalizeEquipment({ kind: 'furnace', brand: 'Carrier', amperage: '200A', spaces: '40', model: 'X1' });
  t('panel-only fields do not leak onto a furnace', f && f.kind === 'furnace' && !('amperage' in f) && !('spaces' in f) && f.model === 'X1', f);
  for (const k of ['panel', 'electrical', 'electric panel', 'Electrical Panel', 'breaker box', 'breaker-panel', 'service panel', 'main panel', 'sub panel', 'subpanel', 'load center', 'fuse box', 'electrical box']) {
    const x = w.fiNormalizeEquipment({ kind: k, brand: 'GE' });
    t('"' + k + '" => electrical_panel', x && x.kind === 'electrical_panel', x);
  }
  t('a panel with nothing readable is still dropped (nothing worth keeping)', w.fiNormalizeEquipment({ kind: 'electrical_panel' }) === null);
  t('amperage/spaces are length-limited like every other field', w.fiNormalizeEquipment({ kind: 'electrical_panel', amperage: 'x'.repeat(500) }).amperage.length <= 120);
  const doc = { v: 1, property: { address: '1 Main' }, areas: [{ id: 'a1', name: 'Electrical Panel', condition: 'fair', issues: [], equipment: [Object.assign({ id: 'eq1' }, e)] }] };
  const v = w.fiValidateDoc(doc);
  t('a doc with an electrical_panel equipment record validates', v.ok, v);
}
// ── 2. reading the label from a photo ──
{
  const w = world();
  w.h.tabs.FI_Photos = { headers: ['ID', 'Inspection_ID', 'Drive_File_ID', 'Mime', 'Bytes', 'Created_At', 'Active'], rows: [['ph_panel1', 'TEST-p_0001', 'drv1', 'image/jpeg', '2000', 'n', 'TRUE']] };
  w.h.net = async (url) => (String(url).includes('alt=media') ? R(200, new Uint8Array([1, 2, 3]), 'image/jpeg') : null);
  let job = null;
  w.h.ai = (j) => { job = j; return JSON.stringify({ readable: true, kind: 'electrical_panel', brand: 'Eaton / Cutler-Hammer', model: 'BR2040B100', serial: '', year: '', amperage: '100A', spaces: '20', notes: '120/240V 1PH; max main 100A' }); };
  let r = await w.fiReadLabel(w.env, { inspection_id: 'TEST-p_0001', photo_id: 'ph_panel1', kind: 'electrical_panel' });
  t('panel label read', r.body.ok && r.body.found && r.body.equipment.kind === 'electrical_panel' && r.body.equipment.model === 'BR2040B100' && r.body.equipment.amperage === '100A' && r.body.equipment.spaces === '20', r);
  t('the reader is told it is an electrical panel', /electrical panel/i.test(job.prompt), job.prompt.slice(0, 200));
  t('the answer format asks for amperage and spaces', /"amperage":""/.test(job.prompt) && /"spaces":""/.test(job.prompt));
  t('it is told not to take a single breaker\'s rating and to leave the door directory alone', /never the amp rating of a single circuit breaker/.test(job.prompt) && /door directory/.test(job.prompt));
  t('the system prompt covers panels and still says "report only what is printed"', /electrical service panel/.test(job.system) && /ONLY text that is actually printed/.test(job.system));
  t('image goes to Claude on the REASON tier as for any label', job.media && job.media.type === 'image' && job.tier === 'REASON');
  // door directory only
  w.h.ai = () => JSON.stringify({ readable: false });
  r = await w.fiReadLabel(w.env, { inspection_id: 'TEST-p_0001', photo_id: 'ph_panel1', kind: 'electrical_panel' });
  t('nothing printed to read = a clear "no readable label" answer, not made-up values', r.body.ok && r.body.found === false && /No readable label/.test(r.body.message), r);
  // appliance reading unchanged
  w.h.ai = () => JSON.stringify({ readable: true, kind: 'furnace', brand: 'Carrier', model: '59TP6A060', amperage: '200A', spaces: '40' });
  r = await w.fiReadLabel(w.env, { inspection_id: 'TEST-p_0001', photo_id: 'ph_panel1', kind: 'furnace' });
  t('a furnace read still comes back as a furnace with no panel fields', r.body.found && r.body.equipment.kind === 'furnace' && r.body.equipment.model === '59TP6A060' && !('amperage' in r.body.equipment), r.body.equipment);
  // kind sent by the phone wins over the AI's guess
  w.h.ai = () => JSON.stringify({ readable: true, kind: 'other', brand: 'Siemens', model: 'P4040B1200CU', amperage: '200A' });
  r = await w.fiReadLabel(w.env, { inspection_id: 'TEST-p_0001', photo_id: 'ph_panel1', kind: 'electrical_panel' });
  t('the kind the inspector picked wins over the AI\'s guess', r.body.equipment.kind === 'electrical_panel' && r.body.equipment.amperage === '200A', r.body.equipment);
}
// ── 3. dictation sorting knows panels ──
{
  const w = world();
  const p = w.fiBuildRoutePrompt({ address: '1 Main', areas: [{ id: 'a1', name: 'Electrical Panel', group: 'systems', issues: [] }], notes: [{ id: 'n1', text: 'Square D panel two hundred amp, forty spaces' }] }, []);
  t('voice-note sorting prompt lists amperage + spaces in the equipment shape and the panel kind', /"amperage":"","spaces":""/.test(p) && /electrical_panel/.test(p), p.slice(-600));
  t('and the instructions mention panels', /for an electrical panel: brand, model, amperage/.test(src));
}
// ── 4. pages ──
{
  t('phone: kind, labels, hint, summary and trim list know the panel', /electrical_panel:\{label:'Electrical panel',extra:\['amperage','spaces'\]\}/.test(phone) && /amperage:'Amperage rating'/.test(phone) && /spaces:'Breaker spaces'/.test(phone) && /'capacity','amperage','spaces'\]\.forEach\(function\(f\)\{ if \(e\[f\]===undefined\)/.test(phone));
  t('phone: an area named Electrical Panel offers "＋ Electrical panel" first', /else if \(\/electric\|panel\|breaker\/\.test\(n\)\) out = \['electrical_panel'\];/.test(phone));
  t('phone: the panel is offered before the generic matches (a "Kitchen" or "Basement" rule never hides it)', phone.indexOf("out = ['electrical_panel']") < phone.indexOf("out = ['refrigerator'"));
  t('report: public report names the kind and prints amperage + spaces', /electrical_panel:'Electrical panel'/.test(report) && /\['amperage','Amperage'\],\['spaces','Breaker spaces'\]/.test(report));
  t('gallery: names the kind', /electrical_panel:'Electrical panel'/.test(fs.readFileSync(new URL('../inspection-photos.html', import.meta.url), 'utf8')));
}
console.log(`fi-electrical-panel: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
