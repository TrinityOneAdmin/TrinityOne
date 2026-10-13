// A CHURCH MAY NOT LOSE THE PEOPLE IT HAS APPROVED WHEN A STEWARD LEAVES — OR WHEN TWO PEOPLE APPROVE AT ONCE.
// Run: node --test scripts/approved-members-survive-a-steward-leaving.test.mjs
//
// The owner's decision, 2026-09-16, in his words: "approved members must always survive a steward leaving."
//
// WHAT WAS WRONG. A delegated steward acts in the church's name but signs with their OWN key
// (setActiveIdentity: "delegated: OUR key signs, church's context reads"). setAdmitted published the
// approved-members allowlist with `finalizeEvent(..., sk)` and NO ['church',<cp>] tag, so although the relay
// stored it and even enforced it, every reader of that address asks for `authors:[cp]` OR `#church:[cp]` and
// matched neither. The console's subscribeAdmitted therefore saw only the church's own copy — and since every
// Approve press is a read-modify-write of the WHOLE list, the next person to admit anybody, steward or owner,
// republished a list computed from a stale one and dropped everyone admitted in between. Nobody was told.
//
// WHY THE ONE-LINE FIX IS NOT SAFE ON ITS OWN. The church tag brings the document under canRead()'s
// revoked-steward retraction: once the author is off the roster, their documents stop being served. For a
// group key that is right. For a LIST OF WHO IS ALLOWED IN it means the church silently reverts to an older
// allowlist the moment a delegate stands down. So the tag comes with an entry in `retractionExempt`, beside
// care needs, the books, the children's register and a check-in withdrawal, for the same stated reason.
//
// AND TWO COPIES MUST BE COMBINED, NOT RACED. This is an addressable document, so there is one copy per
// AUTHOR at the one address. Newest-wins — which both the console and the relay were doing — means the vicar
// approving Ada and the churchwarden approving Ben sixty seconds apart end with one of them silently back in
// "Waiting to be let in", and the next press writes that loss down permanently.
//
// ⚠ NOT A CODE FAILURE IF YOU SEE IT: this file starts a relay on a fixed high port. If that port is held,
// requireFreePort names the holding PID — kill THAT pid, never `pkill -f`.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { requireFreePort } from './test-ports.mjs';
import { openStore } from './event-store.mjs';
import { fnBody, stmt, stripComments } from './test-slice.mjs';

const STEWARD = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
// THE SHIPPED LANDING REPORT (_landed, 2026-10-02): every guarded list write now returns through it, so a lifted
// setter needs it in scope. Lifted, not re-typed.
const _landedSrc = fnBody(STEWARD, 'function _landed(what, p) {', '_landed in the shipped bundle');
const _landedShipped = new Function('return ' + _landedSrc)();

// STAGE 4's two caps, READ OUT OF THE BUNDLE rather than typed here. Five tolerance constants drifting apart
// is the defect the relay-corrected-time work exists to stop, and a test that hard-codes a sixth copy of one
// of them stops being able to see the drift.
const CAPS = (() => {
  const src = stmt(STEWARD, 'var _CLOCK_SKEW = ', '_CLOCK_SKEW')
    + '\n' + stmt(STEWARD, 'var STAMP_CAP_SEC = ', 'STAMP_CAP_SEC')
    + '\n' + stmt(STEWARD, 'var SKEW_CAP_SEC = ', 'SKEW_CAP_SEC');
  return new Function(src + '\nreturn { STAMP_CAP_SEC, SKEW_CAP_SEC };')();
})();

const PORT = 19537;
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const NET = 'trinityone';
const ADMITTED_D = 'trinityone/admitted:';
const STEWARDS_D = 'trinityone/stewards:';
const JOINPOLICY_D = 'trinityone/joinpolicy:';
const MEMBER_D = 'trinityone/member:';
const now = () => Math.floor(Date.now() / 1000);
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };

const church = K(), warden = K(), ada = K(), ben = K();
const cp = church.pub;
let relay, dataDir;

