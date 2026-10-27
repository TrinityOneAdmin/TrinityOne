// STRESS (batch 2, area A): A HOME BOX THAT KEEPS DISAPPEARING AND COMING BACK AT A NEW TUNNEL ADDRESS.
// One LONG-LIVED shipped member bundle (no relaunch between moves — a phone left open all day), real relays
// (scripts/relay-network-harness.mjs), the church re-signing its relay-net doc after every move.
// Run: flock /tmp/claude-1000/selfhost-tests.lock node --test scripts/a-box-that-keeps-moving-stress.test.mjs
// Findings are asserted CORRECT and marked { todo: 'FINDING: …' }.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { finalizeEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import * as H from './relay-network-harness.mjs';
import { memberOn, memStore, secure, sleep, RELAY_NET_D } from './stress2-member-lift.mjs';

const now = () => Math.floor(Date.now() / 1000);
let _at = now();
const relayNetDoc = (church, rows, at) => finalizeEvent(
  { kind: 30078, created_at: at || ++_at, tags: [['d', RELAY_NET_D], ['t', 'trinityone']], content: JSON.stringify(rows) }, church.sk);
const row = (r) => ({ pubkey: r.relayPub, alwaysOn: true, url: r.wsUrl });
const joinDoc = (who, cp) => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', 'trinityone/member:' + cp], ['t', 'trinityone'], ['church', cp]], content: '{}' }, who.sk);
const until = async (pred, label, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await pred()) return true; await sleep(150); } assert.fail('timed out: ' + label); };

// the same box, same data dir, DOWN (no restart) and then UP at a new port
const takeDown = (r) => { try { r.proc.kill('SIGKILL'); } catch {} };
let _gen = 0;
const bringUp = async (r) => {
  const u = await H.startRelay({ name: r.name.replace(/@\d+$/, '') + '@' + (++_gen), entry: r.entry, churches: r.churches, env: r.env, dataDir: r.dataDir });
  assert.equal(u.relayPub, r.relayPub, 'box came back with a different key');
  assert.notEqual(u.port, r.port, 'same port — nothing moved');
  return u;
};
const heldBy = async (relay, who, ids) => {
  const evs = await H.readAs(relay, who, { authors: [who.pub] }, 700);
  const have = new Set(evs.map(e => e.id));
  return ids.filter(i => have.has(i));
};

let church, S, TUN, ctl;
before(async () => {
  church = H.key(); church.npub = npubEncode(church.pub);
  S = await H.startRelay({ name: 'S', churches: [church.pub] });
  TUN = await H.startRelay({ name: 'TUN', churches: [church.pub] });
});
after(() => { try { ctl && ctl.close(); } catch {} H.stopAll(); try { setTimeout(() => process.exit(process.exitCode || 0), 8000).unref(); } catch {} });

const writes = (who, cp, tag) => {
  const t = now();
  return {
    group: finalizeEvent({ kind: 1, created_at: t, tags: [['t', 'trinityone'], ['t', 'g-' + tag], ['p', cp]], content: 'group ' + tag }, who.sk),
    care: finalizeEvent({ kind: 30078, created_at: t, tags: [['d', 'trinityone/carereq:' + who.pub.slice(0, 16) + '-' + tag], ['t', 'trinityone'], ['t', 'carereq'], ['church', cp]], content: '{"x":"' + tag + '"}' }, who.sk),
    dm: finalizeEvent({ kind: 4, created_at: t, tags: [['p', church.pub]], content: 'dm ' + tag }, who.sk),
  };
};

