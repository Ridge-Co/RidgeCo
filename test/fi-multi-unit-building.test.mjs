// Nov 13 2026 (Brett): "the layout and area descriptions do not accommodate a multi-unit property ... a default of separating the exterior of the building from the
// individual units, and then also allowing for common areas such as hallways, stairs, basement ... we may have multiple furnaces, water heaters, etc., and we need to be
// able to differentiate between them and tie them to a particular unit." Also: water heater / furnace / electrical panel (and range + refrigerator) cards come already
// attached ("remove them manually rather than adding them manually"), a "not owned by the landlord" checkbox on every appliance (default off), warnings never block, and
// voice notes that do not name a unit go to the unit named last and are flagged for review.
// The fixture is his real building: 8 Cromarty Road, Apt 1 (2 bed / 2 bath, first floor), Apt 2 (3 bed / 1 bath, second floor), shared basement with the laundry,
// 3 furnaces (2 serve Apt 1, 1 serves Apt 2) and 3 water heaters (one each plus one for the laundry).
// Pins the REAL code out of field-inspect.html, inspection-report.html and worker.js.
import fs from 'fs';
import vm from 'vm';
import { world } from './_fi-world.mjs';
const phone = fs.readFileSync(new URL('../field-inspect.html', import.meta.url), 'utf8');
const report = fs.readFileSync(new URL('../inspection-report.html', import.meta.url), 'utf8');
let pass = 0, fail = 0;
const t = (n, c, got) => { if (c) pass++; else { fail++; console.log('FAIL:', n, got !== undefined ? 'got ' + JSON.stringify(got).slice(0, 600) : ''); } };
const grabFrom = (src, from, to) => { const a = src.indexOf(from), b = src.indexOf(to, a + from.length); if (a < 0 || b < a) { console.log('FAIL: cannot find', from, 'or', to); process.exit(1); } return src.slice(a, b); };

// ── the phone's own code ──
let n = 0;
const ctx = { rid: () => 'x' + String(++n).padStart(7, '0'), console };
vm.createContext(ctx);
vm.runInContext(
  grabFrom(phone, 'var EQUIP_KINDS = {', 'var EQUIP_LABEL') +
  grabFrom(phone, 'function equipKeys(kind){', 'function equipSuggest(') +
  grabFrom(phone, 'function walkKey(a, idx){', 'function sortWalk(') +
  grabFrom(phone, 'function sortWalk(list){', '// ---- BUILDING-LAYOUT-START') +
  grabFrom(phone, '// ---- BUILDING-LAYOUT-START', 'function groupLabel(') +
  grabFrom(phone, 'var HEAT_KINDS', 'function setEquipKind(') +
  grabFrom(phone, 'function findArea(doc, id){', 'function issueCount(') +
  grabFrom(phone, 'function moveEquipInDoc(', 'function moveEquipTo('), ctx);

const cu = ctx.cleanUnits([{ label: ' Apt 1 ', alias: 'first floor', beds: 2, baths: 2 }, { label: 'Apt 2', alias: 'second floor, upstairs', beds: 3, baths: 1 }]);
t('two units are accepted and get ids', cu.errors.length === 0 && cu.units.length === 2 && cu.units[0].label === 'Apt 1' && /^un_/.test(cu.units[0].id), cu);
t('a blank unit name is refused in plain words', /needs a name/.test(ctx.cleanUnits([{ label: '  ' }]).errors[0] || ''));
t('two units with the same name are refused', /both called/.test(ctx.cleanUnits([{ label: 'Apt 1' }, { label: 'apt 1' }]).errors[0] || ''));
t('no units at all is refused', ctx.cleanUnits([]).errors.length === 1);

const [u1, u2] = cu.units;
const opts = { building: true, units: cu.units, sides: true, basement: true, attic: false, laundryWhere: 'common', sysWhere: 'common', beds: 3, baths: 1 };
const areas = ctx.buildAreas(opts);
const doc = { v: 1, id: 'fi_cromarty1', property: { address: '8 Cromarty Road' }, layout: { kind: 'building', units: cu.units.map(u => ({ id: u.id, label: u.label, alias: u.alias })) }, overall: { condition: 'fair' }, owner: { name: 'Premier Property Management' }, areas };
const names = areas.map(a => a.name);
const by = name => areas.find(a => a.name === name);

