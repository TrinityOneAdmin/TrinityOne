// BLOCK MUST NOT REWRITE A ROTA FROM A COPY THAT HAS GONE STALE.
// Run: node --test scripts/a-block-does-not-rewrite-a-rota-someone-changed.test.mjs
//
// THE DEFECT. Block (DashMembers.block -> takeOffEveryTeam) clears the blocked person's slots on every future rota by
// republishing the WHOLE document from the copy the console read earlier. The relay keeps only the newest copy, so
// if another steward (or this steward's other screen) saved that rota in between, Block erased their change. A
// rota this console could not open (_locked) was already refused; an unlocked, merely stale one was not.
//
// THE FIX. takeOffEveryTeam asks Steward.rotaChangedSince(service, ts) at write time (ts = the copy it read). A rota
// that has moved on is skipped and named. ONE attempt, NO retry: publishRota stamps the rota (_monotonic) before it
// writes, so a retry's own freshness check would read our failed attempt as "someone else changed it" and every
// later Block press would be silently skipped. A failed write is reported as a failed save, never blamed on a
// co-steward, and the next Block press still tries to write.
//
// HOW THIS ASSERTS (CLAUDE.md rules 1, 3). The REAL DashMembers is rendered and its REAL Block pressed. The engine is
// the SHIPPED bundle (vendor/steward.js) with its real _subAddr/subscribeRotas/publishRota/rotaChangedSince and the
// real event-store as the relay; "another steward saved" is a relay event delivered through the real subscription
// handler. Nothing here matches text in app/*.jsx.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { v2 as nip44 } from 'nostr-tools/nip44';
import { openStore } from './event-store.mjs';
import { fnBody, stmt } from './test-slice.mjs';
import { compiled, membersGlobals, press, reads, SCH } from './dash-render-kit.mjs';

const STEWARD = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const churchSk = generateSecretKey(), CP = getPublicKey(churchSk);
const NAMEKEY = generateSecretKey(), hex = (b) => Buffer.from(b).toString('hex');
const NET = 'trinityone', ROTA_D = 'trinityone/rota:';
const T = Math.floor(Date.now() / 1000) - 10_000;
const BRAM = 'd'.repeat(64), CLEO = 'e'.repeat(64), NEWP = 'f'.repeat(64);
const SLOT_B = { id: 'p1', name: 'Bram Whitlock', pub: BRAM }, SLOT_C = { id: 'p2', name: 'Cleo Ashby', pub: CLEO };

function once(src, anchor) {
  const at = src.indexOf(anchor);
  assert.notEqual(at, -1, `${anchor} is missing from vendor/steward.js - re-anchor this test (esbuild renames)`);
  assert.equal(src.indexOf(anchor, at + 1), -1, `${anchor} appears twice`);
  return at;
}
const fn = (anchor) => fnBody(STEWARD, once(STEWARD, anchor), anchor);
const st = (anchor) => { once(STEWARD, anchor); return stmt(STEWARD, anchor); };

// the rota document as a relay event (cleartext opens too: _openChurchDoc tries plain JSON first)
const rotaEvent = (svc, at, assign) => finalizeEvent({ kind: 30078, created_at: at, tags: [['d', ROTA_D + svc], ['t', NET]],
  content: JSON.stringify({ service: svc, published: true, assign }) }, churchSk);

