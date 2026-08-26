// THE STALL DETECTOR, DRIVEN BY AN ACTUAL WEDGED SOCKET.
// Run: node --test scripts/wedged-socket-real-chain.test.mjs
//
// WHY THIS FILE EXISTS, AND IT IS NOT A COMFORTABLE REASON. Its sibling, wedged-socket-recovers.test.mjs,
// has fourteen tests and they all inject the outcome by hand — 'ok', 'spoke', 'silent'. Nothing anywhere
// drove the step that DECIDES which of those a real socket produces. An audit broke that step in the shipped
// bundle so that a genuine timeout could never be read as silence — the whole feature dead, in one character —
// and all eighteen tests stayed green.
//
// So this file uses real WebSocket servers and the real publish path out of the shipped bundle. A server that
// accepts the connection and then never answers is the bug itself: the socket stays open, nothing closes, and
// the member's words go nowhere. A server that answers after six seconds is the church this product is FOR,
// and hanging up on it would be worse than the bug.
//
// It is deliberately slow — about seventeen seconds. That is the honest cost of a test that waits for a
// silence to actually be silent, and it is cheaper than the alternative, which is finding out on a phone.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WebSocketServer } from 'ws';
import { SimplePool } from 'nostr-tools/pool';
import { generateSecretKey, finalizeEvent } from 'nostr-tools/pure';
// THE REAL normaliser, not an approximation of it. The whole class of bug this file guards is the app and the
// pool disagreeing about how an address is spelled; a hand-rolled stub here would let the test agree with
// neither. The bundler renames the import, so both spellings are provided.
import { normalizeURL } from 'nostr-tools/utils';
import { requireFreePort } from './test-ports.mjs';
import { stripComments } from './test-slice.mjs';

const B = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
// A PORT EACH. Sharing one between tests means a server that is slow to release — and a wedged relay's
// sockets are by definition in no hurry — hands the NEXT test an EADDRINUSE instead of a result. Under a
// deliberate sabotage that turned three clean failures into a file that never exited, which is how this
// suite once lost fifteen minutes to a leftover listener.
const WEDGED_PORT = 8966, CHAIN_PORT = 8967, SLOW_PORT = 8969;

const lift = (name) => {
  const at = B.indexOf('function ' + name + '(');
  assert.notEqual(at, -1, name + ' is gone from the shipped bundle');
  let d = 0, end = -1;
  for (let i = B.indexOf('{', at); i < B.length; i++) { const c = B[i]; if (c === '{') d++; else if (c === '}' && --d === 0) { end = i + 1; break; } }
  return B.slice(at, end);
};
// THE PATCH THAT MAKES EVERY RELAY START PATIENT lives at module scope beside `new SimplePool()`, so it is
// not a function this file can lift. Take it verbatim and run it against the test's own pool — otherwise the
// pool under test is LESS patient than the shipped one and every timing assertion below is measuring the
// wrong software.
const liftEnsurePatch = () => {
  const at = B.indexOf('const _ensure = pool.ensureRelay.bind(pool);');
  assert.notEqual(at, -1,
    'the shipped code no longer raises the give-up as each relay is born — a relay’s FIRST publish is back ' +
    'to the library’s 4.4 seconds, which is the busiest moment there is, right after a reconnect');
  const fa = B.indexOf('{', B.indexOf('pool.ensureRelay = function', at));
  let d = 0, end = -1;
  for (let i = fa; i < B.length; i++) { const c = B[i]; if (c === '{') d++; else if (c === '}' && --d === 0) { end = i + 1; break; } }
  return B.slice(at, end) + ';';
};
const patchedPool = () => { const pool = new SimplePool(); new Function('pool', liftEnsurePatch())(pool); return pool; };

const rx = (name) => {
  const m = B.match(new RegExp(name + ' = (\\/[^;]*?\\/i);'));
  assert.ok(m, name + ' is gone — a refusal and a dead pipe are being conflated again');
  return new RegExp(m[1].slice(1, -2), 'i');
};