test('A1: one long-lived member follows a box through 6 moves; writes made while it is down', async () => {
  const pins = { [secure(S.wsUrl)]: [S.relayPub] };
  const store = memStore();
  ctl = memberOn({ church, relays: [secure(S.wsUrl)], canonical: [secure(S.wsUrl)], pins, store });
  const cp = church.pub;
  let box = TUN;
  const report = { moves: [], downWrites: [], leaks: [] };
  await H.publishAll(S, [relayNetDoc(church, [row(box)])]);
  await H.publishAll(S, [joinDoc(ctl.me, cp)]);
  await ctl.adopt(cp);
  assert.ok(ctl.relays().includes(box.wsUrl), 'staging: first adoption failed');
  await ctl.gate.refresh(ctl.churchRelaysRaw(), cp);
  await ctl.announce(cp);          // the shipped join, over the live publish set
  await until(async () => (await H.readAs(box, ctl.me, { authors: [ctl.me.pub], kinds: [30078] }, 500)).length > 0, 'join reaches the box');

  const missingFromBox = [];        // writes made while the box was down, that the box lacked right after it came back
  const lostAfterSync = [];         // ...and still lacked after a sync pass
  let dialled = new Set();
  for (let i = 1; i <= 6; i++) {
    // 1. a write while the box is UP — control: it must reach the box
    const up = writes(ctl.me, cp, 'up' + i);
    for (const e of Object.values(up)) await ctl.pub(cp, e).catch(() => {});
    const upIds = Object.values(up).map(e => e.id);
    await sleep(500);
    const upHeld = await heldBy(box, ctl.me, upIds);
    assert.equal(upHeld.length, upIds.length, `control (move ${i}): a write made while the box was UP did not reach it: ${upHeld.length}/${upIds.length}`);

    // 2. the box goes DOWN. The member keeps writing (this is the offline window).
    const oldAddr = box.wsUrl;
    takeDown(box);
    await sleep(300);
    const dn = writes(ctl.me, cp, 'dn' + i);
    const dnIds = Object.values(dn).map(e => e.id);
    for (const e of Object.values(dn)) await ctl.pub(cp, e).catch(() => {});
    const onS = await heldBy(S, ctl.me, dnIds);
    assert.equal(onS.length, dnIds.length, `control (move ${i}): writes made while the box was down did not even reach the shared server: ${onS.length}/${dnIds.length}`);

    // 3. the box returns at a NEW address, the church re-signs, the member's cache ages out (60 s TTL, simulated)
    box = await bringUp(box);
    await H.publishAll(S, [relayNetDoc(church, [row(box)])]);
    await H.publishAll(S, [H.relaysDoc(church, [S, box], ++_at)]);
    await H.publishAll(box, [H.relaysDoc(church, [S, box], _at)]);
    // BEFORE the cache ages out: what does the member do?
    const immediate = await ctl.adopt(cp);
    const staleWindow = !ctl.relays().includes(box.wsUrl);
    for (const c of ctl.netCache.values()) c.at -= 61000;
    await ctl.adopt(cp);
    await until(() => ctl.relays().includes(box.wsUrl), `move ${i}: member never adopted ${box.wsUrl}; relays=${JSON.stringify(ctl.relays())}`);
    await ctl.gate.refresh(ctl.churchRelaysRaw(), cp);

    // 4. bookkeeping: duplicates, old address
    const rec = JSON.parse(store.getItem('trinityone.relays.netdoc') || '{}')[cp] || { rows: {} };
    const boxes = JSON.parse(store.getItem('trinityone.churchboxes') || '{}')[cp] || [];
    const pubSet = ctl.publishSetFor(cp), readSet = ctl.relaysForChurch(cp);
    const listed = ctl.relays().filter(u => u !== secure(S.wsUrl));
    const m = { i, staleWindow, immediateAdded: immediate, list: listed.length, netdocRows: Object.keys(rec.rows).length,
                churchboxes: boxes.length, oldInList: ctl.relays().includes(oldAddr), oldInPub: pubSet.includes(oldAddr),
                oldInRead: readSet.includes(oldAddr), oldInRec: !!rec.rows[oldAddr], oldAdmitted: ctl.gate.admits(oldAddr, cp),
                oldSocket: !!(ctl.pool.relays && [...ctl.pool.relays.keys()].some(k => k.includes(':' + new URL(oldAddr.replace(/^ws/, 'http')).port + '/'))) };
    report.moves.push(m);
    for (const u of pubSet) dialled.add(u);

    // 5. the member's NEXT write reaches the box at its new address
    const nx = writes(ctl.me, cp, 'nx' + i);
    for (const e of Object.values(nx)) await ctl.pub(cp, e).catch(() => {});
    await sleep(400);
    const nxHeld = await heldBy(box, ctl.me, Object.values(nx).map(e => e.id));
    assert.equal(nxHeld.length, 3, `move ${i}: the member's next write (join/group/care/DM class) did not reach the box at its new address: ${nxHeld.length}/3`);

    // 6. the writes made WHILE DOWN: does the box have them with no help? then after a sync pass?
    const gotDirect = await heldBy(box, ctl.me, dnIds);
    for (const id of dnIds) if (!gotDirect.includes(id)) missingFromBox.push({ move: i, id: id.slice(0, 8) });
    try { await H.syncNow(box); } catch (e) { report.syncErr = String(e.message); }
    await sleep(500);
    const gotAfter = await heldBy(box, ctl.me, dnIds);
    for (const id of dnIds) if (!gotAfter.includes(id)) lostAfterSync.push({ move: i, id: id.slice(0, 8) });
    report.downWrites.push({ move: i, onS: onS.length, directToBox: gotDirect.length, afterSync: gotAfter.length });
  }

  // admission cache growth
  const ver = JSON.parse(store.getItem('trinityone.relays.verified') || '{}');
  const verKeys = Object.keys(ver);
  const urlRows = verKeys.filter(k => /^wss?:|^https?:|127\.0\.0\.1/.test(k));
  report.verified = { rows: verKeys.length, keys: verKeys.map(k => k.slice(0, 40)) };
  console.log('A1 REPORT ' + JSON.stringify(report, null, 1));

  // ---- assertions on the CORRECT behaviour ----
  for (const m of report.moves) {
    assert.equal(m.list, 1, `move ${m.i}: ${m.list} box entries in Fellowship.relays (dup/old kept)`);
    assert.equal(m.netdocRows, 1, `move ${m.i}: netdoc record holds ${m.netdocRows} rows`);
    assert.equal(m.oldInList || m.oldInPub || m.oldInRead || m.oldInRec, false, `move ${m.i}: old address still named: ${JSON.stringify(m)}`);
    assert.equal(m.oldAdmitted, false, `move ${m.i}: the gate still admits the dead address`);
  }
  assert.ok(verKeys.length <= 3, 'admission cache grew with churn: ' + verKeys.length + ' rows after 6 moves');
  // MEASURED, not a bug: right after the church re-signs, the member keeps the old doc for up to RELAY_NET_TTL_MS (60 s).
  assert.equal(report.moves.every(m => m.staleWindow), true, 'control: the cache window was exercised on every move');
});