function engine(clock) {
  const gate = { refuse: false };   // true: the relay refuses every write (nothing lands, no echo comes back)
  const subs = [], sent = [], store = openStore(':memory:');
  const world = {
    pub: CP, sk: churchSk, NET, actingChurch: '', ROTA_D, ROSTER_D: 'trinityone/roster:',
    _nameKeyRing: [hex(NAMEKEY)], encrypt2: nip44.encrypt, decrypt3: nip44.decrypt, _unhex: (h) => new Uint8Array(Buffer.from(h, 'hex')), NAME_KEY_WAIT_MS: 0,
    _localBlocked: new Set(), _consoleDisplay: () => true, _consoleChurchVoice: () => true,
    localStorage: { getItem: () => null, setItem() {} },
    relays: () => ['wss://r'],
    pool: { subscribeMany: (_r, _f, h) => { subs.push(h); return { close() {} }; } },
    now: () => clock.s, Date: { now: () => clock.s * 1000 },
    _skewShift: () => 0, STAMP_CAP_SEC: 600, SKEW_CAP_SEC: 900, finalizeEvent,
    publish: async (evt, opts) => {
      sent.push(evt);
      if (gate.refuse) { if (opts) { opts.reason = 'invalid: a newer version of this is already stored'; opts.refused = true; } return false; }
      const r = store.put(evt);
      if (r === 'stored' || r === 'duplicate') return evt;
      if (opts) { opts.reason = 'invalid: a newer version of this is already stored'; opts.refused = true; }
      return false;
    },
  };
  const names = Object.keys(world);
  const body = `
    ${fn('function _pickWinner(vers, trusted)')}
    ${fn('function _reduceVersions(vers, byId, id, trusted)')}
    ${fn('function _seedFromCache(versions, byId, items, trusted)')}
    ${fn('function _absorbById(versions, byId, id, rec, trusted)')}
    ${fn('function _tombstoneTargets(e)')}
    ${fn('function _forgetById(versions, byId, id, by, ts, trusted, opts)')}
    ${st('var _lastStamp = ')}
    ${st('var _seenStamp = ')}
    ${st('var _lockedAddr = ')}
    ${fn('function _addrLocked(d)')}
    ${st('var _lastSaveFail = ')}
    ${fn('function _saveFailed(why)')}
    ${fn('function _noteSeenStamp(d, ts)')}
    ${fn('function _monotonic(tmpl)')}
    ${st('var _nameKeyListeners = ')}
    ${fn('function _onNameKeyRing(fn)')}
    ${fn('function _nameKeyRingChanged()')}
    ${fn('function _sealChurchDoc(obj)')}
    ${fn('function _sealChurchDocReady(obj)')}
    ${fn('function _openChurchDoc(content)')}
    function feChurch(t) { return finalizeEvent(_monotonic(t), sk); }
    const S = { ${fn('_subAddr(prefix, map, onItems, lockedShape)')},
                ${fn('subscribeRotas(onRotas)')}, ${fn('async publishRota(rota)')},
                ${fn('rotaChangedSince(serviceId, ts)')}, ${fn('lastSaveFailure()')} };
    return { S };`;
  return { ...new Function(...names, body)(...names.map(n => world[n])), subs, sent, store, gate };
}

const members = [{ pubkey: BRAM, npub: 'npub1aa', name: 'Bram Whitlock', count: 2, lastTs: T, joined: T - 86400 }];
const services = [{ id: 'svcF', date: '2999-01-05', time: '10:30', name: 'Sunday' }];

// Block pressed on the real members screen, over the real engine. `rotas` is what the screen holds (read earlier).
async function block({ eng, rotas, publishRota }) {
  const steward = { actingChurch: '', setBlocked: () => Promise.resolve(true), rotateCareKey: () => Promise.resolve(true), rotateMediaKey: () => Promise.resolve(true),
    ensureNameKeyForMembers: () => Promise.resolve({ rotated: true }), publishGroupKey: () => Promise.resolve({}), publishGroup: () => Promise.resolve(true),
    publishRoster: (team) => Promise.resolve({ id: team }),
    publishRota: publishRota || eng.S.publishRota,
    rotaChangedSince: eng.S.rotaChangedSince, lastSaveFailure: eng.S.lastSaveFailure };
  const g = membersGlobals({ steward, members, extraWindow: { useStewardRosters: () => [], useStewardRotas: () => rotas, useStewardServices: () => services,
    useMealsSettings: () => ({ adminGroupId: '' }), StewardMeals: { publishCareTeam: () => Promise.resolve(true) }, todayISO: () => '2026-10-02' } });
  const { C, draw } = await compiled('DashMembers', g, ['rotateChurchKeys', 'takeOffEveryTeam', { src: SCH, name: 'publishCareTeamFor' }]);
  let tree = draw(C, {});
  await press(tree, /Remove \/ block this member/, { which: 0 });
  tree = draw(C, {});
  await press(tree, /Confirm — bans them/);
  await new Promise(r => setTimeout(r, 100));
  return reads(draw(C, {}));
}
// the console holds the rota as the subscription handed it over (ts = the relay event's created_at)
function held(eng, at, assign) {
  let rotas = [];
  eng.S.subscribeRotas((r) => { rotas = r; });
  const e = rotaEvent('svcF', at, assign);
  eng.store.put(e); eng.subs[0].onevent(e);
  return () => rotas;
}
const theirs = (eng) => {
  const e = rotaEvent('svcF', T + 5, { 'w::r1': SLOT_B, 'w::r2': SLOT_C, 'w::r3': { id: 'p9', name: 'New Person', pub: NEWP } });
  eng.store.put(e); eng.subs[0].onevent(e);
};
const lastRota = (eng) => JSON.parse(nip44.decrypt(JSON.parse(eng.sent.at(-1).content).e, NAMEKEY)).assign;

