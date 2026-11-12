// THE SAFEGUARDING "KNOWN" FLAGS FOLLOW A LOGIN THAT COMES AFTER THE RELAY'S ANSWER — AND NOTHING ELSE TURNS THEM ON.
//   Run: node --test scripts/safeguarding-flags-follow-a-login-that-comes-after-the-answer.test.mjs
//
// Audit F1 (LOW, fails closed) of the narrow-reads branch. subscribeSafeguard (src/steward.src.js) reports
// minorsKnown / clearedKnown as "the document arrived, or the relay finished WHILE WE WERE LOGGED IN". With the
// safeguarding REQ narrowed to its own four documents it is often the FIRST REQ on a fresh socket; when none of
// them exists the relay answers EOSE at once with no login challenge, both flags are asked before any login is
// accepted, and nothing asked again until the next re-subscribe — young people's care requests stayed
// "CHECKING… HELD CONFIDENTIAL", and a first youth-volunteer clearance could be written with no date.
//
// Rule 1: subscribeSafeguard is lifted out of the SHIPPED bundle (vendor/steward.js) with the key reads' own
// _keyReadAfterAuth, and driven over a fake pool whose socket objects stand for nostr-tools' AbstractRelay. The
// login is accepted the way the engine records it (_authAccepted set to that socket, then the waiters run —
// _runKeyReadAuthWaiters, lifted too). Nothing here matches text in app/*.jsx.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';

const STEWARD = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const CP = '1'.repeat(64);
const URL1 = 'wss://a/';

const URL2 = 'wss://b/';
function harness({ urls = [URL1] } = {}) {
  const body = fnBody(STEWARD, 'subscribeSafeguard(onLists) {', 'subscribeSafeguard');
  const helpers = [fnBody(STEWARD, 'function _keyReadAfterAuth', '_keyReadAfterAuth'), fnBody(STEWARD, 'function _runKeyReadAuthWaiters', '_runKeyReadAuthWaiters')].join('\n');
  let wall = 1_000_000;
  const sock = { connected: true, challenge: undefined };
  const relaysMap = new Map([[URL1, sock], ...urls.filter(u => u !== URL1).map(u => [u, { connected: true, challenge: undefined }])]);
  const subs = [];
  const out = [];
  const scope = {
    pub: CP, NET: 'trinityone',
    MINORS_D: 'trinityone/minors:', APPROVED_D: 'trinityone/approved:', NOPHOTO_D: 'trinityone/nophoto:', GUARDIANS_D: 'trinityone/guardians:',
    SGCLEAR_LAST_LS: 'sgclear.', localStorage: { removeItem() {} },
    pool: {
      relays: relaysMap,
      subscribeMany(urls, filters, h) { const s = { urls, filters, h, closed: false, close() { s.closed = true; } }; subs.push(s); return s; },
    },
    relays: () => urls.slice(), normalizeURL: (u) => u,
    _byChurch: () => true, _byChurchOrSteward: () => true, _authFuture: () => false, _applyNoPhotoList: () => {},
    _sgClearGet: () => null, _sgClearSet: () => {}, _clearedTrail: null,
    _authedRelays: new Map(), _authAccepted: new Map(), _keyReadAuthWaiters: new Set(), _runPendingRotations: () => {},
    // the engine's own answer to "is any relay in the set logged in", over the same maps (the shipped
    // _isRelayAuthed asks pool.listConnectionStatus(); this fake pool's sockets are its status)
    _isRelayAuthed: () => [...relaysMap].some(([k, r]) => r.connected && scope._authedRelays.get(k) === r),
    Date: class extends Date { static now() { return wall; } },
  };
  const names = Object.keys(scope);
  const api = new Function(...names, `${helpers}\nreturn { _runKeyReadAuthWaiters, sg: ({ ${body} }) };`)(...names.map(n => scope[n]));
  const h = {
    scope, subs, out, sock, relaysMap,
    open: () => api.sg.subscribeSafeguard((l) => out.push(l)),
    last: () => out[out.length - 1] || {},
    sub: (url = URL1) => [...subs].reverse().find(s => s.urls[0] === url),
    // a genuine EOSE, no document (none exists), socket stays up
    eose: async (url = URL1) => { h.sub(url).h.oneose(); await new Promise(r => setImmediate(r)); },
    // the relay accepts our login on THIS socket: what the engine's automaticallyAuth records, then its waiters
    login: (r = sock, url = URL1) => { scope._authedRelays.set(url, r); scope._authAccepted.set(url, r); api._runKeyReadAuthWaiters(); },
    late: (ms) => { wall += ms; },
  };
  return h;
}

