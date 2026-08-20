// A CHURCH MAY NOT LOSE ITS ACCOUNTS WHEN A TREASURER LEAVES.
// Run: node --test scripts/delegated-finance.test.mjs
//
// Three defects found while removing the wall that kept Finance on the owner console (2026-08-20). Each one
// is invisible on screen and each one destroys or hides money records:
//
//   1. RETRACTION. canRead() stops serving anything authored by someone no longer on the steward roster. For
//      a group or a rota that is correct. For the JOURNAL it deletes history: the church opens its accounts
//      and the months that treasurer served are simply gone, with the surrounding sequence numbers still
//      there. The journal is append-only and sequence-pinned, so those entries cannot have been tampered
//      with — there is nothing to retract.
//   2. THE RACE. A capability's key envelope and the documents it seals arrive on two independent
//      subscriptions. When the documents win, every one of them failed to decrypt and was DISCARDED. A
//      delegated treasurer opened Finance to a permanently empty ledger, with no error anywhere.
//   3. NULL IS NOT SUCCESS. encPublish returns null — never false — when it declines before reaching the
//      relay. pubEntry only checked `=== false`, so an entry that never left the phone was reported saved
//      and lost on reload.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { webcrypto } from 'node:crypto';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { v2 as nip44 } from 'nostr-tools/nip44';
import { requireFreePort } from './test-ports.mjs';
import { fnBody, stripComments } from './test-slice.mjs';

const VENDOR = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const FIN = readFileSync(new URL('../app/stew-finance.jsx', import.meta.url), 'utf8');

const PORT = 8996;
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const STEWARDS_D = 'trinityone/stewards:', FIN_D = 'finance/journal:', GROUP_D = 'trinityone/group:';
const NET = 'trinityone';
const now = () => Math.floor(Date.now() / 1000);
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };

const church = K(), treasurer = K(), member = K();
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
const connect = () => new Promise((res, rej) => { const ws = new WebSocket(WS_URL); ws.on('open', () => res(ws)); ws.on('error', rej); });
const publish = (ws, evt) => new Promise((res) => {
  const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { ws.off('message', on); res({ ok: m[2], why: m[3] || '' }); } };
  ws.on('message', on); ws.send(JSON.stringify(['EVENT', evt]));
});
function readAuthed(ws, subId, filter, who, window = 700) {
  return new Promise((resolve) => {
    const events = [];
    const on = (d) => {
      const m = JSON.parse(d);
      if (m[0] === 'EVENT' && m[1] === subId) events.push(m[2]);
      else if (m[0] === 'AUTH') ws.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', WS_URL], ['challenge', m[1]]], content: '' }, who.sk)]));
    };
    ws.on('message', on); ws.send(JSON.stringify(['REQ', subId, filter]));
    setTimeout(() => { ws.off('message', on); try { ws.send(JSON.stringify(['CLOSE', subId])); } catch {} resolve(events); }, window);
  });
}
// strictly newer each time — a replaceable event that ties on created_at is a coin flip
let rosterAt = now();
const roster = (pubkeys, caps) => finalizeEvent({ kind: 30078, created_at: ++rosterAt, tags: [['d', STEWARDS_D + cp], ['t', NET]], content: JSON.stringify({ pubkeys, caps }) }, church.sk);
let finSeq = 0;
const entry = (who, memo) => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', FIN_D + (finSeq + 1)], ['t', NET], ['church', cp]], content: 'sealed:' + memo }, who.sk);
const putEntry = async (ws, who, memo) => { const r = await publish(ws, entry(who, memo)); if (r.ok) finSeq++; return r; };
const member30078 = (who) => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', 'trinityone/member:' + cp], ['t', NET]], content: '{}' }, who.sk);

