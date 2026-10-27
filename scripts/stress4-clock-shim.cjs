// Preloaded into a gateway child (NODE_OPTIONS=--require) to give that one box a wrong clock:
// STRESS_CLOCK_SKEW_SEC seconds ahead (negative = behind). Date.now() and `new Date()` move; timers do not.
const skew = (parseInt(process.env.STRESS_CLOCK_SKEW_SEC || '0', 10) || 0) * 1000;
const RD = Date;
class SkewDate extends RD {
  constructor(...a) { if (a.length === 0) super(RD.now() + skew); else super(...a); }
  static now() { return RD.now() + skew; }
}
globalThis.Date = SkewDate;
