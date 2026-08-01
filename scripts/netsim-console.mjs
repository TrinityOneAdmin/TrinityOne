// Network simulation for the STEWARD CONSOLE's write path. Run: node scripts/netsim-console.mjs
//
// NOT part of `npm test` — it takes minutes and binds its own ports. Run it by hand when the write path
// changes. Results from the first run (2026-07-31, branch fix/console-write-path) are in
// reference/HANDOFF-2026-07-31-CONSOLE-2.md.
//
// The 2026-07-14 sims measured the RELAY under load (DoS, partition, scale). This measures the CONSOLE over a
// bad link, which is a different question and the one this branch is about. Four outcomes are recorded for
// every scenario, because these are the things that actually go wrong for a church:
//
//   delivered   — did the child's clearance reach the relay, and does it SAY the right thing? (decrypted,
//                 not merely present: a stale record passes a presence check and still tells a child's app
//                 that they are an adult)
//   lied        — was the steward ever told "saved" for something that did not land? The single worst
//                 behaviour, and the reason this branch exists
//   falseAlarm  — was the steward warned about records that DID land? Alarm fatigue: a real failure then
//                 looks identical and gets dismissed
//   bytes       — what it cost on a metered connection
//
// Drives the SHIPPED vendor/steward.js through a controllable bad link in front of a real gateway.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { SimplePool } from 'nostr-tools/pool';
import { normalizeURL } from 'nostr-tools/utils';
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { v2 as nip44v2 } from 'nostr-tools/nip44';
import { badLink, LINKS } from './netsim-link.mjs';
import { requireFreePort } from './test-ports.mjs';

const RELAY_PORT = 8961, LINK_PORT = 8962, LINK2_PORT = 8963;
const LINK_URL = `ws://127.0.0.1:${LINK_PORT}/relay`;
const CLEAR_D = 'trinityone/clearance:';
const SAFETY_D = 'trinityone/safetycheck:';
const now = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };
const church = K();
const STEWARD = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
let relay, dataDir = mkdtempSync(join(tmpdir(), 'trin-netsim-'));

async function startRelay() {
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(RELAY_PORT)], {
    cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, RELAY_MAX_EVENTS: '20000', CHURCH_NPUB: npubEncode(church.pub) },
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) { try { if ((await fetch(`http://127.0.0.1:${RELAY_PORT}/status`)).ok) return; } catch {} await sleep(150); }
  throw new Error('relay not ready');
}

function grab(sig) {
  let at = STEWARD.indexOf(sig);
  if (at < 0) throw new Error('missing ' + sig);
  if (STEWARD.slice(Math.max(0, at - 6), at) === 'async ') at -= 6;
  let d = 0, q = '';
  for (let i = STEWARD.indexOf('{', at); i < STEWARD.length; i++) {
    const c = STEWARD[i], p = STEWARD[i - 1];
    if (q) { if (c === q && p !== '\\') q = ''; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '/' && STEWARD[i + 1] === '/') { i = STEWARD.indexOf('\n', i); if (i === -1) break; continue; }
    if (c === '{') d++; else if (c === '}' && --d === 0) return STEWARD.slice(at, i + 1);
  }
  throw new Error('unbalanced ' + sig);
}
const span = (from, endAfter) => {
  const a = STEWARD.indexOf(from);
  let d = 0, i = STEWARD.indexOf('{', STEWARD.indexOf(endAfter, a));
  for (; i < STEWARD.length; i++) { if (STEWARD[i] === '{') d++; else if (STEWARD[i] === '}' && --d === 0) break; }
  return STEWARD.slice(a, STEWARD.indexOf(';', i) + 1);
};
const pick = (src, base) => (src.match(new RegExp('\\b(' + base + '\\d*)\\(')) || [])[1];

