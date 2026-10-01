// A SERVING REQUEST THIS DEVICE CANNOT OPEN YET REACHES THE SCREEN, OPENS WHEN THE KEY LANDS, AND NOBODY IS
// ASKED TWICE BECAUSE OF IT.
// Run: node --test scripts/a-locked-serving-request-opens-when-the-key-lands.test.mjs
//
// Audit 2026-09-30, findings 5, 6, 7 and 13. C-4 sealed serving requests and replies under the church name key,
// which a phone and a console both start every session WITHOUT. What arrived first was marked `_locked` — and then:
//   5. the member app's pending filter compared its (missing) date with today and dropped it: it reached no screen;
//      a member on the rota tapping "I can serve" was told their leader never sent a request;
//   7. nothing re-read it when the key landed — the comment promising that was false;
//  13. the member's own unreadable reply was dropped, so an answered request was put back in front of them;
//   6. the console board could not tell which slot a locked request was for, called it "not asked", and re-asked
//      everyone on the next Publish.
//
// HOW IT ASSERTS. Every function is lifted from what ships — vendor/fellowship.js, vendor/steward.js — or sliced
// statement-by-statement from app/app.jsx and app/stew-schedule.jsx and executed (CLAUDE.md rule 3). The key
// arrives the way it really does: a signed name-key envelope handed to the shipped ingest function, never by
// poking the key map. Real NIP-44 throughout.
//
// Tests 7-14 were added after the audit of d86fbac: a request sealed under a key the church has since trimmed
// (it must read as unreadable, not "still opening" for ever), another church's locked request on the active
// church's screens, a stale request list in the board's send, and five claims that had no test that could fail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { v2 as nip44 } from 'nostr-tools/nip44';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { fnBody, stmt, liftKeyRead } from './test-slice.mjs';

const FELLOW = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
const STEWARD = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const APPJSX = readFileSync(new URL('../app/app.jsx', import.meta.url), 'utf8');
const SCHED = readFileSync(new URL('../app/stew-schedule.jsx', import.meta.url), 'utf8');

const churchSk = generateSecretKey(), CP = getPublicKey(churchSk);
const CP_B = getPublicKey(generateSecretKey());              // a second church this member also belongs to
const meSk = generateSecretKey(), ME = getPublicKey(meSk);
const NAMEKEY = generateSecretKey();                        // the church name key (32 random bytes)
const OLDKEY = generateSecretKey();                         // a key the church has since trimmed from its ring
const hex = (b) => Buffer.from(b).toString('hex');
const unhex = (h) => new Uint8Array(Buffer.from(h, 'hex'));
const DOC = { serviceId: 'svc1', teamId: 'kids', roleId: 'r1', role: 'Children’s worker', teamName: 'Kids Church', date: '2099-10-04', time: '10:30', service: 'Morning' };
const sealedWith = (key, obj) => JSON.stringify({ e: nip44.encrypt(JSON.stringify(obj), key) });
const sealed = (obj) => sealedWith(NAMEKEY, obj);

function once(src, anchor, file) {
  const at = src.indexOf(anchor);
  assert.notEqual(at, -1, `${anchor} is missing from ${file} — re-anchor this test`);
  assert.equal(src.indexOf(anchor, at + 1), -1, `${anchor} appears twice in ${file}`);
  return at;
}
const fn = (src, anchor, file) => fnBody(src, once(src, anchor, file), anchor);
const st = (src, anchor, file) => { once(src, anchor, file); return stmt(src, anchor); };

