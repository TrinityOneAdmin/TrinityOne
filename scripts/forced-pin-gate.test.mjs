// The forced console-PIN gate must never become a dead end.
// Run: node --test scripts/forced-pin-gate.test.mjs
//
// AUDIT-2026-07-28 F19. StewardForcedPin is deliberately inescapable — no cancel, no back, and StewardRoot
// renders nothing else until a PIN exists, because the church key is sitting unencrypted until it does. That
// makes it the worst possible place for an unhandled rejection: `busy` disables the only button on the
// screen, and the await had no try/catch. setPin does real work that can throw — crypto.subtle.encrypt, the
// key derivation, and a localStorage write that fails on a full quota — so ONE rejection left the steward
// looking at a permanently disabled "Setting…" with no way forward, no way out, and no explanation.
//
// This runs the shipped submit() against a setPin that throws, and asserts the screen recovers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
// AUDIT-2026-07-30: the steward floor moved 6 -> 8, so the six-character literal these scenarios used as a
// VALID secret is now correctly refused. Swapped for an eight-character one; the scenarios are unchanged.
import { readFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC = readFileSync(ROOT + 'app/steward-root.jsx', 'utf8');

// Lift the real submit() and drive it with our own state setters, so what is under test is the shipped
// control flow rather than a description of it.
function loadSubmit({ setPin: impl }) {
  const at = SRC.indexOf('  const submit = async () => {');
  assert.notEqual(at, -1, 'submit() is gone from StewardForcedPin — re-anchor this test');
  let depth = 0, end = -1;
  for (let i = SRC.indexOf('{', SRC.indexOf('=>', at)); i < SRC.length; i++) {
    if (SRC[i] === '{') depth++; else if (SRC[i] === '}' && --depth === 0) { end = i + 1; break; }
  }
  const body = SRC.slice(SRC.indexOf('async () =>', at), end);
  const state = { busy: false, err: '', pin: '', pin2: '' };
  const scope = {
    busy: false,
    get pin() { return state.pin; },
    setBusy: (v) => { state.busy = v; },
    setErr: (v) => { state.err = v; },
    setPin: (v) => { state.pin = v; },
    setPin2: (v) => { state.pin2 = v; },
    window: { Steward: { setPin: impl } },
    String,
  };
  // `pin`/`pin2` are read as plain consts in the component; bind them as values for this run.
  const run = async (pin, pin2) => {
    const args = ['busy', 'pin', 'pin2', 'setBusy', 'setErr', 'setPin', 'setPin2', 'window', 'String'];
    const vals = [state.busy, pin, pin2, scope.setBusy, scope.setErr, scope.setPin, scope.setPin2, scope.window, String];
    const fn = new Function(...args, `return (${body});`)(...vals);
    await fn();
    return { ...state };
  };
  return { run, state };
}

test('CONTROL: a good PIN goes through and the button is released', async () => {
  const { run } = loadSubmit({ setPin: async () => true });
  const s = await run('Xq7$mB2r', 'Xq7$mB2r');
  assert.equal(s.err, '', 'a successful PIN produced an error message');
});

test('a PIN the engine refuses leaves the screen usable', async () => {
  const { run } = loadSubmit({ setPin: async () => false });
  const s = await run('Xq7$mB2r', 'Xq7$mB2r');
  assert.equal(s.busy, false, 'the button stays disabled after a refusal — the steward cannot try again');
  assert.match(s.err, /\S/, 'nothing told the steward why');
});

test('a THROWN error does not brick the gate', async () => {
  // The finding. crypto.subtle, key derivation and localStorage can all throw here, and this screen has no
  // cancel and no back — a stuck button is the end of the road for that console.
  const { run } = loadSubmit({ setPin: async () => { throw new Error('QuotaExceededError'); } });
  const s = await run('Xq7$mB2r', 'Xq7$mB2r');
  assert.equal(s.busy, false,
    'an exception left "Setting…" disabled for ever — no cancel, no back, and the console renders nothing else');
  assert.match(s.err, /\S/, 'the steward is staring at a dead button with no message at all');
});

test('and the message says what happened, not just that it failed', async () => {
  const { run } = loadSubmit({ setPin: async () => { throw new Error('QuotaExceededError'); } });
  const s = await run('Xq7$mB2r', 'Xq7$mB2r');
  assert.match(s.err, /QuotaExceeded/i, 'the real reason is swallowed, so nobody can act on it or report it');
  assert.match(s.err, /again|reload/i, 'the message must say what to do next');
});

test('the gate still refuses a short PIN before calling the engine', async () => {
  let called = false;
  const { run } = loadSubmit({ setPin: async () => { called = true; return true; } });
  const s = await run('12345', '12345');
  assert.equal(called, false, 'a five-character PIN reached the engine');
  assert.match(s.err, /8/, 'the refusal must state the minimum');
});

test('mismatched entries are caught', async () => {
  let called = false;
  const { run } = loadSubmit({ setPin: async () => { called = true; return true; } });
  const s = await run('Xq7$mB2r', 'Xq7$mB2s');
  assert.equal(called, false, 'a mistyped confirmation was accepted — the steward locks themselves out');
  assert.match(s.err, /match/i);
});