async function waitReady(ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/status`); if (r.ok) return; } catch {}
    await new Promise(r => setTimeout(r, 150));
  }
  throw new Error('relay never came up on :' + PORT);
}
const start = async () => {
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(cp), RELAY_MAX_EVENTS: '5000' }, stdio: 'ignore',
  });
  await waitReady();
};
const stop = () => new Promise((res) => { if (!relay) return res(); relay.once('exit', () => res()); try { relay.kill(); } catch { res(); } });

const connect = () => new Promise((res, rej) => { const ws = new WebSocket(WS_URL); ws.on('open', () => res(ws)); ws.on('error', rej); });
const publish = (ws, evt) => new Promise((res) => {
  const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { ws.off('message', on); res({ ok: m[2], why: m[3] || '' }); } };
  ws.on('message', on); ws.send(JSON.stringify(['EVENT', evt]));
});
// ONE SOCKET PER QUESTION. The read gate is default-deny and needs a real NIP-42 AUTH, so an anonymous or
// stale-AUTH socket reads EMPTY and looks exactly like a refusal — which would let this file "confirm" a fix
// that does nothing. Each ask opens its own socket, authenticates as exactly one person, and closes.
async function askAs(who, filters, window = 800) {
  const ws = await connect();
  const subId = 'q' + Math.random().toString(36).slice(2, 8);
  const events = await new Promise((resolve) => {
    const out = [];
    const on = (d) => {
      const m = JSON.parse(d);
      if (m[0] === 'EVENT' && m[1] === subId) out.push(m[2]);
      else if (m[0] === 'AUTH') ws.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', WS_URL], ['challenge', m[1]]], content: '' }, who.sk)]));
    };
    ws.on('message', on); ws.send(JSON.stringify(['REQ', subId, ...filters]));
    setTimeout(() => { ws.off('message', on); resolve(out); }, window);
  });
  try { ws.close(); } catch {}
  return events;
}
// THE CONSOLE'S OWN TWO FILTERS, VERBATIM, and that is the whole point of asking this way. A broad
// `{kinds:[30078]}` sweep would be served an untagged steward copy and report the document as "found" while
// no shipped reader could ever ask for it — which is exactly the bug, dressed up as a pass.
const CONSOLE_FILTERS = [{ kinds: [30078], authors: [cp], '#t': [NET] }, { kinds: [30078], '#church': [cp], '#t': [NET] }];
const admittedDocsSeenBy = async (who) => {
  const got = await askAs(who, CONSOLE_FILTERS);
  return got.filter(e => ((e.tags.find(t => t[0] === 'd') || [])[1] || '') === ADMITTED_D + cp);
};
const listsIn = (docs) => docs.map(e => { try { return JSON.parse(e.content).pubkeys || []; } catch { return []; } });

let stamp = now() - 100;
const at = () => ++stamp;   // strictly increasing: a replaceable event that ties on created_at is a coin flip
const roster = (pubkeys, caps) => finalizeEvent({ kind: 30078, created_at: at(), tags: [['d', STEWARDS_D + cp], ['t', NET]], content: JSON.stringify({ pubkeys, caps }) }, church.sk);
const joinPolicy = (approval) => finalizeEvent({ kind: 30078, created_at: at(), tags: [['d', JOINPOLICY_D + cp], ['t', NET]], content: JSON.stringify({ approval }) }, church.sk);
const memberDoc = (who) => finalizeEvent({ kind: 30078, created_at: at(), tags: [['d', MEMBER_D + cp], ['t', NET]], content: '{}' }, who.sk);

// ── THE SHIPPED CONSOLE WRITES THE DOCUMENT, NOT THIS TEST ────────────────────────────────────────────────
// Rule 1: this has to fail if the fix is deleted from the point of USE. So setAdmitted and feChurch are
// lifted out of vendor/steward.js and RUN — a test that hand-rolled the event would pass with the console's
// own line reverted. `publish` is captured (this file sends it to the real relay itself) and
// _requireTrustedView is stubbed, because neither is the question here; the SIGNING path is the shipped one.
function grab(sig, SRC = STEWARD) {
  let a = SRC.indexOf(sig);
  assert.notEqual(a, -1, sig + ' is gone from the shipped bundle — re-anchor this test, or rebuild');
  assert.equal(SRC.indexOf(sig, a + 1), -1, sig + ' appears twice in the shipped bundle — re-anchor this test');
  if (SRC.slice(Math.max(0, a - 6), a) === 'async ') a -= 6;
  let depth = 0, q = '';
  for (let i = SRC.indexOf('{', a); i < SRC.length; i++) {
    const c = SRC[i], prev = SRC[i - 1];
    if (q) { if (c === q && prev !== '\\') q = ''; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '/' && SRC[i + 1] === '/') { i = SRC.indexOf('\n', i); if (i === -1) break; continue; }
    if (c === '{') depth++; else if (c === '}' && --depth === 0) return SRC.slice(a, i + 1);
  }
  assert.fail('could not find the end of ' + sig);
}
function shippedSetAdmitted({ signer, viewPub, acting }) {
  const src = [grab('function feChurch(tmpl, signer)'), grab('function _monotonic(tmpl)'), 'const api = { ' + grab('setAdmitted(pubkeys)') + ' };'].join('\n');
  // esbuild renames imported bindings (finalizeEvent2, …). Bind what the bundle actually emitted.
  const feName = (src.match(/\b(finalizeEvent\d*)\(/) || [])[1];
  assert.ok(feName, 'the bundle no longer signs the way this test expects — re-anchor');
  const captured = [];
  const scope = {
    [feName]: finalizeEvent, _lastStamp: new Map(), _monotonicUnused: 0,
    // STAGE 4 (SCOPE-RELAY-CORRECTED-TIME-2026-09-26) made _monotonic read the relay-clock correction
    // through _skewShift. Zero here — the unmeasured case, which is byte-identical to the build these
    // rows were written against. The correction itself is measured in
    // scripts/a-slow-console-does-not-write-past-its-own-gate.test.mjs, not here.
    _skewShift: () => 0, ...CAPS,
    sk: signer.sk, pub: viewPub, actingChurch: acting,
    ADMITTED_D, NET, now,
    _requireTrustedView: () => {}, _landed: _landedShipped, publish: (e) => { captured.push(e); return Promise.resolve(true); },
  };
  const keys = Object.keys(scope);
  const api = new Function(...keys, src + '\nreturn api;')(...keys.map(k => scope[k]));
  return { api, captured };
}

before(async () => {
  await requireFreePort(PORT, 'approved-members-survive-a-steward-leaving.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-admitted-'));
  await start();
});
after(async () => { await stop(); try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

test('the relay is carrying this church at all', async () => {
  assert.ok((await fetch(`http://127.0.0.1:${PORT}/status`)).ok, 'the relay never came up, so nothing below proves anything');
});

