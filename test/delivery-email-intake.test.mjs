// Delivery EMAIL watcher, Hub side (Phase 1, Oct 23 2026). POST /intake/delivery-email.
// Written BEFORE the code (acceptance checks A-L, N-O of the spec). Two halves:
//   PART 1  the pure parser / status / calendar / timing functions, extracted straight out of worker.js and fed realistic
//           synthetic Home Depot / Lowe's fixtures (no real delivery email existed yet: tighten the DEP table and add the first real
//           one as a fixture when it arrives).
//   PART 2  the REAL worker.js default export (router, token gate, Deliveries / Work_Orders / Message_Queue writes, Brett's text, the
//           tenant notice) driven over a fake Google Sheets and a fake Twilio, so it proves what Brett's inbox would actually do.
// Time is pinned to Wed Oct 14 2026 11:00 ET (see _midday-clock.mjs): "today" is 2026-10-14.
// Run: node test/delivery-email-intake.test.mjs
import './_midday-clock.mjs';
import fs from 'fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const src = fs.readFileSync(root + 'worker.js', 'utf8');
let pass = 0, fail = 0;
const t = (n, c, extra) => { if (c) pass++; else { fail++; console.log('FAIL:', n, extra === undefined ? '' : JSON.stringify(extra).slice(0, 600)); } };
const eq = (n, a, b) => { if (JSON.stringify(a) === JSON.stringify(b)) pass++; else { fail++; console.log('FAIL:', n, '\n   got ', JSON.stringify(a), '\n   want', JSON.stringify(b)); } };
function grabFn(sig) {
  const i = src.indexOf(sig); if (i < 0) throw new Error('missing ' + sig);
  let d = 0, j = src.indexOf('{', src.indexOf(')', i));
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i, j + 1);
}

// ════════════════════════════════ PART 1: pure functions ════════════════════════════════
const pa = src.indexOf('// ═══ DELIVERY-EMAIL-PURE-START'), pb = src.indexOf('// ═══ DELIVERY-EMAIL-PURE-END');
t('pure block markers exist', pa > 0 && pb > pa);
const P = new Function(grabFn('function nyOffsetMinutes(') + '\n' + grabFn('function etHour(') + '\n' + src.slice(pa, pb) +
  '\nreturn { DEP, deliverySenderDomain, deliveryParseEmail, deliveryNextStatus, deliveryNoticeHoldUntil, deliveryCalendarObject, deliveryPlainSms, deliveryBrettText, deliveryParseWindow, deliveryParseDate, deliveryParseOrderNumber, deliveryEmailText, deliveryParseAddress, deliveryEtWallToUtc };')();

// ── B. sender check ──
{
  const ok = f => P.deliverySenderDomain(f);
  t('homedepot.com passes', ok('orders@homedepot.com') === 'homedepot.com');
  t('order.homedepot.com passes', ok('"The Home Depot" <HomeDepotOrder@order.homedepot.com>') === 'homedepot.com');
  t('mg.homedepot.com passes', ok('Home Depot <noreply@mg.homedepot.com>') === 'homedepot.com');
  t('lowes.com passes', ok('Lowes <orders@lowes.com>') === 'lowes.com');
  t('display name containing homedepot.com with an evil real address FAILS', ok('"orders@homedepot.com" <x@evil.io>') === '' && ok('Home Depot homedepot.com <x@evil.io>') === '');
  t('lookalike domains fail', ok('x@homedepot.com.evil.io') === '' && ok('x@evilhomedepot.com') === '' && ok('x@nothomedepot.com') === '');
  t('unknown domain fails', ok('promo@randomshop.com') === '');
  t('garbage / empty sender fails', ok('') === '' && ok('not an address') === '' && ok(null) === '');
  t('custom allow-list (Config Delivery_Sender_Domains) is honoured', P.deliverySenderDomain('a@appliancesdirect.com', 'appliancesdirect.com, homedepot.com') === 'appliancesdirect.com' && P.deliverySenderDomain('a@lowes.com', 'appliancesdirect.com') === '');
}

