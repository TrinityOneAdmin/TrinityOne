// THE NETWORK CHILD GATE AND THE NETWORK PROFILE, IN THE SHIPPED MEMBER ENGINE (Networks member step 1, audit of 590fa968).
//   Run: node --test scripts/the-network-gate-reads-markings-in-the-shipped-engine.test.mjs
//
// The REAL code, lifted out of vendor/fellowship.js and run with only its surroundings supplied (rule 3: no text assertion):
//   1. _minorStanding / Fellowship.minorStanding answer by the church's MARKING (owner 2026-10-21: an unmarked member is an adult and is
//      served), never by the feed's assume-a-child policy, and a lookup that cannot be made -- or throws -- is 'unknown', never an answer.
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
function standing({ mine = null, stored = null, audience = [], me = ME, audienceThrows = false } = {}) {
  const store = new Map(); if (stored != null) store.set(KEY + CP + '|' + ME, stored);
  const localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null) };
  const fn = new Function('_mePub', '_sgMine', 'SG_ASSUME_KEY', 'localStorage', '_fetchChildCareAudience',
    topFn('_minorStanding') + '\nreturn _minorStanding;')(() => me, () => mine, KEY, localStorage,
    async () => { if (audienceThrows) throw new Error('relay down'); return audience; });
  const method = new Function('toPub', '_minorStanding', 'return {' + grabMethod('    async minorStanding(churchNpub) {') + '};')((x) => x, fn);
  return { fn, method };
}

test('MARKED / UNMARKED by the member\'s own sealed clearance', async () => {
  assert.equal(await standing({ mine: { known: true, isMinor: true } }).fn(CP), 'marked');
  assert.equal(await standing({ mine: { known: true, isMinor: false } }).fn(CP), 'unmarked');
});
test('a remembered answer for (church, me) is used before asking the church', async () => {
  assert.equal(await standing({ stored: '1', audience: null }).fn(CP), 'marked');
  assert.equal(await standing({ stored: '0', audience: null }).fn(CP), 'unmarked');
});
test('ASSUME-A-CHILD CHURCH: safeguarding in use, this member not cleared and not marked -> UNMARKED (served), not "assume child"', async () => {
  assert.equal(await standing({ audience: ['cc'.repeat(32)] }).fn(CP), 'unmarked');
  assert.equal(await standing({ audience: [] }).fn(CP), 'unmarked');
});
test('COULD NOT ASK (null), no key yet, or a THROW -> unknown, never an answer', async () => {
  assert.equal(await standing({ audience: null }).fn(CP), 'unknown');
  assert.equal(await standing({ me: '' }).fn(CP), 'unknown');
  assert.equal(await standing({ audienceThrows: true }).method.minorStanding(CP), 'unknown', 'a failed lookup was turned into an answer');
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
