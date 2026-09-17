// A BACKGROUND WRITE THE RELAY CORRECTLY DECLINED IS NOT A STEWARD'S FAILED CHANGE.
//   Run: node --test scripts/a-write-nobody-asked-for-does-not-raise-a-standing-alarm.test.mjs
//
// Measured twice on real delegated consoles. First on 2026-09-07, and written into publishErrorMessage at the
// time: "the banner sat on EVERY tab — Overview, Groups, Members, Check-in — while that same console was
// reading and acting through the very relay it was calling somebody else's. The refused writes were carekey:
// (no care grant, correctly refused) and groupkey:." Again on 2026-09-17, in the relay's own rejected.log:
//
//   13:01:48.977  trinityone/carekey:3eb1f889…  not a member or not permitted for this group
//   13:01:55.018  trinityone/carekey:3eb1f889…  not a member or not permitted for this group
//
// Those two refusals BRACKET a seal that worked. Nothing the steward did failed. The writes come from the
// key-distributor effect (app/stew-dashboard.jsx), which republishes the church's key envelopes whenever the
// roster re-emits — automatic, un-asked-for, and refused every single time on a console without that grant.
// `publishErrorMessage` returned `{ sticky: true }`, so the pink alarm stood on every tab and came straight
// back each time it was dismissed.
//
// ⚠ AND SILENCE IS NOT THE FIX. This codebase's standing failure mode is a refusal that reaches no screen at
// all (see a-console-write-with-no-relay-is-not-silent.test.mjs, and the note above `g` in
// PublishErrorBanner). So the refusal still speaks — once per console session, non-sticky, in its own quiet
// slot, leading with the fact that nothing the steward did has failed — and every one of them reaches the
// log. What it may no longer do is STAND THERE.
//
// THREE INSTRUMENTS:
//   A. the MAPPING, lifted out of app/stew-dashboard.jsx with `new Function` and executed;
//   B. the SCREEN — the real PublishErrorBanner compiled and rendered, real events fired at it. CLAUDE.md
//      rule 3: app/*.jsx ships unbundled, so a text match on the source would survive `false && `;
//   C. the CALL SITE — the real KeyDistributor rendered, its real effects run, and the arguments it passes
//      read off the calls it made. A test that only checked the mapping would be green with nothing in the
//      console ever marking a write as background.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadScreen, miniReact, texts, find } from './render-jsx-screen.mjs';

const DASH = readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8');
const REFUSAL = 'blocked: not a member or not permitted for this group';
const DELEGATE = { Steward: { actingChurch: '3eb1f889'.padEnd(64, '0') } };
const OWNER = { Steward: { actingChurch: '' } };
const Stub = (n) => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };
const reads = (t) => texts(t).join(' ').replace(/\s+/g, ' ').trim();

// ── A. the mapping ────────────────────────────────────────────────────────────────────────────────────────
function mapper() {
  const at = DASH.indexOf('function publishErrorMessage(');
  assert.notEqual(at, -1, 'publishErrorMessage is gone — the banner is guessing again');
  let depth = 0, end = -1;
  for (let i = DASH.indexOf('{', at); i < DASH.length; i++) {
    const c = DASH[i];
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) { end = i + 1; break; }
  }
  return new Function(DASH.slice(at, end) + '; return publishErrorMessage;')();
}
const withWindow = (w, fn) => {
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'window');
  const prev = globalThis.window;
  try { globalThis.window = w; return fn(); }
  finally { if (had) globalThis.window = prev; else delete globalThis.window; }
};

test('a delegate’s AUTOMATIC refusal is not sticky, and says nothing failed', () => {
  const map = mapper();
  const m = withWindow(DELEGATE, () => map(REFUSAL, { kind: 30078 }, { background: true }));
  assert.equal(m.sticky, false,
    'THE STANDING ALARM IS BACK. This refusal fires again on every roster re-emit, so sticky means a pink ' +
    'banner on every tab of a console that is working perfectly.');
  assert.equal(m.quiet, true, 'nothing marks it as the quiet kind, so it lands in the alarm slot regardless');
  assert.match(m.msg, /Nothing you did has failed/,
    'the steward is still being told a change of theirs was not saved. They made none.');
  assert.equal(m.wrongChurch, false, 'a capability refusal must never raise the wrong-church alarm');
});

