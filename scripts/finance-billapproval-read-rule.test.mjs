// A BILL-APPROVAL IS NOT THE NETWORK'S — IT LINKS AN APPROVER'S PUBKEY TO A BILL, SO networkOf IS DROPPED.
// 2026-11-18 (OWNER DECISION): a joined network key now reads NO finance, aggregate included. Wherever this header says a network peer is
// "STILL served aggregate finance", that is HISTORY; the test below that used to assert it now asserts the REFUSAL.
//   Run: node --test scripts/finance-billapproval-read-rule.test.mjs
//
// finance/billapproval:<billId>:<approverHex> (Phase 6, dual control) records WHICH finance-steward pubkey
// approved WHICH bill. The generic finance/ READ rule serves aggregate finance (journal/account/fund) to a
// NETWORK-PEER church; for the approver↔bill linkage that is a disclosure the church never made. By the owner's
// decision (2026-11-07) it gets an EXPLICIT canRead branch ABOVE the generic one that DROPS networkOf — exactly
// as finance/donor + finance/contact + finance/invoice + finance/bill do. This drives the REAL gateway and reads
// AS each persona over NIP-42, proving on the same box in one run:
//   · the CHURCH KEY and a FINANCE STEWARD are served the approval;
//   · a NETWORK PEER is REFUSED the approval, but is STILL served aggregate finance (the journal) — so the new
//     rule narrowed billapproval ONLY, it did not break the network read;
//   · a plain MEMBER is served neither; and an UNAUTHENTICATED reader (answers no AUTH) is served neither.
//
// POINT OF USE (CLAUDE.md rule 1): the network-peer assertion FAILS if the new branch is deleted — the doc then
// falls through to the generic finance/ read, whose networkOf serves the peer. Proven by scoped sabotage.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as H from './relay-network-harness.mjs';
import { D } from './trinity-doc-types.mjs';
import { finalizeEvent } from 'nostr-tools/pure';

const NET = 'trinityone';
const church = H.key();
const treasurer = H.key();     // a FINANCE steward — and the APPROVER named in the address
const member = H.key();        // an ordinary member — no capability
const network = H.key();       // the NETWORK key the church declares it belongs to
const cp = church.pub;
const billId = 'bl1';
const approvalD = 'finance/billapproval:' + billId + ':' + treasurer.pub;   // <billId>:<approverHex>
let relay;
const at = () => H.now();

const roster = () => finalizeEvent({ kind: 30078, created_at: at(), tags: [['d', 'trinityone/stewards:' + cp], ['t', NET]], content: JSON.stringify({ pubkeys: [treasurer.pub], caps: { [treasurer.pub]: ['finance'] } }) }, church.sk);
const joinNetwork = () => finalizeEvent({ kind: 30078, created_at: at(), tags: [['d', D.NETWORK + network.pub], ['t', NET]], content: JSON.stringify({ joined: at() }) }, church.sk);
// The approval is authored by the APPROVER (treasurer), who church-tags cp. The write rule binds signer===approver.
const approvalDoc = () => finalizeEvent({ kind: 30078, created_at: at(), tags: [['d', approvalD], ['t', NET], ['church', cp]], content: JSON.stringify({ bill: billId, ts: at() }) }, treasurer.sk);
const journalDoc = () => finalizeEvent({ kind: 30078, created_at: at(), tags: [['d', 'finance/journal:1'], ['t', NET], ['church', cp]], content: JSON.stringify({ sealed: 'x' }) }, church.sk);

const servedApproval = async (who) => (await H.readAs(relay, who, { kinds: [30078], '#d': [approvalD] })).length > 0;
const servedJournal = async (who) => (await H.readAs(relay, who, { kinds: [30078], '#d': ['finance/journal:1'] })).length > 0;

// An UNAUTHENTICATED read: connect, ask, and deliberately never answer the relay's AUTH challenge, so authed===''
// at the gate. Proves the `if (!authed) return false;` guard above the finance branches holds for this doc.
const servedApprovalAnon = () => new Promise(async (resolve, reject) => {
  let w; try { w = await H.connect(relay); } catch (e) { reject(e); return; }
  const events = [];
  w.on('message', (d) => { let m; try { m = JSON.parse(d); } catch { return; }
    if (m[0] === 'EVENT' && m[1] === 's') events.push(m[2]); });   // ignore AUTH on purpose
  w.send(JSON.stringify(['REQ', 's', { kinds: [30078], '#d': [approvalD] }]));
  setTimeout(() => { try { w.close(); } catch {} resolve(events.length > 0); }, 900);
});

before(async () => {
  relay = await H.startRelay({ name: 'billapprovalread', churches: [cp] });
  await H.publishAll(relay, [roster(), joinNetwork(), approvalDoc(), journalDoc()]);
});
after(() => { try { H.stopAll(); } catch {} });

test('the church itself reads its own bill-approval', async () => {
  assert.equal(await servedApproval(church), true, 'the church key could not read its own bill-approval — the new branch denies the owning church');
});

test('a FINANCE steward reads the bill-approval', async () => {
  assert.equal(await servedApproval(treasurer), true, 'a finance steward was refused the bill-approval');
});

test('a NETWORK PEER is REFUSED the bill-approval', async () => {
  assert.equal(await servedApproval(network), false,
    'a NETWORK-PEER church was served a bill-approval (it links an approver pubkey to a bill) — the explicit finance/billapproval read rule did not drop networkOf, or it falls BELOW the generic finance/ rule');
});

test('…and the SAME network peer is ALSO REFUSED aggregate finance (owner decision 2026-11-18: a network key reads NO finance)', async () => {
  // REVERSED 2026-11-18. This test used to assert the opposite (a network peer IS served the journal, per the owner's 2026-10-30 /
  // 2026-11-07 choice). The owner withdrew it: a joined network key gets none of a church's finance. The two re-anchors prove the
  // journal is a LIVE doc that its rightful readers are served, so the refusal below is not vacuous.
  assert.equal(await servedJournal(church), true, 're-anchor: the church cannot read its own journal — the doc is not live');
  assert.equal(await servedJournal(treasurer), true, 're-anchor: a finance steward cannot read the journal');
  assert.equal(await servedJournal(network), false,
    'the network peer was served aggregate finance (journal) — the generic finance/ read still admits networkOf (owner decision 2026-11-18 removed it)');
});

test('an ordinary MEMBER is served neither the bill-approval nor aggregate finance', async () => {
  assert.equal(await servedApproval(member), false, 'a plain member read a bill-approval');
  assert.equal(await servedJournal(member), false, 're-anchor: a plain member read aggregate finance — the finance/ read gate itself is broken');
});

test('an UNAUTHENTICATED reader (answers no AUTH) is served neither', async () => {
  assert.equal(await servedApprovalAnon(), false, 'an unauthenticated reader was served a bill-approval — the !authed guard did not hold');
});
