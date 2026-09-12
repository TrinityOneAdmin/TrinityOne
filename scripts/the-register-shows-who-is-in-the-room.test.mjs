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
// ⚠ THE BUNDLE, NOT THE SOURCE. Until 2026-09-12 this was src/steward.src.js, and the audit proved what
// that costs: breaking the fold in vendor/steward.js ALONE left this file at 37/0, while the same edit in
// src alone turned it red. vendor/ is what steward.html loads and what sync-web.sh copies into the APK, so a
// test that slices src is testing a file no phone runs — the `tests-must-drive-shipped-code` rule, which
// this repo keeps as a named memory for exactly this shape. scripts/vendor-freshness.test.mjs guards the two
// against each other, so slicing the bundle loses nothing and gains the artefact.
// (Precedent: scripts/checkin-key-separation.test.mjs has sliced VENDOR since it was written.)
const STEWARD_BUNDLE = readFileSync(join(ROOT, 'vendor/steward.js'), 'utf8');

const KID = 'a'.repeat(64), KID2 = 'b'.repeat(64), MUM = 'c'.repeat(64);
const NOW = Math.floor(Date.now() / 1000);
const DAY = 86400;
// Local days, the way todayISO() and the record writer both compute them — never toISOString(), which is the
// 2026-07-24 kids-roll bug (a Sunday morning in Auckland stamped as Saturday).
const localISO = (secs) => { const d = new Date(secs * 1000); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const TODAY = localISO(NOW);
const YESTERDAY = localISO(NOW - DAY);
// LAST NIGHT, DETERMINISTICALLY. `NOW - 20 * 3600` is yesterday only when the suite happens to run before
// 20:00, which would make the door test vacuous for four hours a day. Yesterday at 23:00 local is always
// yesterday's date and always between 1 and 25 hours ago, so it is always inside a 26-hour window.
const startOfToday = (() => { const d = new Date(NOW * 1000); d.setHours(0, 0, 0, 0); return Math.floor(d.getTime() / 1000); })();
const LAST_NIGHT = startOfToday - 3600;

const Stub = (n) => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };

