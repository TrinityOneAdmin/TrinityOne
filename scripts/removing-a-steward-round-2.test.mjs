// REMOVING A STEWARD KEEPS WHAT THEY SAVED — ROUND 2, AGAINST REAL RELAYS (sim failures F1, F2b, F3, F4 of 98c7143d).
//   Run: node --test scripts/removing-a-steward-round-2.test.mjs
//
// The sim (reference/SIM-removal-save-98c7143d-2026-11-18.md) and the plan that answers it
// (reference/PLAN-removed-steward-fixes-F1-F4-2026-11-19.html, §1, as amended by 0b–0d). Owner answers (k)–(t) in
// reference/DOMAIN.md, "REMOVING A STEWARD KEEPS WHAT THEY SAVED". The screen half is
// removing-a-steward-round-2-on-screen.test.mjs.
//
// HOW. Real gateways from this tree (relay-network-harness: each on a port the OS hands out, so nothing collides with
// a concurrent suite; started after the last edit of gateway.mjs by construction). The console is the SHIPPED code
// lifted out of vendor/steward.js by steward-carry-rig.mjs; only the transport is a stand-in. publish() here sends to
// every relay in relays() and answers success on the first that accepts — as the console's publish() does
// (Promise.any, plan 0b R-L1).
//
//   F1  A relay that is OFF (connection refused) or ASLEEP (SIGSTOP: the socket opens, nothing answers) must not stop
//       the carry: what the answering relays show is kept, dated exactly one second after the helper's own save
//       (owner answer k). Today one unanswered relay = nothing carried. `todo` until the F1 round, which also adds
//       the "every relay runs the newest-wins build" condition of answer (s) to these fixtures.
//   F2b BLOCKING A CURRENT HELPER TAKES THEM OFF THE HELPER LIST (owner answer l), after the carry and after the block
//       (plan 0b/0c R-M4): pressed on the real DashMembers over the lifted engine, read back from the relay.
//   F3  A HELPER WHO NO LONGER HELD CARE (owner answers m, q, t): the care team's roster is not re-signed under the
//       church; meals-settings is kept with the care-team pointer put back to the church's own; with no church copy
//       to take it from, it is not kept. Both listed. Then the care team list the owner console builds comes from the
//       church's own roster.
//   F4  RECONNECT OF A FORMER HELPER (owner answer o): the church's copy of a group they led names the new key; with a
//       relay down the screen is told what it could not check. `todo` until the F4 round.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { finalizeEvent } from 'nostr-tools/pure';
import * as H from './relay-network-harness.mjs';
import { STEWARD, authedPool, consoleEngine } from './steward-carry-rig.mjs';
import { compiled, membersGlobals, press, reads, SCH } from './dash-render-kit.mjs';
import { fnBody } from './test-slice.mjs';
import { readFileSync } from 'node:fs';

const NET = 'trinityone';
const STEWARDS_D = 'trinityone/stewards:', MEMBER_D = 'trinityone/member:', GROUP_D = 'trinityone/group:';
const ROSTER_D = 'trinityone/roster:', MEALS_D = 'trinityone/meals-settings', CARETEAM_D = 'trinityone/careteam:', BLOCKED_D = 'trinityone/blocked:';
const MEALS = readFileSync(new URL('../vendor/steward-meals.js', import.meta.url), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const dOf = e => (e.tags.find(t => t[0] === 'd') || [])[1] || '';
let tick = Math.floor(Date.now() / 1000) - 3000;   // fixture clock: strictly increasing, comfortably in the past
const T = () => ++tick;

// A RELAY LEFT FROZEN OUTLIVES THIS PROCESS (memory: SIGTERM skips finally). Every frozen relay is thawed and killed on
// any way out, not only in a finally.
const frozen = new Set();
const thawAll = () => { for (const r of frozen) { try { r.proc.kill('SIGCONT'); } catch {} } frozen.clear(); };
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { thawAll(); H.stopAll(); process.exit(1); });
process.on('exit', () => { thawAll(); H.stopAll(); });
after(() => { thawAll(); H.stopAll(); setTimeout(() => process.exit(process.exitCode || 0), 2000).unref(); });

