// ASKING FOR HELP TWICE, BECAUSE THE FIRST TAP LOOKED LIKE IT FAILED, IS STILL ONE ASK.
// Run: node --test scripts/asking-for-help-twice-is-one-ask.test.mjs
//
// A family taps Send on "Ask for help". The relay TAKES the request but does not acknowledge it inside
// WEDGE_ACK_MS. The sheet says "Couldn't send — check your connection and try again", so they tap Send
// again — and that minted a SECOND request, because publishCareRequest chose the random tail of its id on
// every call. The care team then saw two families' worth of need where there was one, and organised two
// meal trains. Measured against a live gateway with the shipped bundle, 2026-09-16; the sibling writer
// `fillCareSlot` under identical staging stored ONE, because its id is derived from something stable.
//
// AND THE WORSE ONE, found on the way. Where a church lets members open needs themselves, the sheet calls
// publishCareNeed first and falls back to publishCareRequest on a falsy answer — and publishCareNeed
// returned a bare `null` for an UNCONFIRMED publish too. One tap therefore left a PUBLIC need on the relay
// AND a PRIVATE care request AND a success toast. The family asked once, privately, and got a public notice
// as well. That is a privacy failure, not untidiness.
//
// ── WHAT IS REAL HERE AND WHAT IS INJECTED ───────────────────────────────────────────────────────────────
// The SCREEN is the real AskForHelpForm, compiled out of app/screens-today.jsx and rendered (CLAUDE.md rule
// 1: it has to fail if the fix is deleted from the screen, and rule 3: app/*.jsx ships unbundled, so no
// claim here may rest on matching its text). The ENGINE is the real publishCareRequest and the real
// publishCareNeed lifted out of vendor/fellowship.js, with the real _pubReason behind them.
//
// ⚠ THE ID IS NEVER STUBBED. The only thing injected is whether the relay acknowledged the write — which is
// the INPUT, not the answer. An injected outcome cannot catch a dead classifier: 18 tests once stayed green
// with a feature dead in one character (memory: injected-outcomes-cannot-catch-a-dead-classifier).
//
// ⚠ ROW 1 IS A BASELINE AND IT IS LOAD-BEARING. A broken fixture that publishes nothing at all looks exactly
// like every sabotage biting (memory: a-sabotage-matrix-needs-a-baseline-row).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import * as nip44 from 'nostr-tools/nip44';
import { loadScreen, miniReact, texts, find, button, reads } from './render-jsx-screen.mjs';
import { fnBody, stmt, liftSgMine } from './test-slice.mjs';

const VENDOR = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');

const hex = (u8) => Array.from(u8).map(b => b.toString(16).padStart(2, '0')).join('');
const churchSk = generateSecretKey(), CHURCH = getPublicKey(churchSk);
const askerSk = generateSecretKey(), ASKER = getPublicKey(askerSk);

// ── the engine, lifted ────────────────────────────────────────────────────────────────────────────────────
const REQ = fnBody(VENDOR, 'async publishCareRequest(fields) {', 'publishCareRequest');
const NEED = fnBody(VENDOR, 'async publishCareNeed(fields) {', 'publishCareNeed');
// The classifier both of them now answer with. Lifted, never stubbed: telling "nobody answered in time"
// from "a box read it and said no" is the whole of half this fix.
const PUB_REASON = fnBody(VENDOR, 'function _pubReason(e) {', '_pubReason');
const SGMINE = liftSgMine(VENDOR);
const NEED_GUARD = (() => {
  const m = /\n  async function _careNeedRefusal\(cp\)[\s\S]*?\n  \}/.exec(VENDOR);
  assert.ok(m, 'could not lift _careNeedRefusal — re-anchor this test, do not delete it');
  return m[0];
})();
const NO_NET = stmt(VENDOR, 'var NO_NETWORK_RELAY = ', 'NO_NETWORK_RELAY');
const IS_NO_NET = stmt(VENDOR, 'var isNoNetworkRelay = ', 'isNoNetworkRelay');

