// Restoring a church must not DESTROY the church key.
// Run: node --test scripts/console-restore-keeps-key.test.mjs
//
// Found on a phone, 2026-08-04. Settings → Security → "Restore from a recovery phrase" deleted the console's
// church key and installed nothing — the console reloaded to the blank "Set up a new church" screen. Measured:
// trinityone.steward.church-key.enc was {"native":1} before and absent after.
//
// The first fix removed `window.location.reload()` from the three restore routes. An adversarial review found
// that was necessary but NOT sufficient, and that the reload had been doing two jobs nobody had enumerated:
//
//   1. It made the memory-only window unreachable. restoreKey() destroyed the previous key BEFORE the forced
//      PIN modal persisted the new one, so with the reload gone the seed sat in a JS local for as long as the
//      steward took to type a passphrase — and an idle auto-lock, a backgrounded WebView or a crash in that
//      window lost the church. Fixed by not destroying first: setPin() overwrites the same slot anyway, so an
//      ABANDONED restore now leaves the previous key intact and openable.
//   2. It reset the module's per-church state. Without it a whole-KEY replacement carried church A's
//      name/care/media rings into church B, and the roster effect republished them as B's envelopes —
//      replaceable events, so B's originals were overwritten and A's keys were handed to B's congregation.
//      Fixed by _resetChurchScopedState().
//
// Plus two more the review surfaced: no BIP-39 checksum (twelve mistyped words destroyed the real key and
// installed a stranger's, on a screen showing no npub to contradict it), and lock() happily discarding a seed
// that had never been persisted.
//
// STRENGTH, stated honestly: these are STRUCTURAL checks. The handlers are React closures in a JSX file and
// restoreKey/lock live inside a bundled object literal with a live relay pool, so neither can be lifted and
// executed the way console-key-secure-store.test.mjs executes the storage helpers. A green tick means the
// guards are present and no route navigates mid-restore. The end-to-end proof is a device.
//
// The route scan below deliberately does NOT hardcode a list of three handlers — the previous version did, and
// a fourth route would have walked straight past it. It finds every function that calls into the restore path,
// in both files, and checks all of them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';

const DASH = readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8');
const ROOT = readFileSync(new URL('../app/steward-root.jsx', import.meta.url), 'utf8');
const BACKUP = readFileSync(new URL('../app/backup.jsx', import.meta.url), 'utf8');
const STEWARD = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');

