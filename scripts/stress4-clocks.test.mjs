// STRESS BATCH 4 / B. CLOCKS - MEASUREMENT ONLY. Clock handling is a KNOWN PARKED item ("one universal fix later");
// this file records what a wrong clock does today against real gateways. Findings are marked todo and belong under
// "for the parked clock item". A box with a wrong clock is a real gateway preloaded with scripts/stress4-clock-shim.cjs;
// a phone with a wrong clock is an event/AUTH whose created_at is offset.  Run: node --test scripts/stress4-clocks.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { finalizeEvent } from 'nostr-tools/pure';
import { WebSocket } from 'ws';
import * as H from './relay-network-harness.mjs';

const M = (...a) => console.log('MEASURE', ...a);
const SHIM = join(import.meta.dirname, 'stress4-clock-shim.cjs');
const skewed = (sec) => ({ NODE_OPTIONS: '--require ' + SHIM, STRESS_CLOCK_SKEW_SEC: String(sec) });
const church = H.key();
const RELAYS = 'trinityone/relays', NET = 'trinityone/relay-net';
const now = () => Math.floor(Date.now() / 1000);
const sleep = H.sleep;
let S, T;
after(() => { H.stopAll(); setTimeout(() => process.exit(process.exitCode || 0), 2000).unref(); });
before(async () => {
  S = await H.startRelay({ name: 'S', churches: [church.pub] });
  T = await H.startRelay({ name: 'T', churches: [church.pub] });
  await H.publishAll(S, [H.relaysDoc(church, [S, T], now() - 3600)]); await H.publishAll(T, [H.relaysDoc(church, [S, T], now() - 3600)]);
  await H.publishAll(S, [H.churchDoc(church, 'trinityone/group:grp-x', { name: 'x' }, now() - 3600)]);
});

const pub1 = async (relay, e) => { const w = await H.connect(relay); try { return await H.publish(w, e); } finally { try { w.close(); } catch {} } };
const servedDoc = async (relay, d) => {
  const evs = await H.readAs(relay, { sk: church.sk, pub: church.pub }, { kinds: [30078], authors: [church.pub], '#d': [d] }, 700);
  return evs.sort((a, b) => b.created_at - a.created_at)[0] || null;
};

test('B1 a console whose clock is 10 minutes SLOW signs a newer relay list: the older correctly-timed one stays', { todo: `FINDING: a relay list signed by a console 10 min slow is refused ('newer version already stored') for 10 min - the steward's edit is lost until the clock is fixed` }, async () => {
  const fails = [];
  for (const d of [RELAYS, NET]) {
    const ent = (n) => [{ pubkey: S.relayPub, url: S.base }, { pubkey: T.relayPub, url: T.base }, ...Array.from({ length: n }, (_, i) => ({ pubkey: 'ab'.repeat(31) + '0' + i, url: 'http://x' + i }))];
    const l1 = H.churchDoc(church, d, ent(0), now() - 120);          // signed 2 min ago, correct clock: [S, T]
    assert.deepEqual(await pub1(S, l1), [true, ''], 'CONTROL: the correctly-timed list is accepted');
    const l2 = H.churchDoc(church, d, ent(1), now() - 600);          // the steward adds a box NOW, console clock 10 min slow
    const res = await pub1(S, l2);
    const served = await servedDoc(S, d);
    const gotNew = served && served.id === l2.id;
    M('B1', d, 'slow-console list publish result:', JSON.stringify(res), '| S serves the', gotNew ? 'NEW (added-box)' : 'OLD (without the added box)', 'list; created_at gap vs old', l2.created_at - l1.created_at, 's');
    const l3 = H.churchDoc(church, d, ent(1), now());                // the same edit again with a corrected clock
    assert.equal((await pub1(S, l3))[0], true, 'CONTROL: re-publishing with a right clock is accepted');
    assert.equal((await servedDoc(S, d)).id, l3.id, 'CONTROL: and then it is the one served');
    fails.push(gotNew ? null : `${d}: ${JSON.stringify(res)}`);
  }
  assert.deepEqual(fails.filter(Boolean), [], 'the steward\'s NEWER edit was refused because the console clock is slow');
});

