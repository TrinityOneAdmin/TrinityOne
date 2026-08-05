// "REMEMBER ME ON THIS DEVICE" MUST OPEN THE LOCK, NEVER REMOVE IT.
// Run: node --test scripts/remember-device.test.mjs
//
// Asked for by the owner, 2026-08-05; spec in reference/HANDOFF-2026-08-05.md §2.
//
// THE TRAP THIS FEATURE SITS ON. The member lock is armed by the mere PRESENCE of the encrypted seed blob —
// app/app.jsx's lockNow() is `hasEnc() && !sessionMnemonic`. The lazy way to build "remember me" is therefore
// to delete the blob, and that does not open the lock, it DELETES the lock. It is the exact bypass fixed in
// 23f0798 six commits ago: with the blob gone the phone is open to ANYONE holding it, permanently, and the
// 30-day window is meaningless because there is nothing left to expire back to. So the invariant these tests
// exist to hold is narrow and absolute — the blob is never removed, and "remembered" means only that
// sessionMnemonic is populated at boot.
//
// WHAT IT TRADES, which the copy has to say. The PIN protects against someone holding the phone. So this
// feature means: anyone who can unlock this phone can open your church. There is no version that keeps the
// protection and skips the PIN, because the PIN *is* the protection.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripComments } from './test-slice.mjs';

const SRC = readFileSync(new URL('../src/identity.src.js', import.meta.url), 'utf8');
const VENDOR = readFileSync(new URL('../vendor/identity.js', import.meta.url), 'utf8');
const GATE = readFileSync(new URL('../app/identity.jsx', import.meta.url), 'utf8');
const EXTRAS = readFileSync(new URL('../app/identity-extras.jsx', import.meta.url), 'utf8');

const DAY = 86400;
const nowSec = () => Math.floor(Date.now() / 1000);

// Lift the shipped storage helpers and run them against a fake hardware store. The dynamic
// `import('@aparajita/capacitor-secure-storage')` is the one thing replaced — esbuild inlines the plugin, and
// driving the real one needs a Capacitor custom platform, which recurses until the heap dies. Everything
// else here is the shipped body.
function store({ native = true, breakWrites = false } = {}) {
  const sec = new Map();
  const calls = [];
  const SecureStorage = {
    async get(k) { calls.push(['get', k]); return sec.has(k) ? sec.get(k) : null; },
    async set(k, v) { calls.push(['set', k]); if (!breakWrites) sec.set(k, String(v)); },
    async remove(k) { calls.push(['remove', k]); sec.delete(k); },
  };
  const pick = (name) => {
    const at = SRC.indexOf('async function ' + name);
    assert.notEqual(at, -1, name + ' is gone — re-anchor this test');
    let depth = 0, q = '';
    for (let i = SRC.indexOf('{', at); i < SRC.length; i++) {
      const c = SRC[i], prev = SRC[i - 1];
      if (q) { if (c === q && prev !== '\\') q = ''; continue; }
      if (c === '"' || c === "'" || c === '`') { q = c; continue; }
      if (c === '/' && SRC[i + 1] === '/') { i = SRC.indexOf('\n', i); if (i === -1) break; continue; }
      if (c === '{') depth++; else if (c === '}' && --depth === 0) return SRC.slice(at, i + 1);
    }
    assert.fail('could not find the end of ' + name);
  };
  const bodies = ['rememberRead', 'rememberWrite', 'rememberClear'].map(pick).join('\n')
    // `({ SecureStorage })` would NOT work here: the destructuring target of the same name is in its temporal
    // dead zone inside its own initialiser, so it throws a ReferenceError straight into the catch and every
    // write reports a clean `false`. A test that fails for a reason it is not testing.
    .replace(/await import\('@aparajita\/capacitor-secure-storage'\)/g, '({ SecureStorage: __SS })');
  const scope = {
    __SS: SecureStorage,
    REMEMBER_KEY: 'trinityone.nostr.remember',
    isNative: () => native,
    nowSec: () => Math.floor(Date.now() / 1000),
    console: { warn() {} },
  };
  const names = Object.keys(scope);
  const api = new Function(...names, bodies + '\nreturn { rememberRead, rememberWrite, rememberClear };')(...names.map(n => scope[n]));
  return { ...api, sec, calls };
}

