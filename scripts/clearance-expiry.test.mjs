// THE SAFEGUARDING CLEARANCE EXPIRY, DRIVEN RATHER THAN READ.
//   Run: node --test scripts/clearance-expiry.test.mjs
//
// A cleared adult's youth clearance may carry an OPTIONAL end date (a DBS / church check is renewed, not
// forever). The feature is FLAG ONLY: an expired clearance never cuts off any access — the relay stores and
// serves the cleared list exactly as before, nothing touches the relay gate or approvedIn, and the member
// never sees their own date in v1. So this file does NOT assert any fail-closed behaviour; there is none.
//
// What it DOES prove, in the two places a text match (CLAUDE.md rule 3 — app/*.jsx ships unbundled) could
// never tell apart from a dead feature:
//
//   PART A — the SCREEN. The cleared-list row is lifted out of app/stew-dashboard.jsx and RENDERED through
//   the mini React. A dated clearance must put an "Expires…/Expired…" badge on that row; a DATE-LESS one
//   (the pilot back-compat case) must put NO expiry badge on it at all; and the row's Save control must be
//   wired to window.Steward.setApproved carrying an `expiry` map. Delete the badge from the row, or unwire
//   the control, and these fail — which `false && ` in front of a condition would not do to a text match.
//
//   PART B — the ROUND TRIP, against the shipped bundle. setApproved writes the `expiry` map (validating the
//   date with the check-in module's own `dated` helper, so a church that types a date beyond the ~year cap
//   is REFUSED, not silently shortened), and subscribeSafeguard reads it back — including the guard that an
//   older console republishing the plain list with no `expiry` field does not erase the dates we hold.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fnBody } from './test-slice.mjs';
import { miniReact, find, texts } from './render-jsx-screen.mjs';
import { permissionWindow } from './checkin-role-source.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const STEW = readFileSync(join(ROOT, 'app/stew-dashboard.jsx'), 'utf8');
const DATA = readFileSync(join(ROOT, 'app/stew-data.jsx'), 'utf8');   // SK_TINT lives here
const STEWARD = readFileSync(join(ROOT, 'vendor/steward.js'), 'utf8');

const PK = 'a'.repeat(64);
const NAME = 'Bram Whitlock';
const DAY = 24 * 3600;

// ── PART A: the cleared-list row renders the badge, or it does not ──────────────────────────────────────────
// Compile the row helper and the pure state/label functions it calls, in one scope, with the furniture it
// needs supplied as globals. The two threshold constants are lifted VERBATIM from the source (not re-typed)
// so this runs the real month / fortnight windows, not a copy that could drift from what ships.
const CONSTS = (STEW.match(/const EXPIRY_SOON_SECONDS = [^;]+;/) || [])[0] + '\n'
             + (STEW.match(/const EXPIRY_URGENT_SECONDS = [^;]+;/) || [])[0];
assert.match(CONSTS, /EXPIRY_SOON_SECONDS/, 'the expiry threshold constants are gone from stew-dashboard.jsx — re-anchor this test');

