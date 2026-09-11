// THE CHILDREN'S REGISTER SHOWS WHO IS STILL IN THE ROOM — asserted off the rendered console screen.
//   Run: node --test scripts/the-register-shows-who-is-in-the-room.test.mjs
//
// THE DEFECT. `DashCheckin` in app/stew-dashboard.jsx selected its register with
// `recs.filter(r => r.date === today)`. `r.date` is stamped ONCE, when the child is checked in; `today` is
// recomputed on every render. So a child checked in at 23:58 dropped off the desk's own register at 00:00 —
// while they were still in the room — taking their pickup code and their Check out button with them. A
// watchnight service or an overnight youth lock-in is the ordinary case. The same shape also meant the
// screen was a list of "checked in today" rather than of who is here.
//
// THE OWNER'S DECISION, 2026-09-11, asked as "should the register show *checked in today* or *still in the
// room*?": **still in the room** — *"that's what a worker at a door actually needs."*
//
// THE BOUND. Nothing ever arrives to say a session was abandoned, so "not yet checked out" alone would let a
// record sit on the register for ever. It ages out on the measure the PARENT's screen already uses for
// exactly this judgement — `MYKIDS_WINDOW` in src/fellowship.src.js is `MAX_SESSION_SECONDS`, and so is
// `Steward.checkinRegisterWindow()` — off the record's own `ts`, symmetric. One rule, two screens.
//
// HOW IT ASSERTS, AND WHY NOT BY GREP. CLAUDE.md rule 3: app/stew-dashboard.jsx ships UNBUNDLED, so `false &&`
// in front of a condition leaves every word of it in the file and any text-matching assertion still passes.
// So the REAL DashCheckin is sliced out by brace-match, compiled with the same esbuild the packaged build
// uses, rendered through the miniature React in scripts/render-jsx-screen.mjs, and every claim below is read
// off the RENDERED TREE or off what reached publishCheckin. Deleting the feature from the screen fails these.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fnBody } from './test-slice.mjs';
import { miniReact, texts, reads } from './render-jsx-screen.mjs';
import { MAX_SESSION_SECONDS } from './checkin-role-source.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const SRC = readFileSync(join(ROOT, 'app/stew-dashboard.jsx'), 'utf8');
const STEWARD_SRC = readFileSync(join(ROOT, 'src/steward.src.js'), 'utf8');

const KID = 'a'.repeat(64), KID2 = 'b'.repeat(64), MUM = 'c'.repeat(64);
const NOW = Math.floor(Date.now() / 1000);
const DAY = 86400;
// Local days, the way todayISO() and the record writer both compute them — never toISOString(), which is the
// 2026-07-24 kids-roll bug (a Sunday morning in Auckland stamped as Saturday).
const localISO = (secs) => { const d = new Date(secs * 1000); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const TODAY = localISO(NOW);
const YESTERDAY = localISO(NOW - DAY);

const Stub = (n) => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };

// ONE NODE, ONCE. find()/button() in render-jsx-screen.mjs walk both `kids` AND any prop that looks like a
// tree, so an element handed to a component as a PROP (Panel's `action`) and rendered as that component's
// child is reached twice. This walks the RENDERED tree only: what a leader can see.
function shown(n, pred, out = []) {
  if (!n || typeof n !== 'object') return out;
  if (Array.isArray(n)) { n.forEach(c => shown(c, pred, out)); return out; }
  if (pred(n)) out.push(n);
  (n.kids || []).forEach(c => shown(c, pred, out));
  return out;
}

