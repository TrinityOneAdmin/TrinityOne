// REMOVING A STEWARD KEEPS WHAT THEY SAVED — THE ENGINE, AGAINST REAL RELAYS.
//   Run: node --test scripts/removing-a-steward-keeps-what-they-saved.test.mjs
//
// Owner, 2026-11-17 (reference/DOMAIN.md, "REMOVING A STEWARD KEEPS WHAT THEY SAVED"): every church setting a removed
// steward was the last to change stays as they left it, re-saved under the church's own key. The plan
// (reference/PLAN-removed-steward-keeps-settings-2026-11-17.html, rev 2 + rev3 amendments) names the tests; this file
// holds the engine ones — T5, T6, T7, T9, the T10 companion, T11/R1, R2, the care-need re-mint and R3. The screen
// ones (T2, T3, T8, T10) are in removing-a-steward-keeps-what-they-saved-on-screen.test.mjs, and T1 is the prover,
// a-removed-stewards-settings-do-not-revert.test.mjs.
//
// HOW. Real gateways (relay-network-harness: a free port each, so nothing here collides with a concurrent suite). The
// console is the SHIPPED code lifted out of vendor/steward.js by scripts/steward-carry-rig.mjs — the carry, its
// template, the one-at-a-time removal, feChurch, setStewards, publishGroup, setNoPhoto. Only the transport is a stand-in:
// a websocket per relay signed in as the console's key, and publish() = one EVENT and the relay's OK.
//
// FIXTURE RULE (plan T6): the church's own copies are written UNTAGGED, exactly as the owner console writes them —
// a fixture that tagged them would hide the audit's H1 (a carry that cannot see the church's newer untagged edit).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { finalizeEvent } from 'nostr-tools/pure';
import { v2 as nip44 } from 'nostr-tools/nip44';
import * as H from './relay-network-harness.mjs';
import { DOC_TYPES } from './trinity-doc-types.mjs';
import { STEWARD, authedPool, consoleEngine } from './steward-carry-rig.mjs';
import { fnBody, stmt } from './test-slice.mjs';
import { readFileSync } from 'node:fs';

const NET = 'trinityone';
const STEWARDS_D = 'trinityone/stewards:', MEMBER_D = 'trinityone/member:', GROUP_D = 'trinityone/group:';
const NOPHOTO_D = 'trinityone/nophoto:', ADMITTED_D = 'trinityone/admitted:', NEED_D = 'trinityone/care:';
const FELLOWSHIP = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
const church = H.key();
const cp = church.pub;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const dOf = e => (e.tags.find(t => t[0] === 'd') || [])[1] || '';
let X;            // the church's relay
let w;            // a raw socket to X for fixture writes
let tick = Math.floor(Date.now() / 1000) - 3000;   // fixture clock: strictly increasing, comfortably in the past
const T = () => ++tick;

const raw = (who, d, content, { tags = [], at, tagChurch = true } = {}) => finalizeEvent({ kind: 30078, created_at: at || T(),
  tags: [['d', d], ['t', NET], ...(tagChurch ? [['church', cp]] : []), ...tags], content: typeof content === 'string' ? content : JSON.stringify(content) }, who.sk);
const put = async (e, relay = X) => { const s = await H.connect(relay); try { return await H.publish(s, e); } finally { try { s.close(); } catch {} } };
const mustPut = async (e, relay = X) => { const [ok, why] = await put(e, relay); assert.equal(ok, true, 'fixture write refused (' + dOf(e) + '): ' + why); return e; };

// the owner console (church key, actingChurch '') on relay `relay`
function owner(relay = X, extra = {}) {
  const pool = authedPool(church, STEWARDS_D + cp);
  const eng = consoleEngine({ signer: church, church: cp, actingChurch: '', relayUrl: relay.wsUrl, pool, publishTo: (e) => put(e, relay), extra });
  eng._pool = pool;
  return eng;
}
// the relay's current roster, as the console's own memory of it (what subscribeStewards would have set)
async function setRoster(eng, pubs, caps = {}) {
  const ok = await eng.setStewards(pubs, caps);
  assert.ok(ok, 'roster write refused: ' + eng.refused);
  eng._careRoster = new Set(pubs); eng._stewardCaps = { ...caps }; eng._careRosterKnown = true;
  await sleep(150);
}
// every copy the relay holds at d, read as the church key
const copiesAt = async (d, relay = X) => H.readAs(relay, church, { kinds: [30078], '#d': [d] }, 700);
const churchCopy = async (d, relay = X) => (await copiesAt(d, relay)).filter(e => e.pubkey === cp).sort((a, b) => b.created_at - a.created_at)[0] || null;
const churchSent = (eng, d) => eng.sent.filter(e => e.pubkey === cp && dOf(e) === d);
const newSteward = async () => { const s = H.key(); await mustPut(finalizeEvent({ kind: 30078, created_at: T(), tags: [['d', MEMBER_D + cp], ['t', NET]], content: JSON.stringify({ joined: T() }) }, s.sk)); return s; };

before(async () => {
  X = await H.startRelay({ name: 'carry-X', churches: [cp] });
  await mustPut(finalizeEvent({ kind: 0, created_at: T(), tags: [['t', NET]], content: JSON.stringify({ name: 'St Mary’s' }) }, church.sk));
});
after(() => { H.stopAll(); setTimeout(() => process.exit(process.exitCode || 0), 2000).unref(); });

// ══ T7: the allowlist names every type a steward can write ══════════════════════════════════════════════════════════
test('T7 — every steward- or mixed-writable document type is classified carry / re-mint / never, and every carried type is declared', () => {
  const C = new Function(stmt(STEWARD, 'var STEWARD_CARRY = ', 'STEWARD_CARRY') + '\nreturn STEWARD_CARRY;')();
  const all = [...C.carry, ...C.remint, ...C.never];
  const covered = (p) => all.some(x => p === x || p.startsWith(x));
  const missing = Object.entries(DOC_TYPES).filter(([, v]) => v.write === 'steward' || v.write === 'mixed').map(([p]) => p).filter(p => !covered(p));
  assert.deepEqual(missing, [], 'steward/mixed types the carry-over does not classify: ' + missing.join(', '));
  for (const p of [...C.carry, ...C.remint]) assert.ok(p in DOC_TYPES, p + ' is carried but is not a declared document type');
  for (const p of ['trinityone/admitted:', 'trinityone/clearance:', 'trinityone/safetycheck:', 'trinityone/groupkey:', 'finance/'])
    assert.ok(C.never.includes(p), p + ' must never be carried (plan §4)');
  assert.deepEqual([...C.remint], ['trinityone/care:'], 'care needs are carried with the skip part re-made (owner answer g)');
});

