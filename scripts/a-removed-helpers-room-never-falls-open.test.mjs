// A REMOVED HELPER'S ROOM NEVER FALLS OPEN (plan PLAN-removed-steward-fixes-F1-F4 §0e rev 8; owner answers w, y, aa, bb, cc).
//   Run: node --test scripts/a-removed-helpers-room-never-falls-open.test.mjs
//
// What a box decides about a group once one of its copies comes from a helper who has been removed (a VOID copy):
//   (bb) no valid copy at all       → the void copy's own settings (private stays private, open stays open), NEVER child-safe
//   (y)  a valid copy governs, older → the FLOOR: the tighter of the two (plan table), child-safe only if both
//   (aa) the church's kept copy, tagged ['kept', <that helper>], clears the floor even though the void copy is newer
//   (cc) a team list with no valid copy keeps the void copy's people
// The rule reads the stored SET at the address, so every case is checked in two arrival orders and again after the relay
// restarts over the same data (moveRelay — a new process, started after the last edit of gateway.mjs). Void copies come in
// through /import (the path, like peer reconcile, where accept() never runs) — the way a woken box receives them.
// Every helper save here is 12+ days old (the Fable re-audit: seconds-old fixtures hid the dating findings).
// Each decision is the relay's own: does it ACCEPT the person's post into the room (accept), and does it SERVE them the
// room's messages (canRead).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { finalizeEvent } from 'nostr-tools/pure';
import * as H from './relay-network-harness.mjs';