// ── one church, its relays, its owner console ────────────────────────────────────────────────────────────────────────
async function churchOn(n, name) {
  const church = H.key();
  const relays = [];
  for (let i = 0; i < n; i++) relays.push(await H.startRelay({ name: name + '-r' + (i + 1), churches: [church.pub] }));
  const C = { church, cp: church.pub, relays };
  for (const r of relays) await mustPut(C, finalizeEvent({ kind: 0, created_at: T(), tags: [['t', NET]], content: JSON.stringify({ name: 'St Mary’s' }) }, church.sk), [r]);
  return C;
}
// one EVENT to one relay, bounded (a frozen relay never answers the websocket handshake)
const putOne = (e, relay, ms = 2500) => new Promise((res) => {
  let done = false; const fin = (v) => { if (!done) { done = true; res(v); } };
  setTimeout(() => fin([false, 'timeout']), ms);
  H.connect(relay).then(async (s) => { try { fin(await H.publish(s, e)); } catch (x) { fin([false, String(x && x.message)]); } finally { try { s.close(); } catch {} } }, (x) => fin([false, 'down: ' + (x && x.message)]));
});
// every relay, answered on the first that accepts (the console's publish(): Promise.any)
const putAll = async (C, e, relays = C.relays) => {
  const rs = await Promise.all(relays.map(r => putOne(e, r)));
  return rs.find(x => x[0]) || rs[0] || [false, 'no relay'];
};
const mustPut = async (C, e, relays) => { const [ok, why] = await putAll(C, e, relays); assert.equal(ok, true, 'fixture write refused (' + dOf(e) + '): ' + why); return e; };
const raw = (C, who, d, content, { at, tagChurch = true, tags = [] } = {}) => finalizeEvent({ kind: 30078, created_at: at || T(),
  tags: [['d', d], ['t', NET], ...(tagChurch ? [['church', C.cp]] : []), ...tags], content: typeof content === 'string' ? content : JSON.stringify(content) }, who.sk);

function owner(C, extra = {}) {
  const pool = authedPool(C.church, STEWARDS_D + C.cp);
  const urls = C.relays.map(r => r.wsUrl);
  const eng = consoleEngine({ signer: C.church, church: C.cp, actingChurch: '', relayUrl: urls[0], pool, publishTo: (e) => putAll(C, e), extra: { relays: () => urls, ...extra } });
  eng._pool = pool;
  return eng;
}
async function setRoster(eng, pubs, caps = {}) {
  const ok = await eng.setStewards(pubs, caps);
  assert.ok(ok, 'roster write refused: ' + eng.refused);
  eng._careRoster = new Set(pubs); eng._stewardCaps = { ...caps }; eng._careRosterKnown = true;
  await sleep(150);
}
const newSteward = async (C) => { const s = H.key(); await mustPut(C, finalizeEvent({ kind: 30078, created_at: T(), tags: [['d', MEMBER_D + C.cp], ['t', NET]], content: JSON.stringify({ joined: T() }) }, s.sk)); return s; };
const copiesAt = (C, d, relay) => H.readAs(relay, C.church, { kinds: [30078], '#d': [d] }, 700);
const churchCopy = async (C, d, relay) => (await copiesAt(C, d, relay)).filter(e => e.pubkey === C.cp).sort((a, b) => b.created_at - a.created_at)[0] || null;
const churchSent = (eng, C, d) => eng.sent.filter(e => e.pubkey === C.cp && dOf(e) === d);
const rosterOn = async (C, relay) => { const e = await churchCopy(C, STEWARDS_D + C.cp, relay); return e ? (JSON.parse(e.content).pubkeys || []) : null; };

