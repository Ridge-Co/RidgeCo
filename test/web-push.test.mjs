// Web push capability (Nov 5 2026): Android / iPhone / Chromebook / Windows-desktop devices that each person can switch on or off.
// Runs the REAL worker functions: encrypts a message and decrypts it with an independent receiver (node:crypto), checks the VAPID signature,
// the push-service allowlist, the role scopes, the routes, and that every portal page loads the panel.
import fs from 'fs';
import assert from 'node:assert';
import nodeCrypto from 'node:crypto';
const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const worker = read('worker.js');
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const grab = (re) => { const m = worker.match(re); assert.ok(m, 'could not find ' + re); return m[0]; };

const src = [
  /const PUSH_KEYS_TAB = [^\n]*\n/, /const PUSH_PLATFORMS = [^\n]*\n/, /const PUSH_HOST_SUFFIXES = [^\n]*\n/, /const PUSH_VAPID_SUBJECT = [^\n]*\n/, /let _pushTabsReady = [^\n]*\n/,
  /function pushB64uEnc\([^\n]*\n/, /function pushB64uDec\([^\n]*\n/, /function pushConcat\([^\n]*\n/, /function pushNormPlatform\([^\n]*\n/,
  /function pushEndpointOk\([\s\S]*?\n\}\n/, /async function pushEncrypt\([\s\S]*?\n\}\n/, /async function pushVapidKeys\([\s\S]*?\n\}\n/, /async function pushVapidAuth\([\s\S]*?\n\}\n/
].map(grab).join('');
const api = new Function(src + '; return { pushEndpointOk, pushEncrypt, pushVapidAuth, pushB64uEnc, pushB64uDec, pushNormPlatform };')();
const { pushEndpointOk, pushEncrypt, pushVapidAuth, pushB64uEnc, pushB64uDec, pushNormPlatform } = api;

// --- which addresses a device may register (stops the worker being used to call arbitrary sites) ---
ok(pushEndpointOk('https://fcm.googleapis.com/fcm/send/abc'), 'Chrome / Android / Chromebook / Edge');
ok(pushEndpointOk('https://web.push.apple.com/QGx'), 'iPhone / Safari');
ok(pushEndpointOk('https://updates.push.services.mozilla.com/wpush/v2/x'), 'Firefox');
ok(pushEndpointOk('https://wns2-by3p.notify.windows.com/w/?token=x'), 'Windows');
ok(!pushEndpointOk('http://fcm.googleapis.com/x'), 'plain http refused');
ok(!pushEndpointOk('https://evil.example.com/x'), 'unknown host refused');
ok(!pushEndpointOk('https://googleapis.com.evil.com/x'), 'look-alike host refused');
ok(!pushEndpointOk('https://user:pw@fcm.googleapis.com/x'), 'credentials in the address refused');
ok(!pushEndpointOk('https://fcm.googleapis.com:8443/x'), 'odd port refused');
ok(!pushEndpointOk('') && !pushEndpointOk(null) && !pushEndpointOk('not a url'), 'garbage refused');
ok(pushNormPlatform('IPHONE') === 'iphone' && pushNormPlatform('toaster') === 'desktop', 'platform names are normalised');

// --- encryption: worker encrypts, an independent receiver decrypts ---
const hk = (ikm, salt, info, len) => Buffer.from(nodeCrypto.hkdfSync('sha256', ikm, salt, info, len));
const b64u = (b) => Buffer.from(b).toString('base64url');
async function roundtrip(text) {
  const rx = nodeCrypto.createECDH('prime256v1'); rx.generateKeys();
  const uaPub = rx.getPublicKey(), auth = nodeCrypto.randomBytes(16);
  const body = Buffer.from(await pushEncrypt(new TextEncoder().encode(text), b64u(uaPub), b64u(auth)));
  const salt = body.subarray(0, 16), rs = body.readUInt32BE(16), idLen = body[20], asPub = body.subarray(21, 21 + idLen), ct = body.subarray(21 + idLen);
  assert.strictEqual(rs, 4096); assert.strictEqual(idLen, 65);
  const shared = rx.computeSecret(asPub);
  const ikm = hk(shared, auth, Buffer.concat([Buffer.from('WebPush: info\0'), uaPub, asPub]), 32);
  const cek = hk(ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16), nonce = hk(ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12);
  const d = nodeCrypto.createDecipheriv('aes-128-gcm', cek, nonce); d.setAuthTag(ct.subarray(ct.length - 16));
  const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  assert.strictEqual(plain[plain.length - 1], 2, 'last-record delimiter');
  return plain.subarray(0, plain.length - 1).toString('utf8');
}
const msg = JSON.stringify({ title: 'Ridge Co', body: 'Work order 1767 was scheduled — café ✅', url: 'tenant.html', tag: 't' });
ok(await roundtrip(msg) === msg, 'an independent receiver decrypts exactly what the worker encrypted (with non-ASCII text)');
ok(await roundtrip('x'.repeat(2000)) === 'x'.repeat(2000), 'a long message survives');
let bad = false; try { await pushEncrypt(new Uint8Array([1]), b64u(Buffer.alloc(10)), b64u(Buffer.alloc(16))); } catch (e) { bad = true; }
ok(bad, 'malformed device keys are rejected');

// --- VAPID: the signature verifies against the public key we hand out ---
const kp = nodeCrypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pubJwk = kp.publicKey.export({ format: 'jwk' });
const rawPub = Buffer.concat([Buffer.from([4]), Buffer.from(pubJwk.x, 'base64url'), Buffer.from(pubJwk.y, 'base64url')]);
const env = { VAPID_PRIVATE_JWK: JSON.stringify(kp.privateKey.export({ format: 'jwk' })), VAPID_PUBLIC_KEY: b64u(rawPub) };
const auth = await pushVapidAuth(env, 'https://fcm.googleapis.com/fcm/send/abc');
const m = auth.match(/^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/);
ok(m, 'Authorization header has the vapid t=..., k=... shape');
ok(m[4] === env.VAPID_PUBLIC_KEY, 'k is the public key');
ok(nodeCrypto.verify('sha256', Buffer.from(m[1] + '.' + m[2]), { key: kp.publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(m[3], 'base64url')), 'ES256 signature verifies');
const claims = JSON.parse(Buffer.from(m[2], 'base64url').toString());
ok(claims.aud === 'https://fcm.googleapis.com' && claims.exp > Date.now() / 1000 && claims.exp <= Date.now() / 1000 + 86400 && /^mailto:/.test(claims.sub), 'claims: audience is the push service origin, expires within 24h, contact is a mailto');

// --- routes and role scopes ---
ok(/path === '\/push\/vapid-key' \|\| path === '\/push\/devices'/.test(worker), 'GET routes registered');
ok(/'\/push\/subscribe'/.test(worker) && /'\/push\/test'/.test(worker) && /'\/push\/remove'/.test(worker) && /'\/push\/device'/.test(worker), 'POST routes registered');
const rs = worker.indexOf('ROLE_SCOPES'); ok(rs >= 0, 'ROLE_SCOPES exists');
const scopesEnd = worker.indexOf('\n};', rs); const scopes = worker.slice(rs, scopesEnd);
for (const p of ['/push/vapid-key', '/push/devices', '/push/subscribe', '/push/device', '/push/remove', '/push/test']) ok(scopes.split("'" + p + "'").length - 1 >= 3, p + ' allowed for vendor, tenant and owner sessions');
ok(!scopes.includes('/push/send'), 'sending to someone else is admin-only: no portal role can call /push/send');
ok(/if \(callerRole\) return json\(\{ error: 'Unauthorized' \}, 401\)/.test(worker), '/push/send refuses any signed-in portal role');
ok(/const type = callerRole \|\| 'admin', id = callerRole \? String\(callerSessionId\) : 'brett'/.test(worker), 'a person only ever sees and changes their own devices (identity from the session, not the request)');
ok(/if \(env\.__STAGING__ \?\? isStaging\(env\)\) return \{ ok: true, status: 0, staged: true/.test(worker), 'staging never reaches a real device');

// --- browser side ---
const sw = read('sw.js'), client = read('push-client.js');
ok(/addEventListener\('push'/.test(sw) && /showNotification\(/.test(sw), 'service worker shows every push it receives');
ok(/addEventListener\('notificationclick'/.test(sw) && /u\.origin === self\.location\.origin/.test(sw), 'tapping a notification opens only this site');
ok(!/addEventListener\('fetch'/.test(sw) && !/caches\./.test(sw), 'service worker caches nothing and never answers page loads');
ok(['android', 'iphone', 'chromebook', 'desktop'].every(p => client.includes("'" + p + "'") || client.includes(p + ':')), 'client knows all four device types');
ok(/CrOS/.test(client) && /Android/.test(client) && /iPhone\|iPad\|iPod/.test(client), 'client detects Chromebook, Android and iPhone');
ok(/window\.AUTH_TOKEN \|\| window\.SECRET/.test(client), 'client uses the admin token or the portal session token');
ok(/Add to Home Screen/.test(client), 'iPhone is told to add the page to the Home Screen first');
ok(/type="checkbox"|type: 'checkbox'/.test(client) && /\/push\/device/.test(client), 'each device has an on/off switch');
for (const f of ['manifest-admin', 'manifest-tenant', 'manifest-owner', 'manifest-vendor']) { const j = JSON.parse(read(f + '.webmanifest')); ok(j.display === 'standalone' && j.start_url && j.icons.length, f + ' is a valid installable manifest'); }
ok(/<svg[^>]*viewBox/.test(read('icon.svg')), 'icon exists');
for (const [page, man] of [['index.html', 'admin'], ['tenant.html', 'tenant'], ['owner.html', 'owner'], ['vendor.html', 'vendor']]) {
  const h = read(page);
  ok(h.includes('<link rel="manifest" href="manifest-' + man + '.webmanifest"><script src="push-client.js" defer></script></head>'), page + ' loads the notifications panel');
}

console.log(`web-push: ${n} assertions passed`);