// ── The member phone: shipped reader + shipped key ingest ─────────────────────────────────────────────────
function memberPhone() {
  const handlers = [];
  const world = {
    _nameKeys: new Map(), _nameKeyTs: new Map(), _churchRoster: new Map(),
    decrypt: nip44.decrypt, getConversationKey: nip44.utils.getConversationKey,
    _unhexF: unhex, sk: meSk, pub: ME, NET: 'trinityone',
    window: { Fellowship: { myPubkey: ME, relays: ['wss://r'], churchPub: CP } },
    _netRelays: (r) => r,
    pool: { subscribeMany: (_r, _f, h) => { handlers.push(h); return { close() {} }; } },
  };
  const names = Object.keys(world);
  const body = `${st(FELLOW, 'var _nameKeyListeners', 'fellowship.js')}
    ${fn(FELLOW, 'function _onNameKey(fn)', 'fellowship.js')}
    ${fn(FELLOW, 'function _ingestNameKey(cp, e)', 'fellowship.js')}
    ${fn(FELLOW, 'function _openChurchDoc(cp, content)', 'fellowship.js')}
    const F = { ${fn(FELLOW, 'subscribeMyServingRequests(onReqs)', 'fellowship.js')},
                ${fn(FELLOW, 'subscribeMyReqReplies(onReplies)', 'fellowship.js')} };
    return { F, ingest: _ingestNameKey, onNameKey: _onNameKey };`;
  const api = new Function(...names, body)(...names.map(n => world[n]));
  // The envelope the console publishes: the ring, sealed to me, signed by the church.
  let at = 200;
  const envelope = (content) => ({ pubkey: CP, created_at: ++at, kind: 30078, tags: [['d', 'trinityone/namekey:' + CP]], content });
  const ringFor = (key) => JSON.stringify({ keys: { [ME]: nip44.encrypt(JSON.stringify([hex(key)]), nip44.utils.getConversationKey(churchSk, ME)) } });
  return { api, handlers, landKey: (key = NAMEKEY, ring) => api.ingest(CP, envelope(ring ? JSON.stringify({ keys: { [ME]: nip44.encrypt(JSON.stringify(ring), nip44.utils.getConversationKey(churchSk, ME)) } }) : ringFor(key))),
    landGarbage: () => api.ingest(CP, envelope(JSON.stringify({ keys: { [ME]: 'not-a-sealed-ring' } }))) };
}
const requestEvent = (id, key = NAMEKEY, at = 100) => ({ pubkey: CP, created_at: at, content: sealedWith(key, DOC), tags: [['d', 'trinityone/request:' + id], ['t', 'trinityone'], ['p', ME]] });
const replyEvent = (id, v) => ({ pubkey: ME, created_at: 110, content: sealed({ request: id, v, swapTo: '' }), tags: [['d', 'trinityone/reqreply:' + id], ['t', 'trinityone'], ['p', CP]] });

// app.jsx's own lines, sliced and run in order. `active` is the id of the active church: 'A' is CP, 'B' is CP_B.
const ACTIVE_CP = st(APPJSX, 'const _activeCp = (() =>', 'app.jsx');
const LOCKED_HERE = st(APPJSX, 'const _lockedHere = (r) =>', 'app.jsx');
const VERDICT = st(APPJSX, 'const _verdict = (q) =>', 'app.jsx');
const PENDING = st(APPJSX, 'const servPending = servReqs.filter(', 'app.jsx');
const CHURCHES = [{ id: 'A', npub: 'npubA' }, { id: 'B', npub: 'npubB' }];
const WIN = { Fellowship: { toPub: (n) => ({ npubA: CP, npubB: CP_B })[n] || null } };
const appDerive = (servReqs, servReplies, active = 'A', todayStr = '2026-09-30') =>
  new Function('servReqs', 'servReplies', 'todayStr', 'churches', 'activeChurch', 'window',
    `${ACTIVE_CP}\n${LOCKED_HERE}\n${VERDICT}\n${PENDING}\nreturn { servPending, _verdict, _lockedHere };`)(servReqs, servReplies, todayStr, CHURCHES, active, WIN);