// ══ T9 (H1): the church's own newer, UNTAGGED edit wins — nothing of the steward's is re-signed over it ═══════════════
test('T9 — steward writes B, the church then writes C untagged: after Remove the relay shows C, and B was never re-signed', async () => {
  const eng = owner(); const dana = await newSteward();
  await setRoster(eng, [dana.pub], { [dana.pub]: ['content', 'safeguarding'] });
  const gid = cp.slice(0, 16) + '-t9';
  await mustPut(raw(dana, GROUP_D + gid, { name: 'B from the steward', leaders: [] }));
  await sleep(1100);
  assert.ok(await eng.publishGroup({ id: gid, name: 'C from the church' }), 'church group C: ' + eng.refused);   // the shipped owner write: UNTAGGED
  assert.equal(eng.sent.at(-1).tags.some(t => t[0] === 'church'), false, 'FIXTURE: the owner console tagged its copy, which would hide H1');
  // …and the photo list the same way: steward [ben], then the church [amy] through the shipped setNoPhoto
  const amy = H.key(), ben = H.key();
  await mustPut(raw(dana, NOPHOTO_D + cp, { pubkeys: [ben.pub] }));
  await sleep(1100);
  assert.ok(await eng.setNoPhoto([amy.pub]), 'church nophoto: ' + eng.refused);
  const sentBefore = eng.sent.length;
  const r = await eng._removeStewardKeeping(dana.pub);
  assert.ok(r.wrote, 'the roster write did not land');
  const resigned = eng.sent.slice(sentBefore).filter(e => e.pubkey === cp && dOf(e) !== STEWARDS_D + cp);
  assert.deepEqual(resigned.map(dOf), [], 'THE H1 CASE: the carry re-signed a steward copy OLDER than the church’s own edit');
  assert.equal(JSON.parse((await churchCopy(GROUP_D + gid)).content).name, 'C from the church');
  assert.deepEqual(JSON.parse((await churchCopy(NOPHOTO_D + cp)).content).pubkeys, [amy.pub]);
  assert.ok(r.carry.superseded.includes(GROUP_D + gid) && r.carry.superseded.includes(NOPHOTO_D + cp), 'superseded: ' + JSON.stringify(r.carry));
  assert.deepEqual(r.carry.notCarried, [], 'a document the church itself saved later is not something that "may change back"');
});

test('T9 — a steward tombstone followed by the church re-publishing: Remove does not withdraw the church’s live document', async () => {
  const eng = owner(); const dana = await newSteward();
  await setRoster(eng, [dana.pub], { [dana.pub]: ['content'] });
  const gid = cp.slice(0, 16) + '-t9tomb';
  await mustPut(raw(dana, GROUP_D + gid, '', { tags: [['deleted', '1'], ['for', cp]] }));
  await sleep(1100);
  assert.ok(await eng.publishGroup({ id: gid, name: 'Brought back by the church' }));
  const sentBefore = eng.sent.length;
  const r = await eng._removeStewardKeeping(dana.pub);
  assert.ok(r.wrote);
  assert.equal(eng.sent.slice(sentBefore).filter(e => dOf(e) === GROUP_D + gid).length, 0, 'the steward’s older tombstone was re-issued as the church’s for:* delete');
  const live = await churchCopy(GROUP_D + gid);
  assert.ok(live && live.content && !live.tags.some(t => t[0] === 'deleted'), 'the church’s live document was withdrawn');
});

test('T9 — a TIE (same created_at) is not carried, and is listed as not kept', async () => {
  const eng = owner(); const dana = await newSteward();
  await setRoster(eng, [dana.pub], { [dana.pub]: ['content'] });
  const gid = cp.slice(0, 16) + '-tie', at = T();
  await mustPut(raw(dana, GROUP_D + gid, { name: 'steward, same second' }, { at }));
  await mustPut(raw(church, GROUP_D + gid, { name: 'church, same second' }, { at, tagChurch: false }));
  const sentBefore = eng.sent.length;
  const r = await eng._removeStewardKeeping(dana.pub);
  assert.equal(eng.sent.slice(sentBefore).filter(e => dOf(e) === GROUP_D + gid).length, 0, 'a tie was carried');
  assert.deepEqual(r.carry.notCarried.filter(x => x.d === GROUP_D + gid).map(x => x.why), ['tie']);
});

// ══ T5: what the steward last saved survives Remove AND a relay restart; admitted: is never touched ═════════════════
let T5 = null;
test('T5 — a childsafe change and a steward tombstone survive Remove + relay restart; the church’s admitted list is untouched', async () => {
  const eng = owner(); const dana = await newSteward();
  await setRoster(eng, [dana.pub], { [dana.pub]: ['content', 'members'] });
  const gid = cp.slice(0, 16) + '-t5', gone = cp.slice(0, 16) + '-t5gone';
  await mustPut(raw(church, GROUP_D + gid, { name: 'Youth', kind: 'group', leaders: [] }, { tagChurch: false }));   // the church's earlier save: untagged
  await mustPut(raw(church, GROUP_D + gone, { name: 'Old room', kind: 'group', leaders: [] }, { tagChurch: false }));
  const x = H.key(), y = H.key();
  await mustPut(raw(church, ADMITTED_D + cp, { pubkeys: [x.pub] }, { tagChurch: false }));
  await sleep(1100);
  await mustPut(raw(dana, GROUP_D + gid, { name: 'Youth', kind: 'group', leaders: [], childsafe: true }));
  await mustPut(raw(dana, GROUP_D + gone, '', { tags: [['deleted', '1'], ['for', cp]] }));
  await mustPut(raw(dana, ADMITTED_D + cp, { pubkeys: [y.pub] }));
  const r = await eng._removeStewardKeeping(dana.pub);
  assert.ok(r.wrote);
  const check = async (relay) => {
    assert.equal(JSON.parse((await churchCopy(GROUP_D + gid, relay)).content).childsafe, true, relay.name + ': the steward’s childsafe change reverted');
    const tomb = await churchCopy(GROUP_D + gone, relay);
    assert.ok(tomb && tomb.tags.some(t => t[0] === 'deleted'), relay.name + ': the steward’s delete was not kept under the church');
    assert.deepEqual(JSON.parse((await churchCopy(ADMITTED_D + cp, relay)).content).pubkeys, [x.pub], relay.name + ': the church’s admitted list was replaced');
  };
  await check(X);
  assert.equal(churchSent(eng, ADMITTED_D + cp).length, 0, 'admitted: was re-signed');
  X = await H.moveRelay(X);   // the same box, restarted (its maps rebuilt from disk under the new roster)
  await check(X);
  T5 = true;
});