// The shipped console, over whatever link it is given.
function consoleSide(urls) {
  const pool = new SimplePool({ verifyEvent, websocketImplementation: WebSocket, maxWaitForConnection: 3000 });
  const events = [];
  const publishSrc = grab('async function publish(evt)') + grab('async function _publishToRelays(evt, urls)');
  const pubClearance = grab('publishClearance(memberPub, status, urls)');
  const refresh = grab('refreshClearances(memberPubs, minors, approved)');
  const refreshNow = grab('async _refreshClearancesNow(memberPubs, minors, approved)');
  const newest = grab('function _newestByD(');
  const connected = grab('function _connectedRelays(');
  const skewDecl = (STEWARD.match(/var _CLOCK_SKEW = [^\n]*\n/) || [])[0];
  const futureDecl = (STEWARD.match(/var _authFuture = [^\n]*\n/) || [])[0];
  // The console refuses the clearance back-fill in a NETWORK view — lifted, not stubbed, because a stub
  // would assert my description of when that refusal fires rather than the console's.
  const netViewDecl = (STEWARD.match(/var _viewingNetwork = [^\n]*\n/) || [])[0];
  const matching = skewDecl + futureDecl + netViewDecl
    + grab('var _beatsDoc = ') + ';\n' + grab('function _memberHonours(') + grab('function _topWeMustAnswer(')
    + grab('async function _clearancesMatching(')
    // The cross-author ranking rule lives beside it and is called from inside it. Unlifted, the call
    // throws ReferenceError into _clearancesMatching's own catch, which returns null — "could not
    // check" — so the harness would quietly measure the no-read path and skip nothing.
    + grab('function _clearanceOutranks(');
  const isAuthed = grab('function _isRelayAuthed(');
  const healthy = grab('relaysHealthy() {');
  const authWiring = span('var _authedRelays = ', 'pool.automaticallyAuth = ');
  const touchWiring = span('var _relaysTouched = ', 'pool.onRelayConnectionFailure = ');
  const sentDecl = (STEWARD.match(/var _clearanceSent = [^\n]*\n/) || [])[0];
  const queueDecl = (STEWARD.match(/var _clearanceQueue = [^\n]*\n/) || [])[0];
  const feName = pick(authWiring, 'finalizeEvent'), normName = pick(authWiring, 'normalizeURL') || 'normalizeURL';
  const encName = pick(pubClearance, 'encrypt'), ckName = pick(pubClearance, 'getConversationKey');
  const decName = pick(matching, 'decrypt'), gpName = pick(matching, 'getPublicKey');
  for (const [n, v] of [['finalizeEvent', feName], ['encrypt', encName], ['getConversationKey', ckName],
                        ['decrypt', decName], ['getPublicKey', gpName]]) {
    if (!v) throw new Error('could not bind ' + n + ' from the bundle — esbuild renamed it again');
  }
  const scope = {
    pool, relays: () => urls, sk: church.sk, pub: church.pub, actingChurch: '',
    CLEARANCE_D: CLEAR_D, NET: 'trinityone',
    // This device's OWN church key. The console refuses the clearance back-fill when `pub` is neither
    // churchPub nor a church it is acting for — that is a NETWORK identity, which has no members.
    churchPub: church.pub,
    _careRoster: new Set(), _careRosterKnown: true, now,
    feChurch: (t) => finalizeEvent(t, church.sk),
    toPubHex: (p) => (/^[0-9a-f]{64}$/i.test(p) ? p.toLowerCase() : null),
    [encName]: (a, k) => nip44v2.encrypt(a, k),
    [decName]: (c, k) => nip44v2.decrypt(c, k),
    [ckName]: (a, b) => nip44v2.utils.getConversationKey(a, b),
    [feName]: finalizeEvent, [normName]: normalizeURL, [gpName]: getPublicKey,
    window: { Steward: {}, dispatchEvent: (e) => events.push(e) },
    CustomEvent: function (t, d) { this.type = t; this.detail = (d || {}).detail; },
    console: { warn() {}, log() {} },
    setTimeout, Promise, Set, Map, String, JSON, Date,
  };
  const args = Object.keys(scope);
  const built = new Function(...args,
    sentDecl + queueDecl + touchWiring + authWiring + isAuthed + newest + connected + matching + publishSrc +
    `\nreturn ({ publish, _isRelayAuthed, ${healthy}, ${pubClearance},\n ${refresh},\n ${refreshNow} });`
  )(...args.map(k => scope[k]));
  Object.assign(scope.window.Steward, built);
  return {
    ...built, pool, urls,
    ok: () => events.filter(e => e.type === 'steward-publish-ok').length,
    banners: () => events.filter(e => e.type === 'steward-write-blocked'),
    close: () => { try { pool.destroy(); } catch {} },
  };
}