// ══ F1 — a silent relay must not stop the carry (owner answer k) ═════════════════════════════════════════════════════
// TODO(F1 round): answer (s) makes rule (k) apply only when every relay in relays() is remembered as running the
// newest-wins relay build (plan 0d H-s); these fixtures gain that step then.
async function f1Case(how) {
  const C = await churchOn(2, 'f1-' + how);
  const [r1, r2] = C.relays;
  const eng = owner(C);
  const sam = await newSteward(C);
  await setRoster(eng, [sam.pub], { [sam.pub]: ['content'] });
  const gid = C.cp.slice(0, 16) + '-youth';
  await mustPut(C, raw(C, C.church, GROUP_D + gid, { name: 'Youth Group by Hannah', leaders: [] }, { tagChurch: false }));
  const S = await mustPut(C, raw(C, sam, GROUP_D + gid, { name: 'Youth Group by Sam', leaders: [sam.pub] }));
  if (how === 'killed') { r2.proc.kill('SIGKILL'); await sleep(200); }
  else { frozen.add(r2); r2.proc.kill('SIGSTOP'); }
  try {
    const t0 = Date.now();
    const r = await eng._removeStewardKeeping(sam.pub, { limitMs: 8000 });
    const took = Date.now() - t0;
    assert.ok(r.wrote, 'the roster write did not land on r1');
    assert.ok(took < 11000, 'the carry was not bounded by its limit: ' + took + ' ms');
    const kept = await churchCopy(C, GROUP_D + gid, r1);
    assert.ok(kept, 'NOTHING WAS CARRIED with r2 ' + how + ' (sim F1): ' + JSON.stringify(r.carry.notCarried));
    assert.equal(JSON.parse(kept.content).name, 'Youth Group by Sam', 'r1 reverted to the church’s older copy');
    assert.equal(kept.created_at, S.created_at + 1, 'the church copy is not dated exactly one second after the helper’s save (answer k)');
  } finally { if (frozen.has(r2)) { r2.proc.kill('SIGCONT'); frozen.delete(r2); } }
}
test('F1 — r2 OFF (connection refused): Remove keeps the helper’s group on r1, dated S+1', { todo: 'F1 round (plan §2, 0d H-s)' }, () => f1Case('killed'));
test('F1 — r2 ASLEEP (SIGSTOP): the carry finishes inside its limit and keeps the helper’s group on r1, dated S+1', { todo: 'F1 round (plan §2.3)' }, () => f1Case('frozen'));

