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
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { v2 as nip44 } from 'nostr-tools/nip44';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { fnBody, stmt } from './test-slice.mjs';

const FELLOW = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
const STEWARD = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const APPJSX = readFileSync(new URL('../app/app.jsx', import.meta.url), 'utf8');
const SCHED = readFileSync(new URL('../app/stew-schedule.jsx', import.meta.url), 'utf8');

const churchSk = generateSecretKey(), CP = getPublicKey(churchSk);
const meSk = generateSecretKey(), ME = getPublicKey(meSk);
const NAMEKEY = generateSecretKey();                        // the church name key (32 random bytes)
const hex = (b) => Buffer.from(b).toString('hex');
const unhex = (h) => new Uint8Array(Buffer.from(h, 'hex'));
const DOC = { serviceId: 'svc1', teamId: 'kids', roleId: 'r1', role: 'Children’s worker', teamName: 'Kids Church', date: '2099-10-04', time: '10:30', service: 'Morning' };
const sealed = (obj) => JSON.stringify({ e: nip44.encrypt(JSON.stringify(obj), NAMEKEY) });

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
    return { F, ingest: _ingestNameKey };`;
  const api = new Function(...names, body)(...names.map(n => world[n]));
  // The envelope the console publishes: the ring, sealed to me, signed by the church.
  const envelope = () => ({ pubkey: CP, created_at: 200, kind: 30078, tags: [['d', 'trinityone/namekey:' + CP]],
    content: JSON.stringify({ keys: { [ME]: nip44.encrypt(JSON.stringify([hex(NAMEKEY)]), nip44.utils.getConversationKey(churchSk, ME)) } }) });
  return { api, handlers, landKey: () => api.ingest(CP, envelope()) };
}
const requestEvent = (id) => ({ pubkey: CP, created_at: 100, content: sealed(DOC), tags: [['d', 'trinityone/request:' + id], ['t', 'trinityone'], ['p', ME]] });
const replyEvent = (id, v) => ({ pubkey: ME, created_at: 110, content: sealed({ request: id, v, swapTo: '' }), tags: [['d', 'trinityone/reqreply:' + id], ['t', 'trinityone'], ['p', CP]] });

// app.jsx's own lines, sliced and run in order: _verdict and servPending.
const VERDICT = st(APPJSX, 'const _verdict = (q) =>', 'app.jsx');
const PENDING = st(APPJSX, 'const servPending = servReqs.filter(', 'app.jsx');
const appDerive = (servReqs, servReplies, todayStr = '2026-09-30') =>
  new Function('servReqs', 'servReplies', 'todayStr', `${VERDICT}\n${PENDING}\nreturn { servPending, _verdict };`)(servReqs, servReplies, todayStr);

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

test('"I can serve" on a rota slot while a request is still locked does not blame the leader (finding 5, knock-on)', async () => {
  const src = fn(APPJSX, 'respondServing: async (item, verdict, swapTo) =>', 'app.jsx');
  const toasts = [];
  const run = (servReqs) => new Function('churches', 'activeChurch', 'toast', 'servReqs', 'window',
    `const o = { ${src} }; return o.respondServing;`)([{ id: 'c', npub: 'npub1x' }], 'c', (m) => toasts.push(m), servReqs, { Fellowship: {} });
  await run([{ id: 'req9', _locked: true }])({ id: 'rota:svc1:kids::r1', req: null }, 'accept');
  assert.match(toasts.at(-1), /still opening/i, 'the member was told their leader never sent a request');
  await run([])({ id: 'rota:svc1:kids::r1', req: null }, 'accept');
  assert.match(toasts.at(-1), /hasn’t sent a request/, 'CONTROL: with nothing locked, the original message stands');
});

// ── The console: shipped readers + shipped key-ring fill ──────────────────────────────────────────────────
function console_() {
  const handlers = [];
  const world = {
    pub: CP, churchPub: CP, churchSk, actingChurch: '', NET: 'trinityone', REQUEST_D: 'trinityone/request:', REQREPLY_D: 'trinityone/reqreply:', NAMEKEY_D: 'trinityone/namekey:',
    decrypt3: nip44.decrypt, getConversationKey: nip44.utils.getConversationKey, _unhex: unhex,
    relays: () => ['wss://r'], _byChurchOrSteward: () => true, _webQueueSync: () => {},
    pool: { subscribeMany: (_r, _f, h) => { handlers.push(h); return { close() {} }; } },
  };
  const names = Object.keys(world);
  const body = `let _nameKeyRing = [], _nameKeyDocKeys = null, _nameKeyChecked = false;
    ${st(STEWARD, 'var _nameKeyListeners', 'steward.js')}
    ${fn(STEWARD, 'function _onNameKeyRing(fn)', 'steward.js')}
    ${fn(STEWARD, 'function _nameKeyRingChanged()', 'steward.js')}
    ${fn(STEWARD, 'function _nameKeyReady()', 'steward.js')}
    ${fn(STEWARD, 'function _openChurchDoc(content)', 'steward.js')}
    const S = { ${fn(STEWARD, 'subscribeRequests(onRequests)', 'steward.js')},
                ${fn(STEWARD, 'subscribeNameKey()', 'steward.js')} };
    return { S };`;
  const api = new Function(...names, body)(...names.map(n => world[n]));
  const envelope = { pubkey: CP, created_at: 200, kind: 30078, tags: [['d', 'trinityone/namekey:' + CP]],
    content: JSON.stringify({ keys: { [CP]: nip44.encrypt(JSON.stringify([hex(NAMEKEY)]), nip44.utils.getConversationKey(churchSk, CP)) } }) };
  return { api, handlers, envelope };
}

test('the console re-opens a locked request when its key ring fills (findings 6, 7)', () => {
  const c = console_();
  let reqs = [];
  c.api.S.subscribeRequests((r) => { reqs = r; });
  c.api.S.subscribeNameKey();
  const [reqH, keyH] = c.handlers;
  reqH.onevent({ pubkey: CP, created_at: 100, content: sealed(DOC), tags: [['d', 'trinityone/request:req1'], ['p', ME], ['t', 'trinityone']] });
  assert.equal(reqs[0]._locked, true, 'CONTROL: with an empty ring the console marks it locked');
  keyH.onevent(c.envelope);                                       // the shipped reader of the church's own envelope
  assert.equal(reqs[0]._locked, undefined, 'the console request stayed locked after the ring filled');
  assert.equal(reqs[0].serviceId, DOC.serviceId);
});

// ── The board: stew-schedule.jsx's own verdict + send logic, sliced and run ───────────────────────────────
function board(requests) {
  const sent = [];
  const body = `${st(SCHED, 'const replyById = {};', 'stew-schedule.jsx')}
    ${st(SCHED, 'const lockedFor = (pub) =>', 'stew-schedule.jsx')}
    ${st(SCHED, 'const slotVerdict = (svcId, teamId, roleId, pub) =>', 'stew-schedule.jsx')}
    ${st(SCHED, 'const alreadyAsked = (sId, tId, rId, pub) =>', 'stew-schedule.jsx')}
    ${st(SCHED, 'const sendRequestsFor = async (sId, sDate, sTime, sName, assignMap) =>', 'stew-schedule.jsx')}
    return { slotVerdict, sendRequestsFor };`;
  const replies = [];
  const window = { Steward: { sendServingRequest: async (r) => { sent.push(r); return { id: 'new' }; } } };
  const b = new Function('requests', 'replies', 'teams', 'teamMeta', 'rosterFor', 'window', body)(
    requests, replies, [{ id: 'kids', name: 'Kids' }], () => ({ name: 'Kids' }), () => ({ roles: [{ id: 'r1', name: 'Worker' }], people: [] }), window);
  return { ...b, sent };
}

test('the board does not re-ask someone whose request it cannot open yet, and says "opening" (finding 6)', async () => {
  const b = board([{ id: 'req1', memberPub: ME, _locked: true }]);
  assert.equal(b.slotVerdict('svc1', 'kids', 'r1', ME), 'locked', 'a slot behind a locked request reads as "not asked"');
  const r = await b.sendRequestsFor('svc1', '2099-10-04', '10:30', 'Morning', { 'kids::r1': { name: 'Me', pub: ME } });
  assert.equal(b.sent.length, 0, 'Publish sent a second request to someone who may already have one');
  assert.deepEqual(r, { tried: 1, failed: 1 }, 'the unsent ask is not counted, so the flash would claim everyone was asked');
  // CONTROL: nobody locked -> asked as before
  const b2 = board([]);
  await b2.sendRequestsFor('svc1', '2099-10-04', '10:30', 'Morning', { 'kids::r1': { name: 'Me', pub: ME } });
  assert.equal(b2.sent.length, 1, 'CONTROL: an ordinary Publish asks the person');
  assert.equal(b2.slotVerdict('svc1', 'kids', 'r1', ME), '', 'CONTROL: not asked reads as not asked');
});