async function loadRow(globals) {
  const src = CONSTS + '\n'
    + fnBody(STEW, 'function clearanceExpiryState(untilSec, nowSec) {', 'clearanceExpiryState') + '\n'
    + fnBody(STEW, 'function clearanceExpiryLabel(untilSec, nowSec) {', 'clearanceExpiryLabel') + '\n'
    + fnBody(STEW, 'function clearanceExpiryTint(st) {', 'clearanceExpiryTint') + '\n'
    + fnBody(STEW, 'function _expiryIsoDay(untilSec) {', '_expiryIsoDay') + '\n'
    + fnBody(STEW, 'const saveExpiry = (pk, override) => {', 'saveExpiry') + '\n'
    + fnBody(STEW, 'const clearedRow = (c) => {', 'clearedRow') + '\n';
  const tmp = join(tmpdir(), 'clexp-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, src + '\nexport { clearedRow, clearanceExpiryState, clearanceExpiryLabel };\n');
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const key = '__clexp_' + Math.random().toString(36).slice(2);
  globalThis[key] = globals;
  const preamble = Object.keys(globals).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  return await import('data:text/javascript;base64,' + Buffer.from(preamble + '\n' + js).toString('base64'));
}

// Render ONE cleared-list row over a clearance with the given expiry (unix seconds, or null for no date), and
// hand back the rendered text and the Steward writes the row's controls made.
// The row is rendered as the shipped code builds it (raw element tree, exactly as
// console-safeguarding-controls-are-wired.test.mjs renders memberRow). SkPill is a function component, so the
// BADGE is the node whose type IS that SkPill — matched by identity, which tells it apart from the control's
// own always-present "Expires" label and aria-labels.
const SkPill = function SkPill({ children }) { return children; };
async function renderRow(until) {
  const { React } = miniReact();
  const now = 1800000000;                         // a fixed "now" so the day maths is deterministic
  const calls = { approved: [] };
  const mod = await loadRow({
    React, Promise, SkPill,
    Icon: () => null,
    idOf: (pk) => 'id:' + pk.slice(0, 6),
    _clDate: () => 'a date',
    _nowSec: now,
    expiryDraft: {},
    setExpiryDraft: () => {},
    expiryNote: null,
    setExpiryNote: () => {},
    sg: { approved: [PK], clearedKnown: true },
    window: { Steward: { setApproved: (list, opts) => { calls.approved.push([list, opts]); return true; } } },
  });
  const tree = mod.clearedRow({ pk: PK, name: NAME, rec: { by: 'x', at: 1 }, until });
  const badges = find(tree, n => n.type === SkPill);
  const badgeText = badges.map(b => texts(b).join(' ')).join(' ');
  return { tree, badges, badgeText, calls, root: mod };
}

test('A DATED clearance shows an "Expired" badge on the row when the date has passed', async () => {
  const { badges, badgeText } = await renderRow(1800000000 - 5 * DAY);
  assert.equal(badges.length, 1, 'a clearance whose date is in the past shows no status badge on the cleared-list row');
  assert.match(badgeText, /Expired/,
    'the badge on a lapsed clearance does not say "Expired" — the feature is deleted from the screen even if ' +
    'the helper still computes it: ' + JSON.stringify(badgeText));
});

test('A DATED clearance shows an "Expires" badge on the row when the date is near', async () => {
  const { badges, badgeText } = await renderRow(1800000000 + 10 * DAY);
  assert.equal(badges.length, 1, 'a clearance ten days from its date shows no status badge on the row');
  assert.match(badgeText, /Expires in/, 'the badge gives no "Expires in …" reminder: ' + JSON.stringify(badgeText));
});

test('A DATE-LESS clearance shows NO expiry badge — the pilot back-compat case', async () => {
  // A person cleared before this field existed has no date, and that is "cleared, no expiry", NEVER expired.
  // The control's own "Expires" label is always present; the BADGE must not be, so assert on the badge node.
  const { badges } = await renderRow(null);
  assert.equal(badges.length, 0,
    'a clearance with no date painted a status badge — a date-less record must read as cleared-with-no-expiry, ' +
    'not as lapsed');
});

test('the three reminder stages wear three DISTINCT tints on the row', async () => {
  // The colour, not only the wording, says how close a clearance is: amber a month out, a stronger orange a
  // fortnight out, red once lapsed. The badge is the SkPill, and the tint it is handed is read off it here.
  const urgent = (await renderRow(1800000000 + 10 * DAY)).badges[0].props.tint;   // <= 2 weeks
  const soon   = (await renderRow(1800000000 + 20 * DAY)).badges[0].props.tint;   // <= 1 month, > 2 weeks
  const expired = (await renderRow(1800000000 - 5 * DAY)).badges[0].props.tint;   // past
  assert.equal(soon, 'gold', 'the one-month reminder no longer wears the amber tint');
  assert.equal(expired, 'clay', 'a lapsed clearance no longer wears the red tint');
  assert.notEqual(urgent, soon, 'the two-week (urgent) badge wears the SAME tint as the one-month one — the owner asked for a stronger, distinct colour');
  assert.notEqual(urgent, expired, 'the two-week (urgent) badge is indistinguishable from the red Expired badge');
  assert.equal(new Set([urgent, soon, expired]).size, 3, 'the three stages are not three distinct colours');
  // …and the urgent tint must be a REAL SK_TINT entry, or SkPill silently falls back to clay (red) and the
  // fortnight badge would be indistinguishable from an expired one on the actual screen.
  assert.match(DATA, new RegExp(urgent + ':\\s*\\{'),
    'the urgent tint "' + urgent + '" is not a defined SK_TINT colour in app/stew-data.jsx — SkPill would fall back to red');
});

test('the row’s Save control is WIRED to setApproved and carries an expiry map', async () => {
  // The badge could be perfect and the control dead. Press Save and assert what reached the engine — the
  // whole cleared list unchanged (nobody added/removed) plus just this person’s expiry override.
  const { tree, calls } = await renderRow(1800000000 + 10 * DAY);
  const save = find(tree, n => n.type === 'button' && /^Save clearance expiry date/.test(String((n.props || {})['aria-label'] || '')));
  assert.equal(save.length, 1, 'the row no longer carries exactly one Save control for the expiry date');
  save[0].props.onClick();
  assert.equal(calls.approved.length, 1, 'pressing Save published nothing — the date control is not wired to the engine');
  const [list, opts] = calls.approved[0];
  assert.deepEqual(list, [PK], 'the whole cleared list was not re-sent unchanged — Save must not add or drop anyone');
  assert.ok(opts && opts.expiry && Object.prototype.hasOwnProperty.call(opts.expiry, PK),
    'the write carried no expiry override for the person whose Save was pressed: ' + JSON.stringify(opts));
});

// ── PART B: the round trip against the shipped bundle ───────────────────────────────────────────────────────
// Lifted straight from scripts/clearance-record.test.mjs — the same _landed, the same brace-grab, the same
// recording scope — extended only to bind `permissionWindow` (which setApproved now calls to validate the
// date) and to carry an `expiry` option and trail.
function grab(src, sig) {
  let at = src.indexOf(sig);
  assert.notEqual(at, -1, sig + ' is gone from the shipped bundle — re-anchor this test, or rebuild');
  if (src.slice(Math.max(0, at - 6), at) === 'async ') at -= 6;
  let depth = 0, q = '';
  for (let i = src.indexOf('{', at); i < src.length; i++) {
    const c = src[i], prev = src[i - 1];
    if (q) { if (c === q && prev !== '\\') q = ''; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i === -1) break; continue; }
    if (c === '{') depth++; else if (c === '}' && --depth === 0) return src.slice(at, i + 1);
  }
  assert.fail('could not find the end of ' + sig);
}
const _landedSrc = grab(STEWARD, 'function _landed(what, p) {');
const _landedShipped = new Function('return ' + _landedSrc)();
const NOW = 1800000000;