test('THE SHIPPED CONSOLE NAMES THE CHURCH when a delegated steward approves somebody', async () => {
  // The owner console's own write is unchanged — actingChurch is empty, so feChurch adds nothing.
  const own = shippedSetAdmitted({ signer: church, viewPub: cp, acting: '' });
  await own.api.setAdmitted([ada.pub]);
  assert.equal(own.captured.length, 1);
  assert.equal(own.captured[0].pubkey, cp, 're-anchor: the owner console stopped signing with the church key');

  const del = shippedSetAdmitted({ signer: warden, viewPub: cp, acting: cp });
  await del.api.setAdmitted([ben.pub]);
  assert.equal(del.captured.length, 1);
  const e = del.captured[0];
  assert.equal(e.pubkey, warden.pub, 're-anchor: a delegated console is supposed to sign with its OWN key');
  assert.equal(((e.tags.find(t => t[0] === 'd') || [])[1]), ADMITTED_D + cp, 're-anchor: the d-tag no longer names the church');
  assert.deepEqual(e.tags.find(t => t[0] === 'church'), ['church', cp],
    'a delegated steward’s approvals go out with no ["church",<cp>] tag. The relay stores them, but every ' +
    'reader of this address asks for authors:[cp] OR #church:[cp] and matches neither — so the next ' +
    'Approve press, by anyone, computes the whole list again from a copy that is missing them and publishes ' +
    'that over the top. Everyone approved in between goes back to "Waiting to be let in", silently.');
});