// THE SHIPPED DashCheckin, compiled and rendered.
//
// `bundleWindow` is what `window.Steward.checkinRegisterWindow` returns; pass `null` to model a console whose
// bundle predates that function at all, which is the screen's fallback path.
async function desk({ recs = [], minors = [KID, KID2], guardians = {}, today = TODAY, bundleWindow = MAX_SESSION_SECONDS } = {}) {
  const src = fnBody(SRC, 'function DashCheckin() {', 'DashCheckin');
  const tmp = join(tmpdir(), 'ckroom-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, src + '\nexport { DashCheckin };\n');
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const { React, draw } = miniReact();
  const written = [];
  const Steward = {
    capKeyRing: () => ['ring'],
    subscribeCapKey: () => () => {},
    publishCheckin: (rec) => { written.push(rec); return Promise.resolve({ id: 'x' }); },
  };
  if (bundleWindow != null) Steward.checkinRegisterWindow = () => bundleWindow;
  const globals = {
    React,
    // A PASSTHROUGH, NOT A STUB: Panel is where the header action button lives.
    Panel: function Panel(p) { return React.createElement('div', { 'data-panel': p.title }, p.action, p.children); },
    DismissibleNote: function DismissibleNote(p) { return React.createElement('div', { 'data-note': p.id }, p.children); },
    Icon: Stub('Icon'),
    CheckinPicker: function CheckinPicker() { return null; },
    CheckoutModal: function CheckoutModal() { return null; },
    CheckinClearances: Stub('CheckinClearances'),
    CheckinSessionKeys: Stub('CheckinSessionKeys'),
    StewHelpLink: Stub('StewHelpLink'),
    useStewNarrow: () => false,
    todayISO: () => today,
    window: {
      useStewardCheckins: () => recs,
      useStewardSafeguard: () => ({ minors, minorsKnown: true }),
      useStewardGuardians: () => guardians,
      useStewardMembers: () => ([{ pubkey: KID, name: 'Alice Fenn' }, { pubkey: KID2, name: 'Bobby Okafor' },
                                { pubkey: MUM, name: 'Mum Fenn' }]),
      useStewardServices: () => [],
      useStewardIdv: () => 1,
      useStewardConn: () => 1,
      Steward,
      dispatchEvent: () => true,
    },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = (init || {}).detail; } },
    setTimeout, clearTimeout, console, Math, Date, JSON, Set, Number, String, Array, Promise, Object, isNaN,
  };
  const key = '__ckroom_' + Math.random().toString(36).slice(2);
  globalThis[key] = globals;
  const preamble = Object.keys(globals).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  const { DashCheckin } = await import('data:text/javascript;base64,' + Buffer.from(preamble + '\n' + js).toString('base64'));
  let tree = draw(DashCheckin, {});
  const redraw = () => { tree = draw(DashCheckin, {}); return tree; };
  const words = () => reads(tree).replace(/\s+/g, ' ');
  return {
    written, redraw, words, tree: () => tree,
    // THE SECTION HEADINGS ARE THE SCREEN'S OWN ANSWER to "who is in the room". Everything from "Checked in"
    // up to "Collected" is the live register; everything after "Collected" has gone home.
    checkedIn() { const w = this.words(); const a = w.indexOf('Checked in'); const b = w.indexOf('Collected'); assert.notEqual(a, -1, 're-anchor: no "Checked in" heading on the screen'); return b === -1 ? w.slice(a) : w.slice(a, b); },
    collected() { const w = this.words(); const b = w.indexOf('Collected'); return b === -1 ? '' : w.slice(b); },
    // The Check out button is the other half of "still in the room": a child nobody can release is not on a
    // register in any useful sense.
    checkoutButtons() { return shown(tree, n => n.type === 'button' && texts(n).join(' ').includes('Check out')); },
  };
}

// A record in the shape subscribeCheckins emits: `ts` is the event's created_at (set in steward.src.js beside
// the opened body), `date` is the writer's own local day, `out`/`manual` are folded on from a release.
const rec = (o) => ({ id: o.id, child: o.child || KID, childName: o.childName || 'Alice Fenn',
  date: o.date, ts: o.ts, in: o.in != null ? o.in : o.ts, code: o.code || '4182',
  ...(o.out != null ? { out: o.out } : {}), ...(o.manual != null ? { manual: o.manual } : {}) });

// ══════════════════════════ BASELINE ══════════════════════════

