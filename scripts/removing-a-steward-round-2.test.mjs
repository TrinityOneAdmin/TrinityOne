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
import { finalizeEvent, verifyEvent } from 'nostr-tools/pure';
import * as H from './relay-network-harness.mjs';
import { STEWARD, authedPool, consoleEngine } from './steward-carry-rig.mjs';
import { compiled, membersGlobals, press, reads, SCH } from './dash-render-kit.mjs';
import { fnBody, stmt } from './test-slice.mjs';
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

// ══ F1 — a silent relay must not stop the carry (owner answer k), once every relay runs the newest-wins build (s) ══════
// THE CONSOLE'S MEMORY OF WHICH RELAYS SAID "liveNewest" (owner answer s, plan 0d H-s): the shipped _relayLiveNewest asks
// each relay's real NIP-11 document; a yes is remembered under the URL and the identity key the admission proof gave it.
// Here the admission gate's proved key is the relay's own relayPub (what /relay-identity proves on a real console).
function proveAll(eng, relays) {
  const keys = new Map(relays.map(r => [r.wsUrl, r.relayPub]));
  eng._gate = { provedKey: (u) => keys.get(u) || '' };
  return keys;
}
async function sayYes(eng, relays) {
  proveAll(eng, relays);
  for (const r of relays) assert.equal(await eng._relayLiveNewest(r.wsUrl), true, 'FIXTURE: ' + r.name + ' did not say liveNewest');
}
const silence = async (r, how) => { if (how === 'killed') { r.proc.kill('SIGKILL'); await sleep(200); } else { frozen.add(r); r.proc.kill('SIGSTOP'); } };
const thaw = (r) => { if (frozen.has(r)) { try { r.proc.kill('SIGCONT'); } catch {} frozen.delete(r); } };
async function f1Setup(name, { yes = true } = {}) {
  const C = await churchOn(2, name);
  const eng = owner(C);
  const sam = await newSteward(C);
  await setRoster(eng, [sam.pub], { [sam.pub]: ['content'] });
  if (yes) await sayYes(eng, C.relays); else proveAll(eng, C.relays);
  const gid = C.cp.slice(0, 16) + '-youth';
  await mustPut(C, raw(C, C.church, GROUP_D + gid, { name: 'Youth Group by Hannah', leaders: [] }, { tagChurch: false }));
  const S = await mustPut(C, raw(C, sam, GROUP_D + gid, { name: 'Youth Group by Sam', leaders: [sam.pub] }));
  return { C, eng, sam, gid, S, r1: C.relays[0], r2: C.relays[1] };
}
async function f1Case(how, verb = 'remove') {
  const { C, eng, sam, gid, S, r1, r2 } = await f1Setup('f1-' + how + '-' + verb);
  await silence(r2, how);
  try {
    const t0 = Date.now();
    let r;
    if (verb === 'remove') { r = await eng._removeStewardKeeping(sam.pub, { limitMs: 8000 }); assert.ok(r.wrote, 'the roster write did not land on r1'); r = r.carry; }
    else {
      eng.window.Steward.setBlocked = async (list) => { const e = finalizeEvent({ kind: 30078, created_at: Math.floor(Date.now() / 1000), tags: [['d', BLOCKED_D + C.cp], ['t', NET]], content: JSON.stringify({ pubkeys: list }) }, C.church.sk); return (await putAll(C, e, [r1]))[0] ? e : false; };
      eng.window.Steward.stewardRemovalOutcome = async () => 'unknown';
      const b = await eng._blockStewardKeeping(sam.pub, [], { limitMs: 8000 });
      assert.ok(b.blocked, 'the block did not land on r1'); r = b.carry;
    }
    const took = Date.now() - t0;
    assert.ok(took < 11000, 'the carry was not bounded by its limit: ' + took + ' ms');
    const kept = await churchCopy(C, GROUP_D + gid, r1);
    assert.ok(kept, 'NOTHING WAS CARRIED with r2 ' + how + ' (sim F1): ' + JSON.stringify(r.notCarried));
    assert.equal(JSON.parse(kept.content).name, 'Youth Group by Sam', 'r1 reverted to the church’s older copy');
    assert.equal(kept.created_at, S.created_at + 1, 'the church copy is not dated exactly one second after the helper’s save (answer k)');
    if (verb === 'block') assert.deepEqual(JSON.parse(kept.content).leaders, [], 'a BLOCKED person is still a leader (answer f)');
  } finally { thaw(r2); }
}
test('F1 (T-F1a) — r2 OFF (connection refused): Remove keeps the helper’s group on r1, dated S+1', () => f1Case('killed'));
test('F1 (T-F1b) — r2 ASLEEP (SIGSTOP): the carry finishes inside its limit and keeps the helper’s group on r1, dated S+1', () => f1Case('frozen'));
test('F1 (T-F1a) — r2 OFF: Block keeps the helper’s group on r1, dated S+1, without them on it', () => f1Case('killed', 'block'));