test('a request this phone cannot open yet reaches the screen as a pending, locked row (finding 5)', () => {
  const p = memberPhone();
  let reqs = [];
  p.api.F.subscribeMyServingRequests((r) => { reqs = r; });
  p.handlers[0].onevent(requestEvent('req1'));
  assert.equal(reqs.length, 1); assert.equal(reqs[0]._locked, true, 'CONTROL: with no key the shipped reader marks it locked');
  const { servPending } = appDerive(reqs, {});
  assert.equal(servPending.length, 1, "the app's pending list dropped a request the phone had received");
  // …and the screen's own split puts it in the locked row
  const pendingLocked = new Function('pending', `${st(readFileSync(new URL('../app/screens-serving.jsx', import.meta.url), 'utf8'), 'const pendingLocked = pending.filter(', 'screens-serving.jsx')}\nreturn pendingLocked;`)(servPending);
  assert.equal(pendingLocked.length, 1, 'the serving screen does not show it as locked');
});

test('when the name key lands, the locked request opens in place — no re-delivery needed (finding 7)', () => {
  const p = memberPhone();
  let reqs = [];
  p.api.F.subscribeMyServingRequests((r) => { reqs = r; });
  p.handlers[0].onevent(requestEvent('req1'));
  assert.equal(reqs[0]._locked, true);
  p.landKey();                                                    // the shipped ingest, with a real envelope
  assert.equal(reqs.length, 1);
  assert.equal(reqs[0]._locked, undefined, 'the request is still locked after the key landed');
  assert.equal(reqs[0].role, DOC.role); assert.equal(reqs[0].date, DOC.date);
});

test("my own reply that cannot be opened yet still counts as answered, and opens when the key lands (finding 13)", () => {
  const p = memberPhone();
  let reqs = [], replies = {};
  p.api.F.subscribeMyServingRequests((r) => { reqs = r; });
  p.api.F.subscribeMyReqReplies((r) => { replies = r; });
  const [reqH, repH] = p.handlers;
  // A request this phone CAN read (cleartext, from before sealing) and my sealed answer to it.
  reqH.onevent({ ...requestEvent('req2'), content: JSON.stringify(DOC) });
  repH.onevent(replyEvent('req2', 'decline'));
  assert.equal(replies.req2, 'locked', 'my unreadable reply was dropped');
  const { servPending, _verdict } = appDerive(reqs, replies);
  assert.equal(servPending.length, 0, 'a request I already answered was put back in front of me');
  assert.equal(_verdict({ id: 'req2' }), 'pending', "a rota slot behind my unreadable reply shows a verdict the screen has no row for");
  p.landKey();
  assert.equal(replies.req2, 'decline', 'my reply did not open when the key landed');
});

const RESPOND = fn(APPJSX, 'respondServing: async (item, verdict, swapTo) =>', 'app.jsx');
const respondWith = (servReqs, active, toasts, sentTo = []) => {
  const { _lockedHere } = appDerive(servReqs, {}, active);
  const win = { Fellowship: { ...WIN.Fellowship, respondToServingRequest: async (church, id, v) => { sentTo.push([church, id, v]); return { ok: true }; } } };
  return new Function('churches', 'activeChurch', 'toast', 'servReqs', '_lockedHere', 'window', 'setServReplies',
    `const o = { ${RESPOND} }; return o.respondServing;`)(CHURCHES, active, (m) => toasts.push(m), servReqs, _lockedHere, win, () => {});
};

test('"I can serve" on a rota slot while a request is still locked does not blame the leader (finding 5, knock-on)', async () => {
  const toasts = [];
  await respondWith([{ id: 'req9', church: CP, _locked: true }], 'A', toasts)({ id: 'rota:svc1:kids::r1', req: null }, 'accept');
  assert.match(toasts.at(-1), /still opening/i, 'the member was told their leader never sent a request');
  await respondWith([], 'A', toasts)({ id: 'rota:svc1:kids::r1', req: null }, 'accept');
  assert.match(toasts.at(-1), /hasn’t sent a request/, 'CONTROL: with nothing locked, the original message stands');
});

