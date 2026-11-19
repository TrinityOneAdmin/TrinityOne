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
//   F1  OWNER ANSWER (ee), which supersedes (k): a relay that is OFF or ASLEEP means NOTHING is kept — the removal still
//       goes ahead, inside its limit, and lists what was not kept. With every relay up the church copy is dated NOW and
//       reported carried.
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

// ══ F1 — owner answer (ee): a silent relay means NOTHING is kept, the removal still goes ahead, and the screen says so ═══
// (ee) supersedes (k): no partial-answer keeping. These are the agreed behaviour on real relays, with the helper's save 12
// days old: r2 OFF (connection refused) or ASLEEP (SIGSTOP; SIGCONT in a finally and on any exit) → the removal completes
// inside its limit, the church re-signs NOTHING, and the helper's group is in the not-kept list the screen shows (its
// label is what stewCarryNote prints — the screen half is removing-a-steward-round-2-on-screen.test.mjs F2). Every relay
// up → the group is kept, dated NOW (not the helper's save + 1) and reported "carried".
const TWELVE_DAYS = 12 * 86400;
async function f1Case(how) {
  const C = await churchOn(2, 'f1-' + how);
  const [r1, r2] = C.relays;
  const eng = owner(C);
  const sam = await newSteward(C);
  await setRoster(eng, [sam.pub], { [sam.pub]: ['content'] });
  const gid = C.cp.slice(0, 16) + '-youth';
  const old = Math.floor(Date.now() / 1000) - TWELVE_DAYS;
  await mustPut(C, raw(C, C.church, GROUP_D + gid, { name: 'Youth Group by Hannah', leaders: [] }, { tagChurch: false, at: old - 100 }));
  const S = await mustPut(C, raw(C, sam, GROUP_D + gid, { name: 'Youth Group by Sam', leaders: [sam.pub] }, { at: old }));
  if (how === 'killed') { r2.proc.kill('SIGKILL'); await sleep(200); }
  else if (how === 'frozen') { frozen.add(r2); r2.proc.kill('SIGSTOP'); }
  try {
    const t0 = Date.now();
    const r = await eng._removeStewardKeeping(sam.pub, { limitMs: 8000 });
    const took = Date.now() - t0;
    assert.ok(r.wrote, 'the removal did not go ahead');
    assert.ok(took < 12000, 'the removal was not bounded by its limit: ' + took + ' ms');
    const sent = churchSent(eng, C, GROUP_D + gid);
    if (how === 'all-up') {
      assert.equal(sent.length, 1, 'not kept with every relay up: ' + JSON.stringify(r.carry.notCarried));
      assert.ok(sent[0].created_at >= Math.floor(t0 / 1000) - 2, 'the church copy is not dated now: ' + sent[0].created_at + ' vs ' + Math.floor(t0 / 1000));
      assert.ok(r.carry.carried.some(c => c.d === GROUP_D + gid), 'not reported as carried: ' + JSON.stringify(r.carry));
      assert.equal(JSON.parse((await churchCopy(C, GROUP_D + gid, r1)).content).name, 'Youth Group by Sam');
      void S;
    } else {
      assert.deepEqual(sent, [], 'SOMETHING WAS KEPT WHILE A RELAY WAS SILENT (owner answer ee: keep nothing)');
      assert.ok(r.carry.notCarried.some(n => n.d === GROUP_D + gid && /Youth Group by Sam/.test(n.label)),
        'THE SCREEN WOULD NOT NAME THE GROUP THAT WAS NOT KEPT: ' + JSON.stringify(r.carry.notCarried));
    }
  } finally { if (frozen.has(r2)) { try { r2.proc.kill('SIGCONT'); } catch {} frozen.delete(r2); } }
}
test('F1 (ee) — r2 OFF: the removal goes ahead, NOTHING is kept, and what was not kept is listed', () => f1Case('killed'));
test('F1 (ee) — r2 ASLEEP: the removal finishes inside its limit, NOTHING is kept, and it is listed', () => f1Case('frozen'));
test('F1 (ee) — every relay up: the helper’s 12-day-old group is kept, dated NOW, and reported carried', () => f1Case('all-up'));

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