test('BASELINE: a child checked in this morning, today, is on the register with a code and a Check out', async () => {
  const d = await desk({ recs: [rec({ id: 'r1', date: TODAY, ts: NOW - 3600, code: '4182' })], guardians: { [KID]: [MUM] } });
  assert.match(d.checkedIn(), /Alice Fenn/, 'the ordinary Sunday case is broken: a child checked in an hour ago is not on the register');
  assert.match(d.checkedIn(), /4182/, 'the pickup code is not beside them');
  assert.equal(d.checkoutButtons().length, 1, 'no Check out button for a child who is in the room');
});

// ══════════════════════════ THE DEFECT ══════════════════════════

test('A CHILD CHECKED IN BEFORE MIDNIGHT IS STILL ON THE REGISTER AFTER IT', async () => {
  // 23:58 yesterday, read at 00:02 today. `date` says yesterday — it is stamped once and never moves — and
  // the child is still in the room.
  const d = await desk({ recs: [rec({ id: 'r1', date: YESTERDAY, ts: NOW - 240, code: '4182' })], guardians: { [KID]: [MUM] } });
  const live = d.checkedIn();
  assert.match(live, /Alice Fenn/,
    'THE MIDNIGHT HOLE IS BACK. A child checked in four minutes ago — with yesterday\'s date stamped on the ' +
    'record, which is what happens at 23:58 — is absent from the register of who is in the room. A ' +
    'watchnight service or an overnight lock-in loses the whole room at 00:00. As rendered: ' + live);
  assert.match(live, /4182/, 'the child is listed but their pickup code went with the day');
  assert.equal(d.checkoutButtons().length, 1,
    'the child is on the register with no way to release them — the desk cannot check out a child it is not ' +
    'showing a Check out button for');
});

test('…AND THE ROW SAYS WHICH DAY, so a worker is not misled by a bare time', async () => {
  // "In 11:58 PM" beside "In 9:15 AM" puts an overnight arrival and this morning's on one page with nothing
  // to tell them apart, and the older one reads as the later of the two.
  const overnight = await desk({ recs: [rec({ id: 'r1', date: YESTERDAY, ts: NOW - 240 })] });
  const sameDay = await desk({ recs: [rec({ id: 'r1', date: TODAY, ts: NOW - 240 })] });
  const a = overnight.checkedIn(), b = sameDay.checkedIn();
  assert.notEqual(a, b,
    'a row stamped with a DIFFERENT day than the viewer\'s renders identically to one stamped with today. ' +
    'Now that the register outlives a midnight, that is a bare time standing for two different days.');
  // What it adds must actually name the day: a day-of-month number and a written month/weekday, not decoration.
  const dom = String(new Date(YESTERDAY + 'T00:00').getDate());
  assert.ok(a.includes(dom), 'the extra text on an overnight row does not contain the day of the month (' + dom + '): ' + a);
  assert.match(a, /[A-Za-z]{3}/, 'the extra text on an overnight row names no day in words: ' + a);
  assert.doesNotMatch(b, /\b\d{4}-\d{2}-\d{2}\b/,
    'an ordinary same-day row grew a date on it — the marker must be silent on the ordinary Sunday');
});

// ══════════════════════════ THE BOUND ══════════════════════════

test('A RECORD OLDER THAN THE WINDOW LEAVES THE REGISTER, so an abandoned session is not a child in a room for ever', async () => {
  const stale = await desk({ recs: [rec({ id: 'r1', date: localISO(NOW - MAX_SESSION_SECONDS - 600), ts: NOW - MAX_SESSION_SECONDS - 600 })] });
  assert.doesNotMatch(stale.words(), /Alice Fenn/,
    'A CHECK-IN WITH NO RELEASE IS UNBOUNDED. Nothing ever arrives to say a session was abandoned, so a ' +
    'record older than MAX_SESSION_SECONDS that is still on the register would sit there for ever, saying a ' +
    'child is in a room three Sundays later.');
  assert.match(stale.words(), /Nobody is checked in/, 'with the stale record gone the screen must say the register is empty');
  const fresh = await desk({ recs: [rec({ id: 'r1', date: localISO(NOW - MAX_SESSION_SECONDS + 600), ts: NOW - MAX_SESSION_SECONDS + 600 })] });
  assert.match(fresh.checkedIn(), /Alice Fenn/,
    'a record INSIDE the window aged out: the desk now loses a child before the session that produced them ' +
    'can end, which is the 16-hour fault the parent\'s side was already corrected for');
});