// ══ F2b — Block of a current helper takes them off the helper list (owner answer l) ═════════════════════════════════
// The real DashMembers, its Block pressed, over the engine lifted from the bundle. setBlocked is a stand-in that
// publishes the church-signed blocklist to the relay (its own tests are elsewhere); everything else is shipped code.
async function blockOnScreen({ blockAnswer } = {}) {
  const C = await churchOn(1, 'f2b');
  const [X] = C.relays;
  const eng = owner(C);
  const kim = await newSteward(C), eve = await newSteward(C), cleo = H.key();
  await setRoster(eng, [kim.pub, eve.pub], { [kim.pub]: ['content'], [eve.pub]: ['care'] });
  eng._stewardSince = { [kim.pub]: 1_790_000_000, [eve.pub]: 1_790_000_100 };   // when each was put on the roster (the roster document's record)
  const gid = C.cp.slice(0, 16) + '-kims';
  await mustPut(C, raw(C, kim, GROUP_D + gid, { name: 'Kim’s Study', leaders: [kim.pub] }));
  const order = [], told = { revoke: [], handled: [] };
  // the carry is seen by what it PUBLISHES (the church's copy of her group): the engine's top-level functions call each
  // other directly, so wrapping eng._carryOverStewardDocs would record nothing
  const realPublish = eng.publish;
  eng.publish = (e) => { if (e && e.pubkey === C.cp && dOf(e) === GROUP_D + gid) order.push('carry'); return realPublish(e); };
  const realRoster = eng.window.Steward.setStewards;
  eng.window.Steward.setStewards = (...a) => { order.push('roster'); return realRoster(...a); };
  const S = eng.window.Steward;
  Object.assign(S, {
    actingChurch: '', pubkey: C.cp,
    setBlocked: async (list) => {
      order.push('block');
      if (blockAnswer !== undefined) return blockAnswer;
      const e = finalizeEvent({ kind: 30078, created_at: Math.floor(Date.now() / 1000), tags: [['d', BLOCKED_D + C.cp], ['t', NET]], content: JSON.stringify({ pubkeys: list }) }, C.church.sk);
      return (await putAll(C, e))[0] ? e : false;
    },
    publishStewardRevoke: (pk) => { told.revoke.push(pk); return Promise.resolve(true); },
    markStewardRequestHandled: (pk, at) => { told.handled.push({ pk, at }); return Promise.resolve(true); },
    stewardRemovalOutcome: () => Promise.resolve('unknown'),
    stewardSince: () => ({}),
    rotateCareKey: () => Promise.resolve(true), rotateMediaKey: () => Promise.resolve(true),
    ensureNameKeyForMembers: () => Promise.resolve({ rotated: true }), publishGroupKey: () => Promise.resolve({}),
    publishRoster: () => Promise.resolve({}), publishRota: () => Promise.resolve({}),
  });
  const NOW = Math.floor(Date.now() / 1000);
  const members = [{ pubkey: kim.pub, npub: 'npub1kk', name: 'Kim Carer', count: 2, lastTs: NOW - 3600, joined: NOW - 86400 },
    { pubkey: cleo.pub, npub: 'npub1cc', name: 'Cleo Ashby', count: 1, lastTs: NOW - 3600, joined: NOW - 86400 }];
  const g = membersGlobals({ steward: S, members, stewards: [...eng._careRoster], extraWindow: {
    useStewardRosters: () => [], useStewardRotas: () => [], useStewardServices: () => [],
    useMealsSettings: () => ({}), StewardMeals: { publishCareTeam: () => Promise.resolve(true) }, todayISO: () => '2026-11-19',
  } });
  g.todayISO = () => '2026-11-19';
  const { C: Screen, draw } = await compiled('DashMembers', g, ['rotateChurchKeys', 'takeOffEveryTeam', { src: SCH, name: 'publishCareTeamFor' }]);
  await press(draw(Screen, {}), /Remove \/ block this member/, { which: 0 });
  await press(draw(Screen, {}), /Confirm — bans them/);
  // the Block runs on real sockets: wait for it to settle (the in-flight line goes) rather than for a fixed time
  await H.waitFor(async () => { return !/Blocking…/.test(reads(draw(Screen, {}))); }, { timeout: 30000, label: 'the Block to settle' });
  await sleep(300);
  return { C, X, eng, kim, eve, order, told };
}

test('F2b — Block of a CURRENT helper: after the carry and the block, the helper list on the relay no longer names them', async () => {
  const { C, X, kim, eve, order, told } = await blockOnScreen();
  assert.ok(order.indexOf('carry') !== -1 && order.indexOf('block') > order.indexOf('carry'), 'CONTROL: carry then block: ' + order.join(' → '));
  const roster = await rosterOn(C, X);
  assert.ok(roster, 'no roster on the relay');
  assert.ok(!roster.includes(kim.pub), 'A BLOCKED HELPER IS STILL ON THE HELPER LIST (sim F2: "6 of 6"): ' + order.join(' → '));
  assert.ok(roster.includes(eve.pub), 'the other helper was taken off too');
  assert.ok(order.indexOf('roster') > order.indexOf('block'), 'the roster was written before the block (plan 0c R-M4 order): ' + order.join(' → '));
  assert.deepEqual(told.revoke, [kim.pub], 'their console was not told (publishStewardRevoke, as Remove does)');
  // plan 0d N2: their old request to help is recorded as answered THROUGH THE ENGINE, at the time they were put on the
  // roster — so it does not come back under "Requests to help" on any device
  assert.deepEqual(told.handled, [{ pk: kim.pub, at: 1_790_000_000 }], 'their request was not recorded as answered');
});

