// A STEWARD'S APPROVAL OUTLIVES THE STEWARD ON EVERY RELAY — INCLUDING ONE THAT GOT IT BY SYNC, AND ONE THAT HELD IT
// BEFORE APPROVAL RECEIPTS EXISTED. Run: node --test scripts/a-synced-approval-survives-its-steward-leaving.test.mjs
//
// Item D (owner 2026-09-16: "approved members must always survive a steward leaving"). The relay records a steward's
// `admitted:` copy as church state (gateway.mjs ADMITTED_RECEIPTS). Audit of 5072bb1 found two routes that recorded
// nothing, both of which made a removal un-approve people:
//   MED-1  a copy already on disk before the upgrade had no receipt, so the relay stopped serving it the moment its
//          author was removed — no restart needed.
//   MED-2  a copy that reached a relay by relay-to-relay sync (the box was down when the approval was made) had none.
// Two real relays, one church; nothing mocked. Ben is approved by the warden; the warden is then removed.
//
// ⚠ NOT A CODE FAILURE IF YOU SEE IT: in a worktree with no node_modules, or with another suite holding ports.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { finalizeEvent } from 'nostr-tools/pure';
import * as H from './relay-network-harness.mjs';

const NET = 'trinityone';
const church = H.key(), warden = H.key(), ben = H.key();
const cp = church.pub;
const ADMITTED_D = 'trinityone/admitted:' + cp;
let A, B, stamp = H.now() - 200;
const at = () => ++stamp;
const roster = (pubkeys, caps) => H.churchDoc(church, 'trinityone/stewards:' + cp, { pubkeys, caps }, at());
const memberDoc = (who) => finalizeEvent({ kind: 30078, created_at: at(), tags: [['d', 'trinityone/member:' + cp], ['t', NET]], content: '{}' }, who.sk);
const wardenCopy = finalizeEvent({ kind: 30078, created_at: H.now() - 50, tags: [['d', ADMITTED_D], ['t', NET], ['church', cp]], content: JSON.stringify({ pubkeys: [ben.pub] }) }, warden.sk);
// Ben seeing ANY copy of the allowlist is the relay's own answer to "is Ben admitted": its read gate serves this
// document only to an admitted member of a church that gates joins.
const benAdmittedOn = async (relay) => (await H.readAs(relay, ben, { kinds: [30078], '#church': [cp], '#t': [NET] }))
  .some(e => ((e.tags.find(t => t[0] === 'd') || [])[1]) === ADMITTED_D);

before(async () => {
  A = await H.startRelay({ name: 'A', churches: [cp] });
  B = await H.startRelay({ name: 'B', churches: [cp] });
  const common = [H.relaysDoc(church, [A, B], at()), roster([warden.pub], { [warden.pub]: ['members'] }),
    H.churchDoc(church, 'trinityone/joinpolicy:' + cp, { approval: true }, at()), memberDoc(warden), memberDoc(ben)];
  for (const r of [A, B]) await H.publishAll(r, common);
  await H.publishAll(A, [wardenCopy]);   // B was down, as far as the warden's approval is concerned
});
after(() => { H.stopAll(); setTimeout(() => process.exit(process.exitCode || 0), 2000).unref(); });

test('setup: Ben is approved on A, and B holds the warden’s approval only because it synced it from A', async () => {
  assert.equal(await benAdmittedOn(A), true, 're-anchor: the warden’s approval does not admit Ben on A at all');
  assert.equal(await benAdmittedOn(B), false, 'CONTROL: B admitted Ben before it had the approval, so the B rows prove nothing');
  await H.syncNow(B);
  await H.waitFor(async () => (await H.corpusIds(B, church)).has(wardenCopy.id), { label: 'B syncing the warden’s approval from A' });
  assert.equal(await benAdmittedOn(B), true, 're-anchor: B synced the approval but does not honour it even with the warden on the roster');
});

test('setup: A forgets every receipt and restarts — a relay that held the approval BEFORE the upgrade', async () => {
  const f = join(A.dataDir, 'admitted-receipts.json');
  assert.ok(existsSync(f), 're-anchor: A never wrote a receipt for a live approval');
  A.proc.kill('SIGKILL');
  await H.sleep(300);
  rmSync(f, { force: true });
  A = await H.moveRelay(A);
  assert.equal(await benAdmittedOn(A), true, 're-anchor: A stopped admitting Ben merely by restarting with the warden still a steward');
});

test('MED-1 + MED-2: the warden is removed — Ben stays approved on BOTH relays, at once and after a restart', async () => {
  const off = roster([], {});
  for (const r of [A, B]) await H.publishAll(r, [off]);
  await H.sleep(300);
  // Every relay is asked before anything is asserted, so a failure names EVERY route that lost Ben, not the first.
  const lost = [];
  if (!(await benAdmittedOn(A))) lost.push('MED-1 (A, at once): an approval A held from before receipts existed stopped being served the moment its steward was removed — and the next church Approve would make that permanent');
  if (!(await benAdmittedOn(B))) lost.push('MED-2 (B, at once): an approval B got by relay-to-relay sync stopped counting the moment its steward was removed');
  A = await H.moveRelay(A);
  B = await H.moveRelay(B);
  if (!(await benAdmittedOn(A))) lost.push('MED-1 (A, after restart)');
  if (!(await benAdmittedOn(B))) lost.push('MED-2 (B, after restart)');
  assert.deepEqual(lost, [], 'Ben, approved by a steward who has since been removed, is no longer admitted:\n  ' + lost.join('\n  '));
});