test('CONTROL: nobody else touched the rota - Block clears only their slot and the write lands', async () => {
  const eng = engine({ s: T + 10 });
  const rotas = held(eng, T, { 'w::r1': SLOT_B, 'w::r2': SLOT_C });
  const said = await block({ eng, rotas: rotas() });
  assert.equal(eng.sent.length, 1, 'the control did not write - the fixture proves nothing');
  assert.deepEqual(Object.keys(lastRota(eng)), ['w::r2']);
  assert.doesNotMatch(said, /could not take them off/);
});

test('THE DEFECT: another steward saved the rota after this console read it - Block writes NOTHING over it and says so', async () => {
  const eng = engine({ s: T + 10 });
  const stale = held(eng, T, { 'w::r1': SLOT_B, 'w::r2': SLOT_C })();   // what the Members screen is holding
  theirs(eng);                                                           // their copy reaches the engine, not the screen's snapshot
  const said = await block({ eng, rotas: stale });
  assert.equal(eng.sent.length, 0, 'Block overwrote the other steward\'s newer rota from its stale copy');
  assert.match(said, /could not take them off a future rota someone else changed/, 'the skip was silent: ' + said.slice(0, 300));
});

test('a FAILED write says the save failed and does NOT blame another steward (real engine, relay refuses)', async () => {
  const eng = engine({ s: T + 10 });
  const rotas = held(eng, T, { 'w::r1': SLOT_B, 'w::r2': SLOT_C });
  eng.gate.refuse = true;
  const said = await block({ eng, rotas: rotas() });
  assert.equal(eng.sent.length, 1, 'exactly one attempt, no retry: ' + eng.sent.length);
  assert.match(said, /could not take them off a future rota \(the save failed/, 'a refused write was swallowed: ' + said.slice(0, 300));
  assert.doesNotMatch(said, /someone else changed/, 'blamed a co-steward for our own failed save: ' + said.slice(0, 300));
});

test('REGRESSION: a second Block press after a failed first one STILL attempts the write (real engine)', async () => {
  const eng = engine({ s: T + 10 });
  const rotas = held(eng, T, { 'w::r1': SLOT_B, 'w::r2': SLOT_C });
  eng.gate.refuse = true;
  await block({ eng, rotas: rotas() });                 // press 1: the relay refuses; nothing lands, no echo reaches the screen
  assert.equal(eng.sent.length, 1);
  eng.gate.refuse = false;
  const said = await block({ eng, rotas: rotas() });    // press 2: the screen still holds the same copy
  assert.equal(eng.sent.length, 2, 'the second press was silently skipped - the blocked person stays on the rota');
  assert.deepEqual(Object.keys(lastRota(eng)), ['w::r2']);
  assert.doesNotMatch(said, /could not take them off/);
});

test('the guard still fires after a failed first press when another steward\'s copy is DELIVERED', async () => {
  const eng = engine({ s: T + 10 });
  const stale = held(eng, T, { 'w::r1': SLOT_B, 'w::r2': SLOT_C })();
  eng.gate.refuse = true;
  await block({ eng, rotas: stale });                   // press 1 fails: our own stamp is minted, nothing lands
  assert.equal(eng.sent.length, 1);
  eng.gate.refuse = false;
  theirs(eng);                                          // now a relay really delivers someone else's newer copy
  const said = await block({ eng, rotas: stale });
  assert.equal(eng.sent.length, 1, 'Block overwrote a delivered newer rota');
  assert.match(said, /could not take them off a future rota someone else changed/);
});
