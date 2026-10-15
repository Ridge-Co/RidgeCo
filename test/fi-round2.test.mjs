// Field Inspection round 2 (Oct 15 2026, after field use): equipment info, brand capture from a website, voice transcription + routing,
// issue-type list. Runs the REAL FI block against the in-memory fake (test/_fi-world.mjs).
import fs from 'fs';
import { world } from './_fi-world.mjs';
const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
let pass = 0, fail = 0;
const t = (n, c, got) => { if (c) pass++; else { fail++; console.log('FAIL:', n, got !== undefined ? 'got ' + JSON.stringify(got).slice(0, 400) : ''); } };
const enc = (s) => new TextEncoder().encode(s);
const R = (status, body, ctype = 'text/html', loc = '') => {
  const bytes = typeof body === 'string' ? enc(body) : body;
  return { ok: status >= 200 && status < 300, status, headers: { get: k => (k === 'Content-Type' ? ctype : k === 'Location' ? loc : '') }, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), json: async () => JSON.parse(typeof body === 'string' ? body : new TextDecoder().decode(bytes)) };
};
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8]);
const mkDoc = (over = {}) => Object.assign({ v: 1, property: { id: '12', address: '122 S Gilmor St, Baltimore, MD 21223' }, pre1978: true, overall: { condition: 'fair' }, areas: [
  { id: 'a1', name: 'Kitchen', condition: 'poor', issues: [] }, { id: 'a2', name: 'Heating / HVAC', issues: [] }, { id: 'a3', name: 'Bedroom 2 (3rd floor)', issues: [] }] }, over);

// ── equipment ──
{
  const w = world();
  const n = w.fiNormalizeEquipment({ kind: 'Furnace', brand: 'Carrier', model: '59TP6', serial: '1234A', year: '2008', filter_size: '16x25x1', fuel: 'gas', bogus: 'x', name: '' });
  t('furnace keeps filter_size', n && n.kind === 'furnace' && n.filter_size === '16x25x1' && n.brand === 'Carrier' && !('bogus' in n), n);
  t('alias fridge -> refrigerator', w.fiNormalizeEquipment({ kind: 'Fridge', brand: 'GE' }).kind === 'refrigerator');
  t('alias A/C -> central_ac', w.fiNormalizeEquipment({ kind: 'A/C', model: 'X' }).kind === 'central_ac');
  t('alias hot water heater -> water_heater', w.fiNormalizeEquipment({ kind: 'hot water heater', model: 'X' }).kind === 'water_heater');
  t('unknown kind -> other', w.fiNormalizeEquipment({ kind: 'rocket', brand: 'A' }).kind === 'other');
  t('empty equipment -> null', w.fiNormalizeEquipment({ kind: 'furnace' }) === null && w.fiNormalizeEquipment(null) === null);
  t('filter_size not valid for a refrigerator', !('filter_size' in w.fiNormalizeEquipment({ kind: 'refrigerator', brand: 'GE', filter_size: '1' })));
  t('long text truncated', w.fiNormalizeEquipment({ kind: 'other', notes: 'x'.repeat(5000) }).notes.length === 600);
  const errs = []; w.fiValidateEquipment([{ id: 'e1', kind: 'furnace', brand: 'Carrier', filter_size: '16x25x1', photo_ids: ['ph_1'] }], 'areas[0]', errs);
  t('valid equipment passes', errs.length === 0, errs);
  const e2 = []; w.fiValidateEquipment([{ id: 'e1', kind: 'furnace', hacked: 'x' }, { kind: 'furnace' }, { id: 'e3', kind: 'nope' }, { id: 'e4', kind: 'furnace', brand: 5 }], 'areas[0]', e2);
  t('unknown field, missing id, bad kind, non-text value all rejected', e2.length >= 4, e2);
  const e3 = []; w.fiValidateEquipment('x', 'areas[0]', e3); t('non-array rejected', e3.length === 1);
  const e4 = []; w.fiValidateEquipment(undefined, 'areas[0]', e4); t('absent equipment is fine (back-compat)', e4.length === 0);
  const d = mkDoc(); d.areas[1].equipment = [{ id: 'e1', kind: 'furnace', model: 'M', photo_ids: ['ph_plate1'] }];
  t('doc with equipment validates', w.fiValidateDoc(d).ok, w.fiValidateDoc(d));
  t('equipment photo ids are tracked for publish/upload checks', w.fiPhotoIds(d).includes('ph_plate1'));
  d.areas[1].equipment = [{ id: 'e1', kind: 'furnace', zzz: 1 }];
  t('doc with bad equipment rejected', !w.fiValidateDoc(d).ok);
  const d2 = mkDoc({ voice_notes: [{ id: 'v1', transcript: 'hello' }] }); t('voice_notes validate', w.fiValidateDoc(d2).ok);
  t('bad voice_notes rejected', !w.fiValidateDoc(mkDoc({ voice_notes: [{ id: 'v1', transcript: 5 }] })).ok && !w.fiValidateDoc(mkDoc({ voice_notes: 'x' })).ok);
  t('every kind has a label and field list', Object.keys(w.FI_EQUIP_KINDS).every(k => w.fiEquipFields(k).includes('model')));
  const ni = w.fiNormalizeIssue({ title: 'x', issue_type: 'Running toilet' }); t('issue_type kept', ni.issue_type === 'Running toilet');
  t('no issue_type when absent', !('issue_type' in w.fiNormalizeIssue({ title: 'x' })));
}