// The real chain out of the bundle: _publishAny -> _classify -> _noteSendResult. Only the CLOCK and
// reconnectAll are ours; every decision is the shipped one.
function chain(pool) {
  const outcomes = [];   // [url, outcome] exactly as the shipped code recorded them
  const reconnects = [];
  let clock = 1000000;
  const scope = {
    pool, _PUB_FAILED: rx('_PUB_FAILED'), _PUB_SILENT: rx('_PUB_SILENT'),
    WEDGE_ACK_MS: Number((stripComments(B).match(/WEDGE_ACK_MS\s*=\s*([\d.e+]+)/) || [])[1]),
    WEDGE_SILENCES: 3, WEDGE_WINDOW_MS: 60000, WEDGE_COOLDOWN_MS: 300000,
    _wedge: new Map(), _wedgeLastRecovery: 0,
    normalizeURL, normalizeURL2: normalizeURL,
    document: { visibilityState: 'visible' },
    reconnectAll: () => reconnects.push(clock),
    console: { warn: () => {} },
    Date: { now: () => clock },
    Promise, Array, Set, URL, Error, String, Number,
    __seen: outcomes,
  };
  const proxy = new Proxy(scope, {
    has: (t, k) => (k in t) || !(k in globalThis),
    get: (t, k) => { if (k in t) return t[k]; if (k === Symbol.unscopables) return undefined;
      throw new ReferenceError('needs a stub for ' + String(k)); },
    set: (t, k, v) => { t[k] = v; return true; },
  });
  const src = [lift('_wedgeKey'), lift('_poolSaysConnected'), lift('_classify'), lift('_dedupeRelays'),
    lift('_noteSendResult'), lift('_publishAny')].join('\n');
  // wrap _noteSendResult so we can SEE what the classifier decided, without changing what it decides
  const built = new Function('scope', `with (scope) { ${src};
    const _real = _noteSendResult;
    _noteSendResult = function (u, o) { __seen.push([u, o]); return _real(u, o); };
    return { publish: _publishAny, note: _noteSendResult }; }`);
  const api = built(proxy);
  return { ...api, outcomes, reconnects, tick: (ms) => { clock += ms; } };
}

// AND A DEAD MAN'S HANDLE. Passing, this file exits cleanly. FAILING, it may not: a wedged socket the pool
// gave up on can outlive the assertion that reported it, and a test file that never exits stops being a
// failing test and becomes a stuck suite — which reads, from CI, as no answer rather than a bad one. The
// timer is unref'd, so it changes nothing unless something else is still holding the process open.
after(() => { setTimeout(() => process.exit(process.exitCode || 0), 2000).unref(); });

const evt = () => finalizeEvent({ kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [], content: 'probe' }, generateSecretKey());

// A relay that accepts the socket, talks about subscriptions, and NEVER acknowledges an event. This is the
// bug: nothing closes, nothing errors, the member's words simply stop arriving.
function wedgedServer(port, { okAfterMs = null } = {}) {
  const wss = new WebSocketServer({ port });
  wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      let m; try { m = JSON.parse(String(raw)); } catch { return; }
      if (m[0] === 'REQ') { try { ws.send(JSON.stringify(['EOSE', m[1]])); } catch {} return; }
      if (m[0] === 'EVENT' && okAfterMs != null) {
        setTimeout(() => { try { ws.send(JSON.stringify(['OK', m[1].id, true, ''])); } catch {} }, okAfterMs);
      }
      // …and for the wedged case: nothing. No OK, no error, no close.
    });
  });
  // TEAR IT DOWN HARD. ws waits for every client socket before close() calls back, and a wedged relay is by
  // definition one whose sockets are not going anywhere — the suite has been hung for fifteen minutes by a
  // leftover listener before. Terminate the clients, then close, then give up after a second either way.
  return () => new Promise((r) => {
    for (const ws of wss.clients) { try { ws.terminate(); } catch (e) {} }
    const done = () => { clearTimeout(t); r(); };
    const t = setTimeout(done, 1000);
    try { wss.close(done); } catch (e) { done(); }
  });
}

