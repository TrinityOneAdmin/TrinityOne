// THE CONSOLE SAYS WHEN THIS COMPUTER BECAME THE CHURCH'S HOME — chunk 5 of
// reference/SCOPE-SUITE-AUTOREGISTER-2026-09-12.md.
// Run: node --test scripts/a-box-that-became-a-home-says-so.test.mjs
//
// `_registerOnOwnBox` has dispatched `steward-box-registered` since 2cb1582 and NOTHING RENDERED IT — a
// church quietly became self-hosted with no word on any screen. That is the same shape as
// `steward-write-blocked` being fired by two callers and listened to nowhere, which is what the banner
// beside this one exists to fix.
//
// ⚠ THE BANNER IS RENDERED, NOT MATCHED. app/*.jsx ships unbundled, so `false && ` in front of the
// listener would leave every word of it in place and a text-matching assertion would still pass
// (CLAUDE.md rule 3). The component is drawn and the real event is fired at it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadScreen, miniReact, texts } from './render-jsx-screen.mjs';

const Stub = (n) => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };
const reads = (tree) => texts(tree).join(' ').replace(/\s+/g, ' ').trim();

function banner() {
  const { React, draw } = miniReact();
  const listeners = {};
  const timers = [];
  const win = {
    addEventListener: (k, fn) => { (listeners[k] = listeners[k] || []).push(fn); },
    removeEventListener: (k, fn) => { listeners[k] = (listeners[k] || []).filter(x => x !== fn); },
    dispatchEvent() {},
  };
  const globals = {
    React, window: win,
    Icon: Stub('Icon'),
    publishErrorMessage: (reason) => ({ msg: reason ? 'publish failed: ' + reason : '', wrongChurch: false, sticky: false }),
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

test('BEFORE ANYTHING HAPPENS THE BANNER IS ABSENT', () => {
  const b = banner();
  assert.equal(reads(b.tree), '', 'the banner put words on screen with nothing to report');
});

test('WHEN THE BOX BECOMES THE CHURCH’S HOME, THE CONSOLE SAYS SO', () => {
  const b = banner();
  assert.ok((b.listeners['steward-box-registered'] || []).length === 1,
    'NOTHING LISTENS FOR `steward-box-registered`. The engine dispatches it and a church becomes ' +
    'self-hosted in silence — the exact shape this banner was built to end.');
  b.fire('steward-box-registered', {});
  const t = reads(b.tree);
  assert.match(t, /this computer is now your church/i, 'the confirmation does not say what happened. Read: ' + t);
  assert.match(t, /records live here/i, 'it does not say what it means for the church');
});

test('…and it GOES, because a confirmation is a moment', () => {
  // Nothing about it is actionable, unlike the two failure slots beside it which stay until dismissed.
  const b = banner();
  b.fire('steward-box-registered', {});
  const t = b.timers[b.timers.length - 1];
  assert.ok(t && t.ms > 0 && t.ms <= 12000, 'the confirmation has no auto-clear, so it sits there for ever');
  t.fn();
  assert.equal(reads(b.redraw()), '', 'the confirmation did not clear itself');
});

test('A SUCCESS NEVER EVICTS A SAFEGUARDING WARNING — they hold separate slots', () => {
  // AUDIT-8 measured exactly this with one shared string: a generic message replaced the child-safety
  // warning inside 400ms and then auto-cleared, leaving silence. A confirmation must not reopen that.
  const b = banner();
  b.fire('steward-write-blocked', { what: 'safeguarding clearances', message: 'A child’s clearance was refused.' });
  b.fire('steward-box-registered', {});
  const t = reads(b.tree);
  assert.match(t, /clearance was refused/i, 'THE SAFEGUARDING WARNING WAS EVICTED BY A SUCCESS MESSAGE.');
  assert.match(t, /this computer is now your church/i, 're-anchor: the confirmation did not render at all');
  // ⚠ AND THE ORDINARY REFUSAL TOO, which is the half that actually proves the slots are separate.
  // Measured: with the safeguarding ROUTING removed, everything above still passed — both messages simply
  // arrived through one slot and both rendered. The property AUDIT-8 is about is a LATER generic message
  // replacing the child-safety one, so that is what is driven here.
  b.fire('steward-write-blocked', { what: 'church profile', message: 'That change could not be saved.' });
  const t2 = reads(b.tree);
  assert.match(t2, /clearance was refused/i,
    'A GENERIC REFUSAL REPLACED THE CHILD-SAFETY WARNING. That is AUDIT-8 verbatim: one shared string, ' +
    'last-event-wins, and the replacement carries a 9s auto-clear — so the steward ends in silence.');
  assert.match(t2, /could not be saved/i, 're-anchor: the generic refusal never rendered, so the above is vacuous');
});

test('…nor an ordinary refusal', () => {
  // ⚠ DRIVEN THROUGH `steward-write-blocked`, NOT `steward-publish-error`. My first version fired a
  // publish-error with reason 'blocked' and the message never appeared — not a bug: publishErrorMessage
  // deliberately returns nothing for some reasons ("a refusal we deliberately do not surface"), and the
  // handler returns early on an empty message. The test was wrong, so it was corrected rather than
  // loosened; this path always reports, which is what makes the eviction check meaningful.
  const b = banner();
  b.fire('steward-write-blocked', { what: 'church profile', message: 'That change could not be saved.' });
  b.fire('steward-box-registered', {});
  const t = reads(b.tree);
  assert.match(t, /could not be saved/i, 'a failure banner was replaced by a success message');
  assert.match(t, /this computer is now your church/i, 're-anchor: the confirmation did not render');
});