// Any way of throwing the page away, not just the one spelling that shipped. `location.reload()` was the
// original; an evasion audit named href-assignment, replace/assign and history.go(0) as equivalents that the
// first version of this test would have missed.
const NAVIGATES = /location\s*\.\s*reload\s*\(|location\s*\.\s*(?:replace|assign)\s*\(|location\s*\.\s*href\s*=|history\s*\.\s*go\s*\(\s*0\s*\)/;

// Every enclosing function that reaches the restore path, found by scanning for the calls rather than by
// naming handlers. `const doRestore` appears TWICE in stew-dashboard.jsx (the backup-data restore at ~5049 and
// the church-key route at ~5199) and the old anchor picked the right one only because the other was `async`.
function routesIn(src, file) {
  const out = [];
  for (const call of ['Steward.restoreKey(', 'Steward.adoptChurch(', 'TrinityBackup.applySteward(', 'applySteward(']) {
    let i = -1;
    while ((i = src.indexOf(call, i + 1)) !== -1) {
      // walk back to the nearest enclosing arrow/function declaration and read the whole thing
      const head = src.lastIndexOf('\n  const ', i);
      const start = head === -1 ? Math.max(0, src.lastIndexOf('\n  function ', i)) : head;
      if (start <= 0) continue;
      out.push({ file, call, body: fnBody(src, start + 1, `${file} handler calling ${call}`) });
    }
  }
  return out;
}

test('no restore route throws the page away while the seed is memory-only', () => {
  const routes = [...routesIn(DASH, 'stew-dashboard.jsx'), ...routesIn(BACKUP, 'backup.jsx')];
  assert.ok(routes.length >= 3, `expected to find the restore routes; found ${routes.length} — re-anchor this scan`);
  for (const r of routes) {
    assert.ok(!NAVIGATES.test(r.body),
      `${r.file}: a handler calling ${r.call} navigates or reloads. restoreKey keeps the restored seed in ` +
      `memory until the forced PIN modal persists it — throwing the page away here loses the church.`);
  }
});

test('restoreKey checksums the phrase BEFORE it touches anything', () => {
  const fn = fnBody(STEWARD, 'restoreKey(mnemonic)', 'restoreKey');
  assert.match(fn, /validateMnemonic\(/,
    'restoreKey no longer checksums the phrase — twelve arbitrary words derive a valid key and overwrite the real church');
  const check = fn.indexOf('validateMnemonic('), mutate = fn.indexOf('setKey(');
  assert.ok(check !== -1 && mutate !== -1 && check < mutate,
    'the checksum must run BEFORE setKey — validating after the first mutation is not validating');
});

test('restoreKey does not destroy the previous key before the new one is persisted', () => {
  const fn = fnBody(STEWARD, 'restoreKey(mnemonic)', 'restoreKey');
  assert.ok(!/encBlobRemove\(/.test(fn),
    'restoreKey erases the stored key again. setPin() overwrites the same slot, so this buys nothing and ' +
    'turns an abandoned restore into permanent key loss.');
  assert.ok(!/removeItem\(\s*KEY_LS|lsRemove\(\s*KEY_LS/.test(fn),
    'restoreKey drops the plaintext seed again — same failure, legacy path');
  assert.match(fn, /_setNeedsPin\(\s*true\s*\)/,
    'restoreKey no longer forces the PIN modal, so the restored seed would never be persisted at all');
});

test('restoreKey clears the state scoped to the church it just replaced', () => {
  const fn = fnBody(STEWARD, 'restoreKey(mnemonic)', 'restoreKey');
  assert.match(fn, /_resetChurchScopedState\(\)/,
    'a whole-key replacement carries the old church\'s rings into the new one, and the roster effect then ' +
    'republishes them as the new church\'s envelopes (AUDIT-2026-07-27, same family)');
  const reset = fnBody(STEWARD, 'function _resetChurchScopedState', '_resetChurchScopedState');
  // The mint gates are the dangerous half: carried across they answer "yes we looked" for a church nobody
  // has looked at, which is what lets a stale ring be published as a new church's key.
  for (const gate of ['_nameKeyChecked', '_careKeyChecked', '_mediaKeyChecked']) {
    assert.ok(reset.includes(gate), `_resetChurchScopedState no longer clears ${gate} — the mint gate lies for the new church`);
  }
  assert.match(reset, /_authedRelays\.clear\(\)/,
    'sockets that signed a NIP-42 challenge as the PREVIOUS church must not count as authed for the new one');
});

test('lock() refuses to discard a seed that has never been persisted', () => {
  const fn = fnBody(STEWARD, 'lock()', 'Steward.lock');
  assert.match(fn, /if\s*\(\s*needsPin\s*\)\s*return/,
    'lock() nulls currentMnemonic. While needsPin is set that is the only copy of the church key, so the ' +
    '10-minute idle timer destroys the church from the forced-PIN screen.');
});

test('the forced-PIN screen never advises a reload', () => {
  // This fires exactly when the seed is memory-only, and it used to say "Try again, or reload this page."
  const fn = fnBody(ROOT, 'const finishWithPin', 'finishWithPin');
  assert.ok(!/reload this page/i.test(ROOT),
    'steward-root.jsx tells the steward to reload; on the forced-PIN screen that destroys the church');
  assert.ok(!NAVIGATES.test(fn), 'finishWithPin navigates — the seed is not persisted until setPin resolves');
});