// ── The console: shipped readers + shipped key-ring fill + the shipped first-key mint ─────────────────────
function console_() {
  const handlers = [];
  const world = {
    pub: CP, churchPub: CP, churchSk, actingChurch: '', NET: 'trinityone', REQUEST_D: 'trinityone/request:', REQREPLY_D: 'trinityone/reqreply:', NAMEKEY_D: 'trinityone/namekey:',
    decrypt3: nip44.decrypt, encrypt3: nip44.encrypt, getConversationKey: nip44.utils.getConversationKey, _unhex: unhex, _hex: hex,
    relays: () => ['wss://r'], _byChurchOrSteward: () => true, _webQueueSync: () => {},
    _isRelayAuthed: () => true, NAME_RING_MAX: 50, toPubHex: (p) => p, _localBlocked: new Set(),
    _sealEach: async (pl, recips, f) => Object.fromEntries(recips.map(p => [p, f(pl, p)])),
    publish: async () => ({ id: 'published' }), feChurch: (x) => x, now: () => 300,
    pool: { subscribeMany: (_r, _f, h) => { handlers.push(h); return { close() {} }; } },
  };
  const names = Object.keys(world);
  const body = `let _nameKeyRing = [], _nameKeyDocKeys = null, _nameKeyChecked = false;
    ${st(STEWARD, 'var _nameKeyAt = 0;', 'steward.js')}
    ${st(STEWARD, 'var _CLOCK_SKEW = ', 'steward.js')}
    ${st(STEWARD, 'var _authFuture = (e) =>', 'steward.js')}
    ${st(STEWARD, 'var _nameKeyListeners', 'steward.js')}
    ${fn(STEWARD, 'function _onNameKeyRing(fn)', 'steward.js')}
    ${fn(STEWARD, 'function _nameKeyRingChanged()', 'steward.js')}
    ${fn(STEWARD, 'function _nameKeyReady()', 'steward.js')}
    ${fn(STEWARD, 'function _openChurchDoc(content)', 'steward.js')}
    ${liftKeyRead(STEWARD)}
    const S = { ${fn(STEWARD, 'subscribeRequests(onRequests)', 'steward.js')},
                ${fn(STEWARD, 'subscribeRequestReplies(onReplies)', 'steward.js')},
                ${fn(STEWARD, 'async _ensureNameKeyLocked(memberPubs, stewardPubs, opts = {})', 'steward.js')},
                ${fn(STEWARD, 'subscribeNameKey()', 'steward.js')} };
    return { S, ring: () => _nameKeyRing };`;
  const api = new Function(...names, body)(...names.map(n => world[n]));
  const envelopeFor = (key, at = 200, ring = [hex(key)]) => ({ pubkey: CP, created_at: at, kind: 30078, tags: [['d', 'trinityone/namekey:' + CP]],
    content: JSON.stringify({ keys: { [CP]: nip44.encrypt(JSON.stringify(ring), nip44.utils.getConversationKey(churchSk, CP)) } }) });
  return { api, handlers, envelope: envelopeFor(NAMEKEY), envelopeFor };
}
const consoleRequest = (id, key = NAMEKEY, at = 100) => ({ pubkey: CP, created_at: at, content: sealedWith(key, DOC), tags: [['d', 'trinityone/request:' + id], ['p', ME], ['t', 'trinityone']] });

test('the console re-opens a locked request when its key ring fills (findings 6, 7)', () => {
  const c = console_();
  let reqs = [];
  c.api.S.subscribeRequests((r) => { reqs = r; });
  c.api.S.subscribeNameKey();
  const [reqH, keyH] = c.handlers;
  reqH.onevent(consoleRequest('req1'));
  assert.equal(reqs[0]._locked, true, 'CONTROL: with an empty ring the console marks it locked');
  keyH.onevent(c.envelope);                                       // the shipped reader of the church's own envelope
  assert.equal(reqs[0]._locked, undefined, 'the console request stayed locked after the ring filled');
  assert.equal(reqs[0].serviceId, DOC.serviceId);
});