// ── C. parser fixtures (synthetic, realistic) ──
const RECV = '2026-10-14T14:00:00Z';   // 10:00 ET Wed Oct 14 2026
const ADDR_BELLE = 'Delivery Address:\nBrett Lambert\n5425 Belle Vista Ave\nBaltimore, MD 21206\n';
const ADDR_CALVERT = 'Delivery Address:\nBrett Lambert\n928 N Calvert St Apt 2\nBaltimore, MD 21202\n';
const FX = {
  confirm: { subject: 'Your Home Depot Order Confirmation - H2345-678901', body: 'Thank you for your order!\nOrder Number: H2345-678901\nOrder Date: October 13, 2026\n\n' + ADDR_BELLE + '\nItem\nWhirlpool 25 cu. ft. Side by Side Refrigerator in Fingerprint Resistant Stainless Steel\nModel # WRS325SDHZ\nQty: 1\nEstimated Delivery: Fri, Oct 16\n\nYou may also like\nGE 30 in. Gas Range GGF300ABC\n\nUnsubscribe | Privacy' },
  scheduled: { subject: 'Your delivery has been scheduled - Order H2345-678901', body: 'Hello Brett,\nYour delivery is scheduled for Friday, October 16, 2026.\nOrder Number: H2345-678901\n\n' + ADDR_BELLE + '\nWhirlpool Side by Side Refrigerator\nNeed to reschedule? Call 1-800-555-0100.' },
  window: { subject: 'Your delivery window for order H2345-678901', body: 'Your delivery window is between 9:00 AM and 1:00 PM on Fri, Oct 16.\nOrder Number: H2345-678901\n' + ADDR_BELLE },
  window2: { subject: 'Delivery time window - H2345-678901', body: 'Order # H2345-678901\nWe will arrive between 11 AM - 3 PM on Friday, October 16.' },
  enroute: { subject: 'Your Home Depot delivery is on its way', body: 'Great news, your driver is on the way!\nOrder H2345-678901 will arrive today between 9am-1pm.\nTrack your delivery: https://example.com/t/abc' },
  approaching: { subject: 'Your driver is 3 stops away', body: 'Your Home Depot delivery for order H2345-678901 is 3 stops away.' },
  approaching1: { subject: 'Your driver is 1 stop away', body: 'Order H2345-678901 is 1 stop away.' },
  delivered: { subject: 'Your order was delivered', body: 'Your Home Depot order H2345-678901 has been delivered. How was your experience?' },
  reschedule: { subject: 'Your delivery has been rescheduled', body: 'We have rescheduled your delivery for order H2345-678901.\nNew delivery date: Mon, Oct 19\nYou can expect us to arrive between 11 AM - 3 PM.\n' + ADDR_BELLE },
  cancel: { subject: 'Your order H2345-678901 has been cancelled', body: 'We have cancelled your order H2345-678901. A refund is on the way.' },
  w: { subject: 'Order confirmation', body: 'Thank you for your order.\nOrder W123456789\nFrigidaire 30 in. Electric Range FFEH3054USS\nDeliver to: 928 N Calvert St Apt 3R, Baltimore, MD 21202\nDelivery date: Oct 22' },
  cm: { subject: 'We received your order CM12345678', body: 'Samsung 27 cu. ft. Refrigerator RF27T5201SR. Ship to 5425 Belle Vista Ave, Baltimore, MD 21206.' },
  lowes: { subject: "Thanks for your Lowe's order", body: "Order #123456789\nThank you for your order!\nMaytag Top Load Washer MVW6230HW\nDelivery Address: 10 Dup Ave, Baltimore, MD 21201\nScheduled delivery: 10/22/2026 between 8am-12pm" },
  promo: { subject: 'Save 30% on appliances this weekend only!', body: 'Shop now. Black Friday deals on refrigerators and washers. Free delivery on orders over $396. Unsubscribe from these emails.' },
  promoWithOrderWord: { subject: 'Order now: our biggest sale of the year', body: 'Appliance blowout. 20% off ranges. Delivery included. To unsubscribe click here.' },
  unknown: { subject: 'Important information about your Home Depot order H3456-789012', body: 'Please contact us regarding your order and your delivery options. Thank you for shopping with us.' },
};
const parse = (k, over) => P.deliveryParseEmail(Object.assign({ received_at: RECV }, FX[k], over || {}));
{
  let r = parse('confirm');
  eq('confirm: kind', r.kind, 'order_confirmation'); eq('confirm: HD order number', r.order_number, 'H2345-678901');
  eq('confirm: item', r.item_type, 'Refrigerator'); eq('confirm: make/model (cross-sell block ignored)', r.make_model, 'Whirlpool WRS325SDHZ');
  eq('confirm: address', r.address, '5425 Belle Vista Ave, Baltimore, MD 21206'); eq('confirm: date from "Estimated Delivery" (order date ignored)', r.expected_date, '2026-10-16');
  eq('confirm: no window', r.expected_window, ''); eq('confirm: nothing missing', r.missing, []);
  r = parse('scheduled'); eq('scheduled: kind', r.kind, 'scheduled'); eq('scheduled: date', r.expected_date, '2026-10-16'); eq('scheduled: order', r.order_number, 'H2345-678901');
  eq('scheduled: address after the label, name line skipped', r.address, '5425 Belle Vista Ave, Baltimore, MD 21206'); eq('scheduled: "Need to reschedule?" footer is NOT a reschedule', r.kind, 'scheduled');
  r = parse('window'); eq('window: kind', r.kind, 'window_set'); eq('window: "between 9:00 AM and 1:00 PM" -> 9a-1p', r.expected_window, '9a-1p'); eq('window: date carried too', r.expected_date, '2026-10-16');
  r = parse('window2'); eq('window2: "arrive between 11 AM - 3 PM"', r.expected_window, '11a-3p'); eq('window2: kind', r.kind, 'window_set'); eq('window2: date', r.expected_date, '2026-10-16'); eq('window2: address missing is flagged', r.missing, ['delivery_address']);
  r = parse('enroute'); eq('enroute: kind', r.kind, 'en_route'); eq('enroute: "8am-12pm"-style window', r.expected_window, '9a-1p'); eq('enroute: "arrive today" = received day (ET)', r.expected_date, '2026-10-14');
  r = parse('approaching'); eq('approaching: kind', r.kind, 'approaching'); eq('approaching: 3 stops', r.stops_away, 3);
  eq('approaching: 1 stop', parse('approaching1').stops_away, 1);
  r = parse('delivered'); eq('delivered: kind', r.kind, 'delivered'); eq('delivered: order', r.order_number, 'H2345-678901');
  r = parse('reschedule'); eq('reschedule: kind', r.kind, 'reschedule'); eq('reschedule: new date', r.expected_date, '2026-10-19'); eq('reschedule: window', r.expected_window, '11a-3p');
  r = parse('cancel'); eq('cancel: kind', r.kind, 'cancel'); eq('cancel: order from the subject', r.order_number, 'H2345-678901');
  r = parse('w'); eq('W-format order', r.order_number, 'W123456789'); eq('W: kind (subject says confirmation, body has a date)', r.kind, 'order_confirmation');
  eq('W: item Range', r.item_type, 'Range'); eq('W: make/model', r.make_model, 'Frigidaire FFEH3054USS'); eq('W: address with Apt 3R', r.address, '928 N Calvert St Apt 3R, Baltimore, MD 21202'); eq('W: unit_raw', r.unit_raw, 'Apt 3R'); eq('W: date "Oct 22"', r.expected_date, '2026-10-22');
  r = parse('cm'); eq('CM-format order', r.order_number, 'CM12345678'); eq('CM: kind', r.kind, 'order_confirmation'); eq('CM: Samsung model', r.make_model, 'Samsung RF27T5201SR'); eq('CM: "Ship to" address', r.address, '5425 Belle Vista Ave, Baltimore, MD 21206');
  r = parse('lowes'); eq("Lowe's numeric order (Order #...)", r.order_number, '123456789'); eq("Lowe's: Washer", r.item_type, 'Washer'); eq("Lowe's: date mm/dd/yyyy", r.expected_date, '2026-10-22'); eq("Lowe's: window 8am-12pm", r.expected_window, '8a-12p'); eq("Lowe's: kind = window_set (scheduled + window)", r.kind, 'window_set');
  eq("Lowe's: make/model", r.make_model, 'Maytag MVW6230HW');
  // labelled fallbacks
  eq('"Order No." label', P.deliveryParseOrderNumber('Your Order No. 88776655 is confirmed'), '88776655');
  eq('"Order Number:" label with store format wins', P.deliveryParseOrderNumber('Order Number: H1111-222222'), 'H1111-222222');
  eq('"order #" followed by a short word is not an order number', P.deliveryParseOrderNumber('Order #1 priority'), '');
  eq('no order number', P.deliveryParseOrderNumber('hello there'), '');
}
// ── D. promo / not a delivery ──
{
  let r = parse('promo'); eq('promo: not_delivery', r.kind, 'not_delivery'); t('promo: has a reason', /promotional/.test(r.reason));
  eq('promo with the word "order" but no order number: not_delivery', parse('promoWithOrderWord').kind, 'not_delivery');
  eq('a store email with nothing about orders/deliveries: not_delivery', P.deliveryParseEmail({ subject: 'Welcome to Pro Xtra', body: 'Your account is ready. Log in to see your profile.', received_at: RECV }).kind, 'not_delivery');
  eq('an "unsubscribe" footer does NOT hide a real order email (has an order number)', P.deliveryParseEmail({ subject: 'Your delivery is on its way', body: 'Order H2345-678901 is on its way.\nUnsubscribe', received_at: RECV }).kind, 'en_route');
  eq('promo wording + live-delivery SUBJECT (no order number) still counts', P.deliveryParseEmail({ subject: 'Your delivery is on its way', body: 'Sale on grills! Unsubscribe', received_at: RECV }).kind, 'en_route');
}
// ── E. unknown ──
{
  const r = parse('unknown'); eq('unknown: kind', r.kind, 'unknown'); eq('unknown: order number still read', r.order_number, 'H3456-789012'); t('unknown: carries an excerpt for the Needs Review row', /Please contact us/.test(r.excerpt));
}
// ── C. dates, years, windows ──
{
  const d = (txt, recv) => P.deliveryParseDate(txt.replace(/\s+/g, ' '), recv);
  eq('Dec -> Jan boundary: "January 3" received Dec 28 2026 = 2027-01-03', d('Delivery date: Sunday, January 3', '2026-12-28T15:00:00Z'), '2027-01-03');
  eq('Jan -> Jan: "Fri, Jan 8" received Jan 2 2027 = 2027-01-08', d('Your delivery is scheduled for Fri, Jan 8', '2027-01-02T15:00:00Z'), '2027-01-08');
  eq('same year in December', d('Delivery date: Dec 22', '2026-12-20T15:00:00Z'), '2026-12-22');
  eq('slightly past (late-processed delivered mail) stays this year', d('delivered on Dec 30', '2027-01-02T15:00:00Z'), '2026-12-30');
  eq('far past rolls to next year', d('Delivery date: Oct 5', '2026-10-23T15:00:00Z'), '2027-10-05');
  eq('explicit year is kept', d('Delivery date: 10/24/2026', '2026-10-01T15:00:00Z'), '2026-10-24');
  eq('ISO date', d('Delivery date: 2026-11-02', '2026-10-01T15:00:00Z'), '2026-11-02');
  eq('ordinal "October 24th"', d('scheduled for October 24th', '2026-10-01T15:00:00Z'), '2026-10-24');
  eq('"Oct. 24" with a dot', d('Estimated delivery: Oct. 24', '2026-10-01T15:00:00Z'), '2026-10-24');
  eq('order date before the delivery date is skipped', d('Order date: Oct 13 Delivery date: Oct 30', '2026-10-14T15:00:00Z'), '2026-10-30');
  eq('"tomorrow"', d('Your order will be delivered tomorrow', '2026-10-14T15:00:00Z'), '2026-10-15');
  eq('evening UTC email belongs to the ET day (23:30Z Oct 14 = 7:30pm ET Oct 14; "today")', d('arriving today', '2026-10-14T23:30:00Z'), '2026-10-14');
  eq('no delivery keyword near a date: no date', d('Thank you! Your card ending 4242 was charged on Oct 14.', RECV), '');
  eq('impossible date is ignored', d('Delivery date: Feb 30', RECV), '');
  const w = P.deliveryParseWindow;
  eq('"between 9:00 AM and 1:00 PM"', w('between 9:00 AM and 1:00 PM'), '9a-1p'); eq('"8am-12pm"', w('8am-12pm'), '8a-12p'); eq('"arrive between 11 AM - 3 PM"', w('arrive between 11 AM - 3 PM'), '11a-3p');
  eq('"9:30 am to 1 pm"', w('9:30 am to 1 pm'), '9:30a-1p'); eq('"8 AM - 12 PM"', w('8 AM - 12 PM'), '8a-12p'); eq('"11 - 3 PM" borrows am for the first hour', w('11 - 3 PM'), '11a-3p');
  eq('"1-5 PM" stays pm', w('1-5 PM'), '1p-5p'); eq('"12pm-4pm"', w('12pm-4pm'), '12p-4p'); eq('"8-12" with no am/pm is NOT a window', w('Oct 8-12'), ''); eq('a phone number is not a window', w('call 410-555-0100'), '');
  eq('"8:00 a.m. - 12:00 p.m."', w('8:00 a.m. - 12:00 p.m.'), '8a-12p');
}
// ── address branches ──
{
  const a = txt => P.deliveryParseAddress(txt.replace(/\s+/g, ' '));
  eq('"Deliver to:" street + unit + city', a('Deliver to: 928 N Calvert St Apt 2, Baltimore, MD 21202').address, '928 N Calvert St Apt 2, Baltimore, MD 21202');
  eq('"#3" unit', a('Ship to: 928 N Calvert St #3, Baltimore, MD 21202').unit_raw, 'Unit 3');
  eq('street only (no city/state/zip) still read after a label', a('Delivery address: 10 Dup Ave').address, '10 Dup Ave');
  eq('store pick-up address in a footer is not taken when a label exists', a('Delivery Address: 5425 Belle Vista Ave, Baltimore, MD 21206 ... Pick up at store 2455 Paces Ferry Rd, Atlanta, GA 30339').address, '5425 Belle Vista Ave, Baltimore, MD 21206');
  eq('no label: first full street+zip anywhere', a('Hi. We will bring it to 77 Nowhere Rd, Baltimore, MD 21201 soon').address, '77 Nowhere Rd, Baltimore, MD 21201');
  eq('no label and no zip: nothing guessed', a('We will bring it to 77 Nowhere Rd soon').address, '');
  eq('"St. Paul Street"', a('Deliver to: 931 St. Paul Street, Baltimore, MD 21202').address, '931 St. Paul Street, Baltimore, MD 21202');
}
// ── HTML-only email ──
{
  const html = '<html><style>.x{}</style><body><p>Thank you for your order!</p><table><tr><td>Order Number:</td><td>H2345-678901</td></tr><tr><td>Delivery Address:</td></tr><tr><td>5425 Belle Vista Ave<br>Baltimore, MD 21206</td></tr></table><p>Estimated Delivery: Fri, Oct 16</p></body></html>';
  const r = P.deliveryParseEmail({ subject: 'Order Confirmation', body: '', html, received_at: RECV });
  eq('HTML-only: kind', r.kind, 'order_confirmation'); eq('HTML-only: order', r.order_number, 'H2345-678901'); eq('HTML-only: address', r.address, '5425 Belle Vista Ave, Baltimore, MD 21206'); eq('HTML-only: date', r.expected_date, '2026-10-16');
  const h2 = P.deliveryEmailText('<p>a &lt;b&gt; &amp; c</p>', '');
  t('entities decode but never re-create tags', !/<b>/.test(h2) && /& c/.test(h2));
}
// ── status never moves backward ──
{
  const s = P.deliveryNextStatus;
  eq('Ordered + scheduled -> Scheduled', s('Ordered', 'scheduled').status, 'Scheduled');
  eq('Window-Set + scheduled stays Window-Set', s('Window-Set', 'scheduled'), { status: 'Window-Set', changed: false, anomaly: '' });
  eq('En-Route + window_set stays En-Route', s('En-Route', 'window_set').status, 'En-Route');
  eq('Approaching + en_route stays Approaching', s('Approaching', 'en_route').status, 'Approaching');
  eq('Delivered + en_route stays Delivered (late email)', s('Delivered', 'en_route'), { status: 'Delivered', changed: false, anomaly: '' });
  eq('Window-Set + reschedule -> Scheduled (the one allowed backward move)', s('Window-Set', 'reschedule').status, 'Scheduled');
  eq('En-Route + cancel -> Cancelled', s('En-Route', 'cancel').status, 'Cancelled');
  t('Delivered + cancel is flagged, not applied', s('Delivered', 'cancel').status === 'Delivered' && /already Delivered/.test(s('Delivered', 'cancel').anomaly));
  t('Delivered + reschedule is flagged, not applied', s('Delivered', 'reschedule').status === 'Delivered' && !!s('Delivered', 'reschedule').anomaly);
  eq('Cancelled + reschedule reopens as Scheduled', s('Cancelled', 'reschedule').status, 'Scheduled');
  t('Cancelled + scheduled is flagged and unchanged', s('Cancelled', 'scheduled').status === 'Cancelled' && !!s('Cancelled', 'scheduled').anomaly);
  eq('Needs Review + scheduled takes the new status', s('Needs Review', 'scheduled').status, 'Scheduled');
  eq('Ordered + delivered -> Delivered', s('Ordered', 'delivered').status, 'Delivered');
}
// ── L. calendar object ──
{
  const c1 = P.deliveryCalendarObject({ order: 'H2345-678901', item: 'Refrigerator', date: '2026-10-16', window: '9a-1p', address: '5425 Belle Vista Ave', wo_id: 'WO-1300', kind: 'window_set', status: 'Window-Set', is_new: true });
  eq('window: action create, timed, ET offset (EDT)', [c1.action, c1.all_day, c1.start_iso, c1.end_iso], ['create', false, '2026-10-16T09:00:00-04:00', '2026-10-16T13:00:00-04:00']);
  eq('title + stable key + location', [c1.title, c1.key, c1.location], ['Delivery: Refrigerator (H2345-678901)', 'delivery-h2345-678901', '5425 Belle Vista Ave']);
  t('description says order, WO and "call Brett"', /Order H2345-678901/.test(c1.description) && /WO-1300/.test(c1.description) && /Driver calls Brett/.test(c1.description));
  const c2 = P.deliveryCalendarObject({ order: 'H2345-678901', item: 'Refrigerator', date: '2026-10-16', window: '', kind: 'scheduled', status: 'Scheduled', is_new: false });
  eq('date only: all-day, end date exclusive, action update, same key', [c2.action, c2.all_day, c2.start_iso, c2.end_iso, c2.key], ['update', true, '2026-10-16', '2026-10-17', c1.key]);
  const c3 = P.deliveryCalendarObject({ order: 'H2345-678901', item: 'Refrigerator', date: '2026-10-16', kind: 'cancel', status: 'Cancelled' });
  eq('cancel: action cancel, same key', [c3.action, c3.key], ['cancel', c1.key]);
  eq('no date: action none', P.deliveryCalendarObject({ order: 'H1', item: 'Range', date: '', kind: 'order_confirmation', status: 'Ordered', is_new: true }).action, 'none');
  const c5 = P.deliveryCalendarObject({ order: 'H2345-678901', item: 'Refrigerator', date: '2026-12-10', window: '11a-3p', kind: 'window_set', status: 'Window-Set' });
  eq('winter date uses EST (-05:00)', [c5.start_iso, c5.end_iso], ['2026-12-10T11:00:00-05:00', '2026-12-10T15:00:00-05:00']);
  eq('Month-end all-day rolls the exclusive end date', P.deliveryCalendarObject({ order: 'H1', date: '2026-10-31', kind: 'scheduled', status: 'Scheduled' }).end_iso, '2026-11-01');
  eq('key falls back to the delivery id when there is no order number', P.deliveryCalendarObject({ order: '', delivery_id: '42', date: '2026-10-16', kind: 'scheduled', status: 'Scheduled' }).key, 'delivery-id-42');
}
// ── tenant notice timing (batched: today 6pm ET if before 6pm, else tomorrow 9am ET; same-day delivery = now) ──
{
  const H = (iso, date) => { const r = P.deliveryNoticeHoldUntil(new Date(iso), date); return r ? r.toISOString() : null; };
  eq('9:00am ET (13:00Z) -> today 6pm ET', H('2026-10-14T13:00:00Z', '2026-10-16'), '2026-10-14T22:00:00.000Z');
  eq('3:00am ET (07:00Z) -> today 6pm ET', H('2026-10-14T07:00:00Z', '2026-10-16'), '2026-10-14T22:00:00.000Z');
  eq('5:59pm ET (21:59Z) -> today 6pm ET', H('2026-10-14T21:59:00Z', '2026-10-16'), '2026-10-14T22:00:00.000Z');
  eq('exactly 6:00pm ET (22:00Z) -> tomorrow 9am ET', H('2026-10-14T22:00:00Z', '2026-10-16'), '2026-10-15T13:00:00.000Z');
  eq('6:45pm ET -> tomorrow 9am ET', H('2026-10-14T22:45:00Z', '2026-10-16'), '2026-10-15T13:00:00.000Z');
  eq('7:30pm ET (quiet hours) -> tomorrow 9am ET', H('2026-10-14T23:30:00Z', '2026-10-16'), '2026-10-15T13:00:00.000Z');
  eq('11:30pm ET -> tomorrow 9am ET', H('2026-10-15T03:30:00Z', '2026-10-16'), '2026-10-15T13:00:00.000Z');
  eq('winter (EST): 10am ET Dec 10 -> 6pm EST = 23:00Z', H('2026-12-10T15:00:00Z', '2026-12-12'), '2026-12-10T23:00:00.000Z');
  eq('fall-back night: 8pm ET Oct 31 -> Nov 1 9am EST = 14:00Z', H('2026-11-01T00:00:00Z', '2026-11-03'), '2026-11-01T14:00:00.000Z');
  eq('spring-forward night: 7pm ET Mar 13 2027 -> Mar 14 9am EDT = 13:00Z', H('2027-03-13T23:00:00Z', '2027-03-16'), '2027-03-14T13:00:00.000Z');
  eq('no date yet (just ordered): batched like any other', H('2026-10-14T15:00:00Z', ''), '2026-10-14T22:00:00.000Z');
  eq('delivery TODAY (ET) is urgent: no hold at 10am', H('2026-10-14T14:00:00Z', '2026-10-14'), null);
  eq('delivery TODAY (ET) uses the ET day: 03:00Z Oct 15 is still Oct 14 ET', H('2026-10-15T03:00:00Z', '2026-10-14'), null);
  eq('delivery TOMORROW is not urgent', H('2026-10-14T14:00:00Z', '2026-10-15'), '2026-10-14T22:00:00.000Z');
}
// ── texts: plain characters, short, one per event ──
{
  const s = P.deliveryBrettText({ event: 'new', order: 'H2345-678901', item: 'Refrigerator', date: '2026-10-16', window: '9a-1p', address: '5425 Belle Vista Ave, Baltimore, MD 21206', wo_id: 'WO-1300' });
  t('text names order, item, date/window, address, WO', /H2345-678901/.test(s) && /Refrigerator/.test(s) && /Fri 10\/16 9a-1p/.test(s) && /5425 Belle Vista/.test(s) && /WO WO-1300/.test(s), s);
  t('text is plain GSM characters only and one segment here', /^[\x20-\x7e]+$/.test(s) && s.length <= 160, s.length);
  eq('smart quotes / dashes / emoji are stripped to plain', P.deliveryPlainSms('Brett’s “fridge” — ok ✅'), 'Brett\'s "fridge" - ok');
  t('stops away wording', /3 stops away/.test(P.deliveryBrettText({ event: 'approaching', order: 'H1', stops: 3 })) && /you are next/.test(P.deliveryBrettText({ event: 'approaching', order: 'H1', stops: 0 })));
  t('a runaway note is capped at 300', P.deliveryBrettText({ event: 'review', note: 'x'.repeat(900) }).length <= 300);
}

