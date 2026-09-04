// A MEMBER THE CHURCH LATER MARKS AS A CHILD MUST STOP BEING TREATED AS AN ADULT — AND HOW SOON.
// Run: node --test scripts/a-marked-child-stops-being-an-adult.test.mjs
//
// Owner, 2026-08-30: marking an EXISTING member as a child is fairly common, so this is the main case, not an
// edge one. A remembered safeguarding answer keyed to the member (scripts/one-phone-two-members-safeguarding
// .test.mjs) does nothing for it — same member, same phone, same key, and the stored answer still says
// "adult". Something else has to invalidate it.
//
// THAT SOMETHING IS THE MEMBER'S OWN SEALED CLEARANCE ARRIVING. This file exists because that was an
// assumption, and the brief asked for it to be verified and the window MEASURED. So it drives the two shipped
// functions together — `subscribeChurchSafeguard`, which is the only writer of `_sgSelf`, and `_assumeMinor`,
// which is the only reader that persists an answer — over one shared `_sgSelf`, exactly as the module holds
// it. Nothing about the chain is stubbed except the relay itself.
//
// WHAT THE MEASUREMENT SAYS. The window ends at the DELIVERY OF ONE EVENT, with nothing else in the way:
//   · the church-docs hub is a live subscription (pool.subscribeMany with no closeOnEose, _docsHubOpen), so a
//     clearance published while the app is open arrives on that socket;
//   · the clearance branch calls emit() synchronously — no debounce, no timer, no reload (asserted below by
//     reading the answer in the same tick as the delivery);
//   · emit() writes _sgSelf BEFORE it calls onLists, so the engine is already correct by the time the screen
//     is told anything;
//   · and ChatScreen's effect lists `clearanceKnown` and `isMinor` among its dependencies, so being told is
//     what makes it re-ask — which is what rewrites the stored answer. That last link is rendered, not read,
//     in scripts/one-phone-two-members-safeguarding.test.mjs.
// The hub also REPLAYS its persisted buffer synchronously when a subscriber attaches (_onChurchDocs), so a
// clearance that reached this phone in any earlier session is applied before the first draw, with no relay
// round trip at all. That is asserted below too, because it is what makes the common case instant.
//
// WHAT THE WINDOW COSTS WHILE IT IS OPEN, stated plainly rather than claimed away: until that event reaches
// the phone the previous answer stands. On a good link that is one round trip; on a thin one it is however
// long the phone takes to complete an authenticated read; on a phone that never reconnects it is for ever.
// It is not closed by expiring the answer, because an expired "adult" falls through to "assume", and that
// would gate every ordinary adult in every safeguarding church whose phone had been offline a while — the
// silent-blank-screen harm the three-answer rule exists to avoid. What the window exposes is a room NAME: the
// relay withholds an adults-only group's MESSAGES from a minor whatever this phone believes.
//
// CLAUDE.md rule 3: no assertion here matches text in app/*.jsx.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody, liftSgMine } from './test-slice.mjs';

const VENDOR = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
const SUB = fnBody(VENDOR, 'subscribeChurchSafeguard(churchNpub, onLists) {', 'subscribeChurchSafeguard');
const SGMINE = liftSgMine(VENDOR);
const ASSUME = (() => {
  const m = /\n  async function _assumeMinor\(cp\) \{[\s\S]*?\n  \}/.exec(VENDOR);
  assert.ok(m, 'could not lift _assumeMinor — re-anchor this test, do not delete it');
  return m[0];
})();

const CP = 'c'.repeat(64);
const ME = 'e'.repeat(64);
const SLOT = 'trinityone.sgassume.' + CP + '|' + ME;
const nowS = () => Math.floor(Date.now() / 1000);

// A sealed clearance as the church publishes it. The seal is stubbed to plain JSON — what is under test is
// WHEN the answer changes, not the NIP-44 primitives, which scripts/care-seal.test.mjs owns.
const clearance = (body, ts = nowS()) => ({
  id: 'evt-' + Math.random().toString(36).slice(2), pubkey: CP, created_at: ts,
  content: JSON.stringify(body), tags: [['d', 'trinityone/clearance:' + ME]],
});