// (s): only once EVERY relay has said yes. A relay that never answered the probe → the strict rule.
test('F1 (s) — a relay that never said liveNewest: r2 off → the STRICT rule (nothing carried from a partial answer, listed)', async () => {
  const { C, eng, sam, gid, r1, r2 } = await f1Setup('f1-strict', { yes: false });
  assert.equal(await eng._relayLiveNewest(r1.wsUrl), true, 'FIXTURE: r1 did not answer');   // r1 yes, r2 never asked
  await silence(r2, 'killed');
  const r = await eng._removeStewardKeeping(sam.pub, { limitMs: 6000 });
  assert.equal(churchSent(eng, C, GROUP_D + gid).length, 0, 'carried from a partial answer although r2 never said it runs newest-wins');
  assert.deepEqual(why(r.carry, GROUP_D + gid).map(n => n.why), ['incomplete']);
});
test('F1 (s) — r2 said yes, then went off, and the console RELOADED: the remembered yes still counts → rule (k)', async () => {
  const { C, eng, sam, gid, S, r1, r2 } = await f1Setup('f1-reload');
  const eng2 = owner(C);   // a reload: a fresh engine over the SAME browser storage
  eng2._ls = eng._ls; proveAll(eng2, C.relays); await setRoster(eng2, [sam.pub], { [sam.pub]: ['content'] });
  await silence(r2, 'killed');
  const r = await eng2._removeStewardKeeping(sam.pub, { limitMs: 6000 });
  const kept = await churchCopy(C, GROUP_D + gid, r1);
  assert.ok(kept && kept.created_at === S.created_at + 1, 'the remembered yes did not survive a reload: ' + JSON.stringify(r.carry.notCarried));
});
test('F1 (s) — a probe that gets NO answer is not remembered, and is asked again: frozen → null; thawed → yes', async () => {
  const C = await churchOn(1, 'f1-retry');
  const eng = owner(C); proveAll(eng, C.relays);
  const [r] = C.relays;
  frozen.add(r); r.proc.kill('SIGSTOP');
  try { assert.equal(await eng._relayLiveNewest(r.wsUrl), null, 'a silent relay was given an answer'); assert.equal(eng._relaysAllLiveNewest([r.wsUrl]), false); }
  finally { thaw(r); }
  assert.equal(await eng._relayLiveNewest(r.wsUrl), true, 'the relay was not asked again once it answered');
  assert.equal(eng._relaysAllLiveNewest([r.wsUrl]), true);
});
test('F1 (s) — a relay answering WITHOUT the field (an older build) clears a remembered yes; another key at that URL inherits nothing', async () => {
  const C = await churchOn(1, 'f1-clear');
  const eng = owner(C);
  const [r] = C.relays;
  proveAll(eng, [r]); assert.equal(await eng._relayLiveNewest(r.wsUrl), true);
  // the same address now proving a DIFFERENT identity key: not remembered for it
  eng._gate = { provedKey: () => 'f'.repeat(64) };
  assert.equal(eng._relaysAllLiveNewest([r.wsUrl]), false, 'a different box at the address inherited the yes');
  // an older build at an address that said yes before
  const old = await H.startOldRelay({ name: 'f1-old', churches: [C.cp] });
  const keys = new Map([[old.wsUrl, old.relayPub]]);
  eng._gate = { provedKey: (u) => keys.get(u) || '' };
  eng._ls.set(eng._liveNewestKey(old.wsUrl, old.relayPub), JSON.stringify({ liveNewest: 1 }));   // remembered from before a downgrade
  assert.equal(eng._relaysAllLiveNewest([old.wsUrl]), true, 'FIXTURE: the yes was not remembered');
  assert.equal(await eng._relayLiveNewest(old.wsUrl), false, 'the older build was not read as "no"');
  assert.equal(eng._relaysAllLiveNewest([old.wsUrl]), false, 'a box that no longer says liveNewest kept its remembered yes');
});