test('B2 NIP-42 AUTH and EVENT from a phone 10 min fast / 10 min slow / 2 h fast', { todo: 'parked clock item - a phone 10 min fast or slow fails AUTH (600 s window) and cannot read its own DMs while its writes succeed. VISIBILITY of this is now proved in a-wrong-clock-is-visible.test.mjs; the behaviour itself is not corrected' }, async () => {
  const out = {};
  const peer = H.key();
  const joinDoc = (k) => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', 'trinityone/member:' + church.pub], ['t', 'trinityone'], ['p', church.pub]], content: JSON.stringify({ joined: now(), seen: now(), hb: 1 }) }, k.sk);
  await pub1(S, joinDoc(peer));
  for (const [label, off] of [['right', 0], ['+9m', 540], ['+10m', 600], ['-10m', -600], ['+2h', 7200]]) {
    const who = H.key();
    assert.equal((await pub1(S, joinDoc(who)))[0], true, 'CONTROL: the member joined');
    const dm = finalizeEvent({ kind: 4, created_at: now(), tags: [['p', who.pub]], content: 'sealed?iv=AAAA' + label }, peer.sk);
    assert.equal((await pub1(S, dm))[0], true, 'CONTROL: the DM to this phone is stored');
    const w = await H.connect(S); const frames = []; let gotDm = false;
    w.on('message', (d) => { const m = JSON.parse(d); frames.push(m[0] + (m[0] === 'OK' ? ':' + m[2] : ''));
      if (m[0] === 'EVENT' && m[2].id === dm.id) gotDm = true;
      if (m[0] === 'AUTH') w.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now() + off, tags: [['relay', S.wsUrl], ['challenge', m[1]]], content: '' }, who.sk)])); });
    w.send(JSON.stringify(['REQ', 's', { kinds: [4], '#p': [who.pub] }]));
    await sleep(1500);
    try { w.close(); } catch {}
    const ev = finalizeEvent({ kind: 1, created_at: now() + off, tags: [['t', 'trinityone'], ['t', 'grp-x']], content: 'hi' }, who.sk);
    const r = await pub1(S, ev).catch((e) => ['err', e.message]);
    out[label] = { ownDmDelivered: gotDm, authFrames: frames.join(','), event: r };
  }
  M('B2', JSON.stringify(out));
  assert.equal(out.right.ownDmDelivered, true, 'CONTROL: a right-clock phone reads its own DM');
  assert.equal(out.right.event[0], true, 'CONTROL: a right-clock event is accepted: ' + JSON.stringify(out.right.event));
  const bad = ['+10m', '-10m'].filter(k => !out[k].ownDmDelivered);
  assert.deepEqual(bad, [], 'a phone whose clock is 10 min off cannot read its own messages (AUTH window is 600 s)');
});

test('B3 replaceable docs: a phone with a fast/slow clock edits, then a right-clock edit follows; who wins on S and on T', { todo: `FINDING: a +10 min fast phone's older edit pins the doc for 10 min (right-clock edit refused); a -10 min phone's new edit is refused` }, async () => {
  const results = [];
  for (const [label, off] of [['+10m fast then right', 600], ['+2h fast then right', 7200], ['right then -10m slow', -600]]) {
    const ph = H.key();
    const prof = (c, at) => finalizeEvent({ kind: 0, created_at: at, tags: [], content: JSON.stringify({ name: c }) }, ph.sk);
    const join = (c, at) => finalizeEvent({ kind: 30078, created_at: at, tags: [['d', 'trinityone/member:' + church.pub], ['t', 'trinityone'], ['p', church.pub]], content: JSON.stringify({ joined: at, seen: at, hb: 1, who: c }) }, ph.sk);
    const first = off > 0 ? 'fast' : 'right', second = off > 0 ? 'right' : 'slow';
    const at1 = off > 0 ? now() + off : now() - 5, at2 = off > 0 ? now() + 1 : now() + off;
    const rP1 = await pub1(S, prof(first, at1)), rJ1 = await pub1(S, join(first, at1));
    await sleep(1100);
    const rP2 = await pub1(S, prof(second, at2)), rJ2 = await pub1(S, join(second, at2));
    await H.syncNow(T).catch(() => {}); await sleep(300);
    const read = async (r, filter) => (await H.readAs(r, ph, filter, 600)).sort((a, b) => b.created_at - a.created_at);
    const sP = (await read(S, { kinds: [0], authors: [ph.pub] }))[0], tP = (await read(T, { kinds: [0], authors: [ph.pub] }))[0];
    const sJ = (await read(S, { kinds: [30078], authors: [ph.pub], '#d': ['trinityone/member:' + church.pub] }))[0], tJ = (await read(T, { kinds: [30078], authors: [ph.pub], '#d': ['trinityone/member:' + church.pub] }))[0];
    const nm = (e) => e ? (e.kind === 0 ? JSON.parse(e.content).name : JSON.parse(e.content).who) : '(none)';
    results.push({ label, firstOK: [rP1, rJ1], secondOK: [rP2, rJ2], profileOnS: nm(sP), profileOnT: nm(tP), joinOnS: nm(sJ), joinOnT: nm(tJ), want: 'second-edit (' + second + ')' });
  }
  for (const r of results) M('B3', JSON.stringify(r));
  const bad = results.filter(r => r.profileOnS !== (r.label.endsWith('slow') ? 'slow' : 'right'));
  assert.deepEqual(bad.map(b => b.label), [], 'the last edit the person made is not the one a relay serves');
});