test('F2b — CONTROL: a Block that was REFUSED (setBlocked answered null) leaves the helper list untouched', async () => {
  const { C, X, kim, order, told } = await blockOnScreen({ blockAnswer: null });
  assert.ok(order.includes('block'), 'CONTROL: the block was asked for');
  assert.ok(!order.includes('roster'), 'the roster was written although the block was refused: ' + order.join(' → '));
  assert.deepEqual(told.revoke, [], 'a refused block still told their console it was removed');
  assert.ok((await rosterOn(C, X)).includes(kim.pub), 'a refused block took them off the helper list');
});

// ══ F3 — a helper who no longer held Care (owner answers m, q, t) ═══════════════════════════════════════════════════
// The church's care team is `careId`. Kim (care + content) changes its roster, points the meals/care setting at a team of
// her own (`kimTeam`, whose roster she also writes), and sets up an ordinary group. The owner then unticks only Care,
// and removes her.
async function f3Case({ heldCare, churchMeals = true }) {
  const C = await churchOn(1, 'f3');
  const [X] = C.relays;
  const eng = owner(C);
  const careId = C.cp.slice(0, 16) + '-care', kimTeam = C.cp.slice(0, 16) + '-kimteam';
  eng.window.StewardMeals = { careTeamId: () => careId };   // what the console's own meals subscription last read
  const kim = await newSteward(C);
  const ann = H.key().pub, mark = H.key().pub, mary = H.key().pub;
  await setRoster(eng, [kim.pub], { [kim.pub]: ['care', 'content'] });
  await mustPut(C, raw(C, C.church, ROSTER_D + careId, { pubs: [ann] }, { tagChurch: false }));
  if (churchMeals) await mustPut(C, raw(C, C.church, MEALS_D, { enabled: true, visibility: 'all', openedBy: 'steward', adminGroupId: careId }, { tagChurch: false }));
  await mustPut(C, raw(C, kim, ROSTER_D + careId, { pubs: [mark, mary] }));
  await mustPut(C, raw(C, kim, ROSTER_D + kimTeam, { pubs: [mark] }));
  await mustPut(C, raw(C, kim, MEALS_D, { enabled: true, visibility: 'team', openedBy: 'member', adminGroupId: kimTeam }));
  await mustPut(C, raw(C, kim, GROUP_D + C.cp.slice(0, 16) + '-kimgroup', { name: 'Kim’s Group' }));
  await setRoster(eng, [kim.pub], { [kim.pub]: heldCare ? ['care', 'content'] : ['content'] });   // the owner unticks Care (or not)
  const r = await eng._removeStewardKeeping(kim.pub);
  assert.ok(r.wrote, 'the removal did not land');
  return { C, X, eng, r, careId, kimTeam, ann, mark, mary };
}
const why = (r, d) => r.carry.notCarried.filter(n => n.d === d);

test('F3 — lost Care: the care team’s roster (and a team she pointed Care at) is NOT re-signed, and is listed', { todo: 'batch 1 (F3)' }, async () => {
  const { C, eng, r, careId, kimTeam } = await f3Case({ heldCare: false });
  assert.deepEqual(churchSent(eng, C, ROSTER_D + careId).map(e => e.content), [], 'THE CARE TEAM’S ROSTER WAS RE-SIGNED UNDER THE CHURCH (sim F3)');
  assert.deepEqual(churchSent(eng, C, ROSTER_D + kimTeam).map(e => e.content), [], 'the roster of the team she pointed Care at was re-signed');
  for (const d of [ROSTER_D + careId, ROSTER_D + kimTeam]) {
    assert.deepEqual(why(r, d).map(n => n.why), ['no-care'], d + ' is not listed as not kept: ' + JSON.stringify(r.carry.notCarried));
    assert.match(why(r, d)[0].label, /the care team list \(they no longer had the Care permission\)/);
  }
  assert.equal(churchSent(eng, C, GROUP_D + C.cp.slice(0, 16) + '-kimgroup').length, 1, 'CONTROL: her ordinary group was carried');
});

