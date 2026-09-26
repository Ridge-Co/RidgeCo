// Owner self-serve onboarding — pure-function coverage (validation, PIN rule, invite state, market
// inference) plus structural checks that the routes are wired and the public/admin split is right.
// Pure helpers are source-sliced from worker.js like test/vendor-onboarding.test.mjs does.
import fs from 'fs';
const src = fs.readFileSync('worker.js', 'utf8');
function grab(name, kind = 'function') {
  const needle = kind === 'const' ? ('const ' + name + ' =') : ('function ' + name + '(');
  const i = src.indexOf(needle);
  if (i < 0) throw new Error('missing ' + name);
  if (kind === 'const') { const e = src.indexOf(';\n', i); return src.slice(i, e + 1); }
  let d = 0, j = src.indexOf('{', i);
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i, j + 1);
}
const H = new Function(
  ['OWNER_ONBOARD_TYPES','OWNER_ONBOARD_SUBTYPES','OWNER_ONBOARD_MAX_PROPERTIES','OWNER_ONBOARD_MAX_UNITS','OWNER_ONBOARD_STATES'].map(n => grab(n, 'const')).join('\n') + '\n' +
  ['ooClean','ooDigits','ooPhoneOk','ooEmailOk','ownerOnboardPinCheck','ownerOnboardInferMarket','ownerOnboardValidate','ooInviteState','ooInviteProblem'].map(n => grab(n)).join('\n') +
  '\nreturn { ooClean, ooPhoneOk, ooEmailOk, ownerOnboardPinCheck, ownerOnboardInferMarket, ownerOnboardValidate, ooInviteState, ooInviteProblem };'
)();

let pass = 0, fail = 0;
const t = (n, c, got) => { if (c) pass++; else { fail++; console.log('FAIL:', n, got !== undefined ? 'got ' + JSON.stringify(got) : ''); } };

const owner = () => ({ first: 'Pat', last: 'Lee', business_choice: 'name', business_name: '', phone: '(410) 555-0142', billing_email: 'Pat@Example.com',
  billing_address: { street: '12 Main St', city: 'Baltimore', state: 'md', zip: '21201' }, pin: 'pat48213' });
const tenantUnit = (label = '') => ({ label, status: 'tenant', tenant: { first: 'Sam', last: 'Doe', phone: '410-555-0199', email: '' } });
const house = (units) => ({ address: '5 Oak Ave', city: 'Baltimore', type: 'house', units: units || [tenantUnit()] });
const good = () => ({ owner: owner(), properties: [house()], sms_consent: true });
const errFields = (r) => r.errors.map(e => e.field);

// ── PIN rule ──
t('PIN: 3 letters + 5 digits accepted, uppercased', H.ownerOnboardPinCheck('abc48213').ok && H.ownerOnboardPinCheck('abc48213').pin === 'ABC48213');
['ab12345','ABCD1234','12345678','ABC1234','ABC123456','AB-12345',''].forEach(p => t('PIN rejected: ' + p, !H.ownerOnboardPinCheck(p).ok));
['ABC11111','ABC00000','ABC12345','ABC54321','AAA48213'].forEach(p => t('PIN rejected as guessable: ' + p, !H.ownerOnboardPinCheck(p).ok));
t('PIN with a normal mixed digit run is fine', H.ownerOnboardPinCheck('XKQ90417').ok);

// ── happy paths ──
let r = H.ownerOnboardValidate(good());
t('valid single-family, occupied submission passes', r.ok, r.errors);
t('owner cleaned: phone 10 digits, email lowercased, state uppercased, PIN uppercased',
  r.clean.owner.phone === '4105550142' && r.clean.owner.billing_email === 'pat@example.com' && r.clean.owner.billing_address.state === 'MD' && r.clean.owner.pin === 'PAT48213');
t('house unit count is forced to 1', r.clean.properties[0].unit_count === 1);
t('sms_consent only true when exactly true', H.ownerOnboardValidate({ ...good(), sms_consent: 'yes' }).clean.sms_consent === false);