test('F3 — lost Care: the care team’s roster (and a team she pointed Care at) is NOT re-signed, and is listed', async () => {
  const { C, eng, r, careId, kimTeam } = await f3Case({ heldCare: false });
  assert.deepEqual(churchSent(eng, C, ROSTER_D + careId).map(e => e.content), [], 'THE CARE TEAM’S ROSTER WAS RE-SIGNED UNDER THE CHURCH (sim F3)');
  assert.deepEqual(churchSent(eng, C, ROSTER_D + kimTeam).map(e => e.content), [], 'the roster of the team she pointed Care at was re-signed');
  for (const d of [ROSTER_D + careId, ROSTER_D + kimTeam]) {
    assert.deepEqual(why(r, d).map(n => n.why), ['no-care'], d + ' is not listed as not kept: ' + JSON.stringify(r.carry.notCarried));
    assert.match(why(r, d)[0].label, /the care team list \(they no longer had the Care permission\)/);
  }
  assert.equal(churchSent(eng, C, GROUP_D + C.cp.slice(0, 16) + '-kimgroup').length, 1, 'CONTROL: her ordinary group was carried');
});

test('F3 — lost Care (answer q): the meals/care setting is kept, with the care team put back to the church’s own', async () => {
  const { C, eng, r, careId } = await f3Case({ heldCare: false });
  const sent = churchSent(eng, C, MEALS_D);
  assert.equal(sent.length, 1, 'the meals/care setting was not carried: ' + JSON.stringify(r.carry));
  const body = JSON.parse(sent[0].content);
  assert.equal(body.adminGroupId, careId, 'THE CARE TEAM POINTER WAS KEPT AS SHE LEFT IT (answer q): ' + sent[0].content);
  assert.equal(body.visibility, 'team', 'the rest of her setting was not kept as she left it');
  assert.equal(body.openedBy, 'member');
  assert.equal(why(r, MEALS_D).length, 0, 'a setting that was kept is also listed as not kept');
});

test('F3 — lost Care, and the church never saved a care setting of its own (answer t): not kept, and listed', async () => {
  const { C, eng, r } = await f3Case({ heldCare: false, churchMeals: false });
  assert.equal(churchSent(eng, C, MEALS_D).length, 0, 'a setting naming HER care team was re-signed under the church');
  assert.deepEqual(why(r, MEALS_D).map(n => n.why), ['no-care'], JSON.stringify(r.carry.notCarried));
  assert.match(why(r, MEALS_D)[0].label, /the meals and care setting/);
});