before(async () => {
  await requireFreePort(PORT, 'delegated-finance.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-delegfin-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(cp), RELAY_MAX_EVENTS: '5000' }, stdio: 'ignore',
  });
  await waitReady();
});
after(() => { try { relay.kill(); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

test('the relay is carrying this church at all', async () => {
  assert.ok((await fetch(`http://127.0.0.1:${PORT}/status`)).ok, 'the relay never came up, so nothing below proves anything');
});

test('a REMOVED treasurer\'s entries are still served — the church keeps its accounts', async () => {
  const ws = await connect();
  assert.equal((await publish(ws, roster([treasurer.pub], { [treasurer.pub]: ['finance'] }))).ok, true, 'the church could not publish its own roster');
  assert.equal((await publish(ws, member30078(church))).ok, true, 're-anchor: the church could not register itself as a member');
  await new Promise(r => setTimeout(r, 150));
  assert.equal((await putEntry(ws, treasurer, 'Harvest offering')).ok, true, 'a finance-capable steward cannot write the books at all');
  assert.equal((await putEntry(ws, church, 'Hall hire')).ok, true, 're-anchor: the church itself cannot write its own books');

  // the treasurer steps down
  assert.equal((await publish(ws, roster([], {}))).ok, true, 'the church could not empty its own roster');
  await new Promise(r => setTimeout(r, 150));

  const got = await readAuthed(ws, 'fin1', { kinds: [30078], '#church': [cp] }, church);
  const memos = got.filter(e => (e.tags.find(t => t[0] === 'd') || [])[1].startsWith(FIN_D)).map(e => e.content);
  assert.ok(memos.includes('sealed:Harvest offering'),
    'the departed treasurer\'s entry is no longer served. The church opens its accounts and the months that ' +
    'person served are missing, with the sequence numbers around them still there. Nothing about someone ' +
    'leaving makes the money they recorded untrue, and the journal is append-only so it cannot have been ' +
    'altered — there is nothing to retract.');
  assert.ok(memos.includes('sealed:Hall hire'), 're-anchor: the church\'s own entries stopped being served too');
  ws.close();
});

test('but a removed treasurer may write NOTHING more', async () => {
  // The exemption is about serving the PAST. Their authority to add to the books ends with the roster.
  const ws = await connect();
  const r = await putEntry(ws, treasurer, 'after leaving');
  assert.equal(r.ok, false,
    'a steward removed from the roster can still write to the church books — the exemption above has been ' +
    'widened from "keep serving what they wrote" into "let them carry on writing"');
  ws.close();
});

test('the retraction exemption is the JOURNAL only, not everything a departed steward touched', async () => {
  // Narrowness matters: a group or rota written by a revoked steward SHOULD stop being served, which is what
  // the retraction rule is for. Widening the exemption to all finance/ docs, or to all church-tagged docs,
  // would quietly undo it.
  const gw = stripComments(readFileSync(new URL('./gateway.mjs', import.meta.url), 'utf8'));
  const line = gw.match(/const retractionExempt = [^\n]*/);
  assert.ok(line, 're-anchor: retractionExempt is gone');
  assert.match(line[0], /FIN_JOURNAL_D/, 'the books are not exempt from retraction');
  assert.doesNotMatch(line[0], /startsWith\(GROUP_D\)|startsWith\(ROTA_D\)/,
    'the exemption has been widened past the journal, so a revoked steward\'s groups and rotas are served again');
});

// ── 2. THE RACE ───────────────────────────────────────────────────────────────────────────────────────────
const KEY = Array.from(webcrypto.getRandomValues(new Uint8Array(32))).map(b => b.toString(16).padStart(2, '0')).join('');
const unhex = (h) => new Uint8Array(h.match(/.{1,2}/g).map(b => parseInt(b, 16)));

// Drive the SHIPPED encSubscribe with a fake relay pool, so the ordering is ours to choose.
function ledgerReader({ ringArrivesFirst }) {
  const emitted = [];
  let onevent = null, oneose = null;
  const state = { finance: { ring: ringArrivesFirst ? [KEY] : [], docKeys: null, rev: 1, at: 0, checked: false } };
  const waiters = { finance: new Set() };
  const stubs = {
    _capState: state, _capWaiters: waiters,
    _capRingChanged: (k) => { for (const fn of waiters[k] || []) fn(); },
    actingChurch: cp, pub: cp, _careRoster: new Set(),
    relays: () => ['ws://x'], NET,
    pool: { subscribeMany: (_r, _f, h) => { onevent = h.onevent; oneose = h.oneose; return { close() {} }; } },
    nip44d: (c, k) => nip44.decrypt(c, k), _unhex: unhex,
    decrypt: (c, k) => nip44.decrypt(c, k),
    churchSkHeld: () => false,          // a DELEGATE console: no legacy-key fallback, the ring is all it has
    CAP_KEYS: { finance: { d: 'trinityone/financekey:', cap: 'finance', legacy: true } },
    window: { Steward: {} },
  };
  const scope = new Proxy(stubs, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k];
      const b = String(k).replace(/[0-9]+$/, ''); if (b in t) return t[b];
      throw new ReferenceError('needs a stub for ' + String(k)); },
  });
  const api = new Function('scope', `with (scope) { return { ${[['encSubscribe(prefix, cb, kind)', 'encSubscribe'], ['encOpen(kind', 'encOpen']].map(([s, n]) => fnBody(VENDOR, s, n)).join(',\n')} }; }`)(scope);
  Object.assign(stubs.window.Steward, api);
  const off = api.encSubscribe('finance/journal:', (items) => emitted.push(items), 'finance');
  const sealed = (seq, memo) => ({ pubkey: cp, created_at: 1787280000 + seq, content: nip44.encrypt(JSON.stringify({ seq, memo }), unhex(KEY)), tags: [['d', 'finance/journal:' + seq]] });
  return {
    off, emitted,
    deliver: (seq, memo) => onevent(sealed(seq, memo)),
    eose: () => oneose(),
    ringArrives: () => { state.finance.ring = [KEY]; stubs._capRingChanged('finance'); },
    last: () => emitted[emitted.length - 1] || [],
  };
}