test('setup: an approval-gated church, a warden on the roster, and two people waiting', async () => {
  const ws = await connect();
  assert.equal((await publish(ws, roster([warden.pub], { [warden.pub]: ['members'] }))).ok, true, 'the church could not publish its own roster');
  assert.equal((await publish(ws, joinPolicy(true))).ok, true, 'the church could not switch approval on');
  for (const who of [church, warden, ada, ben]) assert.equal((await publish(ws, memberDoc(who))).ok, true, 'a member: doc was refused');
  await new Promise(r => setTimeout(r, 200));

  // The vicar approves Ada from the owner console. The warden approves Ben from a delegated console, later.
  const own = shippedSetAdmitted({ signer: church, viewPub: cp, acting: '' });
  await own.api.setAdmitted([church.pub, ada.pub]);
  const del = shippedSetAdmitted({ signer: warden, viewPub: cp, acting: cp });
  await del.api.setAdmitted([ben.pub]);
  assert.equal((await publish(ws, own.captured[0])).ok, true, 'the church could not publish its own approved-members list');
  assert.equal((await publish(ws, del.captured[0])).ok, true, 'a Members-capable steward cannot approve anybody at all');
  await new Promise(r => setTimeout(r, 200));
  ws.close();
});

test('BOTH APPROVALS COUNT — the later one does not quietly cancel the earlier', async () => {
  // Read the allowlist AS ADA. canRead's tail for this document is "a member of cp, not blocked, and — because
  // this church gates joins — on the allowlist". So Ada seeing anything at all IS the relay's own answer to
  // "is Ada admitted", with no second gate in the way. Ben likewise. Before the union, whichever copy the
  // relay ingested LAST replaced the other in ADMITTED_BY, so exactly one of these two read zero.
  const adaSees = await admittedDocsSeenBy(ada);
  assert.ok(adaSees.length > 0,
    'Ada was approved by the church and is not admitted. A steward approved somebody else afterwards and the ' +
    'relay let that second list REPLACE the first — two people approving on the same morning, and the ' +
    'earlier decision is simply gone.');
  const benSees = await admittedDocsSeenBy(ben);
  assert.ok(benSees.length > 0,
    'Ben was approved by a delegated steward and is not admitted — the church’s own copy replaced the ' +
    'steward’s, so the steward’s Approve press did nothing the relay honours.');

  // …and the church can see that there really are two copies, one per author.
  const docs = await admittedDocsSeenBy(church);
  const authors = new Set(docs.map(e => e.pubkey));
  assert.ok(authors.has(cp) && authors.has(warden.pub),
    'the church is not being served both copies of its own allowlist, so its console cannot combine them ' +
    '— got authors: ' + [...authors].join(', '));
});

// ── ITEM D: Ben's phone is open while the church removes the warden ─────────────────────────────────────────
// A LIVE SUBSCRIPTION, as Ben's phone holds one: open across the removal, so it sees documents in the order the relay
// broadcasts them. The events are replayed through the member app's own join-state code below.
const FELLOWSHIP = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
async function watchAs(who, filters) {
  const ws = await connect();
  const subId = 'w' + Math.random().toString(36).slice(2, 8);
  const events = [];
  let ready;
  const eosed = new Promise(r => { ready = r; });
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    if (m[0] === 'EVENT' && m[1] === subId) events.push(m[2]);
    else if (m[0] === 'EOSE' && m[1] === subId) ready();
    else if (m[0] === 'AUTH') ws.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', WS_URL], ['challenge', m[1]]], content: '' }, who.sk)]));
  });
  ws.on('error', () => {});
  await new Promise(r => setTimeout(r, 400));   // logged in first, or the default-deny read gate answers nothing
  ws.send(JSON.stringify(['REQ', subId, ...filters]));
  await Promise.race([eosed, new Promise(r => setTimeout(r, 1500))]);
  return { events, close: () => { try { ws.close(); } catch {} } };
}
// THE MEMBER APP'S JOIN STATE, lifted out of vendor/fellowship.js and RUN: subscribeChurchJoin, fed by a stand-in for
// the church-docs hub doing what _onChurchDocs does — the church's roster goes through the shipped _absorbRoster and
// then onroster(); everything else to onevent(e, d). app/app.jsx (~1555) shows "You're no longer in this church"
// exactly when a church that gates joining (approval) stops reporting isAdmitted for someone it once admitted.
function phoneJoinStates(me, events) {
  const src = grab('function _absorbRoster(cp, d, e)', FELLOWSHIP) + '\nconst api = { ' + grab('subscribeChurchJoin(churchNpub, onState) {', FELLOWSHIP) + ' };';
  let hub = null;
  const scope = {
    _churchRoster: new Map(), _fireTrust: () => {}, toPub: (x) => x, pub: me,
    window: { Fellowship: { myPubkey: me } }, authState: () => ({ failed: false }),
    _onChurchDocs: (_cp, h) => { hub = h; return () => {}; },
  };
  const keys = Object.keys(scope);
  const { api, _absorbRoster } = new Function(...keys, src + '\nreturn { api, _absorbRoster };')(...keys.map(k => scope[k]));
  const states = [];
  api.subscribeChurchJoin(cp, (st) => states.push(st));
  assert.ok(hub, 're-anchor: subscribeChurchJoin no longer registers on the church-docs hub');
  for (const e of events) {
    const d = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
    if (_absorbRoster(cp, d, e)) { if (hub.onroster) hub.onroster(); } else hub.onevent(e, d);
  }
  return states;
}
let phoneWatch;
test('ITEM D: Ben’s phone is open before the warden is removed', async () => {
  phoneWatch = await watchAs(ben, CONSOLE_FILTERS);
  assert.ok(phoneWatch.events.some(e => e.pubkey === warden.pub), 're-anchor: Ben is not served the warden’s approval, so the rows below prove nothing');
});