// ── 1. layout ──
t('the exterior belongs to the building, not to a unit', ['Exterior Front', 'Exterior Side (Left)', 'Exterior Side (Right)', 'Exterior Rear', 'Roof & Gutters'].every(x => by(x) && by(x).section === 'building'), names);
t('basement, shared hallway and shared laundry are common areas', ['Hallway & Stairs', 'Basement', 'Laundry'].every(x => by(x) && by(x).section === 'common'), names);
t('Apt 1 has 2 bedrooms and 2 bathrooms of its own', ['Apt 1 - Living Room', 'Apt 1 - Kitchen', 'Apt 1 - Bedroom 1', 'Apt 1 - Bedroom 2', 'Apt 1 - Bathroom 1', 'Apt 1 - Bathroom 2', 'Apt 1 - Smoke & CO Detectors'].every(x => by(x) && by(x).section === u1.id) && !by('Apt 1 - Bedroom 3'), names);
t('Apt 2 has 3 bedrooms and 1 bathroom of its own', ['Apt 2 - Bedroom 1', 'Apt 2 - Bedroom 2', 'Apt 2 - Bedroom 3', 'Apt 2 - Bathroom', 'Apt 2 - Kitchen'].every(x => by(x) && by(x).section === u2.id) && !by('Apt 2 - Bathroom 2'), names);
t('every area name is unique (two bathrooms can never be confused)', new Set(names).size === names.length, names);
t('every area id is unique', new Set(areas.map(a => a.id)).size === areas.length);
t('the area count stays under the 80-area limit', areas.length <= 80, areas.length);
const g = ctx.groupAreas(doc, areas);
t('sections come out in order: building, common, then each unit', g.map(x => x.label).join('|') === 'Building exterior|Common areas|Apt 1|Apt 2', g.map(x => x.label));
t('grouping loses no area', g.reduce((s, x) => s + x.areas.length, 0) === areas.length);
t('inside its section a room shows without the unit prefix', ctx.areaShortName(doc, by('Apt 2 - Bathroom')) === 'Bathroom' && ctx.areaShortName(doc, by('Basement')) === 'Basement');
t('an area with no section is never lost: outside goes to the building, the rest to common', ctx.areaSection(doc, { name: 'Shed', group: 'exterior' }) === 'building' && ctx.areaSection(doc, { name: 'Sunroom', group: 'interior' }) === 'common' && ctx.areaSection(doc, { name: 'X', section: 'un_gone0000' }) === 'common');
t('one home has no sections at all', ctx.groupAreas({ areas: [] }, [{ name: 'Kitchen' }]).length === 1 && ctx.areaSection({}, { name: 'Kitchen', section: 'common' }) === '');