// ── owner section ──
let o = good(); o.owner.business_choice = '';
t('business/name selection is required', errFields(H.ownerOnboardValidate(o)).includes('owner.business_choice'));
o = good(); o.owner.business_choice = 'business'; o.owner.business_name = '';
t('business name required when business chosen', errFields(H.ownerOnboardValidate(o)).includes('owner.business_name'));
o = good(); o.owner.business_choice = 'business'; o.owner.business_name = 'Lee Holdings LLC';
r = H.ownerOnboardValidate(o); t('business name accepted and kept', r.ok && r.clean.owner.business_name === 'Lee Holdings LLC');
o = good(); o.owner.business_name = 'Ignored Co';
t('business name dropped when "use my name" chosen', H.ownerOnboardValidate(o).clean.owner.business_name === '');
['first','last'].forEach(f => { o = good(); o.owner[f] = ' '; t('owner ' + f + ' required', errFields(H.ownerOnboardValidate(o)).includes('owner.' + f)); });
['123', '555-0142', '0105550142', '1114445555'].forEach(ph => { o = good(); o.owner.phone = ph; t('bad phone rejected: ' + ph, errFields(H.ownerOnboardValidate(o)).includes('owner.phone')); });
o = good(); o.owner.phone = '1 (443) 555-0100'; t('11-digit phone with leading 1 accepted', H.ownerOnboardValidate(o).ok);
o = good(); o.owner.billing_email = 'nope'; t('bad billing email rejected', errFields(H.ownerOnboardValidate(o)).includes('owner.billing_email'));
o = good(); o.owner.billing_address = { street: '', city: '', state: 'ZZ', zip: '2120' };
t('billing address: every part validated', ['street','city','state','zip'].every(k => errFields(H.ownerOnboardValidate(o)).includes('owner.billing_address.' + k)));
o = good(); o.owner.billing_address.zip = '21201-1234'; t('ZIP+4 accepted', H.ownerOnboardValidate(o).ok);
o = good(); o.owner.pin = 'abc12345'; t('sequential PIN rejected at validation', errFields(H.ownerOnboardValidate(o)).includes('owner.pin'));

// ── property type / unit count rules ──
let g = good(); g.properties = [];
t('at least one property required', errFields(H.ownerOnboardValidate(g)).includes('properties'));
g = good(); g.properties[0].type = 'warehouse'; t('unknown type rejected', errFields(H.ownerOnboardValidate(g)).includes('properties[0].type'));
g = good(); g.properties[0].type = 'rowhome'; g.properties[0].unit_count = 9; r = H.ownerOnboardValidate(g);
t('rowhome ignores a supplied unit count and stores 1', r.ok && r.clean.properties[0].unit_count === 1, r.errors);

const multi = (n, units) => ({ address: '9 Elm St', city: 'Winchester', type: 'multi', unit_count: n, units });
g = good(); g.properties = [multi('', [tenantUnit('Apt 1')])];
t('multi: unit count is required', errFields(H.ownerOnboardValidate(g)).includes('properties[0].unit_count'));
g = good(); g.properties = [multi(1, [tenantUnit('Apt 1')])];
t('multi: unit count of 1 rejected (needs 2+)', errFields(H.ownerOnboardValidate(g)).includes('properties[0].unit_count'));
g = good(); g.properties = [multi(4, [tenantUnit('Apt 2')])];
r = H.ownerOnboardValidate(g);
t('multi: owner may list ONE of four units', r.ok && r.clean.properties[0].unit_count === 4 && r.clean.properties[0].units.length === 1, r.errors);
g = good(); g.properties = [{ address: '2 Cedar Ct', city: 'Baltimore', type: 'condo', unit_count: '', units: [tenantUnit('2B')] }];
t('condo: unit count is required', errFields(H.ownerOnboardValidate(g)).includes('properties[0].unit_count'));
g = good(); g.properties = [{ address: '2 Cedar Ct', city: 'Baltimore', type: 'condo', unit_count: 1, units: [tenantUnit('2B')] }];
t('condo: unit count of 1 is fine', H.ownerOnboardValidate(g).ok);
g = good(); g.properties = [multi(2, [tenantUnit('A'), tenantUnit('B'), tenantUnit('C')])];
t('cannot list more units than the unit count', errFields(H.ownerOnboardValidate(g)).includes('properties[0].units'));
g = good(); g.properties = [multi(3, [tenantUnit('Apt 1'), tenantUnit('apt 1')])];
t('duplicate unit labels rejected', errFields(H.ownerOnboardValidate(g)).includes('properties[0].units[1].label'));
g = good(); g.properties = [multi(3, [tenantUnit('')])];
t('multi units need a label', errFields(H.ownerOnboardValidate(g)).includes('properties[0].units[0].label'));

