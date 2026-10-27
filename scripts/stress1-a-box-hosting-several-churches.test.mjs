// STRESS BATCH 1 / AREA A, RELAY SIDE: one own box H hosts churches A and C; shared server S hosts A, B, C.
// Real `node scripts/gateway.mjs` relays driven through the harness. Run:
//   flock /tmp/claude-1000/selfhost-tests.lock node --test scripts/stress1-a-box-hosting-several-churches.test.mjs
//
// Attacks: (1) H syncing A and C from S keeps each church's data separate and never takes B's;
// (2) deprovisioning C from H (purge) leaves A intact, including a member who is in both;
// (3) a church D that H never agreed to host names H in its signed list - D's members' traffic must NOT be stored;
// CONTROL for (3): with "Offer to host other churches" ON, D really is stored, so the refusal is not a dead route.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { finalizeEvent } from 'nostr-tools/pure';
import * as H from './relay-network-harness.mjs';

const now = H.now;
const join = (who, cp) => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', 'trinityone/member:' + cp], ['t', 'trinityone'], ['church', cp]], content: '{}' }, who.sk);
const post = (who, cp, gid, text, at) => finalizeEvent({ kind: 1, created_at: at || now(), tags: [['t', 'trinityone'], ['t', gid], ['p', cp]], content: text }, who.sk);

let A, B, C, D, S, HB, mAC, mB, mD;
const notices = {};   // church pub -> ids published
before(async () => {
  A = H.key(); B = H.key(); C = H.key(); D = H.key();
  mAC = H.key(); mB = H.key(); mD = H.key();
  S = await H.startRelay({ name: 'S', churches: [A.pub, B.pub, C.pub] });
  HB = await H.startRelay({ name: 'H', churches: [A.pub, C.pub] });   // the church's own box; offerHosting is OFF by default
  // each church's signed relay list: A and C name S and H; B names S only
  const list = (ch, rs) => H.relaysDoc(ch, rs);
  const docs = { [A.pub]: list(A, [S, HB]), [B.pub]: list(B, [S]), [C.pub]: list(C, [S, HB]) };
  for (const ch of [A, B, C]) {
    await H.publishAll(S, [docs[ch.pub]]);
    if (ch !== B) await H.publishAll(HB, [docs[ch.pub]]);
  }
  // data lives on S first; H must PULL it
  for (const [ch, tag] of [[A, 'a'], [B, 'b'], [C, 'c']]) {
    notices[ch.pub] = await H.publishAll(S, [1, 2, 3].map(n => H.churchDoc(ch, `trinityone/notice:${tag}${n}`, { text: `${tag} ${n}` })));
  }
  await H.publishAll(S, [join(mAC, A.pub), join(mAC, C.pub), join(mB, B.pub),
    post(mAC, A.pub, 'room-a', 'a post by the A+C member'), post(mAC, C.pub, 'room-c', 'c post by the A+C member'), post(mB, B.pub, 'room-b', 'b post')]);
});
after(() => { H.stopAll(); setTimeout(() => process.exit(process.exitCode || 0), 2000).unref(); });

const idsOf = async (r, ch) => { try { return await H.corpusIds(r, ch); } catch (e) { return e; } };

test('H pulls A and C from S and holds each church\'s data; CONTROL: S really holds all three', async () => {
  assert.notEqual(S.relayPub, HB.relayPub);
  for (const ch of [A, B, C]) assert.ok((await H.corpusIds(S, ch)).size >= 4, 'staging fault: S lacks data of a church');
  await H.waitForConvergence([S, HB], A, { timeout: 30000 });
  await H.waitForConvergence([S, HB], C, { timeout: 30000 });
  for (const ch of [A, C]) {
    const onS = await H.corpusIds(S, ch), onH = await H.corpusIds(HB, ch);
    assert.deepEqual([...onH].sort(), [...onS].sort(), 'H does not hold exactly what S holds for a hosted church');
    for (const id of notices[ch.pub]) assert.ok(onH.has(id));
  }
});

