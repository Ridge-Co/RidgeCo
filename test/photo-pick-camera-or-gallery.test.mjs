// Photo inputs must let people choose: take a new photo OR pick one already in the gallery (Brett, Oct 23 2026).
// A file input with a `capture` attribute opens the camera ONLY (no gallery, no multi-select), so a tenant who already
// has the photo could not upload it. Standing rule since July 17 (FEATURE_LOG): never add capture to file inputs.
// The tenant and owner portals still had cap:'environment' on the BEFORE / AFTER / REPORT ISSUE buttons.
import fs from 'fs';
import assert from 'node:assert';
const read = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

const pages = fs.readdirSync(new URL('..', import.meta.url)).filter(f => f.endsWith('.html'));
for (const f of ['tenant.html', 'owner.html', 'vendor.html', 'index.html']) {
  const s = read(f);
  const caps = [...s.matchAll(/cap:\s*'([^']*)'/g)].map(m => m[1]);
  ok(caps.length >= 4, f + ' still has its photo-type table (BEFORE / AFTER / REPORT / RECEIPT)');
  ok(caps.every(c => c === ''), f + ' photo-type table never forces the camera (cap must be empty). Found: ' + caps.join(','));
}
// Across every page: a literal capture= on a file input is only allowed on the vendor additional-work "Take photo" button,
// which sits next to a separate gallery input, so both choices exist there.
const offenders = [];
for (const f of pages) {
  const s = read(f);
  for (const m of s.matchAll(/<input[^>]*type="file"[^>]*>/g)) {
    if (/\bcapture\s*=/.test(m[0]) && !(f === 'vendor.html' && /awAddFiles/.test(m[0]))) offenders.push(f + ': ' + m[0].slice(0, 100));
  }
}
ok(offenders.length === 0, 'no file input forces the camera except the vendor additional-work Take-photo button. Found:\n  ' + offenders.join('\n  '));
const v = read('vendor.html');
const awCam = /capture="environment"[^>]*awAddFiles/.test(v), awGal = /accept="image\/\*" multiple[^>]*awAddFiles/.test(v);
ok(awCam && awGal, 'vendor additional-work keeps BOTH a Take-photo input and a separate gallery input');
// tenant create-issue + note photo inputs stay gallery-capable and multi-select
const t = read('tenant.html');
ok(/id="noteFiles" accept="image\/\*,video\/\*" multiple/.test(t) && /id="srFiles" accept="image\/\*,video\/\*" multiple/.test(t), 'tenant note + service-request photo inputs allow gallery multi-select');
console.log(`photo-pick-camera-or-gallery: ${n}/${n} passing`);