// WHAT THE RELAY DID, AND NOTHING ELSE. These are the three shapes _publishAny really produces:
//   'ok'          a relay acknowledged it.
//   'unconfirmed' NOBODY answered inside WEDGE_ACK_MS — and the event is on the wire and often already
//                 stored, which is why the store below KEEPS it. This is the measured case.
//   'refused'     a box read it and said no (err.refused, set by _publishAny from _PUB_REFUSED).
//   'not-sent'    every address was unreachable, so nothing left the phone (err.unsent).
function relayThat(mode) {
  const store = [];                       // what the relay actually holds, newest write per d-tag last
  const tried = [];                       // …and every event the phone ATTEMPTED, landed or not
  const publish = async (_relays, evt) => {
    tried.push(evt);
    const m = typeof mode === 'function' ? mode() : mode;
    if (m === 'ok') { store.push(evt); return true; }
    if (m === 'unconfirmed') { store.push(evt); throw new Error('timed out waiting for OK'); }
    if (m === 'refused') { const e = new Error('blocked: not permitted for this group'); e.refused = true; throw e; }
    if (m === 'not-sent') { const e = new Error('connection failure: could not reach any relay'); e.unsent = true; throw e; }
    assert.fail('unknown relay mode ' + m);
  };
  return { store, tried, publish };
}

const dTag = (e) => (e.tags.find(t => t[0] === 'd') || [])[1] || '';
const carereqs = (store) => store.filter(e => dTag(e).startsWith('trinityone/carereq:'));
const needs = (store) => store.filter(e => dTag(e).startsWith('trinityone/care:'));
// ONE DOCUMENT PER DISTINCT d-TAG. Addressable events are keyed by (author, kind, d-tag), so two writes at
// one id leave ONE document on the relay — which is precisely why replacing is a fix and not a trick.
const distinct = (store) => [...new Set(store.map(dTag))];

function engine(relay) {
  const stubs = {
    window: { Fellowship: { churchPub: CHURCH, ready: Promise.resolve() } },
    sk: askerSk, pub: ASKER,
    profiles: { [ASKER]: { name: 'Verity' } },
    _sgSelf: { cp: CHURCH, me: ASKER, isMinor: false, known: true },
    _fetchCareTeam: async () => [getPublicKey(generateSecretKey())],
    _fetchChildCareAudience: async () => [],
    _carekeys: { [CHURCH]: [new Uint8Array(32)] },
    _careSeal: () => 'SEALED-BLOB',
    crypto: webcrypto,
    _hex: hex,
    encrypt: (plain, key) => nip44.encrypt(plain, key),
    decrypt: (ct, key) => nip44.decrypt(ct, key),
    getConversationKey: (a, b) => nip44.utils.getConversationKey(a, b),
    nip44e: (plain, key) => nip44.encrypt(plain, key),
    nip44ck: (a, b) => nip44.utils.getConversationKey(a, b),
    finalizeEvent,
    _publishAny: relay.publish,
    churchRelays: () => ['wss://test.invalid'],
    NET: 'trinityone', CAREREQ_D: 'trinityone/carereq:', CARE_D: 'trinityone/care:',
    CARETEAM_D: 'trinityone/careteam:',
    pool: { querySync: async () => [] },
    _relayAuthedAt: Date.now(),
    _churchRoster: new Map([[CHURCH, new Set()]]),
    CLEARANCE_D: 'trinityone/clearance:',
    console: { warn() {} },
  };
  // Claim only what we stub, so the lifted code dies on its own language nowhere and on a missing name
  // loudly. A silently-stubbed global is how a test ends up asserting about something that is not the code.
  const scope = new Proxy(stubs, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => {
      if (k === Symbol.unscopables) return undefined;
      if (k in t) return t[k];
      const base = String(k).replace(/\d+$/, '');
      if (base in t) return t[base];
      throw new ReferenceError('the lifted engine needs `' + String(k) + '` — add a stub for it in engine()');
    },
  });
  return new Function('scope', `with (scope) { ${SGMINE} ${NEED_GUARD} ${PUB_REASON} ${NO_NET} ${IS_NO_NET}
    return { ${REQ}, ${NEED} }; }`)(scope);
}

