// A BILL APPROVAL STAYS INSIDE THE FINANCE CAPABILITY, AND A DUAL-CONTROL APPROVAL IS BOUND TO ITS SIGNER.
//   Run: node --test scripts/finance-bill-approval-rule.test.mjs
//
// Phase 6 adds finance/bill: (the payable metadata) and finance/billapproval:<billId>:<approverhex> (the
// dual-control approval). This drives the REAL gateway on a free port and publishes AS each persona, proving on
// the same box in one run:
//   · finance/bill: is WRITTEN by the church key or a FINANCE steward, and REFUSED from a care-only steward and
//     a stranger — the capability is NOT widened (DOMAIN capability-scope; CLAUDE.md rule 10);
//   · a dual-control approval is ACCEPTED only when the event SIGNER equals the approver named in the address,
//     so a finance steward CANNOT forge an approval attributed to another (the relay binds approver==signer);
//   · a care-only steward CANNOT approve at all (approval authority is stewardCan(..., 'finance') ONLY);
//   · two DIFFERENT finance stewards can each approve under their OWN address — real dual control.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as H from './relay-network-harness.mjs';
import { finalizeEvent } from 'nostr-tools/pure';

const NET = 'trinityone';
const church = H.key();        // the church whose books these are
const treasurer = H.key();     // a FINANCE steward
const treasurer2 = H.key();    // a SECOND finance steward (so dual control has two distinct approvers)
const careSteward = H.key();   // a CARE-only steward — must NOT be able to touch finance
const stranger = H.key();      // nobody
const cp = church.pub;
const BILL = 'b1abc';          // an opaque bill id
let relay;
const at = () => H.now();

// roster: treasurer + treasurer2 hold 'finance'; careSteward holds 'care' only
const roster = () => finalizeEvent({ kind: 30078, created_at: at(), tags: [['d', 'trinityone/stewards:' + cp], ['t', NET]], content: JSON.stringify({ pubkeys: [treasurer.pub, treasurer2.pub, careSteward.pub], caps: { [treasurer.pub]: ['finance'], [treasurer2.pub]: ['finance'], [careSteward.pub]: ['care'] } }) }, church.sk);

// a finance/bill: metadata doc authored by `who` (church-tagged, as the console publishes)
const billDoc = (who) => finalizeEvent({ kind: 30078, created_at: at(), tags: [['d', 'finance/bill:' + BILL], ['t', NET], ['church', cp]], content: JSON.stringify({ sealed: 'x' }) }, who.sk);
// a dual-control approval doc: address names `approverPub`, signed by `who`
const approvalDoc = (who, approverPub) => finalizeEvent({ kind: 30078, created_at: at(), tags: [['d', 'finance/billapproval:' + BILL + ':' + approverPub], ['t', NET], ['church', cp]], content: JSON.stringify({ bill: BILL, ts: at() }) }, who.sk);

async function writeOk(evt) {
  const w = await H.connect(relay);
  try { const [ok] = await H.publish(w, evt); return ok; } finally { try { w.close(); } catch {} }
}

before(async () => {
  relay = await H.startRelay({ name: 'billapproval', churches: [cp] });
  await H.publishAll(relay, [roster()]);
});
after(() => { try { H.stopAll(); } catch {} });

// ── finance/bill: WRITE stays church-OR-finance-steward (no widening) ──────────────────────────────────────
test('the church key may write a bill', async () => {
  assert.equal(await writeOk(billDoc(church)), true, 'the church key could not write its own bill');
});
test('a FINANCE steward may write a bill', async () => {
  assert.equal(await writeOk(billDoc(treasurer)), true, 'a finance steward was refused a bill write — the capability grants nothing');
});
test('a CARE-only steward may NOT write a bill (capability not widened)', async () => {
  assert.equal(await writeOk(billDoc(careSteward)), false, 'a care-only steward wrote a finance/bill — the finance write gate is widened');
});
test('a stranger may NOT write a bill', async () => {
  assert.equal(await writeOk(billDoc(stranger)), false, 'a stranger wrote a finance/bill');
});

// ── finance/billapproval: the relay BINDS approver == signer ──────────────────────────────────────────────
test('a finance steward’s OWN approval (address names them, they sign it) is ACCEPTED', async () => {
  assert.equal(await writeOk(approvalDoc(treasurer, treasurer.pub)), true,
    'a finance steward could not sign an approval at their own address — the bind is too strict or the finance gate is wrong');
});

test('a SECOND finance steward can approve under their OWN address — real dual control', async () => {
  assert.equal(await writeOk(approvalDoc(treasurer2, treasurer2.pub)), true,
    'a second finance steward could not approve — dual control (two distinct approvers) is impossible');
});

test('a finance steward CANNOT forge an approval attributed to ANOTHER steward', async () => {
  // treasurer2 (a finance steward, so the finance gate alone would let them) signs a doc whose ADDRESS names
  // treasurer. The relay must refuse it: the approver is bound to the signer, not to whoever the writer names.
  assert.equal(await writeOk(approvalDoc(treasurer2, treasurer.pub)), false,
    'a finance steward forged an approval in another steward’s name — the relay did not bind approver==signer');
});

test('a CARE-only steward CANNOT approve a bill (approval authority is finance ONLY)', async () => {
  // Even at their OWN address — so this is the capability check, not the signer bind — a care steward is refused.
  assert.equal(await writeOk(approvalDoc(careSteward, careSteward.pub)), false,
    'a care-only steward approved a bill — approval leaked outside the finance capability');
});

test('a stranger CANNOT approve a bill', async () => {
  assert.equal(await writeOk(approvalDoc(stranger, stranger.pub)), false, 'a stranger approved a bill');
});

test('an approval with a malformed address (no approver hex) is refused by shape', async () => {
  const bad = finalizeEvent({ kind: 30078, created_at: at(), tags: [['d', 'finance/billapproval:' + BILL], ['t', NET], ['church', cp]], content: JSON.stringify({ bill: BILL }) }, treasurer.sk);
  assert.equal(await writeOk(bad), false, 'an address that names no approver was accepted — the parser or the bind is missing');
});
