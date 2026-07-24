// Offline test for the BrettOS scoped session-token engine.
// Run: node test/session-auth.test.mjs
// These are the EXACT functions that will drop into worker.js (Web Crypto — runs
// identically in Node 18+ and the Cloudflare Worker runtime). No network, no sheets.

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64urlFromBytes(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlToBytes(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function hmac(data, secret) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return b64urlFromBytes(new Uint8Array(sig));
}
// role: 'vendor'|'tenant'|'owner' ; id: that person's record id ; ttl seconds (default 90d)
async function makeSessionToken(payloadObj, secret, ttlSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const payload = { ...payloadObj, iat: now, exp: now + (ttlSeconds || 60 * 60 * 24 * 90) };
  const body = b64urlFromBytes(enc.encode(JSON.stringify(payload)));
  const sig = await hmac(body, secret);
  return `${body}.${sig}`;
}
async function verifySessionToken(token, secret) {
  if (typeof token !== "string" || token.indexOf(".") < 0) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = await hmac(body, secret);
  if (sig.length !== expected.length) return null;
  let diff = 0;                                   // constant-time-ish compare
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return null;
  let payload;
  try { payload = JSON.parse(dec.decode(b64urlToBytes(body))); } catch (e) { return null; }
  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp < now) return null;
  return payload;
}

// ---------- tests ----------
const SECRET = "test-worker-secret-abc123";
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log("  ✓ " + msg); } else { fail++; console.log("  ✗ FAIL: " + msg); } }

console.log("session-auth token engine — offline tests\n");

const tok = await makeSessionToken({ role: "vendor", id: "V-001" }, SECRET, 3600);
const p = await verifySessionToken(tok, SECRET);
ok(p && p.role === "vendor" && p.id === "V-001", "a signed token verifies and returns role + id");
ok(typeof p.exp === "number" && p.exp > Math.floor(Date.now() / 1000), "token carries a future expiry");

ok((await verifySessionToken(tok, "the-wrong-secret")) === null, "token signed with a different secret is REJECTED");

const tampered = tok.slice(0, -1) + (tok.slice(-1) === "A" ? "B" : "A");
ok((await verifySessionToken(tampered, SECRET)) === null, "tampered signature is REJECTED");

const [b, s] = tok.split(".");
const forgedBody = b.slice(0, -2) + "AA" + "." + s;               // change the payload, keep old sig
ok((await verifySessionToken(forgedBody, SECRET)) === null, "tampered payload (old sig) is REJECTED");

const expired = await makeSessionToken({ role: "vendor", id: "V-9" }, SECRET, -10);
ok((await verifySessionToken(expired, SECRET)) === null, "an expired token is REJECTED");

ok((await verifySessionToken("not-a-token", SECRET)) === null, "garbage string is REJECTED");
ok((await verifySessionToken("", SECRET)) === null, "empty string is REJECTED");
ok((await verifySessionToken(null, SECRET)) === null, "null is REJECTED");

// a vendor token must NOT be usable to forge an admin role by editing the JSON —
// because any change to the body invalidates the signature (proven above). Confirm the
// payload is opaque-but-signed, not encrypted (we only need integrity, not secrecy):
const decoded = JSON.parse(dec.decode(b64urlToBytes(tok.split(".")[0])));
ok(decoded.role === "vendor", "payload is readable (integrity-protected, not secret) — fine for a scope claim");

// ---------- scope tests (the blast-radius proof) ----------
// These MIRROR worker.js: ROLE_SCOPES + isPathAllowedForRole + the gate decision.
const ROLE_SCOPES = {
  vendor: ['/vendor-by-pin','/vendor-workorders','/vendor-bills','/vendor-bill/add','/attachments','/estimate','/estimates','/receipt/add','/receipt/delete','/receipts','/status','/time-entries','/time-entry/add','/time-entry/delete','/upload-photo'],
  tenant: ['/tenant-by-pin','/tenant-workorders','/attachments','/wo/add-note'],
  owner:  ['/owner-by-pin','/owner-workorders','/owner-properties','/owner-notifications','/owner/notifications','/attachments','/wo-audit','/wo/add-note','/wo/append-description','/wo/owner-update','/wo/set-tenant-visibility','/workorder'],
};
function isPathAllowedForRole(path, role){ const s = ROLE_SCOPES[role]; return !!(s && s.includes(path)); }
const ADMIN = SECRET;
// mirrors the worker gate for a non-public path
async function gateAllows(headerToken, path){
  if (headerToken === ADMIN) return true;               // admin secret = full access
  const s = await verifySessionToken(headerToken, ADMIN);
  return !!(s && isPathAllowedForRole(path, s.role));
}
const vTok = await makeSessionToken({ role:"vendor", id:"V-1" }, SECRET, 3600);
const oTok = await makeSessionToken({ role:"owner",  id:"O-1" }, SECRET, 3600);

console.log("\nscope / blast-radius:");
ok(await gateAllows(vTok, "/vendor-workorders"), "vendor token → CAN reach /vendor-workorders");
ok(await gateAllows(vTok, "/status"),            "vendor token → CAN reach /status");
ok(!(await gateAllows(vTok, "/config")),         "vendor token → BLOCKED from /config (admin)");
ok(!(await gateAllows(vTok, "/properties")),     "vendor token → BLOCKED from /properties (all data)");
ok(!(await gateAllows(vTok, "/qb/send-invoice")),"vendor token → BLOCKED from /qb/send-invoice (money)");
ok(!(await gateAllows(vTok, "/owner-workorders")),"vendor token → BLOCKED from another role's endpoint");
ok(await gateAllows(oTok, "/owner-properties"),  "owner token → CAN reach /owner-properties");
ok(!(await gateAllows(oTok, "/vendor-bills")),   "owner token → BLOCKED from vendor endpoints");
ok(await gateAllows(ADMIN, "/config"),           "admin secret → CAN reach /config (full access preserved)");
ok(!(await gateAllows("SOME-OLD-LEAKED-SECRET-PLACEHOLDER", "/config")), "a LEAKED old secret string → BLOCKED once rotated (not the admin secret here)");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