// ── the screen, rendered ──────────────────────────────────────────────────────────────────────────────────
const Stub = (n) => function S(p) { return { type: n, props: p, kids: [] }; };

// A localStorage that really remembers, because the whole of "a retry after the app was killed is still one
// ask" lives in it. `kill()` throws away the React tree and keeps the disk — which is what being killed is.
function disk() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _map: m };
}

function screen({ api, store, openedBy = 'steward', isMinor = false }) {
  // ⚠ unmounts: true. Without it the harness keeps a component's state for ever once created, so a
  // close-and-reopen would silently reuse the FIRST mount's draft id and row 3 would pass over a fix that
  // had broken a family's ability to ask twice.
  const { React, draw } = miniReact({ unmounts: true });
  const sent = [];
  const win = {
    addEventListener() {}, removeEventListener() {}, innerWidth: 360,
    Fellowship: {
      churchPub: CHURCH,
      myPubkey: ASKER,
      publishCareRequest: (f) => api.publishCareRequest(f),
      publishCareNeed: (f) => api.publishCareNeed(f),
      canOpenCareNeed: async () => openedBy === 'member',
      subscribeCareRequests: () => () => {},
      childCareAudience: async () => [],
    },
    TrinityData: { NOTIFICATIONS: [], PLANS: [], VOTD_POOL: [] },
    Bible: { parseRef: () => null, loaded: false, books: () => [], getVerses: () => [], maxChapter: () => 1, activeVersion: 'WEB', refLabel: () => '', defaultLoc: () => ({ book: 43, chap: 1 }) },
  };
  const globals = {
    React, console, setTimeout, clearTimeout, setInterval, clearInterval,
    Icon: ({ name }) => React.createElement('i', { 'data-icon': name }),
    ChurchBadge: Stub('ChurchBadge'), SectionLabel: Stub('SectionLabel'), Halo: Stub('Halo'),
    Sheet: Stub('Sheet'), IconBtn: Stub('IconBtn'),
    document: { addEventListener() {}, removeEventListener() {}, querySelector: () => null },
    navigator: { userAgent: '' }, location: { search: '', hostname: 'x' },
    localStorage: store,
    crypto: webcrypto,
    lsGet: (k, d) => d, lsSet: () => {},
    cx: (...a) => a.filter(Boolean).join(' '),
    useTrinityAudio: () => ({ track: null, playing: false }),
    todayISO: () => '2026-09-16',
    fetch: async () => ({ ok: false, json: async () => ({}) }),
    window: win,
  };
  const { AskForHelpForm } = loadScreen('app/screens-today.jsx', ['AskForHelpForm'], globals);
  const ctx = {
    church: { npub: 'npub1church' },
    safeguard: { minors: [], approved: [], guardians: {}, isMinor, cleared: true, minorsKnown: true },
    churchRosters: [], canDMPeer: () => true, toast() {},
    care: { myPub: ASKER, settings: { enabled: true, openedBy, visibility: 'all' } },
  };
  // The real parent's shape: `{open ? <AskForHelpForm …/> : null}` (AskForHelp, app/screens-today.jsx).
  // Closing really unmounts, which is the only way a reopen can be a new ask.
  let open = true;
  function Host() {
    return open ? React.createElement(AskForHelpForm, {
      ctx,
      onClose: () => { open = false; },
      onSent: (r) => { sent.push(r); open = false; },
    }) : null;
  }
  const settle = async () => { for (let i = 0; i < 4; i++) await new Promise(r => setImmediate(r)); };
  const h = {
    sent, store,
    tree: () => draw(Host, {}),
    isOpen: () => open,
    reopen: () => { open = true; return draw(Host, {}); },
    // ANDROID'S BACK BUTTON, WHICH IS NOT A CALL TO onClose. Back closes the Serving PAGE this sheet lives
    // inside (window.trinityGoBack in app/app.jsx carries no entry for the sheet), so the parent stops
    // rendering it and the sheet's own close handler never runs. Anything the sheet only does in onClose is
    // therefore skipped. This is the exact route an independent review measured on 2026-09-16.
    back: () => { open = false; return draw(Host, {}); },
    async click(label) {
      let tree = draw(Host, {});
      const bs = button(tree, label);
      assert.equal(bs.length, 1, `expected exactly one "${label}" button on the sheet, found ${bs.length}`);
      await bs[0].props.onClick({ stopPropagation() {} });
      await settle();
      return draw(Host, {});
    },
    async type(ariaLabel, value) {
      const tree = draw(Host, {});
      const el = find(tree, n => n.type === 'input' && n.props['aria-label'] === ariaLabel);
      assert.equal(el.length, 1, `no input labelled "${ariaLabel}"`);
      el[0].props.onChange({ target: { value } });
      await settle();
      return draw(Host, {});
    },
    settle,
    words: () => reads(draw(Host, {})),
  };
  // The need path is decided by an async answer from the engine, so let it arrive before anyone taps.
  draw(Host, {});
  return h;
}