// ════════════════════════════════ PART 2: the real worker over fake Sheets + Twilio ════════════════════════════════
const tick = (ms) => new Promise(r => setTimeout(r, ms));
function makeStore() {
  const tabs = new Map(); const calls = [];
  const st = { tabs, calls, latency: () => 0, failWhen: null };
  const missing = (name) => ({ error: { code: 400, message: `Unable to parse range: ${name}` } });
  st.handle = async (method, path, body) => {
    calls.push(method + ' ' + path); if (process.env.DBG) console.error('  sheets', method, path);
    const lat = st.latency(); if (lat) await tick(lat);
    if (st.failWhen && st.failWhen(method, path, body)) return { error: { code: 500, message: 'injected sheets failure' } };
    let m;
    if (method === 'GET' && (m = /^\/values\/([^!:?]+)$/.exec(path))) { const name = decodeURIComponent(m[1]); if (!tabs.has(name)) return missing(name); return { range: name, values: tabs.get(name).map(r => r.slice()) }; }
    if (method === 'GET' && (m = /^\/values:batchGet\?(.*)$/.exec(path))) {
      const names = m[1].split('&').map(x => decodeURIComponent(x.replace(/^ranges=/, ''))); const valueRanges = [];
      for (const name of names) { if (!tabs.has(name)) return missing(name); valueRanges.push({ range: name, values: tabs.get(name).map(r => r.slice()) }); }
      return { valueRanges };
    }
    if (method === 'GET' && path.startsWith('?fields=')) return { sheets: [...tabs.keys()].map((title, i) => ({ properties: { sheetId: i + 1, title, gridProperties: { columnCount: 200, rowCount: 1000 } } })) };
    if (method === 'POST' && (m = /^\/values\/([^!:?]+):append/.exec(path))) { const name = decodeURIComponent(m[1]); if (!tabs.has(name)) return missing(name); for (const r of body.values) tabs.get(name).push(r.slice()); return { updates: { updatedRows: body.values.length, updatedRange: name + '!A' + tabs.get(name).length } }; }
    if (method === 'POST' && path === '/values:batchUpdate') {
      for (const d of body.data) {
        const [tab, cell] = d.range.split('!'); const mm = /^([A-Z]+)(\d+)$/.exec(cell);
        const c = mm[1].split('').reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1, row = +mm[2] - 1;
        const rows = tabs.get(tab); if (!rows) return missing(tab);
        while (rows.length <= row) rows.push([]); while (rows[row].length <= c) rows[row].push(''); rows[row][c] = d.values[0][0];
      }
      return { totalUpdatedCells: body.data.length };
    }
    if (method === 'POST' && path === ':batchUpdate') { for (const r of body.requests || []) if (r.addSheet) tabs.set(r.addSheet.properties.title, []); return {}; }
    return { error: { code: 400, message: 'fake sheets: unsupported ' + method + ' ' + path } };
  };
  return st;
}
const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
let store = makeStore();
const twilio = [];            // every outbound text the worker tried to send
let twilioMode = 'ok';        // 'ok' | 'fail'
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url; const method = (init && init.method) || 'GET';
  if (url.startsWith('https://oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 'fake-access', expires_in: 3600 }), { status: 200 });
  const m = /^https:\/\/sheets\.googleapis\.com\/v4\/spreadsheets\/TESTSHEET(.*)$/.exec(url);
  if (m) { const b = init && init.body ? JSON.parse(init.body) : undefined; const r = await store.handle(method, decodeURIComponent(m[1]).replace(/%3A/gi, ':'), b); return new Response(JSON.stringify(r), { status: r && r.error ? r.error.code : 200 }); }
  if (url.startsWith('https://api.twilio.com/')) {
    const p = new URLSearchParams(init.body); twilio.push({ to: p.get('To'), body: p.get('Body') });
    return twilioMode === 'ok' ? new Response(JSON.stringify({ sid: 'SM' + twilio.length, status: 'queued' }), { status: 201 }) : new Response(JSON.stringify({ code: 21608, message: 'forced failure' }), { status: 400 });
  }
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
};
const worker = (await import(root + 'worker.js')).default;
// A second copy of worker.js that also exports the (module-private) release sweep, so the test can run exactly that step without the whole cronSweep.
const QH = await (async () => {
  const os = await import('node:os'), path = await import('node:path'), url = await import('node:url');
  const f = path.join(os.tmpdir(), 'worker-qh-' + process.pid + '-' + Date.now() + '.mjs');
  fs.writeFileSync(f, src + '\nexport { processQuietHoursQueue };\n');
  try { return await import(url.pathToFileURL(f).href); } finally { try { fs.unlinkSync(f); } catch (_) {} }
})();
// Run fn with "now" set to an exact instant (the clock keeps advancing from there).
async function withClock(iso, fn) {
  const D0 = globalThis.Date, n0 = D0.now, start = n0.call(D0), target = Date.parse(iso);
  class Fixed extends D0 { constructor(...a) { if (a.length === 0) super(target + (n0.call(D0) - start)); else super(...a); } static now() { return target + (n0.call(D0) - start); } }
  const dn = D0.now; globalThis.Date = Fixed;
  try { return await fn(); } finally { globalThis.Date = D0; D0.now = dn; }
}
const BASE = 'https://maintenance-hub.brett-2f8.workers.dev';
const SECRET = 'admin-secret-for-tests-0123456789', INTAKE = 'intake-token-for-tests-9876543210';
const env = { SHEET_ID: 'TESTSHEET', GOOGLE_SA_KEY: privateKey, GOOGLE_SA_EMAIL: 'sa@test.iam', WORKER_SECRET: SECRET, INTAKE_TOKEN: INTAKE, TWILIO_SID: 'ACtest', TWILIO_API_SID: 'SKtest', TWILIO_API_KEY: 'keytest', TWILIO_FROM: '+14105550999' };
let skew = 0; const _realNow = Date.now.bind(Date); Date.now = () => _realNow() + skew;   // defeat the 6s tab cache between calls
const call = async (method, path, token, body, e) => {
  if (process.env.DBG) console.error('CALL', method, path);
  skew += 10000;
  const res = await worker.fetch(new Request(BASE + path, { method, headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { 'X-Auth-Token': token } : {}), body: body === undefined ? undefined : JSON.stringify(body) }), e || env, { waitUntil() {} });
  let j = null, text = ''; try { text = await res.clone().text(); j = JSON.parse(text); } catch (_) {}
  return { status: res.status, json: j, text };
};
const ADMIN = '+14435550000', TENANT_PHONE = '+14105550101';
const tab = (name, headers, rows) => store.tabs.set(name, [headers, ...rows.map(r => headers.map(h => r[h] ?? ''))]);
const rowsOf = (name) => { const t = store.tabs.get(name); if (!t || !t.length) return []; const h = t[0]; return t.slice(1).map(r => Object.fromEntries(h.map((k, i) => [k, r[i] ?? '']))); };
const WOH = ['Vendor_Needs_Access', 'ID', 'Property_ID', 'Unit_ID', 'Tenant_ID', 'Vendor_ID', 'Type', 'Trade', 'Description', 'Priority', 'Status', 'Scheduled_Date', 'Scheduled_Window', 'Completed_Date', 'Invoice_ID', 'Owner_WO_Ref', 'WO_Contact_Name', 'WO_Contact_Phone', 'Tenant_Visible', 'Tenant_Notify_Created', 'Tenant_Notify_Updates', 'Vendor_SMS_Sent', 'Tenant_SMS_Sent', 'Owner_Notified', 'Created_By', 'Created_Date', 'Notes', 'Room', 'Checklist', 'Source', 'Intake_Message_ID'];
function seed(over) {
  over = over || {};
  // The worker memoises ensureColumns for 10 minutes per process, so a brand-new fake store must keep the HEADER rows the previous run created
  // (exactly what the live sheet looks like after the first email): carry headers over, drop the data.
  const prev = store; store = makeStore(); skew += 60000; twilio.length = 0; twilioMode = 'ok';
  for (const [name, rows] of prev.tabs) if (rows.length && rows[0].length) store.tabs.set(name, [rows[0].slice()]);
  tab('Config', ['Key', 'Value'], Object.entries(Object.assign({ admin_phone: ADMIN, TWILIO_ENABLED: 'TRUE', TWILIO_TEST_MODE: 'FALSE' }, over.config || {})).map(([Key, Value]) => ({ Key, Value })));
  tab('Owners', ['ID', 'First_Name', 'Company', 'SMS_Enabled', 'Phone'], [{ ID: 'O1', First_Name: 'Olly', Company: 'Phoenix Estate Rentals', SMS_Enabled: 'TRUE' }]);
  tab('Properties', ['ID', 'Owner_ID', 'Address', 'City', 'Type', 'Unit_Count', 'Active', 'Access_Notes', 'SMS_Enabled'], [
    { ID: 'P1', Owner_ID: 'O1', Address: '5425 Belle Vista Ave', City: 'Baltimore', Type: 'house', Unit_Count: '1', Active: 'TRUE' },
    { ID: 'P2', Owner_ID: 'O1', Address: '928 N Calvert St', City: 'Baltimore', Type: 'multi', Unit_Count: '2', Active: 'TRUE' },
    { ID: 'P3', Owner_ID: 'O1', Address: '10 Dup Ave', City: 'Baltimore', Type: 'house', Unit_Count: '1', Active: 'TRUE' },
    { ID: 'P4', Owner_ID: 'O1', Address: '10 Dup Ave', City: 'Baltimore', Type: 'house', Unit_Count: '1', Active: 'TRUE' },
    { ID: 'P5', Owner_ID: 'O1', Address: '3 Test Ct', City: 'Baltimore', Type: 'house', Unit_Count: '1', Active: 'TRUE', Access_Notes: 'TEST-PROPERTY' },
  ]);
  tab('Units', ['ID', 'Property_ID', 'Unit_Label', 'Active'], [{ ID: 'U1', Property_ID: 'P1', Unit_Label: '1', Active: 'TRUE' }, { ID: 'U2', Property_ID: 'P2', Unit_Label: 'Apt 2', Active: 'TRUE' }, { ID: 'U3', Property_ID: 'P2', Unit_Label: 'Apt 3R', Active: 'TRUE' }]);
  tab('Tenants', ['ID', 'Property_ID', 'Unit_ID', 'Active', 'First_Name', 'Last_Name', 'Phone', 'SMS_Enabled', 'SMS_OptOut', 'Move_In_Date', 'Move_Out_Date'], [
    Object.assign({ ID: 'T1', Property_ID: 'P1', Unit_ID: 'U1', Active: 'TRUE', First_Name: 'Tam', Last_Name: 'One', Phone: TENANT_PHONE, Move_In_Date: '2025-01-01' }, over.t1 || {}),
    { ID: 'T2', Property_ID: 'P2', Unit_ID: 'U2', Active: 'TRUE', First_Name: 'Tia', Last_Name: 'Two', Phone: '+14105550102', Move_In_Date: '2025-01-01' },
    { ID: 'T3', Property_ID: 'P2', Unit_ID: 'U3', Active: 'TRUE', First_Name: 'Tom', Last_Name: 'Three', Phone: '+14105550103', Move_In_Date: '2025-01-01' },
    { ID: 'T4', Property_ID: 'P2', Unit_ID: 'U3', Active: 'TRUE', First_Name: 'Tess', Last_Name: 'Four', Phone: '+14105550104', Move_In_Date: '2025-01-01' },
  ]);
  tab('Work_Orders', WOH, []);
  tab('Vendors', ['ID', 'Name', 'Phone', 'SMS_Enabled'], []);
  tab('WO_Tenants', ['ID', 'WO_ID', 'Tenant_ID', 'Tenant_Name', 'Tenant_Phone', 'Added_By', 'Added_Date', 'Active'], []);
}
let mseq = 0;
const send = (k, over, mailbox) => call('POST', '/intake/delivery-email', INTAKE, Object.assign({ from: 'Home Depot <orders@order.homedepot.com>', message_id: 'MSG-' + (++mseq), received_at: RECV, mailbox: mailbox || 'info@bmoremanagement.com' }, typeof k === 'string' ? FX[k] : k, over || {}));
const snap = () => JSON.stringify([...store.tabs.entries()]);
const dels = () => rowsOf('Deliveries'), wos = () => rowsOf('Work_Orders'), mq = () => rowsOf('Message_Queue');
const noticeRows = () => mq().filter(r => r.Message_Type === 'delivery_tenant_notice');
const toAdmin = () => twilio.filter(x => x.to === ADMIN), toTenant = () => twilio.filter(x => x.to === TENANT_PHONE);

