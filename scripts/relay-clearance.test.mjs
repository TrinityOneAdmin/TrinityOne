// The church's list of which members are CHILDREN must not be readable by the congregation.
// Run: node --test scripts/relay-clearance.test.mjs
//
// AUDIT-2026-07-27. `minors:<church>` is a cleartext {pubkeys:[…]} of the church's children, and it was served
// to any effective member. Joining an open-join church is ONE self-signed publish, so a stranger could hold a
// congregation's children in two frames. `guardians:` maps each child to their parents — the family structure.
//
// The relay still reads both itself (safeguardAllows is untouched); they are simply no longer served to
// ordinary members. `approved:` — the adults cleared to work with youth — stays readable, because a child's own
// app needs it to know who they may message, and it names leaders rather than children. Each member instead
// gets `clearance:<their pubkey>`, NIP-44 sealed to them, telling them only about themselves.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fnBody } from './test-slice.mjs';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { v2 as nip44v2 } from 'nostr-tools/nip44';
import { requireFreePort } from './test-ports.mjs';

const PORT = 8897;   // unique across scripts/*.test.mjs AND scripts/*.probe.mjs
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const MEMBER_D = 'trinityone/member:', MINORS_D = 'trinityone/minors:', GUARD_D = 'trinityone/guardians:';
const APPROVED_D = 'trinityone/approved:', CLEAR_D = 'trinityone/clearance:';
const now = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };
const church = K(), steward = K(), adult = K(), child = K(), stranger = K();
let relay, dataDir, w0;