// ── commercial ──
const com = (sub) => ({ address: '100 Market St', city: 'Baltimore', type: 'commercial', subtype: sub, unit_count: 2, units: [tenantUnit('Suite 100')] });
['retail','mixed_use','industrial','office'].forEach(s => { g = good(); g.properties = [com(s)]; r = H.ownerOnboardValidate(g); t('commercial subtype ok: ' + s, r.ok && r.clean.properties[0].subtype === s, r.errors); });
g = good(); g.properties = [com('')]; t('commercial requires a subtype', errFields(H.ownerOnboardValidate(g)).includes('properties[0].subtype'));
g = good(); g.properties = [com('warehouse')]; t('commercial rejects unknown subtype', errFields(H.ownerOnboardValidate(g)).includes('properties[0].subtype'));
g = good(); g.properties = [{ ...house(), subtype: 'retail' }]; t('non-commercial drops any subtype', H.ownerOnboardValidate(g).clean.properties[0].subtype === '');

// ── unit status rules ──
const mk = (u) => { const g = good(); g.properties = [house([u])]; return H.ownerOnboardValidate(g); };
t('unit status is required', errFields(mk({ label: '' })).includes('properties[0].units[0].status'));
t('tenant: first name + phone required', ['tenant.first','tenant.phone'].every(f => errFields(mk({ status: 'tenant', tenant: {} })).includes('properties[0].units[0].' + f)));
t('tenant: email optional but validated if present', errFields(mk({ status: 'tenant', tenant: { first: 'A', phone: '4105550111', email: 'bad' } })).includes('properties[0].units[0].tenant.email'));
t('vacant: must choose lockbox or none', errFields(mk({ status: 'vacant', access: {} })).includes('properties[0].units[0].access.method'));
t('vacant + lockbox: code required', errFields(mk({ status: 'vacant', access: { method: 'lockbox', code: '' } })).includes('properties[0].units[0].access.code'));
r = mk({ status: 'vacant', access: { method: 'lockbox', code: '4421', location: 'left of door' } });
t('vacant + lockbox with code is valid', r.ok, r.errors);
t('vacant + no lockbox: an access note is required', errFields(mk({ status: 'vacant', access: { method: 'none', note: '' } })).includes('properties[0].units[0].access.note'));
t('vacant + no lockbox: a too-short note is rejected', errFields(mk({ status: 'vacant', access: { method: 'none', note: 'hi' } })).includes('properties[0].units[0].access.note'));
r = mk({ status: 'vacant', access: { method: 'none', note: 'Key is with the listing agent, call 410-555-0100' } });
t('vacant + no lockbox with a real note is valid', r.ok, r.errors);
t('"provide later" alone does NOT satisfy the one-resolved-unit rule', errFields(mk({ status: 'later' })).includes('properties'));
g = good(); g.properties = [house([{ status: 'later' }]), { ...house([tenantUnit()]), address: '7 Pine Rd' }];
t('"provide later" is fine when another unit is resolved', H.ownerOnboardValidate(g).ok, H.ownerOnboardValidate(g).errors);
g = good(); g.properties = [multi(4, [{ label: 'Apt 1', status: 'later' }, { label: 'Apt 2', status: 'vacant', access: { method: 'lockbox', code: '1234' } }])];
t('multi: one later unit + one vacant unit is valid', H.ownerOnboardValidate(g).ok, H.ownerOnboardValidate(g).errors);

