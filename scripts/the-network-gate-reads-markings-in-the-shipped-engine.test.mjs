// THE NETWORK CHILD GATE AND THE NETWORK PROFILE, IN THE SHIPPED MEMBER ENGINE (Networks member step 1, audit of 590fa968).
//   Run: node --test scripts/the-network-gate-reads-markings-in-the-shipped-engine.test.mjs
//
// The REAL code, lifted out of vendor/fellowship.js and run with only its surroundings supplied (rule 3: no text assertion):
//   1. _minorStanding / Fellowship.minorStanding answer by THIS MEMBER's marking -- their own clearance record (owner 2026-10-21: an
//      unmarked member is an adult and is served), never by the church's cleared-adults list or the feed's assume-a-child policy, and a
//      lookup that cannot be made -- or throws -- is 'unknown', never an answer.
//   2. subscribeNetworkProfile drops any kind-0 whose author is not the network key, even if a relay hands one over, and keeps the newest.
// How App uses both is proved in a-network-reaches-members-only-through-whats-happening.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const FELLOW = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
function topFn(name) {
  const m = new RegExp('\\n  (async )?function ' + name + '\\([\\s\\S]*?\\n  \\}\\n').exec(FELLOW);
  assert.ok(m, `could not lift ${name} from vendor/fellowship.js -- re-anchor this test, do not delete it`);
  return m[0];
}
function grabMethod(sig) {
  const at = FELLOW.indexOf(sig);
  assert.notEqual(at, -1, sig + ' is gone from vendor/fellowship.js -- re-anchor this test');
  assert.equal(FELLOW.indexOf(sig, at + 1), -1, 're-anchor: ' + sig + ' appears twice');
  let depth = 0, q = '';
  for (let i = FELLOW.indexOf('{', at); i < FELLOW.length; i++) {
    const c = FELLOW[i], prev = FELLOW[i - 1];
    if (q) { if (c === q && prev !== '\\') q = ''; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '{') depth++; else if (c === '}' && --depth === 0) return FELLOW.slice(at, i + 1);
  }
  assert.fail('could not find the end of ' + sig);
}

const CP = 'aa'.repeat(32), ME = 'ee'.repeat(32), KEY = 'trinityone.sg-assume.';
// clearance: what _fetchMyClearance answers -- { found:true, minor } | { found:false } | null | 'throw'.
// audience: what the church's cleared-adults lookup would answer. It says nothing about THIS member and must never decide (audit of 131b7e4f).
function standing({ mine = null, stored = null, clearance = { found: false }, audience = [], me = ME } = {}) {
  const store = new Map(); if (stored != null) store.set(KEY + CP + '|' + ME, stored);
  const localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null) };
  const fn = new Function('_mePub', '_sgMine', 'SG_ASSUME_KEY', 'localStorage', '_fetchMyClearance', '_fetchChildCareAudience',
    topFn('_minorStanding') + '\nreturn _minorStanding;')(() => me, () => mine, KEY, localStorage,
    async () => { if (clearance === 'throw') throw new Error('relay down'); return clearance; }, async () => audience);
  const method = new Function('toPub', '_minorStanding', 'return {' + grabMethod('    async minorStanding(churchNpub) {') + '};')((x) => x, fn);
  return { fn, method };
}

test('MARKED / UNMARKED by the member\'s own sealed clearance, when the subscription has delivered it', async () => {
  assert.equal(await standing({ mine: { known: true, isMinor: true } }).fn(CP), 'marked');
  assert.equal(await standing({ mine: { known: true, isMinor: false } }).fn(CP), 'unmarked');
});
test('a remembered answer for (church, me) is used before fetching', async () => {
  assert.equal(await standing({ stored: '1', clearance: null }).fn(CP), 'marked');
  assert.equal(await standing({ stored: '0', clearance: null }).fn(CP), 'unmarked');
});
test('BEFORE THE SUBSCRIPTION DELIVERS: a MARKED child whose clearance record is on the relay is "marked" -- even in a church whose cleared list answers', async () => {
  // the case audited wrong in 131b7e4f: the church's cleared-adults list answered (here, non-empty and empty) and was read as "unmarked"
  assert.equal(await standing({ clearance: { found: true, minor: true }, audience: ['cc'.repeat(32)] }).fn(CP), 'marked');
  assert.equal(await standing({ clearance: { found: true, minor: true }, audience: [] }).fn(CP), 'marked');
});
test('FETCHED clearance: found adult -> unmarked; found:false (no marking published) -> unmarked, even in an assume-a-child church', async () => {
  assert.equal(await standing({ clearance: { found: true, minor: false } }).fn(CP), 'unmarked');
  assert.equal(await standing({ clearance: { found: false }, audience: ['cc'.repeat(32)] }).fn(CP), 'unmarked');
});
test('COULD NOT ESTABLISH (null), no key yet, or a THROW -> unknown, never an answer -- even when the cleared list would answer', async () => {
  assert.equal(await standing({ clearance: null, audience: [] }).fn(CP), 'unknown');
  assert.equal(await standing({ me: '' }).fn(CP), 'unknown');
  assert.equal(await standing({ clearance: 'throw' }).method.minorStanding(CP), 'unknown', 'a failed lookup was turned into an answer');
  assert.equal(await standing({}).method.minorStanding(''), 'unknown');
});

test('subscribeNetworkProfile drops a kind-0 from any other author, and an older one after a newer', () => {
  const NP = 'ab'.repeat(32), OTHER = 'cd'.repeat(32);
  let handlers = null, filters = null;
  const pool = { subscribeMany: (_r, f, h) => { filters = f; handlers = h; return { close() {} }; } };
  const api = new Function('toPub', 'groupReadRelays', '_netRelays', 'pool', 'window',
    'return {' + grabMethod('    subscribeNetworkProfile(networkNpub, cb) {') + '};')((x) => x, () => ['wss://a'], () => ['wss://b'], pool, { Fellowship: { relays: [] } });
  const got = [];
  api.subscribeNetworkProfile(NP, (e) => got.push(e));
  assert.deepEqual(filters, [{ kinds: [0], authors: [NP] }]);
  handlers.onevent({ kind: 0, pubkey: OTHER, created_at: 50, content: '{"short_name":"FAKE"}' });
  assert.equal(got.length, 0, 'a kind-0 from another key was handed to the app');
  handlers.onevent({ kind: 0, pubkey: NP, created_at: 40, content: '{"short_name":"REAL"}' });
  handlers.onevent({ kind: 0, pubkey: NP, created_at: 30, content: '{"short_name":"OLD"}' });
  assert.deepEqual(got.map(e => JSON.parse(e.content).short_name), ['REAL'], 'CONTROL failed or an older profile replaced a newer one');
});