// T-F1c — THE SAFETY CASE. r2 holds a copy NEWER than the helper's (by a DIFFERENT author: (i) another rostered helper,
// (ii) a second owner console); r2 is silent during the Remove, which carries S+1 to r1; r2 comes back and the copies
// meet. The newer copy must govern on BOTH relays — the relay's own decisions (a child's post into the group is
// accepted only while the governing copy says child-safe), before and after r2 restarts.
async function safetyCase(rivalBy, { tomb = false } = {}) {
  const C = await churchOn(2, 'f1c-' + rivalBy + (tomb ? '-tomb' : ''));
  const [r1, r2] = C.relays;
  const eng = owner(C);
  const sam = await newSteward(C), eve = await newSteward(C), child = H.key();
  await mustPut(C, finalizeEvent({ kind: 30078, created_at: T(), tags: [['d', MEMBER_D + C.cp], ['t', NET]], content: JSON.stringify({ joined: T() }) }, child.sk));
  await mustPut(C, raw(C, C.church, 'trinityone/minors:' + C.cp, { pubkeys: [child.pub] }, { tagChurch: false }));
  await setRoster(eng, [sam.pub, eve.pub], { [sam.pub]: ['content'], [eve.pub]: ['content'] });
  await sayYes(eng, C.relays);
  const gid = C.cp.slice(0, 16) + '-room';
  const S = await mustPut(C, tomb ? raw(C, sam, GROUP_D + gid, '', { tags: [['deleted', '1'], ['for', C.cp]] }) : raw(C, sam, GROUP_D + gid, { name: 'Room', childsafe: true }));
  const rivalAuthor = rivalBy === 'helper' ? eve : C.church;
  const R = raw(C, rivalAuthor, GROUP_D + gid, { name: 'Room (adults)' }, { at: S.created_at + 5, tagChurch: rivalBy === 'helper' });   // newer, adults-only
  assert.equal((await putOne(R, r2))[0], true, 'FIXTURE: the rival copy was refused by r2');
  await silence(r2, 'killed');
  const r = await eng._removeStewardKeeping(sam.pub, { limitMs: 6000 });
  const carried = churchSent(eng, C, GROUP_D + gid);
  assert.equal(carried.length, 1, 'FIXTURE: nothing carried to r1: ' + JSON.stringify(r.carry.notCarried));
  assert.equal(carried[0].created_at, S.created_at + 1);
  if (tomb) assert.deepEqual(carried[0].tags.find(t => t[0] === 'for'), ['for', '*'], 'the church’s withdrawal does not name every copy');
  // r2 comes back (same data, new process — started after the last gateway.mjs edit) and the copies meet both ways
  const r2b = await H.moveRelay(r2);
  await putOne(carried[0], r2b);
  await putOne(R, r1);
  const childPosts = async (relay) => (await putOne(finalizeEvent({ kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [['t', NET], ['t', gid]], content: 'hi ' + Math.random() }, child.sk), relay))[0] === true;
  for (const [relay, label] of [[r1, 'r1'], [r2b, 'r2']]) assert.equal(await childPosts(relay), false, label + ': THE CARRIED S+1 COPY OVERRODE A NEWER COPY BY ' + rivalBy + (tomb ? ' (withdrawal)' : ''));
  const r2c = await H.moveRelay(r2b);
  assert.equal(await childPosts(r2c), false, 'r2 after a restart: the older carried copy governs');
  return { C, r1, r2: r2c };
}
test('F1 (T-F1c) — a NEWER copy by another rostered helper on the silent box wins on both relays after they meet, before and after restart', () => safetyCase('helper'));
test('F1 (T-F1c) — a NEWER copy by a second owner console on the silent box wins on both relays after they meet', () => safetyCase('church'));
test('F1 (T-F1c) — tombstone variant: the church’s withdrawal at S+1 (for:*) does not withdraw a newer live copy', () => safetyCase('helper', { tomb: true }));