// ── hardening ──
g = good(); g.properties = Array.from({ length: 26 }, () => house());
t('too many properties rejected', errFields(H.ownerOnboardValidate(g)).includes('properties'));
r = H.ownerOnboardValidate({ owner: null, properties: 'x' }); t('garbage input does not throw and fails cleanly', r.ok === false && r.errors.length > 0);
r = H.ownerOnboardValidate(undefined); t('undefined input fails cleanly', r.ok === false);
g = good(); g.owner.first = 'Pat\u0000\n\tX'.repeat(50); t('control chars stripped and length capped', H.ownerOnboardValidate(g).clean.owner.first.length <= 60 && !/[\u0000-\u001f]/.test(H.ownerOnboardValidate(g).clean.owner.first));

// ── market + invite state ──
t('market inference', H.ownerOnboardInferMarket('Baltimore') === 'Baltimore' && H.ownerOnboardInferMarket('Waynesboro') === 'Waynesboro' && H.ownerOnboardInferMarket('winchester, va') === 'Winchester' && H.ownerOnboardInferMarket('Springfield') === 'Other');
const now = Date.parse('2026-09-26T12:00:00Z');
t('invite: pending', H.ooInviteState({ Status: 'pending', Expires_Date: '2026-10-01T00:00:00Z' }, now) === 'pending');
t('invite: expired', H.ooInviteState({ Status: 'pending', Expires_Date: '2026-09-01T00:00:00Z' }, now) === 'expired');
t('invite: used stays used even if not expired', H.ooInviteState({ Status: 'used', Expires_Date: '2026-10-01T00:00:00Z' }, now) === 'used');
t('invite: processing counts as not reusable', H.ooInviteProblem(H.ooInviteState({ Status: 'processing' }, now)).includes('already been used'));
t('invite: Active=FALSE is revoked', H.ooInviteState({ Status: 'pending', Active: 'FALSE' }, now) === 'revoked');
t('invite: unknown token is invalid', H.ooInviteState(null, now) === 'invalid');

// ── structural wiring (source) ──
const publicList = src.slice(src.indexOf('const PUBLIC_PATHS = ['), src.indexOf("if (!PUBLIC_PATHS.includes(path))"));
['/owner-onboard/info','/owner-onboard/check-pin','/owner-onboard/submit'].forEach(p => t('public path: ' + p, publicList.includes("'" + p + "'")));
['/owner-onboard/invite/create','/owner-onboard/invite/revoke','/owner-onboard/invites'].forEach(p => t('admin path NOT public: ' + p, !publicList.includes("'" + p + "'")));
t('prod read-only token cannot read live invite links', src.includes("'/owner-onboard/invites', //"));
t('new public POST routes come after _clientIP is defined', src.indexOf("path === '/owner-onboard/submit'") > src.indexOf('const _clientIP ='));
t('new properties are created with SMS off', /SMS_Enabled: 'FALSE', Onboarding_Source: 'self_serve_link'/.test(src));
t('submit claims the invite before writing', src.indexOf("Status: 'processing', Claim_Nonce") < src.indexOf('await addOwnerWithQBSync(env, {\n      First_Name: c.owner.first'));
t('submit checks PIN + phone uniqueness before claiming', src.indexOf('ooPinTaken(env, c.owner.pin)') < src.indexOf("Status: 'processing', Claim_Nonce"));
t('never overwrites an owned property (owned-by-other is skipped)', src.includes("'skipped_owned_by_other'"));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