test('B4 sync cursors: an event stamped 14 min in the future moves the cursor past correct-clock events that arrive later', { todo: 'FINDING: a +14 min event advances the sync cursor; a correct-clock event after it is not carried by the next pass (arrived ~17 s later via reconcile)' }, async () => {
  const s = await H.startRelay({ name: 'cS', churches: [church.pub] }), t = await H.startRelay({ name: 'cT', churches: [church.pub] });
  const list = H.relaysDoc(church, [s, t], now()); await H.publishAll(s, [list]); await H.publishAll(t, [list]);
  const doc = (n, at) => H.churchDoc(church, 'trinityone/notice:c' + n, { n }, at);
  await H.publishAll(s, [doc(1, now() - 60)]);
  await H.syncNow(t); await sleep(300);
  assert.ok((await H.corpusIds(t, church)).size >= 2, 'CONTROL: first sync carried the first notice');
  await H.publishAll(s, [doc(2, now() + 840)]);                         // a phone 14 min fast (inside the relay\'s 15 min tolerance)
  await H.syncNow(t); await sleep(300);
  const e3 = doc(3, now());                                             // a correct-clock phone, a moment later
  await H.publishAll(s, [e3]);
  const t0 = Date.now();
  await H.syncNow(t); await sleep(300);
  const immediate = (await H.corpusIds(t, church)).has(e3.id);
  // control: with NO future event the same pass carries a newly-published event (done on a clean pair below)
  let whenMs = immediate ? 0 : null;
  if (!immediate) { await sleep(16000); await H.syncNow(t); await sleep(300); if ((await H.corpusIds(t, church)).has(e3.id)) whenMs = Date.now() - t0; }
  M('B4 correct-clock event after a +14m event: carried by the very next pass?', immediate, '| carried once S\'s 15 s digest cache expired (ms after publish)?', whenMs);
  const s2 = await H.startRelay({ name: 'kS', churches: [church.pub] }), t2 = await H.startRelay({ name: 'kT', churches: [church.pub] });
  const l2 = H.relaysDoc(church, [s2, t2], now()); await H.publishAll(s2, [l2]); await H.publishAll(t2, [l2]);
  await H.publishAll(s2, [doc(11, now() - 60)]); await H.syncNow(t2); await sleep(300);
  const c3 = doc(13, now()); await H.publishAll(s2, [c3]); await H.syncNow(t2); await sleep(300);
  assert.equal((await H.corpusIds(t2, church)).has(c3.id), true, 'CONTROL: with no future-dated event the next pass carries a new event');
  assert.equal(immediate, true, 'a future-dated event hid a newer-in-time event from the next sync pass (cursor ran ahead)');
});

test('B5 NIP-98 relay proof (+-300 s): a box 4 min off syncs, a box 6 min off (fast and slow) silently does not', { todo: 'parked clock item - a box 6 min off syncs in neither direction (and 401s its own church key). VISIBILITY is now proved in a-wrong-clock-is-visible.test.mjs; the behaviour itself is not corrected' }, async () => {
  const out = {};
  const readRows = async (r, id) => { const { DatabaseSync } = await import('node:sqlite'); const db = new DatabaseSync(join(r.dataDir, 'relay.sqlite'), { readOnly: true }); try { return !!db.prepare('SELECT 1 FROM events WHERE id=?').get(id); } finally { db.close(); } };
  for (const [label, skew] of [['+4m', 240], ['-4m', -240], ['+6m', 360], ['-6m', -360]]) {
    const s = await H.startRelay({ name: 'nS' + label, churches: [church.pub] });
    const t = await H.startRelay({ name: 'nT' + label, churches: [church.pub], env: skewed(skew) });
    const list = H.relaysDoc(church, [s, t], now()); await H.publishAll(s, [list]); await H.publishAll(t, [list]);
    const onS = H.churchDoc(church, 'trinityone/notice:fromS', { a: 1 }, now() - 30), onT = H.churchDoc(church, 'trinityone/notice:fromT', { a: 2 }, now() - 30);
    await H.publishAll(s, [onS]); await H.publishAll(t, [onT]);
    const r1 = await H.syncNow(t).catch((e) => ({ err: e.message })); const r2 = await H.syncNow(s).catch((e) => ({ err: e.message })); await sleep(400);
    const has = async (r, id) => { try { return (await H.corpusIds(r, church)).has(id); } catch (e) { return 'unreadable: ' + e.message; } };
    const tHasS = await has(t, onS.id), sHasT = await has(s, onT.id);
    const rd = await readRows(t, onS.id);
    const st = await t.status();
    const logs = t.log.filter(l => /sync|401|unauthor/i.test(l)).slice(-4);
    out[label] = { skewedBoxPulled: tHasS === true || rd, healthyBoxPulledFromSkewed: sHasT === true, ownerProofToSkewedBox: tHasS, syncNowReply: r1, statusSync: st.sync, logLines: logs.length };
  }
  M('B5', JSON.stringify(out));
  assert.equal(out['+4m'].skewedBoxPulled && out['+4m'].healthyBoxPulledFromSkewed, true, 'CONTROL: 4 min off still syncs both ways');
  assert.equal(out['-4m'].skewedBoxPulled && out['-4m'].healthyBoxPulledFromSkewed, true, 'CONTROL: -4 min off still syncs both ways');
  for (const k of ['+6m', '-6m']) assert.equal(out[k].skewedBoxPulled || out[k].healthyBoxPulledFromSkewed, true, `a box ${k} off syncs in neither direction`);
});