const SEED = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

test('a remembered seed is stored with its expiry, in the secure store', async () => {
  const s = store();
  assert.equal(await s.rememberWrite(SEED, nowSec() + 30 * DAY), true);
  const rec = JSON.parse(s.sec.get('trinityone.nostr.remember'));
  assert.equal(rec.m, SEED);
  assert.ok(rec.until > nowSec() + 29 * DAY, 'the window is not the 30 days the tickbox promises');
  assert.ok(!s.calls.some(c => c[0] === 'set' && /\.enc$/.test(c[1])),
    'remembering touched the encrypted blob’s slot. It must be left exactly as it is — the blob IS the lock');
});

// THE 30-DAY BOUND, which is the whole reason the owner chose this over "never ask again" — a phone lost and
// not missed quickly re-locks by itself. Enforcement lives in rememberRead rather than in each caller, so this
// is a behavioural assertion and a sabotage of the comparison goes red. The first version of this test checked
// only that init() mentioned a timestamp, and a sabotage removing the comparison passed it.
test('an expired record is refused, so the window really ends', async () => {
  const s = store();
  s.sec.set('trinityone.nostr.remember', JSON.stringify({ m: SEED, until: nowSec() - 60 }));
  assert.equal(await s.rememberRead(), null,
    'an expired remember record was still handed back — the 30-day bound is decorative and the phone stays ' +
    'open for ever, which is precisely what the owner chose a bounded window to avoid');
  assert.equal(s.sec.size, 0, 'the lapsed record was left behind, to be re-examined on every launch for ever');
});

test('a record one second inside the window is still honoured', async () => {
  const s = store();
  s.sec.set('trinityone.nostr.remember', JSON.stringify({ m: SEED, until: nowSec() + 2 }));
  const r = await s.rememberRead();
  assert.ok(r && r.m === SEED, 'a live record was refused — the feature would never work at all');
});

test('a write that did not land is reported as failure, not success', async () => {
  const s = store({ breakWrites: true });
  assert.equal(await s.rememberWrite(SEED, nowSec() + 30 * DAY), false,
    'the hardware store silently no-opped the write and rememberWrite said it worked. The member is told the ' +
    'phone will stay open; in 30 days it asks for a PIN they were encouraged to stop typing and may no ' +
    'longer have. secureSetEnc’s own comment requires this read-back, and importMnemonic still skips it (M8)');
});

test('it is refused outright on web', async () => {
  const s = store({ native: false });
  assert.equal(await s.rememberWrite(SEED, nowSec() + 30 * DAY), false,
    'on web the seed would sit in localStorage, far weaker than a hardware store, against a threat model ' +
    'whose whole premise is a seized device');
  assert.equal(await s.rememberRead(), null);
});

test('turning it off clears the seed AND the expiry together', async () => {
  const s = store();
  await s.rememberWrite(SEED, nowSec() + 30 * DAY);
  await s.rememberClear();
  assert.equal(s.sec.size, 0, 'the remembered seed survived being turned off');
  assert.equal(await s.rememberRead(), null);
});

// ── the invariant, checked against the SHIPPED bundle ──────────────────────────────────────────────────────