test('F3 — lost Care (answer q): the meals/care setting is kept, with the care team put back to the church’s own', { todo: 'batch 1 (F3)' }, async () => {
  const { C, eng, r, careId } = await f3Case({ heldCare: false });
  const sent = churchSent(eng, C, MEALS_D);
  assert.equal(sent.length, 1, 'the meals/care setting was not carried: ' + JSON.stringify(r.carry));
  const body = JSON.parse(sent[0].content);
  assert.equal(body.adminGroupId, careId, 'THE CARE TEAM POINTER WAS KEPT AS SHE LEFT IT (answer q): ' + sent[0].content);
  assert.equal(body.visibility, 'team', 'the rest of her setting was not kept as she left it');
  assert.equal(body.openedBy, 'member');
  assert.equal(why(r, MEALS_D).length, 0, 'a setting that was kept is also listed as not kept');
});

test('F3 — lost Care, and the church never saved a care setting of its own (answer t): not kept, and listed', { todo: 'batch 1 (F3)' }, async () => {
  const { C, eng, r } = await f3Case({ heldCare: false, churchMeals: false });
  assert.equal(churchSent(eng, C, MEALS_D).length, 0, 'a setting naming HER care team was re-signed under the church');
  assert.deepEqual(why(r, MEALS_D).map(n => n.why), ['no-care'], JSON.stringify(r.carry.notCarried));
  assert.match(why(r, MEALS_D)[0].label, /the meals and care setting/);
});

test('F3 — POINT OF USE: after the removal, the care team list the owner console builds comes from the church’s own roster', { todo: 'batch 1 (F3)' }, async () => {
  const { C, X, careId, ann } = await f3Case({ heldCare: false });
  // what the console's roster screens read for the care team now: the newest copy the relay serves the church
  const served = (await copiesAt(C, ROSTER_D + careId, X)).sort((a, b) => b.created_at - a.created_at)[0];
  assert.ok(served, 'no roster for the care team is served at all');
  const people = JSON.parse(served.content).pubs;
  assert.deepEqual(people, [ann], 'THE CARE TEAM THE CONSOLE NOW READS IS THE ONE A HELPER WITHOUT CARE SET (sim F3)');
  // …and the shipped StewardMeals.publishCareTeam writes careteam: from it — the list members' asks for help seal to
  const body = fnBody(MEALS, 'async function publishCareTeam(memberPubs, opts) {', 'publishCareTeam');
  const S = { churchPub: C.cp, actingChurch: '', readMinors: async () => ({ known: true, list: [] }), blockedHere: () => [], rosterLocked: () => false,
    publishSigned: async (t) => { const e = finalizeEvent(t, C.church.sk); return (await putAll(C, e))[0] ? e : false; } };
  const publishCareTeam = new Function('S', 'now', 'NET', 'CARETEAM_D', '_careTeamSeen', '_careTeamWait', 'setTimeout', body + '\nreturn publishCareTeam;')(
    () => S, () => Math.floor(Date.now() / 1000), NET, CARETEAM_D, careId, { pubs: null, cp: '', tries: 0, timer: 0 }, setTimeout);
  assert.ok(await publishCareTeam(people, { team: careId }), 'the care team list did not publish');
  const ct = (await copiesAt(C, CARETEAM_D + C.cp, X)).filter(e => e.pubkey === C.cp).sort((a, b) => b.created_at - a.created_at)[0];
  assert.deepEqual(JSON.parse(ct.content).pubs, [C.cp, ann], 'members’ asks for help would seal to a list a helper without Care set');
});

test('F3 — CONTROL: a helper who HELD Care keeps both the care team’s roster and the meals/care setting as she left them', async () => {
  const { C, eng, r, careId, kimTeam, mark, mary } = await f3Case({ heldCare: true });
  assert.deepEqual(churchSent(eng, C, ROSTER_D + careId).map(e => JSON.parse(e.content).pubs), [[mark, mary]], JSON.stringify(r.carry));
  assert.equal(JSON.parse(churchSent(eng, C, MEALS_D)[0].content).adminGroupId, kimTeam, 'a helper who held Care had her care team pointer changed');
});