// ══ T6: the engine's own rules ═══════════════════════════════════════════════════════════════════════════════════════
test('T6 — exclusions: clearance, safety checks, finance, group keys and admitted are never re-signed', async () => {
  const eng = owner(); const dana = await newSteward();
  await setRoster(eng, [dana.pub], { [dana.pub]: ['care', 'safeguarding', 'members', 'finance', 'content'] });
  const ds = [];
  for (const [d, c] of [['trinityone/clearance:' + cp.slice(0, 8) + 'x', { e: 'sealed' }], ['trinityone/safetycheck:' + cp, { at: 1 }],
    ['finance/journal:' + cp.slice(0, 8) + '1', { e: 'sealed' }], ['trinityone/groupkey:' + cp.slice(0, 16) + '-k', { keys: {} }], [ADMITTED_D + cp, { pubkeys: [] }]]) {
    const [ok] = await put(raw(dana, d, c)); if (ok) ds.push(d);
  }
  assert.ok(ds.length >= 3, 'FIXTURE: the relay took too few of the excluded types to test anything: ' + ds.join(', '));
  const sentBefore = eng.sent.length;
  const r = await eng._removeStewardKeeping(dana.pub);
  assert.ok(r.wrote);
  const resigned = eng.sent.slice(sentBefore).filter(e => e.pubkey === cp && ds.includes(dOf(e)));
  assert.deepEqual(resigned.map(dOf), [], 'an excluded type was re-signed by the church');
});

test('T6 — paging: their documents are read in pages, deduped by id, and reading stops on a page that brings nothing new', async () => {
  const eng = owner(); const dana = await newSteward();
  await setRoster(eng, [dana.pub], { [dana.pub]: ['content'] });
  await mustPut(raw(dana, GROUP_D + cp.slice(0, 16) + '-p1', { name: 'p1' }));
  await mustPut(raw(dana, GROUP_D + cp.slice(0, 16) + '-p2', { name: 'p2' }));
  const r = await eng._carryOverStewardDocs(dana.pub);
  const phaseA = eng._pool.asked.filter(q => q.filters[0].authors && q.filters[0].authors[0] === dana.pub);
  assert.equal(phaseA.length, 2, 'phase A should ask twice (one page, then one that brings nothing new): ' + phaseA.length);
  assert.equal(phaseA[1].filters[0].until, phaseA[1].filters[0].until | 0, 'the second page is not bounded by `until`');
  assert.deepEqual(r.notCarried, [], 'a complete read was reported incomplete: ' + JSON.stringify(r.notCarried));
  assert.equal(r.carried.length, 2);
});

test('T6 — a relay that does not answer blocks the carry for that slice; nothing is published, and it is listed', async () => {
  const dana = await newSteward();
  const eng0 = owner(); await setRoster(eng0, [dana.pub], { [dana.pub]: ['content'] });
  await mustPut(raw(dana, GROUP_D + cp.slice(0, 16) + '-dead', { name: 'kept only if every relay answers' }));
  const eng = owner(X, { relays: () => [X.wsUrl, 'ws://127.0.0.1:9/relay'] });
  eng._careRoster = new Set([dana.pub]);
  const r = await eng._carryOverStewardDocs(dana.pub, { limitMs: 4000 });
  assert.equal(eng.sent.length, 0, 'the carry published although one relay never answered');
  assert.ok(r.notCarried.some(x => x.d === GROUP_D + cp.slice(0, 16) + '-dead' && x.why === 'incomplete'), JSON.stringify(r.notCarried));
});

test('T6 — a delegated console refuses: nothing is read or published', async () => {
  const dana = await newSteward();
  const eng = owner(X, { actingChurch: cp });
  const r = await eng._carryOverStewardDocs(dana.pub);
  assert.equal(r.refused, 'delegated');
  assert.equal(eng.sent.length + eng._pool.asked.length, 0);
});

test('T2 (engine) — the roster is still written when the carry runs out of time, and the carry ran BEFORE it', async () => {
  const dana = await newSteward();
  const eng = owner(X, { relays: () => [X.wsUrl, 'ws://10.255.255.1:9/relay'] });   // the second never answers: the limit decides
  await setRoster(eng, [dana.pub], { [dana.pub]: ['content'] });
  await mustPut(raw(dana, GROUP_D + cp.slice(0, 16) + '-slow', { name: 'slow' }));
  const order = [];
  const real = eng.window.Steward.setStewards;
  eng.window.Steward.setStewards = (...a) => { order.push('roster'); return real(...a); };
  const realCarry = eng._carryOverStewardDocs;
  const t0 = Date.now();
  const r = await eng._removeStewardKeeping(dana.pub, { limitMs: 1500 });
  assert.ok(Date.now() - t0 < 9000, 'the limit did not bound the carry');
  assert.ok(r.wrote, 'a carry that ran out of time stopped the removal');
  assert.deepEqual(order, ['roster']);
  assert.ok(r.carry.notCarried.length > 0, 'running out of time was not reported');
  assert.equal(realCarry, eng._carryOverStewardDocs);
});

test('T2 (engine) — carried copies are published BEFORE the roster write', async () => {
  const eng = owner(); const dana = await newSteward();
  await setRoster(eng, [dana.pub], { [dana.pub]: ['content'] });
  const d = GROUP_D + cp.slice(0, 16) + '-order';
  await mustPut(raw(dana, d, { name: 'order' }));
  let carriedFirst = null;
  const real = eng.window.Steward.setStewards;
  eng.window.Steward.setStewards = (...a) => { carriedFirst = churchSent(eng, d).length === 1; return real(...a); };
  const r = await eng._removeStewardKeeping(dana.pub);
  assert.ok(r.wrote);
  assert.equal(carriedFirst, true, 'the roster was written before the church copy was published — the relay then hides the steward’s copies from the church');
});