test('nothing in the remember path removes the encrypted blob', () => {
  const code = stripComments(SRC);
  for (const name of ['rememberRead', 'rememberWrite', 'rememberClear']) {
    const at = code.indexOf('async function ' + name);
    const body = code.slice(at, code.indexOf('\n}', at));
    assert.ok(!/clearEnc|secureRemoveEnc|removeItem\(ENC_KEY|remove\(ENC_KEY/.test(body),
      name + ' removes the encrypted blob. That does not open the lock, it deletes the lock — the 23f0798 ' +
      'bypass, rebuilt as a feature: the phone would be open to anyone holding it, permanently');
  }
  assert.match(VENDOR, /trinityone\.nostr\.remember/, 'the shipped bundle predates this feature — rebuild');
});

test('the seed is restored at boot instead of the blob being dropped', () => {
  const code = stripComments(SRC);
  const at = code.indexOf('async function init()');
  const body = code.slice(at, code.indexOf('\n}', at));
  assert.match(body, /sessionMnemonic = r\.m/,
    'boot does not populate the in-memory seed, so "remembered" must be being achieved some other way — and ' +
    'every other way removes the lock rather than opening it');
  // Expiry is enforced inside rememberRead (and asserted behaviourally above), so init only has to refuse a
  // record that is not live. Both halves must be present: reading it and checking it.
  assert.match(body, /rememberRead\(\)/, 'boot does not consult the remembered record at all');
  assert.match(body, /r\.until > nowSec\(\)/,
    'boot accepts whatever the store holds without checking the window — enforcement then rests entirely on ' +
    'one function, and the 30-day bound is one edit away from being permanent');
  assert.ok(!/clearEnc|localStorage.removeItem\(ENC_KEY\)/.test(body),
    'init() drops the encrypted blob on the remembered path — the bypass');
});

// "Lock now" is what a member reaches for when someone is about to pick up their phone. If the remembered
// seed outlives it, restarting the app undoes it.
test('locking clears the remembered seed', () => {
  const code = stripComments(SRC);
  const at = code.indexOf('  lock() {');
  const body = code.slice(at, code.indexOf('\n  },', at));
  assert.match(body, /rememberClear\(\)/,
    '"Lock now" leaves the remembered seed in place, so the next launch opens the account again — the one ' +
    'control for "someone is about to hold this phone" is undone by restarting the app');
});

test('removing the PIN and regenerating both clear it', () => {
  const code = stripComments(SRC);
  for (const [anchor, why] of [
    ['async removePin(pin) {', 'with no PIN left to skip, a remembered copy is a second plaintext seed at rest guarding nothing'],
    ['async regenerate() {', 'a new identity would leave the PREVIOUS one’s seed remembered on the device'],
  ]) {
    const at = code.indexOf(anchor);
    assert.notEqual(at, -1, anchor + ' moved — re-anchor');
    assert.match(code.slice(at, code.indexOf('\n  },', at)), /rememberClear\(\)/, why);
  }
});

// ── the copy, which is half the feature ────────────────────────────────────────────────────────────────────

test('the tickbox states what it trades, not "stay signed in"', () => {
  const gate = stripComments(GATE);
  assert.match(gate, /rememberDevice|canRemember/, 'the unlock screen does not offer the option at all');
  assert.match(gate, /Anyone who can unlock this phone/i,
    'the tickbox does not say the actual consequence — that anyone who can open the phone can open the ' +
    'church. "Stay signed in" describes the convenience and hides the trade, and this is the one screen ' +
    'where the member is deciding exactly that trade');
  assert.match(gate, /30 days/, 'the bounded window is not stated, so it reads as "never ask again"');
});

test('the tickbox is off by default and never remembered as a default', () => {
  const gate = stripComments(GATE);
  // identity.jsx aliases React.useState as useId (see the top of the file) — match the declaration itself
  // rather than a hook name, so this keeps meaning what it says if the alias changes.
  assert.match(gate, /\[\s*remember\s*,\s*setRemember\s*\]\s*=\s*use\w*\(\s*false\s*\)/,
    'the remember tickbox must initialise to false — it decides who can open the member’s church and has to ' +
    'be ticked deliberately, not inherited from the last time they were in a hurry');
  assert.ok(!/localStorage\.(get|set)Item\(\s*['"][^'"]*remember/i.test(gate),
    'the tickbox’s own state is persisted, so it would come back pre-ticked — the spec requires it to be ' +
    'ticked deliberately, every time');
});

test('it is reversible from the profile screen', () => {
  assert.match(stripComments(EXTRAS), /forgetDevice/,
    'there is no way to turn "remember me" off once it is on, so the only exit is waiting 30 days');
});