test('THE HEADLINE: the warden stands down, the relay restarts, and nothing the warden approved is withheld', async () => {
  const ws = await connect();
  assert.equal((await publish(ws, roster([], {}))).ok, true, 'the church could not empty its own roster');
  await new Promise(r => setTimeout(r, 400));
  ws.close();
  phoneWatch.close();

  // RESTART, so every lookup table is rebuilt from disk. A map that is merely stale in memory would hide this.
  await stop();
  await start();

  const docs = await admittedDocsSeenBy(church);
  const authors = new Set(docs.map(e => e.pubkey));
  assert.ok(authors.has(warden.pub),
    'the departed warden’s approvals are no longer SERVED. The church opens its Members screen, the ' +
    'allowlist it reads is the older one, and the next Approve press writes that older list down as the ' +
    'church’s own — so everyone the warden ever let in is back at "Waiting to be let in", on a relay ' +
    'that restarts itself, with nothing said to anybody. retractionExempt is what stops this.');
  assert.ok(authors.has(cp), 're-anchor: the church’s OWN copy stopped being served too, which is a different and worse fault');
  const all = new Set([].concat(...listsIn(docs)));
  assert.ok(all.has(ada.pub) && all.has(ben.pub),
    'the two copies between them no longer name both people the church approved');
});

const chat = (who) => finalizeEvent({ kind: 1, created_at: now(), tags: [['t', NET], ['church', cp]], content: 'hello' }, who.sk);
const cleo = K();   // joined, never approved: the control that proves the instrument can say "no"

test('ITEM D (relay): after the removal AND a restart, Ben can still read his church and post — the old KNOWN GAP, closed', async () => {
  // This row used to PIN the gap: the relay rebuilt its allowlist on boot from current stewards only. It now keeps a
  // copy it accepted from the warden while they were a steward (gateway.mjs ADMITTED_RECEIPTS) — no console involved.
  const ws = await connect();
  assert.equal((await publish(ws, memberDoc(cleo))).ok, true, 're-anchor: a member: doc was refused');
  ws.close();
  await new Promise(r => setTimeout(r, 200));
  assert.equal((await admittedDocsSeenBy(cleo)).length, 0, 'CONTROL: an unapproved member can read the allowlist, so a read proves nothing here');
  const cw = await connect(); const cr = await publish(cw, chat(cleo)); cw.close();
  assert.equal(cr.ok, false, 'CONTROL: an unapproved member can post, so a post proves nothing here');

  assert.ok((await admittedDocsSeenBy(ben)).length > 0,
    'after the warden was removed and the relay restarted, Ben — whom the warden approved — can no longer read his ' +
    'church: "blocked: not a member". Removing a steward un-approved the people they let in.');
  const bw = await connect(); const br = await publish(bw, chat(ben)); bw.close();
  assert.equal(br.ok, true, 'Ben can no longer post after the warden left and the relay restarted: ' + br.why);
  assert.ok((await admittedDocsSeenBy(ada)).length > 0, 're-anchor: the church’s OWN approval of Ada stopped working');
});