test('F3 — POINT OF USE: after the removal, the care team list the owner console builds comes from the church’s own roster', async () => {
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

// ══ AUDIT OF 1fc01a16 (2026-11-19): the care guard, settled ═══════════════════════════════════════════════════════════
// HIGH 1 — an empty care team list is two things: the church has NO care team (every other team list is an ordinary one
// and IS carried), or nobody can say. RE-AUDIT OF aa495a0f (MED): the carry decides which from ITS OWN read — its first
// slice always asks for meals-settings, and the care team counts as known only if every relay answered that completely.
// What StewardMeals read at console start is never enough: its EOSE also fires when every relay connection failed.
async function scopedHelperCase({ meals, extraRelay, careRoster }) {
  const C = await churchOn(1, 'f3-none');
  const extra = extraRelay ? { relays: () => [C.relays[0].wsUrl, extraRelay] } : {};
  const eng = owner(C, extra);
  // THE CONSOLE AS A FAILED START LEAVES IT: no care team read (''). (It also used to claim "known" from an EOSE that was a
  // failure — StewardMeals.careTeamKnown, removed in 3b1392a6; nothing reads such a flag now.)
  eng.window.StewardMeals = { careTeamId: () => '' };
  const sam = await newSteward(C);
  await setRoster(eng, [sam.pub], { [sam.pub]: ['content', 'members'] });   // never held Care
  const team = C.cp.slice(0, 16) + (careRoster ? '-care' : '-worship');
  if (meals) await mustPut(C, raw(C, C.church, MEALS_D, { enabled: true, adminGroupId: team }, { tagChurch: false }));   // the church's care team IS this team
  await mustPut(C, raw(C, sam, ROSTER_D + team, { pubs: [H.key().pub] }));   // the only thing they changed
  const r = await eng._removeStewardKeeping(sam.pub, { limitMs: 6000 });
  assert.ok(r.wrote, 'the removal did not land');
  return { C, eng, r, d: ROSTER_D + team };
}
test('HIGH 1 — a church with NO care team (the carry’s own read answered): a helper who never had Care keeps their team list', async () => {
  const { C, eng, r, d } = await scopedHelperCase({});
  assert.equal(churchSent(eng, C, d).length, 1, 'AN ORDINARY TEAM LIST WAS TREATED AS THE CARE TEAM’S: ' + JSON.stringify(r.carry.notCarried));
  assert.equal(why(r, d).length, 0);
});
test('MED (re-audit) — console started with every relay failing ("known", careTeamId \'\'), relays answer at removal: the care roster is NOT carried, and is listed', async () => {
  // the church's care team is named only by its own meals-settings, which this console never read
  const { C, eng, r, d } = await scopedHelperCase({ careRoster: true, meals: true });
  assert.equal(churchSent(eng, C, d).length, 0, 'A HELPER WITHOUT CARE HAD THE CARE TEAM’S ROSTER CARRIED (F3 again, via a failed console start)');
  assert.deepEqual(why(r, d).map(n => n.why), ['no-care'], JSON.stringify(r.carry.notCarried));
  assert.match(why(r, d)[0].label, /^the care team list \(they no longer had the Care permission\)$/);
});
test('HIGH 1 — the carry’s own care-team read NOT complete (a second relay never answers): the team list is not carried, and is listed', async () => {
  const { C, eng, r, d } = await scopedHelperCase({ extraRelay: 'ws://127.0.0.1:9/relay' });
  assert.equal(churchSent(eng, C, d).length, 0, 'carried although no complete read said which team is the care team');
  // under today's strict rule (until F1) an incomplete slice lists every document as 'incomplete'; once F1 carries from a
  // partial answer, this roster must be listed with the "had not yet read which team is the care team" label instead
  assert.equal(why(r, d).length, 1, JSON.stringify(r.carry.notCarried));
});

// AUDIT LOW (2026-11-19, branch fix/removed-steward-care-batch-gate) — the care team is NOT known when the first slice (the
// one that asks for meals-settings) came back incomplete, even if careIds is not empty. Here careIds holds only HER pointer
// (her own meals-settings, read in phase A); the church's meals-settings — naming the real care team — is in the first slice,
// whose answer is cut off (no events, not complete: what a relay that drops the login mid-read gives). The church's care
// roster she changed is her NEWEST document, so it lands in slice 2, which answers whole.
test('LOW (batch gate) — slice 1 incomplete, slice 2 whole, careIds = only her pointer: the church’s care roster is NOT carried, and is listed', async () => {
  const C = await churchOn(1, 'f3-gate');
  const eng = owner(C);
  const careTeam = C.cp.slice(0, 16) + '-care', hers = C.cp.slice(0, 16) + '-hers';
  eng.window.StewardMeals = { careTeamId: () => '' };
  const kim = await newSteward(C);
  await setRoster(eng, [kim.pub], { [kim.pub]: ['care', 'content'] });
  await mustPut(C, raw(C, C.church, MEALS_D, { enabled: true, adminGroupId: careTeam }, { tagChurch: false }));
  await mustPut(C, raw(C, kim, MEALS_D, { enabled: true, adminGroupId: hers }));
  for (let i = 0; i < 61; i++) await mustPut(C, raw(C, kim, GROUP_D + C.cp.slice(0, 16) + '-g' + i, { name: 'Group ' + i }));
  await mustPut(C, raw(C, kim, ROSTER_D + careTeam, { pubs: [H.key().pub] }));
  await setRoster(eng, [kim.pub], { [kim.pub]: ['content'] });
  // THE STUB: the first phase-B question (the one carrying meals-settings) is answered with nothing and not complete
  const realSub = eng.pool.subscribeMany.bind(eng.pool), realAuthed = eng._keyReadAuthedOn;
  let cut = 0, cutting = false;
  eng.pool.subscribeMany = (urls, filters, h) => {
    const f = filters[0] || {};
    if (!cut && Array.isArray(f['#d']) && f['#d'].includes(MEALS_D)) {
      cut++; cutting = true;
      return realSub(urls, filters, { ...h, onevent() {}, oneose() { h.oneose && h.oneose(); } });
    }
    return realSub(urls, filters, h);
  };
  eng._keyReadAuthedOn = (u) => { if (cutting) { cutting = false; return false; } return realAuthed(u); };
  const r = await eng._removeStewardKeeping(kim.pub);
  assert.ok(r.wrote);
  assert.equal(cut, 1, 'FIXTURE: the first slice was not the one cut');
  assert.ok(why(r, MEALS_D).some(n => n.why === 'incomplete'), 'FIXTURE: slice 1 was not incomplete: ' + JSON.stringify(r.carry.notCarried.slice(0, 3)));
  assert.equal(r.carry.carried.filter(c => c.d.startsWith(GROUP_D)).length >= 1, true, 'FIXTURE: slice 2 did not answer whole');
  assert.equal(churchSent(eng, C, ROSTER_D + careTeam).length, 0, 'THE CHURCH’S CARE ROSTER WAS CARRIED WHILE THE CARE TEAM WAS NOT KNOWN (F3 again)');
  assert.deepEqual(why(r, ROSTER_D + careTeam).map(n => n.why), ['no-care']);
  assert.match(why(r, ROSTER_D + careTeam)[0].label, /^a team list \(they no longer had the Care permission, and this console had not yet read which team is the care team\)$/);
});

// LOW 5 — meals-settings is decided FIRST. Her OWN meals-settings is known from phase A already; what only phase B can show
// is ANOTHER author's copy — here the church's, naming team `churchTeam`, which this console's StewardMeals has not caught up
// with (careTeamId() still answers an older team). She has more than one slice (60) of documents: the church's care team
// roster is her OLDEST, her meals-settings her NEWEST, and the carry takes her documents in the order this relay answers
// them, oldest first (measured: without the ordering, meals-settings landed last) — so without the ordering the roster is
// decided in slice 1, before slice 2 shows the church's copy naming it as the care team.
test('LOW 5 — over 60 documents: the care team named only by the CHURCH’s meals-settings copy is still not carried', async () => {
  const C = await churchOn(1, 'f3-slices');
  const eng = owner(C);
  const stale = C.cp.slice(0, 16) + '-oldcare', churchTeam = C.cp.slice(0, 16) + '-care', hers = C.cp.slice(0, 16) + '-hers';
  eng.window.StewardMeals = { careTeamId: () => stale };
  const kim = await newSteward(C);
  await setRoster(eng, [kim.pub], { [kim.pub]: ['care', 'content'] });
  await mustPut(C, raw(C, C.church, MEALS_D, { enabled: true, adminGroupId: churchTeam }, { tagChurch: false }));
  await mustPut(C, raw(C, kim, ROSTER_D + churchTeam, { pubs: [H.key().pub] }));
  for (let i = 0; i < 61; i++) await mustPut(C, raw(C, kim, GROUP_D + C.cp.slice(0, 16) + '-g' + i, { name: 'Group ' + i }));
  await mustPut(C, raw(C, kim, MEALS_D, { enabled: true, visibility: 'team', adminGroupId: hers }));
  await setRoster(eng, [kim.pub], { [kim.pub]: ['content'] });
  const r = await eng._removeStewardKeeping(kim.pub);
  assert.ok(r.wrote);
  assert.equal(r.carry.carried.filter(c => c.d.startsWith(GROUP_D)).length, 61, 'FIXTURE: not every group was carried: ' + JSON.stringify(r.carry.notCarried));
  assert.equal(churchSent(eng, C, ROSTER_D + churchTeam).length, 0, 'THE ROSTER WAS DECIDED BEFORE THE CHURCH’S meals-settings SHOWED IT IS THE CARE TEAM');
  assert.deepEqual(why(r, ROSTER_D + churchTeam).map(n => n.why), ['no-care']);
});

// LOW 6 — her WITHDRAWN meals-settings (no Care): not carried, listed as no-care. Carrying it would withdraw the church's own
// setting, and with it the church's care team choice — which answer (m) says a helper without Care does not decide.
test('LOW 6 — lost Care, her meals/care setting withdrawn: not carried, listed as no-care, the church’s own setting stands', async () => {
  const C = await churchOn(1, 'f3-tomb');
  const [X] = C.relays;
  const eng = owner(C);
  const careId = C.cp.slice(0, 16) + '-care';
  eng.window.StewardMeals = { careTeamId: () => careId };
  const kim = await newSteward(C);
  await setRoster(eng, [kim.pub], { [kim.pub]: ['care', 'content'] });
  await mustPut(C, raw(C, C.church, MEALS_D, { enabled: true, adminGroupId: careId }, { tagChurch: false }));
  await mustPut(C, raw(C, kim, MEALS_D, '', { tags: [['deleted', '1']] }));
  await setRoster(eng, [kim.pub], { [kim.pub]: ['content'] });
  const r = await eng._removeStewardKeeping(kim.pub);
  assert.ok(r.wrote);
  assert.equal(churchSent(eng, C, MEALS_D).length, 0, 'her withdrawal was re-issued under the church');
  assert.deepEqual(why(r, MEALS_D).map(n => n.why), ['no-care'], 'listed for the wrong reason: ' + JSON.stringify(r.carry.notCarried));
  assert.equal(JSON.parse((await churchCopy(C, MEALS_D, X)).content).adminGroupId, careId, 'the church’s own setting was withdrawn');
});

// OWNER ANSWER (t), second case — the church's own care team choice, put back, names a team that no longer exists
async function teamGoneCase({ churchAid, groups }) {
  const C = await churchOn(1, 'f3-gone');
  const eng = owner(C);
  eng.window.StewardMeals = { careTeamId: () => churchAid };
  if (groups) eng._lastGroups = { cp: C.cp, list: Object.assign(groups.map(id => ({ id, name: id })), { _fresh: true }) };
  const kim = await newSteward(C);
  await setRoster(eng, [kim.pub], { [kim.pub]: ['care', 'content'] });
  await mustPut(C, raw(C, C.church, MEALS_D, { enabled: true, adminGroupId: churchAid }, { tagChurch: false }));
  await mustPut(C, raw(C, kim, MEALS_D, { enabled: true, visibility: 'team', adminGroupId: C.cp.slice(0, 16) + '-hers' }));
  await setRoster(eng, [kim.pub], { [kim.pub]: ['content'] });
  const r = await eng._removeStewardKeeping(kim.pub);
  assert.ok(r.wrote && churchSent(eng, C, MEALS_D).length === 1, 'FIXTURE: the setting was not carried: ' + JSON.stringify(r.carry));
  return r.carry.notes || [];
}
const GONE = /^Their care setting was kept, but it names a care team that no longer exists — help requests go only to you until you choose a team\.$/;
test('answer (t) — the church’s care team is gone from the loaded group list: the carry says so', async () => {
  const notes = await teamGoneCase({ churchAid: 'deleted-team', groups: ['other-team'] });
  assert.equal(notes.length, 1, 'nothing says the kept setting names a team that no longer exists');
  assert.match(notes[0], GONE);
});
test('answer (t) — the church never chose a care team (\'\'): the carry says THAT, not "no longer exists"', async () => {
  for (const groups of [null, ['other-team']]) {
    const notes = await teamGoneCase({ churchAid: '', groups });
    assert.equal(notes.length, 1, 'nothing said (group list ' + (groups ? 'loaded' : 'not loaded') + ')');
    assert.match(notes[0], /^Their care setting was kept, but your church hasn’t chosen a care team — help requests go only to you\.$/);
  }
});
test('answer (t) — CONTROLS: the team exists → nothing said; the group list not loaded → nothing said (never a guess)', async () => {
  assert.deepEqual(await teamGoneCase({ churchAid: 'care-team', groups: ['care-team'] }), []);
  assert.deepEqual(await teamGoneCase({ churchAid: 'care-team', groups: null }), []);
});

// LOW 4 — a lost OK that the re-read confirms LANDED: the engine's own roster follows it at once (not only on an
// acknowledged write). _settleStewardRemoval lifted out of the bundle and run.
test('LOW 4 — OK lost, re-read says landed: _careRoster, _stewardCaps, _justRemoved and the ex-helper record are updated', async () => {
  const body = fnBody(STEWARD, 'async function _settleStewardRemoval(who, o) {', '_settleStewardRemoval');
  const A = 'a'.repeat(64), Bk = 'b'.repeat(64);
  const remembered = [];
  const scope = { now: () => 1_800_000_000, _careRoster: new Set([A, Bk]), _stewardCaps: { [A]: ['care'], [Bk]: ['content'] }, _justRemoved: new Map(),
    _rememberExStewards: (before, after, at) => remembered.push({ before, after, at }),
    window: { Steward: { stewardRemovalOutcome: async () => 'landed', publishStewardRevoke: () => Promise.resolve(true), markStewardRequestHandled: () => Promise.resolve(true) } } };
  const settle = new Function('scope', 'with (scope) { ' + body + '\nreturn _settleStewardRemoval; }')(scope);
  const out = await settle(A, { wrote: false, before: [A, Bk], next: [Bk], caps: { [Bk]: ['content'] }, capsOnly: false, since: 0 });
  assert.equal(out, 'landed');
  assert.deepEqual([...scope._careRoster], [Bk], 'the engine still holds them on the roster after a confirmed removal');
  assert.deepEqual(scope._stewardCaps, { [Bk]: ['content'] });
  assert.equal(scope._justRemoved.get(A), 1_800_000_000, 'a stale roster echo could put them back');
  assert.equal(remembered.length, 1, 'the removal was not remembered (isOrWasSteward)');
  // CONTROL: 'unknown' changes nothing
  const scope2 = { ...scope, _careRoster: new Set([A, Bk]), _justRemoved: new Map(), window: { Steward: { ...scope.window.Steward, stewardRemovalOutcome: async () => 'unknown' } } };
  const settle2 = new Function('scope', 'with (scope) { ' + body + '\nreturn _settleStewardRemoval; }')(scope2);
  assert.equal(await settle2(A, { wrote: false, before: [A, Bk], next: [Bk], caps: {}, capsOnly: false, since: 0 }), 'unknown');
  assert.deepEqual([...scope2._careRoster], [A, Bk]);
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