// ══ T11 / R1 / R2: one removal at a time, from the engine's own roster ═════════════════════════════════════════════
test('T11/R1 — two Removes pressed back to back: the final roster lacks both, and neither is written back', async () => {
  const eng = owner(); const a = await newSteward(), b = await newSteward(), c = await newSteward();
  await setRoster(eng, [a.pub, b.pub, c.pub], { [a.pub]: ['content'], [b.pub]: ['care'], [c.pub]: ['members'] });
  const [ra, rb] = await Promise.all([eng._removeStewardKeeping(a.pub), eng._removeStewardKeeping(b.pub)]);
  assert.ok(ra.wrote && rb.wrote);
  const rosters = eng.sent.filter(e => dOf(e) === STEWARDS_D + cp);
  const last = JSON.parse(rosters.at(-1).content);
  assert.deepEqual(last.pubkeys, [c.pub], 'the second removal wrote the first person back (R1)');
  assert.deepEqual(last.caps, { [c.pub]: ['members'] }, 'capabilities of the steward who stays were not carried forward');
  assert.deepEqual([...eng._careRoster], [c.pub]);
});

test('R2 — a console that has not read the roster refuses, and writes nothing', async () => {
  const eng = owner(); const a = await newSteward();
  eng._careRosterKnown = false; eng._careRoster = new Set();
  const r = await eng._removeStewardKeeping(a.pub);
  assert.equal(r.refused, 'roster-unknown');
  assert.equal(eng.sent.length, 0, 'a roster built from an unknown set was written');
});

test('owner answer (c) — unticking every capability carries, then writes caps[pk] = [] and keeps them on the roster', async () => {
  const eng = owner(); const a = await newSteward(), b = await newSteward();
  await setRoster(eng, [a.pub, b.pub], { [a.pub]: ['content'], [b.pub]: ['care'] });
  const d = GROUP_D + cp.slice(0, 16) + '-caps';
  await mustPut(raw(a, d, { name: 'set by a' }));
  const r = await eng._removeStewardKeeping(a.pub, { capsOnly: true });
  assert.ok(r.wrote);
  assert.equal(churchSent(eng, d).length, 1, 'unticking everything did not carry their settings');
  const last = JSON.parse(eng.sent.filter(e => dOf(e) === STEWARDS_D + cp).at(-1).content);
  assert.deepEqual(last.pubkeys.sort(), [a.pub, b.pub].sort());
  assert.deepEqual(last.caps[a.pub], []);
});

// ══ T10 companion (owner answer f): Block takes them off leaders/members of carried group defs; Remove does not ═════
test('T10 — a carried group definition: Remove keeps the removed steward on leaders/members; Block takes the blocked person off', async () => {
  const eng = owner(); const dana = await newSteward(), eve = await newSteward();
  await setRoster(eng, [dana.pub, eve.pub], { [dana.pub]: ['content'], [eve.pub]: ['content'] });
  const other = H.key().pub;
  const gR = cp.slice(0, 16) + '-f-remove', gB = cp.slice(0, 16) + '-f-block';
  await mustPut(raw(dana, GROUP_D + gR, { name: 'Leaders R', leaders: [dana.pub, other], visibility: 'invite', members: [dana.pub, other] }));
  await mustPut(raw(eve, GROUP_D + gB, { name: 'Leaders B', leaders: [eve.pub.toUpperCase(), other], visibility: 'invite', members: [eve.pub, other] }));
  const rr = await eng._removeStewardKeeping(dana.pub);
  assert.ok(rr.wrote);
  const kept = JSON.parse((await churchCopy(GROUP_D + gR)).content);
  assert.deepEqual(kept.leaders, [dana.pub, other], 'a REMOVED steward was taken off leaders');
  assert.deepEqual(kept.members, [dana.pub, other], 'a REMOVED steward was taken off the invite list');
  const rb = await eng._carryOverStewardDocs(eve.pub, { blocked: true });
  assert.ok(rb.carried.some(x => x.d === GROUP_D + gB), JSON.stringify(rb));
  const cut = JSON.parse((await churchCopy(GROUP_D + gB)).content);
  assert.deepEqual(cut.leaders, [other], 'a BLOCKED person is still a leader in the carried definition');
  assert.deepEqual(cut.members, [other], 'a BLOCKED person is still on the carried invite list');
  assert.equal(cut.name, 'Leaders B', 'Block changed something other than the two lists');
});

// ══ ROUND 2 (owner answers h, i; audit LOWs) ═══════════════════════════════════════════════════════════════════════
test('answer (h) is NOT applied: a steward cannot write a giving fund at all (owner-only at the relay), and fund: stays never-carried', async () => {
  // SECURITY-AUDIT-2026-07-06 M4 (gateway.mjs, FUND_D): a fund carries the church's PAYMENT DESTINATION, so the relay takes
  // it from the church key alone. Carrying a steward-authored fund would have the church re-sign a steward's Lightning
  // address — the redirect M4 closed. Measured here: the write is refused, so there is never a steward fund to keep.
  const eng = owner(); const dana = await newSteward();
  await setRoster(eng, [dana.pub], { [dana.pub]: ['finance', 'content'] });
  const [ok] = await put(raw(dana, 'trinityone/fund:' + cp.slice(0, 8) + '-roof', { name: 'Roof appeal', lnaddr: 'steward@example.invalid' }));
  assert.equal(ok, false, 'the relay accepted a STEWARD’s giving fund — M4 is open, and answer (h) needs revisiting');
  const C = new Function(stmt(STEWARD, 'var STEWARD_CARRY = ', 'STEWARD_CARRY') + '\nreturn STEWARD_CARRY;')();
  assert.ok(C.never.includes('trinityone/fund:') && !C.carry.includes('trinityone/fund:'), 'fund: is carried: a steward fund served by a relay that does not enforce M4 would be re-signed by the church');
});

test('answer (i) — a steward copy in the same second or LATER than the removal: the church copy still comes out strictly newer', async () => {
  const eng = owner(); const dana = await newSteward();
  await setRoster(eng, [dana.pub], { [dana.pub]: ['content'] });
  const d = GROUP_D + cp.slice(0, 16) + '-ahead';
  const S = await mustPut(raw(dana, d, { name: 'stamped two seconds ahead' }, { at: Math.floor(Date.now() / 1000) + 2 }));
  const r = await eng._removeStewardKeeping(dana.pub);
  const c = churchSent(eng, d).at(-1);
  assert.ok(c, 'not carried: ' + JSON.stringify(r.carry));
  assert.ok(c.created_at > S.created_at, 'the church copy (' + c.created_at + ') is not strictly newer than the steward’s (' + S.created_at + ')');
  assert.equal(r.carry.notCarried.length, 0);
});