test('ITEM D (phone, point of use): Ben’s open app never stops reporting him admitted — member app engine, run', () => {
  const evs = phoneWatch.events.filter(e => { const d = (e.tags.find(t => t[0] === 'd') || [])[1] || ''; return d === ADMITTED_D + cp || d === STEWARDS_D + cp || d === JOINPOLICY_D + cp; });
  assert.ok(evs.some(e => ((e.tags.find(t => t[0] === 'd') || [])[1]) === STEWARDS_D + cp && JSON.parse(e.content).pubkeys.length === 0),
    're-anchor: Ben’s live subscription never received the roster without the warden, so this proves nothing');
  const states = phoneJoinStates(ben.pub, evs);
  const firstIn = states.findIndex(st => st.isAdmitted);
  assert.ok(firstIn >= 0, 're-anchor: the member app never saw Ben admitted in the first place');
  assert.ok(states.slice(firstIn).some(st => st.approval), 're-anchor: the church never read as gating joins, so "removed" could not show anyway');
  const lost = states.slice(firstIn).find(st => st.approval && !st.isAdmitted);
  assert.equal(lost, undefined,
    'the moment Ben’s phone took the roster without the warden it stopped counting the warden’s approval, so a ' +
    'church that gates joining told him "You’re no longer in this church" — for nothing he did. States: ' + JSON.stringify(states));
});

test('ITEM D (console): a second, COLD console still counts Ben as approved — SHIPPED subscribeAdmitted, run', async () => {
  // Cold: it never saw the warden on a roster (empty roster, no record of the removal). It is fed exactly what the
  // relay serves the church after the restart.
  const docs = await admittedDocsSeenBy(church);
  const cold = drivenAdmitted({ careRoster: [] });
  for (const e of docs) cold.deliver(e);
  assert.ok(cold.last() && cold.last().includes(ben.pub),
    'a console that did not see the removal treats Ben as still waiting, so it leaves him out of every new key. Saw: ' + JSON.stringify(cold.last()));
});

test('ITEM D (relay): a copy that never passed the write gate is neither served nor honoured — e.g. planted by /import', async () => {
  // Put straight onto disk while the relay is down — the /import route also writes with no accept() pass. Signed by a
  // key that was never a steward, naming Cleo. Without the receipt rule the read gate served it to every reader.
  const stranger = K();
  const planted = finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', ADMITTED_D + cp], ['t', NET], ['church', cp]], content: JSON.stringify({ pubkeys: [cleo.pub] }) }, stranger.sk);
  await stop();
  const st = openStore(join(dataDir, 'relay.sqlite'));
  try { assert.equal(st.put(planted, cp), 'stored', 're-anchor: could not plant the copy'); } finally { st.close(); }
  await start();
  const docs = await admittedDocsSeenBy(church);
  assert.ok(!docs.some(e => e.pubkey === stranger.pub),
    'a non-steward’s approved-members list that never passed the write gate is SERVED — and phones and consoles count every copy they are served');
  assert.equal((await admittedDocsSeenBy(cleo)).length, 0, 'a planted list admitted Cleo at the relay');
  assert.ok(docs.some(e => e.pubkey === warden.pub), 're-anchor: the warden’s receipted copy stopped being served');
});

test('a departed steward may still write NOTHING more — the exemption is about serving the past', async () => {
  const del = shippedSetAdmitted({ signer: warden, viewPub: cp, acting: cp });
  await del.api.setAdmitted([ben.pub, ada.pub, warden.pub]);
  const ws = await connect();
  const r = await publish(ws, del.captured[0]);
  ws.close();
  assert.equal(r.ok, false,
    'a steward removed from the roster can still add people to the church’s allowlist — the read-gate ' +
    'exemption has been widened from "keep serving what they wrote" into "let them carry on writing"');
});