// T-F1d — a TIE with another author in the answers (exactly S) is never carried, in the partial-answer rule too
test('F1 (T-F1d) — r2 off, another author’s copy at exactly S on r1: not carried, listed as a tie', async () => {
  const { C, eng, sam, gid, S, r2 } = await f1Setup('f1d');
  const eve = await newSteward(C);
  await setRoster(eng, [sam.pub, eve.pub], { [sam.pub]: ['content'], [eve.pub]: ['content'] });
  await mustPut(C, raw(C, eve, GROUP_D + gid, { name: 'same second' }, { at: S.created_at }), [C.relays[0]]);
  await silence(r2, 'killed');
  const r = await eng._removeStewardKeeping(sam.pub, { limitMs: 6000 });
  assert.equal(churchSent(eng, C, GROUP_D + gid).length, 0);
  assert.deepEqual(why(r.carry, GROUP_D + gid).map(n => n.why), ['tie']);
});
// T-F1e / R-H2 — this console's OWN accepted copy: later than S+1 = the church's newer edit (superseded); exactly S+1 = an
// earlier attempt of this carry, re-signed (the same event — the relay answers duplicate)
test('F1 (T-F1e) — _lastOk later than S+1: superseded, not re-signed; exactly S+1: re-signed and kept', async () => {
  const { C, eng, sam, gid, S } = await f1Setup('f1e');
  eng._lastOk.set(GROUP_D + gid, S.created_at + 3);
  const a = await eng._carryOverStewardDocs(sam.pub, { limitMs: 6000 });
  assert.equal(churchSent(eng, C, GROUP_D + gid).length, 0, 'the church’s own newer edit was overwritten by their older one');
  assert.ok(a.superseded.includes(GROUP_D + gid), JSON.stringify(a));
  eng._lastOk.set(GROUP_D + gid, S.created_at + 1);
  const b = await eng._carryOverStewardDocs(sam.pub, { limitMs: 6000 });
  assert.ok(b.carried.some(c => c.d === GROUP_D + gid && c.ev.created_at === S.created_at + 1), 'an earlier attempt’s own S+1 stopped the carry: ' + JSON.stringify(b));
});
// T-F1f / R-H2 — the first attempt's publish is refused; the second Remove still carries
test('F1 (T-F1f) — first carry’s publish refused, second attempt still carries at S+1', async () => {
  const { C, eng, sam, gid, S } = await f1Setup('f1f');
  const real = eng.publish; let refused = 0;
  eng.publish = async (e, o) => { if (dOf(e) === GROUP_D + gid && e.pubkey === C.cp && !refused++) { if (o) o.reason = 'error: try later'; return false; } return real(e, o); };
  const a = await eng._carryOverStewardDocs(sam.pub, { limitMs: 6000 });
  assert.deepEqual(why(a, GROUP_D + gid).map(n => n.why), ['refused']);
  const b = await eng._carryOverStewardDocs(sam.pub, { limitMs: 6000 });
  assert.ok(b.carried.some(c => c.d === GROUP_D + gid && c.ev.created_at === S.created_at + 1), JSON.stringify(b));
});
// T-F1g — r2 sends the rival copy and then stalls before EOSE: its partial answer still counts as a rival
test('F1 (T-F1g) — r2 sends a newer rival then stalls before EOSE: not carried (a partial answer’s rival counts)', async () => {
  const { C, eng, sam, gid, S, r2 } = await f1Setup('f1g');
  const eve = await newSteward(C);
  await setRoster(eng, [sam.pub, eve.pub], { [sam.pub]: ['content'], [eve.pub]: ['content'] });
  await mustPut(C, raw(C, eve, GROUP_D + gid, { name: 'eve, later' }, { at: S.created_at + 2 }), [r2]);
  const realSub = eng.pool.subscribeMany.bind(eng.pool);
  eng.pool.subscribeMany = (urls, filters, h) => (urls.length === 1 && urls[0] === r2.wsUrl && (filters[0] || {})['#d'])
    ? realSub(urls, filters, { ...h, oneose() {} })   // events arrive; the end never does
    : realSub(urls, filters, h);
  const r = await eng._carryOverStewardDocs(sam.pub, { limitMs: 6000 });
  assert.equal(churchSent(eng, C, GROUP_D + gid).length, 0, 'carried over a newer copy a relay showed before it stalled');
  // Eve is still a helper: her newer copy is honoured as it stands (superseded — nothing of Sam's changes back)
  assert.ok(r.superseded.includes(GROUP_D + gid), JSON.stringify(r));
});