// ── A. token gate ──
{
  seed();
  const ok1 = await call('POST', '/intake/delivery-email', INTAKE, { from: 'a@evil.io', message_id: 'x' });
  t('A: INTAKE_TOKEN passes the gate on /intake/delivery-email (400 = reached the handler, not 401)', ok1.status === 400 && /allowed store domain/.test(ok1.json.error), ok1);
  const ok2 = await call('POST', '/intake/email', INTAKE, { from: 'a@evil.io', message_id: 'x', subject: 'Work order 1', body: '' });
  t('A: INTAKE_TOKEN still passes on /intake/email', ok2.status === 400 && /managebuilding/.test(ok2.json.error), ok2);
  for (const [m, p] of [['POST', '/delivery/add'], ['POST', '/delivery/update'], ['POST', '/delivery/relay'], ['GET', '/deliveries'], ['POST', '/intake/retry'], ['GET', '/intake-queue'], ['POST', '/workorder'], ['GET', '/config'], ['POST', '/cron/run'], ['POST', '/admin-notify'], ['GET', '/intake/delivery-email']]) {
    const r = await call(m, p, INTAKE, m === 'POST' ? {} : undefined);
    t(`A: INTAKE_TOKEN is refused on ${m} ${p}`, r.status === 401, r.status);
  }
  const bad = await call('POST', '/intake/delivery-email', 'wrong-token', { from: 'orders@homedepot.com', message_id: 'x' });
  t('A: a wrong token is 401', bad.status === 401, bad.status);
  const none = await call('POST', '/intake/delivery-email', '', { from: 'orders@homedepot.com', message_id: 'x' });
  t('A: no token is 401', none.status === 401, none.status);
  const noEnv = await call('POST', '/intake/delivery-email', INTAKE, { from: 'orders@homedepot.com', message_id: 'x' }, Object.assign({}, env, { INTAKE_TOKEN: undefined }));
  t('A: with env.INTAKE_TOKEN unset the gate is inert (401)', noEnv.status === 401, noEnv.status);
  const emptyEnv = await call('POST', '/intake/delivery-email', '', { from: 'orders@homedepot.com', message_id: 'x' }, Object.assign({}, env, { INTAKE_TOKEN: '' }));
  t('A: with env.INTAKE_TOKEN blank and an empty header it is still 401', emptyEnv.status === 401, emptyEnv.status);
  const admin = await call('POST', '/intake/delivery-email', SECRET, { from: 'a@evil.io', message_id: 'x' });
  t('A: the admin secret still works on the route (400 for the bad sender)', admin.status === 400, admin.status);
  t('A: nothing was written by any of that', dels().length === 0 && twilio.length === 0);
}