test('the retraction exemption is a READ gate and nothing else', () => {
  // It cannot repeat the 2026-08-20 incident, where replaying a WRITE gate over an /import deleted a church's
  // whole finance journal: retractionExempt has exactly one reader, it opens and closes no door, and it
  // deletes nothing. It only stops withholding what is already on disk.
  const gw = stripComments(readFileSync(new URL('./gateway.mjs', import.meta.url), 'utf8'));
  assert.match(gw, /const retractionExempt = [^;]*ADMITTED_D/,
    'the approved-members list is no longer on retractionExempt — a delegate standing down now reverts ' +
    'the church to an older allowlist');
  assert.equal((gw.match(/retractionExempt/g) || []).length, 2,
    'retractionExempt has gained or lost a reader. It is meant to have exactly one (the line below its own ' +
    'declaration, inside canRead). If accept() or an ingest now consults it, this is a write gate and the ' +
    'argument above no longer holds.');
});

// ── ONE DRIVEN COPY OF THE SHIPPED HANDLER ────────────────────────────────────────────────────────────────
// Rule 1, on the console's side: lift subscribeAdmitted out of vendor/steward.js and RUN it against a fake
// pool, so deleting the fold from the shipped bundle fails this file. Every call builds an INDEPENDENT
// instance with its own `handlers`; sharing one fake pool across two instances silently rebinds the first,
// which would let a case drive a subscription it is not the subject of.
const admittedDoc = (who, ts, pubkeys) => ({ pubkey: who, created_at: ts, tags: [['d', ADMITTED_D + cp], ['t', NET]], content: JSON.stringify({ pubkeys }) });
function drivenAdmitted({ careRoster = [warden.pub] } = {}) {
  const src = 'const api = { ' + grab('subscribeAdmitted(onList)') + ' };';
  let handlers = null;
  const scope = {
    pool: { subscribeMany: (_urls, _filters, h) => { handlers = h; return { close() {} }; } },
    relays: () => [WS_URL], pub: cp, ADMITTED_D, NET,
    _authFuture: () => false, _careRoster: new Set(careRoster),
    _byChurchOrSteward: (e) => e.pubkey === cp || e.pubkey === warden.pub,
    // round 2 of the room-key reconcile: subscribeAdmitted stamps its list (fresh reads are tested in
    // key-reads-settle-only-for-the-church-they-asked-about.test.mjs), also counts a steward this device saw removed
    // (nobody here), and re-folds when the roster changes. None of that is what this file drives.
    _freshTok: () => ({ live: true, genuine: false, at: 0 }), _listTag: () => ({}), _stampFor: (l) => l,
    _freshDocRead: () => () => {}, _keysReadSignal: () => {}, _exStewardRemovedAt: () => ({}), _memberEmitters: new Set(),
  };
  const keys = Object.keys(scope);
  const api = new Function(...keys, src + '\nreturn api;')(...keys.map(k => scope[k]));
  const seen = [];
  api.subscribeAdmitted((l) => seen.push([...l]));
  assert.ok(handlers, 're-anchor: subscribeAdmitted no longer opens a subscription');
  return { deliver: (e) => handlers.onevent(e), seen, last: () => seen[seen.length - 1] };
}