// ── safe URL ──
{
  const w = world();
  for (const bad of ['', 'localhost', 'http://127.0.0.1', 'https://10.0.0.5/x', 'ftp://example.com', 'https://user:pw@example.com', 'https://example.com:8080', 'https://printer.local', 'https://intranet', 'file:///etc/passwd', 'https://[::1]/'])
    t('blocked url: ' + bad, w.fiSafeUrl(bad).ok === false, w.fiSafeUrl(bad));
  t('bare domain gets https', w.fiSafeUrl('premierpm.com').url === 'https://premierpm.com/');
  t('www + path ok', w.fiSafeUrl('https://www.example.com/about').ok);
}

// ── page parsing ──
const HOME = `<html><head><title>Premier Property Management | Baltimore Rentals</title>
<meta property="og:site_name" content="Premier Property Management"><meta name="description" content="Full-service property management in Baltimore">
<meta name="theme-color" content="#0B3D91"><link rel="apple-touch-icon" sizes="180x180" href="/img/touch.png"><link rel="stylesheet" href="/site.css">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"LocalBusiness","name":"Premier PM","logo":"https://www.premierpm.com/logo.png","telephone":"410-555-0100","address":{"streetAddress":"1 Main St","addressLocality":"Baltimore","addressRegion":"MD","postalCode":"21201"}}</script>
<style>:root{--brand-primary:#0b3d91;--accent:#e07b00}.btn{color:#e07b00}.nav{background:#0b3d91}.x{color:#e07b00}.t{color:#333}</style></head>
<body><a href="mailto:info@premierpm.com?subject=hi">Email</a><a href="tel:+14105550100">Call</a></body></html>`;
{
  const w = world();
  const p = w.fiParseBrandHtml(HOME, 'https://www.premierpm.com/');
  t('name from og:site_name', p.name === 'Premier Property Management', p.name);
  t('tagline from description', p.tagline.startsWith('Full-service'));
  t('logo candidates: structured data first', p.logo[0].url === 'https://www.premierpm.com/logo.png' && p.logo.some(l => l.url.endsWith('/img/touch.png')), p.logo);
  t('theme color found', p.colors[0].hex === '#0b3d91');
  t('phone from structured data', p.phone === '410-555-0100');
  t('email from mailto (query stripped)', p.email === 'info@premierpm.com', p.email);
  t('address from structured data', p.address === '1 Main St, Baltimore, MD 21201', p.address);
  t('stylesheet queued', p.sheets.length === 1 && p.sheets[0] === 'https://www.premierpm.com/site.css');
  const c = w.fiColorsFromCss(p.styleText, p.colors);
  t('css variable + frequent colors found, neutrals skipped', c.some(x => x.hex === '#e07b00') && !c.some(x => x.hex === '#333333'), c);
  const pick = w.fiPickBrandColors(c);
  t('primary is the dark brand blue, accent clearly different', pick.primary === '#0b3d91' && pick.accent === '#e07b00', pick);
  t('no colors -> empty picks (not a crash)', w.fiPickBrandColors([]).primary === '');
  const bare = w.fiParseBrandHtml('<html><title>Home | Acme Roofing</title></html>', 'https://acmeroofing.com/');
  t('name falls back to title segment matching the domain', bare.name === 'Acme Roofing', bare.name);
  t('malformed JSON-LD ignored', w.fiParseBrandHtml('<script type="application/ld+json">{bad</script><title>X</title>', 'https://x.com').name === 'X');
  t('sniff png', w.fiSniffImage(PNG) === 'image/png' && w.fiSniffImage(enc('<html>')) === '' && w.fiSniffImage(enc('<svg xmlns=')) === 'image/svg+xml');
}

