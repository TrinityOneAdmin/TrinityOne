// A LEGACY BREADCRUMB HAS NO DIRECTION — SO SAY SO. Run: node --test scripts/console-legacy-breadcrumb.test.mjs
//
// HANDOFF-2026-08-05 finding K2, and its proposed fix is REJECTED here on measurement. Recording why, because
// the reasoning is the whole value: the finding is right about the harm and wrong about the remedy, and the
// remedy would have reintroduced the key loss this branch was cut to fix.
//
// THE HARM IS REAL. The breadcrumb used to be the bare string '1', carrying no direction. On the current build
// a bare '1' is resolved as a WRITE — adopt whatever the hardware store holds — so a device upgrading from the
// old build midway through a REMOVAL comes back with the church key adopted and marked valid. A steward who
// deliberately removed a church finds it back, PIN-locked, and is told nothing.
//
// THE PROPOSED REMEDY DOES NOT WORK. K2 says to resolve legacy by the marker's absence rather than by
// direction. Measured against main:
//   * encBlobRemove()  clears ENC_LS immediately, before touching the store   → marker ABSENT + breadcrumb
//   * encBlobWrite()   on native writes the store first and only sets the marker inside the _encConverge()
//                      that follows                                            → marker ABSENT + breadcrumb
// The two are byte-identical in localStorage. Treating absence as a removal deletes the key of every steward
// whose PIN-set was interrupted — precisely the "a PIN set while the Keystore was slow … the next launch
// DELETED the church key and showed Set up a new church" failure the direction-aware breadcrumb exists to stop.
//
// SO: the direction stays unknowable, the safe half stays (never delete on a guess), and what changes is that
// it is no longer SILENT. The device cannot know which way it was going; the steward can.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripComments } from './test-slice.mjs';

const STEWARD = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const MAIN_HAS_LEGACY_REMOVE = true;   // git show main:src/steward.src.js — encBlobRemove writes '1'
const ROOT = readFileSync(new URL('../app/steward-root.jsx', import.meta.url), 'utf8');

function grab(src, sig) {
  let at = src.indexOf(sig);
  assert.notEqual(at, -1, sig + ' is gone from the shipped bundle — re-anchor this test, or rebuild');
  if (src.slice(Math.max(0, at - 6), at) === 'async ') at -= 6;
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

// Drive the SHIPPED encBlobRemoveResume on a fresh-boot device that holds a blob and a breadcrumb.
function boot({ pending, storeHas = true, storeThrows = false }) {
  const ls = new Map();
  ls.set('trinityone.steward.church-key.removing', pending);
  const blob = JSON.stringify({ ct: 'CIPHER', iv: 'iv', salt: 'salt' });
  const Steward = {};
  const events = [];
  const scope = {
    ENC_PENDING_LS: 'trinityone.steward.church-key.removing',
    ENC_LS: 'trinityone.steward.church-key.enc',
    PENDING_WRITE: 'write',
    PENDING_REMOVE: 'remove',
    lsGet: (k) => (ls.has(k) ? ls.get(k) : null),
    lsSet: (k, v) => ls.set(k, String(v)),
    localStorage: { removeItem: (k) => ls.delete(k), getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)) },
    _isNative: () => true,
    _encIntent: { have: null },
    _encIsMarker: (raw) => { try { const o = JSON.parse(raw); return !!(o && o.native && !o.ct); } catch { return false; } },
    _looksLikeKeyBlob: (raw) => { try { const o = JSON.parse(raw); return !!(o && o.ct && o.iv && o.salt); } catch { return false; } },
    _encBound: (p) => p,
    // storeThrows models the Keystore bridge timing out — the case where the resume reaches NO conclusion,
    // which must keep the lock (a key may be there) while saying so, rather than silently.
    _secureStore: async () => { if (storeThrows) throw new Error('keystore did not answer'); return { S: { get: async () => (storeHas ? blob : null) } }; },
    _encConverge: async () => {},
    console: { warn() {} },
    window: { Steward, dispatchEvent: (e) => events.push(e && e.type), CustomEvent: class { constructor(t) { this.type = t; } } },
  };
  const names = Object.keys(scope);
  // encBlobRemoveResume is now a thin wrapper whose only job is to announce the outcome on EVERY exit — the
  // announce used to sit before one of six returns, and an interrupted REMOVAL took a different one. Lift
  // both, plus the stuck flag the wrapper reads, or the call throws ReferenceError into nothing.
  const stuckDecl = (STEWARD.match(/(?:var|let) _encResumeStuck = [^\n]*\n/) || [])[0];
  assert.ok(stuckDecl, 'the resume stuck-flag is gone — re-anchor this test');
  const body = stuckDecl
    + grab(STEWARD, 'async function _encBlobRemoveResumeWork()')
    + '\n' + grab(STEWARD, 'async function encBlobRemoveResume()');
  const fn = new Function(...names, body + '\nreturn encBlobRemoveResume;')(...names.map(n => scope[n]));
  return { run: fn, Steward, ls, events };
}