test('H holds NOTHING of church B (no id of B anywhere on H), while S does', async () => {
  const bOnS = await H.corpusIds(S, B);
  assert.ok(bOnS.size >= 4);
  // the church-key /sync route for B on H must refuse (B is not a church H carries)
  const url = `${HB.base}/sync?church=${B.pub}&since=0`;
  const r = await fetch(url, { headers: { Authorization: H.nip98(B.sk, url, 'GET', B.pub) } });
  const body = r.status === 200 ? (await r.text()).trim() : '';
  assert.ok(r.status >= 400 || body === '', 'H served B\'s data on /sync: ' + r.status + ' ' + body.length + ' bytes');
  // and no id of B is readable on H by any route we can reach: ask as B's own key for everything B authored or tagged
  const seen = await H.readAs(HB, B, { kinds: [1, 4, 7, 30078], limit: 500 });
  const bIds = new Set([...bOnS]);
  assert.deepEqual(seen.filter(e => bIds.has(e.id)).map(e => e.id), [], 'B\'s documents are readable on H');
  const st = await HB.status();
  assert.ok(JSON.stringify(st).length > 0);
});

test('a church\'s data on H carries the right label: A\'s /export on H has no C row and vice versa', async () => {
  for (const [mine, other] of [[A, C], [C, A]]) {
    const url = `${HB.base}/export?church=${mine.pub}`;
    const r = await fetch(url, { headers: { Authorization: H.nip98(mine.sk, url, 'GET', mine.pub) } });
    assert.equal(r.status, 200, '/export refused the church\'s own key: ' + r.status);
    const rows = (await r.text()).split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    assert.ok(rows.length >= 4, 'export is empty - the control failed');
    const theirs = new Set((await H.corpus(S, other)).map(e => e.id));
    const leaked = rows.filter(e => theirs.has(e.id) && !(e.tags || []).some(t => t[1] === mine.pub || (t[1] || '').endsWith(mine.pub)) && e.pubkey !== mine.pub);
    // A row that is in the OTHER church's S-corpus and not marked as ours. The A+C member's join docs are per church.
    const aux = leaked.filter(e => e.pubkey === other.pub || String((e.tags.find(t => t[0] === 'd') || [])[1] || '').endsWith(other.pub));
    assert.deepEqual(aux.map(e => e.id), [], `${mine.pub.slice(0, 6)}'s export on H carries ${aux.length} rows of the other hosted church`);
  }
});

// ── deprovision C ──
test('removing (purging) C from H leaves A byte-for-byte intact, including the member who is in both', async () => {
  const aBefore = [...await H.corpusIds(HB, A)].sort();
  const cBefore = await H.corpusIds(HB, C);
  assert.ok(aBefore.length >= 4 && cBefore.size >= 4, 'staging fault');
  const rem = await fetch(`${HB.base}/config`, { method: 'POST', headers: { Authorization: 'Bearer ' + HB.adminToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ removeChurch: { npub: (await import('nostr-tools/nip19')).npubEncode(C.pub), confirm: true, purge: true } }) });
  const body = await rem.json().catch(() => ({}));
  assert.equal(rem.status, 200, 'removeChurch failed: ' + JSON.stringify(body));
  assert.ok(body.purged && body.purged.events > 0, 'nothing purged - control failed ' + JSON.stringify(body));
  const aAfter = [...await H.corpusIds(HB, A)].sort();
  const lostFromA = aBefore.filter(id => !aAfter.includes(id));
  assert.deepEqual(lostFromA, [], 'purging C deleted ' + lostFromA.length + ' rows that belong to A');
  const cAfter = await idsOf(HB, C);
  assert.ok(cAfter instanceof Error || cAfter.size === 0, 'C is still readable on H after purge');
});

test('after C is purged, H does not quietly pull C back from S on the next sync', async () => {
  await H.syncNow(HB);
  await H.syncNow(HB);
  const c = await idsOf(HB, C);
  assert.ok(c instanceof Error || c.size === 0, 'H re-imported the church it was told to drop: ' + (c.size));
  // CONTROL: A still syncs
  const extra = H.churchDoc(A, 'trinityone/notice:after-purge', { text: 'new' });
  await H.publishAll(S, [extra]);
  await H.waitFor(async () => { await H.syncNow(HB); return (await H.corpusIds(HB, A)).has(extra.id); }, { label: 'A still syncs to H after C was removed' });
});

