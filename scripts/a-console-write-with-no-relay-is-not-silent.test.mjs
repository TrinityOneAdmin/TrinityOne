// A CONSOLE WRITE WITH NOWHERE TO SEND IT MUST SAY SO — the all-relays writer, not only publish().
// Run: node --test scripts/a-console-write-with-no-relay-is-not-silent.test.mjs
//
// C4 made the console's PUBLISH SET allowed to be empty, and attached "degraded-set honesty" to itself as a
// precondition: when the verified set is empty the person must be told. Its message claimed "a console
// document write raises steward-publish-error". That was true of publish() and FALSE of the console's other
// writer: `_publishToRelays` — the all-must-accept path the safeguarding and group documents take — ended
// with a bare `if (!targets.length) return false;` that raised no event, logged nothing, and told nobody.
//
// It was unreachable before C4, because the relay list could never be empty. After C4 it is the GUARANTEED
// state on merge day (the fleet still answers 404 to /relay-identity, so every canonical proof fails) and is
// reachable afterwards in any cold-cache window, because setKey's gate refresh is fire-and-forget and a
// steward's first action can beat the proofs.
//
// THE THREE THINGS THIS FILE ASSERTS, and the third is the one that keeps the record honest:
//
//   1. THE ENGINE, AT THE POINT OF USE. The console's shipped publishGroup — the writer behind the
//      child-safe toggle, the group definition and every category change — over a candidate list of one
//      REAL, HEALTHY, UP relay that this church never signed for. Exactly one steward-publish-error with a
//      no-network-relay reason, and the count of what landed is taken from THAT BOX'S OWN STORE.
//   2. IT IS NOT UNCONDITIONAL. The same call, with the church's signature on the box, publishes and raises
//      the OK event and no error at all. A dispatch that fired on every write would pass (1) and be useless.
//   3. THE FAMILY, MEASURED RATHER THAN ASSUMED. Six callers reach that line. The audit that found this
//      named setBlocked as the sharpest case — a ban that reaches no relay while the steward sees the person
//      blocked. Run, it is not: `targets` can only be empty when relays() is, _isRelayAuthed iterates
//      relays(), so _requireTrustedView throws one line earlier and raises steward-write-blocked, and
//      _localBlocked is never assigned. publishGroup and publishClearance have no such guard, and are what
//      the fix is actually for. That distinction is asserted here so nobody has to take either claim on
//      faith, in this direction or the other.
//
// AND THE SCREEN, in a real browser (CLAUDE.md rule 1). A dispatched event nobody renders is the same defect
// wearing a different hat, and app/*.jsx ships unbundled so text-matching it proves nothing (rule 3). The
// last test drives the REAL console to its REAL dashboard, on an origin that has no relay — the merge-day
// condition, staged rather than simulated — presses the shipped writer, and asserts a message the steward
// can actually see appears where there was none before.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname, normalize } from 'node:path';
import { WebSocket } from 'ws';
import { SimplePool } from 'nostr-tools/pool';
import { verifyEvent, finalizeEvent } from 'nostr-tools/pure';
import { normalizeURL } from 'nostr-tools/utils';
import { fnBody, stmt } from './test-slice.mjs';
import * as H from './relay-network-harness.mjs';

const RELAY_NET_D = 'trinityone/relay-net';
const GROUP_D = 'trinityone/group:';
const ROOT = new URL('..', import.meta.url).pathname;
const STEWARD = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── a browser's worth of world ──────────────────────────────────────────────────────────────────────────
function memStore() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
function fakeWindow() {
  const events = [];
  return { events, dispatchEvent: (e) => { events.push({ type: e.type, detail: e.detail }); return true; },
           addEventListener: () => {}, removeEventListener: () => {} };
}
class Ev { constructor(type, init) { this.type = type; this.detail = (init || {}).detail; } }

// Anything the lifted code asks for that is not stubbed raises a ReferenceError NAMING it, rather than
// arriving as undefined and being swallowed by one of this file's many try/catch blocks — which is how a
// lift silently stops testing anything.
function scopeOf(stubs) {
  return new Proxy(stubs, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => {
      if (k === Symbol.unscopables) return undefined;
      if (k in t) return t[k];
      const base = String(k).replace(/\d+$/, '');
      if (base in t) return t[base];
      throw new ReferenceError('the lifted code needs `' + String(k) + '` — add a stub for it');
    },
    set: (t, k, v) => { t[k] = v; return true; },
  });
}

