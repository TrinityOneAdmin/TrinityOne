// THE CONSOLE SHOWS "Checking…", NOT A CONFIDENT WRONG COUNT, WHILE IT IS LOGGED OUT.
//   Run: node --test scripts/the-console-shows-checking-not-a-wrong-count-while-logged-out.test.mjs
//
// THE BUG (proven on two live churches, 2026-11-10). A steward console that is connected to its relays but has
// NOT finished logging in (NIP-42 incomplete, or the key is locked) is served EMPTY private lists — the relay
// withholds them from an unauthenticated reader. The old "loaded?" signal (window.stewardStreamLoaded) flipped
// true on that empty delivery, so the Members tile read "—" and the Overview said "N people are waiting to join"
// with N = the whole church. Plausible, and wrong: the data was fine; the console just wasn't logged in.
//
// THE FIX. useRealMemberCount (and the join-queue / banner) now gate on window.rosterReadyFrom, which is true
// only once BOTH the admitted and blocked lists have settled on a GENUINE authenticated read (Steward.listIsFresh),
// and which refuses a relay-down (floored) EMPTY read that would collapse a roster the on-disk seed says is
// non-empty (decision 2b-A: corroborate). When not ready, useRealMemberCount returns null — the tile shows
// "Checking…", a state distinct from a genuine 0.
//
// POINT OF USE, not the engine (CLAUDE.md rule 1). The REAL useRealMemberCount is sliced out of
// app/stew-dashboard.jsx and the REAL window.rosterReadyFrom out of app/steward-root.jsx by brace-match
// (scripts/test-slice.mjs), compiled with the packaged esbuild, and run in one scope — so the gate the screen
// actually consults is the one under test. Nothing here matches text in the .jsx (app/*.jsx ships UNBUNDLED,
// CLAUDE.md rule 3): the function is CALLED and its return asserted. listIsFresh/listComplete/admittedSeed are
// injected to simulate logged-out vs logged-in vs a relay-down read.
//
// MEASURED RED/GREEN, 2026-11-10 (sabotage scoped to useRealMemberCount, restored byte-for-byte after):
//   · shipped                                          5 pass / 0 fail
//   · `if (!ready) return null;` -> `if (false) …`     3 pass / 2 fail  (logged-out + floored-collapse reden)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fnBody } from './test-slice.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const DASH = readFileSync(join(ROOT, 'app/stew-dashboard.jsx'), 'utf8');
const RT = readFileSync(join(ROOT, 'app/steward-root.jsx'), 'utf8');