test('a socket that accepts everything and answers nothing is read as SILENCE', { timeout: 40000 }, async () => {
  await requireFreePort(WEDGED_PORT, 'wedged-socket-real-chain.test.mjs');
  const stop = wedgedServer(WEDGED_PORT);
  const pool = patchedPool();
  const c = chain(pool);
  const url = 'ws://127.0.0.1:' + WEDGED_PORT + '/relay';
  try {
    // TWO SPELLINGS OF THE SAME RELAY, which is what a church's published relay list can easily contain —
    // nothing in this app normalises those lists. The pool refuses the second with "duplicate url", and that
    // refusal used to read as the relay TALKING, resetting the very count the real entry had just raised. The
    // stall detector went permanently blind for exactly the relay it mattered for.
    await assert.rejects(() => c.publish([url, url + '/'], evt()));
    assert.equal(c.outcomes.length, 1,
      'one relay under two names was judged ' + c.outcomes.length + ' times: ' + JSON.stringify(c.outcomes));
    assert.equal(c.outcomes[0][1], 'silent',
      'a socket that never answers is not being read as a stalled uplink — the whole feature is inert, and ' +
      'no amount of hand-injected outcomes in the sibling test file would notice');
  } finally { pool.destroy(); await stop(); }
});

test('…and three of those, spanning a minute, actually trigger the recovery', { timeout: 40000 }, async () => {
  // Joins the two halves: the real socket produces the real string, the shipped classifier buckets it, and the
  // shipped detector acts on it. The clock is injected because the alternative is a test that sleeps for a
  // minute; everything it is fed is genuine.
  await requireFreePort(CHAIN_PORT, 'wedged-socket-real-chain.test.mjs');
  const stop = wedgedServer(CHAIN_PORT);
  const pool = patchedPool();
  const c = chain(pool);
  const url = 'ws://127.0.0.1:' + CHAIN_PORT + '/relay';
  try {
    await assert.rejects(() => c.publish([url], evt()));
    const [seenUrl, outcome] = c.outcomes[0];
    assert.equal(outcome, 'silent');
    c.tick(30000); c.note(seenUrl, outcome);
    c.tick(31000); c.note(seenUrl, outcome);
    assert.equal(c.reconnects.length, 1,
      'a genuinely wedged socket, judged by the shipped code, still never causes a reconnect');
  } finally { pool.destroy(); await stop(); }
});

test('a relay that answers in six seconds is fine, and stays connected', { timeout: 40000 }, async () => {
  // THE CHURCH THIS PRODUCT IS FOR. The vendored library gives up at 4.4 seconds and calls it failure, so
  // without the raise every publish here is a silence and the detector hangs up on a relay that is working —
  // five-minutely, for ever, on the thinnest pipe in the congregation.
  //
  // The address is deliberately spelled at the ROOT with no trailing slash, the most natural way to type a
  // relay, because that is precisely the spelling the pool files under a DIFFERENT key. The raise used to be
  // looked up raw, so for this church it never landed at all.
  await requireFreePort(SLOW_PORT, 'wedged-socket-real-chain.test.mjs');
  const stop = wedgedServer(SLOW_PORT, { okAfterMs: 6000 });
  const pool = patchedPool();
  const c = chain(pool);
  const url = 'ws://127.0.0.1:' + SLOW_PORT;
  try {
    await c.publish([url], evt());
    assert.equal(c.outcomes[0][1], 'ok',
      'a relay answering in six seconds was recorded as ' + JSON.stringify(c.outcomes[0][1]) +
      ' — every message this church sends reads as failed, and its healthy relay gets hung up on');
    assert.equal(c.reconnects.length, 0);
  } finally { pool.destroy(); await stop(); }
});

test('every relay the pool opens starts patient, including the first one', () => {
  // The loop in _publishAny can only raise the give-up on a relay object that already EXISTS, and the pool
  // creates that object inside the publish it is about to make. So the first send to each relay — and the
  // first after every reconnect, which deletes them — ran at 4.4s and recorded a false silence. That is the
  // busiest moment there is, immediately after a recovery, and it seeded the next count.
  // The behavioural proof is the six-second test above, which runs against a COLD relay and would fail at
  // 4.4s. This is the anchor that keeps the extractor honest: if the patch is renamed or removed, every test
  // in this file starts measuring a pool that is not the shipped one, and lift would throw here first.
  const patch = liftEnsurePatch();
  assert.match(patch, /publishTimeout < (11000|11e3)[\s\S]{0,80}publishTimeout = (11000|11e3)/,
    'a relay’s first publish is back to the library’s 4.4-second give-up');
});