test('nit — a document changed since by ANOTHER CURRENT steward is not listed as "may change back"', async () => {
  const eng = owner(); const dana = await newSteward(), eve = await newSteward();
  await setRoster(eng, [dana.pub, eve.pub], { [dana.pub]: ['content'], [eve.pub]: ['content'] });
  const d = GROUP_D + cp.slice(0, 16) + '-eve';
  await mustPut(raw(dana, d, { name: 'dana' }));
  await mustPut(raw(eve, d, { name: 'eve, later' }));
  const r = await eng._removeStewardKeeping(dana.pub);
  assert.deepEqual(r.carry.notCarried.filter(x => x.d === d), [], 'over-reported as "may change back"');
  assert.ok(r.carry.superseded.includes(d));
  assert.equal(churchSent(eng, d).length, 0, 'dana’s older copy was carried over eve’s newer one');
});

test('R1 race — a stale roster re-emit (setCareRoster) between the write and its echo cannot put the removed steward back', async () => {
  const eng = owner(); const a = await newSteward(), b = await newSteward(), c = await newSteward();
  await setRoster(eng, [a.pub, b.pub, c.pub], { [a.pub]: ['content'], [b.pub]: ['content'], [c.pub]: ['content'] });
  const ra = await eng._removeStewardKeeping(a.pub);
  assert.ok(ra.wrote);
  eng.window.Steward.setCareRoster([a.pub, b.pub, c.pub]);   // the screen's roster from before the echo, re-emitted by the React effect
  assert.equal(eng._careRoster.has(a.pub), false, 'the stale re-emit put the removed steward back into the engine’s roster');
  const rb = await eng._removeStewardKeeping(b.pub);
  assert.ok(rb.wrote);
  assert.deepEqual(JSON.parse(eng.sent.filter(e => dOf(e) === STEWARDS_D + cp).at(-1).content).pubkeys, [c.pub], 'the second removal wrote the first person back');
  // CONTROL: anyone this console did not just remove is adopted as before
  const d2 = H.key().pub;
  eng.window.Steward.setCareRoster([c.pub, d2]);
  assert.deepEqual([...eng._careRoster], [c.pub, d2], 'CONTROL: setCareRoster stopped adopting ordinary lists');
});

test('R1 — the "removed at" recorded is the roster event’s own created_at, not the clock', async () => {
  const eng = owner(); const a = await newSteward(), b = await newSteward();
  // three quick roster writes push this document's stamp ahead of the clock, so the two can be told apart
  for (let i = 0; i < 3; i++) await eng.setStewards([a.pub, b.pub], { [a.pub]: ['content'], [b.pub]: ['content'] });
  eng._careRoster = new Set([a.pub, b.pub]); eng._stewardCaps = { [a.pub]: ['content'], [b.pub]: ['content'] };
  const r = await eng._removeStewardKeeping(a.pub);
  const roster = eng.sent.filter(e => dOf(e) === STEWARDS_D + cp).at(-1);
  assert.ok(roster.created_at > Math.floor(Date.now() / 1000), 'FIXTURE: the roster stamp is not ahead of the clock, so this proves nothing');
  assert.equal(eng._exRemembered.at(-1).at, roster.created_at, 'the removal was recorded at the clock, not at the roster that made it');
  assert.ok(r.wrote);
});

test('re-seat — the verbatim carry keeps the OLD key on leaders/members; the swap (after the block) puts the NEW key in its place', async () => {
  const eng = owner(); const oldK = await newSteward(); const newK = H.key(), other = H.key().pub;
  await setRoster(eng, [oldK.pub], { [oldK.pub]: ['content'] });
  const g = cp.slice(0, 16) + '-reseat';
  await mustPut(raw(oldK, GROUP_D + g, { name: 'Re-seat', leaders: [oldK.pub, other], visibility: 'invite', members: [other, oldK.pub] }));
  const r = await eng._carryOverStewardDocs(oldK.pub, {});
  assert.ok(r.carried.some(x => x.d === GROUP_D + g && x.ev), JSON.stringify(r));
  const before = JSON.parse((await churchCopy(GROUP_D + g)).content);
  assert.deepEqual([before.leaders, before.members], [[oldK.pub, other], [other, oldK.pub]], 'the pre-block carry was not verbatim — a refused block would leave changed groups');
  assert.equal(JSON.stringify(before).includes(newK.pub), false, 'a group names the new key before any block');
  const sw = await eng._swapKeyInChurchGroups(r, oldK.pub, newK.pub);
  assert.deepEqual(sw, { swapped: ['the group “Re-seat”'], failed: [], other: [] });
  const after = JSON.parse((await churchCopy(GROUP_D + g)).content);
  assert.deepEqual(after.leaders, [newK.pub, other], 'the new key did not take the old one’s place on leaders');
  assert.deepEqual(after.members, [other, newK.pub], 'the new key did not take the old one’s place on members');
});

test('N1 — a RETRIED re-seat (first block refused) still puts the new key on the groups: the swap reads the church’s own copies', async () => {
  const eng = owner(); const oldK = await newSteward(); const newK = H.key(), other = H.key().pub, untouched = H.key().pub;
  await setRoster(eng, [oldK.pub], { [oldK.pub]: ['content'] });
  const g = cp.slice(0, 16) + '-retry', gOther = cp.slice(0, 16) + '-notheirs';
  await mustPut(raw(oldK, GROUP_D + g, { name: 'Retry', leaders: [oldK.pub, other] }));
  await mustPut(raw(oldK, GROUP_D + gOther, { name: 'Not on it', leaders: [untouched] }));   // authored by them, but they are not on it
  const r1 = await eng._carryOverStewardDocs(oldK.pub, {});           // attempt 1 — its block is then refused, so no swap
  assert.ok(r1.carried.some(x => x.d === GROUP_D + g), 'FIXTURE: attempt 1 did not carry the group');
  await sleep(1100);
  const r2 = await eng._carryOverStewardDocs(oldK.pub, {});           // attempt 2: the church's copies are now the newer ones
  assert.ok(!r2.carried.some(x => x.d === GROUP_D + g) && r2.superseded.includes(GROUP_D + g), 'FIXTURE: the retry is not the superseded case: ' + JSON.stringify({ c: r2.carried.map(x => x.d), s: r2.superseded }));
  const sentBefore = eng.sent.length;
  const sw = await eng._swapKeyInChurchGroups(r2, oldK.pub, newK.pub);   // after attempt 2's block lands
  const after = JSON.parse((await churchCopy(GROUP_D + g)).content);
  assert.deepEqual(after.leaders, [newK.pub, other], 'THE RETRIED RE-SEAT LEFT THE GROUP NAMING ONLY THE OLD, BLOCKED KEY');
  assert.equal(sw.swapped.length, 1, 'the screen is not told the group moved: ' + JSON.stringify(sw));
  assert.equal(eng.sent.slice(sentBefore).filter(e => dOf(e) === GROUP_D + gOther).length, 0, 'a group the old key is not on was re-saved');
  assert.deepEqual(sw.failed, [], 'N4: a group that needed no change was listed as failed');
});