// The safe half, unchanged: a legacy breadcrumb must never be resolved by deleting.
test('a legacy breadcrumb never deletes the key', async () => {
  assert.ok(MAIN_HAS_LEGACY_REMOVE);
  const b = boot({ pending: '1' });
  await b.run();
  assert.equal(b.ls.get('trinityone.steward.church-key.enc'), JSON.stringify({ native: 1 }),
    'a legacy breadcrumb resolved toward "no key" — this is the deterministic key loss the direction-aware ' +
    'breadcrumb was introduced to stop, and it is reachable on a brand-new church whose steward skipped the ' +
    '12-word backup');
});

// The half that was missing.
test('an adopted key from a directionless breadcrumb is not adopted silently', async () => {
  const b = boot({ pending: '1' });
  await b.run();
  assert.equal(b.Steward.keyResumedUnknown, true,
    'the console adopted a church key left by an operation whose direction it cannot know, and said nothing. ' +
    'If that operation was a REMOVAL, a steward who deliberately removed this church now has it back, ' +
    'PIN-locked, with no indication — an at-rest key on a device they may have handed on');
  assert.ok(b.events.includes('steward-key-resumed'), 'nothing tells the UI to surface it');
});

// A breadcrumb that DOES carry its direction is unambiguous, so it must stay silent — otherwise the notice
// fires on every ordinary interrupted PIN-set and teaches stewards to ignore it.
test('a directional write breadcrumb resumes silently', async () => {
  const b = boot({ pending: 'write' });
  await b.run();
  assert.ok(!b.Steward.keyResumedUnknown,
    'an interrupted WRITE is not ambiguous — the breadcrumb says so. Warning here would make the notice ' +
    'routine, and a routine warning is not read');
});

test('the console surfaces it to the steward', () => {
  assert.match(stripComments(ROOT), /keyResumedUnknown/,
    'the engine records that a church key was adopted from an unknown-direction operation and no screen ever ' +
    'shows it, so the steward cannot act on the one fact only they hold');
});

// ── THE DIRECTION THIS FILE NEVER COVERED (re-review 2026-08-08) ──────────────────────────────────────────
//
// init() decides the boot key state synchronously and the resume does not, so init() answers 'interrupted'
// and leaves the console LOCKED rather than offering "Set up a new church" over a key it cannot yet see. That
// is only safe if the console is told the answer once it is known — and the announce sat before ONE of six
// returns, the write/adopt path.
//
// An interrupted REMOVAL took a different exit. The steward came back to "Console locked" over a device with
// no key and no PIN; Steward.unlock() returns true in that state without clearing `locked`, so the submit
// handler bails and the button sticks on "Unlocking…" for ever, with no escape but a manual reload. On main
// this same state showed the setup screen, which for a deliberate removal was correct — so it was a
// regression, not merely a gap.
test('an interrupted REMOVAL hands the console back, rather than locking it out', async () => {
  const b = boot({ pending: 'remove', storeHas: false });
  await b.run();
  assert.equal(b.events.includes('steward-key'), true,
    'the removal path settled without telling the console. init() left it locked over a device that turns ' +
    'out to have no key, and nothing ever says otherwise — the unlock box cannot be satisfied and the ' +
    'steward has no way back to setup');
  assert.equal(b.Steward.locked, false,
    'the console stayed locked after a completed removal. There is no key and no PIN: this is a dead end');
  // Deliberately NOT asserting the breadcrumb is cleared here: _encConverge is stubbed to a no-op in this
  // harness and that is what clears it in the real path, so the assertion would measure the stub.
});

test('a store that will not answer keeps the lock, but says so', async () => {
  const b = boot({ pending: 'write', storeThrows: true });
  await b.run();
  assert.equal(b.Steward.locked, undefined,
    'the resume cleared the lock after failing to read the store — it does not know whether a key is there, ' +
    'and offering "Set up a new church" could overwrite a church key');
  assert.equal(b.Steward.keyStoreStuck, true,
    'the console was left locked with nothing said, which is the dead end this whole change exists to ' +
    'remove: the steward needs to be told the storage did not answer');
  assert.equal(b.events.includes('steward-key'), true, 'the UI was never re-rendered, so nothing can surface it');
});