// ── The board: stew-schedule.jsx's own verdict + send logic, sliced and run ───────────────────────────────
function board(requests) {
  const sent = [];
  const body = `${st(SCHED, 'const heldFlash = (lead, n, retry) =>', 'stew-schedule.jsx')}
    ${st(SCHED, 'const replyById = {};', 'stew-schedule.jsx')}
    ${st(SCHED, 'const requestsRef = useSchR(requests)', 'stew-schedule.jsx')}
    ${st(SCHED, 'const lockedFor = (pub) =>', 'stew-schedule.jsx')}
    ${st(SCHED, 'const slotVerdict = (svcId, teamId, roleId, pub) =>', 'stew-schedule.jsx')}
    ${st(SCHED, 'const alreadyAsked = (sId, tId, rId, pub) =>', 'stew-schedule.jsx')}
    ${st(SCHED, 'const sendRequestsFor = async (sId, sDate, sTime, sName, assignMap) =>', 'stew-schedule.jsx')}
    return { slotVerdict, sendRequestsFor, requestsRef, heldFlash };`;
  const replies = [];
  const window = { Steward: { sendServingRequest: async (r) => { sent.push(r); return { id: 'new' }; } } };
  const b = new Function('requests', 'replies', 'teams', 'teamMeta', 'rosterFor', 'window', 'useSchR', body)(
    requests, replies, [{ id: 'kids', name: 'Kids' }], () => ({ name: 'Kids' }), () => ({ roles: [{ id: 'r1', name: 'Worker' }], people: [] }), window, (v) => ({ current: v }));
  return { ...b, sent };
}
const ASSIGN = { 'kids::r1': { name: 'Me', pub: ME } };

test('the board does not re-ask someone whose request it cannot open yet, and says "opening" (finding 6)', async () => {
  const b = board([{ id: 'req1', memberPub: ME, _locked: true }]);
  assert.equal(b.slotVerdict('svc1', 'kids', 'r1', ME), 'locked', 'a slot behind a locked request reads as "not asked"');
  const r = await b.sendRequestsFor('svc1', '2099-10-04', '10:30', 'Morning', ASSIGN);
  assert.equal(b.sent.length, 0, 'Publish sent a second request to someone who may already have one');
  assert.deepEqual(r, { tried: 0, failed: 0, held: 1, heldPubs: [ME] }, 'a held ask must be counted apart from a failed one, so the flash can say which');
  // CONTROL: nobody locked -> asked as before
  const b2 = board([]);
  await b2.sendRequestsFor('svc1', '2099-10-04', '10:30', 'Morning', ASSIGN);
  assert.equal(b2.sent.length, 1, 'CONTROL: an ordinary Publish asks the person');
  assert.equal(b2.slotVerdict('svc1', 'kids', 'r1', ME), '', 'CONTROL: not asked reads as not asked');
});

// ── After the audit of d86fbac ────────────────────────────────────────────────────────────────────────────

test('console: a request sealed under a key since trimmed from a LOADED ring is unreadable, and the member is asked (audit #1)', async () => {
  const c = console_();
  let reqs = [];
  c.api.S.subscribeRequests((r) => { reqs = r; });
  c.api.S.subscribeNameKey();
  const [reqH, keyH] = c.handlers;
  keyH.onevent(c.envelopeFor(NAMEKEY));                           // the ring holds only the current key
  reqH.onevent(consoleRequest('old', OLDKEY));                    // …and this request was sealed under a trimmed one
  assert.equal(reqs[0]._locked, undefined, 'a request the loaded ring can never open is shown as "still opening"');
  assert.equal(reqs[0]._unreadable, true);
  const b = board(reqs);
  assert.equal(b.slotVerdict('svc2', 'kids', 'r1', ME), '', 'the board reads every slot for this member as "opening", for ever');
  await b.sendRequestsFor('svc2', '2099-10-11', '10:30', 'Morning', ASSIGN);
  assert.equal(b.sent.length, 1, 'the board can never ask this member again');
});

