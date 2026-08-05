// A FILE RESTORE MUST NOT STRAND THE KEY IT IS REPLACING. Run: node --test scripts/backup-restore-keeps-key.test.mjs
//
// HANDOFF-2026-08-05 finding K1. cd67c7a established the rule for the phrase-restore path: do not destroy the
// key you are replacing before the replacement exists, because the restored seed lives in MEMORY ONLY until the
// forced-PIN modal encrypts it, and anything that ends the JS context in that window leaves the device with no
// church key at all. The FILE-restore path never got the same treatment, and it breaks the rule twice over:
//
//   1. `restoreLocal` happily writes `trinityone.steward.church-key.enc` out of the backup file — the OTHER
//      device's device-bound wrap. That machine's PIN can never unwrap it here.
//   2. It then unconditionally removed THIS device's copy of that key. On native that key is only the MARKER;
//      the ciphertext itself lives in the hardware store, which nothing here touches. So the marker goes, the
//      blob stays orphaned, hasEnc() reads false — and a steward who closes the app before setting the new PIN
//      comes back to "Set up a new church" with their real key still sitting in the Keystore, unreferenced.
//
// The seed exclusion already in restoreLocal is the precedent: some keys must never come out of a backup file,
// whatever the prefix list says. The device-bound wrap is one of them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../app/backup.jsx', import.meta.url), 'utf8');
const ENC_KEY = 'trinityone.steward.church-key.enc';

function grab(src, sig) {
  let at = src.indexOf(sig);
  assert.notEqual(at, -1, sig + ' is gone — re-anchor this test');
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

// Run the SHIPPED applySteward + restoreLocal against a fake localStorage.
function harness(store) {
  const map = new Map(Object.entries(store || {}));
  const localStorage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
  const restored = [];
  const Steward = { restoreKey: (m) => { restored.push(m); return { npub: 'npub1fake' }; } };
  const body = [
    grab(SRC, 'function restoreLocal(map, allow)'),
    grab(SRC, 'function applySteward(obj)'),
    "const STEWARD_PREFIXES = ['trinityone.steward'];",
  ].join('\n');
  const fn = new Function('localStorage', 'window', body + '\nreturn { applySteward };')(localStorage, { Steward });
  return { applySteward: fn.applySteward, get: (k) => (map.has(k) ? map.get(k) : null), restored, map };
}

// The backup file carries the OTHER device's wrap, because snapshot() takes the whole
// `trinityone.steward` prefix.
const backup = () => ({
  kind: 'steward', churchKey: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
  local: { 'trinityone.steward.name': 'Test Church', [ENC_KEY]: JSON.stringify({ ct: 'OTHER', iv: 'x', salt: 'y' }) },
});

test('a file restore never writes another device’s key wrap', () => {
  const h = harness({});
  h.applySteward(backup());
  assert.equal(h.get(ENC_KEY), null,
    'the backup file’s church-key.enc was written into localStorage. That is the OTHER device’s device-bound ' +
    'wrap — this machine can never unwrap it, so the steward lands on "Console locked" holding a PIN that ' +
    'cannot work');
});

// THE ONE THAT LOSES A KEY. On native, church-key.enc in localStorage is only the marker `{native:1}`; the
// ciphertext is in the hardware store, which this path never touches. Removing the marker makes hasEnc()
// false while the blob stays in the Keystore with nothing pointing at it.
test('a file restore leaves this device’s own key marker alone', () => {
  const marker = JSON.stringify({ native: 1 });
  const h = harness({ [ENC_KEY]: marker });
  h.applySteward(backup());
  assert.equal(h.get(ENC_KEY), marker,
    'the restore removed this device’s own key marker. The real ciphertext is still in the hardware store, ' +
    'now unreferenced — a steward who closes the app before setting the new PIN comes back to "Set up a new ' +
    'church" having lost a key that is still physically present. This is exactly the loss cd67c7a fixed on ' +
    'the phrase-restore path');
  assert.equal(h.restored.length, 1, 'the restore should still have handed the phrase to restoreKey');
});

test('the rest of the backup still restores', () => {
  const h = harness({});
  h.applySteward(backup());
  assert.equal(h.get('trinityone.steward.name'), 'Test Church',
    'excluding the key wrap must not stop ordinary steward settings being restored');
});
