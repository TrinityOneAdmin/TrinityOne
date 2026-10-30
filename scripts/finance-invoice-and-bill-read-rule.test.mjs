// AN INVOICE AND A BILL ARE NOT THE NETWORK'S — THEY EMBED A PARTY NAME, SO networkOf IS DROPPED.
//   Run: node --test scripts/finance-invoice-and-bill-read-rule.test.mjs
//
// finance/invoice: (Phase 5) carries a hall-hirer's NAME; finance/bill: (Phase 6) carries a supplier's NAME.
// The generic finance/ READ rule serves aggregate finance (journal/account/fund) to a NETWORK-PEER church; for a
// party name that is a disclosure the church never made. By the owner's decision (2026-10-30) both get an
// EXPLICIT canRead branch ABOVE the generic one that DROPS networkOf — exactly as finance/donor + finance/contact
// do. This drives the REAL gateway and reads AS each persona over NIP-42, proving on the same box in one run:
//   · a NETWORK PEER is REFUSED finance/invoice AND finance/bill, but is STILL served aggregate finance
//     (the journal) — so the two rules narrowed invoice+bill ONLY, they did not break the network read;
//   · the CHURCH KEY and a FINANCE STEWARD are served both;
//   · a plain MEMBER / stranger is served neither.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as H from './relay-network-harness.mjs';
import { D } from './trinity-doc-types.mjs';
import { finalizeEvent } from 'nostr-tools/pure';

const NET = 'trinityone';
const church = H.key();
const treasurer = H.key();     // a FINANCE steward
const member = H.key();        // an ordinary member — no capability
const network = H.key();       // the NETWORK key the church declares it belongs to
const cp = church.pub;
let relay;
const at = () => H.now();

const roster = () => finalizeEvent({ kind: 30078, created_at: at(), tags: [['d', 'trinityone/stewards:' + cp], ['t', NET]], content: JSON.stringify({ pubkeys: [treasurer.pub], caps: { [treasurer.pub]: ['finance'] } }) }, church.sk);
const joinNetwork = () => finalizeEvent({ kind: 30078, created_at: at(), tags: [['d', D.NETWORK + network.pub], ['t', NET]], content: JSON.stringify({ joined: at() }) }, church.sk);
const invoiceDoc = () => finalizeEvent({ kind: 30078, created_at: at(), tags: [['d', 'finance/invoice:iv1'], ['t', NET], ['church', cp]], content: JSON.stringify({ sealed: 'x' }) }, church.sk);
const billDoc = () => finalizeEvent({ kind: 30078, created_at: at(), tags: [['d', 'finance/bill:bl1'], ['t', NET], ['church', cp]], content: JSON.stringify({ sealed: 'x' }) }, church.sk);
const journalDoc = () => finalizeEvent({ kind: 30078, created_at: at(), tags: [['d', 'finance/journal:1'], ['t', NET], ['church', cp]], content: JSON.stringify({ sealed: 'x' }) }, church.sk);

const servedInvoice = async (who) => (await H.readAs(relay, who, { kinds: [30078], '#d': ['finance/invoice:iv1'] })).length > 0;
const servedBill = async (who) => (await H.readAs(relay, who, { kinds: [30078], '#d': ['finance/bill:bl1'] })).length > 0;
const servedJournal = async (who) => (await H.readAs(relay, who, { kinds: [30078], '#d': ['finance/journal:1'] })).length > 0;

before(async () => {
  relay = await H.startRelay({ name: 'invbillread', churches: [cp] });
  await H.publishAll(relay, [roster(), joinNetwork(), invoiceDoc(), billDoc(), journalDoc()]);
});
after(() => { try { H.stopAll(); } catch {} });

test('the church itself reads its own invoice and bill', async () => {
  assert.equal(await servedInvoice(church), true, 'the church key could not read its own invoice');
  assert.equal(await servedBill(church), true, 'the church key could not read its own bill');
});

test('a FINANCE steward reads the invoice and the bill', async () => {
  assert.equal(await servedInvoice(treasurer), true, 'a finance steward was refused the invoice');
  assert.equal(await servedBill(treasurer), true, 'a finance steward was refused the bill');
});

test('a NETWORK PEER is REFUSED the invoice AND the bill', async () => {
  assert.equal(await servedInvoice(network), false,
    'a NETWORK-PEER church was served an invoice (it embeds a hall-hirer name) — the explicit finance/invoice read rule did not drop networkOf, or it falls BELOW the generic finance/ rule');
  assert.equal(await servedBill(network), false,
    'a NETWORK-PEER church was served a bill (it embeds a supplier name) — the explicit finance/bill read rule did not drop networkOf, or it falls BELOW the generic finance/ rule');
});

test('…but the SAME network peer is STILL served aggregate finance (the rules narrowed invoice+bill ONLY)', async () => {
  assert.equal(await servedJournal(network), true,
    'the network peer was refused aggregate finance too — the invoice/bill rules are over-broad (they must match finance/invoice + finance/bill ONLY, leaving the generic finance/ network read intact)');
});

test('an ordinary MEMBER is served neither the invoice, the bill, nor aggregate finance', async () => {
  assert.equal(await servedInvoice(member), false, 'a plain member read an invoice');
  assert.equal(await servedBill(member), false, 'a plain member read a bill');
  assert.equal(await servedJournal(member), false, 're-anchor: a plain member read aggregate finance — the finance/ read gate itself is broken');
});