test('phone: a request sealed under a trimmed key is unreadable, not pending, once the church key is held (audit #1)', async () => {
  const p = memberPhone();
  let reqs = [];
  p.api.F.subscribeMyServingRequests((r) => { reqs = r; });
  p.landKey(NAMEKEY);
  p.handlers[0].onevent(requestEvent('old', OLDKEY));
  assert.equal(reqs[0]._unreadable, true, 'a request that will never open is shown as waiting');
  assert.equal(appDerive(reqs, {}).servPending.length, 0, 'a request that will never open is counted as waiting for a reply');
  const toasts = [];
  await respondWith(reqs, 'A', toasts)({ id: 'rota:svc1:kids::r1', req: null }, 'accept');
  assert.doesNotMatch(toasts.at(-1), /still opening/i, 'the member is told a request that will never open is still opening');
});

test("another church's locked request stays off the active church's screens (audit #2)", async () => {
  const lockedB = [{ id: 'reqB', church: CP_B, _locked: true, ts: 1 }];
  assert.equal(appDerive(lockedB, {}, 'A').servPending.length, 0, "church B's locked request is counted on church A's screens");
  const toasts = [];
  await respondWith(lockedB, 'A', toasts)({ id: 'rota:svc1:kids::r1', req: null }, 'accept');
  assert.match(toasts.at(-1), /hasn’t sent a request/, "church A's rota slot blames church B's locked request");
  assert.equal(appDerive(lockedB, {}, 'B').servPending.length, 1, 'CONTROL: on church B it is shown');
});

test('the board sends against the LATEST request list, not the one from before the key wait (audit #5)', async () => {
  const b = board([{ id: 'req1', memberPub: ME, _locked: true }]);
  b.requestsRef.current = [{ id: 'req1', memberPub: ME, ...DOC }];   // the key landed during publish's wait and the request opened
  await b.sendRequestsFor('svc9', '2099-10-18', '10:30', 'Evening', ASSIGN);
  assert.equal(b.sent.length, 1, 'the send used a stale list and held back someone who was already openable');
});

test('console: minting the first name key re-reads what could not be opened (claim: "both places notify")', async () => {
  const c = console_();
  let reqs = [];
  c.api.S.subscribeRequests((r) => { reqs = r; });
  c.api.S.subscribeNameKey();
  const [reqH, keyH] = c.handlers;
  keyH.oneose();                                                  // the relay answered: no envelope yet
  reqH.onevent(consoleRequest('r1', OLDKEY));
  assert.equal(reqs[0]._locked, true, 'CONTROL: ring empty -> locked');
  const out = await c.api.S._ensureNameKeyLocked([ME], []);
  assert.ok(out && c.api.ring().length === 1, 'CONTROL: the console minted its first key');
  assert.equal(reqs[0]._unreadable, true, 'minting a key did not re-read the locked request (ensureNameKeyForMembers does not notify)');
});

test('console: a reply it cannot open yet is kept and opens when the ring fills (claim: replies keep and re-read)', () => {
  const c = console_();
  let replies = [];
  c.api.S.subscribeRequestReplies((r) => { replies = r; });
  c.api.S.subscribeNameKey();
  const [repH, keyH] = c.handlers;
  repH.onevent({ pubkey: ME, created_at: 120, content: sealed({ request: 'req1', v: 'decline' }), tags: [['d', 'trinityone/reqreply:req1'], ['p', CP], ['t', 'trinityone']] });
  assert.equal(replies[0]._locked, true);
  keyH.onevent(c.envelope);
  assert.equal(replies[0].v, 'decline', "the console's reply stayed unread after the ring filled");
});

