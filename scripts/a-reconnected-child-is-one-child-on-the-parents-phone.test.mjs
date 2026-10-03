// A CHILD WHO IS RECONNECTED IS ONE CHILD ON THEIR PARENT'S PHONE, WHICHEVER ARRIVES FIRST. Sim item 30 (2026-10-02).
// Run: node --test scripts/a-reconnected-child-is-one-child-on-the-parents-phone.test.mjs
//
// The defect, found by reading the order things happen in: when a steward reconnects a child onto a new key the console
// tells each parent their whole list -- which still names the child's OLD key beside the new one -- and only then
// publishes the re-seat document. The parent's phone drops a superseded key from a notice it applies (_applyGuardianList),
// but only if the re-seat document has ALREADY arrived. When the notice lands first (the console sends it first, and a
// cold boot replays oldest-first) both keys were saved, and nothing re-ran the list when the re-seat turned up:
// the Family sheet showed the same child twice. The parent's own still-live request for the OLD key could add it back
// from the rebuild as well.
//
// The member app's functions come out of vendor/fellowship.js (scripts/family-harness.mjs) and run against a real
// relay; the notice is signed and sealed the way the console's _sendGuardNotice signs it. Nothing re-types a function
// under test. (The hub's own call to _noteReseat is one existing line, `if (d === RESEAT_D + cp) _noteReseat(cp, e)`.)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { finalizeEvent } from 'nostr-tools/pure';
import { requireFreePort } from './test-ports.mjs';
import { K, now, until, sleep, startRelay, publishTo, memStorage, memberBoot, noticeEvt, reqEvt, memberEvt } from './family-harness.mjs';

const PORT = 8784;   // unique across scripts/*.test.mjs AND scripts/*.probe.mjs
const church = K();
let R;
before(async () => { await requireFreePort(PORT, 'a-reconnected-child-is-one-child-on-the-parents-phone.test.mjs'); R = await startRelay(PORT, church.pub); });
after(() => { R && R.stop(); });

const join = async (who) => assert.equal((await publishTo(R.url, memberEvt(church, who)))[0], true, 'fixture: join refused');
// the re-seat document as the console's setReseats signs it: church-signed, pairs of old -> new
const reseatEvt = (oldK, newK) => finalizeEvent({ kind: 30078, created_at: now(),
  tags: [['d', 'trinityone/reseat:' + church.pub], ['t', 'trinityone']],
  content: JSON.stringify({ pairs: [{ old: oldK.pub, new: newK.pub, at: now() }] }) }, church.sk);
const familyEvents = (b) => b.events.filter(e => e && e.type === 'trinity-family-changed');

test('the notice (naming old AND new) arrives first, the re-seat second: the child is shown once, and the sheet is told to redraw', async () => {
  const parent = K(), oldKid = K(), newKid = K();
  await join(parent);
  // exactly what reseatMember has the console send: the whole list, old key still on it beside the new one
  assert.equal((await publishTo(R.url, noticeEvt(church, parent, { church: church.pub, children: [oldKid.pub, newKid.pub] }, now() - 5)))[0], true, 'fixture: notice refused');
  const reseated = new Map();
  const b = memberBoot(parent, memStorage(), { relays: [R.url], reseated });
  const unsub = b.api.subscribeGuardianNotices();
  try {
    assert.ok(await until(() => b.shown(church.pub).length === 2, 8000), 'CONTROL: the notice never produced the two-key state this test starts from: ' + JSON.stringify(b.shown(church.pub)));
    const before = familyEvents(b).length;
    b.api._noteReseat(church.pub, reseatEvt(oldKid, newKid));   // the docs hub calls this when the re-seat document arrives
    assert.deepEqual(b.shown(church.pub), [newKid.pub], 'the re-seat arrived after the notice and the old key is still shown -- two children');
    assert.ok(familyEvents(b).length > before, 'the list changed but nothing told an open Family sheet to redraw');
  } finally { unsub(); b.close(); }
});

test('CONTROL: the re-seat first, the notice second: one child (this order already worked)', async () => {
  const parent = K(), oldKid = K(), newKid = K();
  await join(parent);
  const b = memberBoot(parent, memStorage(), { relays: [R.url], reseated: new Map() });
  b.api._noteReseat(church.pub, reseatEvt(oldKid, newKid));
  assert.equal((await publishTo(R.url, noticeEvt(church, parent, { church: church.pub, children: [oldKid.pub, newKid.pub] }, now() - 5)))[0], true);
  const unsub = b.api.subscribeGuardianNotices();
  try {
    assert.ok(await until(() => b.shown(church.pub).includes(newKid.pub), 8000), 'CONTROL: the new key never appeared');
    await sleep(300);
    assert.deepEqual(b.shown(church.pub), [newKid.pub]);
  } finally { unsub(); b.close(); }
});

test('a re-seat touches only the church that made it, and only the superseded key', async () => {
  const parent = K(), oldKid = K(), newKid = K(), sibling = K(), otherChurch = K();
  await join(parent);
  const store = memStorage();
  store.setItem('trinityone.family', JSON.stringify([
    { child: oldKid.pub, name: '', churchPub: church.pub, ts: 1, linked: true },
    { child: sibling.pub, name: '', churchPub: church.pub, ts: 1, linked: true },
    { child: oldKid.pub, name: '', churchPub: otherChurch.pub, ts: 1, linked: true },   // the same key, under ANOTHER church
  ]));
  const b = memberBoot(parent, store, { relays: [R.url], reseated: new Map() });
  b.api._noteReseat(church.pub, reseatEvt(oldKid, newKid));
  assert.deepEqual(b.shown(church.pub), [sibling.pub], 'the sibling was removed, or the superseded key was kept');
  assert.deepEqual(b.shown(otherChurch.pub), [oldKid.pub], 'another church’s entry was removed by this church’s re-seat');
  b.close();
});

test('the parent’s own still-live request for the OLD key is not added back by the rebuild', async () => {
  const parent = K(), oldKid = K(), newKid = K();
  await join(parent);
  assert.equal((await publishTo(R.url, reqEvt(church, parent, oldKid, now() - 50, true)))[0], true, 'fixture: the parent’s own request for the old key');
  const b = memberBoot(parent, memStorage(), { relays: [R.url], reseated: new Map() });
  try {
    b.api._noteReseat(church.pub, reseatEvt(oldKid, newKid));
    await b.api._rebuildFamily(church.pub);
    assert.ok(!b.shown(church.pub).includes(oldKid.pub), 'the rebuild brought the superseded child back as a "Waiting for steward to confirm" row');
  } finally { b.close(); }
});

test('CONTROL: without a re-seat the same live request IS rebuilt (so the test above can fail)', async () => {
  const parent = K(), kid = K();
  await join(parent);
  assert.equal((await publishTo(R.url, reqEvt(church, parent, kid, now() - 50, true)))[0], true);
  const b = memberBoot(parent, memStorage(), { relays: [R.url], reseated: new Map() });
  try {
    await b.api._rebuildFamily(church.pub);
    assert.ok(b.shown(church.pub).includes(kid.pub), 'CONTROL: the rebuild did not add an ordinary pending request -- the rig is wrong');
  } finally { b.close(); }
});