function runSetApproved({ pub, trail, pubkeys, listKnown, expiry }) {
  const body = grab(STEWARD, 'setApproved(pubkeys, opts)');
  const FINALIZE = (body.match(/\b(finalizeEvent\w*)\s*\(/) || [])[1];
  assert.ok(FINALIZE, 'the shipped function no longer signs an event — re-anchor this test');
  let published = null;
  const scope = {
    _requireTrustedView: () => {}, _landed: _landedShipped,
    sk: new Uint8Array(32), pub, now: () => NOW,
    _clearedTrail: trail,
    permissionWindow,                               // setApproved validates the date through this — un-renamed in the bundle
    [FINALIZE]: (evt) => evt,
    _monotonic: (t) => t,
    _skewGate: (fn) => Promise.resolve(fn()),
    _publishToRelays: (evt) => { published = JSON.parse(evt.content); return Promise.resolve(true); },
    APPROVED_D: 'trinityone/approved:', NET: 'trinityone',
  };
  const fn = new Function(...Object.keys(scope), 'return async function ' + body + ';')(...Object.values(scope));
  return Promise.resolve(fn(pubkeys, { listKnown, expiry })).then(() => published, (e) => ({ _rejected: String(e && e.message) }));
}

const B = 'b'.repeat(64);
const CHURCH1 = '1'.repeat(64);
const EMPTY = { cp: '', map: {}, list: [], expiry: {}, loaded: false };
const isoFromSec = (sec) => { const d = new Date(sec * 1000); const p = (n) => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); };