test('the first REQ on a fresh socket, no gated document, no challenge: both flags false; the login is accepted: both true, with no re-subscribe', async () => {
  const h = harness();
  h.open();
  await h.eose();
  assert.equal(h.last().minorsKnown, false, 'an answer given before any login counted as known');
  assert.equal(h.last().clearedKnown, false);
  const before = h.subs.length;
  h.login();
  assert.equal(h.last().minorsKnown, true, 'THE LOGIN WAS ACCEPTED ON THE SOCKET THAT ANSWERED, and minorsKnown stayed false — care requests stay "held confidential"');
  assert.equal(h.last().clearedKnown, true, 'clearedKnown stayed false after the login — a first clearance is written undated');
  assert.equal(h.subs.length, before, 'it re-subscribed instead of re-asking');
  assert.deepEqual(h.last().minors, [], 'no document arrived, so the list is the genuine empty');
});

test('an unauthenticated EOSE alone never sets them', async () => {
  const h = harness();
  h.open();
  await h.eose();
  assert.equal(h.last().minorsKnown, false);
  assert.equal(h.last().clearedKnown, false);
});

test('a socket the relay dropped (oneose then onclose, same turn), then a login on a NEW socket: still unknown', async () => {
  const h = harness();
  h.open();
  const s = h.sub();
  h.sock.connected = false; s.h.oneose(); s.h.onclose(['1009 too slow']);
  await new Promise(r => setImmediate(r));
  const fresh = { connected: true, challenge: undefined };
  h.relaysMap.set(URL1, fresh);
  h.login(fresh);
  // _isRelayAuthed() is now true on the new socket, so the OLD rule (sawEose && authed) answers true at the next
  // emit — that is the pre-existing behaviour and not this change. What this change must not do is ITSELF emit,
  // or answer true from the dropped socket's EOSE: the last emit is still the one from the drop.
  assert.equal(h.last().minorsKnown, false, 'a dropped socket\'s EOSE plus a login elsewhere was re-announced as known');
});

test('nostr-tools\' own EOSE timer, then a login on the same socket: still unknown', async () => {
  const h = harness();
  h.sock.connected = false;                         // the library timer exists only for a relay still connecting when asked
  h.open();
  assert.equal(h.sub().h.maxWait, undefined, 'staging: a relay still connecting keeps the library default timer');
  h.sock.connected = true;
  h.late(4400);
  await h.eose();
  h.login();
  assert.equal(h.last().minorsKnown, false, 'a timed-out read was taken as a genuine answer once the login landed');
});

test('an answer on a socket that had been CHALLENGED and not logged in (the relay may have withheld the document): still unknown after the login', async () => {
  const h = harness();
  h.open();
  h.sock.challenge = 'chal';
  await h.eose();
  h.login();
  assert.equal(h.last().minorsKnown, false, 'an answer the relay may have held back for the login was taken as "no children"');
  assert.equal(h.last().clearedKnown, false);
});

test('a closed subscription does not answer a later login', async () => {
  const h = harness();
  const off = h.open();
  await h.eose();
  const n = h.out.length;
  off();
  h.login();
  assert.equal(h.out.length, n, 'a subscription the screen closed emitted after a login');
  assert.equal(h.scope._keyReadAuthWaiters.size, 0, 'the closed subscription left its login waiter behind');
});

test('a relay that CLOSES the safeguarding REQ but keeps its socket connected never counts — not even after a login on it', async () => {
  // Two relays. A answers on a socket the relay challenged and we have not logged in to (so not genuine for these flags);
  // B refuses the REQ with CLOSED ("rate-limited: too many subscriptions") and its socket stays CONNECTED. nostr-tools
  // runs B's oneose then onclose in the same turn. The pool-level read this replaced fired one oneose once both were
  // "finished", saw no all-closed onclose, and remembered B's socket as having answered.
  const h = harness({ urls: [URL1, URL2] });
  h.open();
  assert.equal(h.subs.length, 2, 'one safeguarding subscription per relay');
  assert.ok(h.subs.every(s => s.urls.length === 1), 'a safeguarding subscription spans more than one relay');
  assert.ok(h.subs.every(s => s.h.maxWait > 600000), 'a connected relay must not be given a wall-clock cutoff');
  h.sock.challenge = 'chal';
  const b = h.sub(URL2);
  b.h.oneose(); b.h.onclose('rate-limited: too many subscriptions');
  await h.eose(URL1);
  const bSock = h.relaysMap.get(URL2);
  assert.equal(bSock.connected, true, 'staging: B\'s socket is still up');
  h.login(bSock, URL2);
  assert.equal(h.last().minorsKnown, false, 'A RELAY THAT REFUSED THE READ was taken as having answered "no children" once we logged in to it');
  assert.equal(h.last().clearedKnown, false, 'a relay that refused the read made the clearance list "known"');
});

test('the instrument for the row above: the same two relays, B answering genuinely, then a login on B: known', async () => {
  const h = harness({ urls: [URL1, URL2] });
  h.open();
  h.sock.challenge = 'chal';
  await h.eose(URL2);
  await h.eose(URL1);
  h.login(h.relaysMap.get(URL2), URL2);
  assert.equal(h.last().minorsKnown, true, 'a genuine answer from B plus a login on B should be known — else the row above proves nothing');
});
