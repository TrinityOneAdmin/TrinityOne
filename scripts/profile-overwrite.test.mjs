// setProfile must never publish a kind-0 built out of fields it has not read.
// Run: node --test scripts/profile-overwrite.test.mjs
//
// AUDIT-2026-07-28 F1. kind-0 is REPLACEABLE and `prev` is the LOCAL cache, empty on a restored or
// locked-and-reopened phone. So the name-only patch every restore performs computed picture:'' and
// about:'' and published that over the member's real profile — destroying their photo and clearing their
// directory opt-out ON THE RELAY.
//
// A guard was added for this on 2026-07-28 and it does not work. Two defects, both live before this file:
//
//   1. It WAITS and then publishes anyway. After six seconds the loop simply exits into `prev = {}`. A wait
//      with no refusal is worse than no wait, because it reads as protection — and on the connections this
//      product is built for, the six seconds elapsing IS the normal path.
//   2. It is skipped entirely once a name is known. The condition required the cached profile to be EMPTY,
//      but _recoverOwnName (added the same evening) writes a name-only entry — so after a restore the guard
//      is false, there is no wait at all, and the blank publish goes straight out.
//
// The test that shipped with that guard asserts that two strings appear in the bundle, in order. It cannot
// fail while the bug survives beside them, and it was green over this the whole time. So this file does not
// read the source: it RUNS the shipped setProfile against a fake relay and looks at what came out on the
// wire. Sabotage-checked — see the header note in the commit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';

const FELLOWSHIP = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');