const conn = () => new Promise((res, rej) => { const w = new WebSocket(WS_URL); w.on('open', () => res(w)); w.on('error', rej); });
const publish = (w, e) => new Promise(res => { const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === e.id) { w.off('message', on); res([m[2], m[3] || '']); } }; w.on('message', on); w.send(JSON.stringify(['EVENT', e])); });
const doc = (who, d, c, extra = []) => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', d], ['t', 'trinityone'], ...extra], content: JSON.stringify(c) }, who.sk);
function reqCollect(w, subId, filter, authSk, win = 900) {
  return new Promise(resolve => {
    const events = [];
    const on = d => { const m = JSON.parse(d);
      if (m[0] === 'EVENT' && m[1] === subId) events.push(m[2]);
      else if (m[0] === 'AUTH' && authSk) w.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', WS_URL], ['challenge', m[1]]], content: '' }, authSk)])); };
    w.on('message', on); w.send(JSON.stringify(['REQ', subId, filter]));
    setTimeout(() => { w.off('message', on); try { w.send(JSON.stringify(['CLOSE', subId])); } catch {} resolve(events); }, win);
  });
}

before(async () => {
  await requireFreePort(PORT, 'relay-clearance.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-clearance-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, RELAY_MAX_EVENTS: '5000', CHURCH_NPUB: npubEncode(church.pub) },
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) break; } catch {} await sleep(150); }
  w0 = await conn();
  for (const who of [adult, child, stranger, steward]) await publish(w0, doc(who, MEMBER_D + church.pub, { joined: now() }));
  await publish(w0, doc(church, 'trinityone/stewards:' + church.pub, { pubkeys: [steward.pub] }));
  await publish(w0, doc(church, MINORS_D + church.pub, { pubkeys: [child.pub] }));
  await publish(w0, doc(church, APPROVED_D + church.pub, { pubkeys: [adult.pub] }));
  await publish(w0, doc(church, GUARD_D + church.pub, { [child.pub]: [adult.pub] }));
  await sleep(300);
});
after(() => { try { w0 && w0.close(); } catch {} try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

test('an ordinary member cannot read the list of children', async () => {
  const w = await conn();
  const got = await reqCollect(w, 'm1', { kinds: [30078], '#d': [MINORS_D + church.pub] }, stranger.sk);
  w.close();
  assert.deepEqual(got, [], 'any member — including one who self-joined seconds ago — read the church’s list of children');
});

test('an ordinary member cannot read the parent↔child map', async () => {
  const w = await conn();
  const got = await reqCollect(w, 'g1', { kinds: [30078], '#d': [GUARD_D + church.pub] }, stranger.sk);
  w.close();
  assert.deepEqual(got, [], 'the guardians map exposes each child’s family');
});

test('a steward CAN still read them, or safeguarding stops working', async () => {
  const w = await conn();
  const mins = await reqCollect(w, 'm2', { kinds: [30078], '#d': [MINORS_D + church.pub] }, steward.sk);
  const guards = await reqCollect(w, 'g2', { kinds: [30078], '#d': [GUARD_D + church.pub] }, steward.sk);
  w.close();
  assert.equal(mins.length, 1, 'a steward must still see the minors list — this is the control');
  assert.equal(guards.length, 1, 'a steward must still see the guardians map');
});

test('the cleared-adults list stays readable, so a child’s app knows who is safe', async () => {
  const w = await conn();
  const got = await reqCollect(w, 'a1', { kinds: [30078], '#d': [APPROVED_D + church.pub] }, child.sk);
  w.close();
  assert.equal(got.length, 1, 'a child must be able to see which adults are cleared, or they can message nobody');
});

test('a member reads their OWN clearance and nobody else’s', async () => {
  const sealed = (subject, body) => finalizeEvent({
    kind: 30078, created_at: now(),
    tags: [['d', CLEAR_D + subject.pub], ['t', 'trinityone'], ['church', church.pub], ['p', subject.pub]],
    content: nip44v2.encrypt(JSON.stringify(body), nip44v2.utils.getConversationKey(church.sk, subject.pub)),
  }, church.sk);
  assert.equal((await publish(w0, sealed(child, { minor: true, cleared: false })))[0], true, 'the church must be able to publish a clearance');
  assert.equal((await publish(w0, sealed(adult, { minor: false, cleared: true })))[0], true);
  await sleep(250);

  const w = await conn();
  const mine = await reqCollect(w, 'c1', { kinds: [30078], '#d': [CLEAR_D + child.pub] }, child.sk);
  assert.equal(mine.length, 1, 'a member must receive their own clearance');
  const opened = JSON.parse(nip44v2.decrypt(mine[0].content, nip44v2.utils.getConversationKey(child.sk, church.pub)));
  assert.equal(opened.minor, true, 'the clearance must actually say what it is for');

  w.close();
  // A FRESH socket: ws._auth is per-connection and does not re-challenge once set, so reusing the child's
  // socket here would have read as the CHILD and quietly proved nothing. (It did, until I noticed.)
  const w2 = await conn();
  const theirs = await reqCollect(w2, 'c2', { kinds: [30078], '#d': [CLEAR_D + child.pub] }, stranger.sk);
  w2.close();
  assert.deepEqual(theirs, [], 'another member read someone else’s clearance — that re-creates the list, one doc at a time');
});

test('a member cannot forge their own clearance', async () => {
  const forged = finalizeEvent({
    kind: 30078, created_at: now(),
    tags: [['d', CLEAR_D + stranger.pub], ['t', 'trinityone'], ['church', church.pub]],
    content: 'x',
  }, stranger.sk);
  const [ok] = await publish(w0, forged);
  assert.equal(ok, false, 'a member declaring their own clearance could clear themselves to contact children');
});

// ── the event the CONSOLE actually builds ────────────────────────────────────────────────────────────────────
// Everything above hand-built the clearance event WITH a ['church'] tag, and passed while the shipped
// publishClearance emitted one WITHOUT it — because feChurch only adds that tag when acting as a delegated
// steward, and a church owner is not. Every clearance was refused; the member's app fell back to the minors
// list, which the same day's work stopped serving to members; so isMinor was false for every child in every
// church. A safeguarding regression created by the change meant to protect them, invisible because the test
// asserted against its own idea of the event rather than the one the console sends. AUDIT-2026-07-27.
test('the tag shape the console really publishes is accepted by the relay', () => {
  const S = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
  const at = S.indexOf('publishClearance(memberPub, status, urls)');
  assert.notEqual(at, -1, 'publishClearance is gone from the shipped console bundle');
  // fnBody, not a fixed width: the window was 1200 and publishClearance grew past it the moment the confirmed
  // parent list was added (UX audit 2026-08-04). A bigger number just defers the same silent truncation.
  const body = fnBody(S, at, 'publishClearance');
  assert.match(body, /\[\s*["']church["']\s*,\s*cp\s*\]/,
    'publishClearance does not put a church tag on the event itself — feChurch will omit it for a church owner and the relay refuses every clearance');
});

test('a clearance built exactly like the console builds it is accepted', async () => {
  // Mirror publishClearance's tag list precisely, including the explicit church tag, and prove the relay's
  // accept rule takes it. If someone changes either side, these two tests disagree and one of them fails.
  const evt = finalizeEvent({
    kind: 30078, created_at: now(),
    tags: [['d', CLEAR_D + adult.pub], ['t', 'trinityone'], ['p', adult.pub], ['church', church.pub]],
    content: nip44v2.encrypt(JSON.stringify({ minor: false, cleared: true, at: now() }), nip44v2.utils.getConversationKey(church.sk, adult.pub)),
  }, church.sk);
  const [ok, msg] = await publish(w0, evt);
  assert.equal(ok, true, 'the relay refused the exact event the console publishes: ' + msg);
});

// ── the backfill ─────────────────────────────────────────────────────────────────────────────────────────────
// Sealed clearances replaced a list the relay stopped serving to members. Nothing backfilled them: only the
// four safeguarding toggles re-sealed, and only for the member they touched. So every child marked before this
// shipped had no clearance doc, read an empty minors list, and concluded it was an adult — until a steward
// happened to toggle their flag off and on. AUDIT-2026-07-27.
test('the console seals the whole roster, not only the member a steward just toggled', () => {
  const D = readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8');
  const at = D.indexOf('let clearanceBackfillDone');
  assert.notEqual(at, -1, 'the clearance backfill is gone — existing children go back to being treated as adults');
  const body = D.slice(D.indexOf('if (!sg.loaded) return', at), D.indexOf('}, [sg.loaded', at));
  assert.match(body, /refreshClearances\(roster,/, 'the backfill must seal every member on the roster');
  assert.match(body, /const roster = members\.map\(m => m\.pubkey\)/, 'the backfill must build that roster from the member list');
});

test('the backfill guard survives leaving the Members tab', () => {
  // AUDIT-2026-07-28 F9. It was a React.useRef, and the dashboard renders tabs conditionally, so switching
  // away UNMOUNTS DashMembers and the ref resets — every return to the tab re-published a clearance for every
  // member. Combined with the burst defect above, that is a whole-roster storm on each visit.
  const D = readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8');
  assert.match(D, /\{tab === 'members' && <DashMembers \/>\}/,
    'the tab is no longer conditionally rendered — re-check whether the guard still needs module scope');
  const at = D.indexOf('let clearanceBackfillDone');
  assert.ok(at !== -1 && at < D.indexOf('function DashMembers()'),
    'the guard must live OUTSIDE the component, or unmounting the tab resets it');
  const body = D.slice(D.indexOf('if (!sg.loaded) return', at), D.indexOf('}, [sg.loaded', at));
  assert.doesNotMatch(body, /_sealedAll/, 'the per-mount ref is still in use');
});

test('a partial backfill is not remembered as done', () => {
  // The invariant: a run that did not reach every member must be retried on the next Members open.
  //
  // This used to assert the MECHANISM — that the signature is recorded strictly AFTER the call
  // (`mark > call`). HANDOFF-2026-07-31 (3) had to change that mechanism, because recording the marker only in
  // the `.then()` left the guard blind for the whole duration of a run (≥250 ms of paced publishing), and the
  // effect's deps are fresh array identities on every roster emit. Measured on the device: ONE Members open
  // fired two full-roster back-fills 96 ms apart, [[228,21],[324,21]]. Both stamped the same whole second for
  // most members, the relay refused the losers on its NIP-01 tie-break, and those refusals were reported to the
  // steward as children who never received their safeguarding record. Worse, the marker is only recorded when
  // `failed === 0`, which the duplicate run made impossible — so it was never recorded at all and every visit
  // re-published the entire roster, permanently.
  //
  // The signature is now CLAIMED before the await and GIVEN BACK if the run reports failures, which preserves
  // this test's invariant while closing the window. Asserted structurally here; proven by execution in
  // scripts/clearance-backfill.test.mjs ('A BACK-FILL THAT MISSED SOMEONE MUST STILL BE RETRIED', and the
  // sibling that stops a failed run clobbering a newer signature's claim).
  const D = readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8');
  const at = D.indexOf('let clearanceBackfillDone');
  const body = D.slice(D.indexOf('if (!sg.loaded) return', at), D.indexOf('}, [sg.loaded', at));
  const mark = body.indexOf('clearanceBackfillDone = sig'), call = body.indexOf('refreshClearances(roster');
  const guard = body.indexOf('clearanceBackfillDone === sig');
  assert.ok(call !== -1 && guard !== -1 && mark > guard && mark < call,
    'the signature is no longer claimed between the guard and the call, so a second roster emit arriving ' +
    'mid-run starts a duplicate whole-roster back-fill');
  // AUDIT-9 added `r.pending`: a member needing no write, on a read that never finished, releases the marker
  // too — silently, because no write was attempted and there is nothing to warn a steward about.
  assert.match(body, /if \(!r \|\| r\.failed \|\| r\.pending\) release\(\)/,
    'a run that missed members no longer gives the signature back, so the back-fill is remembered as done and ' +
    'those members are never retried — the failure this test has always existed to catch');
  assert.match(body, /clearanceBackfillDone === sig\) clearanceBackfillDone = ''/,
    'the release is unconditional, so a failed run can wipe a LATER signature’s claim and that newer run gets ' +
    'republished from scratch on the next emit');
});

test('the backfill cannot fire before the safeguarding lists have loaded', () => {
  // The dangerous failure is not "no backfill" — it is a backfill from lists that have not arrived. That seals
  // every child a 'you are not a minor' clearance signed by the church, stripping child status congregation-wide.
  const D = readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8');
  const at = D.indexOf('let clearanceBackfillDone');
  assert.notEqual(at, -1, 'the backfill guard is gone — re-anchor this test');
  const body = D.slice(at, D.indexOf('}, [sg.loaded', at));
  const guard = body.indexOf('if (!sg.loaded) return');
  const call = body.indexOf('refreshClearances(roster');
  assert.notEqual(guard, -1, 'the backfill has no loaded-guard — it will seal every child as an adult from empty lists');
  assert.ok(guard < call, 'the loaded-guard must come before the publish');

  const S = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
  const sub = S.indexOf('subscribeSafeguard(onLists)');
  const sbody = S.slice(sub, sub + 3000);
  // `loaded` must mean the minors DOCUMENT arrived — not that a subscription ended. EOSE fires on a 4.4s
  // client timeout, on a dropped relay, and before NIP-42 auth lands, and the minors doc is served only to an
  // authenticated reader. Treating that as "this church has no children" sealed every child an adult
  // clearance, which their app then trusts OVER the list fallback. AUDIT-2026-07-28.
  // esbuild reformats that one-liner across several lines, so match within the branch rather than on one line
  const minorsAt = sbody.indexOf('MINORS_D + pub)');
  assert.notEqual(minorsAt, -1, 'the minors branch is gone from the shipped console');
  assert.match(sbody.slice(minorsAt, minorsAt + 500), /loaded = true/,
    'loaded is not tied to the minors document actually arriving');
  assert.doesNotMatch(sbody, /oneose\(\)\s*\{\s*loaded = true/,
    'EOSE still sets loaded, so an unauthenticated or timed-out read looks like a church with no children');
  assert.match(D, /relayAuthed\(\)\)\) return;/,
    'the backfill does not require an authenticated view of the relay');
});