test('the console combines every copy instead of taking the newest — SHIPPED bundle, run', () => {
  // A newest-wins fold passes nothing here; only a per-author union does.
  const doc = admittedDoc;
  const one = drivenAdmitted();

  one.deliver(doc(cp, 100, [ada.pub]));            // the vicar approves Ada
  one.deliver(doc(warden.pub, 162, [ben.pub]));    // the warden approves Ben, a minute later
  const after = one.last();
  assert.ok(after.includes(ada.pub) && after.includes(ben.pub),
    'the console still takes the newest copy and throws the other away, so one of two people approved on the ' +
    'same morning is shown as still waiting — and the next Approve press writes that down permanently. ' +
    'Saw: ' + JSON.stringify(after));

  // ARRIVAL ORDER MUST NOT DECIDE ANYTHING. Same two documents, opposite order.
  const two = drivenAdmitted();
  two.deliver(doc(warden.pub, 162, [ben.pub]));
  two.deliver(doc(cp, 100, [ada.pub]));
  const after2 = two.last();
  assert.ok(after2.includes(ada.pub) && after2.includes(ben.pub),
    'an older copy arriving late still loses — which is a reconnect, so the Members screen changes under ' +
    'whoever is looking at it. Saw: ' + JSON.stringify(after2));

  // …AND AN AUTHOR'S OWN LATER LIST STILL REPLACES THEIR OWN EARLIER ONE, or nobody could ever be taken off.
  const three = drivenAdmitted();
  three.deliver(doc(cp, 100, [ada.pub, ben.pub]));
  three.deliver(doc(cp, 200, [ada.pub]));
  const after3 = three.last();
  assert.deepEqual(after3, [ada.pub],
    'the union has become a one-way ratchet: the church published a list WITHOUT Ben and he is still on it, ' +
    'so nobody can ever be removed. Newest-per-author, union across authors — not union across everything.');
});

test('A LAGGING RELAY REPLAYING AN AUTHOR\'S SUPERSEDED LIST DOES NOT UN-REMOVE ANYBODY — SHIPPED bundle, run', () => {
  // THE GAP THIS CLOSES (audit 2026-09-18). The three cases above are: two authors; the same two in the
  // opposite order; and one author whose NEWER list arrives LAST. None of them ever delivers an OLDER
  // document from the SAME author AFTER a newer one — which is the only arrangement the newest-per-author
  // guard exists for, and therefore the only one that can tell a working guard from a dead one.
  //
  // How dead it could be, measured: change `byAuthor.get(e.pubkey)` to `byAuthor.get(e.id)` in the shipped
  // bundle and `prev` is always undefined, so `e.created_at < prev.at` is never true and NO stale copy is
  // ever skipped. Every test in the repo stayed green, including the structural scan in
  // scripts/steward-newest-wins.test.mjs, which checks that the compared field is FED from a created_at but
  // never that the object compared is the object written.
  //
  // WHY IT MATTERS ON A SUNDAY. Every relay holds its own copy of this one address and the console reads all
  // of them at once. A relay that was offline while the church removed somebody answers with the list as it
  // was — an EARLIER created_at, more names on it. If the guard is dead that copy overwrites the current one
  // in byAuthor, the union puts the removed person back, and the next Approve press writes them down as
  // approved in the church's own signed copy. That is a removal silently undone by a slow server.
  const doc = admittedDoc;

  // The church's current list is [Ada]. Ben was on the previous one and has been taken off.
  const solo = drivenAdmitted();
  solo.deliver(doc(cp, 200, [ada.pub]));
  solo.deliver(doc(cp, 100, [ada.pub, ben.pub]));   // a lagging relay answers with the superseded copy
  assert.deepEqual(solo.last(), [ada.pub],
    'an OLDER list from the SAME author overwrote the newer one, so somebody the church removed is approved ' +
    'again — put back by a relay that was merely behind, and made permanent by the next Approve press. ' +
    'Saw: ' + JSON.stringify(solo.last()));
  assert.ok(!solo.seen.some(l => l.includes(ben.pub)),
    'the removed member was never in the final list but DID flash into it on the way — the Members screen ' +
    'repaints from every emission, so a steward can approve against a list that briefly told them a lie. ' +
    'Emissions: ' + JSON.stringify(solo.seen));

  // …and the same, with a steward's copy in the union alongside, so the stale replay cannot hide behind it.
  const mixed = drivenAdmitted();
  mixed.deliver(doc(cp, 200, [ada.pub]));                       // church: Ada only, Ben removed
  mixed.deliver(doc(warden.pub, 150, [ben.pub]));               // the warden separately approved Ben
  mixed.deliver(doc(cp, 100, [ada.pub, church.pub]));           // lagging relay replays the church's old copy
  assert.deepEqual([...mixed.last()].sort(), [ada.pub, ben.pub].sort(),
    'the stale church copy was folded in beside the warden\'s, so a name the church has dropped is back on ' +
    'the allowlist. Newest-per-author must hold INSIDE the union, not only when one author is talking. ' +
    'Saw: ' + JSON.stringify(mixed.last()));
});
