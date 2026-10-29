// A DONOR RECORD IS SERVED TO THE CHURCH AND ITS FINANCE STEWARD — NEVER A NETWORK PEER, NEVER A MEMBER.
//   Run: node --test scripts/finance-donor-read-rule.test.mjs
//
// Phase 4b adds finance/donor:<id> — a donor's NAME + address + postcode + giving. It is the single most
// member-identifying finance doc. AUDIT-PHASE-4 finding 1: the generic finance/ READ rule is
// `authed === cp || networkOf(authed, cp) || stewardCan(authed, cp, 'finance')`, which serves AGGREGATE
// finance (journal/accounts/funds) to a NETWORK-PEER church. That is a deliberate choice for a chart of
// accounts and a disaster for donor PII. The fix is an EXPLICIT finance/donor read branch ABOVE the generic
// one that DROPS networkOf: church key OR finance steward only.
//
// This drives the REAL gateway on a free port and reads AS each persona over NIP-42 (the harness's readAs
// answers the AUTH challenge with that persona's key). It proves, on the same box in the same run:
//   · a NETWORK PEER is REFUSED finance/donor but is STILL served aggregate finance (journal/account) — so the
//     rule narrowed donor ONLY, it did not break the network-read the other finance docs rely on;
//   · the CHURCH KEY and a FINANCE STEWARD are served the donor;
//   · a plain MEMBER / stranger is served neither.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as H from './relay-network-harness.mjs';
import { D } from './trinity-doc-types.mjs';
import { finalizeEvent } from 'nostr-tools/pure';

const NET = 'trinityone';
const church = H.key();          // the church whose books these are
const treasurer = H.key();       // a FINANCE steward of that church
const member = H.key();          // an ordinary member — no capability
const network = H.key();         // the NETWORK key the church declares it belongs to (networkOf grants it aggregate finance)
const cp = church.pub;

let relay;
const at = () => H.now();
// the stewards roster: treasurer holds 'finance', member holds nothing
const roster = () => finalizeEvent({ kind: 30078, created_at: at(), tags: [['d', 'trinityone/stewards:' + cp], ['t', NET]], content: JSON.stringify({ pubkeys: [treasurer.pub], caps: { [treasurer.pub]: ['finance'] } }) }, church.sk);
// the church declares it belongs to `network` — this is the ONLY way networkOf becomes true (note()'s NETWORK_D
// branch requires the declaring author to BE the church), so the network key is a legitimate aggregate reader.
const joinNetwork = () => finalizeEvent({ kind: 30078, created_at: at(), tags: [['d', D.NETWORK + network.pub], ['t', NET]], content: JSON.stringify({ joined: at() }) }, church.sk);
// the three finance docs: a donor (PII), and two aggregate docs (a journal entry + an account)
const donorDoc = () => finalizeEvent({ kind: 30078, created_at: at(), tags: [['d', 'finance/donor:dn1'], ['t', NET], ['church', cp]], content: JSON.stringify({ sealed: 'x' }) }, church.sk);
const journalDoc = () => finalizeEvent({ kind: 30078, created_at: at(), tags: [['d', 'finance/journal:1'], ['t', NET], ['church', cp]], content: JSON.stringify({ sealed: 'x' }) }, church.sk);
const accountDoc = () => finalizeEvent({ kind: 30078, created_at: at(), tags: [['d', 'finance/account:bank'], ['t', NET], ['church', cp]], content: JSON.stringify({ sealed: 'x' }) }, church.sk);

const servedDonor = async (who) => (await H.readAs(relay, who, { kinds: [30078], '#d': ['finance/donor:dn1'] })).length > 0;
const servedJournal = async (who) => (await H.readAs(relay, who, { kinds: [30078], '#d': ['finance/journal:1'] })).length > 0;

before(async () => {
  relay = await H.startRelay({ name: 'donorread', churches: [cp] });
  await H.publishAll(relay, [roster(), joinNetwork(), donorDoc(), journalDoc(), accountDoc()]);
});
after(() => { try { H.stopAll(); } catch {} });

test('the church itself reads its own donor record', async () => {
  assert.equal(await servedDonor(church), true, 'the church key could not read its own donor record');
});

test('a FINANCE steward reads the donor record', async () => {
  assert.equal(await servedDonor(treasurer), true, 'a finance steward (the treasurer) was refused the donor record — the capability grants nothing');
});

test('a NETWORK PEER is REFUSED the donor record', async () => {
  // This is the finding. Before the explicit rule, networkOf(network, cp) let the network key read every
  // finance/ doc, donor PII included.
  assert.equal(await servedDonor(network), false,
    'a NETWORK-PEER church was served a donor record (name + address + giving). The explicit finance/donor read ' +
    'rule did not drop networkOf, or it falls BELOW the generic finance/ rule and never runs.');
});

test('…but the SAME network peer is STILL served aggregate finance (the rule narrowed donor ONLY)', async () => {
  // Proves networkOf still works for the aggregate docs — the fix did not break the network read the chart of
  // accounts relies on, it carved donor out of it.
  assert.equal(await servedJournal(network), true,
    'the network peer was refused aggregate finance too — the donor rule is over-broad (it should match ' +
    'finance/donor ONLY, leaving the generic finance/ network read intact)');
});

test('an ordinary MEMBER is served neither the donor nor aggregate finance', async () => {
  assert.equal(await servedDonor(member), false, 'a plain member read a donor record');
  assert.equal(await servedJournal(member), false, 're-anchor: a plain member read aggregate finance — the finance/ read gate itself is broken, not just donor');
});
