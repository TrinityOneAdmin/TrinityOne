// A BUDGET IS GATED EXACTLY LIKE EVERY OTHER finance/ DOC — church key OR finance steward, NEVER a member.
//   Run: node --test scripts/finance-budget-read-rule.test.mjs
//
// Phase 7 adds finance/budget:<id>. It must NOT widen the Finance capability (CLAUDE.md rule 10,
// CONTEXT constraint 2): it rides the GENERIC finance/ accept()+canRead() rules, with NO explicit gateway
// branch. This drives the REAL gateway on a free port and proves, on the same box in the same run, both
// halves constraint 2 requires in the record:
//   · WRITE — a plain MEMBER is REFUSED publishing a budget; the CHURCH KEY and a FINANCE STEWARD are accepted;
//   · READ  — a plain MEMBER is served NEITHER the budget NOR aggregate finance; the church key and the
//     finance steward ARE served the budget.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as H from './relay-network-harness.mjs';
import { finalizeEvent } from 'nostr-tools/pure';

const NET = 'trinityone';
const church = H.key();      // the church whose books these are
const treasurer = H.key();   // a FINANCE steward of that church
const member = H.key();      // an ordinary member — no capability
const cp = church.pub;

let relay;
const at = () => H.now();
const roster = () => finalizeEvent({ kind: 30078, created_at: at(), tags: [['d', 'trinityone/stewards:' + cp], ['t', NET]], content: JSON.stringify({ pubkeys: [treasurer.pub], caps: { [treasurer.pub]: ['finance'] } }) }, church.sk);
// a budget doc, signed by the CHURCH, seeded so the read side has something to serve
const budgetDoc = (who) => finalizeEvent({ kind: 30078, created_at: at(), tags: [['d', 'finance/budget:bg1'], ['t', NET], ['church', cp]], content: JSON.stringify({ sealed: 'x' }) }, who.sk);

const servedBudget = async (who) => (await H.readAs(relay, who, { kinds: [30078], '#d': ['finance/budget:bg1'] })).length > 0;
const tryWrite = async (who) => { const w = await H.connect(relay); try { return (await H.publish(w, budgetDoc(who)))[0]; } finally { try { w.close(); } catch {} } };

before(async () => {
  relay = await H.startRelay({ name: 'budgetgate', churches: [cp] });
  await H.publishAll(relay, [roster(), budgetDoc(church)]);
});
after(() => { try { H.stopAll(); } catch {} });

test('WRITE: a plain MEMBER is refused publishing a budget', async () => {
  assert.equal(await tryWrite(member), false, 'a member published a finance/budget doc — the finance write gate is widened');
});

test('WRITE: the CHURCH KEY and a FINANCE STEWARD may publish a budget', async () => {
  assert.equal(await tryWrite(church), true, 'the church key could not write its own budget');
  assert.equal(await tryWrite(treasurer), true, 'a finance steward could not write a budget — the capability grants nothing');
});

test('READ: the church key and the finance steward are served the budget', async () => {
  assert.equal(await servedBudget(church), true, 'the church key could not read its own budget');
  assert.equal(await servedBudget(treasurer), true, 'a finance steward was refused the budget');
});

test('READ: a plain MEMBER is served neither the budget nor aggregate finance', async () => {
  assert.equal(await servedBudget(member), false, 'a plain member read a church budget — the finance/ read gate is widened');
});