// ── scrape end to end (fake network) ──
{
  const w = world();
  const net = (map) => async (url) => { const f = map[url]; if (!f) return R(404, 'nope'); return typeof f === 'function' ? f() : f; };
  const fine = {
    'https://www.premierpm.com/': R(200, HOME), 'https://www.premierpm.com/site.css': R(200, '.a{background:#0b3d91}', 'text/css'),
    'https://www.premierpm.com/logo.png': R(200, PNG, 'image/png'), 'https://www.premierpm.com/img/touch.png': R(200, enc('<html>not an image</html>'), 'image/png'),
  };
  let r = await w.fiBrandScrape({}, { url: 'www.premierpm.com' }, net(fine));
  t('scrape ok', r.status === 200 && r.body.ok && r.body.name === 'Premier Property Management' && r.body.primary_color === '#0b3d91', r);
  t('scrape returns a verified logo as a data uri; fake image with image content-type skipped', r.body.logos.length === 1 && r.body.logos[0].data_uri.startsWith('data:image/png;base64,') && r.body.logos[0].mime === 'image/png', r.body.logos);
  t('scrape surfaces contact', r.body.phone === '410-555-0100' && r.body.email === 'info@premierpm.com');
  r = await w.fiBrandScrape({}, { url: 'http://127.0.0.1/' }, net({}));
  t('private address refused before any network call', r.status === 400 && r.body.error === 'bad_url', r);
  r = await w.fiBrandScrape({}, { url: 'evil.com' }, net({ 'https://evil.com/': R(302, '', 'text/html', 'http://169.254.169.254/latest') }));
  t('redirect to a private host refused', r.status === 502 && /not allowed/.test(r.body.message), r);
  r = await w.fiBrandScrape({}, { url: 'blocked.com' }, net({ 'https://blocked.com/': R(403, 'no') }));
  t('403 -> visible 502 with manual-entry advice', r.status === 502 && /by hand/.test(r.body.message) && /block/.test(r.body.message), r);
  r = await w.fiBrandScrape({}, { url: 'files.com' }, net({ 'https://files.com/': R(200, '%PDF', 'application/pdf') }));
  t('non-html refused', r.status === 502 && r.body.error === 'not_html', r);
  r = await w.fiBrandScrape({}, { url: 'down.com' }, async () => { throw new Error('connect ECONNREFUSED'); });
  t('network failure -> visible 502', r.status === 502 && r.body.error === 'fetch_failed' && /could not connect/.test(r.body.message), r);
  r = await w.fiBrandScrape({}, { url: 'thin.com' }, net({ 'https://thin.com/': R(200, '<html><body>' + '<p>x</p>'.repeat(10) + '</body></html>') }));
  t('thin page -> ok with explicit notes, not silent', r.status === 200 && r.body.ok && r.body.notes.length >= 3, r.body.notes);
  r = await w.fiBrandScrape({}, { url: 'hop.com' }, net({ 'https://hop.com/': R(301, '', 'text/html', 'https://www.hop.com/home'), 'https://www.hop.com/home': R(200, HOME) }));
  t('public redirect followed', r.status === 200 && r.body.website === 'https://www.hop.com/home', r);
}

// ── brand save with contact fields ──
{
  const w = world();
  let r = await w.fiBrandSave(w.env, { name: 'TEST-Premier', primary_color: '#0b3d91', accent_color: '#e07b00', website: 'premierpm.com', phone: '410-555-0100', email: 'info@premierpm.com', address: '1 Main St, Baltimore' });
  t('brand saved with contact fields', r.status === 200 && r.body.brand.website === 'https://premierpm.com' && r.body.brand.phone === '410-555-0100' && r.body.brand.email === 'info@premierpm.com' && r.body.brand.address.startsWith('1 Main'), r);
  r = await w.fiBrandSave(w.env, { name: 'TEST-B', primary_color: '#0b3d91', website: 'http://10.0.0.1' });
  t('private website refused', r.status === 400 && r.body.error === 'bad_website', r);
  r = await w.fiBrandSave(w.env, { name: 'TEST-B', primary_color: '#0b3d91', email: 'nope' });
  t('bad email refused', r.status === 400 && r.body.error === 'bad_email', r);
  r = await w.fiBrandSave(w.env, { id: (await w.fiList(w.env)).body.brands.find(x => x.name === 'TEST-Premier').id, name: 'TEST-Premier', primary_color: '#0b3d91', active: false });
  t('omitting contact fields keeps them (remove-company does not blank details)', r.status === 200 && r.body.brand.phone === '410-555-0100' && r.body.brand.website === 'https://premierpm.com' && r.body.brand.address.startsWith('1 Main'), r);
  t('brand headers include contact columns', ['Website', 'Phone', 'Email', 'Address'].every(c => w.FI_BRAND_HEADERS.includes(c)));
  t('contact line falls back to phone/email/site', w.fiBrandContactLine({ Phone: '1', Email: 'a@b.co', Website: 'https://b.co' }) === '1 · a@b.co · b.co' && w.fiBrandContactLine({ Contact_Line: 'Call us', Phone: '1' }) === 'Call us');
  const m = w.fiBuildEmail({ Name: 'Premier', Primary_Color: '#0b3d91', Phone: '410-555-0100' }, { Address: '1 A St' }, 'https://x/y', '');
  t('email footer shows phone', m.html.includes('410-555-0100'));
}