test('…and the SAME refusal from something the steward TAPPED is unchanged: loud and sticky', () => {
  // The whole risk of this fix is silencing a real failure. A care control the steward pressed does not come
  // through the background path, and must be exactly as loud as it was yesterday.
  const map = mapper();
  const m = withWindow(DELEGATE, () => map(REFUSAL, { kind: 30078 }));
  assert.equal(m.sticky, true, 'A REFUSAL OF SOMETHING THE STEWARD DID NOW VANISHES ON ITS OWN.');
  assert.ok(!m.quiet, 'a deliberate action’s refusal was demoted to the quiet slot');
  assert.match(m.msg, /hasn’t been given to you/, 'the delegate is no longer told what actually happened');
});

test('an OWNER’s background refusal still raises the wrong-church alarm — it means the relay lost the church', () => {
  // For an owner this reason is not a capability refusal at all: it is "your relays are not carrying this
  // church", a standing state that must keep revealing the registration panel and arming the forced retry
  // (useRegistrationRetry). Softening it because the write happened to be automatic would be a regression
  // dressed as a fix.
  const map = mapper();
  const m = withWindow(OWNER, () => map(REFUSAL, { kind: 30078 }, { background: true }));
  assert.equal(m.wrongChurch, true,
    'AN OWNER LOST THE WRONG-CHURCH ALARM. That alarm is what reveals “A relay is refusing our posts” and ' +
    'what arms the forced re-registration; nothing else does.');
  assert.equal(m.sticky, true, 'the owner’s standing state must not auto-dismiss');
  assert.ok(!m.quiet);
});