const NET = 'trinityone';
const MEMBER_D = 'trinityone/member:', GROUP_D = 'trinityone/group:', STEWARDS_D = 'trinityone/stewards:', MINORS_D = 'trinityone/minors:', ROSTER_D = 'trinityone/roster:';
const sleep = ms => new Promise(r => setTimeout(r, ms));
after(() => { H.stopAll(); setTimeout(() => process.exit(process.exitCode || 0), 1500).unref(); });
const OLD = Math.floor(Date.now() / 1000) - 12 * 86400;   // twelve days ago
let clock = OLD - 5000;
const doc = (who, d, content, { at, tags = [] } = {}) => finalizeEvent({ kind: 30078, created_at: at || ++clock, tags: [['d', d], ['t', NET], ...tags], content: typeof content === 'string' ? content : JSON.stringify(content) }, who.sk);
const put = async (relay, e) => { const s = await H.connect(relay); try { return await H.publish(s, e); } finally { try { s.close(); } catch {} } };
const must = async (relay, e) => { const [ok, why] = await put(relay, e); assert.equal(ok, true, 'fixture refused: ' + why); await sleep(40); return e; };
async function importAs(W, events) {
  const url = W.relay.base + '/import';
  const auth = 'Nostr ' + Buffer.from(JSON.stringify(finalizeEvent({ kind: 27235, created_at: Math.floor(Date.now() / 1000), content: '', tags: [['u', url], ['method', 'POST'], ['church', W.cp]] }, W.C.sk))).toString('base64');
  const r = await fetch(url, { method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/x-ndjson' }, body: events.map(e => JSON.stringify(e)).join('\n') });
  assert.equal(r.status, 200, 'import refused: ' + await r.text());
  await sleep(250);   // the replay after a roster change runs on the next tick
}
const chat = (who, gid) => finalizeEvent({ kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [['t', NET], ['t', gid]], content: 'hi ' + Math.random() }, who.sk);
const posts = async (relay, who, gid) => (await put(relay, chat(who, gid)))[0] === true;
const reads = async (relay, who, gid) => (await H.readAs(relay, who, { kinds: [1], '#t': [gid] }, 700)).length > 0;

// a church on one relay: two helpers (Hana, Gus) with content; a child; adults Ann, Ben, Cal
async function church(name, extra = {}) {
  const C = H.key(), hana = H.key(), gus = H.key(), child = H.key(), ann = H.key(), ben = H.key(), cal = H.key();
  let relay = await H.startRelay({ name, churches: [C.pub, ...(extra.cotenants || [])] });
  const roster = (pubs, at) => doc(C, STEWARDS_D + C.pub, { pubkeys: pubs, caps: Object.fromEntries(pubs.map(p => [p, ['content']])) }, { at });
  await must(relay, roster([hana.pub, gus.pub]));
  for (const m of [hana, gus, child, ann, ben, cal]) await must(relay, doc(m, MEMBER_D + C.pub, { joined: ++clock }));
  await must(relay, doc(C, MINORS_D + C.pub, { pubkeys: [child.pub] }));
  const W = { C, cp: C.pub, hana, gus, child, ann, ben, cal, roster,
    get relay() { return relay; }, async restart() { relay = await H.moveRelay(relay); await sleep(300); } };
  // a seed post so "is it served?" has something to serve
  return W;
}
const tag = (cp) => [['church', cp]];
// everyone's decision about the room, as one object: who may post, and whether an outsider is served it
async function decisions(W, gid) {
  const r = W.relay;
  return { ann: await posts(r, W.ann, gid), ben: await posts(r, W.ben, gid), cal: await posts(r, W.cal, gid), church: await posts(r, W.C, gid), child: await posts(r, W.child, gid) };
}
async function bothOrdersAndRestart(name, build, expect, label) {
  for (const order of ['valid-first', 'void-first']) {
    const W = await church(name + '-' + order);
    await build(W, order);
    const live = await decisions(W, build.gid(W));
    assert.deepEqual(live, expect, label + ' — ' + order + ', live');
    await W.restart();
    assert.deepEqual(await decisions(W, build.gid(W)), expect, label + ' — ' + order + ', after a restart');
  }
}

// ══ (bb): NO valid copy — the void copy's own settings, never child-safe ══════════════════════════════════════════════
test('(bb) — Hana’s invite-only room [Ann], no church copy, Hana removed: Ben is refused and NOT SERVED; Ann and the church post; a child is refused', async () => {
  const W = await church('bb-invite');
  const gid = W.cp.slice(0, 16) + '-hana';
  await must(W.relay, doc(W.hana, GROUP_D + gid, { name: 'Hana’s', visibility: 'invite', members: [W.ann.pub], childsafe: true }, { tags: tag(W.cp), at: OLD }));
  assert.ok(await posts(W.relay, W.ann, gid), 'FIXTURE: Ann cannot post while Hana is a helper');
  await must(W.relay, W.roster([W.gus.pub]));
  await sleep(250);
  for (const when of ['live', 'after a restart']) {
    assert.deepEqual(await decisions(W, gid), { ann: true, ben: false, cal: false, church: true, child: false }, 'REMOVAL CHANGED WHO MAY POST (' + when + ')');
    assert.equal(await reads(W.relay, W.ben, gid), false, 'THE ROOM IS SERVED TO A MEMBER WHO IS NOT ON ITS LIST (' + when + ') — finding 3');
    assert.equal(await reads(W.relay, W.ann, gid), true, 'CONTROL: Ann is not served her own room (' + when + ')');
    if (when === 'live') await W.restart();
  }
});
test('(bb) — Hana’s OPEN room marked child-safe, no church copy, Hana removed: adults post, a child is refused until the church saves it', async () => {
  const W = await church('bb-open');
  const gid = W.cp.slice(0, 16) + '-open';
  await must(W.relay, doc(W.hana, GROUP_D + gid, { name: 'Open', childsafe: true }, { tags: tag(W.cp), at: OLD }));
  assert.ok(await posts(W.relay, W.child, gid), 'FIXTURE: the room was child-safe while Hana was a helper');
  await must(W.relay, W.roster([W.gus.pub]));
  await sleep(250);
  assert.deepEqual(await decisions(W, gid), { ann: true, ben: true, cal: true, church: true, child: false });
  await W.restart();
  assert.deepEqual(await decisions(W, gid), { ann: true, ben: true, cal: true, church: true, child: false }, 'after a restart');
  await must(W.relay, doc(W.C, GROUP_D + gid, { name: 'Open', childsafe: true }));   // the church saves it
  assert.equal(await posts(W.relay, W.child, gid), true, 'the church’s own save did not make it child-safe again');
});

// ══ (y): the floor — every pair the plan's table names, two arrival orders, live and after restart ════════════════════
// C = the church's older copy (valid), V = Hana's newer copy (void once she is removed). Ann is on both lists, Ben only
// on V's, Cal only on C's. For 'team', the team's roster names Ann and Cal.
const vis = (kind, members) => kind === 'invite' ? { visibility: 'invite', members } : kind === 'team' ? { kind: 'team' } : kind === 'gone' ? null : {};
function floorBuild(vKind, cKind) {
  const f = async (W, order) => {
    const gid = f.gid(W);
    if (vKind === 'team' || cKind === 'team') await must(W.relay, doc(W.C, ROSTER_D + gid, { pubs: [W.ann.pub, W.cal.pub] }));
    const cBody = vis(cKind, [W.ann.pub, W.cal.pub]), vBody = vis(vKind, [W.ann.pub, W.ben.pub]);
    const C = doc(W.C, GROUP_D + gid, cBody ? { name: 'R', ...cBody } : '', { at: OLD - 100, tags: cBody ? [] : [['deleted', '1']] });
    const V = doc(W.hana, GROUP_D + gid, vBody ? { name: 'R', ...vBody } : '', { at: OLD, tags: vBody ? tag(W.cp) : [...tag(W.cp), ['deleted', '1']] });
    const removal = W.roster([W.gus.pub]);
    await importAs(W, order === 'valid-first' ? [C, removal, V] : [removal, V, C]);
  };
  f.gid = (W) => W.cp.slice(0, 16) + '-f';
  return f;
}
const cells = [
  ['invite', 'open',   { ann: true,  ben: true,  cal: false, church: true, child: false }, 'V invite × C open → invite V.m'],
  ['invite', 'invite', { ann: true,  ben: false, cal: false, church: true, child: false }, 'V invite × C invite → invite V.m ∩ C.m'],
  ['open',   'invite', { ann: true,  ben: false, cal: true,  church: true, child: false }, 'V open × C invite → invite C.m'],
  ['invite', 'team',   { ann: true,  ben: false, cal: false, church: true, child: false }, 'V invite × C team → invite V.m ∩ R'],
  ['team',   'open',   { ann: true,  ben: false, cal: true,  church: true, child: false }, 'V team × C open → team R'],
  ['gone',   'open',   { ann: false, ben: false, cal: false, church: false, child: false }, 'V tombstone × C open → gone (the helper deleted it)'],
];
for (const [vk, ck, expect, label] of cells) {
  test('(y) floor — ' + label, () => bothOrdersAndRestart('floor-' + vk + '-' + ck, floorBuild(vk, ck), expect, label));
}

// ══ (aa): the church's kept copy clears the floor, even though the void copy is newer ═══════════════════════════════
function keptBuild({ keptFor = 'hana', keptBy = 'church' } = {}) {
  const f = async (W, order) => {
    const gid = f.gid(W);
    const C = doc(W.C, GROUP_D + gid, { name: 'R' }, { at: OLD - 100 });                                                         // open
    const V = doc(W.hana, GROUP_D + gid, { name: 'R', visibility: 'invite', members: [W.ann.pub] }, { at: OLD + 50, tags: tag(W.cp) });   // her unseen newer, tighter
    const kSigner = keptBy === 'church' ? W.C : W.gus;
    const K = doc(kSigner, GROUP_D + gid, { name: 'R kept', visibility: 'invite', members: [W.ann.pub, W.ben.pub] },
      { at: OLD + 1, tags: [...(keptBy === 'church' ? [] : tag(W.cp)), ['kept', W[keptFor].pub]] });
    const removal = W.roster([W.gus.pub]);
    await importAs(W, order === 'valid-first' ? [C, K, removal, V] : [removal, V, C, K]);
  };
  f.gid = (W) => W.cp.slice(0, 16) + '-k';
  return f;
}
test('(aa) — the church’s copy tagged kept-for-Hana governs although Hana’s void copy is newer (both orders, after restart)', () =>
  bothOrdersAndRestart('kept', keptBuild(), { ann: true, ben: true, cal: false, church: true, child: false }, 'kept copy governs'));
test('(aa) — a kept tag on a HELPER-signed copy counts for nothing: the floor stays', () =>
  bothOrdersAndRestart('kept-helper', keptBuild({ keptBy: 'gus' }), { ann: true, ben: false, cal: false, church: true, child: false }, 'helper-signed kept tag ignored'));
test('(aa) — a kept copy for ANOTHER helper does not clear Hana’s floor', () =>
  bothOrdersAndRestart('kept-other', keptBuild({ keptFor: 'gus' }), { ann: true, ben: false, cal: false, church: true, child: false }, 'kept for Gus does not clear Hana’s floor'));

// ══ ownership: a void claim never blocks a valid copy (N7), and never reaches another church's room (finding 9) ══════
test('N7 — a void copy claims an id first; the church’s own valid copy then takes it back and governs', async () => {
  const W = await church('n7');
  const gid = W.cp.slice(0, 16) + '-n7';
  await must(W.relay, W.roster([W.gus.pub]));
  await importAs(W, [doc(W.hana, GROUP_D + gid, { name: 'R', visibility: 'invite', members: [W.ann.pub] }, { at: OLD, tags: tag(W.cp) })]);
  assert.equal(await posts(W.relay, W.ben, gid), false, 'FIXTURE: the void copy did not define the room');
  await must(W.relay, doc(W.C, GROUP_D + gid, { name: 'R' }, { at: OLD + 10 }));   // newer than the void copy, open, through the front door
  assert.equal(await posts(W.relay, W.ben, gid), true, 'THE VOID CLAIM BLOCKED THE CHURCH’S OWN COPY');
});
test('co-tenant — church Z’s room is untouched by a void copy tagged for church X', async () => {
  const Z = H.key();
  const W = await church('cotenant-void', { cotenants: [Z.pub] });
  const zMember = H.key();
  await must(W.relay, doc(zMember, MEMBER_D + Z.pub, { joined: ++clock }));
  const gid = 'zroom-shared';
  await must(W.relay, doc(Z, GROUP_D + gid, { name: 'Z room' }));
  assert.ok(await posts(W.relay, zMember, gid), 'FIXTURE: Z’s member cannot post in Z’s room');
  await must(W.relay, W.roster([W.gus.pub]));
  await importAs(W, [doc(W.hana, GROUP_D + gid, { name: 'X', visibility: 'invite', members: [W.ann.pub] }, { at: OLD + 5000, tags: tag(W.cp) })]);
  assert.ok(await posts(W.relay, zMember, gid), 'A VOID COPY TAGGED FOR ANOTHER CHURCH CHANGED Z’S ROOM');
  await W.restart();
  assert.ok(await posts(W.relay, zMember, gid), 'after a restart');
});

// ══ (cc): a team list with no valid copy keeps the void copy's people ═════════════════════════════════════════════════
test('(cc) — Hana’s team list [Ann], no church list, Hana removed: Ann still posts in the team room; Ben is refused — live and after restart', async () => {
  const W = await church('cc');
  const tid = W.cp.slice(0, 16) + '-team';
  await must(W.relay, doc(W.C, GROUP_D + tid, { name: 'Welcome', kind: 'team' }));
  await must(W.relay, doc(W.hana, ROSTER_D + tid, { pubs: [W.ann.pub] }, { tags: tag(W.cp), at: OLD }));
  await must(W.relay, W.roster([W.gus.pub]));
  await sleep(250);
  for (const when of ['live', 'after a restart']) {
    assert.equal(await posts(W.relay, W.ann, tid), true, 'THE TEAM ROOM STOPPED WORKING FOR ITS TEAM (' + when + ')');
    assert.equal(await posts(W.relay, W.ben, tid), false, 'someone not on the team posts (' + when + ')');
    if (when === 'live') await W.restart();
  }
});

// ══ re-add (item 5, N6): the re-derivation runs when a removed helper is added back ════════════════════════════════════
test('re-add — Hana floored, then re-added: her copy governs again; with the church’s S+1 kept copy present, that copy governs', async () => {
  for (const withKept of [false, true]) {
    const W = await church('readd-' + withKept);
    const gid = W.cp.slice(0, 16) + '-ra';
    // the floor (V ∩ C = Ann), Hana's own copy (Ann, Ben) and the kept copy (Cal) all give different answers
    const C = doc(W.C, GROUP_D + gid, { name: 'R', visibility: 'invite', members: [W.ann.pub, W.cal.pub] }, { at: OLD - 100 });
    const V = doc(W.hana, GROUP_D + gid, { name: 'R', visibility: 'invite', members: [W.ann.pub, W.ben.pub] }, { at: OLD, tags: tag(W.cp) });
    const evs = [C, W.roster([W.gus.pub]), V];
    if (withKept) evs.push(doc(W.C, GROUP_D + gid, { name: 'R kept', visibility: 'invite', members: [W.cal.pub] }, { at: OLD + 1, tags: [['kept', W.hana.pub]] }));
    await importAs(W, evs);
    await must(W.relay, W.roster([W.gus.pub, W.hana.pub]));   // Hana is added back
    await sleep(250);
    const expect = withKept ? { ann: false, ben: false, cal: true } : { ann: true, ben: true, cal: false };
    for (const when of ['live', 'after a restart']) {
      assert.deepEqual({ ann: await posts(W.relay, W.ann, gid), ben: await posts(W.relay, W.ben, gid), cal: await posts(W.relay, W.cal, gid) }, expect, (withKept ? 'kept copy present' : 'no kept copy') + ' (' + when + ')');
      if (when === 'live') await W.restart();
    }
  }
});

test('N7 — a void copy tagged for church X claims an id first; co-tenant church Z’s own copy is still accepted and governs', async () => {
  const Z = H.key();
  const W = await church('n7-cotenant', { cotenants: [Z.pub] });
  const zMember = H.key();
  await must(W.relay, doc(zMember, MEMBER_D + Z.pub, { joined: ++clock }));
  const gid = 'contested-id';
  await must(W.relay, W.roster([W.gus.pub]));
  await importAs(W, [doc(W.hana, GROUP_D + gid, { name: 'X void', visibility: 'invite', members: [W.ann.pub] }, { at: OLD, tags: tag(W.cp) })]);
  const [ok, why] = await put(W.relay, doc(Z, GROUP_D + gid, { name: 'Z room' }));
  assert.equal(ok, true, 'A VOID-ONLY CLAIM BLOCKED ANOTHER CHURCH’S VALID COPY AT THE DOOR: ' + why);
  assert.ok(await posts(W.relay, zMember, gid), 'Z’s member cannot post in Z’s room');
});