// Provoke the relay's lazy NIP-42 challenge, as the console's own subscriptions do.
async function authenticate(s, ms = 20000) {
  s._sub = s.pool.subscribeMany(s.urls, [{ kinds: [30078], '#d': [SAFETY_D + church.pub] }], { onevent() {}, oneose() {} });
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (s._isRelayAuthed()) return true; await sleep(200); }
  return false;
}

// GROUND TRUTH, read straight off the relay and decrypted. Presence is not enough — a stale record is the
// failure a child experiences.
async function truth(pubs) {
  const w = await new Promise((res, rej) => { const x = new WebSocket(`ws://127.0.0.1:${RELAY_PORT}/relay`); x.on('open', () => res(x)); x.on('error', rej); });
  const out = new Map();
  await new Promise(res => {
    const on = d => {
      const m = JSON.parse(d);
      if (m[0] === 'AUTH') w.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', `ws://127.0.0.1:${RELAY_PORT}/relay`], ['challenge', m[1]]], content: '' }, church.sk)]));
      if (m[0] === 'EVENT' && m[1] === 'q') {
        const e = m[2], dtag = (e.tags.find(t => t[0] === 'd') || [])[1] || '', pub = dtag.slice(CLEAR_D.length);
        try {
          const b = JSON.parse(nip44v2.decrypt(e.content, nip44v2.utils.getConversationKey(church.sk, pub)));
          const prev = out.get(pub);
          if (!prev || (e.created_at || 0) >= prev.at) out.set(pub, { minor: !!b.minor, at: e.created_at || 0 });
        } catch (x) {}
      }
      if (m[0] === 'EOSE' && m[1] === 'q') { w.off('message', on); res(); }
    };
    w.on('message', on);
    w.send(JSON.stringify(['REQ', 'q', { kinds: [30078], '#d': pubs.map(p => CLEAR_D + p) }]));
    setTimeout(res, 10000);
  });
  w.close();
  return out;
}

// Cutting a link makes nostr-tools reject every in-flight subscription promise ("relay connection closed").
// Those rejections are the CONDITION UNDER TEST, not a fault — but an unhandled one kills the run mid-matrix.
// Swallowed here only; the console's own handling is what the assertions measure.
process.on('unhandledRejection', () => {});
// And never leave a gateway behind, for the same reason.
const _cleanup = () => { try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} };
process.on('uncaughtException', (e) => { console.error('FATAL', e && e.message); _cleanup(); process.exit(1); });
process.on('exit', _cleanup);

const results = [];
async function scenario(name, link, body) {
  const shim = badLink({ port: LINK_PORT, upstreamPort: RELAY_PORT, ...link });
  await shim.listen();
  const roster = Array.from({ length: 8 }, K);
  const pubs = roster.map(m => m.pub);
  const minors = pubs.slice(0, 3);                  // three children
  const s = consoleSide([LINK_URL]);
  const r = { name, delivered: 0, expected: 3, lied: false, falseAlarm: 0, bytes: 0, authed: false, note: '' };
  try {
    r.authed = await authenticate(s);
    const out = await body({ s, shim, pubs, minors });
    const held = await truth(pubs);
    // Every child must hold a record that SAYS minor.
    r.delivered = minors.filter(p => { const h = held.get(p.toLowerCase()); return h && h.minor === true; }).length;
    // "Lied" = the console reported zero failures while a child's record is missing or wrong.
    r.lied = (out && out.failed === 0) && r.delivered < r.expected;
    // TWO KINDS of banner, and only one is a false alarm. "N members did not receive their record" is a claim
    // of failure; "couldn't confirm these saved" is an admission of ignorance. On a link too poor to read back,
    // the second is the honest thing to say and must not be scored as crying wolf — but it must also never be
    // allowed to masquerade as the first.
    const wolves = s.banners().filter(b2 => !/couldn.t check whether/.test((b2.detail || {}).message || ''));
    const unsure = s.banners().length - wolves.length;
    r.falseAlarm = (r.delivered === r.expected) ? wolves.length : 0;
    r.unsure = (r.delivered === r.expected) ? unsure : 0;
    r.bytes = shim.stats.bytesUp + shim.stats.bytesDown;
    r.note = out && out.note || '';
  } catch (e) { r.note = 'threw: ' + String(e).slice(0, 60); }
  s.close();
  await shim.close();
  results.push(r);
  console.log(`  ${r.delivered === r.expected ? '✓' : '✗'} ${name.padEnd(34)} children ${r.delivered}/${r.expected}  lied=${r.lied}  criedWolf=${r.falseAlarm}  unsure=${r.unsure || 0}  ${(r.bytes / 1024).toFixed(0)}kB  ${r.note}`);
}