// ══ FABLE AUDIT OF THE F1 ROUND — owner answer (u): rule (k) only where relay AND readers keep the newest ══════════════
const CARRY_LISTS = () => {
  const C = new Function(stmt(STEWARD, 'var STEWARD_CARRY = ', 'STEWARD_CARRY') + '\nreturn STEWARD_CARRY;')();
  const R = new Function(stmt(STEWARD, 'var STEWARD_CARRY_RULE = ', 'STEWARD_CARRY_RULE') + '\nreturn STEWARD_CARRY_RULE;')();
  return { C, R };
};
test('(u) — every carried type is classified EXACTLY once: newest (rule k) or strict; the owner’s strict list is strict', () => {
  const { C, R } = CARRY_LISTS();
  const all = [...C.carry, ...C.remint];
  for (const t of all) {
    const n = (R.newest.includes(t) ? 1 : 0) + (R.strict.includes(t) ? 1 : 0);
    assert.equal(n, 1, t + ' is classified ' + n + ' times — a carried type needs a decision before it may be kept from a partial answer');
  }
  for (const t of [...R.newest, ...R.strict]) assert.ok(all.includes(t), t + ' is classified but not carried');
  for (const t of ['trinityone/joinpolicy:', 'trinityone/nophoto:', 'trinityone/sermon:', 'trinityone/plan:', 'trinityone/devotional:', 'trinityone/event:', 'trinityone/care:', 'trinityone/request:'])
    assert.ok(R.strict.includes(t), t + ' must stay STRICT (owner answer u)');
});
test('(u) — r2 off, every relay said yes: a STRICT type (a reading plan) is not kept and is listed; a newest type (a group) is kept', async () => {
  const { C, eng, sam, gid, S, r1, r2 } = await f1Setup('f1u');
  const plan = 'trinityone/plan:' + C.cp.slice(0, 16) + '-lent';
  await mustPut(C, raw(C, sam, plan, { title: 'Lent' }));
  await silence(r2, 'killed');
  const r = await eng._removeStewardKeeping(sam.pub, { limitMs: 6000 });
  assert.equal(churchSent(eng, C, plan).length, 0, 'A STRICT TYPE WAS CARRIED FROM A PARTIAL ANSWER');
  assert.deepEqual(why(r.carry, plan).map(n => n.why), ['incomplete']);
  const kept = await churchCopy(C, GROUP_D + gid, r1);
  assert.ok(kept && kept.created_at === S.created_at + 1, 'CONTROL: the newest-wins type was not carried: ' + JSON.stringify(r.carry.notCarried));
});
// MED-1 — "every relay the church uses" is every CONFIGURED relay, not only the ones proved so far
test('MED-1 — a configured relay that is not admitted (not proved) means the STRICT rule, even when every admitted one said yes', async () => {
  const { C, eng, sam, gid, r2 } = await f1Setup('f1-med1');
  const urls = C.relays.map(r => r.wsUrl);
  eng.relaysRaw = () => [...urls, 'wss://not-proved.example/relay'];   // configured, never admitted — nothing dials it
  await silence(r2, 'killed');
  const r = await eng._removeStewardKeeping(sam.pub, { limitMs: 6000 });
  assert.equal(churchSent(eng, C, GROUP_D + gid).length, 0, 'CARRIED FROM A PARTIAL ANSWER ALTHOUGH A CONFIGURED RELAY NEVER SAID newest-wins');
  assert.deepEqual(why(r.carry, GROUP_D + gid).map(n => n.why), ['incomplete']);
  assert.ok(!eng._pool.asked.some(a => a.urls.includes('wss://not-proved.example/relay')), 'the unproved relay was dialled (rule 10)');
});