// Pick a kind of help and press the send control. One helper so every row below presses the same real
// buttons a member does.
async function ask(h, { kind = 'Meals', send = 'Send to care team' } = {}) {
  await h.click(kind);
  return h.click(send);
}

// ── ROW 1 · BASELINE ──────────────────────────────────────────────────────────────────────────────────────
test('BASELINE: one tap on a clean send leaves exactly one request and closes the sheet', async () => {
  const relay = relayThat('ok');
  const h = screen({ api: engine(relay), store: disk() });
  await ask(h);
  assert.equal(carereqs(relay.store).length, 1,
    'the fixture published ' + carereqs(relay.store).length + ' requests on a clean send. Every row below ' +
    'counts documents, so a fixture that publishes none or two makes all of them meaningless.');
  assert.equal(h.sent.length, 1, 'a successful send did not report success to the parent');
  assert.equal(h.isOpen(), false, 'the sheet stayed open over a successful send');
});

// ── ROW 2 · THE CASE ──────────────────────────────────────────────────────────────────────────────────────
test('THE CASE: a send the relay took but did not acknowledge, then a second tap, is ONE request', async () => {
  const relay = relayThat('unconfirmed');
  const h = screen({ api: engine(relay), store: disk() });

  await ask(h);
  // FIRST, THE WORDS. "Check your connection" is a false sentence here — the connection is fine and the
  // request is very likely already with the church — and it is what made Send the obvious next tap.
  const said = h.words();
  assert.doesNotMatch(said, /check your connection/i,
    'the sheet still blames the connection for a send the relay took: ' + said.slice(0, 400));
  assert.match(said, /couldn’t confirm|couldn't confirm/i,
    'the sheet does not tell the member what actually happened: ' + said.slice(0, 400));
  assert.match(said, /don’t send it again yet|don't send it again yet/i,
    'the sheet does not ask them to wait before re-sending, which is the tap that duplicates the ask');
  assert.equal(h.sent.length, 0, 'an unconfirmed send was reported to the member as sent');
  assert.equal(h.isOpen(), true, 'the sheet closed over a send nobody confirmed');

  // …AND SEND IS NO LONGER THE OBVIOUS NEXT TAP.
  assert.equal(button(h.tree(), 'Close').length, 1,
    'closing is not offered as the primary action after an unconfirmed send');

  // NOW THE SECOND TAP, which is what a worried family does whatever the screen says.
  await h.click('Send it again');

  const ids = distinct(carereqs(relay.store));
  assert.equal(relay.store.length, 2, 'CONTROL: both taps must really have reached the relay — got ' + relay.store.length);
  assert.equal(ids.length, 1,
    'two taps over ONE ask left ' + ids.length + ' requests on the relay (' + ids.join(' , ') + '). The care ' +
    'team sees two families\' worth of need where there is one, and organises two meal trains.');
});

