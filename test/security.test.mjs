// Security regressions from the pre-merge review (July 21). Run: node test/security.test.mjs
//
// Every case here is a defect that was FOUND IN REVIEW and fixed. They are pinned
// so the merge to production can't silently reintroduce them.

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const tmp  = join(mkdtempSync(join(tmpdir(), 'ridgeco-sec-')), 'worker.mjs');
writeFileSync(tmp, readFileSync(join(here, '..', 'worker.js')));
const { detectSource } = await import(pathToFileURL(tmp).href);

let pass = 0, fail = 0;
const eq = (actual, expected, label) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label}\n       expected: ${e}\n       actual:   ${a}`); }
};
const section = (t) => console.log(`\n── ${t} ──`);

// ── F1: stored XSS in the admin Hub via linkify ──────────────────────────────
// linkify escaped & < > but NOT quotes, then spliced the match into href="$1".
// The URL pattern [^\s]+ swallows a quote, so email-derived Description text
// could close the attribute and inject an event handler — arbitrary JS in the
// Hub origin, where AUTH_TOKEN lives in localStorage.
section('F1 — linkify must not allow attribute breakout (CRITICAL)');
const html = readFileSync(join(here, '..', 'index.html'), 'utf8');
const m = html.match(/function linkify\(text\)\s*\{[\s\S]*?\n\}/);
eq(!!m, true, 'linkify found in index.html');
const linkify = new Function('text', m[0].replace(/^function linkify\(text\)\s*\{/, '').replace(/\}$/, ''));

const ATTACKS = [
  ['http://a.co/"onmouseover="alert(1)',            'double-quote breakout'],
  ["http://a.co/'onmouseover='alert(1)",            'single-quote breakout'],
  ['http://a.co/"><script>alert(1)</script>',       'tag breakout'],
  ['<img src=x onerror=alert(1)>',                  'raw tag injection'],
  ['http://a.co/" onfocus="alert(1)" autofocus="',  'attribute injection with spaces'],
];
// linkify's own anchor markup is the ONLY markup it may emit. Strip exactly that,
// and nothing structural may remain — no raw quote, no angle bracket. An entity
// like &quot; is inert inside an attribute, so the test must look for RAW
// characters, not for text that merely reads like a handler.
const ANCHOR_OPEN = /<a href="[^"]*" target="_blank" rel="noopener" style="color:var\(--info\);word-break:break-all">/g;
for (const [payload, label] of ATTACKS) {
  const out = linkify(payload);
  // A live handler needs a RAW quote (or nothing) after the '='. Entity-encoded
  // quotes cannot terminate the attribute.
  eq(/\son\w+\s*=\s*["']/.test(out), false, `${label}: no live event handler`);
  const stripped = out.replace(ANCHOR_OPEN, '').replace(/<\/a>/g, '');
  eq(/[<>"']/.test(stripped), false, `${label}: no raw < > \" ' survives outside linkify's own anchor`);
}
// ...while still doing its actual job.
const ok = linkify('see http://example.com/x?a=1&b=2 for details');
eq(/<a href="http:\/\/example\.com\/x\?a=1&amp;b=2"/.test(ok), true, 'ordinary URL still linkified');
eq(linkify('plain text').includes('<a '), false, 'non-URL text is not linkified');
eq(linkify(''), '—', 'empty input unchanged');

// ── F2: detectSource matched the domain as a substring ───────────────────────
section('F2 — sender domain must be anchored, not substring-matched');
eq(detectSource('donotreply@managebuilding.com', ''), 'buildium', 'the real sender still matches');
eq(detectSource('Buildium <donotreply@managebuilding.com>', ''), 'buildium', 'display-name form still matches');
eq(detectSource('x@mail.managebuilding.com', ''), 'buildium', 'legitimate subdomain matches');
// The attack: a DMARC-valid domain the attacker owns, containing the real one.
eq(detectSource('notices@managebuilding.com.attacker.net', ''), 'unknown', 'lookalike suffix domain REJECTED');
eq(detectSource('a@evilmanagebuilding.com', ''), 'unknown', 'prefixed lookalike REJECTED');
eq(detectSource('"managebuilding.com" <a@evil.com>', ''), 'unknown', 'domain in display name REJECTED');
eq(detectSource('a@managebuilding.com.co', ''), 'unknown', 'different TLD REJECTED');
eq(detectSource('phoenixestatesmaryland@gmail.com', ''), 'manual', 'full-address source still matches');
eq(detectSource('someoneelse@gmail.com', ''), 'unknown', 'other gmail address does NOT inherit the manual source');
eq(detectSource('no-at-sign', ''), 'unknown', 'malformed sender rejected');

