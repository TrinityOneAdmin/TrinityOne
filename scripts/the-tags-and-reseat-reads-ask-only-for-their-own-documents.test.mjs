// THE MESSAGE-TAGS READ (subscribeMessageTags) AND THE MEMBER LIST'S NAME/RE-SEAT READ (subscribeMembers' openReseat)
// ASK ONLY FOR THEIR OWN CHURCH'S DOCUMENTS.   Run: node --test scripts/the-tags-and-reseat-reads-ask-only-for-their-own-documents.test.mjs
//
// Each read authors:[A] / '#church':[A] with '#t' and no d-tag - the whole kind-30078 corpus. Both filters of each now
// also carry '#d' with exactly the d-tags the handler acts on (exact equality, no prefix): subscribeMessageTags
// 'trinityone/msgtags' (a fixed d with NO church in it); openReseat name:<A> (a member's own sealed name, signed by the
// MEMBER and carried by the '#church' filter) and reseat:<A>. authors / '#church' / '#t' are unchanged. In particular
// the message-tags filter is NOT a bare '#d' (which would show another church's tags: the handler does not check the
// author) - the test seeds church B's own 'trinityone/msgtags' and asserts it never reaches the emitted list.
//
// POINT OF USE (rule 1): real gateway, real console, church A; the REAL bundled functions called as A against a relay
// holding A's real-shaped documents PLUS 20 unrelated documents of A, church B's msgtags / reseat / name documents and
// 50 more of B's. (a) the REQ on the wire, (b) the EVENT frames the relay sent on that subscription, (c) what was
// emitted. (a)+(b) are the regression guard; (c) passes with the old filters too and only guards that nothing was lost.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openRig, otherChurchPile, ownNoise, doc, CHROME, probe, narrowed, H, NET } from './narrow-reads-rig.mjs';
import { finalizeEvent } from 'nostr-tools/pure';

const MSGTAGS_D = 'trinityone/msgtags', RESEAT_D = 'trinityone/reseat:', NAME_D = 'trinityone/name:', MEMBER_D = 'trinityone/member:';
let A = null; const OLD = H.key(), NEW = H.key(), M2 = H.key();
const T = { skip: !CHROME, timeout: 240000 };
const broad = (filters) => filters.some(f => f['#t']);   // the live subscription, not a narrow fresh-read beside it
const at = () => Math.floor(Date.now() / 1000);
const join = (church, k) => finalizeEvent({ kind: 30078, created_at: at(), tags: [['d', MEMBER_D + church], ['t', NET], ['p', church]], content: JSON.stringify({ joined: at() }) }, k.sk);

before(async () => {
  if (!CHROME) return;
  A = await openRig('tagsreseat');
  const B = A.other.pub, P = A.church.pub;
  const BN = H.key();
  await A.put([
    join(P, OLD), join(P, NEW), join(P, M2), join(B, BN),   // members first: the relay refuses a name document from a non-member
    doc(A.church, MSGTAGS_D, { tags: [{ id: 'prayer', label: 'Prayer request' }] }),
    doc(A.other, MSGTAGS_D, { tags: [{ id: 'bsecret', label: 'Church B tag' }] }, [['church', B]]),
    doc(A.church, RESEAT_D + P, { pairs: [{ old: OLD.pub, new: NEW.pub, at: 1700000000 }] }),
    doc(A.other, RESEAT_D + B, { pairs: [] }, [['church', B]]),
    doc(M2, NAME_D + P, '{"e":"sealed-not-openable-here"}', [['church', P]]),            // a member's own sealed name: signed by the MEMBER
    doc(BN, NAME_D + B, '{"e":"b-name"}', [['church', B]]),
    ...ownNoise(A, 20), ...otherChurchPile(A, 50),
  ]);
});
after(() => { try { A && A.close(); } catch {} });

const only = (r, want) => { for (const e of r.events) assert.ok(want.includes(e.d), 'the relay sent a document the read does not want: ' + e.d); assert.ok(r.events.length <= want.length, 'the relay sent ' + r.events.length + ' events for ' + want.length + ' wanted documents'); };
const EXPR = {
  tags: `window.Steward.subscribeMessageTags(t => window.__probe.out.push(t))`,
  members: `window.Steward.subscribeMembers(l => window.__probe.out.push(l.map(m => m.pubkey)))`,
};
const WANT = { tags: () => [MSGTAGS_D], members: () => [NAME_D + A.church.pub, RESEAT_D + A.church.pub] };
const cache = {};
const get = (k) => (cache[k] ||= probe(A, EXPR[k], { pick: broad, settleMs: 6000 }));

for (const k of ['tags', 'members']) {
  test(`(a) ${k}: both filters carry #d with exactly the wanted documents, and keep authors / #church`, T, async () => { narrowed(assert, await get(k), A, WANT[k]()); });
  test(`(b) ${k}: the relay sends only the wanted documents (bounded EVENT count)`, T, async () => { only(await get(k), WANT[k]()); });
}
test('(b2) members: the member\'s own sealed name document still ARRIVES on the narrowed read (the filter did not lose it)', T, async () => {
  assert.ok((await get('members')).events.some(e => e.d === NAME_D + A.church.pub), 'name:<A> never came back on the openReseat subscription');
});
test('(c) the emitted results are unchanged; church B\'s msgtags never reach A (pass with the old filters too)', T, async () => {
  const tags = (await get('tags')).out.pop();
  assert.deepEqual(tags.map(t => t.id), ['prayer']);
  const members = (await get('members')).out.pop();
  assert.ok(!members.includes(OLD.pub), 'the re-seated old key is still on the member list');
  assert.ok(members.includes(NEW.pub) && members.includes(M2.pub), 'a member is missing from the list: ' + JSON.stringify(members));
});