// ── B. the screen ─────────────────────────────────────────────────────────────────────────────────────────
function banner(win) {
  const { React, draw } = miniReact();
  const listeners = {}, timers = [], warned = [];
  const w = {
    ...win,
    addEventListener: (k, fn) => { (listeners[k] = listeners[k] || []).push(fn); },
    removeEventListener: (k, fn) => { listeners[k] = (listeners[k] || []).filter(x => x !== fn); },
    dispatchEvent() {},
  };
  const mod = loadScreen('app/stew-dashboard.jsx', ['PublishErrorBanner'], {
    React, window: w,
    Icon: Stub('Icon'),
    noteRelayRejection: () => {},
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: () => {},
    console: { warn: (...a) => warned.push(a.join(' ')), log() {}, error() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    Math, Date, JSON, String, Number, Boolean, Object, Array, Set, Map, Promise, RegExp,
  });
  const api = { listeners, timers, warned };
  api.redraw = () => { api.tree = draw(mod.PublishErrorBanner, {}); return api.tree; };
  api.fire = (detail) => { (api.listeners['steward-publish-error'] || []).forEach(fn => fn({ detail })); return api.redraw(); };
  api.redraw();
  return api;
}
const BG = { reason: REFUSAL, evt: { kind: 30078, tags: [['d', 'trinityone/carekey:3eb1f889']] }, background: true };

test('THE SCREEN: a background refusal does not paint the standing alarm', () => {
  const b = banner(DELEGATE);
  b.fire(BG);
  const said = reads(b.tree);
  assert.match(said, /\S/, 'the refusal reached no screen at all — silence is the defect this codebase already has');
  assert.doesNotMatch(said, /That change wasn’t saved/,
    'THE STANDING ALARM IS STILL PAINTED. It says a change was not saved; the steward made no change.');
  assert.match(said, /Nothing you did has failed/, 'the quiet note is not what rendered');
  // …AND IT MUST NOT BE PAINTED AS AN ALARM. The text alone cannot see this: dropping the `quiet` branch
  // puts the very same sentence into the clay/pink alarm slot, where the steward reads a warning colour on
  // every tab over something that has not gone wrong. The style asserted on is the one the component
  // actually evaluated.
  const note = find(b.tree, n => n.props && n.props.role === 'alert' && /Nothing you did has failed/.test(reads(n)))[0];
  assert.ok(note, 're-anchor: the quiet note is not a card in this banner');
  assert.doesNotMatch(String((note.props.style || {}).background || ''), /clay/,
    'THE QUIET NOTE IS PAINTED IN THE ALARM’S COLOUR. Nothing has gone wrong for the person reading it.');
});

test('…it clears itself, and it does not come back on the next refusal', () => {
  // The write is retried whenever the roster re-emits, so a note that reappears is the same defect wearing
  // a lighter colour.
  const b = banner(DELEGATE);
  b.fire(BG);
  assert.ok(b.timers.length >= 1, 'the quiet note armed no timer, so it stands for ever like the alarm did');
  b.timers.forEach(t => t.fn());
  assert.doesNotMatch(reads(b.redraw()), /Nothing you did has failed/, 'the quiet note never cleared');
  b.fire(BG); b.fire(BG);
  assert.doesNotMatch(reads(b.redraw()), /Nothing you did has failed/,
    'THE NOTE CAME BACK. The refused write repeats on every roster change, so this is a banner that ' +
    'reappears for ever — exactly the complaint, in a different colour.');
});

test('…and every one of them still reaches the log, so nothing is invisible', () => {
  const b = banner(DELEGATE);
  b.fire(BG); b.fire(BG); b.fire(BG);
  const hits = b.warned.filter(w => /background write was refused/.test(w));
  assert.equal(hits.length, 3, 'refusals after the first vanish completely — say it quietly, not never');
  assert.match(hits[0], /carekey/, 'the log line does not name the document, so it cannot be acted on');
});

test('it is dismissible, like every other message in this banner', () => {
  const b = banner(DELEGATE);
  b.fire(BG);
  const btn = find(b.tree, n => n.type === 'button' && /Dismiss/i.test(String((n.props || {})['aria-label'] || '')));
  assert.ok(btn.length >= 1, 'the quiet note has no dismiss control');
  btn[btn.length - 1].props.onClick();
  assert.doesNotMatch(reads(b.redraw()), /Nothing you did has failed/, 'dismissing it did not remove it');
});

test('CONTROL: the same refusal WITHOUT the background mark still paints the standing alarm', () => {
  // Without this row every assertion above would pass over a banner that had simply stopped working.
  const b = banner(DELEGATE);
  b.fire({ reason: REFUSAL, evt: { kind: 30078 } });
  const said = reads(b.tree);
  assert.match(said, /That change wasn’t saved/,
    'a refusal of something the steward DID no longer reaches the banner at all');
  b.timers.forEach(t => t.fn());
  assert.match(reads(b.redraw()), /That change wasn’t saved/, 'the sticky alarm now auto-clears');
});

test('a quiet note can never evict an alarm — four slots, not three', () => {
  // AUDIT-8's rule: one shared string is last-event-wins, and the message that matters is the one that goes.
  const b = banner(DELEGATE);
  b.fire({ reason: REFUSAL, evt: { kind: 30078 } });
  b.fire(BG);
  const said = reads(b.tree);
  assert.match(said, /That change wasn’t saved/, 'THE QUIET NOTE EVICTED THE ALARM.');
  assert.match(said, /Nothing you did has failed/, 're-anchor: the quiet note did not render, so the above is vacuous');
});

// ── C. the call site ──────────────────────────────────────────────────────────────────────────────────────
// The real KeyDistributor, rendered, with its real effects run by the harness.
function distributor() {
  const { React, draw } = miniReact();
  const calls = [];
  const win = {
    useStewardChurch: () => ({ name: 'St Aidan', features: {} }),
    useStewardGroups: () => [],
    useStewardMembers: () => [{ pubkey: 'a'.repeat(64) }],
    useStewardStewards: () => ['b'.repeat(64)],
    useStewardBlocked: () => [],
    Steward: {
      subscribeMediaKey: () => () => {}, subscribeCareKey: () => () => {}, subscribeNameKey: () => () => {},
      setCareRoster: () => {},
      ensureMediaKeyForMembers: (...a) => calls.push(['media', a]),
      ensureCareKeyForMembers: (...a) => calls.push(['care', a]),
      ensureNameKeyForMembers: (...a) => calls.push(['name', a]),
      ensureGroupKeys: (...a) => calls.push(['groups', a]),
    },
    addEventListener() {}, removeEventListener() {},
  };
  const mod = loadScreen('app/stew-dashboard.jsx', ['KeyDistributor'], {
    React, window: win, setTimeout, clearTimeout,
    Math, Date, JSON, String, Number, Boolean, Object, Array, Set, Map, console, Promise,
  });
  draw(mod.KeyDistributor, {});
  return calls;
}

test('THE CALL SITE: the key distributor marks its care-key write as one nobody asked for', () => {
  const calls = distributor();
  const care = calls.find(c => c[0] === 'care');
  assert.ok(care, 're-anchor: the distributor no longer maintains the care key at all');
  assert.equal(!!(care[1][2] && care[1][2].background), true,
    'THE MARK IS NOT PASSED. Everything else about this fix is dormant: the relay refuses this write on every ' +
    'roster re-emit and the standing alarm comes back exactly as before.');
});

test('…and it still passes the roster and the stewards, which is what the envelope is FOR', () => {
  const calls = distributor();
  const care = calls.find(c => c[0] === 'care');
  assert.deepEqual(care[1][0], ['a'.repeat(64)], 'the members are no longer keyed');
  assert.deepEqual(care[1][1], ['b'.repeat(64)], 'the steward roster is no longer keyed — a delegated console ' +
    'holding an empty ring is how the church’s names were wiped once already');
});