// ── the console's WRITERS, out of the shipped bundle ─────────────────────────────────────────────────────
// The gate, the publish set it produces, and the all-relays writer that is the subject here — plus two of
// its six callers, taken as the METHODS they are on window.Steward so the tests press what a steward presses.
function consoleWriters({ church, origin, canonical = [], pins = {}, extra = [], store = memStore() }) {
  const src = STEWARD;
  const win = fakeWindow();
  const pool = new SimplePool();
  pool.automaticallyAuth = () => async (authEvent) => finalizeEvent(authEvent, church.sk);
  const body = [
    // the C3 predicate + the C4 gate
    // RELAY_PROOF_WINDOW_SEC is no longer sliced: verifyRelayIdentity stopped consulting a clock
    // (audit 2026-09-02 #1 — a phone 5 min out could admit no relay at all), so esbuild tree-shakes
    // the constant out of the bundles entirely. Slicing a name that is no longer there makes the
    // lift THROW, and a test that dies prints no failure — it reads like a pass. See CLAUDE.md.
    fnBody(src, 'function relayIdentityNonce', 'relayIdentityNonce'),
    fnBody(src, 'function relayHttpBase', 'relayHttpBase'),
    fnBody(src, 'function relayAddrKey', 'relayAddrKey'),
    fnBody(src, 'async function verifyRelayIdentity', 'verifyRelayIdentity'),
    stmt(src, 'var RELAY_NET_D = ', 'RELAY_NET_D'),
    fnBody(src, 'function _relayKey', '_relayKey'),
    stmt(src, 'var _isHex64 = ', '_isHex64'),
    fnBody(src, 'function canonicalPinsFor', 'canonicalPinsFor'),
    fnBody(src, 'function isSharedAddress', 'isSharedAddress'),
    fnBody(src, 'function sharedRelayKeys', 'sharedRelayKeys'),
    fnBody(src, 'function parseRelayNet', 'parseRelayNet'),
    fnBody(src, 'function _originKey', '_originKey'),
    fnBody(src, 'function sameOriginRelay', 'sameOriginRelay'),
    fnBody(src, 'async function proveRelay', 'proveRelay'),
    fnBody(src, 'async function isNetworkRelay', 'isNetworkRelay'),
    stmt(src, 'var VERIFIED_KEY = ', 'VERIFIED_KEY'),
    stmt(src, 'var VERIFIED_TTL_SEC = ', 'VERIFIED_TTL_SEC'),
    stmt(src, 'var VERIFIED_REFRESH_SEC = ', 'VERIFIED_REFRESH_SEC'),
    stmt(src, 'var VERIFY_RETRY_SEC = ', 'VERIFY_RETRY_SEC'),
    fnBody(src, 'function readVerified', 'readVerified'),
    fnBody(src, 'function writeVerified', 'writeVerified'),
    fnBody(src, 'function admitCached', 'admitCached'),
    fnBody(src, 'function rememberVerified', 'rememberVerified'),
    fnBody(src, 'function createRelayGate', 'createRelayGate'),
    // the console's own list assembly
    fnBody(src, 'function lsGet', 'lsGet'),
    fnBody(src, 'function lsSet', 'lsSet'),
    stmt(src, 'var RELAYS_LS = ', 'RELAYS_LS'),
    fnBody(src, 'function normRelay', 'normRelay'),
    fnBody(src, 'function ownRelay', 'ownRelay'),
    fnBody(src, 'function extraRelays', 'extraRelays'),
    fnBody(src, 'function relaysRaw', 'relaysRaw'),
    fnBody(src, 'function _ownOrigin', '_ownOrigin'),
    fnBody(src, 'function relayNetCandidates', 'relayNetCandidates'),
    fnBody(src, 'function _oneComplete', '_oneComplete'),
    fnBody(src, 'function relayNetDoc', 'relayNetDoc'),
    fnBody(src, 'async function relayNetEntries', 'relayNetEntries'),
    stmt(src, 'var _gate = createRelayGate(', '_gate'),
    fnBody(src, 'function relays()', 'relays'),
    stmt(src, 'var NO_NETWORK_RELAY = ', 'NO_NETWORK_RELAY'),
    fnBody(src, 'function _connectedRelays', '_connectedRelays'),
    // the subject, and the guard that stands in front of four of its six callers
    fnBody(src, 'function _requireTrustedView', '_requireTrustedView'),
    fnBody(src, 'function _isRelayAuthed', '_isRelayAuthed'),
    fnBody(src, 'async function _publishToRelays', '_publishToRelays'),
    // constants the two lifted methods below need
    stmt(src, 'var NET = ', 'NET'),
    stmt(src, 'var GROUP_D = ', 'GROUP_D'),
    stmt(src, 'var BLOCKED_D = ', 'BLOCKED_D'),
    stmt(src, 'var EVENT_POLICIES = ', 'EVENT_POLICIES'),
    fnBody(src, 'function _monotonic', '_monotonic'),
    fnBody(src, 'function feChurch', 'feChurch'),
  ].join('\n');
  // GUARDS ON THE LIFT. A slice that stopped containing the load-bearing line would leave every assertion
  // below passing over nothing at all — and this file's whole subject is one `if` inside one function.
  assert.match(body, /const map = readVerified\(d\.store\)/, 'vendor/steward.js: the gate no longer reads a persisted cache');
  assert.match(body, /return _gate\.admit\(relaysRaw\(\), pub\)/, 'vendor/steward.js: relays() is no longer the gated publish set');
  const sub = fnBody(src, 'async function _publishToRelays', '_publishToRelays');
  assert.equal((sub.match(/if \(!targets\.length\)/g) || []).length, 1,
    'vendor/steward.js: the empty-target return is not where this test thinks it is — re-anchor rather than widening');
  assert.match(sub, /Promise\.allSettled\(pool\.publish\(targets, evt\)/,
    'vendor/steward.js: _publishToRelays no longer publishes — the slice has stopped being the writer');

  const scope = scopeOf({
    localStorage: store, window: win, location: origin, pool, console,
    CANONICAL_RELAY: canonical[0] || 'wss://canonical.invalid/relay',
    CANONICAL_RELAYS: canonical,
    CANONICAL_RELAY_PUBS: pins,
    _boxHostsUs: null,
    pub: church.pub, sk: church.sk,
    actingChurch: '',
    now: () => Math.floor(Date.now() / 1000),
    finalizeEvent, verifyEvent, normalizeURL, fetch: globalThis.fetch,
    CustomEvent: Ev,
    _waitForRegistration: async () => {},
    _localBlocked: new Set(),
    _lastStamp: new Map(),
  });
  store.setItem('trinityone.steward.extra-relays', JSON.stringify(extra));
  const publishGroup = fnBody(src, '  publishGroup(group) {', 'publishGroup');
  const setBlocked = fnBody(src, '  setBlocked(pubkeys) {', 'setBlocked');
  const api = new Function('scope', `with (scope) { ${body}
    const _api = { ${publishGroup}, ${setBlocked} };
    return { relays, relaysRaw, gate: _gate, _publishToRelays,
             publishGroup: (g) => _api.publishGroup(g),
             setBlocked: (p) => _api.setBlocked(p),
             localBlocked: () => _localBlocked }; }`)(scope);
  api.win = win;
  api.close = () => { try { pool.close(pool.relays ? [...pool.relays.keys()] : []); } catch {} };
  return api;
}

// How many copies of one document a box is holding — read off the RELAY'S OWN STORE over /sync as the church
// key, never from the return value of the call that wrote it.
async function held(relay, church, prefix) {
  const evs = await H.corpus(relay, church);
  return evs.filter(e => String((e.tags.find(t => t[0] === 'd') || [])[1] || '').startsWith(prefix)).length;
}
const churchDocFor = (church, d, content) => finalizeEvent(
  { kind: 30078, created_at: Math.floor(Date.now() / 1000), tags: [['d', d], ['t', 'trinityone']], content: JSON.stringify(content) }, church.sk);
const signIn = (church, relays) => churchDocFor(church, RELAY_NET_D, relays.map(r => ({ pubkey: r.relayPub, alwaysOn: true, url: r.wsUrl })));

let church, IN, OUT;
before(async () => {
  church = H.key();
  [IN] = await Promise.all([
    H.startRelay({ name: 'IN', churches: [church.pub] }),
  ]);
  // OUT CANNOT BE ADMITTED, which is what these two cases need: they exercise the EMPTY-publish-set
  // error path, and under the 2026-09-02 rule a real gateway is admitted on its proof, so the set was
  // never empty and the line under test was never reached. A box that is not TrinityOne software is.
  OUT = await H.startFakeRelay({ name: 'OUT' });
  assert.notEqual(IN.relayPub, OUT.relayPub, 'the two relays must be two separate boxes or nothing below means anything');
});
after(() => H.stopAll());

// ── 1. THE POINT OF USE ─────────────────────────────────────────────────────────────────────────────────
test('a group a steward saves with an empty publish set raises the error the console already renders', async () => {
  // OUT is UP, holds this church, and is in the console's own relay list. The only thing wrong with it is
  // that nothing vouches for its key — so the publish set is empty and there is nowhere to write.
  const con = consoleWriters({ church, origin: { protocol: 'https:', host: 'console.example.church' }, extra: [OUT.wsUrl] });
  try {
    await con.gate.refresh(con.relaysRaw(), church.pub);
    assert.ok(con.relaysRaw().includes(OUT.wsUrl), 'the candidate list lost the address, so this test is not staging what it says');
    assert.deepEqual(con.relays(), [], 'the publish set is not empty, so the line under test is never reached');

    const before = con.win.events.length;
    const r = await con.publishGroup({ name: 'Youth group', kind: 'group', childsafe: true });
    assert.equal(r, null, 'publishGroup reported a saved group over a set it could not write to');

    const raised = con.win.events.slice(before);
    const errs = raised.filter(e => e.type === 'steward-publish-error');
    assert.equal(errs.length, 1,
      'the console raised ' + JSON.stringify(raised.map(e => e.type)) + ' — expected exactly one ' +
      'steward-publish-error. A write with nowhere to go must take the failure surface the console ALREADY ' +
      'has; returning false to a caller that does not look at it tells the steward nothing.');
    assert.match(String(errs[0].detail.reason), /^no-network-relay/,
      'the steward was given "' + errs[0].detail.reason + '". A relay that could not be proved is not a ' +
      'connection fault, and the reason is what tells the two apart.');
    assert.ok(errs[0].detail.evt && (errs[0].detail.evt.tags || []).some(t => t[0] === 'd' && t[1].startsWith(GROUP_D)),
      'the error does not carry the event it is about, so the surface cannot tell one failed write from another');

    assert.equal(await held(OUT, church, GROUP_D), 0,
      'a relay this church never signed for is holding a group definition. It is up, it holds the church, ' +
      'and it was in the console\'s own list — so this is the gate being absent, not the box being unreachable.');
  } finally { con.close(); }
});

// ── 2. AND IT IS NOT UNCONDITIONAL ──────────────────────────────────────────────────────────────────────
test('the same save over a relay the church DID sign for lands, and raises no error', async () => {
  await H.publishAll(IN, [signIn(church, [IN])]);
  const con = consoleWriters({ church, origin: { protocol: 'https:', host: 'console.example.church' }, extra: [IN.wsUrl] });
  try {
    await con.gate.refresh(con.relaysRaw(), church.pub);
    assert.deepEqual(con.relays(), [IN.wsUrl], 'the publish set is ' + JSON.stringify(con.relays()) + ', expected the signed box alone');

    const before = con.win.events.length;
    const r = await con.publishGroup({ name: 'Prayer meeting', kind: 'group' });
    assert.ok(r && r.id, 'the console could not save a group to the box its own church signed for');

    const raised = con.win.events.slice(before).map(e => e.type);
    assert.equal(raised.filter(t => t === 'steward-publish-error').length, 0,
      'a healthy save raised ' + JSON.stringify(raised) + ' — a banner on every successful write is alarm ' +
      'fatigue on the screen where a real failure has to be believed');
    assert.ok(raised.includes('steward-publish-ok'), 'a healthy save raised ' + JSON.stringify(raised) + ', expected steward-publish-ok');
    assert.equal(await held(IN, church, GROUP_D), 1, 'the box this church signed for did not receive the group');
  } finally { con.close(); }
});

// ── 3. THE FAMILY, measured ─────────────────────────────────────────────────────────────────────────────
test('setBlocked never reaches that line — it is stopped one earlier, and says so through its own surface', async () => {
  // The audit that produced this fix named block() as the sharpest case: a ban that reaches no relay while
  // the steward sees the person blocked and _localBlocked updates synchronously. RUN, it is not reachable —
  // and the reason is worth pinning, because it is the only thing standing between four safeguarding writers
  // and the silence this file exists to remove. `targets` can only be empty when relays() is; _isRelayAuthed
  // iterates relays(); so _requireTrustedView refuses first. If a future edit drops that guard — or moves
  // _isRelayAuthed onto the CANDIDATE list, which would make it answer true over an empty publish set — this
  // test goes red and the fix above is what catches the fall.
  const con = consoleWriters({ church, origin: { protocol: 'https:', host: 'console.example.church' }, extra: [OUT.wsUrl] });
  try {
    await con.gate.refresh(con.relaysRaw(), church.pub);
    assert.deepEqual(con.relays(), [], 'the publish set is not empty, so this test is not staging the degraded case');

    const victim = 'b'.repeat(64);
    const before = con.win.events.length;
    let threw = null;
    try { await con.setBlocked([victim]); } catch (e) { threw = e; }

    assert.ok(threw, 'setBlocked returned normally over an empty publish set — it must refuse, not write into the void');
    const raised = con.win.events.slice(before).map(e => e.type);
    assert.deepEqual(raised, ['steward-write-blocked'],
      'setBlocked raised ' + JSON.stringify(raised) + '. The console renders steward-write-blocked on the same ' +
      'banner, so the steward IS told — but only while the trusted-view guard stands in front of it.');
    assert.ok(!con.localBlocked().has(victim),
      'the block was recorded in local state over a write that never left the device. That is the shape this ' +
      'project has shipped six times: the control says done and nothing happened.');
    assert.equal(await held(OUT, church, 'trinityone/blocked:'), 0, 'an unproved relay received a blocklist');
  } finally { con.close(); }
});

// ── 4. THE SCREEN ───────────────────────────────────────────────────────────────────────────────────────
// Everything above is the engine. This is the only test in the file that answers the question the fix is
// actually for: does a steward SEE anything?
//
// THE ORIGIN HAS NO RELAY, which is not a trick — it is merge day. The canonical pool is black-holed at the
// resolver (nothing may reach production from a test), and the page's own origin is a plain static server
// that answers 404 to /relay-identity exactly as the fleet does today. So no root can vouch for anything, the
// publish set is empty for the life of the page, and the console is in the state C4 puts every church in on
// the day it lands. No stubbing, no injection: the real bundle, the real gate, the real React tree.
const CHROME = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => existsSync(p));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.jsx': 'text/babel', '.css': 'text/css',
                '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

