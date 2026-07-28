// A locked app must SAY it is locked. Run: node --test scripts/lock-gate.test.mjs
//
// Found on a real phone, 2026-07-28. The front-door PIN gate read TrinityIdentity.isLocked() ONCE,
// synchronously, at first render. On native the identity module can still be loading at that moment, so the
// guard fell through to false, the gate never rendered, and the app opened looking entirely normal — Today
// screen, verse of the day — while holding no identity and reading the relay anonymously.
//
// For months that was invisible: kind-0 was public, so every name still resolved and nothing looked wrong.
// Closing that hole (AUDIT-2026-07-27) turned the silent failure into a congregation of nameless people, and
// it read as a bug in the name encryption. It was not. An empty church and a broken church must never look
// the same — that confusion is the most expensive failure mode in this codebase.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const APP = readFileSync(new URL('../app/app.jsx', import.meta.url), 'utf8');

test('locked-ness is re-checked, not sampled once at first render', () => {
  assert.match(APP, /const lockNow = \(\) =>/, 'the lock check is inlined again — it must be one function used by both the initial state and the refresh');
  assert.match(APP, /setInterval\(\(\) => \{ refreshLock\(\)/,
    'nothing re-checks the lock state, so an identity module that finishes loading after first render leaves the app open with no identity');
  const at = APP.indexOf('let n = 0;');
  assert.match(APP.slice(at, at + 200), /clearInterval\(t\)/, 'the re-check must be bounded, not a permanent timer');
});

test('a PIN blob with no identity counts as locked, whatever the module reports', () => {
  const at = APP.indexOf('const lockNow = () =>');
  const body = APP.slice(at, at + 700);
  assert.match(body, /hasPin\(\) && !\(window\.Fellowship && window\.Fellowship\.myPubkey\)/,
    'the defensive clause is gone — a half-initialised identity module can report unlocked while holding no key');
});

test('the Bible-only escape says the account is locked', () => {
  // The escape is a good feature — a forgotten PIN must not brick the phone. But it drops the app into
  // exactly the identity-less state that hid this bug, so it has to be visibly a locked mode.
  assert.match(APP, /commLocked && gateEscaped/, 'nothing renders while the gate is escaped, so locked mode looks identical to the normal app');
  const at = APP.indexOf('commLocked && gateEscaped');
  const body = APP.slice(at, at + 1200);
  assert.match(body, /locked/i, 'the locked-mode indicator does not say it is locked');
  assert.match(body, /setGateEscaped\(false\)/, 'there is no way back to the unlock gate');
});