test('setApproved WRITES an expiry date when given one', async () => {
  const until = isoFromSec(NOW + 100 * DAY);
  const out = await runSetApproved({ pub: CHURCH1, trail: EMPTY, pubkeys: [PK], listKnown: true, expiry: { [PK]: until } });
  assert.equal(out && out._rejected, undefined, 'a valid date was refused: ' + (out && out._rejected));
  assert.ok(Number.isInteger(out.expiry[PK]) && out.expiry[PK] > NOW,
    'the expiry was not written as a future unix second: ' + JSON.stringify(out.expiry));
  assert.ok(out.expiry[PK] - NOW <= 400 * DAY, 'the stored expiry exceeds the year cap');
});

test('setApproved REFUSES a date beyond the cap, so a church that types 2099 is told', async () => {
  const out = await runSetApproved({ pub: CHURCH1, trail: EMPTY, pubkeys: [PK], listKnown: true, expiry: { [PK]: '2099-12-31' } });
  assert.ok(out && out._rejected, 'a clearance date a lifetime away was accepted and silently shortened instead of refused');
  assert.match(out._rejected, /date/i, 'the refusal does not say what it refused');
});

test('a DATE-LESS clearance writes NO expiry entry — additive, never invented (back-compat)', async () => {
  const out = await runSetApproved({ pub: CHURCH1, trail: EMPTY, pubkeys: [PK], listKnown: true });
  assert.equal(out && out._rejected, undefined, 'clearing without a date was refused');
  assert.deepEqual(out.expiry, {}, 'an expiry was invented for a clearance nobody dated: ' + JSON.stringify(out.expiry));
  assert.deepEqual(out.pubkeys, [PK], 'the cleared list itself is wrong');
});

test('setApproved CARRIES a held expiry forward for everyone the write keeps', async () => {
  // Re-clearing or dating ONE person must not drop another's date — the same rule the `cleared` map follows.
  const held = NOW + 50 * DAY;
  const trail = { cp: CHURCH1, map: { [B]: { by: CHURCH1, at: 111 } }, list: [B], expiry: { [B]: held }, loaded: true };
  const newUntil = isoFromSec(NOW + 120 * DAY);
  const out = await runSetApproved({ pub: CHURCH1, trail, pubkeys: [PK, B], listKnown: true, expiry: { [PK]: newUntil } });
  assert.equal(out.expiry[B], held, "another person's clearance date was dropped when a different person was dated");
  assert.ok(out.expiry[PK] > NOW, 'the newly dated person got no expiry');
});

test('setApproved takes an already-validated NUMERIC expiry as-is — the re-seat carry, even when lapsed', async () => {
  // A 'YYYY-MM-DD' string is a date a church just typed, so it is validated (and refused beyond the cap). A
  // NUMBER is a date this product itself already stored and is moving onto a new key in a device re-seat — it
  // must carry unchanged, even if it is already in the past, so the record survives the phone change.
  const past = NOW - 10 * DAY;
  const out = await runSetApproved({ pub: CHURCH1, trail: EMPTY, pubkeys: [PK], listKnown: true, expiry: { [PK]: past } });
  assert.equal(out && out._rejected, undefined, 'a carried numeric expiry was refused instead of taken as-is: ' + (out && out._rejected));
  assert.equal(out.expiry[PK], past, 'the carried expiry seconds were not preserved exactly');
});

// ── PART C: subscribeSafeguard reads the expiry back, and a legacy write cannot erase it ────────────────────
function runApprovedHandler(events) {
  const body = grab(STEWARD, 'subscribeSafeguard(onLists)');
  const CP = '1'.repeat(64);
  let out = null;
  const scope = {
    pub: CP,
    pool: { subscribeMany: (_r, _f, h) => { for (const e of events) h.onevent(e); h.oneose(); return { close() {} }; } },
    relays: () => ['wss://x'],
    _byChurch: () => true, _authFuture: () => false, _isRelayAuthed: () => true, _applyNoPhotoList: () => {},
    _clearedTrail: { cp: '', map: {}, list: [], expiry: {}, loaded: false },
    MINORS_D: 'trinityone/minors:', APPROVED_D: 'trinityone/approved:',
    NOPHOTO_D: 'trinityone/nophoto:', GUARDIANS_D: 'trinityone/guardians:', NET: 'trinityone',
  };
  const names = Object.keys(scope);
  const fn = new Function(...names, 'return ({ ' + body + ' });')(...names.map(n => scope[n]));
  fn.subscribeSafeguard((lists) => { out = lists; });
  return out;
}
const ev = (d, content, at) => ({ tags: [['d', d]], content: JSON.stringify(content), created_at: at, pubkey: '1'.repeat(64) });