// ── 2. pre-attached equipment ──
const kinds = a => (a.equipment || []).map(e => e.kind + ':' + (e.serves || ''));
t('shared Heating area starts with one furnace per unit, each marked with the unit it serves', kinds(by('Heating / HVAC')).join() === `furnace:${u1.id},furnace:${u2.id}`, kinds(by('Heating / HVAC')));
t('shared Water Heater area starts with one water heater per unit', kinds(by('Water Heater')).join() === `water_heater:${u1.id},water_heater:${u2.id}`, kinds(by('Water Heater')));
t('shared Electrical Panel area starts with one panel per unit', kinds(by('Electrical Panel')).join() === `electrical_panel:${u1.id},electrical_panel:${u2.id}`);
t('every kitchen starts with a range and a refrigerator', kinds(by('Apt 1 - Kitchen')).join() === 'range:,refrigerator:' && kinds(by('Apt 2 - Kitchen')).join() === 'range:,refrigerator:');
t('no washer, dryer or dishwasher is pre-attached anywhere', !areas.some(a => (a.equipment || []).some(e => ['washer', 'dryer', 'dishwasher'].includes(e.kind))));
t('pre-attached cards are marked as such and start empty', areas.every(a => (a.equipment || []).every(e => e.auto === true && !ctx.equipHasInfo(e))));
t('a kitchen appliance serves the unit it is in without being told', ctx.equipServesText(doc, by('Apt 2 - Kitchen'), by('Apt 2 - Kitchen').equipment[0]) === 'Serves Apt 2');
t('a basement furnace says which unit it serves', ctx.equipServesText(doc, by('Heating / HVAC'), by('Heating / HVAC').equipment[1]) === 'Serves Apt 2');
t('the laundry water heater can serve the building', ctx.equipServesText(doc, by('Water Heater'), { kind: 'water_heater', serves: 'building' }) === 'Serves the building / common areas');
t('equipment in a shared area with nothing set claims no unit', ctx.equipServesText(doc, by('Basement'), { kind: 'furnace' }) === '');
// systems inside each unit instead
const inUnit = ctx.buildAreas(Object.assign({}, opts, { sysWhere: 'unit', laundryWhere: 'unit' }));
t('"inside each unit" puts furnace, water heater, panel and laundry in every unit and none in common', ['Heating / HVAC', 'Water Heater', 'Electrical Panel', 'Laundry'].every(x => inUnit.some(a => a.name === 'Apt 1 - ' + x) && inUnit.some(a => a.name === 'Apt 2 - ' + x) && !inUnit.some(a => a.name === x)), inUnit.map(a => a.name));
t('"no laundry" adds no laundry area', !ctx.buildAreas(Object.assign({}, opts, { laundryWhere: 'none' })).some(a => /Laundry/.test(a.name)));
// single-family homes get the same cards
const sfh = ctx.buildAreas({ beds: 3, baths: 1, sides: false, laundry: true, basement: true, attic: false });
const sby = name => sfh.find(a => a.name === name);
t('single-family: water heater, furnace and panel cards are already there', kinds(sby('Water Heater')).join() === 'water_heater:' && kinds(sby('Heating / HVAC')).join() === 'furnace:' && kinds(sby('Electrical Panel')).join() === 'electrical_panel:');
t('single-family: kitchen has range and refrigerator, laundry has nothing pre-attached', kinds(sby('Kitchen')).join() === 'range:,refrigerator:' && (sby('Laundry').equipment || []).length === 0);
t('single-family: no section and the same area names as before', sfh.every(a => a.section === undefined) && ['Exterior Front', 'Exterior Rear', 'Roof & Gutters', 'Living Room', 'Dining Room', 'Kitchen', 'Bedroom 1', 'Bedroom 2', 'Bedroom 3', 'Bathroom', 'Hallway & Stairs', 'Laundry', 'Basement', 'Heating / HVAC', 'Water Heater', 'Electrical Panel', 'Smoke & CO Detectors'].every(x => sby(x)) && sfh.length === 17, sfh.map(a => a.name));