test('THE WINDOW IS SYMMETRIC: a record stamped in the FUTURE ages out too', async () => {
  const near = await desk({ recs: [rec({ id: 'r1', date: TODAY, ts: NOW + 3600 })] });
  assert.match(near.checkedIn(), /Alice Fenn/, 'a record a clock-drifted hour in the future vanished from the register');
  const far = await desk({ recs: [rec({ id: 'r1', date: TODAY, ts: NOW + MAX_SESSION_SECONDS + 600 })] });
  assert.doesNotMatch(far.words(), /Alice Fenn/,
    'A FUTURE-STAMPED RECORD IS ON THE REGISTER FOR EVER. The window is one-sided, so the only thing between ' +
    'a forged `created_at` and a permanent row is nothing at all — the fault measured on the parent\'s side ' +
    'in 2026-09-11\'s audit, arriving at the desk.');
});

test('THE WINDOW COMES FROM THE BUNDLE, not from a figure this screen holds of its own', async () => {
  // A console whose bundle says two hours must age a three-hour-old record out. If the screen restated the
  // rule it would be free to disagree with the rest of the product about it — the mistake StewBackupModal is
  // commented for ("READ the floor, do not restate it").
  const d = await desk({ bundleWindow: 2 * 3600, recs: [
    rec({ id: 'r1', child: KID, childName: 'Alice Fenn', date: TODAY, ts: NOW - 3 * 3600 }),
    rec({ id: 'r2', child: KID2, childName: 'Bobby Okafor', date: TODAY, ts: NOW - 1 * 3600 }),
  ] });
  assert.match(d.checkedIn(), /Bobby Okafor/, 'the record inside the bundle\'s window is not on the register');
  assert.doesNotMatch(d.words(), /Alice Fenn/,
    'the screen ignored Steward.checkinRegisterWindow() and used a figure of its own');
});

test('…and with an OLDER bundle that cannot answer, the fallback is still MAX_SESSION_SECONDS', async () => {
  // The fallback exists because an EMPTY children's register is the worse of the two failures. It must not be
  // free to drift: these two boundaries are computed from MAX_SESSION_SECONDS itself, so changing that
  // constant without changing the screen fails here.
  const inside = await desk({ bundleWindow: null, recs: [rec({ id: 'r1', date: TODAY, ts: NOW - MAX_SESSION_SECONDS + 600 })] });
  assert.match(inside.checkedIn(), /Alice Fenn/, 'the fallback window is SHORTER than MAX_SESSION_SECONDS — it has drifted');
  const outside = await desk({ bundleWindow: null, recs: [rec({ id: 'r1', date: TODAY, ts: NOW - MAX_SESSION_SECONDS - 600 })] });
  assert.doesNotMatch(outside.words(), /Alice Fenn/, 'the fallback window is LONGER than MAX_SESSION_SECONDS — it has drifted');
});

test('the bundle\'s answer IS MAX_SESSION_SECONDS — run, not read', async () => {
  // Lifted and executed rather than matched, so a `return 26 * 3600` that merely LOOKS right cannot pass.
  const body = fnBody(STEWARD_SRC, '  checkinRegisterWindow()', 'Steward.checkinRegisterWindow');
  const got = new Function('MAX_SESSION_SECONDS', 'return ({ ' + body + ' }).checkinRegisterWindow();')(MAX_SESSION_SECONDS);
  assert.equal(got, MAX_SESSION_SECONDS,
    'Steward.checkinRegisterWindow() no longer returns MAX_SESSION_SECONDS, so the desk and the parent\'s ' +
    'screen have stopped agreeing about when one record stops being live');
});

// ══════════════════════════ WHAT MUST NOT HAVE CHANGED ══════════════════════════

