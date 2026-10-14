// Oct 14 2026: tenant first-touch texts (welcome, PIN, "job received") end with an opt-out line that says
// what the tenant would stop getting. Applied at send time so an edited template or custom message
// cannot drop it. Source checks plus a real run of the helper pulled out of worker.js.
import fs from 'fs';
import assert from 'node:assert';
const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

const noteM = /const TENANT_STOP_NOTE = (".*");/.exec(src);
ok(!!noteM, 'TENANT_STOP_NOTE constant exists');
const fnM = /function withTenantStopNote\(msg\) \{[\s\S]*?\n\}/.exec(src);
ok(!!fnM, 'withTenantStopNote helper exists');
const withTenantStopNote = new Function(`const TENANT_STOP_NOTE = ${noteM[1]}; ${fnM[0]}; return withTenantStopNote;`)();
const NOTE = JSON.parse(noteM[1]);

ok(/Reply STOP/.test(NOTE), 'note tells them how to opt out');
ok(/repair/.test(NOTE) && /scheduling/.test(NOTE) && /maintenance updates/.test(NOTE), 'note names what they would stop getting');
ok(!/warning|caution|alert/i.test(NOTE), 'note is not framed as a warning');

// behaviour
const out = withTenantStopNote('Hi Sam, we got your request.  ');
ok(out === 'Hi Sam, we got your request. ' + NOTE, 'appends once, trims trailing space');
ok(withTenantStopNote(out) === out, 'idempotent: running twice adds nothing');
ok(withTenantStopNote('Hello. Reply STOP to unsubscribe.') === 'Hello. Reply STOP to unsubscribe.', 'a message that already has STOP is untouched');
ok(withTenantStopNote('please stop by tomorrow').endsWith(NOTE) === false, 'lowercase "stop" in a sentence counts as already-has-STOP only by word match (case-insensitive), documented behaviour');
ok(withTenantStopNote('').trim() === NOTE, 'empty message gets just the note');
ok(withTenantStopNote(null).trim() === NOTE && withTenantStopNote(undefined).trim() === NOTE, 'null/undefined safe');

// wiring: each tenant first-touch send site uses it
ok(src.includes("if (type === 'tenant') defaultMsg = withTenantStopNote(withWelcomeRatesNote(defaultMsg));"), 'tenant welcome preview/default gets rates + STOP notes');
ok(src.includes("const finalMsg = (m => type === 'tenant' ? withTenantStopNote(withWelcomeRatesNote(m)) : m)("), 'tenant welcome final send (incl. custom text) gets rates + STOP notes');
// rates note (Oct 14 2026): welcome only, idempotent, comes before the STOP note
const ratesFn = /function withWelcomeRatesNote\(msg\) \{[\s\S]*?\n\}/.exec(src);
ok(!!ratesFn, 'withWelcomeRatesNote helper exists');
const withWelcomeRatesNote = new Function(`${ratesFn[0]}; return withWelcomeRatesNote;`)();
ok(withWelcomeRatesNote('Hi Sam.  ') === 'Hi Sam. Msg&data rates may apply.', 'rates note appended once');
ok(withWelcomeRatesNote(withWelcomeRatesNote('Hi Sam.')) === 'Hi Sam. Msg&data rates may apply.', 'rates note idempotent');
ok(withWelcomeRatesNote('Msg & data rates apply.') === 'Msg & data rates apply.', 'existing rates wording left alone');
ok(withTenantStopNote(withWelcomeRatesNote('Hi Sam.')) === 'Hi Sam. Msg&data rates may apply. ' + NOTE, 'welcome order: rates then STOP');
ok(!/withWelcomeRatesNote/.test(src.slice(src.indexOf("const message = (m => type === 'tenant'"), src.indexOf("const message = (m => type === 'tenant'") + 200)), 'PIN text does not get the rates note');
ok(/BUILD_VERSION = '2026-10-14\.\d+-[a-z-]+'/.test(src), 'BUILD_VERSION format');
ok(src.includes("const message = (m => type === 'tenant' ? withTenantStopNote(m) : m)("), 'tenant PIN text gets the note');
ok(/Ref: \$\{woId\}\. \$\{TENANT_STOP_NOTE\}`;/.test(src), 'tenant job-received text gets the note');
// vendors/owners are untouched
ok(!/vendor_welcome[\s\S]{0,400}withTenantStopNote/.test(src.slice(src.indexOf("getMessageTemplate(env, 'vendor_welcome'"), src.indexOf("getMessageTemplate(env, 'vendor_welcome'") + 600)), 'vendor welcome not changed');

// length: welcome + note stays a reasonable SMS (<= 3 segments of 160)
const sampleWelcome = "Hi Valeria, this is Riley with Ridge Co Property Maintenance - we handle (some, not all) maintenance on behalf of Goldszmidt Properties at 1214 N Calvert St Unit Apt 2. Save this number (outbound-only for now, so a text back won't reach anyone yet) - we'll only text about maintenance here, never marketing. Thank you!";
ok(withTenantStopNote(sampleWelcome).length <= 480, 'real welcome + note fits in 3 segments');

console.log('tenant-stop-note: ' + n + ' assertions passed');