// ── 3. warn, never block ──
t('empty cards are listed for the warning', ctx.blankEquip(doc).length === 10 && /10 equipment cards have no details and will be left off the report/.test(ctx.blankEquipWarn(doc)), ctx.blankEquipWarn(doc));
t('a card with only a label photo is not blank', ctx.equipHasInfo({ kind: 'furnace', photo_ids: ['ph_1'] }) && !ctx.equipHasInfo({ kind: 'furnace', name: 'Upstairs', photo_ids: [] }));
t('a card marked not owned is not blank', ctx.equipHasInfo({ kind: 'refrigerator', not_owned: true }));
t('an area marked no access does not nag about its cards', ctx.blankEquip({ areas: [{ name: 'Kitchen', access: { no_access: true }, equipment: [{ kind: 'range' }] }, { name: 'Gone', excluded: true, equipment: [{ kind: 'range' }] }] }).length === 0);
t('the review screen adds it as a warning, not a block', /var bew = blankEquipWarn\(doc\); if \(bew\) warns\.push\(bew\);/.test(phone) && !/blocks\.push\(bew/.test(phone));

// ── 4. heating type, move, rename ──
const fz = ctx.equipSetKind({ id: 'e1', kind: 'furnace', brand: 'Carrier', fuel: 'gas', filter_size: '16x25x1', photo_ids: ['p'] }, 'heat_pump');
t('furnace -> heat pump keeps brand, photos and filter size and drops fuel (so the save is never refused)', fz.kind === 'heat_pump' && fz.brand === 'Carrier' && fz.filter_size === '16x25x1' && !('fuel' in fz) && fz.photo_ids.length === 1, fz);
t('furnace -> boiler keeps fuel and drops filter size', (() => { const b = ctx.equipSetKind({ kind: 'furnace', fuel: 'gas', filter_size: '16x25x1' }, 'boiler'); return b.kind === 'boiler' && b.fuel === 'gas' && !('filter_size' in b); })());
t('the heating card offers furnace, boiler, heat pump and other', ctx.HEAT_KINDS.join() === 'furnace,boiler,heat_pump,other');
{
  const d = JSON.parse(JSON.stringify(doc)), k = d.areas.find(a => a.name === 'Apt 1 - Kitchen'), b = d.areas.find(a => a.name === 'Basement');
  const fr = k.equipment[1]; fr.photo_ids = ['ph_label1']; k.photo_ids = ['ph_label1', 'ph_other'];
  const ok = ctx.moveEquipInDoc(d, fr.id, k.id, b.id);
  t('moving a card keeps its id and its label photo, and the photo leaves the old area', ok && b.equipment.some(e => e.id === fr.id) && !k.equipment.some(e => e.id === fr.id) && b.photo_ids.includes('ph_label1') && !k.photo_ids.includes('ph_label1') && k.photo_ids.includes('ph_other'));
  t('a card moved out of a unit still serves that unit', b.equipment.find(e => e.id === fr.id).serves === u1.id);
  t('moving to an area that does not exist changes nothing', ctx.moveEquipInDoc(d, fr.id, b.id, 'nope') === false && b.equipment.some(e => e.id === fr.id));
  const nRen = ctx.renameUnitInDoc(d, u2.id, 'Unit B');
  t('renaming a unit renames its rooms and nothing else', nRen === d.areas.filter(a => a.section === u2.id).length && d.areas.some(a => a.name === 'Unit B - Bathroom') && !d.areas.some(a => /^Apt 2 - /.test(a.name)) && d.areas.some(a => a.name === 'Apt 1 - Kitchen') && d.layout.units[1].label === 'Unit B');
  const bath = d.areas.find(a => a.name === 'Unit B - Bathroom');
  ctx.moveAreaToSection(d, bath, 'common');
  t('a room moved out of a unit drops the unit name', bath.name === 'Bathroom' && bath.section === 'common');
  ctx.moveAreaToSection(d, bath, u1.id);
  t('a room moved into a unit takes that unit name', bath.name === 'Apt 1 - Bathroom' && bath.section === u1.id);
  const k2 = d.areas.find(a => a.name === 'Unit B - Kitchen'); ctx.moveAreaToSection(d, k2, u1.id);
  t('moving a second kitchen into a unit never makes two areas with one name', k2.name === 'Apt 1 - Kitchen (2)' && new Set(d.areas.map(a => a.name)).size === d.areas.length, k2.name);
}
// voice-found equipment fills the empty card
{
  const d = JSON.parse(JSON.stringify(doc)), heat = d.areas.find(a => a.name === 'Heating / HVAC');
  t('equipment heard for Apt 2 fills Apt 2\'s empty furnace card', ctx.findBlankCard(d, heat, 'furnace', u2.id) === heat.equipment[1]);
  t('equipment heard with no unit does not guess between two unit cards', ctx.findBlankCard(d, heat, 'furnace', '') === null);
  heat.equipment[1].brand = 'Goodman';
  t('a filled card is never overwritten', ctx.findBlankCard(d, heat, 'furnace', u2.id) === null);
  const base = d.areas.find(a => a.name === 'Basement'), whA = d.areas.find(a => a.name === 'Water Heater');
  const near = ctx.findBlankCardNear(d, base, 'water_heater', u1.id);
  t('"in the basement" still fills the empty Apt 1 water heater card in the Water Heater area, and says which area', near && near.card === whA.equipment[0] && near.area === whA);
  t('no unit heard never takes the last empty card that belongs to a unit', ctx.findBlankCard(d, heat, 'furnace', '') === null && heat.equipment.filter(x => !ctx.equipHasInfo(x)).length === 1);
  t('with no unit it does not pick between two cards next door', ctx.findBlankCardNear(d, base, 'water_heater', '') === null);
  t('it never reaches into a different part of the building', ctx.findBlankCardNear(d, d.areas.find(a => a.name === 'Apt 2 - Bathroom'), 'water_heater', u2.id) === null);
  t('an appliance heard in another room is NOT moved into the kitchen card (a second refrigerator stays where he said)', ctx.findBlankCardNear(d, d.areas.find(a => a.name === 'Apt 2 - Bathroom'), 'refrigerator', '') === null);
  { const home = { areas: ctx.buildAreas({ beds: 1, baths: 1, sides: false, laundry: false, basement: true, attic: false }) }; const hb = home.areas.find(a => a.name === 'Basement'), hh = home.areas.find(a => a.name === 'Heating / HVAC');
    t('one home: a furnace heard "in the basement" fills the one empty furnace card', ctx.findBlankCardNear(home, hb, 'furnace', '').card === hh.equipment[0]);
    t('one home: a refrigerator heard in the basement is not put on the kitchen card', ctx.findBlankCardNear(home, hb, 'refrigerator', '') === null);
    hb.equipment.push({ id: 'e9', kind: 'furnace', brand: 'Old' });
    t('if the area he approved already has a furnace, nothing is redirected next door', ctx.findBlankCardNear(home, hb, 'furnace', '') === null); }
  t('a kitchen range heard by voice fills the kitchen\'s empty range card', ctx.findBlankCard(d, d.areas.find(a => a.name === 'Apt 1 - Kitchen'), 'range', '').kind === 'range');
}

// ── 5. the server ──
const w = world();
{
  const v = w.fiValidateDoc(JSON.parse(JSON.stringify(doc)));
  t('the server accepts the whole building as the phone builds it', v.ok, v.errors);
  const full = JSON.parse(JSON.stringify(doc)); const h = full.areas.find(a => a.name === 'Heating / HVAC');
  h.equipment.push({ id: 'eq_third001', kind: 'furnace', serves: u1.id, name: 'Rear', brand: 'Trane' });
  full.areas.find(a => a.name === 'Water Heater').equipment.push({ id: 'eq_wh3laun1', kind: 'water_heater', serves: 'building', name: 'Laundry', photo_ids: ['ph_wh3'] });
  full.areas.find(a => a.name === 'Apt 1 - Kitchen').equipment[1].not_owned = true;
  t('3 furnaces (2 for Apt 1), a laundry water heater and a not-owned refrigerator are accepted', w.fiValidateDoc(full).ok, w.fiValidateDoc(full).errors);
  const bad = (mut) => { const d = JSON.parse(JSON.stringify(doc)); mut(d); return w.fiValidateDoc(d); };
  t('not_owned must be true or false', !bad(d => { d.areas[10].equipment = [{ id: 'e1', kind: 'range', not_owned: 'yes' }]; }).ok);
  t('serves must be short text', !bad(d => { d.areas[10].equipment = [{ id: 'e1', kind: 'range', serves: 'x'.repeat(65) }]; }).ok);
  t('an unknown equipment field is still refused', !bad(d => { d.areas[10].equipment = [{ id: 'e1', kind: 'range', hacked: 'x' }]; }).ok);
  t('a layout with no units is refused', !bad(d => { d.layout.units = []; }).ok);
  t('a layout of the wrong kind is refused', !bad(d => { d.layout.kind = 'tower'; }).ok);
  t('a unit with no name is refused', !bad(d => { d.layout.units[0].label = ' '; }).ok);
  t('two units with the same id are refused', !bad(d => { d.layout.units[1].id = d.layout.units[0].id; }).ok);
  t('a unit may not be called "building" or "common" internally', !bad(d => { d.layout.units[0].id = 'building'; }).ok);
  t('a document with no layout is still fine (every older inspection)', bad(d => { delete d.layout; d.areas.forEach(a => delete a.section); }).ok);

  const pc = w.fiPublishChecks(JSON.parse(JSON.stringify(doc)), []);
  t('publishing warns about empty cards', pc.warnings.some(x => x.code === 'equipment_blank' && /10 equipment cards have no details/.test(x.message)), pc.warnings);
  t('and does not block on them', !pc.blocks.some(x => /equipment/.test(x.code)), pc.blocks);
  const pc2 = w.fiPublishChecks({ overall: { condition: 'good' }, owner: { name: 'O' }, areas: [{ id: 'a', name: 'Kitchen', condition: 'good', equipment: [{ id: 'e', kind: 'range', brand: 'GE' }] }] }, []);
  t('no warning when every card has something', !pc2.warnings.some(x => x.code === 'equipment_blank'));

  const pub = w.fiScrubDocForReport(JSON.parse(JSON.stringify(full)));
  const pubEq = pub.areas.flatMap(a => (a.equipment || []).map(e => Object.assign({ area: a.name }, e)));
  t('the public report carries only cards with something to say', pubEq.length === 3 && pubEq.map(e => e.area + '/' + e.kind).sort().join() === 'Apt 1 - Kitchen/refrigerator,Heating / HVAC/furnace,Water Heater/water_heater', pubEq.map(e => e.area + '/' + e.kind));
  t('the phone-only "auto" marker never reaches the public report', !JSON.stringify(pub).includes('"auto"'));
  t('the report keeps the layout so it can name the units', pub.layout.units.length === 2);
}
// voice sorting
{
  const units = [{ id: u1.id, label: 'Apt 1', alias: 'first floor' }, { id: u2.id, label: 'Apt 2', alias: 'second floor, upstairs' }];
  const ra = [{ id: 'ar_bath1', name: 'Apt 1 - Bathroom 1', group: 'interior', unit_id: u1.id }, { id: 'ar_bath2', name: 'Apt 2 - Bathroom', group: 'interior', unit_id: u2.id }, { id: 'ar_base', name: 'Basement', group: 'interior' }];
  const body = { address: '8 Cromarty Road', areas: ra, units, notes: [{ id: 'n1', text: 'apartment 2 bathroom, the fan is dead' }], last_unit: u1.id };
  const p = w.fiBuildRoutePrompt(body, []);
  t('the AI is told this is a multi-unit building and given both units', /MULTI-UNIT BUILDING/.test(p) && p.includes(`- ${u1.id} = Apt 1`) && p.includes(`- ${u2.id} = Apt 2`), p.slice(0, 900));
  t('each unit\'s other spoken names are given (apartment number vs floor)', p.includes('(the inspector may also call it: first floor)') && p.includes('(the inspector may also call it: second floor, upstairs)'));
  t('each area says which unit it is inside, or that it is shared', p.includes(`Apt 2 - Bathroom [interior] (inside unit ${u2.id})`) && p.includes('Basement [interior] (shared)'), p.slice(0, 600));
  t('the rule: no unit named -> the unit named last, flagged', /assume the unit he named most recently/.test(p) && /"unit_assumed": true/.test(p));
  t('the rule: no unit named at all -> unassigned, never a guess', /If no unit has been named at all, do not guess/.test(p));
  t('the unit named before these notes is carried in', p.includes(`Unit named before these notes: ${u1.id} = Apt 1`));
  t('with no earlier unit it says so', w.fiBuildRoutePrompt(Object.assign({}, body, { last_unit: '' }), []).includes('Unit named before these notes: (none yet)'));
  t('the answer format asks for unit_assumed, serves and last_unit', /"unit_assumed":false/.test(p) && /"serves":""/.test(p) && /"last_unit":""/.test(p));
  const one = w.fiBuildRoutePrompt({ address: '1 Main', areas: [{ id: 'a1', name: 'Kitchen', group: 'interior' }], notes: [{ id: 'n', text: 'x' }] }, []);
  t('a single home\'s prompt is untouched (no unit talk at all)', !/MULTI-UNIT|unit_assumed|last_unit|\(shared\)|"serves"/.test(one), one.slice(0, 400));

  const parsed = { issues: [
    { area_id: 'ar_bath2', title: 'Exhaust fan not working', trade: 'electrical', severity: 'medium', detail: 'Fan does not run.', note_id: 'n1', quote: 'apartment 2 bathroom, the fan is dead' },
    { area_id: 'ar_bath2', title: 'Slow tub drain', trade: 'plumbing', severity: 'low', detail: 'Tub drains slowly.', note_id: 'n1', quote: 'the tub drains slow', unit_assumed: true },
    { area_id: 'ar_nope', title: 'Loose handrail', trade: 'carpentry', severity: 'high', detail: 'Handrail is loose.', note_id: 'n1' } ],
    equipment: [{ area_id: 'ar_base', kind: 'furnace', brand: 'Goodman', serves: u2.id, note_id: 'n1' }, { area_id: 'ar_base', kind: 'water heater', brand: 'Rheem', serves: 'building', note_id: 'n1' }, { area_id: 'ar_base', kind: 'furnace', brand: 'Trane', serves: 'un_madeup00', unit_assumed: true, note_id: 'n1' }],
    last_unit: u2.id };
  const out = w.fiNormalizeRoute(parsed, ra.map(a => a.id), w.fiRouteUnits(body));
  t('an item with a named unit is not flagged', out.issues[0].area_id === 'ar_bath2' && out.issues[0].unit_assumed === false, out.issues[0]);
  t('an item with an assumed unit IS flagged for review', out.issues[1].unit_assumed === true);
  t('an item sent to an unknown area is kept as unassigned, never dropped', out.issues.length === 2 && out.unassigned.some(x => /Loose handrail/.test(x.text)), out.unassigned);
  t('equipment keeps the unit it serves', out.equipment[0].serves === u2.id && out.equipment[1].serves === 'building' && out.equipment[1].kind === 'water_heater', out.equipment);
  t('a made-up unit id is not trusted', out.equipment[2].serves === '' && out.equipment[2].unit_assumed === true);
  t('the last unit named is handed back for the next recording', out.last_unit === u2.id);
  t('a made-up last unit is dropped', w.fiNormalizeRoute({ issues: [], last_unit: 'un_madeup00' }, ['ar_base'], w.fiRouteUnits(body)).last_unit === '');
  const single = w.fiNormalizeRoute({ issues: [{ area_id: 'ar_base', title: 'Damp wall', trade: 'general', severity: 'low', detail: 'x', unit_assumed: true }], equipment: [{ area_id: 'ar_base', kind: 'furnace', brand: 'X', serves: u1.id }], last_unit: u1.id }, ['ar_base']);
  t('a single home\'s result has none of the unit keys', !('unit_assumed' in single.issues[0]) && !('serves' in single.equipment[0]) && !('last_unit' in single), single);
  t('units with a bad id or no name are ignored', w.fiRouteUnits({ units: [{ id: 'x', label: 'A' }, { id: 'un_good0001', label: ' ' }, { id: 'un_good0002', label: 'Apt 9' }, null] }).map(u => u.label).join() === 'Apt 9');
}

// limits are checked at Start, before anything is created
t('12 units at 3 bed / 1 bath would pass the 80-area limit, and Start says so instead of creating it', ctx.buildBuildingAreas(opts, ctx.cleanUnits(Array.from({ length: 12 }, (_, i) => ({ label: 'Apt ' + (i + 1), beds: 3, baths: 1 }))).units).length > 80 && /if \(nA > 80\)\{ toast\('That layout makes '/.test(phone) && /if \(cu\.units\.length > 40\)\{ toast\(/.test(phone) && /cu\.units\.length > 30\)\{ toast\(/.test(phone));
t('whole-unit no access leaves rooms with notes or filled equipment alone, and Clear only undoes its own marks', /String\(a\.notes\|\|''\)\.trim\(\) \|\| \(a\.equipment\|\|\[\]\)\.some\(equipHasInfo\)/.test(phone) && /a\.access\.no_access && a\.access\.by_unit\)\{ delete a\.access;/.test(phone));
t('moving a card first keeps what is typed in the open sheet', /a\.equipment\[i\] = e;   \/\/ what is typed in the open sheet/.test(phone));
t('the accept message says when a detail was put on a card in another area', /Filled the empty card: /.test(phone));

// ── 6. the phone page wiring ──
t('the start screen has a multi-unit switch', /id="bld-on"/.test(phone) && /onchange="setBuilding\(this\.checked\)"/.test(phone));
t('a booking for 2+ units starts as a building', /var bu = Math\.min\(40, Math\.round\(Number\(b\.units\)\|\|1\)\);\s*\n\s*if \(bu > 1\)\{/.test(phone));
t('"whole building" on a multi-unit Hub property starts as a building with the Hub\'s unit names', /if \(!u && chosen && hl\.length > 1\)\{ setBuilding\(true, hl\);/.test(phone));
t('units are checked before the inspection is created', /if \(o\.building\)\{ var cu = cleanUnits\(o\.units\); if \(cu\.errors\.length\)\{ toast\(cu\.errors\[0\]\); return; \}/.test(phone));
t('the layout is saved on the inspection', /if \(lay\) doc\.layout = lay;/.test(phone));
t('the areas screen groups by section', /groupAreas\(doc, vis\)\.forEach\(function\(g\)\{/.test(phone));
t('each unit has a whole-unit "No access" button', /onclick="unitAccessSheet\(/.test(phone));
t('an existing single-home inspection can be turned into a building', /convertBuildingSheet\(\)/.test(phone));
t('the equipment card has the not-owned checkbox, unchecked unless set', /id="eq-notowned"[^>]*'\+\(e\.not_owned\?' checked':''\)/.test(phone));
t('the equipment card can take the label photo itself', /function equipAddPhoto\(\)\{ photoTarget = \{ areaId:S\.areaId, equipId:eqEdit\.id \};/.test(phone) && /if \(tg\.equipId && eqEdit && eqEdit\.id===tg\.equipId\)\{/.test(phone));
t('no capture= attribute crept onto a file input', !/capture=/.test(phone));
t('voice sorting sends the units and the last unit named, and carries it forward', /units:routeUnits\(\), last_unit:r\.lastUnit\|\|''/.test(phone) && /if \(res\.last_unit\) r\.lastUnit = res\.last_unit;/.test(phone));
t('assumed-unit items are flagged on the review screen', /it\.unit_assumed\?'<div class="banner warn"/.test(phone) && /did not name a unit\./.test(phone));
t('the phone and the server agree on what "has details" means', /if \(e\.not_owned === true\) return true;/.test(fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8')) && /if \(e\.not_owned===true\) return true;/.test(phone));

// ── 7. the customer report ──
{
  const rc = { esc: s => String(s == null ? '' : s), EQ_KIND: { furnace: 'Furnace', refrigerator: 'Refrigerator' }, EQ_FIELD: [['brand', 'Brand'], ['model', 'Model']], photoGrid: () => '' };
  vm.createContext(rc);
  vm.runInContext(grabFrom(report, 'function rptUnits(doc){', 'function contactLine(b){'), rc);
  const rg = rc.rptGroups(doc, areas);
  t('the report groups: building exterior, common areas, Apt 1, Apt 2', rg.map(x => x.label).join('|') === 'Building exterior|Common areas|Apt 1|Apt 2');
  t('the report loses no area', rg.reduce((s, x) => s + x.areas.length, 0) === areas.length);
  t('a one-home report is one group with no heading', rc.rptGroups({ areas: [] }, [{ name: 'Kitchen' }]).length === 1 && rc.rptGroups({}, [])[0].label === '');
  t('the report says what a basement furnace serves', rc.rptServes(doc, by('Heating / HVAC'), { kind: 'furnace', serves: u1.id }) === 'Serves Apt 1');
  const no = rc.equipHtml({ kind: 'refrigerator', not_owned: true, brand: 'LG' }, 'Apt 1 - Kitchen', {}, 'Serves Apt 1');
  t('a not-owned appliance is listed as not owned with no details', /Not owned by the landlord\. Details not recorded\./.test(no) && !/LG/.test(no) && /Serves Apt 1/.test(no), no);
  const yes = rc.equipHtml({ kind: 'furnace', brand: 'Trane' }, 'Heating / HVAC', {}, 'Serves Apt 2');
  t('an owned furnace shows its details and its unit', /Trane/.test(yes) && /Serves Apt 2/.test(yes) && !/Not owned/.test(yes), yes);
  t('a one-home equipment line is unchanged', rc.equipHtml({ kind: 'furnace', brand: 'Trane' }, 'Heating / HVAC', {}, '').indexOf('Serves') < 0);
  t('the report draws a heading per section only for a building', /if \(multi\) h \+= '<h2 class="sec-h">'/.test(report));
}

console.log(fail ? `FAIL ${fail}/${pass + fail}` : `ok ${pass}/${pass}`);
if (fail) process.exit(1);