test('the steward SEES a message when a console write has nowhere to go', { skip: !CHROME ? 'no chromium' : false, timeout: 180000 }, async () => {
  const port = await H.freePort('the relay-less console origin');
  const cdp = await H.freePort('the console screen test\'s Chrome debug port');
  const srv = createServer((req, res) => {
    const p = normalize(join(ROOT, decodeURIComponent(String(req.url).split('?')[0])));
    if (!p.startsWith(ROOT) || !existsSync(p) || !extname(p)) { res.writeHead(404); res.end('not here'); return; }
    res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  });
  await new Promise(r => srv.listen(port, '127.0.0.1', r));
  const prof = mkdtempSync(join(tmpdir(), 'trin-noRelay-'));
  // Never let a test reach production, even by accident (scripts/no-browser-reaches-production.test.mjs).
  const BLOCK_PROD = '--host-resolver-rules=MAP app.trinityone.church 127.0.0.1:9, MAP *.ts.net 127.0.0.1:9, MAP trinityone.church 127.0.0.1:9';
  const chr = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${cdp}`, '--no-sandbox', '--disable-gpu',
    BLOCK_PROD, `--user-data-dir=${prof}`, '--window-size=1280,1200', `http://127.0.0.1:${port}/steward.html`], { stdio: 'ignore' });
  let ws = null;
  try {
    let targets = null;
    for (let i = 0; i < 40 && !targets; i++) { await sleep(400); try { targets = await (await fetch(`http://127.0.0.1:${cdp}/json`)).json(); } catch {} }
    assert.ok(targets && targets.length, 'chromium never exposed a debug target');
    const page = targets.find(t => t.type === 'page') || targets[0];
    ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 5e8 });
    await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
    let id = 0; const pend = new Map();
    ws.on('message', (d) => { const m = JSON.parse(d); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
    const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    await send('Runtime.enable');
    const evalIn = async (expression) => {
      const rr = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      return rr && rr.result && rr.result.result ? rr.result.result.value : undefined;
    };
    await sleep(9000);

    // Walk the real "Start a new church" path rather than seeding a key: the console refuses to hold a
    // plaintext seed, so a fixture would have to reproduce its AES-GCM/PBKDF2 blob — and a fixture that
    // drifts from the real format silently stops testing anything. This cannot drift; it IS the path.
    const click = (re) => `(() => { const b=[...document.querySelectorAll('button')].find(x=>${re}.test((x.textContent||'').trim())); if(b){b.click();return 'ok';} return 'miss'; })()`;
    const type = (ph, val) => `(() => { const i=[...document.querySelectorAll('input')].find(x=>(x.placeholder||'').includes(${JSON.stringify(ph)}));
      if(!i) return 'miss';
      const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
      set.call(i, ${JSON.stringify(val)}); i.dispatchEvent(new Event('input',{bubbles:true})); return 'ok'; })()`;
    assert.equal(await evalIn(click('/Start a new church/i')), 'ok', 'the console never offered "Start a new church"');
    await sleep(2500);
    assert.equal(await evalIn(type('At least 8', 'cedar-harbour-lamp-42')), 'ok', 'the PIN box was not on screen');
    assert.equal(await evalIn(type('Type it again', 'cedar-harbour-lamp-42')), 'ok', 'the confirm-PIN box was not on screen');
    assert.equal(await evalIn(click('/Set PIN/i')), 'ok', 'the console never offered "Set PIN"');
    await sleep(12000);   // key generation + the first render of the whole dashboard

    const nodes = await evalIn(`document.querySelectorAll('#root *').length`);
    assert.ok(nodes > 120, `#root has ${nodes} nodes — the console did not reach its dashboard, so anything below proves nothing`);

    const alerts = () => evalIn(`JSON.stringify([...document.querySelectorAll('[role="alert"]')].map(n => (n.textContent||'').trim()))`);

    // CLEAR THE SCREEN FIRST, and this is not tidiness. Booting a console on an origin with no relay makes
    // its OWN startup writes fail too — those go through publish(), which C4 already made honest — so a
    // banner is very often up before this test presses anything. The first version of this test asserted
    // only "an alert is on screen afterwards" and PASSED with the fix removed: it was reading somebody
    // else's message. Dismiss what is there, prove the screen is clear, and only then write.
    await evalIn(`(() => { document.querySelectorAll('[role="alert"] button').forEach(b => b.click()); return 'dismissed'; })()`);
    await sleep(600);
    const quietBefore = JSON.parse(await alerts());
    assert.deepEqual(quietBefore, [],
      'the console is still showing ' + JSON.stringify(quietBefore) + ' after being dismissed, so a message ' +
      'afterwards would prove nothing about the write under test');

    // …AND RECORD WHICH DOCUMENT EACH FAILURE IS ABOUT. Same reason: "an error was raised" is not "an error
    // was raised about THIS write". The d-tag in the event's own tags is what tells them apart.
    // No regex in here on purpose: a `\\/` inside this template literal collapses to `/` on the way to the
    // page and produces a SYNTAX ERROR there, which silently arms nothing and leaves the assertion below
    // reading an empty list. Measured, on the first version of this line.
    const armed = await evalIn(`(() => { window.__f2 = []; window.addEventListener('steward-publish-error', (e) => {
      try { window.__f2.push((((e.detail||{}).evt||{}).tags||[]).map(t => String(t[1] || '')).find(v => v.indexOf('trinityone/') === 0) || '(no d-tag)'); }
      catch (x) { window.__f2.push('(unreadable)'); } }); return 'armed'; })()`);
    assert.equal(armed, 'armed', 'the page never installed the listener, so the assertion below would read nothing whatever happened');

    // The shipped writer, on window.Steward, as the child-safe toggle and the group editor call it.
    const saved = await evalIn(`Promise.resolve(window.Steward.publishGroup({ name: 'Youth group', kind: 'group', childsafe: true })).then(r => JSON.stringify(r)).catch(e => 'threw: ' + e.message)`);
    assert.equal(saved, 'null', 'publishGroup answered ' + saved + ' over an origin with no relay — the screen check below would be staged wrong');
    await sleep(2500);

    const about = JSON.parse(await evalIn(`JSON.stringify(window.__f2 || [])`));
    assert.ok(about.some(d => String(d).startsWith('trinityone/group:')),
      'the real console raised ' + JSON.stringify(about) + ' — nothing about the group that was just saved. ' +
      'The all-relays writer failed with nowhere to publish to and told the screen nothing.');

    const shown = JSON.parse(await alerts());
    assert.ok(shown.length >= 1 && shown.some(t => t.length > 10),
      'the console raised the error and then showed the steward NOTHING: ' + JSON.stringify(shown) + '. A ' +
      'dispatched event nobody renders is the same defect wearing a different hat.');
  } finally {
    try { ws && ws.close(); } catch {}
    try { chr.kill('SIGKILL'); } catch {}
    try { srv.close(); } catch {}
    try { rmSync(prof, { recursive: true, force: true }); } catch {}
  }
});