// ── transcription ──
{
  const w = world();
  const env = Object.assign({}, w.env, { GEMINI_API_KEY: 'gk' });
  const seen = [];
  const gem = (text, over = {}) => async (url, opts) => { if (!String(url).includes('generativelanguage')) return null; const b = JSON.parse(opts.body); seen.push(b.contents[0].parts[0].inline_data.mime_type); return R(200, JSON.stringify(Object.assign({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } }, over)), 'application/json'); };
  const req = (mime, n) => ({ headers: { get: k => (k === 'Content-Type' ? mime : '') }, arrayBuffer: async () => new ArrayBuffer(n) });
  const U = (q = '') => new URL('https://x/fi/transcribe?name=My%20recording%205.m4a' + q);
  t('mime mapping', w.fiAudioMime('audio/x-m4a', '') === 'audio/mp4' && w.fiAudioMime('application/octet-stream', 'a.m4a') === 'audio/mp4' && w.fiAudioMime('audio/mpeg', '') === 'audio/mp3' && w.fiAudioMime('text/html', 'a.html') === '');
  w.h.net = gem('Kitchen sink is leaking.');
  let r = await w.fiTranscribe(env, req('audio/mp4', 5000), U());
  t('transcribe ok', r.status === 200 && r.body.ok && r.body.transcript === 'Kitchen sink is leaking.' && seen[0] === 'audio/mp4', r);
  t('telemetry logged', w.h.telemetry.some(x => x.Job_Type === 'fi_transcribe' && x.Success === 'TRUE'));
  r = await w.fiTranscribe(env, req('audio/mp4', 0), U()); t('empty -> 400', r.status === 400 && r.body.error === 'empty', r);
  r = await w.fiTranscribe(env, req('audio/mp4', 15 * 1024 * 1024), U()); t('too big -> 413 with advice', r.status === 413 && /Split/.test(r.body.message), r);
  r = await w.fiTranscribe(env, req('text/html', 50), new URL('https://x/fi/transcribe')); t('not audio -> 415', r.status === 415, r);
  r = await w.fiTranscribe(w.env, req('audio/mp4', 50), U()); t('no key -> visible 500 not_configured', r.status === 500 && r.body.error === 'not_configured', r);
  w.h.net = gem('[no speech]'); r = await w.fiTranscribe(env, req('audio/mp4', 50), U()); t('silence -> 422 no_speech', r.status === 422 && r.body.error === 'no_speech', r);
  w.h.net = gem('long text', { candidates: [{ content: { parts: [{ text: 'cut off' }] }, finishReason: 'MAX_TOKENS' }] }); r = await w.fiTranscribe(env, req('audio/mp4', 50), U()); t('truncated flag passed on', r.body.ok && r.body.truncated === true, r);
  seen.length = 0; let calls = 0;
  w.h.net = async (url, opts) => { if (!String(url).includes('generativelanguage')) return null; calls++; const m = JSON.parse(opts.body).contents[0].parts[0].inline_data.mime_type; seen.push(m); if (m === 'audio/mp4') return R(400, JSON.stringify({ error: { message: 'Unsupported MIME type: audio/mp4' } }), 'application/json'); return R(200, JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok via aac' }] } }] }), 'application/json'); };
  r = await w.fiTranscribe(env, req('audio/mp4', 50), U()); t('m4a retried as aac when the first type is refused', r.body.ok && r.body.mime_used === 'audio/aac' && seen.join() === 'audio/mp4,audio/aac', [r, seen]);
  w.h.net = async (url) => String(url).includes('generativelanguage') ? R(400, JSON.stringify({ error: { message: 'bad audio' } }), 'application/json') : null;
  r = await w.fiTranscribe(env, req('audio/wav', 50), U()); t('provider error surfaced', r.status === 502 && /bad audio/.test(r.body.message), r);
  w.h.net = async (url) => String(url).includes('generativelanguage') ? R(200, JSON.stringify({ promptFeedback: { blockReason: 'SAFETY' } }), 'application/json') : null;
  r = await w.fiTranscribe(env, req('audio/wav', 50), U()); t('blocked result surfaced', r.status === 502 && /SAFETY/.test(r.body.message), r);
  // json mode (drive + small clip)
  w.h.net = async (url, opts) => {
    const u = String(url);
    if (u.includes('generativelanguage')) return R(200, JSON.stringify({ candidates: [{ content: { parts: [{ text: 'from drive' }] } }] }), 'application/json');
    if (u.includes('fields=id,name')) return u.includes('private01') ? R(404, '{}', 'application/json') : R(200, JSON.stringify({ id: 'f', name: 'r.m4a', mimeType: 'audio/mp4', size: '1000' }), 'application/json');
    if (u.includes('alt=media')) return R(200, new Uint8Array(1000), 'audio/mp4');
    return null;
  };
  r = await w.fiTranscribeJson(env, { drive_file_id: 'driveFile12345' }); t('drive file transcribed', r.body.ok && r.body.transcript === 'from drive', r);
  r = await w.fiTranscribeJson(env, { drive_file_id: 'private0123456' }); t('inaccessible drive file -> clear message', r.status === 404 && /Upload the recording/.test(r.body.message), r);
  r = await w.fiTranscribeJson(env, { drive_file_id: 'x' }); t('bad id -> 400', r.status === 400);
  r = await w.fiTranscribeJson(env, { audio_b64: Buffer.from('abcdefgh').toString('base64'), mime: 'audio/wav' }); t('small base64 clip works', r.body.ok, r);
  r = await w.fiTranscribeJson(env, { audio_b64: '***' }); t('bad base64 rejected', r.status === 400);
}

// ── routing disjointed notes ──
{
  const w = world();
  const areas = [{ id: 'a1', name: 'Kitchen' }, { id: 'a2', name: 'Heating / HVAC' }, { id: 'a3', name: 'Bathroom 2 (2nd floor)', issues: ['Loose toilet'] }];
  const good = { issues: [
    { area_id: 'a3', note_id: 'n1', quote: 'upstairs bath fan is loud', type: 'Exhaust fan missing, noisy or not working', title: 'Noisy exhaust fan', trade: 'hvac', severity: 'low', detail: 'Fan is loud.', recommended_fix: 'Replace fan', fix_source: 'suggested' },
    { area_id: 'zzz', note_id: 'n1', title: 'Cracked tile somewhere', trade: 'flooring', severity: 'low', detail: 'near stairs' },
    { area_id: 'a1', title: '', trade: 'plumbing' }],
    equipment: [{ area_id: 'a2', kind: 'furnace', brand: 'Carrier', model: '59TP6', notes: 'heard by voice - verify' }, { area_id: 'nope', kind: 'water_heater', brand: 'Rheem' }],
    conditions: [{ area_id: 'a1', condition: 'poor' }, { area_id: 'a1', condition: 'terrible' }, { area_id: 'zzz', condition: 'good' }],
    new_areas: [{ name: 'Sunroom', note_id: 'n2' }], unassigned: [{ note_id: 'n2', text: 'something about the back', why: 'unclear which room' }] };
  w.h.ai = JSON.stringify(good);
  let r = await w.fiRouteNotes(w.env, { address: '122 S Gilmor', pre1978: true, areas, notes: [{ id: 'n1', text: 'upstairs bath fan is loud' }, { id: 'n2', text: 'sunroom' }] });
  t('route ok', r.status === 200 && r.body.ok, r);
  t('issue placed in the right area with its quote', r.body.issues.length === 1 && r.body.issues[0].area_id === 'a3' && r.body.issues[0].quote.includes('fan') && r.body.issues[0].issue_type.startsWith('Exhaust fan'), r.body.issues);
  t('unknown area never dropped: goes to unassigned', r.body.unassigned.some(u => /Cracked tile/.test(u.text)) && r.body.unassigned.some(u => /Equipment/.test(u.text)) && r.body.unassigned.some(u => /something about the back/.test(u.text)), r.body.unassigned);
  t('equipment routed', r.body.equipment.length === 1 && r.body.equipment[0].area_id === 'a2' && r.body.equipment[0].kind === 'furnace');
  t('only valid conditions on known areas', r.body.conditions.length === 1 && r.body.conditions[0].condition === 'poor', r.body.conditions);
  t('new area proposed, not created', r.body.new_areas.length === 1 && r.body.new_areas[0].name === 'Sunroom');
  const job = w.h.calls.find(c => c.startsWith('AI fi_route')); t('AI called as customer-facing (pinned to Claude)', job && job.includes('customerFacing=true'), job);
  const prompt = w.fiBuildRoutePrompt({ address: 'x', pre1978: true, areas, notes: [{ id: 'n1', text: 'hi' }], proposed: ['Leak'] }, [{ name: 'Running toilet', trade: 'plumbing' }]);
  t('prompt lists area ids, catalog types, pre-1978, existing issues', prompt.includes('- a3 = Bathroom 2') && prompt.includes('Running toilet') && prompt.includes('BUILT BEFORE 1978') && prompt.includes('Loose toilet') && prompt.includes('- Leak'));
  r = await w.fiRouteNotes(w.env, { areas, notes: [] }); t('no notes -> 400', r.status === 400);
  r = await w.fiRouteNotes(w.env, { areas: [], notes: [{ id: 'n', text: 'x' }] }); t('no areas -> 400', r.status === 400);
  r = await w.fiRouteNotes(w.env, { areas, notes: [{ id: 'n', text: 'x'.repeat(41000) }] }); t('too much text -> 413', r.status === 413);
  w.h.ai = new Error('overloaded'); r = await w.fiRouteNotes(w.env, { areas, notes: [{ id: 'n', text: 'x' }] }); t('AI failure -> visible 502, transcripts kept', r.status === 502 && r.body.error === 'ai_failed' && /kept/.test(r.body.message), r);
  w.h.ai = 'sorry I cannot'; r = await w.fiRouteNotes(w.env, { areas, notes: [{ id: 'n', text: 'x' }] }); t('bad AI output -> visible 502', r.status === 502 && r.body.error === 'ai_bad_output', r);
}

// ── issue-type list ──
{
  const w = world();
  const bad = w.FI_TYPE_SEED.filter(l => l.split('|').length !== 6);
  t('every seed line has 6 fields', bad.length === 0, bad);
  const trades = ['plumbing','electrical','hvac','roofing','structural','carpentry','drywall_paint','flooring','windows_doors','appliances','pest','safety','exterior_site','cleaning','general','tenant_action'], sev = ['urgent','high','medium','low','info'];
  t('every seed trade and severity is valid', w.FI_TYPE_SEED.every(l => { const f = l.split('|'); return trades.includes(f[1]) && sev.includes(f[2]); }));
  t('seed names unique', new Set(w.FI_TYPE_SEED.map(l => l.split('|')[0].toLowerCase())).size === w.FI_TYPE_SEED.length);
  let r = await w.fiTypesList(w.env);
  t('first call seeds the list', r.body.ok && r.body.types.length === w.FI_TYPE_SEED.length && w.h.tabs.FI_Issue_Types.rows.length === w.FI_TYPE_SEED.length, r.body.types && r.body.types.length);
  r = await w.fiTypesList(w.env); t('second call does not reseed', w.h.tabs.FI_Issue_Types.rows.length === w.FI_TYPE_SEED.length);
  t('tab registered', !!w.FI_TABS.FI_Issue_Types);
  r = await w.fiTypesSave(w.env, { name: 'TEST-Squeaky stair', trade: 'carpentry', severity: 'low', areas: 'stair, hall', recommended_fix: 'Screw down tread' });
  t('new type saved', r.status === 200 && r.body.type.name === 'TEST-Squeaky stair' && r.body.type.areas.join() === 'stair,hall' && r.body.type.source === 'custom', r);
  const id = r.body.type.id;
  r = await w.fiTypesSave(w.env, { name: 'test-squeaky STAIR', trade: 'carpentry' }); t('duplicate name -> 409', r.status === 409 && r.body.error === 'duplicate', r);
  r = await w.fiTypesSave(w.env, { id, name: 'TEST-Squeaky stair', trade: 'carpentry', severity: 'medium', recommended_fix: 'Re-nail' }); t('edit in place', r.status === 200 && r.body.type.severity === 'medium' && r.body.type.recommended_fix === 'Re-nail', r);
  r = await w.fiTypesSave(w.env, { id: 'type_missing', name: 'TEST-nope' }); t('edit of missing id -> 404', r.status === 404);
  r = await w.fiTypesSave(w.env, { name: 'ab' }); t('short name -> 400', r.status === 400);
  r = await w.fiTypesSave(w.env, { id, name: 'TEST-Squeaky stair', active: false }); r = await w.fiTypesList(w.env); t('deactivated type hidden from the list', !r.body.types.some(x => x.id === id));
  w.h.corruptOnce = true; w.h.corrupt = (tab, vals, headers) => { if (tab === 'FI_Issue_Types') vals[headers.indexOf('Name')] = 'garbled'; return vals; };
  r = await w.fiTypesSave(w.env, { name: 'TEST-Another thing', trade: 'general' }); t('corrupted type write -> 500 verify_failed', r.status === 500 && r.body.error === 'verify_failed', r);
  // touch
  r = await w.fiTypesTouch(w.env, { items: [{ name: 'Running toilet', trade: 'plumbing' }, { name: 'running TOILET', trade: 'plumbing' }, { name: 'Brand new kind of problem', trade: 'electrical', severity: 'high', recommended_fix: 'Fix it' }] });
  t('touch counts uses (case-insensitive, aggregated) and learns new types', r.body.ok && r.body.updated === 1 && r.body.created === 1, r);
  const lst = (await w.fiTypesList(w.env)).body.types;
  t('use count recorded and list sorted by use', lst[0].name === 'Running toilet' && lst[0].uses === 2, lst.slice(0, 2));
  const learned = lst.find(x => x.name === 'Brand new kind of problem'); t('learned type stored with source learned', learned && learned.source === 'learned' && learned.uses === 1 && learned.trade === 'electrical');
  r = await w.fiTypesTouch(w.env, { items: [] }); t('empty touch -> 400', r.status === 400);
  r = await w.fiTypesTouch(w.env, { items: [{ name: 'x' }] }); t('unusable names -> 400', r.status === 400);
  w.h.corruptOnce = true; w.h.corrupt = (tab, vals, headers) => { if (tab === 'FI_Issue_Types') vals[headers.indexOf('Uses')] = '999'; return vals; };
  r = await w.fiTypesTouch(w.env, { items: [{ name: 'Dripping faucet' }] }); t('touch verify catches a bad write', r.status === 500 && r.body.error === 'verify_failed', r);
  // seed failure surfaces through the route wrapper
  const w2 = world(); w2.h.dropAppend = 'FI_Issue_Types';
  r = await w2.fiRoute(w2.env, 'issue-types', () => w2.fiTypesList(w2.env)); t('seed that did not persist -> visible 500', r.status === 500 && r.body.ok === false, r);
}

// ── read label from photo ──
{
  const w = world();
  w.h.tabs.FI_Photos = { headers: ['ID', 'Inspection_ID', 'Drive_File_ID', 'Mime', 'Bytes', 'Created_At', 'Active'], rows: [['ph_plate1', 'TEST-x_0001', 'drv1', 'image/jpeg', '2000', 'n', 'TRUE'], ['ph_big001', 'TEST-x_0001', 'drv2', 'image/jpeg', String(6 * 1024 * 1024), 'n', 'TRUE']] };
  w.h.net = async (url) => (String(url).includes('alt=media') ? R(200, new Uint8Array([1, 2, 3]), 'image/jpeg') : null);
  let job = null;
  w.h.ai = (j) => { job = j; return JSON.stringify({ readable: true, kind: 'furnace', brand: 'Carrier', model: '59TP6A060', serial: '1008A12345', year: '10/2008', filter_size: '16x25', notes: '60,000 BTU' }); };
  let r = await w.fiReadLabel(w.env, { inspection_id: 'TEST-x_0001', photo_id: 'ph_plate1', kind: 'furnace' });
  t('label read', r.body.ok && r.body.found && r.body.equipment.model === '59TP6A060' && r.body.equipment.kind === 'furnace', r);
  t('image sent to Claude as a vision block on the REASON tier', job && job.media && job.media.type === 'image' && job.media.source.media_type === 'image/jpeg' && job.tier === 'REASON', job && Object.keys(job));
  r = await w.fiReadLabel(w.env, { inspection_id: 'TEST-x_0001', photo_id: 'ph_nope01' }); t('photo not uploaded yet -> 404 with advice', r.status === 404 && /uploading/.test(r.body.message), r);
  r = await w.fiReadLabel(w.env, { inspection_id: 'TEST-x_0001', photo_id: 'ph_big001' }); t('huge photo -> 413 visible', r.status === 413, r);
  r = await w.fiReadLabel(w.env, { inspection_id: 'TEST-other_001', photo_id: 'ph_plate1' }); t('photo from another inspection not readable', r.status === 404, r);
  w.h.ai = JSON.stringify({ readable: false }); r = await w.fiReadLabel(w.env, { inspection_id: 'TEST-x_0001', photo_id: 'ph_plate1' }); t('unreadable -> found:false with message (not a fake fill)', r.body.ok && r.body.found === false && /No readable/.test(r.body.message), r);
  w.h.ai = new Error('x'); r = await w.fiReadLabel(w.env, { inspection_id: 'TEST-x_0001', photo_id: 'ph_plate1' }); t('AI error -> visible 502', r.status === 502 && r.body.error === 'ai_failed');
  w.h.net = async (url) => (String(url).includes('alt=media') ? R(500, 'x') : null); w.h.ai = '{}'; r = await w.fiReadLabel(w.env, { inspection_id: 'TEST-x_0001', photo_id: 'ph_plate1' }); t('storage read failure -> visible 502', r.status === 502 && r.body.error === 'drive_read', r);
}

// ── report never leaks voice notes / transcripts ──
{
  const w = world();
  const d = mkDoc({ voice_notes: [{ id: 'v1', transcript: 'private rambling' }] }); d.areas[1].equipment = [{ id: 'e1', kind: 'furnace', brand: 'Carrier', model: 'M1' }];
  let r = await w.fiSave(w.env, { id: 'fi_r2_0001', base_rev: 0, doc: d });
  t('doc with voice notes + equipment saves and reads back', r.status === 200 && r.body.ok, r);
  r = await w.fiPublish(w.env, { id: 'fi_r2_0001', rev: 1, ack_warnings: true });
  t('publish ok', r.body.ok, r);
  const rep = await w.fiReport(w.env, { headers: { get: () => '' } }, new URL('https://x/fi/report?r=' + w.h.tabs.FI_Inspections.rows[0][w.h.tabs.FI_Inspections.headers.indexOf('Report_Token')]));
  t('public report has equipment but no voice notes', rep.body.ok && !('voice_notes' in rep.body.doc) && rep.body.doc.areas[1].equipment[0].model === 'M1', rep);
  t('transcript text absent from the whole public payload', !JSON.stringify(rep.body).includes('private rambling'));
}

// ── phone page and server agree on equipment kinds/fields ──
{
  const w = world();
  const html = fs.readFileSync(new URL('../field-inspect.html', import.meta.url), 'utf8');
  const m = html.match(/var EQUIP_KINDS = (\{[\s\S]*?\n\});/);
  const phone = new Function('return ' + m[1])();
  t('phone and server list the same equipment kinds', JSON.stringify(Object.keys(phone)) === JSON.stringify(Object.keys(w.FI_EQUIP_KINDS)), Object.keys(phone));
  t('phone and server agree on the extra fields and labels of every kind', Object.keys(phone).every(k => JSON.stringify(phone[k].extra) === JSON.stringify(w.FI_EQUIP_KINDS[k].extra) && phone[k].label === w.FI_EQUIP_KINDS[k].label));
  const rep = fs.readFileSync(new URL('../inspection-report.html', import.meta.url), 'utf8');
  t('report page knows every equipment kind', Object.keys(w.FI_EQUIP_KINDS).filter(k => k !== 'other').every(k => rep.includes(k + ':')));
}

// ── wiring / staging guards ──
{
  for (const p of ['/fi/route', '/fi/brand/scrape', '/fi/read-label', '/fi/transcribe/json', '/fi/issue-types/save', '/fi/issue-types/touch', '/fi/issue-types', '/fi/transcribe'])
    t('route wired: ' + p, src.includes("path === '" + p + "'"));
  t('staging token: transcribe raw route guarded to TEST- inspections', /path === '\/fi\/transcribe'[\s\S]{0,400}startsWith\('TEST-'\)/.test(src));
  t('staging token: read-label limited to TEST- inspections', /path === '\/fi\/read-label'\) return String\(\(body && body\.inspection_id\) \|\| ''\)\.startsWith\('TEST-'\)/.test(src));
  t('staging token: issue-type writes limited to TEST- names', src.includes("path === '/fi/issue-types/save'") && src.includes("path === '/fi/issue-types/touch'") && /touch'\) return Array\.isArray[\s\S]{0,200}startsWith\('TEST-'\)/.test(src));
  t('BUILD_VERSION bumped', src.includes("BUILD_VERSION = '2026-10-15.02-field-inspection-update'"));
}

console.log(`fi-round2: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