// ── F3: SSRF — allowlist must be on the parsed hostname ──────────────────────
section('F3 — ingest URL allowlist is host-based, not substring');
const wsrc = readFileSync(join(here, '..', 'worker.js'), 'utf8');
const im = wsrc.match(/function isAllowedIngestUrl\(raw\)\s*\{[\s\S]*?\n\}/);
eq(!!im, true, 'isAllowedIngestUrl found');
const hostsM = wsrc.match(/const INGEST_ALLOWED_HOSTS = (\[[^\]]*\]);/);
const isAllowed = new Function('INGEST_ALLOWED_HOSTS', 'raw', im[0].replace(/^function isAllowedIngestUrl\(raw\)\s*\{/, '').replace(/\}$/, ''))
  .bind(null, JSON.parse(hostsM[1].replace(/'/g, '"')));

eq(isAllowed('https://s3.amazonaws.com/b/photo.jpg'), true, 'real S3 host allowed');
eq(isAllowed('https://x.managebuilding.com/api/file/download?id=9'), true, 'real Buildium host allowed');
eq(isAllowed('https://s3.attacker.tld/download/x.jpg'), false, 'attacker host with "s3." REJECTED');
eq(isAllowed('https://evil.tld/?ref=amazonaws.com'), false, 'allowlisted string in the QUERY rejected');
eq(isAllowed('https://evil.tld/amazonaws.com/x.jpg'), false, 'allowlisted string in the PATH rejected');
eq(isAllowed('https://amazonaws.com.evil.tld/x.jpg'), false, 'lookalike suffix host rejected');
eq(isAllowed('http://s3.amazonaws.com/b/photo.jpg'), false, 'plain http rejected (https only)');
eq(isAllowed('http://169.254.169.254/latest/meta-data/'), false, 'cloud metadata address rejected');
eq(isAllowed('http://10.0.0.5/download/?ref=amazonaws.com'), false, 'RFC1918 address rejected');
eq(isAllowed('file:///etc/passwd'), false, 'file: scheme rejected');
eq(isAllowed('not a url'), false, 'unparseable input rejected');

// ── static guarantees in worker.js ───────────────────────────────────────────
section('F4 — download bounds');
eq(/lenHeader === null/.test(wsrc), true, 'a missing Content-Length is refused, not treated as 0');
eq(/INTAKE_MAX_FILES\s*=\s*10/.test(wsrc), true, 'per-email file count is capped');
eq(wsrc.includes("redirect: 'manual'"), true, "ingest does not follow redirects");
eq(wsrc.includes("redirect: 'follow'"), false, "no follow-redirect left in the ingest path");

section('Audit trail must never store private note content');
eq(/AUDIT_REDACTED_FIELDS/.test(wsrc), true, 'redaction list exists');
const redacted = (wsrc.match(/const AUDIT_REDACTED_FIELDS = \[([^\]]*)\]/) || [])[1] || '';
for (const f of ['Entry_Notes', 'Owner_Notes', 'Vendor_Admin_Notes', 'Admin_Notes', 'Notes'])
  eq(redacted.includes(`'${f}'`), true, `${f} is redacted from WO_Audit`);
eq(redacted.includes("'Hold_Reason'"), false, 'Hold_Reason is NOT redacted (customer-facing by design)');

section('auth surface');
eq(/const INTAKE_PATHS = \['\/intake'\]/.test(wsrc), true, 'intake auth uses an exact path list, not a prefix');
eq(/path\.startsWith\('\/intake'\)/.test(wsrc), false, "no startsWith('/intake') left in the auth gate");
eq(/path === '\/import-key-registry'[\s\S]{0,200}503/.test(wsrc), true, 'key-registry import blocked in staging');

section('F7 — tenant phone match is property-scoped');
eq(/const byPhone = scoped\.find/.test(wsrc), true, 'phone match runs against the scoped tenant list');
eq(/const byPhone = tenants\.find/.test(wsrc), false, 'no global phone match remains');

// ── optional admin tier ──────────────────────────────────────────────────────
section('ADMIN_TOKEN tier — inert when unset, enforced when set');
const modUrl = pathToFileURL(tmp).href;
const { default: worker } = await import(modUrl);
const req = (path, token) => new Request(`https://maintenance-hub.brett-2f8.workers.dev${path}`, { headers: token ? { 'X-Auth-Token': token } : {} });
// Stub so a passing gate doesn't try to reach Google.
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ access_token: 'x', values: [] }), headers: { get: () => null } });

const BASE = { WORKER_SECRET: 'portal-secret', GOOGLE_SA_EMAIL: 'a@b.com', GOOGLE_SA_KEY: 'x', SHEET_ID: 'S' };
// 1. ADMIN_TOKEN unset → behaviour identical to before (portal secret works).
let r = await worker.fetch(req('/workorders', 'portal-secret'), { ...BASE });
eq(r.status !== 403, true, 'ADMIN_TOKEN unset: portal secret still reaches /workorders (no behaviour change)');
// 2. ADMIN_TOKEN set → the portal secret is refused on admin-only bulk reads.
const WITH_ADMIN = { ...BASE, ADMIN_TOKEN: 'admin-secret' };
for (const p of ['/workorders', '/tenants', '/owners', '/keys', '/smslog']) {
  r = await worker.fetch(req(p, 'portal-secret'), WITH_ADMIN);
  eq(r.status, 403, `ADMIN_TOKEN set: portal secret REFUSED on ${p}`);
}
// 3. ...and the admin token works.
r = await worker.fetch(req('/workorders', 'admin-secret'), WITH_ADMIN);
eq(r.status !== 403 && r.status !== 401, true, 'admin token reaches /workorders');
// 4. Customer-portal endpoints keep working on the portal secret either way.
for (const p of ['/owner-workorders?owner_id=1', '/tenant-workorders?tenant_id=1', '/vendor-workorders?vendor_id=1', '/attachments?wo_id=1', '/wo-audit?wo_id=1']) {
  r = await worker.fetch(req(p, 'portal-secret'), WITH_ADMIN);
  eq(r.status !== 403, true, `portal endpoint still reachable with the portal secret: ${p.split('?')[0]}`);
}
// 5. A bogus token is still 401 regardless.
r = await worker.fetch(req('/workorders', 'nope'), WITH_ADMIN);
eq(r.status, 401, 'unknown token still 401');
r = await worker.fetch(req('/workorders', null), WITH_ADMIN);
eq(r.status, 401, 'no token still 401');

console.log(`\n${'='.repeat(52)}\n  ${pass} passed, ${fail} failed\n${'='.repeat(52)}`);
if (fail) process.exit(1);