test('N1 — the swap never re-saves the church’s copy over ANOTHER steward’s later edit', async () => {
  const eng = owner(); const oldK = await newSteward(), eve = await newSteward(); const newK = H.key();
  await setRoster(eng, [oldK.pub, eve.pub], { [oldK.pub]: ['content'], [eve.pub]: ['content'] });
  const g = cp.slice(0, 16) + '-evelater';
  await mustPut(raw(oldK, GROUP_D + g, { name: 'old', leaders: [oldK.pub] }));
  const r1 = await eng._carryOverStewardDocs(oldK.pub, {});
  assert.ok(r1.carried.length, 'FIXTURE: not carried');
  await sleep(1100);
  await mustPut(raw(eve, GROUP_D + g, { name: 'eve, later', leaders: [oldK.pub, eve.pub] }, { at: Math.floor(Date.now() / 1000) + 1 }));
  const sentBefore = eng.sent.length;
  const sw = await eng._swapKeyInChurchGroups(r1, oldK.pub, newK.pub);
  assert.equal(eng.sent.slice(sentBefore).length, 0, 'the church’s older copy was re-saved over another steward’s newer edit');
  // L1 (a): left alone, but SAID — that newer copy still names the old, blocked key
  assert.deepEqual(sw, { swapped: [], failed: [], other: ['the group “old”'] }, 'a group another steward changed, still naming the old key, was skipped silently');
});

test('L1 (b) / L2 — a relay that does not answer: the group is listed as failed and nothing is re-saved', async () => {
  const oldK = await newSteward(); const newK = H.key();
  const eng0 = owner(); await setRoster(eng0, [oldK.pub], { [oldK.pub]: ['content'] });
  const g = cp.slice(0, 16) + '-swapdead';
  await mustPut(raw(church, GROUP_D + g, { name: 'Half answered', leaders: [oldK.pub] }, { tagChurch: false }));
  for (const urls of [[X.wsUrl, 'ws://127.0.0.1:9/relay'], ['ws://127.0.0.1:9/relay']]) {
    const eng = owner(X, { relays: () => urls });
    const sw = await eng._swapKeyInChurchGroups({ carried: [], superseded: [GROUP_D + g] }, oldK.pub, newK.pub);
    assert.equal(eng.sent.length, 0, 'a swap was published although not every relay answered (' + urls.length + ' relays)');
    assert.equal(sw.failed.length, 1, 'a group was skipped SILENTLY when ' + (urls.length === 1 ? 'no relay' : 'one relay') + ' answered: ' + JSON.stringify(sw));
    assert.deepEqual(sw.swapped, []);
  }
});

test('nit (i) — the swap’s copy is strictly newer than a FUTURE-dated church copy it replaces', async () => {
  const eng = owner(); const oldK = await newSteward(); const newK = H.key();
  await setRoster(eng, [oldK.pub], { [oldK.pub]: ['content'] });
  const g = cp.slice(0, 16) + '-swapahead';
  const C = await mustPut(raw(church, GROUP_D + g, { name: 'Ahead', leaders: [oldK.pub] }, { tagChurch: false, at: Math.floor(Date.now() / 1000) + 2 }));
  const sw = await eng._swapKeyInChurchGroups({ carried: [], superseded: [GROUP_D + g] }, oldK.pub, newK.pub);
  const pub2 = churchSent(eng, GROUP_D + g).at(-1);
  assert.ok(pub2 && pub2.created_at > C.created_at, 'the swapped copy is not strictly newer than the copy it replaces: ' + JSON.stringify(sw));
  assert.deepEqual(JSON.parse((await churchCopy(GROUP_D + g)).content).leaders, [newK.pub]);
});

test('nit 5 — a steward copy far ahead of the clock (the re-sign cannot catch up) is listed as "newer", not "tie"', async () => {
  const eng = owner(); const dana = await newSteward();
  await setRoster(eng, [dana.pub], { [dana.pub]: ['content'] });
  const d = GROUP_D + cp.slice(0, 16) + '-farahead';
  await mustPut(raw(dana, d, { name: 'thirty seconds ahead' }, { at: Math.floor(Date.now() / 1000) + 30 }));
  const r = await eng._carryOverStewardDocs(dana.pub);
  assert.equal(churchSent(eng, d).length, 0, 'a copy that is not strictly newer was published');
  assert.deepEqual(r.notCarried.filter(x => x.d === d).map(x => x.why), ['newer']);
});