test('A COLLECTED CHILD LEAVES THE LIVE REGISTER AND APPEARS UNDER COLLECTED, exactly as before', async () => {
  const d = await desk({ recs: [
    rec({ id: 'r1', child: KID, childName: 'Alice Fenn', date: TODAY, ts: NOW - 5400, in: NOW - 5400, out: NOW - 600, manual: false }),
    rec({ id: 'r2', child: KID2, childName: 'Bobby Okafor', date: TODAY, ts: NOW - 1800 }),
  ] });
  assert.doesNotMatch(d.checkedIn(), /Alice Fenn/,
    'A CHILD WHO HAS GONE HOME IS STILL LISTED AS IN THE ROOM. The release is folded upstream in ' +
    'subscribeCheckins onto the child\'s own row as `out`; the register\'s job is to stop showing them.');
  assert.match(d.collected(), /Alice Fenn/, 'the collected child has vanished from the screen entirely — the register is also the record of who was here');
  assert.match(d.checkedIn(), /Bobby Okafor/, 'the child who is still in the room fell off with the one who left');
  assert.equal(d.checkoutButtons().length, 1, 'a collected child is still being offered a Check out button');
});

test('A BY-HAND RELEASE IS STILL MARKED AS ONE, and an overnight collection says which day', async () => {
  const d = await desk({ recs: [
    rec({ id: 'r1', child: KID, childName: 'Alice Fenn', date: YESTERDAY, ts: NOW - 7200, in: NOW - 7200, out: NOW - 600, manual: true }),
  ] });
  assert.match(d.collected(), /by hand/i,
    'the manual-release trace was lost. DESIGN §7: "a manual release that leaves no different trace than a ' +
    'normal one is not a fallback, it is a hole."');
  const dom = String(new Date(YESTERDAY + 'T00:00').getDate());
  assert.ok(d.collected().includes(dom),
    'a collection of a child who arrived on a DIFFERENT day reads "In 11:58 PM · out 12:20 AM" with nothing ' +
    'to say the arrival was not today: ' + d.collected());
});

test('A CHILD ALREADY ON THE REGISTER IS NOT OFFERED FOR CHECK-IN AGAIN, across a midnight', async () => {
  const d = await desk({ recs: [rec({ id: 'r1', child: KID, date: YESTERDAY, ts: NOW - 240 })] });
  const before = shown(d.tree(), n => n.type && n.type.name === 'CheckinPicker');
  assert.equal(before.length, 0, 'the picker was open before anybody pressed anything');
  const open = shown(d.tree(), n => n.type === 'button' && texts(n).join(' ').includes('Check a child in'));
  assert.equal(open.length, 1, 're-anchor: the "Check a child in" button is gone');
  open[0].props.onClick();
  d.redraw();
  const p = shown(d.tree(), n => n.type && n.type.name === 'CheckinPicker');
  assert.equal(p.length, 1, 'pressing the button did not open the picker');
  assert.ok(Array.isArray(p[0].props.available), 're-anchor: the picker is no longer handed an `available` list');
  assert.ok(!p[0].props.available.includes(KID),
    'a child who is still in the room is offered for check-in again, so one press would put a second live ' +
    'row and a second pickup code on the register for one child');
  assert.ok(p[0].props.available.includes(KID2), 'a child who is NOT checked in has stopped being offered');
});

test('THE RECORD STILL CARRIES `date` — this screen stopped SELECTING on it, not writing it', async () => {
  const d = await desk({ guardians: { [KID]: [MUM] } });
  const open = shown(d.tree(), n => n.type === 'button' && texts(n).join(' ').includes('Check a child in'));
  open[0].props.onClick();
  d.redraw();
  const p = shown(d.tree(), n => n.type && n.type.name === 'CheckinPicker');
  await p[0].props.onPick(KID);
  assert.equal(d.written.length, 1, 'nothing was handed to publishCheckin');
  assert.equal(d.written[0].date, TODAY,
    'THE WRITER STOPPED STAMPING `date`. Other readers have it — it is the writer\'s own local day, which is ' +
    'the day the child actually walked in, and it is what the row now prints when that day is not the ' +
    'viewer\'s. Dropping it from the record is a data change this fix does not make.');
});