// MED-2 — a frozen relay must not starve later slices: more than 60 documents, r2 asleep
test('MED-2 — r2 ASLEEP and 63 documents (two slices): every one is carried at S+1 inside the limit', async () => {
  const { C, eng, sam, gid, S, r1, r2 } = await f1Setup('f1-med2');
  const extra = [];
  for (let i = 0; i < 62; i++) extra.push(await mustPut(C, raw(C, sam, GROUP_D + C.cp.slice(0, 16) + '-m' + i, { name: 'Group ' + i })));
  await silence(r2, 'frozen');
  try {
    const t0 = Date.now();
    const r = await eng._removeStewardKeeping(sam.pub, { limitMs: 12000 });
    assert.ok(Date.now() - t0 < 15000, 'not bounded by its limit');
    const carried = new Set(r.carry.carried.map(c => c.d));
    const missing = [GROUP_D + gid, ...extra.map(dOf)].filter(d => !carried.has(d));
    assert.deepEqual(missing.length, 0, 'ONE FROZEN BOX CUT THE CARRY SHORT — not carried: ' + missing.length + ' ' + JSON.stringify(r.carry.notCarried.slice(0, 3)));
    void S; void r1;
  } finally { thaw(r2); }
});
test('MED-2 — r2 answers phase A, then STALLS in phase B (no EOSE) and 63 documents: each slice its own share, every one carried', async () => {
  const { C, eng, sam, gid, r2 } = await f1Setup('f1-med2b');
  const extra = [];
  for (let i = 0; i < 62; i++) extra.push(await mustPut(C, raw(C, sam, GROUP_D + C.cp.slice(0, 16) + '-n' + i, { name: 'Group ' + i })));
  const realSub = eng.pool.subscribeMany.bind(eng.pool);
  eng.pool.subscribeMany = (urls, filters, h) => (urls.length === 1 && urls[0] === r2.wsUrl && (filters[0] || {})['#d'])
    ? realSub(urls, filters, { ...h, oneose() {} })   // phase B questions: the end never comes
    : realSub(urls, filters, h);
  const r = await eng._removeStewardKeeping(sam.pub, { limitMs: 12000 });
  const carried = new Set(r.carry.carried.map(c => c.d));
  const missing = [GROUP_D + gid, ...extra.map(dOf)].filter(d => !carried.has(d));
  assert.equal(missing.length, 0, 'THE FIRST SLICE SPENT EVERY LATER SLICE’S TIME — not carried: ' + missing.length + ' ' + JSON.stringify(r.carry.notCarried.slice(0, 2)));
});
// LOW — the children list read must not eat the read window when it never answers
test('LOW — a children-list read that never answers: the care-team list is listed, everything else is still carried inside the limit', async () => {
  const C = await churchOn(1, 'f1-minors');
  const eng = owner(C);
  const kim = await newSteward(C);
  await setRoster(eng, [kim.pub], { [kim.pub]: ['care', 'content'] });
  eng.window.Steward.readMinors = () => new Promise(() => {});   // a frozen box: the read never comes back
  const gid = C.cp.slice(0, 16) + '-kg';
  await mustPut(C, raw(C, kim, GROUP_D + gid, { name: 'Kim’s group' }));
  await mustPut(C, raw(C, kim, CARETEAM_D + C.cp, { pubs: [H.key().pub] }));
  const t0 = Date.now();
  const r = await eng._carryOverStewardDocs(kim.pub, { limitMs: 8000 });
  assert.ok(Date.now() - t0 < 9500, 'not bounded');
  assert.ok(r.carried.some(c => c.d === GROUP_D + gid), 'THE CHILDREN READ ATE THE WINDOW — the group was not carried: ' + JSON.stringify(r.notCarried));
  assert.deepEqual(why(r, CARETEAM_D + C.cp).map(n => n.why), ['children-unread']);
});
// LOW — under rule (k) the church's care-team pointer only from a COMPLETE answer set
test('LOW — r2 off (rule k), a helper without Care: her meals/care setting is not kept with a pointer read from a partial answer', async () => {
  const { C, eng, sam, gid, r2 } = await f1Setup('f1-ptr');
  const careId = C.cp.slice(0, 16) + '-care';
  await setRoster(eng, [sam.pub], { [sam.pub]: ['care', 'content'] });
  await mustPut(C, raw(C, C.church, MEALS_D, { enabled: true, adminGroupId: careId }, { tagChurch: false }));
  await mustPut(C, raw(C, sam, MEALS_D, { enabled: true, visibility: 'team', adminGroupId: careId }));
  await setRoster(eng, [sam.pub], { [sam.pub]: ['content'] });
  await silence(r2, 'killed');
  const r = await eng._removeStewardKeeping(sam.pub, { limitMs: 6000 });
  assert.equal(churchSent(eng, C, MEALS_D).length, 0, 'the care pointer was taken from a partial answer');
  assert.match((why(r.carry, MEALS_D)[0] || {}).label || '', /had not yet read which team is the care team/);
  assert.ok(churchSent(eng, C, GROUP_D + gid).length === 1, 'CONTROL: rule (k) still carried the group');
});
// NIT — an answer with no trinityone block at all clears a remembered yes
test('NIT — a NIP-11 answer with NO trinityone block clears a remembered yes', async () => {
  const http = await import('node:http');
  const srv = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'application/nostr+json' }); res.end(JSON.stringify({ name: 'a plain nostr relay', supported_nips: [1] })); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  try {
    const url = 'ws://127.0.0.1:' + srv.address().port + '/relay';
    const C = await churchOn(1, 'f1-noblock');
    const eng = owner(C);
    eng._gate = { provedKey: () => 'b'.repeat(64) };
    eng._ls.set(eng._liveNewestKey(url, 'b'.repeat(64)), JSON.stringify({ liveNewest: 1 }));
    assert.equal(eng._relaysAllLiveNewest([url]), true, 'FIXTURE');
    assert.equal(await eng._relayLiveNewest(url), false);
    assert.equal(eng._relaysAllLiveNewest([url]), false, 'an answer with no trinityone block kept a remembered yes');
  } finally { srv.close(); }
});

