// THE SAFEGUARDING READS (subscribeSafeguard, subscribeGuardians, subscribeBlocked's live subscription) ASK ONLY FOR
// THEIR OWN CHURCH'S DOCUMENTS.   Run: node --test scripts/the-safeguarding-reads-ask-only-for-their-own-documents.test.mjs
//
// Each used to ask `authors:[A] '#t'` and `'#church':[A] '#t'` with no d-tag: the church's WHOLE kind-30078 corpus,
// once per read, to keep four, one and one documents. They now add '#d' to BOTH filters, naming exactly the d-tags
// their handler acts on (read from the handlers): subscribeSafeguard minors/approved/nophoto/guardians:<A>,
// subscribeGuardians guardians:<A>, subscribeBlocked blocked:<A>. authors / #church / #t are unchanged.
//
// POINT OF USE (rule 1): real gateway, real console, church A; the REAL bundled functions are called as A against a
// relay that holds A's real-shaped documents PLUS 20 unrelated documents of A's own, church B's same-named
// documents (minors:B …) and 50 more of B's. (a) the REQ's '#d' on both filters, (b) the EVENT frames the relay
// sent on that subscription are only the wanted documents, (c) what the handler emitted. (a)+(b) go red when the
// narrowing is removed (see the commit message); (c) passes either way and only guards that nothing was lost.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openRig, otherChurchPile, ownNoise, doc, CHROME, probe, narrowed, H } from './narrow-reads-rig.mjs';

const D = { minors: 'trinityone/minors:', approved: 'trinityone/approved:', nophoto: 'trinityone/nophoto:', guardians: 'trinityone/guardians:', blocked: 'trinityone/blocked:' };
let A = null; const C1 = H.key(), C2 = H.key(), NP = H.key(), P1 = H.key(), K = H.key();
const T = { skip: !CHROME, timeout: 240000 };
const broad = (filters) => filters.some(f => f['#t']);   // the live subscription, not the narrow fresh-read beside it

before(async () => {
  if (!CHROME) return;
  A = await openRig('safeguard');
  const mine = (fam, content) => doc(A.church, D[fam] + A.church.pub, content);
  const theirs = (fam, content) => doc(A.other, D[fam] + A.other.pub, content, [['church', A.other.pub]]);
  await A.put([
    mine('minors', { pubkeys: [C1.pub] }), mine('approved', { pubkeys: [C2.pub], cleared: {}, expiry: {} }), mine('nophoto', { pubkeys: [NP.pub] }),
    mine('guardians', { links: { [C1.pub]: [P1.pub] }, closed: {} }), mine('blocked', { pubkeys: [K.pub] }),
    theirs('minors', { pubkeys: [H.key().pub] }), theirs('approved', { pubkeys: [H.key().pub] }), theirs('guardians', { links: {} }), theirs('blocked', { pubkeys: [H.key().pub] }),
    ...ownNoise(A, 20), ...otherChurchPile(A, 50),
  ]);
});
after(() => { try { A && A.close(); } catch {} });

const ds = (...fams) => fams.map(f => D[f] + (A ? A.church.pub : ''));
const only = (r, want) => { for (const e of r.events) assert.ok(want.includes(e.d), 'the relay sent a document the read does not want: ' + e.d); assert.ok(r.events.length <= want.length, 'the relay sent ' + r.events.length + ' events for ' + want.length + ' wanted documents'); };

const EXPR = {
  safeguard: `window.Steward.subscribeSafeguard(l => window.__probe.out.push({ minors: l.minors, approved: l.approved, nophoto: l.nophoto, guardians: l.guardians }))`,
  guardians: `window.Steward.subscribeGuardians(l => window.__probe.out.push(l))`,
  blocked: `window.Steward.subscribeBlocked(l => window.__probe.out.push([...l]))`,
};
const cache = {};
const get = (k) => (cache[k] ||= probe(A, EXPR[k], { pick: broad }));
const WANT = { safeguard: () => ds('minors', 'approved', 'nophoto', 'guardians'), guardians: () => ds('guardians'), blocked: () => ds('blocked') };

for (const k of ['safeguard', 'guardians', 'blocked']) {
  test(`(a) ${k}: both filters carry #d with exactly the wanted documents, and keep authors / #church`, T, async () => { narrowed(assert, await get(k), A, WANT[k]()); });
  test(`(b) ${k}: the relay sends only the wanted documents (bounded EVENT count)`, T, async () => { only(await get(k), WANT[k]()); });
}
test('(c) the emitted lists are unchanged (passes with the old filters too: guards only that nothing was lost)', T, async () => {
  const sg = (await get('safeguard')).out.pop();
  assert.deepEqual([sg.minors, sg.approved, sg.nophoto], [[C1.pub], [C2.pub], [NP.pub]]);
  assert.deepEqual(sg.guardians, { [C1.pub]: [P1.pub] });
  assert.deepEqual((await get('guardians')).out.pop(), { links: { [C1.pub]: [P1.pub] }, closed: {} });
  assert.deepEqual((await get('blocked')).out.pop(), [K.pub]);
});
