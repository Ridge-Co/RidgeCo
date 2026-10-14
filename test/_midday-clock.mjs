// Pins "now" to a weekday midday in New York so tests that exercise the SMS send path do not depend
// on the real time of day. The worker holds automatic texts before 9am ET and from 7pm ET
// (isQuietHoursNow); a test that asserts "the SMS was actually sent" fails whenever the suite runs
// inside those hours (it did, at 8:13am ET on Oct 14 2026). Time still ADVANCES from the pinned
// start, so ordering/elapsed-time logic behaves normally.
// Import this FIRST in any test that sends (or expects to send) a text:  import './_midday-clock.mjs';
// Quiet-hours behaviour itself is covered with explicit dates in the tests for those functions.
const RealDate = Date;
const PINNED_START = RealDate.UTC(2026, 9, 14, 15, 0, 0); // Wed Oct 14 2026 15:00Z = 11:00 ET
const realStart = RealDate.now();
const offset = PINNED_START - realStart;
class MiddayDate extends RealDate {
  constructor(...args) { if (args.length === 0) super(RealDate.now() + offset); else super(...args); }
  static now() { return RealDate.now() + offset; }
}
globalThis.Date = MiddayDate;
export const MIDDAY_PINNED_START = PINNED_START;