test('phone: listeners are told only when a USABLE key lands (claim: notify only after a usable envelope)', () => {
  const p = memberPhone();
  let calls = 0; p.api.onNameKey(() => { calls++; });
  p.landGarbage();                                                // an envelope addressed to me that does not open
  assert.equal(calls, 0, 'a broken envelope told every reader a key had landed');
  p.landKey();
  assert.equal(calls, 1, 'CONTROL: a usable envelope notifies');
});

test('unsubscribing stops the re-read (phone and console)', () => {
  const p = memberPhone();
  let n = 0; const stop = p.api.F.subscribeMyServingRequests(() => { n++; });
  p.handlers[0].onevent(requestEvent('req1'));
  const before = n; stop(); p.landKey();
  assert.equal(n, before, 'a closed phone subscription was still re-read when the key landed');
  const c = console_();
  let m = 0; const stopC = c.api.S.subscribeRequests(() => { m++; });
  c.api.S.subscribeNameKey();
  c.handlers[0].onevent(consoleRequest('req1'));
  const beforeC = m; stopC(); c.handlers[1].onevent(c.envelope);
  assert.equal(m, beforeC, 'a closed console subscription was still re-read when the ring filled');
});

// ── After the audit of 660f063 ────────────────────────────────────────────────────────────────────────────

test('console: a request NEWER than the ring it holds is waiting, not unreadable — and opens when the newer ring lands', async () => {
  const c = console_();
  let reqs = [];
  c.api.S.subscribeRequests((r) => { reqs = r; });
  c.api.S.subscribeNameKey();
  const [reqH, keyH] = c.handlers;
  keyH.onevent(c.envelopeFor(OLDKEY, 200));                      // this console holds the ring from before a rotation
  reqH.onevent(consoleRequest('r1', NAMEKEY, 250));               // another steward sealed this under the NEW key
  assert.equal(reqs[0]._locked, true, 'a request sealed under a key still on its way was written off as unreadable');
  const b = board(reqs);
  const out = await b.sendRequestsFor('svc1', '2099-10-04', '10:30', 'Morning', ASSIGN);
  assert.equal(b.sent.length, 0, 'the board asked the same person twice');
  assert.equal(out.held, 1);
  keyH.onevent(c.envelopeFor(NAMEKEY, 300, [hex(NAMEKEY), hex(OLDKEY)]));   // the newer ring arrives
  assert.equal(reqs[0].serviceId, DOC.serviceId, 'it did not open when the newer ring landed');
});

test('phone: a request NEWER than the keys it holds is waiting, not unreadable — and opens when the newer key lands', () => {
  const p = memberPhone();
  let reqs = [];
  p.api.F.subscribeMyServingRequests((r) => { reqs = r; });
  p.landKey(OLDKEY);                                              // envelope at 201
  p.handlers[0].onevent(requestEvent('r1', NAMEKEY, 250));
  assert.equal(reqs[0]._locked, true, 'a request sealed under a key still on its way was written off as unreadable');
  assert.equal(appDerive(reqs, {}).servPending.length, 1, 'while it waits it must still reach the screen');
  p.landKey(null, [hex(NAMEKEY), hex(OLDKEY)]);                   // envelope at 202 — the newer ring
  assert.equal(reqs[0].role, DOC.role, 'it did not open when the newer key landed');
});

test('a request that opens during the wait, for the SAME slot, is not sent again (the ref, via alreadyAsked)', async () => {
  const b = board([{ id: 'req1', memberPub: ME, _locked: true }]);
  b.requestsRef.current = [{ id: 'req1', memberPub: ME, ...DOC }];   // it opened: it IS the svc1 / kids / r1 ask
  const out = await b.sendRequestsFor('svc1', '2099-10-04', '10:30', 'Morning', ASSIGN);
  assert.equal(b.sent.length, 0, 'a person already asked for this slot was asked again');
  assert.deepEqual([out.tried, out.held], [0, 0]);
});