test('A1b: writes made while the box was down reach S at once and the box only by a sync pass', async () => {
  // This is a separate assertion over data A1 gathered, re-measured here with ONE down/up cycle so it stands alone.
  const box0 = await H.startRelay({ name: 'W', churches: [church.pub] });
  const app = memberOn({ church, relays: [secure(S.wsUrl)], canonical: [secure(S.wsUrl)], pins: { [secure(S.wsUrl)]: [S.relayPub] } });
  try {
    await H.publishAll(S, [relayNetDoc(church, [row(box0)]), joinDoc(app.me, church.pub)]);
    await app.adopt(church.pub); await app.gate.refresh(app.churchRelaysRaw(), church.pub);
    takeDown(box0); await sleep(300);
    const w = writes(app.me, church.pub, 'solo');
    for (const e of Object.values(w)) await app.pub(church.pub, e).catch(() => {});
    const box1 = await bringUp(box0);
    await H.publishAll(S, [relayNetDoc(church, [row(box1)]), H.relaysDoc(church, [S, box1], ++_at)]);
    await H.publishAll(box1, [H.relaysDoc(church, [S, box1], _at)]);
    for (const c of app.netCache.values()) c.at -= 61000;
    await app.adopt(church.pub);
    await until(() => app.relays().includes(box1.wsUrl), 'adopt moved box');
    await sleep(3000);   // give the member's own re-send path time to act (join re-send on gained box)
    const ids = Object.values(w).map(e => e.id);
    const direct = (await heldBy(box1, app.me, ids)).length;
    await H.syncNow(box1); await sleep(600);
    const synced = (await heldBy(box1, app.me, ids)).length;
    console.log('A1b measured: written while down=3, reached S=' + (await heldBy(S, app.me, ids)).length + ', box direct=' + direct + ', box after one sync pass=' + synced);
    assert.equal(synced, 3, 'a write made while the box was down is still missing on the box after a sync pass: ' + synced + '/3');
  } finally { app.close(); }
});

