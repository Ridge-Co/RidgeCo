// Trash service — "I tapped Save before the photos loaded, and the invoice preview only
// offered Close or Send-without-photos" (Brett, Nov 21 2026). Runs the REAL trash.html
// script against a tiny fake DOM and checks:
//   (1) Save visit is locked while any photo is still uploading, and saveVisit() refuses to post;
//   (2) the invoice preview lists every visit with its photo count and an "Add photos" button;
//   (3) "Add photos" opens the visit sheet LOCKED to that visit's date with the extra-charge
//       picker hidden, so it can only merge into the existing visit (no new billable visit,
//       no change to the total);
//   (4) saving posts the photos to /trash/log-visit for that same date with extra 0, then the
//       same invoice preview reopens; Cancel also goes back to the preview;
//   (5) the modal's dismiss button says Back and the preview says nothing has been sent;
//   (6) the Worker preview returns a per-visit photo count.
import fs from 'fs';
import vm from 'vm';

const html = fs.readFileSync(new URL('../trash.html', import.meta.url), 'utf8');
const worker = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
let pass = 0, fail = 0;
const t = (n, c, got) => { if (c) pass++; else { fail++; console.log('FAIL:', n, got !== undefined ? ('got ' + JSON.stringify(got)) : ''); } };

// ── fake DOM: only what trash.html's script touches ─────────────────────────
function el(id){
  const cls = new Set();
  const e = { id, value:'', disabled:false, textContent:'', innerHTML:'', attrs:{}, children:[],
    classList:{ add:c=>cls.add(c), remove:c=>cls.delete(c), contains:c=>cls.has(c),
      toggle:(c,on)=>{ const v = on===undefined ? !cls.has(c) : !!on; if(v) cls.add(c); else cls.delete(c); return v; } },
    setAttribute(k,v){ this.attrs[k]=String(v); }, getAttribute(k){ return k in this.attrs ? this.attrs[k] : null; },
    removeAttribute(k){ delete this.attrs[k]; }, appendChild(c){ this.children.push(c); return c; },
    click(){}, addEventListener(){}, focus(){}, style:{} };
  return e;
}
const els = {};
const document = {
  getElementById: id => (els[id] = els[id] || el(id)),
  createElement: () => el(''),
  querySelectorAll: () => [],
  addEventListener(){},
};
// The extra-charge buttons are looked up by querySelectorAll; an empty list is fine here.
const apiCalls = [];
let previewVisits = [{ id:'V1', date:'2026-11-18', base:40, extra:0, reason:'', photos:0 },
                     { id:'V2', date:'2026-11-20', base:40, extra:0, reason:'', photos:0 }];
const pendingPuts = [];
const sandbox = {
  document, window:{ location:{ origin:'https://x', search:'' }, addEventListener(){} },
  localStorage:{ getItem:()=>null, setItem(){}, removeItem(){} },
  sessionStorage:{ getItem:()=>null, setItem(){}, removeItem(){} },
  navigator:{}, location:{ search:'', href:'' }, console, setTimeout:()=>0, clearTimeout(){},
  confirm:()=>true, alert(){}, URLSearchParams,
  fetch: () => new Promise(res => pendingPuts.push(() => res({ json: () => Promise.resolve({ id:'F' + pendingPuts.length }) }))),
  Promise, Object, Array, String, Number, JSON, Math, Date,
};
sandbox.window.document = document;
vm.createContext(sandbox);
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
t('found the inline script', scripts.length >= 1, scripts.length);
vm.runInContext(scripts.join('\n'), sandbox);

// Replace api() with a recorder (the real one does network + auth).
vm.runInContext(`api = function(method, path, body){
  __calls.push({ method, path, body: JSON.parse(JSON.stringify(body||null)) });
  if (path === '/create-upload-session') return Promise.resolve({ success:true, upload_url:'https://drive/put', wo_folder_id:'FOLD', wo_folder_url:'https://drive/f' });
  if (path === '/trash/invoice') return Promise.resolve({ preview:{ property:'12 Main St', week:'2026-11-16', customer:{ id:'9', name:'Owner A' },
    visits: __visits, lines:[{ desc:'Trash service 2026-11-18', amount:40 },{ desc:'Trash service 2026-11-20', amount:40 }], total:80,
    attach_photos: __visits.reduce(function(s,v){ return s+v.photos; },0), warnings:['No photos on these visits — the invoice will carry no photo proof.'] } });
  if (path === '/trash/log-visit') return Promise.resolve({ success:true, merged:true });
  if (path === '/trash/week') return Promise.resolve({ week:'2026-11-16', properties:[] });
  if (path === '/trash/unbilled') return Promise.resolve({ items:[] });
  return Promise.resolve({});
};
refreshWeek = function(){ return Promise.resolve(); };
props = [{ id:'P1', label:'12 Main St' }];`, Object.assign(sandbox, { __calls: apiCalls, __visits: previewVisits }));

const flush = () => new Promise(r => setImmediate(r));
const $ = id => document.getElementById(id);
const run = code => vm.runInContext(code, sandbox);

