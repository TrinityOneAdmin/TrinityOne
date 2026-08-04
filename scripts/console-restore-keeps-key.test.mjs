// Restoring a church must not DESTROY the church key.
// Run: node --test scripts/console-restore-keeps-key.test.mjs
//
// Found on a phone, 2026-08-04, build 198. Settings → Security → "Restore from a recovery phrase" deleted the
// console's church key and installed nothing: the console reloaded to the blank "Set up a new church" screen.
// Measured — `trinityone.steward.church-key.enc` was `{"native":1}` before and absent after.
//
// The mechanism, which is why the guard below is shaped the way it is:
//
//   restoreKey() is DELIBERATELY memory-only. It calls setKey() (which only sets `currentMnemonic`), then
//   removes the PREVIOUS key from both localStorage and the hardware store, then sets needsPin so the forced
//   PIN modal can encrypt and persist the new seed. StewardRoot renders <StewardForcedPin/> off that flag.
//
//   So `window.location.reload()` anywhere between restoreKey() and the PIN being set throws away the only
//   copy of the restored seed — after the old one has already been erased. The device ends up with neither.
//   Deterministic, not a race. All THREE restore routes did it: the phrase, the QR handoff, and the backup
//   file (applySteward calls the same restoreKey and removes church-key.enc itself).
//
// These are STRUCTURAL checks over app/stew-dashboard.jsx, and that is a real limit — they prove the reload is
// absent, not that a restore end-to-end keeps the key. The handlers are React closures over component state
// inside a JSX file with no DOM harness in this suite, so they cannot be lifted and executed the way
// console-key-secure-store.test.mjs executes the storage helpers. A green tick here means "no route reloads
// mid-restore". The end-to-end proof is a phone, and it is written up in the handoff.
//
// Verified to FAIL against the pre-fix code (all three handlers), not just to pass against the new.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';

const DASH = readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8');
const STEWARD = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');

// Anchor on the DECLARATION, never a call site — data-integrity-guards was bitten by exactly that.
const ROUTES = [
  ['const adoptScanned = (payload)', 'the QR church-handoff route'],
  ['const doRestore = ()', 'the recovery-phrase route'],
  ['const restoreFromFile = (e)', 'the backup-file route'],
];

for (const [anchor, what] of ROUTES) {
  test(`${what} does not reload while the restored key is memory-only`, () => {
    const fn = fnBody(DASH, anchor, what);
    assert.ok(
      !/location\s*\.\s*reload\s*\(/.test(fn),
      `${what} calls location.reload(). restoreKey() has already erased the previous key and keeps the new ` +
      `one in memory until the forced PIN modal persists it — a reload here destroys both, and the steward ` +
      `lands on "Set up a new church" having lost the church. Let needsPin gate the console instead.`
    );
  });
}

test('every restore route still hands off to the forced-PIN gate', () => {
  // If a future change makes restoreKey persist on its own, this premise changes and the reload guard above
  // stops being load-bearing. Pin the premise so that change is deliberate rather than silent.
  const fn = fnBody(STEWARD, 'restoreKey(mnemonic)', 'restoreKey');
  assert.match(fn, /_setNeedsPin\(\s*true\s*\)/,
    'restoreKey no longer forces the PIN modal — the restored seed would never be persisted at all');
  assert.match(fn, /encBlobRemove\(\)/,
    'restoreKey no longer clears the previous key from the hardware store (the at-rest exposure S6 closed)');
  assert.ok(!/localStorage\.setItem\(\s*KEY_LS/.test(fn),
    'restoreKey now writes the seed itself — re-read this file: the reload guards above assume it does not');
});

test('the QR handoff route goes through restoreKey rather than persisting its own copy', () => {
  const fn = fnBody(STEWARD, 'adoptChurch(payload)', 'adoptChurch');
  assert.match(fn, /restoreKey\(/, 'adoptChurch must reuse restoreKey, not grow a second persistence path');
});