async function loadGate(globals) {
  const src = [
    fnBody(DASH, 'function useRealMemberCount(opts) {', 'useRealMemberCount'),
    fnBody(RT, 'window.rosterReadyFrom = function (admittedList, blockedList) {', 'rosterReadyFrom'),
  ].join('\n');
  const tmp = join(tmpdir(), 'rostergate-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, src + '\nexport { useRealMemberCount };\n');
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const key = '__rostergate_' + Math.random().toString(36).slice(2);
  globalThis[key] = globals;
  const preamble = Object.keys(globals).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  return await import('data:text/javascript;base64,' + Buffer.from(preamble + '\n' + js).toString('base64'));
}

const M = (n) => Array.from({ length: n }, (_, i) => ({ pubkey: 'pk' + i }));

// Build a window whose hooks + Steward reflect one connection state, call the REAL useRealMemberCount.
async function count({ win: shared, steward = {}, hold = false, fresh, complete = true, admitted = [], blocked = [], members = M(5), joinApproval = true, seed = [] }) {
  const win = shared || {};
  Object.assign(win, {
    Steward: {
      pubkey: 'me1', churchPub: 'churchA', ...steward,
      listIsFresh: () => fresh,
      listComplete: () => complete,
      admittedSeed: () => seed,
    },
    useStewardMembers: () => members,
    useStewardAdmitted: () => admitted,
    useStewardBlocked: () => blocked,
    useStewardJoinPolicy: () => joinApproval,
    useStewardIdv: () => 0,
  });
  const mod = await loadGate({ window: win });
  return mod.useRealMemberCount(hold ? { holdLast: true } : undefined);
}

// The tile mapping the StatCard uses: null -> "Checking…", 0 -> "—", n -> the number.
const tile = (c) => (c == null ? 'Checking…' : c ? String(c) : '—');

test('LOGGED OUT: the member count is null (tile shows "Checking…"), never a wrong number', async () => {
  const c = await count({ fresh: false, admitted: [], blocked: [] });   // relay withheld the lists -> empty
  assert.equal(c, null, 'a logged-out console must not report a count — it has not read the roster');
  assert.equal(tile(c), 'Checking…', 'the Members tile must read "Checking…", not "—" and not a number');
});

test('LOGGED IN, complete read: the real active count is shown', async () => {
  // 5 members, 3 admitted, approval on -> 2 are still pending -> active = 3
  const c = await count({ fresh: true, complete: true, admitted: ['pk0', 'pk1', 'pk2'] });
  assert.equal(c, 3);
  assert.equal(tile(c), '3');
});

test('RELAY DOWN (floored) with an EMPTY admitted read that collapses a known roster: "Checking…", not 0', async () => {
  // the data relay is down; another relay answered empty. The seed says the roster is NOT empty -> do not believe it.
  const c = await count({ fresh: true, complete: false, admitted: [], seed: ['pk0', 'pk1', 'pk2'] });
  assert.equal(c, null, 'a floored empty read must not collapse a known-non-empty roster to 0');
  assert.equal(tile(c), 'Checking…');
});

test('RELAY DOWN (floored) but the read is NON-EMPTY: it is trusted (corroborated)', async () => {
  const c = await count({ fresh: true, complete: false, admitted: ['pk0', 'pk1'], seed: ['pk0', 'pk1', 'pk2'] });
  assert.equal(c, 2, 'a floored but non-empty read is corroborated and shown');
});

test('A GENUINELY EMPTY roster (no seed) reads as 0, not "Checking…"', async () => {
  // brand-new church: nobody admitted, approval on, seed empty -> everyone pending -> active 0 (tile "—"/invite)
  const c = await count({ fresh: true, complete: true, admitted: [], seed: [] });
  assert.equal(c, 0);
  assert.equal(tile(c), '—');
});

// HOLD-LAST (owner requirement 2026-11-11): the Overview tile keeps the last REAL count during a re-read.
// One shared window = one console session; the REAL hook is called with { holdLast: true } as the Overview does.
const ready30 = { fresh: true, complete: true, members: M(30), joinApproval: false, hold: true };
const notReady = { fresh: false, members: M(30), joinApproval: false, hold: true };

test('HOLD-LAST: null before the first real count, 30 once read, STILL 30 while a re-read is not fresh', async () => {
  const win = {};
  assert.equal(await count({ ...notReady, win }), null, 'first read: Checking…');
  assert.equal(await count({ ...ready30, win }), 30);
  assert.equal(await count({ ...notReady, win }), 30, 'a connection bump must not flip the tile back to Checking…');
  assert.equal(await count({ ...ready30, members: M(31), win }), 31, 'a new real count replaces the held one');
});

test('HOLD-LAST: without the opt-in (DashGroups) a not-ready read is still null', async () => {
  const win = {};
  await count({ ...ready30, hold: false, win });
  assert.equal(await count({ ...notReady, hold: false, win }), null);
});

test('HOLD-LAST: never carried to another church, another identity, or past a lock / key removal', async () => {
  const win = {};
  await count({ ...ready30, win });
  assert.equal(await count({ ...notReady, win, steward: { churchPub: 'churchB' } }), null, 'different church');
  await count({ ...ready30, win });
  assert.equal(await count({ ...notReady, win, steward: { pubkey: 'me2' } }), null, 'different identity (same church)');
  await count({ ...ready30, win });
  assert.equal(await count({ ...notReady, win, steward: { actingChurch: 'churchX' } }), null, 'delegated steward acting for another church');
  await count({ ...ready30, win });
  assert.equal(await count({ ...notReady, win, steward: { pubkey: null } }), null, 'locked / key removed');
  assert.equal(await count({ ...notReady, win }), null, 'and the old number is gone when the key returns');
});