// ══ MED-4b — the probe WIRING runs: at console start and whenever a relay comes back ═══════════════════════════════════
// The two statements that start _probeLiveNewestAll, lifted out of the bundle as they ship (with the function itself),
// run against a recording setTimeout / addEventListener. Deleting either wiring line turns this red.
test('MED-4b — the liveNewest probe runs at console start, and again on steward-relay-returned, for every relay', async () => {
  const fnSrc = fnBody(STEWARD, 'function _probeLiveNewestAll() {', '_probeLiveNewestAll');
  const at = STEWARD.indexOf('setTimeout(_probeLiveNewestAll');
  assert.ok(at > 0, 'the probe is no longer started anywhere in the bundle');
  const tryAt = STEWARD.lastIndexOf('try {', at);
  const wiring = fnBody(STEWARD, tryAt, 'the probe wiring') + ' catch (e) {}';   // the try block as shipped; its catch is empty
  const timers = [], listeners = {}, asked = [];
  const stubs = { relays: () => ['wss://a.example/relay', 'wss://b.example/relay'], _relayLiveNewest: (u) => { asked.push(u); return Promise.resolve(true); },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    window: { addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); } } };
  new Function(...Object.keys(stubs), fnSrc + '\n' + wiring)(...Object.values(stubs));
  assert.equal(timers.length, 1, 'nothing is scheduled at console start');
  timers.shift().fn();
  assert.deepEqual(asked, ['wss://a.example/relay', 'wss://b.example/relay'], 'the start-up probe did not ask every relay');
  assert.ok((listeners['steward-relay-returned'] || []).length === 1, 'no probe when a relay comes back');
  listeners['steward-relay-returned'][0]();
  assert.equal(timers.length, 1, 'a returning relay schedules nothing');
  timers.shift().fn();
  assert.equal(asked.length, 4, 'a returning relay did not probe every relay again');
});