// ── B. unknown sender: 400 and nothing written ──
{
  seed();
  const before = snap();
  for (const from of ['promo@randomshop.com', '"orders@homedepot.com" <x@evil.io>', 'x@homedepot.com.evil.io', '']) {
    const r = await send('confirm', { from });
    t('B: sender "' + from + '" -> 400', r.status === 400 && r.json.success === false, r);
  }
  t('B: nothing written, nothing sent', snap() === before && twilio.length === 0);
  const noId = await call('POST', '/intake/delivery-email', INTAKE, { from: 'orders@homedepot.com', subject: 'x', body: 'y' });
  t('B: missing message_id -> 400', noId.status === 400);
  seed({ config: { Delivery_Sender_Domains: 'lowes.com' } });
  t('B: Config Delivery_Sender_Domains narrows the list (homedepot now refused)', (await send('confirm')).status === 400);
  const lw = await send('lowes', { from: "Lowe's <orders@lowes.com>" });
  t('B: ...and lowes.com is accepted', lw.status === 200 && lw.json.success === true, lw);
}

// ── D. promo: zero writes, zero SMS ──
{
  seed(); const before = snap();
  for (const k of ['promo', 'promoWithOrderWord']) {
    const r = await send(k);
    t('D: ' + k + ' -> success, not_delivery', r.status === 200 && r.json.success && r.json.kind === 'not_delivery' && !r.json.delivery_id && !r.json.parked, r);
  }
  t('D: zero writes to ANY tab (no Deliveries tab, no telemetry, no queue), zero texts', snap() === before && twilio.length === 0 && dels().length === 0);
}

// ── S1: new order, exact property (G exact), WO once (H), Brett text, tenant notice batched, calendar ──
let firstDelivery;
{
  seed();
  const r = await send('confirm');
  const j = r.json;
  t('S1: 200 success created', r.status === 200 && j.success && j.created && !j.updated && !j.duplicate && !j.parked && j.kind === 'order_confirmation', j);
  eq('S1: parsed fields echoed', [j.order_number, j.item_type, j.make_model, j.expected_date, j.delivery_address], ['H2345-678901', 'Refrigerator', 'Whirlpool WRS325SDHZ', '2026-10-16', '5425 Belle Vista Ave, Baltimore, MD 21206']);
  eq('S1: exact property matched, unit and the single tenant resolved', [j.property_matched, j.property_id, j.unit_id, j.tenant_id], [true, 'P1', 'U1', 'T1']);
  const d = dels(); eq('S1: exactly one Deliveries row', d.length, 1); firstDelivery = d[0];
  eq('S1: row core fields', [d[0].Order_Number, d[0].Store, d[0].Status, d[0].Source, d[0].Property_ID, d[0].Unit_ID, d[0].Tenant_ID, d[0].Expected_Date, d[0].Active], ['H2345-678901', 'Home Depot', 'Ordered', 'email-watcher', 'P1', 'U1', 'T1', '2026-10-16', 'TRUE']);
  eq('S1: tenant preferred on site, Brett is the backup with his admin phone', [d[0].Onsite_Contact, d[0].Backup_Contact, d[0].Backup_Phone], ['tenant', 'Brett', ADMIN]);
  t('S1: notes say the driver calls Brett and who receives', /Driver calls Brett/.test(d[0].Delivery_Notes) && /Brett receives/.test(d[0].Delivery_Notes), d[0].Delivery_Notes);
  t('S1: Message_ID + Seen_Message_IDs recorded', d[0].Message_ID === 'MSG-' + mseq && d[0].Seen_Message_IDs === d[0].Message_ID);
  const w = wos(); eq('H: exactly one WO', w.length, 1);
  t('H: WO is on the property/unit/tenant, trade Appliance, Source email-watcher', w[0].Property_ID === 'P1' && w[0].Unit_ID === 'U1' && w[0].Tenant_ID === 'T1' && w[0].Trade === 'Appliance' && w[0].Source === 'email-watcher' && w[0].Intake_Message_ID === d[0].Message_ID, w[0]);
  t('H: WO description says Ridge Co receives, crew hauls away the old unit, Brett installs, tenant does not', /Ridge Co receives the delivery/.test(w[0].Description) && /haul away the old unit/.test(w[0].Description) && /Brett installs \(tenant does not install\)/.test(w[0].Description) && /Brett opens the door/.test(w[0].Description), w[0].Description);
  t('H: no tenant "received your request" notice was queued by the WO (Tenant_Notify_Created FALSE)', w[0].Tenant_Notify_Created === 'FALSE' && rowsOf('Notification_Queue').length === 0);
  eq('S1: delivery links the WO', [d[0].Linked_WO_IDs, j.wo_id, j.wo_created], [w[0].ID, w[0].ID, true]);
  eq('S1: Brett got ONE text, to his admin phone', toAdmin().length, 1);
  const tx = toAdmin()[0].body;
  t('S1: text has order #, item, date, address, WO; plain characters', /H2345-678901/.test(tx) && /Refrigerator/.test(tx) && /Fri 10\/16/.test(tx) && /5425 Belle Vista/.test(tx) && new RegExp(w[0].ID).test(tx) && /^[\x20-\x7e]+$/.test(tx), tx);
  eq('S1: brett_sms_sent true + status', [j.brett_sms_sent, j.sms_status], [true, 'sent']);
  // tenant notice 'auto' (default), Oct 14 11:00 ET, delivery Oct 16 -> batched to 6pm ET today = 22:00Z
  eq('S1: tenant notice is QUEUED (default auto), not sent now', j.tenant_sms, 'queued');
  eq('S1: nothing went to the tenant yet', toTenant().length, 0);
  const n = noticeRows(); eq('S1: one held Message_Queue row', n.length, 1);
  eq('S1: held until today 6pm ET (22:00Z), still pending', [n[0].Send_After, n[0].Status], ['2026-10-14T22:00:00.000Z', 'pending']);
  t('S1: text says ordered + date, be there if you can, Ridge Co will receive, on behalf of owner, STOP line (first text)', /Your refrigerator has been ordered and is scheduled for Fri 10\/16/.test(n[0].Message_Body) && /Please be home if you can/.test(n[0].Message_Body) && /Ridge Co will be there to receive it/.test(n[0].Message_Body) && /Ridge Co Property Maintenance, on behalf of Phoenix Estate Rentals/.test(n[0].Message_Body) && /Reply STOP/.test(n[0].Message_Body) && /^[\x20-\x7e]+$/.test(n[0].Message_Body), n[0].Message_Body);
  eq('S1: queue row is the tenant\'s, tied to the WO and property', [n[0].Recipient_Type, n[0].Recipient_Phone, n[0].WO_ID, n[0].Property_ID], ['tenant', TENANT_PHONE, w[0].ID, 'P1']);
  eq('S1: calendar create, all-day Oct 16, stable key', [j.calendar.action, j.calendar.all_day, j.calendar.start_iso, j.calendar.end_iso, j.calendar.key], ['create', true, '2026-10-16', '2026-10-17', 'delivery-h2345-678901']);
  t('S1: telemetry written and reported', j.telemetry_ok === true && rowsOf('Ops_Telemetry').some(x => x.Job_Type === 'delivery_email_intake' && x.Success === 'TRUE'));
  t('S1: no needs_attention', j.needs_attention === false && j.warnings.length === 0, j);
  // F. duplicate: same Message-ID again, from the OTHER mailbox
  const s0 = snap(), nTw = twilio.length;
  const dup = await call('POST', '/intake/delivery-email', INTAKE, { from: 'Home Depot <orders@order.homedepot.com>', subject: FX.confirm.subject, body: FX.confirm.body, message_id: d[0].Message_ID, received_at: RECV, mailbox: 'brett@bmoremanagement.com' });
  t('F: same Message-ID from the second mailbox -> duplicate:true, same delivery', dup.status === 200 && dup.json.duplicate === true && dup.json.delivery_id === d[0].ID && !dup.json.created && !dup.json.updated, dup.json);
  t('F: no new row, no new WO, no text, no write at all', snap() === s0 && twilio.length === nTw);
}