// Lift a METHOD out of the shipped bundle (name-key-integrity's grab() only finds `function name(`).
// Brace-matched and quote/comment aware, so a string containing a brace cannot cut the body in half.
function grabMethod(src, sig) {
  const at = src.indexOf(sig);
  assert.notEqual(at, -1, sig + ' is gone from the shipped bundle — re-anchor this test');
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

const BODY = grabMethod(FELLOWSHIP, 'async setProfile(meta)');
// esbuild renames the nostr-tools import (finalizeEvent2 today). Bind whatever it actually calls, so a
// rebuild that renumbers it fails loudly here rather than silently testing nothing.
const FE_NAME = (BODY.match(/\bfinalizeEvent\d*\b/) || [])[0];
assert.ok(FE_NAME, 'setProfile no longer signs an event — re-anchor this test');

// A member-side scope we control: a relay that never answers unless we say so, and a wire we can inspect.
function memberSide({ seen = false, cached = {}, answerAfterMs = null } = {}) {
  const sk = generateSecretKey(), pub = getPublicKey(sk);
  const state = { published: [], toasts: [], sealedSynced: 0, requested: 0, saved: {} };
  const scope = {
    sk, pub,
    profiles: Object.keys(cached).length ? { [pub]: { ...cached } } : {},
    _k0Seen: new Set(seen ? [pub] : []),
    _profilePubFor: '', _profilePubBody: '',
    PROFILE_KEY: 'trinityone.profile',
    localStorage: { setItem: (k, v) => { state.saved[k] = v; }, getItem: (k) => state.saved[k] || null },
    console: { warn() {} },
    CustomEvent: function (t, d) { this.type = t; this.detail = (d || {}).detail; },
    _publishAny: async (_relays, evt) => { state.published.push(evt); },
    window: {
      Fellowship: {
        ready: Promise.resolve(),
        relays: ['wss://test.invalid'],
        myProfile: null,
        // The real one opens a subscription and marks the pubkey "asked" on EOSE. Here the relay answers
        // only if the case says it does — a relay that never answers is the whole point of the test.
        requestProfiles(pks) {
          state.requested++;
          if (answerAfterMs != null) setTimeout(() => { for (const pk of pks) scope._k0Seen.add(pk); }, answerAfterMs);
        },
        syncSealedNames() { state.sealedSynced++; },
      },
      dispatchEvent() {},
      trinityToast: (m) => { state.toasts.push(String(m)); },
    },
  };
  scope.window.trinityToast = scope.window.trinityToast;   // the engine reaches it as window.trinityToast
  const args = Object.keys(scope);
  const fn = new Function(...args, FE_NAME, `return ({ ${BODY} }).setProfile;`)
    (...args.map(k => scope[k]), finalizeEvent);
  return { call: (meta) => fn(meta), state, scope, pub };
}

const kind0 = (evt) => JSON.parse(evt.content);
const PHOTO = 'data:image/webp;base64,AAAA';

// ── the two live defects ─────────────────────────────────────────────────────────────────────────────────
test('a restore does not publish a blank profile over the real one', async () => {
  // Exactly the state _recoverOwnName leaves behind: a name, nothing else, and our own kind-0 never read.
  // The shipped guard skips entirely here, because it requires the cached profile to be EMPTY.
  const m = memberSide({ seen: false, cached: { name: 'Maria' } });
  await m.call({ name: 'Maria' });
  assert.deepEqual(m.state.published, [],
    'setProfile published a kind-0 without ever reading the member’s own profile — picture:' +
    JSON.stringify((m.state.published[0] ? kind0(m.state.published[0]).picture : '')) +
    ' and about:\'\' have just replaced their real profile on the relay');
});

test('a slow relay is a refusal, not a delay before the same damage', async () => {
  // The wait exists and then falls through. Six seconds is generous on a desk and short on a 2G link, so
  // for the audience this product is built for, "the wait elapsed" is the ordinary case.
  const m = memberSide({ seen: false, cached: {} });
  await m.call({ name: 'Maria' });
  assert.equal(m.state.requested, 1, 'nothing even asked the relay for our own profile');
  assert.deepEqual(m.state.published, [],
    'the wait ran out and setProfile published anyway — a wait with no refusal is worse than no wait');
});

test('when it refuses, the member is told', async () => {
  // A silent refusal is the console’s publishProfile bug in a new place: the sheet closes, the photo is
  // gone from the network, and nothing said so.
  const m = memberSide({ seen: false, cached: { name: 'Maria' } });
  await m.call({ name: 'Maria', picture: PHOTO });
  assert.deepEqual(m.state.published, []);
  assert.equal(m.state.toasts.length, 1, 'the refusal reached no screen — the member believes their photo saved');
  assert.match(m.state.toasts[0], /connect|try again|not saved|saved yet/i,
    'the message must say what happened and that it is worth retrying: ' + JSON.stringify(m.state.toasts[0]));
});

// ── and the things a refusal must NOT break ──────────────────────────────────────────────────────────────
test('the name is still saved and re-sealed when the kind-0 publish is refused', async () => {
  // The name does NOT travel in kind-0 since Stage 2 — it goes out sealed, via syncSealedNames. Refusing
  // the whole call to protect kind-0 would leave a member on a slow link unable to tell anyone their name,
  // which is the one thing they set. Refuse the PUBLISH, not the operation.
  const m = memberSide({ seen: false, cached: {} });
  await m.call({ name: 'Maria' });
  await new Promise(r => setTimeout(r, 10));   // syncSealedNames is scheduled on a 0ms timer
  assert.equal(m.scope.window.Fellowship.myProfile.name, 'Maria', 'the member’s own name was dropped');
  assert.match(m.state.saved['trinityone.profile'] || '', /Maria/, 'the name was not written to this device');
  assert.equal(m.state.sealedSynced, 1, 'the sealed name was never re-published, so the congregation never learns it');
});

test('a brand-new member is not refused — an EOSE is an answer', async () => {
  // The console had exactly this bug the other way round: it refused the FIRST name a church ever set,
  // because the relay had not answered about a profile that does not exist. An EOSE IS the answer, and
  // requestProfiles marks the pubkey seen on EOSE, so a new member must sail through with an empty cache.
  const m = memberSide({ seen: true, cached: {} });
  await m.call({ name: 'Bob', av: { kind: 'symbol', color: '#111' } });
  assert.equal(m.state.published.length, 1, 'a brand-new member could not publish their avatar at all');
  assert.equal(kind0(m.state.published[0]).av.kind, 'symbol');
});

test('the relay answering during the wait lets the publish through', async () => {
  const m = memberSide({ seen: false, cached: {}, answerAfterMs: 200 });
  await m.call({ picture: PHOTO });
  assert.equal(m.state.published.length, 1, 'the answer arrived and setProfile refused anyway');
  assert.equal(kind0(m.state.published[0]).picture, PHOTO);
});

test('a normal edit still carries the fields it did not touch', async () => {
  // The over-tightening check. Once we HAVE read our own kind-0, a partial edit must merge, exactly as before.
  const m = memberSide({ seen: true, cached: { name: 'Maria', about: 'hello', picture: PHOTO, hidden: true } });
  await m.call({ av: { kind: 'photo', color: '#C2913A' } });
  assert.equal(m.state.published.length, 1, 'an ordinary avatar change stopped publishing');
  const w = kind0(m.state.published[0]);
  assert.equal(w.about, 'hello', 'a partial edit blanked `about`');
  assert.equal(w.picture, PHOTO, 'a partial edit blanked the picture');
  assert.equal(w.hidden, true, 'a partial edit un-hid a member who had opted out of the directory');
  assert.equal(w.av.kind, 'photo');
});

test('the directory opt-out is never cleared by an unread profile', async () => {
  // The quietest half of the same bug, and the one that matters most under the pilot's threat model: a
  // member who chose not to appear in the congregation directory was published back into it.
  const m = memberSide({ seen: false, cached: { name: 'Maria' } });   // `hidden` unknown — never read
  await m.call({ name: 'Maria' });
  assert.deepEqual(m.state.published, [],
    'a member who had opted OUT of the member directory was silently republished as visible');
});