test('subscribeSafeguard READS the expiry map back', () => {
  const CP = '1'.repeat(64);
  const until = NOW + 90 * DAY;
  const out = runApprovedHandler([ev('trinityone/approved:' + CP, { pubkeys: [PK], cleared: { [PK]: { by: CP, at: 555 } }, expiry: { [PK]: until } }, 100)]);
  assert.ok(out, 'the handler never reported anything');
  assert.equal(out.expiry[PK], until, 'the clearance expiry round-tripped wrong, or not at all');
});

test('an older console republishing the plain list does not erase the expiry dates', () => {
  const CP = '1'.repeat(64);
  const until = NOW + 90 * DAY;
  const modern = ev('trinityone/approved:' + CP, { pubkeys: [PK], cleared: { [PK]: { by: CP, at: 555 } }, expiry: { [PK]: until } }, 100);
  const legacy = ev('trinityone/approved:' + CP, { pubkeys: [PK], cleared: { [PK]: { by: CP, at: 555 } } }, 200);  // no expiry field
  const out = runApprovedHandler([modern, legacy]);
  assert.equal(out.expiry[PK], until, 'a write from an older console with no expiry field wiped the dates it never heard of');
});

// ── PART D: a device re-seat carries the clearance expiry date onto the new key ─────────────────────────────
// The shipped reseatMember is brace-grabbed out of the bundle and RUN with spy setters, exactly as
// scripts/reseat-write-results.test.mjs drives it — so this proves what reaches window.Steward.setApproved,
// not what the source looks like.
function reseater() {
  const body = grab(STEWARD, 'async reseatMember(oldPub, newPub, o) {');
  const calls = [];
  const setter = (name) => async (...args) => { calls.push({ name, args }); return { id: name + '-evt' }; };
  const Steward = {};
  for (const n of ['setReseats', 'setAdmitted', 'setMinors', 'setApproved', 'setGuardians', 'setBlocked']) Steward[n] = setter(n);
  Steward.refreshClearances = async (...a) => { calls.push({ name: 'refreshClearances', args: a }); return { results: [], failed: 0, skipped: 0, total: 0, unverified: false, pending: 0 }; };
  const scope = {
    toPubHex: (x) => (/^[0-9a-f]{64}$/i.test(String(x || '')) ? String(x).toLowerCase() : null),
    now: () => Math.floor(Date.now() / 1000),
    window: { Steward },
  };
  const names = Object.keys(scope);
  const obj = new Function(...names, 'return ({ ' + body + ' });')(...names.map(n => scope[n]));
  return { run: (a, b, o) => obj.reseatMember(a, b, o), calls };
}
const OLD = 'a'.repeat(64), NEW = 'd'.repeat(64);
const reseatOpts = (extra) => ({ reseats: [], admitted: [], minors: [], approved: [OLD], guardians: {}, guardiansClosed: {}, blocked: [], ...extra });

test('a device re-seat CARRIES the clearance expiry date onto the new key', async () => {
  const held = 1800000000 + 77 * DAY;
  const r = reseater();
  await r.run(OLD, NEW, reseatOpts({ expiry: { [OLD]: held } }));
  const sa = r.calls.find(c => c.name === 'setApproved');
  assert.ok(sa, 'the re-seat never re-recorded the clearance on the new key');
  const [list, opts] = sa.args;
  assert.ok(list.includes(NEW), 'the new key was not added to the cleared list on re-seat');
  assert.ok(opts && opts.expiry && opts.expiry[NEW] === held,
    "the old key's expiry date was dropped on the re-seat instead of carried onto the new key: " + JSON.stringify(opts));
});

test('a re-seat of a DATE-LESS clearance leaves the new key date-less', async () => {
  const r = reseater();
  await r.run(OLD, NEW, reseatOpts({ expiry: {} }));
  const sa = r.calls.find(c => c.name === 'setApproved');
  assert.ok(sa, 'the re-seat never re-recorded the clearance');
  const opts = sa.args[1] || {};
  assert.ok(!opts.expiry || !(NEW in opts.expiry),
    'a date was invented for a clearance that never had one: ' + JSON.stringify(opts));
});
