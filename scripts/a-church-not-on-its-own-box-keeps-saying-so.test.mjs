// A STEWARD WHO IS NOT SELF-HOSTING MUST NOT BE TOLD ONCE AND THEN LEFT IN SILENCE.
// Run: node --test scripts/a-church-not-on-its-own-box-keeps-saying-so.test.mjs
//
// Audit finding A-F2, 2026-09-12 — PRE-EXISTING, not from that branch: `selfRegister`'s `ownRefused` has
// fired `steward-write-blocked` with `what: 'church registration'` since e028209 (2026-08-17), into the
// SHARED `msg` slot. `steward-publish-error` overwrites that slot and attaches a 9s auto-clear, so the
// message vanished — and a box that has just refused a registration is precisely the box whose next write
// also fails, which makes the eviction likely rather than exotic.
//
// AUDIT-8 measured the same shape for the child-safeguarding warning, which is why `sgMsg` has its own
// slot. This is that fix, applied to the other message nobody may lose.
//
// ⚠ THE REAL COMPONENT IS RENDERED AND REAL EVENTS ARE FIRED AT IT. app/*.jsx ships unbundled, so a test
// matching its text would pass with the whole listener disabled (CLAUDE.md rule 3).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadScreen, miniReact, texts } from './render-jsx-screen.mjs';

const Stub = (n) => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };
const reads = (t) => texts(t).join(' ').replace(/\s+/g, ' ').trim();
const REG = { what: 'church registration', message: 'Your church is NOT registered with this computer.' };

function banner() {
  const { React, draw } = miniReact();
  const listeners = {}, timers = [];
  const win = {
    addEventListener: (k, fn) => { (listeners[k] = listeners[k] || []).push(fn); },
    removeEventListener: (k, fn) => { listeners[k] = (listeners[k] || []).filter(x => x !== fn); },
    dispatchEvent() {},
  };
  const globals = {
    React, window: win, Icon: Stub('Icon'),
    publishErrorMessage: (r) => ({ msg: r ? 'Couldn’t save to the relay.' : '', wrongChurch: false, sticky: false }),
    noteRelayRejection: () => {},
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: () => {},
    Math, Date, JSON, String, Number, Boolean, Object, Array, console,
  };
  const mod = loadScreen('app/stew-dashboard.jsx', ['PublishErrorBanner'], globals);
  const api = { listeners, timers };
  api.redraw = () => { api.tree = draw(mod.PublishErrorBanner, {}); return api.tree; };
  api.fire = (k, detail) => { (api.listeners[k] || []).forEach(fn => fn({ detail })); return api.redraw(); };
  api.redraw();
  return api;
}

test('A REGISTRATION REFUSAL SURVIVES AN ORDINARY PUBLISH FAILURE', () => {
  const b = banner();
  b.fire('steward-write-blocked', REG);
  assert.match(reads(b.tree), /NOT registered with this computer/, 're-anchor: the refusal never rendered');
  b.fire('steward-publish-error', { reason: 'timeout' });
  const t = reads(b.tree);
  assert.match(t, /NOT registered with this computer/,
    'THE REGISTRATION REFUSAL WAS EVICTED BY AN ORDINARY WRITE FAILURE. A box that has just refused a ' +
    'registration is the box whose next write also fails, so this is the likely sequence, not an exotic one.');
  assert.match(t, /Couldn’t save to the relay/, 're-anchor: the publish error did not render, so the above is vacuous');
});

test('…AND IT DOES NOT CLEAR ITSELF. It is a standing state, not a transient failure', () => {
  // "Your church is not where you think it is" stays true until somebody acts on it. The generic slot's
  // 9s auto-clear is what turned this into silence.
  const b = banner();
  b.fire('steward-write-blocked', REG);
  const armed = b.timers.length;
  b.timers.forEach(t => t.fn());          // fire every timer the component armed
  assert.match(reads(b.redraw()), /NOT registered with this computer/,
    'THE REFUSAL CLEARED ITSELF AFTER A TIMER (' + armed + ' armed). The steward is left believing they ' +
    'are self-hosting, with nothing on screen.');
});

test('it is dismissible, so it is not a banner nobody can get rid of', () => {
  const b = banner();
  b.fire('steward-write-blocked', REG);
  const btn = [];
  (function walk(n) {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach(walk);
    if (n.type === 'button' && n.props && /Dismiss/i.test(String(n.props['aria-label'] || ''))) btn.push(n);
    (n.kids || []).forEach(walk);
  })(b.tree);
  assert.ok(btn.length >= 1, 'the sticky banner has no dismiss control');
  btn[btn.length - 1].props.onClick();
  assert.ok(!/NOT registered with this computer/.test(reads(b.redraw())), 'dismissing it did not remove it');
});

test('AND IT STILL DOES NOT EVICT THE SAFEGUARDING WARNING — three slots, not two', () => {
  // AUDIT-8: one shared string is last-event-wins. Adding a slot must not reopen that for the message that
  // matters most.
  const b = banner();
  b.fire('steward-write-blocked', { what: 'safeguarding clearances', message: 'A child’s clearance was refused.' });
  b.fire('steward-write-blocked', REG);
  b.fire('steward-publish-error', { reason: 'timeout' });
  const t = reads(b.tree);
  assert.match(t, /clearance was refused/, 'THE CHILD-SAFETY WARNING WAS EVICTED.');
  assert.match(t, /NOT registered with this computer/, 'the registration refusal was evicted');
  assert.match(t, /Couldn’t save to the relay/, 'the ordinary failure was evicted');
});