test('a ledger that arrives BEFORE its key is not thrown away', () => {
  const r = ledgerReader({ ringArrivesFirst: false });
  r.deliver(1, 'Harvest offering');
  r.deliver(2, 'Hall hire');
  r.eose();
  assert.deepEqual(r.last(), [], 're-anchor: entries decrypted with no key at all');

  r.ringArrives();                       // the envelope lands a moment later
  const got = r.last().map(x => x.memo).sort();
  assert.deepEqual(got, ['Hall hire', 'Harvest offering'],
    'the entries that arrived before the key were discarded and never retried, so a delegated treasurer ' +
    'opens the books to a permanently empty ledger — no error, no empty-state, just a church that appears ' +
    'to have never recorded a penny. Whether they see their accounts depends on which subscription wins a race.');
  r.off();
});

test('the ordinary order still works, and nothing is emitted twice', () => {
  const r = ledgerReader({ ringArrivesFirst: true });
  r.deliver(1, 'Harvest offering');
  r.eose();
  assert.deepEqual(r.last().map(x => x.memo), ['Harvest offering'], 're-anchor: the normal path stopped working');
  r.ringArrives();
  assert.equal(r.last().filter(x => x.memo === 'Harvest offering').length, 1, 'the entry is now listed twice');
  r.off();
});

test('unsubscribing stops the retry, so a closed screen cannot fire into a dead callback', () => {
  const r = ledgerReader({ ringArrivesFirst: false });
  r.deliver(1, 'Harvest offering');
  r.off();
  const before = r.emitted.length;
  r.ringArrives();
  assert.equal(r.emitted.length, before, 'a retry fired after unsubscribe — the waiter is never removed, so ' +
    'every Finance screen ever opened stays registered and re-renders a component that is gone');
});

// ── 3. NULL IS NOT SUCCESS ────────────────────────────────────────────────────────────────────────────────
test('an entry the console could not publish is NOT reported as saved', () => {
  const body = stripComments(fnBody(FIN, 'const pubEntry = async (b, e) => {', 'pubEntry'));
  assert.match(body, /ok === false \|\| ok == null/,
    'pubEntry only treats `false` as failure. encPublish returns NULL — never false — when it declines ' +
    'before reaching the relay (no signing key, or no books key to seal with), so the entry is reported ' +
    'saved, written nowhere, and gone on reload. A delegated treasurer whose key envelope has not arrived ' +
    'hits this on their first entry.');
  assert.match(body, /booksSave\(b\)/, 'a failed publish no longer keeps the entry on the device');
  assert.match(body, /steward-write-blocked/, 'a failed publish no longer tells the treasurer anything');
});

test('encPublish really does answer null rather than false when it declines', () => {
  // The assertion above is only worth anything if this is true of the shipped function.
  const body = stripComments(fnBody(VENDOR, 'encPublish(dtag, obj, kind) {', 'encPublish'));
  assert.match(body, /return Promise\.resolve\(null\)/,
    're-anchor: encPublish no longer returns null on refusal, so pubEntry is guarding a case that cannot happen');
  assert.doesNotMatch(body, /return Promise\.resolve\(false\)/, 're-anchor: it now returns false, so this pair has drifted');
});

test('the wall keeping Finance off a delegate console is gone', () => {
  const src = stripComments(FIN);
  assert.doesNotMatch(src, /Finance is on the church console/,
    'the delegated-steward wall is still in DashFinance, so none of the work above is reachable');
  assert.doesNotMatch(src, /if \(S && S\.actingChurch\) return/,
    'DashFinance still refuses to render for a delegated steward');
});