// ── ROW 3 · TWO DIFFERENT ASKS ARE STILL TWO ──────────────────────────────────────────────────────────────
test('a family who really does need to ask twice still can — close, reopen, ask again', async () => {
  const relay = relayThat('ok');
  const h = screen({ api: engine(relay), store: disk() });
  await ask(h);
  assert.equal(h.isOpen(), false, 'precondition: a confirmed send closes the sheet');
  h.reopen();
  await ask(h);
  assert.equal(distinct(carereqs(relay.store)).length, 2,
    'a second, genuinely separate ask REPLACED the first. The fix would then be hiding real need from the ' +
    'care team, which is worse than the duplicate it exists to stop.');
});

test('…and the same holds with identical words after an unconfirmed send is deliberately closed', async () => {
  // The harder half: the first ask was never confirmed, so its draft id is still on disk. Closing the sheet
  // is a person deciding this ask is over, and must throw that id away — otherwise a family whose first
  // request silently failed could never open a second one.
  const relay = relayThat(() => 'unconfirmed');
  const h = screen({ api: engine(relay), store: disk() });
  await ask(h);
  assert.equal(distinct(carereqs(relay.store)).length, 1, 'precondition: one ask so far');
  await h.click('Close');
  assert.equal(h.isOpen(), false, 'the Close button did not close the sheet');
  h.reopen();
  await ask(h);
  assert.equal(distinct(carereqs(relay.store)).length, 2,
    'a reopened sheet reused the abandoned draft, so a family that asked twice — same words, same day — ' +
    'shows the care team one request');
});

// ── ROW 3b · BEING KILLED IS NOT CLOSING ──────────────────────────────────────────────────────────────────
test('a retry after Android kills the app is still one ask', async () => {
  // A low-memory phone kills this app while the member is staring at a failed send. Nothing unmounts, no
  // handler runs; only what is on disk survives. A nonce held in React state alone would duplicate here,
  // which is the commonest real-world shape of the whole bug.
  const relay = relayThat('unconfirmed');
  const store = disk();
  const h1 = screen({ api: engine(relay), store });
  await ask(h1);
  assert.equal(distinct(carereqs(relay.store)).length, 1, 'precondition: one ask before the kill');
  // …the process dies. New React tree, new component instances, same disk.
  const h2 = screen({ api: engine(relay), store });
  await ask(h2);
  assert.equal(distinct(carereqs(relay.store)).length, 1,
    'the retry after a restart minted a second request — ' + distinct(carereqs(relay.store)).join(' , '));
});

// ── ROW 4 · THE RELAY'S OWN RULE STILL HOLDS ──────────────────────────────────────────────────────────────
test('the id still names its asker, so the relay still accepts it', () => {
  // carereqIdOk in scripts/gateway.mjs, at four doors (accept, the /import loop, syncChurchFromPeer,
  // reconcileChurchWithPeer), over ID_OWNER_RE = /^([0-9a-f]{8,64})-/: the part before the first `-` must be
  // a hex prefix of the SIGNER's own pubkey. A fix that made retries idempotent by reshaping the id would
  // otherwise be found in a church, as "please update the app to ask for help".
  const relay = relayThat('ok');
  const h = screen({ api: engine(relay), store: disk() });
  return ask(h).then(() => {
    const e = carereqs(relay.store)[0];
    assert.ok(e, 'CONTROL: nothing was published, so this row asserts nothing');
    const d = dTag(e);
    assert.match(d, /^trinityone\/carereq:[0-9a-f]{8,64}-/,
      'the request id no longer names an owner in hex, so every door on every relay refuses it: ' + d);
    const owner = d.slice('trinityone/carereq:'.length).split('-')[0];
    assert.equal(e.pubkey, ASKER, 'CONTROL: the event is not signed by the asker');
    assert.ok(ASKER.startsWith(owner),
      'the id names ' + owner + ', which is not a prefix of the signer ' + ASKER.slice(0, 16) + '. The relay ' +
      'reads that as a forged request and refuses it.');
    // SHAPE UNCHANGED: 16 hex of asker + 16 hex of tail, exactly as before this fix, so nothing already on a
    // relay is affected — only how the tail is CHOSEN.
    assert.match(d.slice('trinityone/carereq:'.length), /^[0-9a-f]{16}-[0-9a-f]{16}$/,
      'the id changed shape: ' + d);
  });
});