// ── F/L: lifecycle on the same order: updates not inserts, status never backward, alerts only on real news ──
{
  const id = firstDelivery.ID;
  const nWO = () => wos().length;
  let r = await send('window');
  let d = dels();
  t('F: window email UPDATES the same row (no second row)', d.length === 1 && r.json.updated === true && !r.json.created && r.json.delivery_id === id, r.json);
  eq('F: status Window-Set, window 9a-1p', [d[0].Status, d[0].Expected_Window, d[0].Expected_Date], ['Window-Set', '9a-1p', '2026-10-16']);
  eq('H: still exactly one WO', nWO(), 1);
  eq('S: Brett texted about the window (2 texts total now)', toAdmin().length, 2);
  t('S: window text carries the window', /9a-1p/.test(toAdmin()[1].body), toAdmin()[1].body);
  eq('L: calendar update with the timed window', [r.json.calendar.action, r.json.calendar.all_day, r.json.calendar.start_iso, r.json.calendar.end_iso], ['update', false, '2026-10-16T09:00:00-04:00', '2026-10-16T13:00:00-04:00']);
  const n = noticeRows();
  t('K: the newer tenant notice REPLACED the waiting one (one pending, older skipped)', n.filter(x => x.Status === 'pending').length === 1 && n.filter(x => x.Status === 'skipped').length === 1 && /9a-1p/.test(n.find(x => x.Status === 'pending').Message_Body), n.map(x => x.Status));
  eq('K: the tenant was still not texted yet', toTenant().length, 0);
  // an older kind arriving later does not move status back and says nothing
  const t0 = twilio.length;
  r = await send('scheduled');
  d = dels();
  t('F: a later "scheduled" email never moves Window-Set back', d[0].Status === 'Window-Set' && r.json.updated === false && r.json.reason === 'no_change', r.json);
  t('F: ...and sends Brett nothing (no routine duplicate chatter)', twilio.length === t0 && r.json.brett_sms_sent === null);
  t('F: ...and no calendar change', r.json.calendar.action === 'none');
  // same news with a NEW message id (the store re-sends): still nothing
  r = await send('window');
  t('F: the same window email re-sent (new Message-ID) -> no change, no text', twilio.length === t0 && r.json.reason === 'no_change' && dels()[0].Seen_Message_IDs.split(',').length === 4, r.json);
  // en route
  r = await send('enroute');
  d = dels(); eq('S: en route -> En-Route', d[0].Status, 'En-Route');
  t('S: en-route text goes out', toAdmin().length === 3 && /on its way/i.test(toAdmin()[2].body), toAdmin()[2] && toAdmin()[2].body);
  r = await send('approaching');
  eq('S: approaching 3 stops', [dels()[0].Status, dels()[0].Stops_Away], ['Approaching', '3']);
  t('S: text says 3 stops away', /3 stops away/.test(toAdmin()[3].body), toAdmin()[3].body);
  const t1 = twilio.length; r = await send('approaching');
  t('S: the same "3 stops away" again -> no second text', twilio.length === t1 && r.json.reason === 'no_change');
  r = await send('approaching1');
  t('S: "1 stop away" is news -> texted', twilio.length === t1 + 1 && /1 stop away/.test(toAdmin()[4].body) && dels()[0].Stops_Away === '1', toAdmin()[4] && toAdmin()[4].body);
  r = await send('enroute');
  eq('F: an en-route email after Approaching does not move status back', dels()[0].Status, 'Approaching');
  // delivered
  r = await send('delivered');
  eq('S: delivered', dels()[0].Status, 'Delivered');
  t('S: delivered text', /Delivered/.test(toAdmin()[toAdmin().length - 1].body) && r.json.brett_sms_sent === true);
  eq('L: delivered keeps the event, retitled', [r.json.calendar.action, /^Delivered:/.test(r.json.calendar.title)], ['update', true]);
  const t2 = twilio.length;
  r = await send('reschedule');
  t('F: a reschedule on a DELIVERED order is flagged to Brett and NOT applied', dels()[0].Status === 'Delivered' && dels()[0].Expected_Date === '2026-10-16' && twilio.length === t2 + 1 && /Delivery problem/.test(toAdmin()[toAdmin().length - 1].body) && /already Delivered/.test(r.json.detail), [r.json, toAdmin().slice(-1)]);
  r = await send('enroute');
  t('F: Delivered never goes back to En-Route', dels()[0].Status === 'Delivered');
  eq('H: STILL exactly one WO and one delivery after the whole lifecycle', [nWO(), dels().length], [1, 1]);
}

// ── reschedule => Scheduled (allowed backward) + window per email; cancel ──
{
  seed();
  await send('window');   // new order straight from a window email (we never saw the confirmation)
  let d = dels(); eq('R: first email being a window email still creates the order', [d.length, d[0].Status], [1, 'Window-Set']);
  const r = await send('reschedule');
  d = dels();
  eq('R: reschedule -> Scheduled, new date and the NEW window', [d[0].Status, d[0].Expected_Date, d[0].Expected_Window, r.json.updated], ['Scheduled', '2026-10-19', '11a-3p', true]);
  t('R: Brett texted the change', /Delivery changed/.test(toAdmin().slice(-1)[0].body) && /Mon 10\/19/.test(toAdmin().slice(-1)[0].body), toAdmin().slice(-1));
  t('R: notes keep the history', /was 2026-10-16/.test(d[0].Delivery_Notes), d[0].Delivery_Notes);
  const c = await send('cancel');
  d = dels();
  eq('C: cancel -> Cancelled, Active stays TRUE', [d[0].Status, d[0].Active], ['Cancelled', 'TRUE']);
  eq('C: calendar action cancel', c.json.calendar.action, 'cancel');
  t('C: Brett told', /CANCELLED/.test(toAdmin().slice(-1)[0].body));
  const n0 = twilio.length;
  const x = await send('scheduled');
  t('C: a "scheduled" email after cancel is flagged, status stays Cancelled', dels()[0].Status === 'Cancelled' && /Cancelled/.test(x.json.detail) && twilio.length === n0 + 1, x.json);
  // a fresh cancel for an order we never saw: row exists as Cancelled, NO work order
  seed(); const nc = await send('cancel', { body: FX.cancel.body + ' ' + 'Deliver to: 5425 Belle Vista Ave, Baltimore, MD 21206' });
  t('C: a cancel for an unseen order records it Cancelled and creates no WO', nc.json.success && dels()[0].Status === 'Cancelled' && wos().length === 0, nc.json);
}

// ── G. address branches ──
{
  seed();
  // unit "Apt 2" on a multi-unit property: unit + that unit's single tenant
  let r = await send('w', { body: FX.w.body.replace('Apt 3R', 'Apt 2') });
  eq('G unit: multi-unit property + Apt 2', [r.json.property_id, r.json.unit_id, r.json.tenant_id, r.json.property_matched, r.json.wo_created], ['P2', 'U2', 'T2', true, true]);
  eq('G unit: row + WO on that unit/tenant', [dels()[0].Unit_ID, dels()[0].Tenant_ID, wos()[0].Unit_ID, wos()[0].Tenant_ID], ['U2', 'T2', 'U2', 'T2']);
  // Apt 3R has TWO active tenants: unit resolved, tenant left blank (never guessed), Brett on site
  r = await send('w', { subject: 'Order confirmation', body: FX.w.body.replace('W123456789', 'W222222222') });
  const d3 = dels().find(x => x.Order_Number === 'W222222222');
  eq('G unit: two tenants in the unit -> unit set, Tenant_ID blank, Brett meets the delivery', [d3.Unit_ID, d3.Tenant_ID, d3.Onsite_Contact, d3.Onsite_Contact_Phone, r.json.tenant_sms], ['U3', '', 'me', ADMIN, 'skipped']);
  // multi-unit, no unit in the address -> property set, unit unknown flagged, WO still created at property level
  r = await send('w', { body: 'Order W333333333. Frigidaire Range FFEH3054USS. Deliver to: 928 N Calvert St, Baltimore, MD 21202. Delivery date: Oct 22' });
  const d4 = dels().find(x => x.Order_Number === 'W333333333');
  t('G unit: multi-unit address with no unit -> property matched, unit blank, flagged', d4.Property_ID === 'P2' && d4.Unit_ID === '' && /UNIT UNKNOWN/.test(d4.Delivery_Notes) && /UNIT UNKNOWN/.test(toAdmin().slice(-1)[0].body), [d4.Delivery_Notes, toAdmin().slice(-1)]);
  // ambiguous: two active properties at 10 Dup Ave
  const w0 = wos().length;
  r = await send('lowes');
  const da = dels().find(x => x.Order_Number === '123456789');
  t('G ambiguous: 2 properties -> row created, Property blank, NEEDS PROPERTY in notes, status Ordered/Window-Set', da && da.Property_ID === '' && /NEEDS PROPERTY/.test(da.Delivery_Notes) && /more than one property/.test(da.Delivery_Notes), da);
  t('G ambiguous: no WO created, property_matched false', wos().length === w0 && r.json.property_matched === false && r.json.wo_id === '' && r.json.wo_created === false);
  t('G ambiguous: Brett alerted with NEEDS PROPERTY', /NEEDS PROPERTY/.test(toAdmin().slice(-1)[0].body) && r.json.brett_sms_sent === true, toAdmin().slice(-1));
  eq('G ambiguous: no tenant text', r.json.tenant_sms, 'skipped');
  // no match
  r = await send('w', { body: 'Order W444444444. Samsung Refrigerator RF27T5201SR. Deliver to: 77 Nowhere Rd, Baltimore, MD 21201. Delivery date: Oct 22' });
  const dn = dels().find(x => x.Order_Number === 'W444444444');
  t('G no match: row created blank-property with the address as received', dn && dn.Property_ID === '' && /NEEDS PROPERTY: address as received "77 Nowhere Rd, Baltimore, MD 21201"/.test(dn.Delivery_Notes), dn && dn.Delivery_Notes);
  t('G no match: no WO, alert says NEEDS PROPERTY + the address', wos().length === w0 && /NEEDS PROPERTY/.test(toAdmin().slice(-1)[0].body) && /77 Nowhere Rd/.test(toAdmin().slice(-1)[0].body));
  // no address in the email at all
  r = await send('w', { body: 'Order W555555555. Samsung Refrigerator RF27T5201SR. Delivery date: Oct 22' });
  const dz = dels().find(x => x.Order_Number === 'W555555555');
  t('G no address: row created, flagged missing address + NEEDS PROPERTY', dz && dz.Property_ID === '' && /delivery_address/.test(dz.Delivery_Notes) && /NEEDS PROPERTY/.test(dz.Delivery_Notes), dz && dz.Delivery_Notes);
  // the address arrives later (a scheduled email carries it): the property is attached and the WO is created then, once
  r = await send('scheduled', { subject: 'Your delivery has been scheduled', body: 'Delivery date: Oct 22. Order W555555555. Deliver to: 5425 Belle Vista Ave, Baltimore, MD 21206' });
  const dz2 = dels().find(x => x.Order_Number === 'W555555555');
  t('G late address: property attached, WO created once on update', dz2.Property_ID === 'P1' && dz2.Linked_WO_IDs && r.json.wo_created === true && wos().filter(w => w.Property_ID === 'P1').length === 1, dz2);
  const r2 = await send('scheduled', { subject: 'Your delivery has been scheduled', body: 'Delivery date: Oct 23. Order W555555555. Deliver to: 5425 Belle Vista Ave, Baltimore, MD 21206' });
  t('G late address: a further update does not create a second WO', wos().filter(w => w.Property_ID === 'P1').length === 1 && r2.json.wo_created === false);
  // address in a later email names ANOTHER property: not changed, flagged
  const r3 = await send('scheduled', { subject: 'Your delivery has been scheduled', body: 'Delivery date: Oct 23. Order W555555555. Deliver to: 928 N Calvert St Apt 2, Baltimore, MD 21202' });
  t('G wrong-property guard: a different address in a later email does not re-link the delivery, Brett is warned', dels().find(x => x.Order_Number === 'W555555555').Property_ID === 'P1' && /CHECK/.test(r3.json.detail) && /Delivery problem/.test(toAdmin().slice(-1)[0].body), r3.json);
}