// A STRAY GATEWAY ON THIS PORT ANSWERS /status WITH A DIFFERENT CHURCH KEY, so every write is refused and a
// perfectly healthy console reads as totally broken. That is not hypothetical: the first run of this file
// crashed mid-matrix, left its relay behind, and the next run reported 0/3 children delivered on EVERY
// scenario including the fast one. Exactly the trap scripts/test-ports.mjs exists for — it usually makes
// broken code look green; here it made working code look catastrophic.
await requireFreePort(RELAY_PORT, 'zz-netsim.mjs (its gateway)');
await requireFreePort(LINK_PORT, 'zz-netsim.mjs (its bad link)');
await startRelay();
console.log('NETWORK SIMULATION — the steward console over a bad link\n');

for (const [label, prof] of [['fast', LINKS.fast], ['dsl', LINKS.dsl], ['2G/EDGE', LINKS.edge2g], ['satellite', LINKS.satellite], ['awful', LINKS.awful]]) {
  await scenario(`mark 3 children — ${label}`, prof, async ({ s, pubs, minors }) => {
    const out = await s.refreshClearances(pubs, minors, []);
    return { failed: out.failed, note: `failed=${out.failed} skipped=${out.skipped}` };
  });
}

// The link dies mid-back-fill — the flapping case the product is built for.
await scenario('link cut mid-write — 2G', LINKS.edge2g, async ({ s, shim, pubs, minors }) => {
  setTimeout(() => shim.cut(), 600);
  const out = await s.refreshClearances(pubs, minors, []);
  return { failed: out.failed, note: `failed=${out.failed} (cut at 600ms)` };
});

// The DPI case: the socket is accepted and then says nothing at all.
await scenario('blackholed mid-write — 2G', LINKS.edge2g, async ({ s, shim, pubs, minors }) => {
  setTimeout(() => { shim.set({ mode: 'blackhole' }); shim.cut(); }, 600);
  const out = await s.refreshClearances(pubs, minors, []);
  return { failed: out.failed, note: `failed=${out.failed} (blackholed at 600ms)` };
});

// Repeat visit on a slow link — the write-amplification question read-before-write exists to answer.
await scenario('SECOND visit, nothing changed — 2G', LINKS.edge2g, async ({ s, pubs, minors }) => {
  await s.refreshClearances(pubs, minors, []);
  const before = s.ok();
  const out = await s.refreshClearances(pubs, minors, []);
  return { failed: out.failed, note: `2nd visit published ${s.ok() - before} events, skipped=${out.skipped}` };
});

console.log('\n--- summary ---');
const lies = results.filter(r => r.lied), lost = results.filter(r => r.delivered < r.expected);
const alarms = results.filter(r => r.falseAlarm);
console.log(`scenarios: ${results.length}`);
console.log(`told the steward "saved" while a child's record was missing: ${lies.length ? lies.map(r => r.name).join(', ') : 'NONE'}`);
console.log(`children left without a correct record:                     ${lost.length ? lost.map(r => `${r.name} (${r.delivered}/3)`).join(', ') : 'NONE'}`);
console.log(`CRIED WOLF (claimed children lost their record, wrongly):    ${alarms.length ? alarms.map(r => r.name).join(', ') : 'NONE'}`);
const unsures = results.filter(r => r.unsure);
console.log(`said "couldn't confirm" while everything landed (honest):   ${unsures.length ? unsures.map(r => r.name).join(', ') : 'NONE'}`);

try { relay.kill('SIGKILL'); } catch {}
try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
process.exit(0);