test('…and the tail is not derived from what the member wrote', () => {
  // The d-tag travels in the CLEAR even though the body is sealed. An id hashed from a short note plus a
  // known member key is guessable, so a content-derived id would let a relay operator confirm what somebody
  // asked for help ABOUT. Two fresh sheets, identical words, must not produce the same id.
  const relay = relayThat('ok');
  const words = { kind: 'Meals' };
  const h1 = screen({ api: engine(relay), store: disk() });
  const h2 = screen({ api: engine(relay), store: disk() });
  return ask(h1, words).then(() => ask(h2, words)).then(() => {
    assert.equal(distinct(carereqs(relay.store)).length, 2,
      'two separate members asking in identical words landed on the same id — the tail is derived from the ' +
      'content, which is exactly what a relay operator could then guess');
  });
});

// ── ROW 5 · THE NEED PATH: ONE ASK MUST NOT BECOME A PUBLIC NOTICE AND A PRIVATE REQUEST ──────────────────
async function openNeed(h) {
  await h.click('Meals');
  await h.type('Pick a day people can help on', '2026-10-01');
  await h.click('Add day');
  return h.click('Open this need');
}

test('CONTROL: where the church allows it, one tap opens exactly one public need and no private request', async () => {
  const relay = relayThat('ok');
  const h = screen({ api: engine(relay), store: disk(), openedBy: 'member' });
  await openNeed(h);
  assert.equal(needs(relay.store).length, 1, 'the need path did not publish a need at all');
  assert.equal(carereqs(relay.store).length, 0, 'a successful public need ALSO sent a private request');
  assert.equal(h.sent.length, 1, 'opening a need did not report success');
});