// ══ F4 — Reconnect of a FORMER helper (owner answer o) ══════════════════════════════════════════════════════════════
// reseatMember lifted out of the bundle into the same scope as the engine (so its carry and swap are the shipped ones);
// setBlocked publishes the church's blocklist; the rest of the re-seat's writes are recorded and answered yes (their own
// tests are reseat-write-results.test.mjs).
function liftReseat(eng, C) {
  const body = fnBody(STEWARD, 'async reseatMember(oldPub, newPub, o) {', 'reseatMember');
  const S = eng.window.Steward;
  const yes = async () => ({ id: 'x' });
  Object.assign(S, { setReseats: yes, setAdmitted: yes, setMinors: yes, setApproved: yes, setGuardians: yes,
    refreshClearances: async () => ({ results: [], failed: 0, skipped: 0, total: 0, unverified: false, pending: 0 }),
    setBlocked: async (list) => { const e = finalizeEvent({ kind: 30078, created_at: Math.floor(Date.now() / 1000), tags: [['d', BLOCKED_D + C.cp], ['t', NET]], content: JSON.stringify({ pubkeys: list }) }, C.church.sk); return (await putAll(C, e))[0] ? e : false; } });
  const obj = new Function('scope', 'with (scope) { return ({ ' + body + ' }); }')(eng);
  return (a, b, o) => obj.reseatMember(a, b, o);
}
async function f4Case({ downR2 }) {
  const C = await churchOn(2, 'f4');
  const [r1, r2] = C.relays;
  const eng = owner(C);
  const tess = await newSteward(C), tessNew = H.key(), other = H.key().pub;
  await setRoster(eng, [tess.pub], { [tess.pub]: ['content'] });
  const gid = C.cp.slice(0, 16) + '-tess';
  await mustPut(C, raw(C, tess, GROUP_D + gid, { name: 'Tess Bible Group', leaders: [tess.pub], visibility: 'invite', members: [tess.pub, other] }));
  const rm = await eng._removeStewardKeeping(tess.pub);   // Revoke: the carry makes the church copy
  assert.ok(rm.wrote && rm.carry.carried.some(c => c.d === GROUP_D + gid), 'FIXTURE: the removal did not carry her group: ' + JSON.stringify(rm.carry));
  eng._exStewards.add(tess.pub);   // what _rememberExStewards records on the real console (the rig records the call)
  if (downR2) { r2.proc.kill('SIGKILL'); await sleep(200); }
  const reseat = liftReseat(eng, C);
  const res = await reseat(tess.pub, tessNew.pub, { blockOld: true, blocked: [], minors: [], approved: [], admitted: [], reseats: [] });
  return { C, r1, r2, eng, res, gid, tess, tessNew, other };
}
test('F4 — Reconnect ("taken") of a FORMER helper: the church’s copy of her group names the new key on every relay', { todo: 'F4 round (plan §5)' }, async () => {
  const { C, r1, r2, res, gid, tessNew, other } = await f4Case({ downR2: false });
  assert.ok((res.carry && res.carry.swapped || []).length, 'THE SCREEN IS NOT TOLD THE GROUPS MOVED (sim F4): ' + JSON.stringify(res.carry));
  for (const relay of [r1, r2]) {
    const g = JSON.parse((await churchCopy(C, GROUP_D + gid, relay)).content);
    assert.deepEqual(g.leaders, [tessNew.pub], relay.name + ': the group still names the OLD, blocked key as leader');
    assert.deepEqual(g.members, [tessNew.pub, other], relay.name + ': the invite list still names the old key');
  }
});
test('F4 — Reconnect ("taken") of a FORMER helper with r2 OFF: the screen is told what could not be checked', { todo: 'F4 round (plan §5)' }, async () => {
  const { res } = await f4Case({ downR2: true });
  assert.ok((res.carry && res.carry.swapUnchecked || []).length, 'NOTHING SAYS WHAT COULD NOT BE CHECKED (sim F4, checklist 8): ' + JSON.stringify(res.carry));
});