// ══ MED-4c — the REAL admission gate and the REAL publish() ════════════════════════════════════════════════════════
// The console's own createRelayGate and its possession proof (verifyRelayIdentityDetailed: a fresh nonce, the relay's
// signed /relay-identity answer, the address bound into it), and the console's own publish() (Promise.any over relays()),
// lifted out of vendor/steward.js and run against the real gateways. Stand-ins: which relays the church SIGNS (the
// relay-net document) and the websocket transport under publish.
function realGate() {
  const B2 = (sig, n) => fnBody(STEWARD, sig, n);
  const body = [B2('function relayHttpBase', 'relayHttpBase'), B2('function relayAddrKey', 'relayAddrKey'), B2('function _relayKey(', '_relayKey'),
    stmt(STEWARD, 'var _isHex64 = ', '_isHex64'), B2('function canonicalPinsFor', 'canonicalPinsFor'), B2('function isSharedAddress', 'isSharedAddress'),
    B2('function sharedRelayKeys', 'sharedRelayKeys'), B2('function _originKey', '_originKey'), B2('function sameOriginRelay', 'sameOriginRelay'),
    B2('async function proveRelay', 'proveRelay'), stmt(STEWARD, 'var VERIFIED_KEY = ', 'VERIFIED_KEY'), stmt(STEWARD, 'var VERIFIED_TTL_SEC = ', 'VERIFIED_TTL_SEC'),
    stmt(STEWARD, 'var VERIFIED_REFRESH_SEC = ', 'VERIFIED_REFRESH_SEC'), stmt(STEWARD, 'var VERIFY_RETRY_SEC = ', 'VERIFY_RETRY_SEC'),
    B2('function readVerified', 'readVerified'), B2('function writeVerified', 'writeVerified'), B2('function admitCached', 'admitCached'),
    B2('function _scopesOf', '_scopesOf'), B2('function _admittingScope', '_admittingScope'), B2('function rememberVerified', 'rememberVerified'),
    B2('function createRelayGate', 'createRelayGate'), B2('function relayIdentityNonce', 'relayIdentityNonce'),
    B2('async function verifyRelayIdentityDetailed', 'verifyRelayIdentityDetailed'), B2('async function verifyRelayIdentity(', 'verifyRelayIdentity')].join('\n');
  return new Function('scope', `with (scope) { ${body}; return { createRelayGate, verifyRelayIdentity }; }`)({ URL, console, CANONICAL_RELAY_PUBS: {}, fetch, AbortController, setTimeout, clearTimeout, crypto, verifyEvent2: verifyEvent });
}
function realPublish(eng, relays) {
  const body = fnBody(STEWARD, 'async function publish(evt, opts) {', 'publish');
  const byUrl = new Map(relays.map(r => [r.wsUrl, r]));
  const wsPub = (url, evt) => new Promise((res, rej) => {
    H.connect(byUrl.get(url)).then((w) => {
      w.on('message', (d) => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { try { w.close(); } catch {} m[2] ? res(m[3] || '') : rej(new Error(m[3] || 'refused')); } });
      w.send(JSON.stringify(['EVENT', evt]));
    }, (e) => rej(new Error('connection failure: ' + e.message)));   // a frozen box: the handshake never completes, nothing settles
  });
  const scope = { _lastOk: eng._lastOk, _pubLatest: new Map(), NO_NETWORK_RELAY: 'no-network-relay', _waitForRegistration: async () => {},
    relays: () => eng.relays(), relaysRaw: () => eng.relaysRaw(), pool: { publish: (urls, evt) => urls.map(u => wsPub(u, evt)) },
    window: { dispatchEvent: () => true }, CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o && o.detail; } }, console: { warn() {}, log() {} } };
  return new Function('scope', `with (scope) { ${body}; return publish; }`)(scope);
}
test('MED-4c — the REAL gate proves both relays, the REAL publish() answers on the first accept: r2 asleep, the group is kept at S+1', async () => {
  const { C, eng, sam, gid, S, r1, r2 } = await f1Setup('f1-real', { yes: false });
  const L = realGate();
  const mem = new Map();
  const gate = L.createRelayGate({ store: { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)) }, verify: L.verifyRelayIdentity,
    netEntries: async () => C.relays.map(r => ({ pubkey: r.relayPub, url: r.wsUrl })), origin: '', pins: {} });
  await gate.refresh(C.relays.map(r => r.wsUrl), C.cp);
  for (const r of C.relays) assert.equal(gate.provedKey(r.wsUrl, C.cp), r.relayPub, 'FIXTURE: the real proof did not admit ' + r.name);
  eng._gate = gate;
  for (const r of C.relays) assert.equal(await eng._relayLiveNewest(r.wsUrl), true, 'the real gate’s proved key did not carry the yes for ' + r.name);
  eng.publish = realPublish(eng, C.relays);
  await silence(r2, 'frozen');
  try {
    const t0 = Date.now();
    const r = await eng._removeStewardKeeping(sam.pub, { limitMs: 8000 });
    assert.ok(r.wrote, 'the real publish() did not answer the roster write while r2 was asleep');
    assert.ok(Date.now() - t0 < 11000, 'publish() waited for the frozen relay');
    const kept = await churchCopy(C, GROUP_D + gid, r1);
    assert.ok(kept && kept.created_at === S.created_at + 1, 'NOT KEPT through the real publish(): ' + JSON.stringify(r.carry.notCarried));
  } finally { thaw(r2); }
});
test('MED-4c (R-L2) — the REAL publish(): a "newer version stored" refusal answers success only when this console holds the newer copy', async () => {
  const C = await churchOn(1, 'f1-rl2');
  const eng = owner(C);
  const pub2 = realPublish(eng, C.relays);
  const d = GROUP_D + C.cp.slice(0, 16) + '-rl2';
  const newer = raw(C, C.church, d, { name: 'church, newer' }, { tagChurch: false, at: T() + 10 });
  assert.ok(await pub2(newer), 'FIXTURE: the church copy was not stored');
  const older = raw(C, C.church, d, { name: 'church, older' }, { tagChurch: false, at: newer.created_at - 5 });
  assert.equal(eng._lastOk.get(d), newer.created_at, 'the real publish() did not record what was accepted');
  assert.ok(await pub2(older), 'a "newer version" refusal while this console HOLDS the newer copy was not answered as ours (the R-L2 superseded case)');
  eng._lastOk.delete(d);
  const po = {};
  assert.equal(await pub2(older, po), false, 'a "newer version" refusal of a copy this console does not hold was answered as success');
  assert.match(String(po.reason || ''), /newer version/, 'the refusal reason the carry classifies as "newer" is not reported');
});

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
const why = (r, d) => (r.carry || r).notCarried.filter(n => n.d === d);

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
