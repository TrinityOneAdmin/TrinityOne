// THE CONSOLE MUST NOT OFFER TO CREATE A CHURCH OVER A KEY IT IS ABOUT TO RECOVER.
// Run: node --test scripts/console-boot-key-state.test.mjs
//
// THE DEFECT (pre-merge audit 2026-08-07, finding 1). init() calls encBlobRemoveResume() fire-and-forget.
// That function is async and reaches its first `await` before it touches the store, so init() runs straight
// on, reads the ENC_LS marker while it is still absent, and reports "no key". The console renders
// StewardWelcome — "Set up a new church" — over a device whose church key is sitting in the Keystore waiting
// to be adopted.
//
// The steward then does the obvious thing:
//     tap "Set up a new church" -> createKey() -> forced PIN -> setPin() -> the recovered key is OVERWRITTEN.
//
// Commit 2f383ab stopped the key being deleted automatically. It left the screen that leads to it being
// deleted by hand, which is the same outcome with an extra tap.
//
// WHY THE FIX IS A SYNCHRONOUS READ, NOT AN EVENT. The obvious repair is to have the resume dispatch
// 'steward-key' once it has adopted the blob. That is a race: if the steward tapped through during the window,
// createKey() has already run and needsPin is set, and the late event flips the root to an unlock screen over
// a brand-new unencrypted seed — a worse state than the one being fixed. The breadcrumb is plain localStorage
// and is readable in init() at the same instant, so the decision is made BEFORE the first render and the async
// resume only confirms or clears it.
//
// The console renders `ks.locked ? <StewardUnlock/> : !ks.has ? <StewardWelcome/>`, so "locked" is the safe
// answer under uncertainty: an unlock screen cannot destroy anything, and a stale breadcrumb self-heals when
// the resume clears it and re-announces.
//
// BEHAVIOURAL: this lifts the shipped decision and drives it over a fake localStorage. It does not grep for
// the shape of a fix. `node scripts/sabotage.mjs boot-key` proves it goes red when the guard is removed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC = readFileSync(ROOT + 'src/steward.src.js', 'utf8');
const VENDOR = readFileSync(ROOT + 'vendor/steward.js', 'utf8');

function lift(store) {
  const at = SRC.indexOf('function _bootKeyState(');
  assert.notEqual(at, -1,
    '_bootKeyState() does not exist in src/steward.src.js.\n\n' +
    '  If this is the first run, that IS the defect: init() decides the boot key state inline and never\n' +
    '  consults the interrupted-write breadcrumb, so a device holding a recoverable church key is shown\n' +
    '  "Set up a new church" — and the next tap overwrites the key.');
  let depth = 0, q = '';
  let body;
  for (let i = SRC.indexOf('{', at); i < SRC.length; i++) {
    const c = SRC[i], prev = SRC[i - 1];
    if (q) { if (c === q && prev !== '\\') q = ''; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '/' && SRC[i + 1] === '/') { i = SRC.indexOf('\n', i); if (i === -1) break; continue; }
    if (c === '{') depth++; else if (c === '}' && --depth === 0) { body = SRC.slice(at, i + 1); break; }
  }
  assert.ok(body, 'could not find the end of _bootKeyState');
  const scope = {
    lsGet: (k) => (k in store ? store[k] : null),
    KEY_LS: 'trinityone.steward.key',
    ENC_LS: 'trinityone.steward.church-key.enc',
    ENC_PENDING_LS: 'trinityone.steward.church-key.removing',
  };
  const names = Object.keys(scope);
  return new Function(...names, body + '\nreturn _bootKeyState;')(...names.map(n => scope[n]));
}

const PLAIN = 'trinityone.steward.key';
const MARKER = 'trinityone.steward.church-key.enc';
const CRUMB = 'trinityone.steward.church-key.removing';

test('an interrupted key write is NOT reported as "this device has no church"', () => {
  const state = lift({ [CRUMB]: 'write' })();
  assert.notEqual(state, 'none',
    'THE BUG: a device whose church key is in the Keystore awaiting adoption reports "no key", so the ' +
    'console shows "Set up a new church" — and creating one overwrites the key that was about to come back');
  assert.equal(state, 'interrupted');
});

test('an interrupted REMOVAL is treated the same way — the direction is unknowable', () => {
  // encBlobRemove() clears the marker up front and encBlobWrite() does not set it until after the store
  // write, so both interruptions leave marker-absent + breadcrumb. They are byte-identical here. Guessing
  // "removal" would delete a key; guessing "write" only shows a lock screen someone can dismiss.
  assert.equal(lift({ [CRUMB]: 'remove' })(), 'interrupted');
});

test('a settled key still reports locked, and the marker wins over a stale crumb', () => {
  assert.equal(lift({ [MARKER]: '{"native":1}' })(), 'locked');
  assert.equal(lift({ [MARKER]: '{"native":1}', [CRUMB]: 'write' })(), 'locked',
    'a leftover breadcrumb downgraded a device that demonstrably HAS a key — the marker is the settled ' +
    'answer and must win');
});

test('a legacy plaintext seed still takes priority over everything', () => {
  assert.equal(lift({ [PLAIN]: 'word word word', [MARKER]: '{"native":1}', [CRUMB]: 'write' })(), 'plaintext',
    'the migration path is broken: a device with a plaintext seed on disk must load it and force a PIN, ' +
    'not sit on a lock screen it has no PIN for');
});

test('a genuinely fresh console can still set up a church', () => {
  assert.equal(lift({})(), 'none',
    'a brand-new console reports something other than "none", so it will show a lock screen with no key to ' +
    'unlock — the fix has bricked first-run setup, which is worse than the bug');
});

test('the shipped bundle carries the guard, not just the source', () => {
  assert.match(VENDOR, /_bootKeyState/,
    'vendor/steward.js predates this fix, so the console still offers to overwrite a recoverable key ' +
    'however green src/ looks — run npm run build:bundles');
});