// ── A2: flapping lists, out of order and tied ───────────────────────────────────────────────────────────
test('A2a: an OLDER list on a second shared server never beats the newest; and a later older copy is ignored by the high-water', async () => {
  const S1 = await H.startRelay({ name: 'S1', churches: [church.pub] });
  const S2 = await H.startRelay({ name: 'S2', churches: [church.pub] });
  const box1 = await H.startRelay({ name: 'F1', churches: [church.pub] });
  const dead2 = 'wss://127.0.0.1:9/relay';
  const pins = { [secure(S1.wsUrl)]: [S1.relayPub], [secure(S2.wsUrl)]: [S2.relayPub] };
  const canon = [secure(S1.wsUrl), secure(S2.wsUrl)];
  const t = now();
  const v2 = relayNetDoc(church, [{ pubkey: box1.relayPub, alwaysOn: true, url: 'ws://127.0.0.1:9/relay' }], t - 30);   // older: a dead address
  const v3 = relayNetDoc(church, [row(box1)], t);                                                                      // newest: the live one
  await H.publishAll(S2, [v2]);            // S2 only ever saw the older list
  await H.publishAll(S1, [v3]);
  // a relay refuses an older replaceable doc after a newer one: publish v2 to S1 AFTER v3
  const [ok2, msg2] = await H.publish(await H.connect(S1), v2);
  const app = memberOn({ church, relays: canon, canonical: canon, pins });
  try {
    await H.publishAll(S1, [joinDoc(app.me, church.pub)]); await H.publishAll(S2, [joinDoc(app.me, church.pub)]);
    await app.adopt(church.pub);
    assert.ok(app.relays().includes(box1.wsUrl), 'member did not settle on the newest list (v3): ' + JSON.stringify(app.relays()) + ' older-after-newer accepted by S1=' + ok2 + ' ' + msg2);
    const rec = (JSON.parse(app.store.getItem('trinityone.relays.netdoc') || '{}')[church.pub] || {});
    assert.equal(rec.hw, v3.created_at, 'high-water is not the newest doc');
    // now only S2 (the old list) answers: S1 down. The older copy must not change anything.
    try { S1.proc.kill('SIGKILL'); } catch {}
    await sleep(300);
    for (const c of app.netCache.values()) c.at -= 61000;
    const before = [...app.relays()];
    await app.adopt(church.pub);
    assert.deepEqual(app.relays(), before, 'an older list served by the only reachable server changed the member relay list');
    assert.equal(rec.hw, v3.created_at);
    console.log('A2a measured: S1 accepted an older replaceable doc after a newer one = ' + ok2 + ' (' + msg2 + ')');
  } finally { app.close(); }
});