// ── THE TWO SHIPPED FUNCTIONS, OVER ONE `_sgSelf` ─────────────────────────────────────────────────────────
// `_sgSelf` is declared here rather than stubbed, so the writer's assignment and the reader's lookup are the
// same binding — which is the whole point. `replay` is what the church-docs hub already holds on disk.
function phone({ replay = [], remembered = null, audience = ['someone-cleared'] } = {}) {
  const store = {};
  if (remembered !== null) store[SLOT] = remembered;
  let handler = null;
  const heard = [];                       // every onLists the screen would have received

  const stubs = {
    window: { Fellowship: { myPubkey: ME } },
    pub: ME, sk: 'my-signing-key',
    toPub: (x) => (x === 'npub1church' ? CP : x),
    pubSet: (a) => new Set(a || []),
    _noPhoto: new Set(),
    _churchRoster: new Map(),
    APPROVED_D: 'trinityone/approved:',
    // stand in for the church-docs hub: keep the handler, replay what is already on disk, EOSE.
    _onChurchDocs: (_cp, h) => {
      handler = h;
      for (const e of replay) h.onevent(e, (e.tags.find(t => t[0] === 'd') || [])[1] || '');
      if (h.oneose) h.oneose();
      return () => {};
    },
    // the seal, opened. Renamed by esbuild, so resolved through the proxy's base-name fallback as well.
    decrypt: (c) => c,
    getConversationKey: () => 'k',
    nip44d: (c) => c,
    nip44ck: () => 'k',
    SG_ASSUME_KEY: 'trinityone.sgassume.',
    // 0 = this phone has never proved who it is on this connection. These cases are about the CLEARANCE
    // document, not about the minors list, so the honest value is "we have not authenticated" — which is
    // also what makes minorsKnown false throughout, i.e. no case here accidentally asserts about a state it
    // did not set up. See subscribeChurchSafeguard.
    _relayAuthedAt: 0,
    _mayCache: () => true,
    _fetchChildCareAudience: async () => audience,
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    },
    console,
  };
  // Names declared INSIDE the generated function must not be captured by the `with`, or they resolve to the
  // proxy and throw. Everything else does resolve there, loudly, so a stale stub list is a named error rather
  // than a silent nothing.
  const DECLARED = new Set(['_sgSelf', '_mePub', '_sgMine', '_assumeMinor', 'heard', 'CP', 'getHandler']);
  const scope = new Proxy(stubs, {
    has: (t, k) => !DECLARED.has(String(k)) && ((k in t) || !(String(k) in globalThis)),
    get: (t, k) => {
      if (k === Symbol.unscopables) return undefined;
      if (k in t) return t[k];
      const base = String(k).replace(/\d+$/, '');
      if (base in t) return t[base];
      throw new ReferenceError('the lifted code needs `' + String(k) + '` — add a stub for it in phone()');
    },
  });
  const names = Object.keys(stubs);
  const body = `
    let _sgSelf = { cp: '', me: '', isMinor: false, known: false };
    ${SGMINE}
    ${ASSUME}
    with (scope) {
      const sub = ({ ${SUB} }).subscribeChurchSafeguard('npub1church', (o) => heard.push(o));
      return { assume: () => _assumeMinor(CP), sgSelf: () => _sgSelf, deliver: (e) =>
        getHandler().onevent(e, (e.tags.find(t => t[0] === 'd') || [])[1] || ''), stop: sub };
    }`;
  // `handler` is only assigned once _onChurchDocs runs, so it goes in as a getter rather than a value.
  const made = new Function(...names, 'scope', 'heard', 'CP', 'getHandler', body)
    (...names.map(k => stubs[k]), scope, heard, CP, () => handler);
  return { ...made, store, heard };
}

// ══ VERIFICATION ══════════════════════════════════════════════════════════════════════════════════════════

test('CONTROL: with no clearance on this phone, the church has told us nothing about this member', async () => {
  // If this were already `known`, every assertion below would be about a state the app reaches for free.
  const p = phone();
  assert.equal(p.sgSelf().known, false, 're-anchor: the engine thinks it has been told without being told');
  assert.equal(await p.assume(), true, 'a church that uses safeguarding did not gate an unknown member');
});

