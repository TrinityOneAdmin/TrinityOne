// THE ROSTER READS (subscribeAdmitted, subscribeReseats, subscribeStewards, subscribeJoinPolicy) ASK ONLY FOR THEIR
// OWN CHURCH'S DOCUMENT.   Run: node --test scripts/the-roster-reads-ask-only-for-their-own-documents.test.mjs
//
// Each read authors:[A] / '#church':[A] with '#t' and no d-tag - the whole kind-30078 corpus to keep one document.
// Both filters of each now also carry '#d' naming the one d-tag its handler acts on (exact equality in every handler):
// admitted:<A>, reseat:<A>, stewards:<A>, joinpolicy:<A>. authors / '#church' / '#t' are unchanged.
//
// POINT OF USE (rule 1): real gateway, real console, church A; the REAL bundled functions are called as A against a
// relay holding A's real-shaped documents PLUS 20 unrelated documents of A, church B's same-named documents and 50
// more of B's. (a) the REQ on the wire, (b) the EVENT frames the relay sent on that subscription, (c) what the handler
// emitted. (a)+(b) are the regression guard; (c) passes with the old filters too and only guards that nothing was lost.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openRig, otherChurchPile, ownNoise, doc, CHROME, probe, narrowed, H } from './narrow-reads-rig.mjs';

const D = { admitted: 'trinityone/admitted:', reseat: 'trinityone/reseat:', stewards: 'trinityone/stewards:', joinpolicy: 'trinityone/joinpolicy:' };
let A = null; const M1 = H.key(), OLD = H.key(), NEW = H.key(), S1 = H.key();
const T = { skip: !CHROME, timeout: 240000 };
const broad = (filters) => filters.some(f => f['#t']);   // the live subscription, not the narrow fresh-read beside it

before(async () => {
  if (!CHROME) return;
  A = await openRig('roster');
  const mine = (fam, content) => doc(A.church, D[fam] + A.church.pub, content);
  const theirs = (fam, content) => doc(A.other, D[fam] + A.other.pub, content, [['church', A.other.pub]]);
  await A.put([
    mine('admitted', { pubkeys: [M1.pub] }), mine('reseat', { pairs: [{ old: OLD.pub, new: NEW.pub, at: 1700000000 }] }),
    mine('stewards', { pubkeys: [S1.pub] }), mine('joinpolicy', { approval: true }),
    theirs('admitted', { pubkeys: [H.key().pub] }), theirs('reseat', { pairs: [] }), theirs('stewards', { pubkeys: [H.key().pub] }), theirs('joinpolicy', { approval: false }),
    ...ownNoise(A, 20), ...otherChurchPile(A, 50),
  ]);
});
after(() => { try { A && A.close(); } catch {} });

const ds = (...fams) => fams.map(f => D[f] + (A ? A.church.pub : ''));
const only = (r, want) => { for (const e of r.events) assert.ok(want.includes(e.d), 'the relay sent a document the read does not want: ' + e.d); assert.ok(r.events.length <= want.length, 'the relay sent ' + r.events.length + ' events for ' + want.length + ' wanted documents'); };
const EXPR = {
  admitted: `window.Steward.subscribeAdmitted(l => window.__probe.out.push([...l]))`,
  reseat: `window.Steward.subscribeReseats(l => window.__probe.out.push(l))`,
  stewards: `window.Steward.subscribeStewards(l => window.__probe.out.push([...l]))`,
  joinpolicy: `window.Steward.subscribeJoinPolicy(v => window.__probe.out.push(v))`,
};
const cache = {};
const get = (k) => (cache[k] ||= probe(A, EXPR[k], { pick: broad }));

for (const k of Object.keys(EXPR)) {
  test(`(a) ${k}: both filters carry #d with exactly the wanted document, and keep authors / #church`, T, async () => { narrowed(assert, await get(k), A, ds(k)); });
  test(`(b) ${k}: the relay sends only the wanted document (bounded EVENT count)`, T, async () => { only(await get(k), ds(k)); });
}
test('(c) the emitted results are unchanged (pass with the old filters too: guard only that nothing was lost)', T, async () => {
  assert.deepEqual((await get('admitted')).out.pop(), [M1.pub]);
  assert.deepEqual((await get('reseat')).out.pop(), [{ old: OLD.pub, new: NEW.pub, at: 1700000000 }]);
  assert.deepEqual((await get('stewards')).out.pop(), [S1.pub]);
  assert.equal((await get('joinpolicy')).out.pop(), true);
});
