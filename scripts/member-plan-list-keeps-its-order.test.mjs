// THE MEMBER APP'S PLAN LIST KEEPS THE CONSOLE'S ORDER WHEN A PLAN IS RE-SAVED.
//   Run: node --test scripts/member-plan-list-keeps-its-order.test.mjs
// Companion to plan-list-keeps-its-order.test.mjs: subscribeChurchPlans sorted by ts, which every re-save re-stamps.
// Lifts the REAL subscribeChurchPlans from the built vendor/fellowship.js and feeds it events. CLAUDE.md rules 1, 3.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';

const BUNDLE = process.env.MEMBER_ORDER_BUNDLE_OVERRIDE ? readFileSync(process.env.MEMBER_ORDER_BUNDLE_OVERRIDE, 'utf8') : readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
const CH = 'c'.repeat(64);

function member() {
  const names = ['_pickWinner', '_reduceVersions', '_seedFromCache', '_absorbById', '_forgetById', 'scheduleVisible'];
  const helpers = names.map(n => fnBody(BUNDLE, 'function ' + n + '(', n)).join('\n');
  const method = fnBody(BUNDLE, '\n    subscribeChurchPlans(', 'subscribeChurchPlans').trim();
  let handler;
  const env = {
    toPub: () => CH, loadDocCache: () => [], saveDocCache() {}, scheduleNextReveal: () => null,
    _churchVoice: () => true, _tombstoneTargets: () => [],
    _onChurchDocs: (_cp, h) => { handler = h; return () => {}; },
  };
  const keys = Object.keys(env);
  const api = new Function(...keys, helpers + '\nconst o = { ' + method + ' };\nreturn o;')(...keys.map(k => env[k]));
  let list = [];
  api.subscribeChurchPlans('npub', (l) => { list = l; });
  const put = (id, at, extra) => handler.onevent({ kind: 30078, created_at: at, pubkey: CH, tags: [['d', 'trinityone/plan:' + id]], content: JSON.stringify({ id, title: id, days: [{ d: 1, ref: 'John 1' }], ...extra }) }, 'trinityone/plan:' + id);
  return { put, ids: () => list.map(p => p.id).join(',') };
}

test('a re-saved plan (new ts, same created) keeps its place in the member list', () => {
  const m = member();
  m.put('a', 1100, { created: 1100 }); m.put('b', 1200, { created: 1200 }); m.put('c', 1300, { created: 1300 });
  assert.equal(m.ids(), 'a,b,c', 'setup');
  m.put('b', 1900, { created: 1200, public: false });   // the toggle re-save
  assert.equal(m.ids(), 'a,b,c', 'the member sees the re-saved plan jump to the end');
});

test('plans from before `created` existed still sort by ts', () => {
  const m = member();
  m.put('c', 1300, {}); m.put('a', 1100, {}); m.put('b', 1200, {});
  assert.equal(m.ids(), 'a,b,c');
});
