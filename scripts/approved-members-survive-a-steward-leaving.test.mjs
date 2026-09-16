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
import { stripComments } from './test-slice.mjs';

const STEWARD = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');

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
function grab(sig) {
  let a = STEWARD.indexOf(sig);
  assert.notEqual(a, -1, sig + ' is gone from the shipped bundle — re-anchor this test, or rebuild');
  if (STEWARD.slice(Math.max(0, a - 6), a) === 'async ') a -= 6;
  let depth = 0, q = '';
  for (let i = STEWARD.indexOf('{', a); i < STEWARD.length; i++) {
    const c = STEWARD[i], prev = STEWARD[i - 1];
    if (q) { if (c === q && prev !== '\\') q = ''; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '/' && STEWARD[i + 1] === '/') { i = STEWARD.indexOf('\n', i); if (i === -1) break; continue; }
    if (c === '{') depth++; else if (c === '}' && --depth === 0) return STEWARD.slice(a, i + 1);
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
    sk: signer.sk, pub: viewPub, actingChurch: acting,
    ADMITTED_D, NET, now,
    _requireTrustedView: () => {}, publish: (e) => { captured.push(e); return Promise.resolve(true); },
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

test('THE HEADLINE: the warden stands down, the relay restarts, and nothing the warden approved is withheld', async () => {
  const ws = await connect();
  assert.equal((await publish(ws, roster([], {}))).ok, true, 'the church could not empty its own roster');
  await new Promise(r => setTimeout(r, 200));
  ws.close();

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

test('KNOWN GAP, MEASURED AND REPORTED RATHER THAN GUESSED: the relay’s own allowlist forgets a departed steward', async () => {
  // This is NOT an endorsement of the behaviour. It is the boundary of this commit, pinned so that whoever
  // closes it sees this test go red and knows exactly which line moved.
  //
  // canRead now keeps SERVING the warden's copy (the test above). But note()'s ADMITTED_D ingest asks
  // `stewardCan(e.pubkey, cp, 'any')`, which is a CURRENT-roster question, and hydrateMaps() replays from
  // disk on every boot — so after the restart above, Ben is no longer in ADMITTED_BY and the relay stops
  // treating him as an effective member.
  //
  // WHY IT IS NOT FIXED HERE. The only way to fix it at that line is to stop asking who the author was.
  // Unlike the check-in withdrawal next door — which can only ever REFUSE somebody — this document GRANTS,
  // and /import is reachable by any church key registered on the box (see _exportAuth) and writes straight to
  // the store with no accept() pass. An unauthored ingest would therefore let one church on a shared
  // community relay admit members into another church's gated corpus. The evidence needed to tell a
  // departed-but-genuine steward from a co-tenant's forgery is the roster as it stood when the document was
  // written, and the next roster overwrites it. That is an owner's decision, not an improvisation.
  const benSees = await admittedDocsSeenBy(ben);
  assert.equal(benSees.length, 0,
    'GOOD NEWS, NOT A FAILURE: the relay now keeps honouring a departed steward’s approvals across a ' +
    'restart. If that was done deliberately, delete this test and say so; if it was not, something widened ' +
    'note()’s ADMITTED_D ingest and the co-tenant question above needs answering.');
  const adaSees = await admittedDocsSeenBy(ada);
  assert.ok(adaSees.length > 0,
    're-anchor: the CHURCH’s own approval stopped working after a restart, which is a different fault ' +
    'entirely and a much worse one');
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

test('the console combines every copy instead of taking the newest — SHIPPED bundle, run', () => {
  // Rule 1 again, on the other side: lift subscribeAdmitted out of vendor/steward.js and drive it with a fake
  // pool. A newest-wins fold passes nothing here; only a per-author union does.
  const src = 'const api = { ' + grab('subscribeAdmitted(onList)') + ' };';
  let handlers = null;
  const scope = {
    pool: { subscribeMany: (_urls, _filters, h) => { handlers = h; return { close() {} }; } },
    relays: () => [WS_URL], pub: cp, ADMITTED_D, NET,
    _authFuture: () => false, _careRoster: new Set([warden.pub]),
    _byChurchOrSteward: (e) => e.pubkey === cp || e.pubkey === warden.pub,
  };
  const keys = Object.keys(scope);
  const api = new Function(...keys, src + '\nreturn api;')(...keys.map(k => scope[k]));

  const seen = [];
  api.subscribeAdmitted((l) => seen.push([...l]));
  assert.ok(handlers, 're-anchor: subscribeAdmitted no longer opens a subscription');
  const doc = (who, ts, pubkeys) => ({ pubkey: who, created_at: ts, tags: [['d', ADMITTED_D + cp], ['t', NET]], content: JSON.stringify({ pubkeys }) });

  handlers.onevent(doc(cp, 100, [ada.pub]));            // the vicar approves Ada
  handlers.onevent(doc(warden.pub, 162, [ben.pub]));    // the warden approves Ben, a minute later
  const after = seen[seen.length - 1];
  assert.ok(after.includes(ada.pub) && after.includes(ben.pub),
    'the console still takes the newest copy and throws the other away, so one of two people approved on the ' +
    'same morning is shown as still waiting — and the next Approve press writes that down permanently. ' +
    'Saw: ' + JSON.stringify(after));

  // ARRIVAL ORDER MUST NOT DECIDE ANYTHING. Same two documents, opposite order.
  const seen2 = [];
  const api2 = new Function(...keys, src + '\nreturn api;')(...keys.map(k => scope[k]));
  api2.subscribeAdmitted((l) => seen2.push([...l]));
  handlers.onevent(doc(warden.pub, 162, [ben.pub]));
  handlers.onevent(doc(cp, 100, [ada.pub]));
  const after2 = seen2[seen2.length - 1];
  assert.ok(after2.includes(ada.pub) && after2.includes(ben.pub),
    'an older copy arriving late still loses — which is a reconnect, so the Members screen changes under ' +
    'whoever is looking at it. Saw: ' + JSON.stringify(after2));

  // …AND AN AUTHOR'S OWN LATER LIST STILL REPLACES THEIR OWN EARLIER ONE, or nobody could ever be taken off.
  const seen3 = [];
  const api3 = new Function(...keys, src + '\nreturn api;')(...keys.map(k => scope[k]));
  api3.subscribeAdmitted((l) => seen3.push([...l]));
  handlers.onevent(doc(cp, 100, [ada.pub, ben.pub]));
  handlers.onevent(doc(cp, 200, [ada.pub]));
  const after3 = seen3[seen3.length - 1];
  assert.deepEqual(after3, [ada.pub],
    'the union has become a one-way ratchet: the church published a list WITHOUT Ben and he is still on it, ' +
    'so nobody can ever be removed. Newest-per-author, union across authors — not union across everything.');
});
