// A PIN field must never force the numeric keypad. Run: node --test scripts/pin-keyboard.test.mjs
//
// URGENT, 2026-07-28: "the pin I was forced to set had letters in it, now the pin keyboard only gives me
// numbers to enter with." Caused by me. The same day I made the PIN screens demand a passphrase — refusing
// bare digits under 12 characters — the UNLOCK screens still carried inputMode="numeric", so the phone showed
// a keypad with no letters. The set screen invited words; the unlock screen would not accept them. That is a
// lockout on the account you have just created, on a product whose PIN cannot be reset.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('../app/', import.meta.url);
const files = readdirSync(dir).filter(f => f.endsWith('.jsx'));

test('no password field forces the numeric keypad', () => {
  const bad = [];
  for (const f of files) {
    const src = readFileSync(new URL(f, dir), 'utf8');
    src.split('\n').forEach((line, i) => {
      if (!/inputMode=["']numeric["']/.test(line)) return;
      if (/type=["']password["']/.test(line) || /\bpin\b/i.test(line)) bad.push(`${f}:${i + 1}`);
    });
  }
  assert.deepEqual(bad, [], 'these PIN fields would show a keypad with no letters, locking out anyone who set a passphrase');
});

test('and no PIN screen still promises digits', () => {
  const bad = [];
  for (const f of files) {
    const src = readFileSync(new URL(f, dir), 'utf8');
    if (/placeholder=["'][^"']*\d\+ digits/.test(src)) bad.push(f);
  }
  assert.deepEqual(bad, [], 'a placeholder still asks for digits while the validator demands words');
});

test('the strength rule and the keyboard agree', () => {
  // The pair that caused the lockout: the set screen demanded a passphrase while the unlock screen offered
  // only a keypad. The rule is now 6 characters with digits allowed — but the UNLOCK screens must still take
  // letters regardless, because someone may already hold a passphrase from the stricter version and a PIN
  // cannot be reset. Change these two together or not at all.
  const dash = readFileSync(new URL('stew-dashboard.jsx', dir), 'utf8');
  const root = readFileSync(new URL('steward-root.jsx', dir), 'utf8');
  // AUDIT-2026-07-30: the steward floor moved 6 -> 8 and the screens now ask for a generated password or a
  // four-word passphrase. This canary did its job — it stopped the change until the keyboard was re-checked.
  // It WAS re-checked: no steward PIN field sets inputMode at all, so they get the ordinary text keyboard. The
  // only numeric field in the console is a pairing code (placeholder "0000"), which is not a password field.
  assert.match(dash, /length < 8\) \{ setPinErr/, 'the wizard minimum changed — check the keyboard still matches');
  assert.match(root, /length < 8\) \{ setErr/, 'the forced gate minimum changed — check the keyboard still matches');
  for (const [name, src] of [['stew-dashboard.jsx', dash], ['steward-root.jsx', root], ['identity.jsx', readFileSync(new URL('identity.jsx', dir), 'utf8')]]) {
    assert.doesNotMatch(src, /inputMode=["']numeric["'][^\n]*type=["']password["']|type=["']password["'][^\n]*inputMode=["']numeric["']/,
      name + ' has a password field pinned to the numeric keypad — anyone holding a passphrase cannot unlock');
  }
});