test('A2b: two lists signed in the same second naming different addresses (v2 dead, v3 live), split across two servers: does the member settle on the live box, always?', async () => {
  const S1 = await H.startRelay({ name: 'T1', churches: [church.pub] });
  const S2 = await H.startRelay({ name: 'T2', churches: [church.pub] });
  const live = await H.startRelay({ name: 'LIVE', churches: [church.pub] });
  const pins = { [secure(S1.wsUrl)]: [S1.relayPub], [secure(S2.wsUrl)]: [S2.relayPub] };
  const canon = [secure(S1.wsUrl), secure(S2.wsUrl)];
  const t = now();
  // same created_at on purpose. The dead one is a DIFFERENT row (same key, old address).
  const old = relayNetDoc(church, [{ pubkey: live.relayPub, alwaysOn: true, url: 'ws://127.0.0.1:9/relay' }], t);
  const cur = relayNetDoc(church, [row(live)], t);
  await H.publishAll(S1, [cur]); await H.publishAll(S2, [old]);
  let landed = 0, stuck = 0; const N = 8; const trace = [];
  for (let k = 0; k < N; k++) {
    const app = memberOn({ church, relays: canon, canonical: canon, pins });
    try {
      await H.publishAll(S1, [joinDoc(app.me, church.pub)]); await H.publishAll(S2, [joinDoc(app.me, church.pub)]);
      await app.adopt(church.pub);
      let ok = app.relays().includes(live.wsUrl);
      // give the stalemate a chance to resolve: re-read twice with the cache aged out
      for (let r = 0; r < 2 && !ok; r++) { for (const c of app.netCache.values()) c.at -= 61000; await app.adopt(church.pub); ok = app.relays().includes(live.wsUrl); }
      if (ok) landed++; else stuck++;
      trace.push(ok ? 'live' : 'STUCK');
    } finally { app.close(); }
  }
  console.log('A2b measured: ' + landed + '/' + N + ' members settled on the live box; stuck on a dead address after 3 reads: ' + stuck + ' ' + JSON.stringify(trace));
  // THE PROPERTY IS DETERMINISM, NOT LUCK: on a created_at tie every member takes the lowest id (NIP-01, as the servers
  // do), whichever server answered first. So all N settle the same way, and the way is the one the ids predict. (Which
  // list wins is an accident of the two hashes; that the same list wins for everyone is the fix.)
  const expectLive = cur.id < old.id;
  assert.equal(landed, expectLive ? N : 0, 'members split or settled against the lowest-id rule: ' + landed + '/' + N + ' on the live box, expected ' + (expectLive ? N : 0) + ' (cur.id < old.id = ' + expectLive + ')');
});

// ── A3: what the RELAY still says about its old address after a move ───────────────────────────────────
test('A3: after a move, nothing on the box still vouches for the old address (identity proof, /status, NIP-11)', async () => {
  const OLD = 'wss://old-tunnel-aaa.example/relay', NEW = 'wss://new-tunnel-bbb.example/relay';
  let b = await H.startRelay({ name: 'D', churches: [church.pub], env: { RELAY_PUBLIC_URL: OLD } });
  const nonce = 'ab'.repeat(16);
  const prove = async (box, addr) => { const r = await fetch(`${box.base}/relay-identity?nonce=${nonce}&for=${encodeURIComponent(addr)}`); return r.status === 200 ? (await r.json()) : { status: r.status }; };
  const before = await prove(b, OLD);
  assert.ok(before && !before.status, 'control: the box should vouch for the address it was told it has: ' + JSON.stringify(before).slice(0, 120));
  takeDown(b);
  b = await bringUp({ ...b, env: { ...b.env, RELAY_PUBLIC_URL: NEW } });
  const newer = await prove(b, NEW);
  assert.ok(newer && !newer.status, 'control: the moved box vouches for its new address');
  const stale = await prove(b, OLD);
  const status = JSON.stringify(await b.status());
  const nip11 = await (await fetch(`${b.base}/`, { headers: { Accept: 'application/nostr+json' } })).text();
  console.log('A3 measured: old address proof after move = ' + JSON.stringify(stale).slice(0, 100) + '; /status mentions old=' + status.includes('old-tunnel') + '; NIP-11 mentions old=' + nip11.includes('old-tunnel'));
  assert.ok(stale.status, 'after the move the box still signs a proof for the OLD address');
  assert.equal(status.includes('old-tunnel') || nip11.includes('old-tunnel'), false, '/status or NIP-11 still names the old address');
});