// ── 5. Back button + "nothing sent" note ────────────────────────────────────
t('invoice sheet dismiss says Back', /onclick="closeInv\(\)">Back</.test(html));
t('no bare Close on the invoice sheet', !/onclick="closeInv\(\)">Close</.test(html));

// ── 2. Preview lists visits with photo counts and Add photos buttons ────────
run(`previewInvoice('P1','2026-11-16')`); await flush(); await flush();
const body1 = $('im-body').innerHTML;
t('preview shows each visit date', /2026-11-18/.test(body1) && /2026-11-20/.test(body1), body1.slice(0,200));
t('preview flags visits with no photos', (body1.match(/no photos/g)||[]).length === 2);
t('preview has an Add photos button per visit', (body1.match(/addPhotosFromPreview\(/g)||[]).length === 2);
t('preview says nothing has been sent', /Nothing has been sent yet/.test(body1));
t('Send button still offered', !$('im-send').classList.contains('hide'));

// ── 3. Add photos opens a locked sheet ───────────────────────────────────────
run(`addPhotosFromPreview('P1','2026-11-16','2026-11-18')`);
t('invoice sheet closed', !$('inv-modal').classList.contains('open'));
t('visit sheet open', $('visit-modal').classList.contains('open'));
t('date preset to the visit date', $('vm-visit-date').value === '2026-11-18', $('vm-visit-date').value);
t('date is locked', $('vm-visit-date').disabled === true);
t('extra-charge picker hidden', $('vm-extra-block').classList.contains('hide'));
t('title says Add photos', /^Add photos/.test($('vm-title').textContent), $('vm-title').textContent);

// ── 1. Save is locked while uploading ────────────────────────────────────────
run(`pickPhotos({ files:[{ name:'a.jpg', type:'image/jpeg' },{ name:'b.jpg', type:'image/jpeg' }], value:'x' })`);
t('save disabled while 2 uploads run', $('vm-save').disabled === true);
t('save button says uploading', /Uploading 2 photos/.test($('vm-save').innerHTML), $('vm-save').innerHTML);
await flush(); await flush();
const before = apiCalls.filter(c => c.path === '/trash/log-visit').length;
run(`saveVisit(document.getElementById('vm-save'))`); await flush();
t('saveVisit refuses while uploading', apiCalls.filter(c => c.path === '/trash/log-visit').length === before);
pendingPuts.shift()(); await flush(); await flush(); await flush();
t('still locked with 1 left', $('vm-save').disabled === true && /Uploading 1 photo/.test($('vm-save').innerHTML), $('vm-save').innerHTML);
pendingPuts.shift()(); await flush(); await flush(); await flush();
t('save unlocks when uploads finish', $('vm-save').disabled === false && $('vm-save').textContent === 'Save photos', $('vm-save').textContent);

// ── 4. Save merges into the same visit, then the preview reopens ─────────────
apiCalls.length = 0;
previewVisits[0].photos = 2;
run(`saveVisit(document.getElementById('vm-save'))`); await flush(); await flush(); await flush();
const lv = apiCalls.find(c => c.path === '/trash/log-visit');
t('posted to log-visit', !!lv);
t('posted the locked date', lv && lv.body.visit_date === '2026-11-18', lv && lv.body.visit_date);
t('posted both photo ids', lv && lv.body.photo_file_ids.length === 2, lv && lv.body.photo_file_ids);
t('no extra charge added', lv && lv.body.extra_amount === 0, lv && lv.body.extra_amount);
t('no extra reason sent', lv && !('extra_reason' in lv.body));
t('visit sheet closed after save', !$('visit-modal').classList.contains('open'));
t('invoice preview reopened', $('inv-modal').classList.contains('open') && apiCalls.some(c => c.path === '/trash/invoice' && c.body.preview_only));
await flush(); await flush();
t('reopened preview shows the new photos', /📷 2 photos/.test($('im-body').innerHTML), $('im-body').innerHTML.slice(0,300));

// Cancel from Add photos also returns to the preview
run(`addPhotosFromPreview('P1','2026-11-16','2026-11-20')`);
apiCalls.length = 0;
run(`closeVisit()`);
t('cancel returns to the preview', $('inv-modal').classList.contains('open') && apiCalls.some(c => c.path === '/trash/invoice'));

// Add-photos with zero photos does not post
run(`addPhotosFromPreview('P1','2026-11-16','2026-11-20')`);
apiCalls.length = 0;
run(`saveVisit(document.getElementById('vm-save'))`); await flush();
t('add-photos with no photos does not post', !apiCalls.some(c => c.path === '/trash/log-visit'));
run(`closeVisit()`);

// A normal Log visit is unchanged: date editable, extras shown
run(`openVisit('P1')`);
t('normal log visit date editable', $('vm-visit-date').disabled === false);
t('normal log visit shows extras', !$('vm-extra-block').classList.contains('hide'));
t('normal log visit button label', $('vm-save').textContent === 'Save visit', $('vm-save').textContent);

// ── 6. Worker preview carries a per-visit photo count (read-only) ────────────
t('worker preview returns per-visit photos', /visits: toBill\.map\(v => \(\{ id: v\.ID,[^\n]*photos: String\(v\.Photo_File_IDs/.test(worker));

console.log(`trash-add-photos: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