test("a request a DELEGATED steward signed (['church'] tag) shows on that church's screens", () => {
  const p = memberPhone();
  let reqs = [];
  p.api.F.subscribeMyServingRequests((r) => { reqs = r; });
  const delegate = getPublicKey(generateSecretKey());
  p.handlers[0].onevent({ ...requestEvent('d1'), pubkey: delegate, tags: [['d', 'trinityone/request:d1'], ['t', 'trinityone'], ['p', ME], ['church', CP]] });
  assert.equal(reqs[0].church, CP, "the request was filed under the delegate, not the church");
  assert.equal(appDerive(reqs, {}, 'A').servPending.length, 1, "a delegate's request is hidden from the church's own screens");
});

test("answering another church's request sends the answer to THAT church, not the active one (audit #3)", async () => {
  const toasts = [], sentTo = [];
  const reqB = { id: 'reqB', church: CP_B, ...DOC };
  await respondWith([reqB], 'A', toasts, sentTo)(reqB, 'accept');
  assert.deepEqual(sentTo, [[CP_B, 'reqB', 'accept']], "the answer went to the active church, where church B never reads it");
  const slot = { id: 'rota:svc1:kids::r1', req: { id: 'reqA', church: CP } };
  await respondWith([slot.req], 'A', toasts, sentTo)(slot, 'decline');
  assert.deepEqual(sentTo.at(-1), [CP, 'reqA', 'decline'], 'CONTROL: a rota slot answers its own church');
});

// The three publishers read `held` and name the right control (audit of 660f063, #4, #5).
function publishers(asked) {
  const flashes = [];
  const svc = { id: 'svc1', date: '2099-10-04', time: '10:30', name: 'Morning' };
  const world = {
    window: { Steward: { publishRota: async () => ({ id: 'rota' }), publishService: async (x) => ({ ...x, id: x.id || 'n' }), nameKeyReady: () => true } },
    svcId: 'svc1', svc, assign: ASSIGN, sortedSvcs: [svc], services: [svc], setFlash: (m) => flashes.push(m), setFillMenu: () => {}, setAssign: () => {},
    SCH_NO_KEY: 'no key', setTimeout: () => {}, sendRequestsFor: async () => asked,
    schAddMonths: () => '2099-10-05', schGenDates: () => ['2099-10-04'], fillAssign: () => ASSIGN, assignFor: () => ASSIGN,
    rosterFor: () => ({ roles: [{ id: 'r1' }], pods: [{ name: 'Pod A', fills: {} }], people: [] }), todayISO: () => '2026-09-30',
  };
  const names = Object.keys(world);
  const body = `${st(SCHED, 'const heldFlash = (lead, n, retry) =>', 'stew-schedule.jsx')}
    ${st(SCHED, 'const unaskedFlash = (lead, failed, tried, retry) =>', 'stew-schedule.jsx')}
    ${st(SCHED, 'const publish = async () =>', 'stew-schedule.jsx')}
    ${st(SCHED, 'const rotatePods = (team) =>', 'stew-schedule.jsx')}
    ${st(SCHED, 'const autoFillAhead = async (months) =>', 'stew-schedule.jsx')}
    return { publish, rotatePods, autoFillAhead };`;
  return { ...new Function(...names, body)(...names.map(n => world[n])), flashes };
}

test('all three publishers tell the steward about a held person, naming the control that will ask them', async () => {
  const asked = { tried: 0, failed: 0, held: 1, heldPubs: [ME] };
  const a = publishers(asked); await a.publish();
  assert.match(a.flashes.at(-1) || '', /1 person has an earlier request still opening — press Publish again/, 'Publish ignored the held person');
  const b = publishers(asked); b.rotatePods({ id: 'kids' }); await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r));
  assert.match(b.flashes.at(-1) || '', /still opening — Open each service and press Publish/, 'rotating pods ignored the held person, or named the wrong control');
  const c = publishers(asked); await c.autoFillAhead(1);
  assert.match(c.flashes.at(-1) || '', /still opening — Open each service and press Publish/, 'bulk create-and-fill ignored the held person, or named the wrong control');
});