// ── E. unknown store email => parked, never an error, never dropped ──
{
  seed();
  const r = await send('unknown');
  t('E: success:true parked:true (not an error)', r.status === 200 && r.json.success === true && r.json.parked === true && r.json.kind === 'unknown', r.json);
  const d = dels();
  eq('E: a Needs Review row exists with the excerpt in the notes', [d.length, d[0].Status, d[0].Source, d[0].Order_Number], [1, 'Needs Review', 'email-watcher', 'H3456-789012']);
  t('E: notes carry subject + excerpt', /NEEDS REVIEW/.test(d[0].Delivery_Notes) && /Please contact us regarding your order/.test(d[0].Delivery_Notes), d[0].Delivery_Notes);
  eq('E: Brett alerted', [toAdmin().length, /NEEDS REVIEW/.test(toAdmin()[0].body), r.json.brett_sms_sent], [1, true, true]);
  eq('E: no WO, no tenant text, no calendar', [wos().length, toTenant().length, r.json.calendar.action], [0, 0, 'none']);
  const again = await call('POST', '/intake/delivery-email', INTAKE, { from: 'orders@homedepot.com', subject: FX.unknown.subject, body: FX.unknown.body, message_id: d[0].Message_ID, received_at: RECV });
  t('E: the same unknown email again is a duplicate, no second row or text', again.json.duplicate === true && dels().length === 1 && toAdmin().length === 1);
  // unknown for an order we already track: noted on that row, status untouched, Brett told
  seed(); await send('confirm'); const n0 = twilio.length;
  const u = await send({ subject: 'Important: your order H2345-678901', body: 'Please call us about your order and delivery.' });
  t('E: unknown email for a KNOWN order is appended to that row (no second row), status kept, Brett told', u.json.parked && dels().length === 1 && dels()[0].Status === 'Ordered' && /UNRECOGNISED EMAIL/.test(dels()[0].Delivery_Notes) && twilio.filter(x => x.to === ADMIN).length === 2 && twilio.length === n0 + 1, u.json);
  // a clear kind but nothing ties it to an order
  seed();
  const nn = await send({ subject: 'Your delivery is on its way', body: 'Your driver is on the way.' });
  t('E: a clear email with no order number and no open delivery to match is PARKED, not dropped', nn.json.parked === true && dels()[0].Status === 'Needs Review' && toAdmin().length === 1, nn.json);
  // no order number, but exactly one open delivery at that address: applied to it
  seed(); await send('confirm');
  const na = await send({ subject: 'Your delivery is on its way', body: 'Your driver is on the way to 5425 Belle Vista Ave, Baltimore, MD 21206.' });
  t('E: no order number but ONE open delivery at that address -> applied to it', na.json.updated === true && !na.json.parked && dels().length === 1 && dels()[0].Status === 'En-Route', na.json);
}

// ── I. dry run ──
{
  seed(); const before = snap();
  const r = await send('confirm', { dry_run: true });
  t('I: dry_run reports what it would do', r.json.success && r.json.dry_run === true && r.json.kind === 'order_confirmation' && r.json.created === true && r.json.property_id === 'P1' && r.json.tenant_id === 'T1' && r.json.reason === 'would_create', r.json);
  t('I: dry_run writes NOTHING (no tab, no row, no WO, no telemetry) and sends NOTHING', snap() === before && twilio.length === 0 && dels().length === 0);
  t('I: dry_run still returns the calendar it would create', r.json.calendar.action === 'create');
  const u = await send('unknown', { dry_run: true });
  t('I: dry_run on an unknown email: parked flagged, still nothing written', u.json.parked === true && snap() === before && twilio.length === 0);
  await send('confirm'); const b2 = snap(), tw = twilio.length;
  const w = await send('window', { dry_run: true });
  t('I: dry_run on an existing order: would_update, nothing written, nothing sent', w.json.updated === true && w.json.reason === 'would_update' && snap() === b2 && twilio.length === tw, w.json);
  const dupDry = await send('confirm', { message_id: dels()[0].Message_ID, dry_run: true });
  t('I: dry_run duplicate still just says duplicate', dupDry.json.duplicate === true && snap() === b2);
}

// ── J. Brett's text fails: success stays, row exists, flagged ──
{
  seed(); twilioMode = 'fail';
  const r = await send('confirm');
  t('J: SMS failure still 200 success with the delivery + WO written', r.status === 200 && r.json.success === true && r.json.created === true && dels().length === 1 && wos().length === 1, r.json);
  t('J: brett_sms_sent:false, status says why, needs_attention + warning', r.json.brett_sms_sent === false && /FAILED/.test(r.json.sms_status) && r.json.needs_attention === true && r.json.warnings.some(w => /Brett text not sent/.test(w)), r.json);
  t('J: telemetry row is a FAILURE (reaches Needs Attention)', rowsOf('Ops_Telemetry').some(x => x.Job_Type === 'delivery_email_intake' && x.Success === 'FALSE'), rowsOf('Ops_Telemetry').slice(-2));
  t('J: the row remembers the alert failed', /FAILED/.test(dels()[0].Brett_SMS_Status));
  seed({ config: { TWILIO_ENABLED: 'FALSE' } });
  const b = await send('confirm');
  t('J: the global text switch OFF is reported too (BLOCKED), record still written', b.json.brett_sms_sent === false && /BLOCKED/.test(b.json.sms_status) && dels().length === 1);
  seed({ config: { admin_phone: '' } });
  const np = await send('confirm');
  t('J: admin_phone missing is a loud warning, record still written', np.json.success && np.json.brett_sms_sent === false && np.json.warnings.some(w => /admin_phone/.test(w)) && dels().length === 1, np.json);
}

