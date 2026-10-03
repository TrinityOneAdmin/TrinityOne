// MEMBERS' MESSAGE COUNTS MUST NOT CLIMB WITH NO NEW MESSAGES (sim item 27, SIM-VERIFY-2026-10-02).
//   Run: node --test scripts/message-counts-do-not-climb-on-replay.test.mjs
//
// THE DEFECT: subscribeMembers (the console's Members list) seeded each member's `count` from the cached roster
// and then did `count++` for EVERY kind-1 the relay served. A relay replays its whole history on every
// (re)subscribe — each page reload, each relay reconnect (the console re-opens this on `conn`), each church
// switch — so every member's number grew by their full message history each time, with nobody saying anything.
//
// THE FIX: count DISTINCT events by id this run, keep the cached tally only as a floor while the replay arrives,
// and show the larger of the two. A cache written before the fix may be inflated, so rows are stamped `cv: 2`
// when saved and an unstamped row's stored count is ignored.
//
// POINT OF USE (CLAUDE.md rules 1 and 3): subscribeMembers is LIFTED OUT OF vendor/steward.js (the bundle the
// console loads) and run — against a localStorage that persists between "page loads" and a relay stub that
// replays history the way a real one does. Nothing here matches text in an app/*.jsx file.
//
// USERS OF `count`: DashMembers in app/stew-dashboard.jsx (the "N messages · last …" line and the "chatting"
// tally) and the console's cached first paint in app/steward-root.jsx, which only reads the stored rows.
// subscribeMembers itself has two callers: app/steward-root.jsx (re-opened on idv/conn/church) and
// app/stew-dashboard.jsx.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody, liftKeyRead } from './test-slice.mjs';

const STEWARD = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const CHURCH = 'churchpub', MEMBER = 'member1', OTHER = 'member2';

// One persistent "device": the localStorage survives between page loads, which is the whole point.
function device() {
  const storage = {};
  const load = () => {
    let members = [];
    const handlers = [];
    const scope = {
      pool: { subscribeMany: (_u, _f, h) => { handlers.push(h); return { close() {} }; } },
      relays: () => ['wss://r'],
      pub: CHURCH, NET: 'trinityone',
      JSON, Math, Date, console, String, Number, Map, Set, Array, Infinity, setTimeout, clearTimeout,
      npubEncode: (x) => x,
      localStorage: { getItem: (k) => storage[k] || null, setItem: (k, v) => { storage[k] = v; } },
      window: { Steward: { openMemberName: () => '' } },
    };
    const body = fnBody(STEWARD, 'subscribeMembers(onMembers', 'subscribeMembers');
    const subscribe = new Function('scope', `with (scope) { ${liftKeyRead(STEWARD)}\n return ({ ${body} }).subscribeMembers; }`)(
      new Proxy(scope, {
        has: (t, k) => (k in t) || !(String(k) in globalThis),
        get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k]; if (String(k) in globalThis) return globalThis[String(k)]; return undefined; },
        set: (t, k, v) => { t[k] = v; return true; },
      }));
    const stop = subscribe((list) => { members = list.slice(); });
    assert.ok(handlers.length >= 1, 'subscribeMembers opened no subscription — nothing below is exercised');
    return {
      handlers, stop,
      // the relay serving one stored message to the roster subscription
      msg: (id, at, who = MEMBER) => handlers[0].onevent({ kind: 1, id, pubkey: who, created_at: at, tags: [['p', CHURCH]], content: 'hello' }),
      async count(who = MEMBER) { await sleep(200); const m = members.find(x => x.pubkey === who); return m ? m.count : undefined; },
      saved: () => JSON.parse(storage['trinityone.steward.members.' + CHURCH] || '[]'),
    };
  };
  return { load, storage };
}
const HISTORY = [['m1', 1000], ['m2', 2000], ['m3', 3000]];

test('A FIRST LOAD counts each message once', async () => {
  const d = device(); const run = d.load();
  for (const [id, at] of HISTORY) run.msg(id, at);
  assert.equal(await run.count(), 3, 're-anchor: three distinct messages did not count as three');
  run.stop();
});