// ══ CARE NEEDS (owner answer g): carried, the skip part re-made under the church ════════════════════════════════════
// The steward's need is written by the SHIPPED publishNeed (vendor/steward-meals.js) on the steward's console; the
// recipient's skip is the SHIPPED markCareSkip (vendor/fellowship.js) — both lifted, both against the real relay.
const MEALS = readFileSync(new URL('../vendor/steward-meals.js', import.meta.url), 'utf8');
const careKey = crypto.getRandomValues(new Uint8Array(32));
const careKeyHex = Buffer.from(careKey).toString('hex');
function careMethods(eng) {
  // careSeal / careOpen / careSealTo, lifted from vendor/steward.js — the methods the carry and publishNeed call
  const S = eng.window.Steward;
  const body = (sig) => fnBody(STEWARD, sig, sig);
  const src = ['careSeal(obj) {', 'careOpen(ct) {', 'careSealTo(recipientPub, obj) {'].map(body);
  const names = /return JSON\.parse\((\w+)\(ct, _unhex\(k\)\)\)/.exec(src[1]); assert.ok(names, 're-anchor careOpen');
  const enc = /\? (\w+)\(JSON\.stringify\(obj\), _unhex/.exec(src[0]); assert.ok(enc, 're-anchor careSeal');
  const ck = /JSON\.stringify\(obj\), (\w+)\(sk, recipientPub\)/.exec(src[2]); assert.ok(ck, 're-anchor careSealTo');
  const scope = { sk: eng.sk, _careKeyHex: careKeyHex, _careKeyRing: [careKeyHex], _unhex: eng._unhex, [names[1]]: nip44.decrypt, [enc[1]]: nip44.encrypt, [ck[1]]: nip44.utils.getConversationKey };
  Object.assign(S, new Function('scope', `with (scope) { return ({ ${src.join(',\n')} }); }`)(scope));
  return S;
}
// `ahead` stamps the steward's need that many seconds later than the clock — so a removal pressed at once is the SAME
// second or earlier, the case answer (i) is about, every time rather than by luck
function liftPublishNeed(stewardEng, ahead = 0) {
  const S = careMethods(stewardEng);
  S.publishSigned = async (tmpl) => { const e = stewardEng.feChurch({ ...tmpl, created_at: tmpl.created_at + ahead }, stewardEng.sk); return (await stewardEng.publish(e)) ? e : null; };
  const need = fnBody(MEALS, 'async function publishNeed(need) {', 'publishNeed');
  const norm = fnBody(MEALS, 'function _normNeed(', '_normNeed');
  const shaB = fnBody(MEALS, 'async function _sha256hex(str) {', '_sha256hex (meals)');
  return new Function('S_', 'NET', `const S = () => S_; const now = () => Math.floor(Date.now()/1000); const NEED_D = 'trinityone/care:';
    ${stmt(MEALS, 'const uid = ', 'uid')}
    ${stmt(MEALS, 'const SEALED_FIELDS = ', 'SEALED_FIELDS')}
    const _rand32 = () => { const b = new Uint8Array(32); crypto.getRandomValues(b); return Array.from(b).map(x => x.toString(16).padStart(2, '0')).join(''); };
    ${shaB}\n${norm}\n${need}\nreturn publishNeed;`)(S, NET);
}
function liftMarkCareSkip(member, relay) {
  const body = fnBody(FELLOWSHIP, 'async markCareSkip(careId, iso, reason, skipEnc, needAuthor) {', 'markCareSkip');
  const dec = /JSON\.parse\((\w+)\(skipEnc, (\w+)\(sk, authorPub\)\)\)/.exec(body); assert.ok(dec, 're-anchor markCareSkip');
  const sig = /const evt = (\w+)\((\w+)\(\{ kind: 30078/.exec(body); assert.ok(sig, 're-anchor markCareSkip signer');
  const out = { result: null };
  const scope = { sk: member.sk, NET, CARESKIP_D: 'trinityone/careskip:', window: { Fellowship: { churchPub: cp } },
    [dec[1]]: nip44.decrypt, [dec[2]]: nip44.utils.getConversationKey, [sig[1]]: finalizeEvent, [sig[2]]: (t) => t,
    _sha256hex: async (u8) => Buffer.from(await crypto.subtle.digest('SHA-256', u8)).toString('hex'),
    publishSetFor: () => [relay.wsUrl], console: { warn() {} },
    _publishBounded: async (_u, evt) => { const r = await put(evt, relay); out.result = r; if (!r[0]) throw new Error(r[1]); },
  };
  const f = new Function('scope', `with (scope) { return ({ ${body} }); }`)(scope).markCareSkip;
  return async (...a) => { out.result = null; await f(...a); return out.result; };
}
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
let CARE = null;
test('care need — carried with the skip part re-made: the recipient’s skip is accepted, the old token refused, no recipient in the clear', async () => {
  const eng = owner(); careMethods(eng);
  const dana = await newSteward(), rose = await newSteward();
  await setRoster(eng, [dana.pub], { [dana.pub]: ['care'] });
  const sEng = consoleEngine({ signer: dana, church: cp, actingChurch: cp, relayUrl: X.wsUrl, pool: authedPool(dana, STEWARDS_D + cp), publishTo: (e) => put(e, X) });
  const publishNeed = liftPublishNeed(sEng, 1);   // the steward's copy is a second AHEAD: the removal below is the same second or earlier
  const d0 = day(1), d1 = day(2), d2 = day(3), d3 = day(7);
  const saved = await publishNeed({ type: 'meals', displayLabel: 'Rose', recipient: rose.pub, dates: [d0, d1, d2, d3], startDate: d0, endDate: d3, meals: ['dinner'], notes: 'after 5' });
  assert.ok(saved && saved.id, 'FIXTURE: the steward’s need was not saved: ' + sEng.refused);
  const stewardNeed = sEng.sent.filter(e => dOf(e) === NEED_D + saved.id).at(-1);
  assert.ok(JSON.parse(stewardNeed.content).skipEnc, 'FIXTURE: the need carries no skip part, so nothing here tests the re-mint');
  const markSkip = liftMarkCareSkip(rose, X);
  const ctl = await markSkip(saved.id, d0, 'control', JSON.parse(stewardNeed.content).skipEnc, dana.pub);
  assert.equal(ctl && ctl[0], true, 'CONTROL: before the removal the steward’s own token is accepted — without this the refusal below proves nothing: ' + JSON.stringify(ctl));
  const r = await eng._removeStewardKeeping(dana.pub);   // at once — no waiting for the clock to move on
  assert.ok(r.wrote);
  const carried = churchSent(eng, NEED_D + saved.id).at(-1);
  assert.ok(carried, 'the care need was not carried: ' + JSON.stringify(r.carry));
  const body = JSON.parse(carried.content);
  assert.notEqual(body.skipEnc, JSON.parse(stewardNeed.content).skipEnc, 'the skip part was copied, not re-made');
  assert.equal(carried.content.includes(rose.pub) || carried.tags.some(t => t.some(v => String(v).includes(rose.pub))), false, 'the recipient is in the clear');
  assert.deepEqual(carried.tags.filter(t => t[0] === 'skiphash').map(t => t[1]).sort(), [d0, d1, d2, d3]);
  assert.ok(carried.created_at > stewardNeed.created_at, 'ANSWER (i): the carried need is not strictly newer than the steward’s (' + carried.created_at + ' vs ' + stewardNeed.created_at + ')');
  const okNew = await markSkip(saved.id, d1, 'family visiting', body.skipEnc, cp);   // what the phone passes: the need's author is now the church
  assert.equal(okNew && okNew[0], true, 'the recipient’s skip on a carried need was refused: ' + JSON.stringify(okNew));
  const okOld = await markSkip(saved.id, d2, 'old token', JSON.parse(stewardNeed.content).skipEnc, dana.pub);
  assert.equal(okOld && okOld[0], false, 'a skip with the OLD token was accepted');
  // …and after the relay RESTARTS (it replays in created_at order, ties in arrival order) the church's copy still decides
  X = await H.moveRelay(X);
  const oldAfter = await liftMarkCareSkip(rose, X)(saved.id, d2, 'old token, after restart', JSON.parse(stewardNeed.content).skipEnc, dana.pub);
  assert.equal(oldAfter && oldAfter[0], false, 'after a relay restart the steward’s OLD skip token works again — the carried need did not win');
  const newAfter = await liftMarkCareSkip(rose, X)(saved.id, d3, 'new token, after restart', body.skipEnc, cp);
  assert.equal(newAfter && newAfter[0], true, 'after a relay restart the re-made token is refused: ' + JSON.stringify(newAfter));
  CARE = { saved, stewardNeed, carried, rose, dana, d1, d2 };
});

// ══ R3 — a KNOWN GAP, documented, not fixed (no relay change: owner answer b) ═══════════════════════════════════════
// The relay's care-need note() has no newest-wins. A removed steward's OLDER need that reaches a relay LATE, by peer
// sync, overwrites that relay's skip hashes until it restarts (a restart replays oldest-first and the church copy wins).
test('R3 (known gap) — a late OLDER steward need arriving by peer sync makes the relay refuse the new skip token until it restarts', async () => {
  const Y = await H.startRelay({ name: 'carry-Y', churches: [cp] });
  const Z = await H.startRelay({ name: 'carry-Z', churches: [cp] });
  try {
    const list = H.relaysDoc(church, [Y, Z]);
    await H.publishAll(Y, [list]); await H.publishAll(Z, [list]);
    const dana = await newSteward(), rose = H.key();
    for (const r of [Y, Z]) {
      await mustPut(finalizeEvent({ kind: 30078, created_at: T(), tags: [['d', MEMBER_D + cp], ['t', NET]], content: JSON.stringify({ joined: T() }) }, dana.sk), r);
      await mustPut(finalizeEvent({ kind: 30078, created_at: T(), tags: [['d', MEMBER_D + cp], ['t', NET]], content: JSON.stringify({ joined: T() }) }, rose.sk), r);
    }
    const engY = owner(Y); careMethods(engY);
    await setRoster(engY, [dana.pub], { [dana.pub]: ['care'] });
    await H.publishAll(Z, [engY.sent.filter(e => dOf(e) === STEWARDS_D + cp).at(-1)]);
    // the steward's need lands on Z only (Y was down when it was written)
    const sEng = consoleEngine({ signer: dana, church: cp, actingChurch: cp, relayUrl: Z.wsUrl, pool: authedPool(dana, STEWARDS_D + cp), publishTo: (e) => put(e, Z) });
    const saved = await liftPublishNeed(sEng)({ type: 'meals', displayLabel: 'Rose', recipient: rose.pub, dates: [day(4), day(5), day(6)], startDate: day(4), endDate: day(6), meals: ['dinner'] });
    assert.ok(saved && saved.id, 'FIXTURE: need not saved on Z: ' + sEng.refused);
    const old = sEng.sent.filter(e => dOf(e) === NEED_D + saved.id).at(-1);
    // …and reaches Y before the removal, so the owner console on Y sees and carries it
    await mustPut(old, Y);
    const r = await engY._removeStewardKeeping(dana.pub);
    assert.ok(r.wrote && churchSent(engY, NEED_D + saved.id).length === 1, 'FIXTURE: the need was not carried on Y');
    const fresh = JSON.parse(churchSent(engY, NEED_D + saved.id).at(-1).content).skipEnc;
    // Y forgets the steward's copy is there (it is a fresh box restored without it), then pulls Z by sync
    const Y2 = await H.startRelay({ name: 'carry-Y2', churches: [cp] });
    await H.publishAll(Y2, [H.relaysDoc(church, [Y2, Z]), engY.sent.filter(e => dOf(e) === STEWARDS_D + cp).at(-1), churchSent(engY, NEED_D + saved.id).at(-1)]);
    await H.publishAll(Z, [H.relaysDoc(church, [Y2, Z])]);
    const why = {};
    const skipOn = async (relay, dd) => { const r = await liftMarkCareSkip(rose, relay)(saved.id, dd, "x", fresh, cp); why[dd] = r && r[1]; return r && r[0]; };
    assert.equal(await skipOn(Y2, day(4)), true, 'CONTROL: before the late copy arrives, the re-made token is accepted');
    const ran = await H.syncNow(Y2);
    assert.ok(ran.ok !== false, 'sync pass failed: ' + JSON.stringify(ran));
    const lateArrived = (await H.corpus(Y2, church)).some(e => e.id === old.id);
    // each check on its OWN day: a skip is one document per day, and a second one in the same second is refused as a duplicate
    const afterSync = await skipOn(Y2, day(5));
    const Y3 = await H.moveRelay(Y2);
    const afterRestart = await skipOn(Y3, day(6));
    const oldR = await liftMarkCareSkip(rose, Y3)(saved.id, day(5), 'x', JSON.parse(old.content).skipEnc, dana.pub); why.oldAfterRestart = oldR && oldR[1]; const oldTokenAfterRestart = oldR && oldR[0];
    console.log('# R3 ' + JSON.stringify({ lateArrived, afterSync, afterRestart, oldTokenAfterRestart, why }));
    assert.equal(lateArrived, true, 'FIXTURE: the steward’s older need never reached Y by sync, so R3 is untested');
    // THE GAP, AS MEASURED: refused after the late copy, accepted again after a restart
    assert.equal(afterSync, false, 'R3 measured differently: the late older need did NOT break the new token — update the plan note');
    assert.equal(afterRestart, true, 'after a restart the church’s newer need should win again');
    assert.equal(oldTokenAfterRestart, false, 'after a restart the steward’s OLD token still works on this relay');
  } finally { Y.stop(); Z.stop(); }
});