// ── church D, which H never agreed to host ──
test('church D names H in its signed list: D\'s members\' traffic is NOT stored on H (offer-to-host is OFF)', async () => {
  const dNotice = H.churchDoc(D, 'trinityone/notice:d1', { text: 'd' });
  const dJoin = join(mD, D.pub);
  const dPost = post(mD, D.pub, 'room-d', 'hello from D');
  const dList = H.relaysDoc(D, [S, HB]);
  // D is not on S either in this test (S carries A,B,C) - so give D every possible route onto H:
  // (a) members/console write straight at H
  const w = await H.connect(HB);
  const results = {};
  try {
    for (const [k, e] of Object.entries({ dList, dNotice, dJoin, dPost })) { try { results[k] = await H.publish(w, e); } catch (x) { results[k] = [false, 'noOK ' + x.message]; } }
  } finally { try { w.close(); } catch {} }
  // (b) D's console self-registers
  const url = `${HB.base}/config`;
  const reg = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ addChurch: { npub: (await import('nostr-tools/nip19')).npubEncode(D.pub), name: 'Church D' }, auth: JSON.parse(Buffer.from(H.nip98(D.sk, url, 'POST', D.pub).slice(6), 'base64').toString()) }) });
  // (c) H runs a pass and could pull D from anything it knows
  await H.syncNow(HB);
  const stored = [dList.id, dNotice.id, dJoin.id, dPost.id];
  const seenOnH = await H.readAs(HB, mD, { ids: stored });
  const accepted = Object.entries(results).filter(([, v]) => v[0]).map(([k]) => k);
  const held = await idsOf(HB, D);
  const detail = `register=${reg.status} accepted=${JSON.stringify(accepted)} readable=${seenOnH.length} held=${held instanceof Error ? 'n/a(' + held.message.slice(0, 40) + ')' : held.size}`;
  assert.equal(reg.status, 403, 'D registered itself on a box that does not offer hosting: ' + detail);
  assert.deepEqual(accepted, [], 'H accepted writes from a church it never agreed to host: ' + detail);
  assert.equal(seenOnH.length, 0, 'D\'s documents are readable on H: ' + detail);
});

test('CONTROL: with "Offer to host other churches" ON, the same D registers and its traffic IS stored (so the refusal above is a decision)', async () => {
  const r = await fetch(`${HB.base}/settings`, { method: 'POST', headers: { Authorization: 'Bearer ' + HB.adminToken, 'Content-Type': 'application/json' }, body: JSON.stringify({ offerHosting: true }) });
  const j = await r.json();
  assert.equal(j.settings && j.settings.offerHosting, true, 'could not switch the offer on');
  const url = `${HB.base}/config`;
  const reg = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ addChurch: { npub: (await import('nostr-tools/nip19')).npubEncode(D.pub), name: 'Church D' }, auth: JSON.parse(Buffer.from(H.nip98(D.sk, url, 'POST', D.pub).slice(6), 'base64').toString()) }) });
  assert.equal(reg.status, 200, 'with the offer on, D could not register: ' + reg.status);
  const e = post(mD, D.pub, 'room-d', 'now it should store');
  await H.publishAll(HB, [join(mD, D.pub), e]);
  assert.ok((await H.readAs(HB, mD, { ids: [e.id] })).length >= 1, 'control: even with the offer on D\'s post is not stored');
});

test('a restart of H does not re-register the purged church C from its CHURCH_NPUB seed (control: A is still served)', async () => {
  const moved = await H.moveRelay(HB);
  const cfg = await (await fetch(`${moved.base}/config`, { headers: { Authorization: 'Bearer ' + moved.adminToken } })).json();
  const npubs = (cfg.churches || []).map(c => c.npub);
  const nip19 = await import('nostr-tools/nip19');
  assert.ok(npubs.includes(nip19.npubEncode(A.pub)), 'control: A missing after restart ' + JSON.stringify(npubs));
  assert.ok(!npubs.includes(nip19.npubEncode(C.pub)), 'the purged church came back from the env seed on restart');
});