test('an UNCONFIRMED need must not also publish a private request, and must not report success', async () => {
  // MEASURED 2026-09-16: one tap produced a public need on the relay AND a private care request AND a
  // success toast, because publishCareNeed answered `null` for "nobody acknowledged it" and the sheet reads
  // falsy as "that did not happen — send the private one instead".
  const relay = relayThat('unconfirmed');
  const h = screen({ api: engine(relay), store: disk(), openedBy: 'member' });
  await openNeed(h);
  assert.equal(needs(relay.store).length, 1, 'CONTROL: the need itself must still have reached the relay');
  assert.equal(carereqs(relay.store).length, 0,
    'one tap left a PUBLIC need on the relay AND a PRIVATE care request. The family asked once, privately, ' +
    'and got a public notice as well.');
  assert.equal(h.sent.length, 0, 'an unconfirmed need was reported to the member as opened');
  const said = h.words();
  assert.doesNotMatch(said, /check your connection/i, 'the sheet blamed the connection: ' + said.slice(0, 300));
  assert.match(said, /couldn’t confirm|couldn't confirm/i, 'the sheet does not say what happened: ' + said.slice(0, 300));
});

test('a need the relay REFUSED still falls back to the private request — a refusal is settled', async () => {
  // The fallback is the behaviour that already existed and must survive: a refusal means the need did NOT
  // happen, so the member's ask still has to reach somebody. Only "we could not confirm" blocks it.
  const relay = relayThat('refused');
  const h = screen({ api: engine(relay), store: disk(), openedBy: 'member' });
  await openNeed(h);
  assert.equal(needs(relay.tried).length, 1, 'CONTROL: the need was never attempted, so this row asserts nothing');
  assert.equal(needs(relay.store).length, 0, 'CONTROL: a refused need is not on the relay');
  // The private request is refused too here (one relay, one mood), so count what the phone TRIED to send:
  // the question is whether the sheet still reaches for the route that was always safe.
  assert.equal(carereqs(relay.tried).length, 1,
    'a refused public need left the member with nothing at all — the private route must still carry the ask');
});

// ⚠ THE WAY OUT THAT IS NOT A CLOSE, AND THE SILENT LOSS IT USED TO CAUSE.
//
// Measured by an independent review on 2026-09-16, with a control:
//
//   dismissed with the sheet's own Close button   2 distinct ids   (the two asks stay separate)
//   dismissed with ANDROID'S BACK BUTTON          1 id             (the new ask OVERWROTE the old one)
//
// Back closes the Serving page underneath this sheet — app/app.jsx's back-button layer list has no entry for
// the sheet — so onClose never fires and the draft tail survived. And "we couldn't confirm" almost always
// means the relay DID take it, so request #1 is sitting with the care team, possibly already acted on. Weeks
// later the same member asks about something else entirely and that text replaces request #1 at the same
// address, inside the same conversation thread. Neither side is told. That is worse than the duplicate this
// file exists to prevent: a duplicate is visible and can be tidied up; this destroys an ask somebody is
// relying on.
//
// ⚠ TWO THINGS CLOSE IT, AND ONLY ONE OF THEM CAN BE TESTED HERE. The real fix is an unmount cleanup, so
// leaving by ANY route ends the ask — but render-jsx-screen.mjs says in as many words that it never runs
// effect cleanups, so nothing in this file can see it, and a test that cannot fail is worth nothing. What IS
// testable, and what actually closes the reported harm, is the age limit: a tail older than
// CARE_DRAFT_MAX_AGE_MS is ignored. The review's scenario is weeks later; a genuine retry is seconds later.
// The row below drives the age limit through the REAL screen by ageing what is on disk.
test('a stale draft never attaches a new ask to an old request', async () => {
  const store = disk();
  const relay = relayThat('unconfirmed');
  const h = screen({ api: engine(relay), store });
  await ask(h);                                   // tap 1 — taken, never acknowledged
  const first = distinct(carereqs(relay.store));
  assert.equal(first.length, 1, 'fixture: the first ask should be on the relay');

  // …the member leaves by a route that is not Cancel (Back), so the tail is still on disk. Age it past the
  // limit, the way weeks of real time would.
  let aged = 0;
  for (const k of [...store._map.keys()]) {
    if (!/carereq\.draft/.test(k)) continue;
    const raw = String(store._map.get(k)); const dot = raw.lastIndexOf('.');
    if (dot > 0) { store._map.set(k, raw.slice(0, dot) + '.' + (Date.now() - 7 * 60 * 60 * 1000)); aged++; }
  }
  assert.equal(aged, 1,
    'no draft tail was found on disk to age, so this row is not measuring what it names. Keys seen: ' +
    JSON.stringify([...store._map.keys()]));

  h.back();
  h.reopen();
  await ask(h);

  const ids = distinct(carereqs(relay.store));
  assert.equal(ids.length, 2,
    'a NEW ask, made long after the last one, landed at the SAME address and replaced it. The care team may ' +
    'already have acted on that first request, and nobody is told it has been overwritten. Ids: ' +
    JSON.stringify(ids));
  assert.ok(ids.includes(first[0]), 'the FIRST request must still be on the relay, untouched');
});

test('CONTROL: a retry inside one open sheet is still ONE ask', async () => {
  // Without this, "always mint a fresh tail" would pass the row above and put the original duplicate back.
  const relay = relayThat('unconfirmed');
  const h = screen({ api: engine(relay), store: disk() });
  await ask(h);
  await h.click('Send it again');
  assert.equal(relay.store.length, 2, 'CONTROL: both taps must really have reached the relay, or this row ' +
    'is satisfied by a sheet that sent nothing');
  assert.equal(distinct(carereqs(relay.store)).length, 1,
    'two taps inside one open sheet made two requests again — the fix this file is named for is gone');
});