test('THE SAME MESSAGE DELIVERED TWICE (two relays, or one relay twice) IS ONE MESSAGE', async () => {
  const d = device(); const run = d.load();
  for (const [id, at] of HISTORY) { run.msg(id, at); run.msg(id, at); }
  assert.equal(await run.count(), 3, 'a replayed message was counted again within the same run');
  run.stop();
});

test('THE DEFECT: reloading the page does not add the whole history on top of the cached count', async () => {
  const d = device();
  const first = d.load(); for (const [id, at] of HISTORY) first.msg(id, at);
  assert.equal(await first.count(), 3); first.stop();
  const second = d.load();                                   // a page reload: cache seeded, relay replays everything
  for (const [id, at] of HISTORY) second.msg(id, at);
  assert.equal(await second.count(), 3,
    'THE COUNT CLIMBED ON A RELOAD WITH NOBODY HAVING SAID ANYTHING — the cached number was counted again on top ' +
    'of the replay. This is the sim finding');
  second.stop();
});

test('…and so does every later reload and reconnect, however many', async () => {
  const d = device();
  let run = d.load(); for (const [id, at] of HISTORY) run.msg(id, at); await run.count(); run.stop();
  for (let i = 0; i < 5; i++) {
    run = d.load();
    for (const [id, at] of HISTORY) run.msg(id, at);
    assert.equal(await run.count(), 3, 'reload #' + (i + 2) + ' moved the count');
    run.stop();
  }
});

test('the cached number shows straight away, before the replay has arrived (no flash to zero)', async () => {
  const d = device();
  const first = d.load(); for (const [id, at] of HISTORY) first.msg(id, at); await first.count(); first.stop();
  const second = d.load();                                   // relay has not answered yet
  second.msg('m1', 1000);                                    // one message of the replay has landed so far
  assert.equal(await second.count(), 3, 'while the replay was still arriving the count dropped below the cached tally');
  second.stop();
});

test('ONE GENUINELY NEW MESSAGE lifts the count by exactly one — after a reload too', async () => {
  const d = device();
  const first = d.load(); for (const [id, at] of HISTORY) first.msg(id, at); await first.count(); first.stop();
  const second = d.load();
  for (const [id, at] of HISTORY) second.msg(id, at);
  second.msg('m4', 4000);
  assert.equal(await second.count(), 4, 'a new message did not count, or counted more than once');
  second.stop();
  const third = d.load();
  for (const [id, at] of [...HISTORY, ['m4', 4000]]) third.msg(id, at);
  assert.equal(await third.count(), 4, 'the next reload moved it again');
  third.stop();
});

test('members are counted separately', async () => {
  const d = device(); const run = d.load();
  run.msg('a1', 1000, MEMBER); run.msg('a2', 1100, MEMBER); run.msg('b1', 1200, OTHER);
  assert.equal(await run.count(MEMBER), 2); assert.equal(await run.count(OTHER), 1);
  run.stop();
});

test('A CACHE WRITTEN BEFORE THE FIX (already inflated, unstamped) CORRECTS ITSELF on the first load', async () => {
  const d = device();
  d.storage['trinityone.steward.members.' + CHURCH] = JSON.stringify([
    { pubkey: MEMBER, npub: MEMBER, name: 'Ada', picture: '', count: 99, lastTs: 3000, firstTs: 1000, joined: 900 }]);
  const run = d.load();
  for (const [id, at] of HISTORY) run.msg(id, at);
  assert.equal(await run.count(), 3, 'an inflated legacy cache kept its inflated number for ever');
  run.stop();
});

test('rows are STAMPED when saved, so the next load can trust their count', async () => {
  const d = device(); const run = d.load();
  for (const [id, at] of HISTORY) run.msg(id, at);
  await run.count();
  const row = run.saved().find(m => m.pubkey === MEMBER);
  assert.ok(row, 're-anchor: nothing was cached');
  assert.equal(row.cv, 2, 'the cached row carries no stamp, so the next load cannot tell it from an inflated legacy one and discards its count');
  assert.equal(row.count, 3);
  run.stop();
});