// THE SHIPPED CheckinPicker, compiled from the same file by brace-match. It is what actually paints the
// "Already checked in · 11:58 PM" label, and a claim about that label read off anything else is rule 3.
let _pickerMod = null;
async function loadPicker(React) {
  const src = fnBody(SRC, 'function CheckinPicker(', 'CheckinPicker') + '\n' + fnBody(SRC, 'function CkModal(', 'CkModal');
  const tmp = join(tmpdir(), 'ckpick-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, src + '\nexport { CheckinPicker };\n');
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const key = '__ckpick_' + Math.random().toString(36).slice(2);
  globalThis[key] = { React, Icon: Stub('Icon'), useStewDialog: () => ({ current: null }), document: { addEventListener() {}, removeEventListener() {} } };
  const preamble = Object.keys(globalThis[key]).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  return await import('data:text/javascript;base64,' + Buffer.from(preamble + '\n' + js).toString('base64'));
}

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
// the opened body), `date` and `in` are the writer's own local day and clock, `out`/`manual` are folded on
// from a release.
//
// ⚠ `in` DEFAULTS TO `ts` HERE BECAUSE THAT IS WHAT A LIVE RECORD LOOKS LIKE — the console's checkIn stamps
// `in: Math.floor(Date.now()/1000)` and encPublish stamps `created_at: now()` on the SAME device
// microseconds apart. Pass `in` explicitly to model the one writer that separates them: migrateCheckinKeys.
const rec = (o) => ({ id: o.id, child: o.child || KID, childName: o.childName || 'Alice Fenn',
  date: o.date, ts: o.ts, in: o.in != null ? o.in : o.ts, code: o.code || '4182',
  ...(o.out != null ? { out: o.out } : {}), ...(o.manual != null ? { manual: o.manual } : {}) });

// THE SHIPPED subscribeCheckins, lifted out of vendor/steward.js and RUN. Returns what it emits, which is
// exactly what window.useStewardCheckins hands DashCheckin, so a test can drive the real pipeline rather
// than hand the screen a row the fold would never have produced.
function foldThrough(rows) {
  const body = fnBody(STEWARD_BUNDLE, 'subscribeCheckins(cb) {', 'subscribeCheckins');
  let got = null;
  const fakeWindow = { Steward: { encSubscribe: (_pfx, cb) => { cb(rows); return () => {}; } } };
  new Function('window', 'return ({ ' + body + ' });')(fakeWindow).subscribeCheckins((out) => { got = out; });
  assert.ok(Array.isArray(got), 're-anchor: the shipped subscribeCheckins emitted no array');
  return got;
}

// WHAT THE PICKER WOULD BE OFFERED — read off the real `available` prop, by pressing the real button.
async function offered(d) {
  // IT STARTS CLOSED. This assertion came off the test removed in ed1f40c and was not covered anywhere
  // else — a picker that is open before anybody pressed anything would make every claim below vacuous.
  assert.equal(shown(d.tree(), n => n.type && n.type.name === 'CheckinPicker').length, 0,
    'the picker was open before anybody pressed anything');
  const open = shown(d.tree(), n => n.type === 'button' && texts(n).join(' ').includes('Check a child in'));
  assert.equal(open.length, 1, 're-anchor: the "Check a child in" button is gone');
  open[0].props.onClick();
  d.redraw();
  const p = shown(d.tree(), n => n.type && n.type.name === 'CheckinPicker');
  assert.equal(p.length, 1, 'pressing the button did not open the picker');
  assert.ok(Array.isArray(p[0].props.available), 're-anchor: the picker is no longer handed an `available` list');
  return p[0].props.available;
}

// THE PICKER AS A LEADER READS IT — the REAL CheckinPicker, compiled and rendered, not its props. `desk()`
// stubs it so the other tests can read `available`; this renders the shipped one over the same props.
async function pickerWords(d) {
  const open = shown(d.tree(), n => n.type === 'button' && texts(n).join(' ').includes('Check a child in'));
  open[0].props.onClick();
  d.redraw();
  const p = shown(d.tree(), n => n.type && n.type.name === 'CheckinPicker')[0];
  const { React, draw } = miniReact();
  const mod = await loadPicker(React);
  const tree = draw(mod.CheckinPicker, p.props);
  return reads(tree).replace(/\s+/g, ' ');
}

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
  const body = fnBody(STEWARD_BUNDLE, 'checkinRegisterWindow()', 'Steward.checkinRegisterWindow');
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

// ⚠ A TEST WAS REMOVED HERE, deliberately, and this note is its account (CLAUDE.md rule 8).
// 'A CHILD ALREADY ON THE REGISTER IS NOT OFFERED FOR CHECK-IN AGAIN, across a midnight' asserted that a
// child with a live row from an EARLIER DAY is withheld from the picker. That is the blocker the audit
// found: a Saturday club nobody checked out then shuts the door on that child until 26 hours have passed,
// and reference/DOMAIN.md forbids exactly that. The half of it that was right — no second live code for one
// child in one session — survives as 'CONTROL: a child checked in TODAY is still not offered twice', and
// the half that was wrong is now asserted the other way round in the door section below.

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


// ══════════════════════ THE MIGRATION: `ts` IS NOT A PROXY FOR WHEN A CHILD ARRIVED ══════════════════════
//
// Steward.migrateCheckinKeys() re-publishes every legacy `trinityone/checkin:` record through encPublish,
// which stamps `created_at: now()`; encSubscribe then sets `ts = e.created_at`. It runs AUTOMATICALLY about
// 1.2s after this console mounts, once per church per session. So on the first open after an upgrade, every
// never-released record a pilot church ever wrote has a `ts` of this minute — and the old `r.date === today`
// filter was immune to that, because the migration preserves the sealed body.
//
// Preserving the original created_at instead is NOT available: the address is replaceable and
// scripts/event-store.mjs answers an equal-or-older timestamp with 'have-newer'. Verified before choosing.

test('A MIGRATED RECORD FROM THREE WEEKS AGO IS NOT A CHILD IN THE ROOM', async () => {
  const threeWeeks = NOW - 21 * DAY;
  const d = await desk({ recs: [
    rec({ id: 'ci-old-1', child: KID, childName: 'Alice Fenn', date: localISO(threeWeeks), ts: NOW - 5, in: threeWeeks }),
    rec({ id: 'ci-old-2', child: KID2, childName: 'Bobby Okafor', date: localISO(threeWeeks), ts: NOW - 5, in: threeWeeks }),
  ] });
  assert.doesNotMatch(d.words(), /Alice Fenn|Bobby Okafor/,
    'THE MIGRATION RESURRECTED A DEAD REGISTER. migrateCheckinKeys re-stamps created_at, so every ' +
    'never-released record a church ever wrote reads as an arrival this minute. As rendered: ' + d.words());
  assert.match(d.words(), /Nobody is checked in/, 'the desk does not say the register is empty');
});

test('…AND THE DOOR IS NOT SHUT BY ONE: both children are still offered', async () => {
  // This is the half that actually hurt. `available` came back EMPTY, so CheckinPicker rendered
  // "Everyone's already checked in." to a worker with real children in front of her.
  const threeWeeks = NOW - 21 * DAY;
  const d = await desk({ recs: [
    rec({ id: 'ci-old-1', child: KID, childName: 'Alice Fenn', date: localISO(threeWeeks), ts: NOW - 5, in: threeWeeks }),
    rec({ id: 'ci-old-2', child: KID2, childName: 'Bobby Okafor', date: localISO(threeWeeks), ts: NOW - 5, in: threeWeeks }),
  ] });
  const av = await offered(d);
  assert.deepEqual([...av].sort(), [KID, KID2].sort(),
    'a worker at the door was offered ' + av.length + ' of 2 children after the migration ran');
  assert.doesNotMatch(d.words(), /Everyone.s already checked in/,
    'the picker told a worker with children in front of her that everyone was already checked in');
});

test('THE `in` BOUND CAN ONLY REMOVE A ROW, NEVER RESURRECT ONE', async () => {
  // The conjunction is what makes reading a helper-written field safe. A record whose `ts` is outside the
  // window stays gone however friendly its body is — otherwise a forged `in` would be a way of PUTTING a row
  // on a safeguarding register, which is strictly worse than the fault it was added to fix.
  const d = await desk({ recs: [rec({ id: 'r1', date: TODAY, ts: NOW - MAX_SESSION_SECONDS - 600, in: NOW - 60 })] });
  assert.doesNotMatch(d.words(), /Alice Fenn/,
    'a record OUTSIDE the ts window was pulled back onto the register by its own sealed body — the `in` ' +
    'bound has become a disjunction, and a helper can now add rows by writing a friendly `in`');
});

test('a FORGED FUTURE `in` removes the row rather than pinning it for ever', async () => {
  const d = await desk({ recs: [rec({ id: 'r1', date: TODAY, ts: NOW - 60, in: NOW + 400 * DAY })] });
  assert.doesNotMatch(d.words(), /Alice Fenn/,
    'a body claiming the child arrived in 400 days is on the register. On the parent\'s side this exact ' +
    'shape sat on screen at +0, +30, +200 and +399 days.');
});

test('a non-numeric `in` bounds nothing — AND IS NOT PAINTED EITHER', async () => {
  // `in` is untyped sealed-body content. Anything that is not a finite number is not a bound, and removing a
  // row on the strength of one would hide a live child because a body was malformed.
  //
  // ⚠ AND THEN THE ROW MUST NOT PRINT IT. The first version of this test drove exactly these values through
  // the rendered screen and asserted only that the child's name was there, walking past five "In Invalid
  // Date" rows and four "In 1:00 AM" ones — 1 January 1970 — which is the "confidently wrong value beside a
  // child's name" fmtDay is commented at length about, one symbol away in the same function.
  //
  // NaN IS IN THIS LIST ON PURPOSE: `typeof NaN === 'number'`, so a `typeof` gate would let it through and
  // `Math.abs(at - NaN) <= w` is false, which DELETES a live child from the register.
  for (const bad of ['1789084514', { at: 1 }, null, undefined, NaN, true, [], Infinity, 'abc', false]) {
    const d = await desk({ recs: [{ id: 'r1', child: KID, childName: 'Alice Fenn', date: TODAY, ts: NOW - 600, in: bad, code: '4182' }] });
    assert.match(d.checkedIn(), /Alice Fenn/,
      'a child in the room was hidden because `in` was ' + JSON.stringify(bad) + ' rather than a number');
    assert.doesNotMatch(d.words(), /Invalid Date/,
      'the row painted "Invalid Date" as the arrival time for `in` = ' + JSON.stringify(bad));
    assert.doesNotMatch(d.words(), /In 1:00 AM|In 12:00 AM|1970/,
      'the row painted 1 January 1970 as the arrival time for `in` = ' + JSON.stringify(bad) + ': ' + d.checkedIn());
    assert.doesNotMatch(d.checkedIn(), /\bIn\b\s*·/,
      'the row printed a dangling "In ·" with no time after it for `in` = ' + JSON.stringify(bad));
    assert.match(d.checkedIn(), /no adult guardian linked/,
      'the pickup clause — the one a leader reads a name off — was displaced by the unusable time');
  }
});

test('…and the same for `out` on a collected row', async () => {
  // `out` has the identical shape, and ANY truthy `out` moves the child into Collected.
  for (const bad of [true, [], 'abc', Infinity, { t: 1 }]) {
    const d = await desk({ recs: [{ id: 'r1', child: KID, childName: 'Alice Fenn', date: TODAY, ts: NOW - 600, in: NOW - 600, out: bad, code: '4182' }] });
    assert.match(d.words(), /Alice Fenn/, 'the child vanished entirely for `out` = ' + JSON.stringify(bad));
    assert.doesNotMatch(d.words(), /Invalid Date/, 'the collected row painted "Invalid Date" as the collection time for `out` = ' + JSON.stringify(bad));
    assert.doesNotMatch(d.words(), /1:00 AM|1970/, 'the collected row painted 1 January 1970 as the collection time for `out` = ' + JSON.stringify(bad));
    assert.doesNotMatch(d.words(), /out\s*·/, 'the collected row printed a dangling "out ·" for `out` = ' + JSON.stringify(bad));
  }
});

// ══════════════════════ THE DOOR IS NEVER BLOCKED ══════════════════════════════════════════════════════
//
// reference/DOMAIN.md: "Do not block. A ratio outside policy, a helper whose clearance has lapsed, a rota
// with a gap — none of these may stop a child being checked in. Blocking at the door harms the child in the
// room to satisfy a rule in a database."

test('A FORGOTTEN CHECK-OUT DOES NOT STOP THAT CHILD BEING CHECKED IN THE NEXT MORNING', async () => {
  // Saturday youth club, nobody pressed Check out. Sunday 09:30, inside the 26h window, the register still
  // shows her. She must STILL be offerable, with no action required of the worker and nothing invented.
  const sat = LAST_NIGHT;
  assert.notEqual(localISO(sat), TODAY, 'fixture: LAST_NIGHT is not a previous day, so this test asserts nothing');
  const d = await desk({ recs: [rec({ id: 'r1', child: KID, childName: 'Alice Fenn', date: localISO(sat), ts: sat, in: sat, code: '4182' })] });
  assert.match(d.checkedIn(), /Alice Fenn/, 'fixture: the overnight row is not on the register at all, so this test is about nothing');
  const av = await offered(d);
  assert.ok(av.includes(KID),
    'THE DESK IS SHUT. A child whose Saturday check-out nobody pressed cannot be checked in on Sunday ' +
    'morning, and the only way through is CheckoutModal — which requires yesterday\'s code and then records ' +
    'that she was collected this morning, a collection that never happened.');
  assert.doesNotMatch(d.words(), /Everyone.s already checked in/, 'the picker refused a worker at the door');
});

test('CONTROL: a child checked in TODAY is still not offered twice', async () => {
  // The exclusion is not deleted, only scoped. Two live rows for one child means two pickup codes on one
  // register, which is the accident it was written to prevent.
  const d = await desk({ recs: [rec({ id: 'r1', child: KID, childName: 'Alice Fenn', date: TODAY, ts: NOW - 600 })] });
  const av = await offered(d);
  assert.ok(!av.includes(KID), 'a child already checked in TODAY is offered again — one press puts a second live code on the register');
  assert.ok(av.includes(KID2), 'a child who is not checked in has stopped being offered');
});

test('a live row with NO usable day is offerable — where the two readings disagree, the door wins', async () => {
  const d = await desk({ recs: [{ id: 'r1', child: KID, childName: 'Alice Fenn', ts: NOW - 600, in: NOW - 600, code: '4182' }] });
  const av = await offered(d);
  assert.ok(av.includes(KID), 'a record carrying no day at all shut the door on that child');
});

// ══════════════════════ A MALFORMED DAY SAYS NOTHING RATHER THAN SOMETHING FALSE ════════════════════════

test('A MALFORMED `date` PAINTS NO DAY MARKER — never "Invalid Date", and never a WRONG day', async () => {
  // `new Date('x' + 'T00:00')` does not throw; it returns an Invalid Date whose toLocaleDateString RETURNS
  // the string "Invalid Date", so a try/catch never fires and the screen printed it beside a child's name.
  //
  // ⚠ '2026-02-30' IS THE ONE THAT MATTERS MOST and is why a shape check alone is not the fix: it is
  // well-formed, it PARSES, and JavaScript rolls it over to 2 March. A confidently wrong day beside a
  // child's name is worse than no day, because a worker at a door cannot tell it is wrong.
  //
  // ASSERTED AS "IDENTICAL TO A TODAY ROW", which is locale-free and is the whole claim: no marker at all.
  const plain = await desk({ recs: [{ id: 'r1', child: KID, childName: 'Alice Fenn', date: TODAY, ts: NOW - 600, in: NOW - 600, code: '4182' }] });
  // ⚠ 'NaN-NaN-NaN' IS THE ONE THAT CAUGHT ME OUT, and it is why the isFinite read-back is back in fmtDay.
  // 'NaN-NaN-NaNT00:00' parses to an Invalid Date, every getter is NaN, so the round-trip writes back the
  // literal string 'NaN-NaN-NaN' — which EQUALS the input. The round-trip PASSES and toLocaleDateString
  // returns its own name. ed1f40c deleted the read-back on the claim that the round-trip subsumed it, and
  // the sabotage row that "could not make it bite" was mis-aimed because this list did not contain it.
  for (const bad of ['not-a-date', '2026-13-45', '13/09/2026', '', '2026-09-13T10:00:00Z', '2026-02-30', '2026-9-3', 'NaN-NaN-NaN', 42, null, undefined, { d: 1 }]) {
    const d = await desk({ recs: [{ id: 'r1', child: KID, childName: 'Alice Fenn', date: bad, ts: NOW - 600, in: NOW - 600, code: '4182' }] });
    assert.doesNotMatch(d.words(), /Invalid Date/,
      'the register painted "Invalid Date" beside a child\'s name for date ' + JSON.stringify(bad));
    assert.equal(d.checkedIn(), plain.checkedIn(),
      'a malformed date ' + JSON.stringify(bad) + ' put SOMETHING on the row where a today-stamped record ' +
      'puts nothing. For 2026-02-30 that something was "Mon, Mar 2" — a day the record does not claim and ' +
      'the worker cannot check. As rendered: ' + d.checkedIn());
  }
});

test('CONTROL: a WELL-FORMED previous day still paints its marker', async () => {
  const d = await desk({ recs: [rec({ id: 'r1', date: YESTERDAY, ts: NOW - 240 })] });
  const dom = String(new Date(YESTERDAY + 'T00:00').getDate());
  assert.ok(d.checkedIn().includes(dom), 'the day marker has gone altogether — the typing above threw out the good case with the bad');
});


// ══════════════════════ A COLLECTION AGES FROM THE COLLECTION, NOT FROM THE ARRIVAL ═════════════════════
//
// subscribeCheckins: "The collected child KEEPS their row — a register that erased them would stop being a
// record of who was in the room." ed1f40c bounded collected rows on `in`, so a lock-in that ran past 26
// hours lost its Collected row minutes after the child actually left.

test('A LOCK-IN COLLECTED AT 25.5 HOURS STAYS ON THE COLLECTED LIST — console checkout', async () => {
  // A console checkout REWRITES the record, so `ts` becomes the collection and `in` stays the arrival.
  // ⚠ THE ARRIVAL MUST BE OUTSIDE THE WINDOW AND THE COLLECTION INSIDE IT, or this test passes against the
  // arrival-bounded code it exists to refute. A 25.5-hour lock-in seen an hour after it ended is exactly
  // that: the child left 60 minutes ago and arrived 26.5 hours ago.
  const arrived = NOW - 26 * 3600 - 1800;       // 26.5h ago — past the window on its own
  const collected = NOW - 60 * 60;              // an hour ago — well inside it
  const d = await desk({ recs: [{ id: 'r1', child: KID, childName: 'Alice Fenn', date: localISO(arrived),
    ts: collected, in: arrived, out: collected, code: '4182' }] });
  assert.match(d.collected(), /Alice Fenn/,
    'A CHILD COLLECTED FORTY MINUTES AGO IS ON NEITHER LIST. She left a lock-in at 19:30 and by 20:10 the ' +
    'safeguarding lead can see neither that she was in the room nor that she was collected. As rendered: ' + d.words());
  assert.doesNotMatch(d.checkedIn(), /Alice Fenn/, 'a collected child is back on the live register');
});

test('…AND THE SAME WHEN A WORKER RELEASED HER — the release document carries its own clock', async () => {
  // A WORKER's release is a separate document folded on by subscribeCheckins, so the row's own `ts` stays
  // the ARRIVAL and only `releasedTs` knows when she left. Without it carried through the fold, the primary
  // bound kills this row 26h after she arrived, whatever the body says.
  const arrived = NOW - 26 * 3600 - 1800;       // 26.5h ago — beyond the window on its own
  const collected = NOW - 40 * 60;
  const d = await desk({ recs: [{ id: 'r1', child: KID, childName: 'Alice Fenn', date: localISO(arrived),
    ts: arrived, releasedTs: collected, in: arrived, out: collected, manual: true, code: '4182' }] });
  assert.match(d.collected(), /Alice Fenn/,
    'A WORKER-RELEASED COLLECTION VANISHED. The row\'s own created_at is the arrival on that path, so only ' +
    'the release document knows when the child left — and the register aged her out on the wrong clock.');
  assert.match(d.collected(), /by hand/i, 're-anchor: the manual trace went with it');
});

test('…and a collection that is itself past the window DOES age out', async () => {
  const arrived = NOW - 60 * 3600;
  const collected = NOW - 30 * 3600;            // beyond 26h
  const d = await desk({ recs: [{ id: 'r1', child: KID, childName: 'Alice Fenn', date: localISO(arrived),
    ts: collected, in: arrived, out: collected, code: '4182' }] });
  assert.doesNotMatch(d.words(), /Alice Fenn/,
    're-anchor: collected rows no longer age out at all, so the Collected list is unbounded');
});

test('a MIGRATED collected record does not come back either', async () => {
  // The migration re-stamps a release document too, so `ts` and `releasedTs` are both this minute. The body
  // clock — `out` for a collected row — is what still refuses it.
  const threeWeeks = NOW - 21 * DAY;
  const d = await desk({ recs: [{ id: 'r1', child: KID, childName: 'Alice Fenn', date: localISO(threeWeeks),
    ts: NOW - 5, releasedTs: NOW - 5, in: threeWeeks, out: threeWeeks + 7200, code: '4182' }] });
  assert.doesNotMatch(d.words(), /Alice Fenn/,
    'a three-week-old COLLECTED record came back onto the Collected list because the migration re-stamped it');
});

// ══════════════════════ OFFERED, AND SAID SO ════════════════════════════════════════════════════════════

test('A CHILD ALREADY ON THE REGISTER IS OFFERED — AND THE PICKER SAYS SHE IS ALREADY IN', async () => {
  // Watchnight: children in at 23:30-23:58, and at 00:05 the leader opens the picker for a latecomer.
  // Nothing may stop her being checked in (DOMAIN.md), but the screen must not hide that she is on the
  // register — one silent mis-tap gives one child two live rows, two codes and two Check out buttons.
  const d = await desk({ recs: [rec({ id: 'r1', child: KID, childName: 'Alice Fenn', date: YESTERDAY, ts: NOW - 600 })] });
  const av = await offered(d);
  assert.ok(av.includes(KID), 're-anchor: the door is shut again — that is the blocker, not this test');
  const words = await pickerWords(d);
  assert.match(words, /Already checked in/,
    'THE PICKER IS SILENT ABOUT A CHILD IT IS OFFERING WHO IS ALREADY IN THE ROOM. Non-blocking is not the ' +
    'same as non-telling. As rendered: ' + words);
  // …and it says WHEN, because "already" without a time is not something a leader can act on
  assert.match(words.slice(words.indexOf('Already checked in')), /\d/,
    'the picker says a child is already checked in but not when: ' + words.slice(words.indexOf('Already checked in'), 120));
});

test('CONTROL: a child who is NOT on the register carries no such label', async () => {
  const d = await desk({ recs: [] });
  const words = await pickerWords(d);
  assert.doesNotMatch(words, /Already checked in/,
    'every child is labelled as already checked in, so the label says nothing');
  assert.match(words, /Alice Fenn/, 're-anchor: the picker lists nobody at all');
});


// ══════════════════════ "CHECKED IN · N" IS A HEADCOUNT ═════════════════════════════════════════════════

test('TWO LIVE ROWS FOR ONE CHILD COUNT AS ONE CHILD, and both rows stay on the list', async () => {
  // The ordinary consequence of the picker no longer shutting the door: a forgotten check-out from an
  // earlier day, plus today's. A leader counting heads in the room against "Checked in · 2" would be
  // counting against a figure the software made up.
  const d = await desk({ recs: [
    rec({ id: 'r1', child: KID, childName: 'Alice Fenn', date: YESTERDAY, ts: NOW - 20 * 3600, code: '4182' }),
    rec({ id: 'r2', child: KID, childName: 'Alice Fenn', date: TODAY, ts: NOW - 600, code: '9079' }),
  ] });
  assert.match(d.checkedIn(), /Checked in · 1\b/,
    'the register counted ROWS, not children: one child with a stale row and a live one reads as two ' +
    'children in the room. As rendered: ' + d.checkedIn());
  // …and nothing is hidden to make the number work
  assert.match(d.checkedIn(), /4182/, 'the stale row was deleted to make the count tidy — it is a real record');
  assert.match(d.checkedIn(), /9079/, "today's row is missing");
});

test('CONTROL: two DIFFERENT children still count as two', async () => {
  const d = await desk({ recs: [
    rec({ id: 'r1', child: KID, childName: 'Alice Fenn', date: TODAY, ts: NOW - 600 }),
    rec({ id: 'r2', child: KID2, childName: 'Bobby Okafor', date: TODAY, ts: NOW - 900 }),
  ] });
  assert.match(d.checkedIn(), /Checked in · 2\b/, 'the headcount collapses different children — it is deduping on the wrong thing');
});

test('COLLECTED counts records, not children — a second collection is a second safeguarding record', async () => {
  const d = await desk({ recs: [
    rec({ id: 'r1', child: KID, childName: 'Alice Fenn', date: TODAY, ts: NOW - 7200, in: NOW - 7200, out: NOW - 5400 }),
    rec({ id: 'r2', child: KID, childName: 'Alice Fenn', date: TODAY, ts: NOW - 1800, in: NOW - 3600, out: NOW - 1800 }),
  ] });
  assert.match(d.collected(), /Collected · 2\b/,
    'two real collections of one child — a morning session and an evening one — were reported as one. ' +
    'That list is a log of collections, not a count of people anywhere.');
});


// ══════════════════ A FALSY `out` IS NOT A COLLECTION — ONE QUESTION, ONE ANSWER ════════════════════════
//
// `present` splits the list on truthiness (`!r.out`). The body-clock selector asked with `!= null`, and on
// `out: 0` the two disagreed: the selector called the row collected and handed back 0 — a finite number
// fifty-six years outside the window — so the row was dropped from the register entirely while `present`
// still called it live. Number.isFinite cannot catch it, because 0 IS finite.

test('A CHILD WITH `out: 0` IS STILL IN THE ROOM — the two predicates must ask one question', async () => {
  const d = await desk({ recs: [{ id: 'r1', child: KID, childName: 'Alice Fenn', date: TODAY,
    ts: NOW - 600, in: NOW - 600, out: 0, code: '4182' }] });
  assert.match(d.checkedIn(), /Alice Fenn/,
    'THE SCREEN READ "Checked in · 0 · Nobody is checked in" WITH THE CHILD IN THE ROOM. The row is not ' +
    'collected — `present` says so — but the body-clock selector called it collected, took 0 as the ' +
    'collection instant, and aged the row out fifty-six years. As rendered: ' + d.words());
  assert.match(d.checkedIn(), /4182/, 'her pickup code went with her');
  assert.match(d.checkedIn(), /Checked in · 1\b/, 'the headcount does not include her');
  assert.doesNotMatch(d.collected(), /Alice Fenn/, 'a falsy `out` moved her to Collected');
});

test('…and the milder falsy mirrors keep her too', async () => {
  // These switch the body bound OFF rather than inverting it, so they can only ever KEEP a row. Asserted so
  // that a future "tidy-up" back to `!= null` fails on all of them at once rather than only on 0.
  for (const bad of [false, '', NaN, 0]) {
    const d = await desk({ recs: [{ id: 'r1', child: KID, childName: 'Alice Fenn', date: TODAY,
      ts: NOW - 600, in: NOW - 600, out: bad, code: '4182' }] });
    assert.match(d.checkedIn(), /Alice Fenn/, 'a child in the room vanished for `out` = ' + JSON.stringify(bad));
    assert.doesNotMatch(d.collected(), /Alice Fenn/, 'a falsy `out` = ' + JSON.stringify(bad) + ' reported her as collected');
  }
});

// ══════════════════ A COLLECTION WE CANNOT READ THE TIME OF SAYS SO ════════════════════════════════════

test('A COLLECTED ROW WITH NO READABLE TIME SAYS SO RATHER THAN GOING QUIET', async () => {
  // Typing fmtT traded a LOUD wrong answer ("out Invalid Date") for silence, and on the permanent record of
  // a child leaving, silence is harder for a safeguarding lead to notice than an obvious error.
  for (const bad of [true, [], 'abc', Infinity, { t: 1 }]) {
    const d = await desk({ recs: [{ id: 'r1', child: KID, childName: 'Alice Fenn', date: TODAY,
      ts: NOW - 600, in: NOW - 600, out: bad, code: '4182' }] });
    assert.match(d.collected(), /Alice Fenn/, 'the collected child vanished for `out` = ' + JSON.stringify(bad));
    assert.match(d.collected(), /out — time not recorded/,
      'a Collected row with an unreadable collection time said NOTHING about it for `out` = ' +
      JSON.stringify(bad) + ': ' + d.collected());
    assert.doesNotMatch(d.collected(), /Invalid Date|1970/, 'and it must still not paint a wrong one');
  }
});

test('…AND THE SAME FOR AN UNREADABLE ARRIVAL ON A COLLECTED ROW', async () => {
  // The gap the first version of this missed: "Collected · 1 Alice Fenn out 8:02 AM" with NO arrival time
  // at all is the same hole in the same permanent record, by the same argument.
  for (const bad of [undefined, NaN, 'abc', {}, Infinity]) {
    const d = await desk({ recs: [{ id: 'r1', child: KID, childName: 'Alice Fenn', date: TODAY,
      ts: NOW - 600, in: bad, out: NOW - 600, code: '4182' }] });
    assert.match(d.collected(), /Alice Fenn/, 'the collected child vanished for `in` = ' + JSON.stringify(bad));
    assert.match(d.collected(), /in — time not recorded/,
      'a Collected row said nothing about an arrival time it could not read, for `in` = ' +
      JSON.stringify(bad) + ': ' + d.collected());
    assert.doesNotMatch(d.collected(), /Invalid Date|1970/, 'and it must still not paint a wrong one');
  }
});

test('CONTROL: an ordinary collected row carries neither apology', async () => {
  const d = await desk({ recs: [rec({ id: 'r1', date: TODAY, ts: NOW - 600, in: NOW - 3600, out: NOW - 600 })] });
  assert.doesNotMatch(d.collected(), /time not recorded/, 'every collected row now carries an apology, so it says nothing');
});

test('CONTROL: an ordinary collection says the time and not the apology', async () => {
  const d = await desk({ recs: [rec({ id: 'r1', date: TODAY, ts: NOW - 600, in: NOW - 3600, out: NOW - 600 })] });
  assert.doesNotMatch(d.collected(), /time not recorded/, 'every collection now carries the apology, so it says nothing');
  assert.match(d.collected(), /out \d/, 're-anchor: an ordinary collection no longer prints its time');
});

// ══════════════════ `releasedTs` IS ATTESTED, NOT CLAIMED ══════════════════════════════════════════════

test('A `releasedTs` IN THE SEALED BODY CANNOT EXTEND A ROW — the fold and the screen, end to end', async () => {
  // ⚠ REWRITTEN 2026-09-12. The previous version of this test handed `desk()` a row DIRECTLY, so
  // subscribeCheckins was never called and nothing in it could be observed: what actually removed the row
  // was its three-week-old `in`, and breaking the fold left this green. Worse, the same row with `in` simply
  // ABSENT rendered the record as a child in the room, carried by a body-claimed `releasedTs`.
  //
  // So this now runs the SHIPPED fold over the hostile row and hands ITS OUTPUT to the screen — which is the
  // only arrangement in which the claim "a body `releasedTs` cannot extend a row" means anything.
  //
  // `in` IS DELIBERATELY ABSENT. With it present the `in` upper bound removes the row on its own and this
  // test proves nothing about `releasedTs`; without it, `lastTouch` is the only thing standing between a
  // body-claimed release time and a three-week-old record painted as live.
  const hostile = { id: 'r1', child: KID, childName: 'Alice Fenn', date: localISO(NOW - 21 * DAY),
    ts: NOW - 21 * DAY, releasedTs: NOW - 5, code: '4182' };

  // CONTROL, and it is the row that makes the claim falsifiable: straight to the screen, the body's
  // `releasedTs` IS believed, because the screen's contract is that its rows came through the fold.
  const unfolded = await desk({ recs: [hostile] });
  assert.match(unfolded.checkedIn(), /Alice Fenn/,
    're-anchor: the screen no longer trusts `releasedTs` at all, so the fold is not what protects it and ' +
    'this test is about the wrong thing');

  // …and through the shipped fold, which is how a row actually reaches it.
  const folded = await foldThrough([hostile]);
  assert.equal(folded.length, 1, 're-anchor: the fold no longer emits this row at all');
  const d = await desk({ recs: folded });
  assert.doesNotMatch(d.words(), /Alice Fenn/,
    'A THREE-WEEK-OLD RECORD WAS RENDERED AS A CHILD IN THE ROOM because its own sealed body claimed a ' +
    'release five seconds ago. The fold must overwrite `releasedTs` on every row, not only on released ' +
    'ones. As rendered: ' + d.words());
});

test('the BUNDLE strips a body `releasedTs` off a row with no release — run, not read', async () => {
  // Lifted and executed, so a comment promising this cannot pass for the code doing it.
  const rows = [
    { id: 'a', child: KID, ts: 100, releasedTs: 999999 },                       // no release, body lies
    { id: 'b', child: KID2, ts: 200, _sid: 's1' },                              // no release, no claim
    { id: 'rel1', _rel: 'c', _sid: 's1', ts: 555, out: 550, manual: true },     // a real release for 'c'
    { id: 'c', child: KID, ts: 300, _sid: 's1' },                               // the child it releases
  ];
  const got = foldThrough(rows);
  assert.ok(got.length === 3, 're-anchor: the fold no longer emits one row per child (' + JSON.stringify(got) + ')');
  const a = got.find(r => r.id === 'a');
  assert.equal(a.releasedTs, null,
    'A BODY-CARRIED `releasedTs` SURVIVED THE FOLD on a row with no release, so the register would age that ' +
    'row on a number the sealed body chose. Got: ' + JSON.stringify(a.releasedTs));
  const c = got.find(r => r.id === 'c');
  assert.equal(c.releasedTs, 555, "a genuinely released row lost the release document's own created_at");
  assert.equal(c.out, 550, 're-anchor: the release no longer folds `out` on');
  assert.equal(c.manual, true, 're-anchor: the release no longer folds `manual` on');
});


// ══════════════ A RELEASE DOCUMENT IS A COLLECTION, WHATEVER ITS BODY SAYS ══════════════════════════════
//
// The predicate DashCheckin was corrected for survived one function upstream: the fold said
// `rel.out != null ? rel.out : r0.out`, so a release carrying `out: 0` — or `false`, or no `out` at all —
// fell back to the check-in's own `out`, which is `null`. The child had been released and the screen showed
// her IN THE ROOM, with a live Check out button. Driven here end to end: the shipped fold, then the shipped
// screen, with a valid release for that exact session|checkinId.

const relRow = (o) => ({ id: o.id, _rel: o.rel, _sid: 's1', ts: o.ts, _by: 'worker',
  ...(('out' in o) ? { out: o.out } : {}), ...(o.manual != null ? { manual: o.manual } : {}) });

test('CONTROL: a release with a real `out` collects the child and prints the time', async () => {
  const d = await desk({ recs: foldThrough([
    { id: 'c1', child: KID, childName: 'Alice Fenn', date: TODAY, ts: NOW - 3600, in: NOW - 3600, _sid: 's1', code: '4182' },
    relRow({ id: 'rel1', rel: 'c1', ts: NOW - 600, out: NOW - 600, manual: true }),
  ]) });
  assert.match(d.collected(), /Alice Fenn/, 'a released child is not on the Collected list');
  assert.match(d.collected(), /out \d/, 'the collection time is not printed');
  assert.doesNotMatch(d.checkedIn(), /Alice Fenn/, 'a released child is still shown as in the room');
});

test('A RELEASE WITH A FALSY `out` STILL COLLECTS HER — she is not left standing in the room', async () => {
  for (const rel of [{ out: 0 }, { out: false }, {}, { out: null }]) {
    const d = await desk({ recs: foldThrough([
      { id: 'c1', child: KID, childName: 'Alice Fenn', date: TODAY, ts: NOW - 3600, in: NOW - 3600, _sid: 's1', code: '4182' },
      relRow({ id: 'rel1', rel: 'c1', ts: NOW - 600, ...rel }),
    ]) });
    assert.doesNotMatch(d.checkedIn(), /Alice Fenn/,
      'A RELEASED CHILD IS SHOWN AS IN THE ROOM, with a live Check out button, for a release body of ' +
      JSON.stringify(rel) + '. The release document IS the collection; the only open question was what time ' +
      'to print. As rendered: ' + d.words());
    assert.match(d.collected(), /Alice Fenn/, 'she vanished from the screen altogether for ' + JSON.stringify(rel));
    // …and the time shown is the RELEASE EVENT'S OWN created_at, which is attested, rather than invented
    assert.match(d.collected(), /out \d/,
      'no collection time at all for ' + JSON.stringify(rel) + ' — the release event\'s created_at is the ' +
      'one instant we can stand behind: ' + d.collected());
    assert.doesNotMatch(d.collected(), /1970|Invalid Date/, 'a falsy `out` was painted as a real time');
  }
});

// ══════════════ THE `in` SIDE OF THE FALSY BUG ═════════════════════════════════════════════════════════

test('A LIVE ROW WITH `in: 0` IS NOT DELETED — a falsy arrival is "not recorded", not 1970', async () => {
  // The mirror of the `out: 0` fault: read as 1 January 1970, fifty-six years outside the window, so the
  // body bound removed a child who was in the room.
  for (const bad of [0, false, '']) {
    const d = await desk({ recs: [{ id: 'r1', child: KID, childName: 'Alice Fenn', date: TODAY,
      ts: NOW - 600, in: bad, code: '4182' }] });
    assert.match(d.checkedIn(), /Alice Fenn/,
      'a child in the room was deleted from the register because `in` was ' + JSON.stringify(bad) +
      ' — a falsy arrival bounds nothing, it does not mean 1970. As rendered: ' + d.words());
    assert.match(d.checkedIn(), /4182/, 'her pickup code went with her');
  }
  // …and a real 1970 arrival IS still aged out, so this is not the bound switched off
  const old = await desk({ recs: [{ id: 'r1', child: KID, childName: 'Alice Fenn', date: TODAY,
    ts: NOW - 600, in: 1, code: '4182' }] });
  assert.doesNotMatch(old.words(), /Alice Fenn/, 're-anchor: the `in` bound no longer removes anything at all');
});