// ── K. tenant notice switch ──
{
  const run = async (cfg, t1, k, over) => { seed({ config: cfg, t1 }); return await send(k || 'confirm', over); };
  let r = await run({ Delivery_Tenant_Notice: 'off' });
  t('K: off -> nothing queued, nothing sent to the tenant', r.json.tenant_sms === 'off' && noticeRows().length === 0 && toTenant().length === 0, r.json);
  r = await run({ Delivery_Tenant_Notice: 'draft' });
  t('K: draft -> text saved on the delivery, nothing queued, nothing sent', r.json.tenant_sms === 'draft' && noticeRows().length === 0 && toTenant().length === 0 && /Your refrigerator has been ordered/.test(dels()[0].Tenant_Notice_Draft), r.json);
  r = await run({});
  t('K: default (blank) is AUTO', r.json.tenant_sms === 'queued' && noticeRows().length === 1);
  r = await run({ Delivery_Tenant_Notice: 'AUTO ' });
  t('K: value is case/space tolerant', r.json.tenant_sms === 'queued');
  r = await run({ Delivery_Tenant_Notice: 'sometimes' });
  t('K: an unknown value fails SAFE (no text) and says so', r.json.tenant_sms === 'off' && noticeRows().length === 0 && r.json.warnings.some(w => /unknown value/.test(w)) && r.json.needs_attention === true, r.json);
  // consent
  r = await run({}, { SMS_Enabled: 'FALSE' });
  t('K: tenant SMS switched off (no consent yet) -> skipped, nothing reaches the tenant', r.json.tenant_sms === 'skipped' && toTenant().length === 0 && noticeRows().every(x => x.Status === 'pending' && !x.Send_After) && /Tenant OFF/.test(r.json.tenant_sms_detail), [r.json, noticeRows()]);
  r = await run({}, { SMS_OptOut: 'TRUE' });
  t('K: tenant opted out (STOP) -> skipped', r.json.tenant_sms === 'skipped' && toTenant().length === 0 && /opted out/.test(r.json.tenant_sms_detail), r.json);
  r = await run({ TWILIO_ENABLED: 'FALSE' });
  t('K: global text switch off -> skipped for the tenant', r.json.tenant_sms === 'skipped' && toTenant().length === 0 && /Global OFF/.test(r.json.tenant_sms_detail), r.json);
  r = await run({}, { Move_Out_Date: '2026-09-30' });
  t('K: a tenant who has moved out is never texted (and is not attached to the delivery)', r.json.tenant_sms === 'skipped' && r.json.tenant_id === '' && toTenant().length === 0 && dels()[0].Onsite_Contact === 'me', r.json);
  r = await run({}, { Phone: '' });
  t('K: tenant without a phone -> skipped', r.json.tenant_sms === 'skipped' && /no phone/.test(r.json.tenant_sms_detail) && noticeRows().length === 0, r.json);
  // same-day delivery (date == today ET = 2026-10-14) is urgent: sent NOW through the gate
  r = await run({}, undefined, 'confirm', { body: FX.confirm.body.replace('Estimated Delivery: Fri, Oct 16', 'Estimated Delivery: Wed, Oct 14') });
  t('K: delivery TODAY -> sent immediately (no hold)', r.json.tenant_sms === 'sent' && toTenant().length === 1 && /scheduled for Wed 10\/14/.test(toTenant()[0].body) && noticeRows().length === 1 && noticeRows()[0].Status === 'sent', [r.json, toTenant()]);
  r = await run({ Delivery_Tenant_Notice: 'auto' }, { SMS_Enabled: 'FALSE' }, 'confirm', { body: FX.confirm.body.replace('Estimated Delivery: Fri, Oct 16', 'Estimated Delivery: Wed, Oct 14') });
  t('K: delivery TODAY but no consent -> still not sent', r.json.tenant_sms === 'skipped' && toTenant().length === 0);
  // first-touch STOP line only for a tenant never texted before
  seed(); const mqHead = (store.tabs.get('Message_Queue') || [[]])[0]; tab('Message_Queue', mqHead.length ? mqHead : ['ID', 'WO_ID', 'Message_Type', 'Recipient_Type', 'Recipient_Name', 'Recipient_Phone', 'Property_ID', 'Property_Address', 'Message_Body', 'Status', 'Delivered_To', 'Gate_Snapshot', 'Created_Date', 'Sent_Date', 'Twilio_Message_SID', 'Active', 'Send_After', 'Original_Body', 'Translated_To', 'Skip_If_Seen'], [{ ID: '1', Message_Type: 'tenant_welcome', Recipient_Type: 'tenant', Recipient_Phone: TENANT_PHONE, Status: 'sent', Active: 'TRUE' }]);
  r = await send('confirm');
  t('K: a tenant who already got a text does not get the STOP line again', r.json.tenant_sms === 'queued' && !/Reply STOP/.test(noticeRows()[0].Message_Body), noticeRows()[0] && noticeRows()[0].Message_Body);
  // re-send only when date/window change
  seed(); await send('confirm'); await send('scheduled');
  t('K: same date again (scheduled email, same Oct 16) -> NO second notice', noticeRows().length === 1 && noticeRows().every(x => x.Status === 'pending'), noticeRows().map(x => x.Status));
  await send('reschedule');
  t('K: date change -> new notice replaces the waiting one (still ONE pending)', noticeRows().filter(x => x.Status === 'pending').length === 1 && noticeRows().filter(x => x.Status === 'skipped').length === 1 && /Mon 10\/19/.test(noticeRows().find(x => x.Status === 'pending').Message_Body));
  await send('enroute'); await send('delivered');
  t('K: en route / delivered never text the tenant', noticeRows().length === 2);
  // draft mode leaves a draft per change, still no send
  // the release sweep: the held row is sent at 6pm by the existing sweep (re-checks the gate)
  seed(); await send('confirm');
  const rel = await withClock('2026-10-14T22:05:00Z', () => QH.processQuietHoursQueue(env));   // 6:05pm ET
  t('K: (existing release sweep) a due held notice is released to the tenant at 6pm ET', toTenant().length === 1 && noticeRows()[0].Status === 'sent' && rel.checked === 1, [rel, toTenant(), noticeRows().map(x => x.Status)]);
  seed(); await send('confirm');
  const early = await withClock('2026-10-14T21:30:00Z', () => QH.processQuietHoursQueue(env));   // 5:30pm ET: not due yet
  t('K: the sweep before 6pm leaves it held', early.checked === 0 && toTenant().length === 0 && noticeRows()[0].Status === 'pending');
  // released late (after 7pm) is pushed to 9am next day, not sent at night
  seed(); await send('confirm');
  await withClock('2026-10-14T23:40:00Z', () => QH.processQuietHoursQueue(env));   // 7:40pm ET
  t('K: a notice found due after 7pm ET is moved to 9am next day, not sent', toTenant().length === 0 && noticeRows()[0].Status === 'pending' && String(noticeRows()[0].Send_After).startsWith('2026-10-15T13:00:00') && new Date(noticeRows()[0].Send_After).getTime() - Date.parse('2026-10-15T13:00:00Z') < 1000, [noticeRows()[0].Status, noticeRows()[0].Send_After, noticeRows()[0].Gate_Snapshot, toTenant().length]);
  await withClock('2026-10-15T13:05:00Z', () => QH.processQuietHoursQueue(env));   // 9:05am next day
  t('K: ...and goes out at 9am the next day', toTenant().length === 1 && noticeRows()[0].Status === 'sent', noticeRows()[0]);
}

// ── stale (out-of-order) email ──
{
  seed(); await send('window', { received_at: '2026-10-14T16:00:00Z' });
  const t0 = twilio.length;
  const r = await send('scheduled', { received_at: '2026-10-14T12:00:00Z', body: FX.scheduled.body.replace('October 16', 'October 21') });
  t('stale: an email OLDER than the last applied one changes nothing and texts nothing', r.json.reason === 'stale_email' && dels()[0].Expected_Date === '2026-10-16' && dels()[0].Status === 'Window-Set' && twilio.length === t0 && r.json.calendar.action === 'none', r.json);
}

// ── concurrency: two mailboxes, same instant ──
{
  seed(); store.latency = () => Math.floor(Math.random() * 6);
  const mid = 'RACE-1';
  const [a, b] = await Promise.all([send('confirm', { message_id: mid }, 'info@bmoremanagement.com'), send('confirm', { message_id: mid }, 'brett@bmoremanagement.com')]);
  const active = dels().filter(d => d.Active !== 'FALSE');
  t('race: same email in both mailboxes at once -> exactly ONE active delivery', active.length === 1, dels());
  t('race: both calls succeeded; at most one WO; Brett texted once', a.json.success && b.json.success && wos().length <= 1 && toAdmin().length === 1, [a.json, b.json, wos().length, toAdmin().length]);
  seed(); store.latency = () => Math.floor(Math.random() * 6);
  const [c, d2] = await Promise.all([send('confirm'), send('scheduled')]);   // different emails, same order, same moment
  t('race: two different emails for one NEW order at once -> one active row', dels().filter(d => d.Active !== 'FALSE').length === 1, dels().map(x => [x.ID, x.Active, x.Order_Number]));
}

// ── failure paths are loud ──
{
  seed();
  store.failWhen = (m, p) => m === 'POST' && /Work_Orders:append/.test(p);
  const r = await send('confirm');
  t('loud: WO creation failing -> HTTP 500 success:false (the script retries + emails), delivery row kept, Brett texted', r.status === 500 && r.json.success === false && /work order failed/.test(r.json.error) && dels().length === 1 && toAdmin().length >= 1, r);
  store.failWhen = null;
  const retry = await send('confirm', { message_id: dels()[0].Message_ID });
  t('loud: the retry of the same email heals it: WO created, no second delivery', retry.status === 200 && retry.json.duplicate === true && retry.json.wo_created === true && wos().length === 1 && dels().length === 1 && dels()[0].Linked_WO_IDs === wos()[0].ID, retry.json);
  seed(); store.failWhen = (m, p) => /Deliveries/.test(p) && m === 'POST' && /append/.test(p);
  const f = await send('confirm');
  t('loud: a Deliveries write failure -> 500 success:false, an Error row + one alert for the message', f.status === 500 && f.json.success === false && rowsOf('Intake_Queue').some(q => q.Status === 'Error' && q.Source === 'Delivery email'), [f.status, f.json]);
  const alerts = toAdmin().length; await send('confirm', { message_id: f.json && 'x' }).catch(() => {});
  store.failWhen = null;
  seed(); store.failWhen = (m, p) => /Config/.test(p);
  const cf = await send('confirm');
  t('loud: an unreadable Config is a 500, not silently the default list', cf.status === 500 && cf.json.success === false && /Config/.test(cf.json.error) && twilio.length === 0, cf);
}

// ── N/O. source guards ──
{
  const hs = src.indexOf('// ═══ DELIVERY-EMAIL-HANDLER-START'), he = src.indexOf('// ═══ DELIVERY-EMAIL-HANDLER-END');
  const block = src.slice(pa, he);
  t('handler markers exist', hs > 0 && he > hs);
  t('no swallowing catch in the new code (every catch records or returns the failure)', !/catch\s*\(\s*\w*\s*\)\s*\{\s*(?:\/\/[^\n]*)?\s*\}/.test(block) && !/\.catch\(\s*\(\s*\)\s*=>\s*(?:\{\s*\}|null|undefined)\s*\)/.test(block));
  t('no cron / schedule introduced', !/\bcrons?\b|CronTrigger|\bschedule:/i.test(block.replace(/no cron/gi, '')));
  t('route is wired', /path === '\/intake\/delivery-email'\)\s+return await deliveryEmailIntake\(env, body\)/.test(src));
  t('token gate allows EXACTLY the two intake paths', /_intakeOk = !!env\.INTAKE_TOKEN\s+&& _tok === env\.INTAKE_TOKEN\s+&& request\.method === 'POST' && \(path === '\/intake\/email' \|\| path === '\/intake\/delivery-email'\);/.test(src));
  t('placeholders for later phases are marked', /PLACEHOLDER \(Phase 2 size check\)/.test(block) && /PLACEHOLDER \(Phase 4 voice routing\)/.test(block));
  t('the staging test token can reach the route only for TEST- message ids / properties', /path === '\/intake\/delivery-email'\) \{\s*const _mid[\s\S]{0,200}startsWith\('TEST-'\)/.test(src));
  t('the one patterns table is a single DEP object', (block.match(/^const DEP = \{/gm) || []).length === 1);
  t('BUILD_VERSION bumped', /const BUILD_VERSION = '2026-10-23\.03-delivery-email-watcher'/.test(src));
}

console.log(`\ndelivery-email-intake: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