test('a member remembered as an ADULT is treated as one — until the church says otherwise', async () => {
  const p = phone({ remembered: '0' });
  assert.equal(await p.assume(), false, 're-anchor: the remembered answer is not being read at all');
});

test('MEASURED: the stale "adult" answer is corrected IN THE SAME TICK the clearance is delivered', async () => {
  const p = phone({ remembered: '0' });
  assert.equal(await p.assume(), false);

  // The steward marks them. One event, on the hub's live subscription.
  p.deliver(clearance({ minor: true, cleared: false }));

  // Nothing has been awaited, no timer has run, no reload has happened. The writer is synchronous.
  assert.equal(p.sgSelf().known, true, 'the clearance was delivered and the engine still says it has not heard');
  assert.equal(p.sgSelf().isMinor, true);
  assert.equal(p.sgSelf().me, ME, 'the answer was not filed under the member it is about');

  assert.equal(await p.assume(), true,
    'a member their church has just marked as a child was still treated as an adult');
  assert.equal(p.store[SLOT], '1',
    'the remembered "adult" survived the church marking them a child, so the NEXT launch — before the ' +
    'clearance has arrived again — would treat them as an adult all over again');
});

test('MEASURED: and the screen is told in the same call, after the engine is already right', async () => {
  // Order matters: onLists is what makes ChatScreen re-ask, and if it fired before _sgSelf was written the
  // re-ask would read the old answer and write it straight back.
  const p = phone({ remembered: '0' });
  const before = p.heard.length;
  p.deliver(clearance({ minor: true, cleared: false }));
  assert.ok(p.heard.length > before, 'nothing told the screen at all, so nothing would ever re-ask');
  assert.equal(p.heard[p.heard.length - 1].clearanceKnown, true);
  assert.equal(p.heard[p.heard.length - 1].isMinor, true);
});

test('MEASURED: a clearance this phone already had is applied before anything is asked of the relay', async () => {
  // The common case after the first time: the hub replays its persisted buffer synchronously when a
  // subscriber attaches, so there is no window at all on a later launch — including offline.
  const p = phone({ remembered: '0', replay: [clearance({ minor: true, cleared: false })], audience: null });
  assert.equal(p.sgSelf().known, true, 'a clearance already on this phone was not applied at subscribe time');
  assert.equal(await p.assume(), true, 'the phone had been told and still treated them as an adult');
  assert.equal(p.store[SLOT], '1');
});

test('the correction goes the other way too — a cleared member gets their rooms back', async () => {
  const p = phone({ remembered: '1' });
  assert.equal(await p.assume(), true);
  p.deliver(clearance({ minor: false, cleared: true }));
  assert.equal(await p.assume(), false, 'a member the church cleared stayed gated on a remembered answer');
  assert.equal(p.store[SLOT], '0');
});

test('THE WINDOW, STATED: with no clearance delivered, the remembered answer is all there is', async () => {
  // This is the honest cost of the cache and it is deliberate. `audience: null` is a relay that cannot be
  // reached at all — the thin-link case this product is built for — so nothing but the stored answer can
  // speak, and it says what the church last said, which may now be out of date.
  const p = phone({ remembered: '0', audience: null });
  assert.equal(await p.assume(), false,
    'if this ever changes, the trade has moved: read the note at the top of this file before accepting it');
  // …and the moment the event lands, it is over. Same tick, again.
  p.deliver(clearance({ minor: true, cleared: false }));
  assert.equal(await p.assume(), true);
});

test('a clearance dated absurdly in the future does not close the window on a forgery', async () => {
  // Newest-wins makes a far-future copy permanent, so the shipped guard drops it. Asserted here because this
  // file is now the place that describes what ends the window: a forged event must not be able to end it.
  const p = phone({ remembered: '0' });
  p.deliver(clearance({ minor: true, cleared: false }, nowS() + 3600));
  assert.equal(p.sgSelf().known, false, 'a future-dated clearance was applied and pinned the member’s status');
  assert.equal(await p.assume(), false);
});
