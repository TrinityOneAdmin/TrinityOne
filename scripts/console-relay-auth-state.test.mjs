// Once the socket is gone, the console must stop believing it is authenticated.
// Run: node --test scripts/console-relay-auth-state.test.mjs
//
// HANDOFF-2026-07-31, finding 5. `_relayAuthed` was set to true the first time the console signed a NIP-42
// challenge and then NEVER cleared — observed still true with the relay killed. It gates every "never act on
// an untrusted view" rule in the console:
//
//   src/steward.src.js  _requireTrustedView()          the minors / blocked / stewards / approved list writes
//                       ensureCareKeyForMembers        the care-key MINT gate
//                       ensureNameKeyForMembers        the name-key mint gate
//                       publishGroupKey                group-key rotation
//                       encrypted media upload         "does this church already have a media key?"
//
// Every one of those guards exists because acting on an empty answer DESTROYS data rather than merely failing.
// The comments at those sites say it plainly: a private doc is served only to an authenticated reader, so an
// unauthenticated — or unreachable — relay answers "nothing" for a church that HAS a key. Minting on that
// answer creates a second key generation and permanently orphans everything sealed with the first; writing a
// list on it hard-deletes the real one, so marking one child as a minor silently un-minors every other child.
//
// After a socket drops and the pool re-subscribes, the new connection is unauthenticated while the flag still
// says authed. That is exactly the window those comments describe, and nothing closed it.
//
// The fix is to stop keeping a flag at all and ask the pool: are we currently connected to a relay we have
// authenticated to? A dropped relay is removed from the pool's map (see console-relay-health.test.mjs), so the
// answer becomes false on its own — no reset to forget to fire.
//
// DIRECTION OF THE RISK, stated because it decides the design: a spurious FALSE makes those guards refuse to
// write, which is visible to the steward and retryable. A spurious TRUE silently destroys a church's keys or
// its safeguarding list. So every ambiguous case here resolves to false, including the catch block.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { SimplePool } from 'nostr-tools/pool';
import { normalizeURL } from 'nostr-tools/utils';
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { requireFreePort } from './test-ports.mjs';

const PORT = 8992;          // unique across scripts/*.test.mjs AND scripts/*.probe.mjs
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const SAFETY_D = 'trinityone/safetycheck:';
const now = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };
const church = K();
let relay, dataDir;

const STEWARD = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');

async function startRelay() {
  dataDir = dataDir || mkdtempSync(join(tmpdir(), 'trin-authstate-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, RELAY_MAX_EVENTS: '20000', CHURCH_NPUB: npubEncode(church.pub) },
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) return; } catch {} await sleep(150); }
  throw new Error('the test relay never came up on port ' + PORT);
}
before(async () => {
  await requireFreePort(PORT, 'console-relay-auth-state.test.mjs');
  await startRelay();
});
after(() => { try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

function grab(sig) {
  let at = STEWARD.indexOf(sig);
  assert.notEqual(at, -1, sig + ' is gone from the shipped console bundle — re-anchor this test, or rebuild: bash scripts/build-steward.sh');
  if (STEWARD.slice(Math.max(0, at - 6), at) === 'async ') at -= 6;
  // Start the brace scan at the BODY's `{`, not the first `{` after the name. `ensureNameKeyForMembers(…, opts
  // = {})` has a default-object parameter, and scanning from the first brace brace-matches `{}` and returns an
  // empty body — which then fails the assertion below for entirely the wrong reason.
  const from = sig.trimEnd().endsWith('{') ? at + STEWARD.indexOf(sig) + sig.length - 1 - at : STEWARD.indexOf('{', at);
  let depth = 0, q = '';
  for (let i = from; i < STEWARD.length; i++) {
    const c = STEWARD[i], prev = STEWARD[i - 1];
    if (q) { if (c === q && prev !== '\\') q = ''; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '/' && STEWARD[i + 1] === '/') { i = STEWARD.indexOf('\n', i); if (i === -1) break; continue; }
    if (c === '{') depth++; else if (c === '}' && --depth === 0) return STEWARD.slice(at, i + 1);
  }
  assert.fail('could not find the end of ' + sig);
}

// Slice from `startsWith` up to and including the statement that ends at the matching brace after `endsAfter`.
function grabSpan(startsWith, endsAfter) {
  const from = STEWARD.indexOf(startsWith);
  assert.ok(from > 0, startsWith + ' is gone from the shipped bundle — re-anchor this test');
  const anchor = STEWARD.indexOf(endsAfter, from);
  assert.ok(anchor > 0 && anchor - from < 3000, endsAfter + ' no longer follows ' + startsWith + ' — re-anchor this test');
  let depth = 0, i = STEWARD.indexOf('{', anchor);
  for (; i < STEWARD.length; i++) {
    if (STEWARD[i] === '{') depth++;
    else if (STEWARD[i] === '}' && --depth === 0) break;
  }
  return STEWARD.slice(from, STEWARD.indexOf(';', i) + 1);
}

// The shipped auth-state machinery over a REAL SimplePool and a REAL relay. The finding is entirely about what
// survives a socket close, so nothing here is stubbed except the church key itself.
function consoleSide(urls) {
  const pool = new SimplePool({ verifyEvent, websocketImplementation: WebSocket, maxWaitForConnection: 1500 });
  // Whatever the console tracks auth in, and however it wires the pool's auth hook, has to come from the
  // bundle — re-declaring it here would test a description of the console rather than the console.
  const authState = grabSpan('var _authedRelays = ', 'pool.automaticallyAuth = ');
  assert.match(authState, /_authedRelays\.add/,
    'nothing records which relay the console authenticated to, so relayAuthed() is either a flag that is never ' +
    'cleared (the finding) or always false — re-anchor this test, or rebuild: bash scripts/build-steward.sh');
  const isAuthed = grab('function _isRelayAuthed(');
  const relayAuthed = grab('relayAuthed() {');
  const scope = {
    pool, relays: () => urls, normalizeURL, finalizeEvent,
    sk: church.sk, console: { warn() {}, log() {} }, Set, String, JSON,
  };
  const args = Object.keys(scope);
  const built = new Function(...args,
    `${authState}\n${isAuthed}\nreturn ({ ${relayAuthed}, _isRelayAuthed });`)(...args.map(k => scope[k]));
  return { ...built, pool, close: () => { try { pool.destroy(); } catch {} } };
}

// The relay's NIP-42 challenge is LAZY — it only challenges a REQ that names an invite group, a safeguarding
// doc, or a safety d-tag (gateway.mjs, "LAZY NIP-42"). This is the subscription shape that provokes one.
const authSub = (s) => s.pool.subscribeMany([WS_URL], [{ kinds: [30078], '#d': [SAFETY_D + church.pub] }],
  { onevent() {}, oneose() {} });

test('CONTROL: a console that has not connected to anything is NOT authenticated', () => {
  const s = consoleSide([WS_URL]);
  assert.equal(s.relayAuthed(), false,
    'a freshly-booted console claims to have authenticated before it has opened a socket. Every mint gate in ' +
    'the console would then act on the empty answer an unconnected relay gives.');
  s.close();
});

test('CONTROL: after a real NIP-42 exchange it IS authenticated', async () => {
  const s = consoleSide([WS_URL]);
  const sub = authSub(s);
  await sleep(1000);
  assert.equal(s.relayAuthed(), true,
    'the console never registered a completed auth against a live relay. If this is false the guards refuse ' +
    'every write and the console is unusable — check the relay challenged at all before changing the fix.');
  try { sub.close(); } catch {}
  s.close();
});

// ── the finding ──────────────────────────────────────────────────────────────────────────────────────────
test('A KILLED RELAY MUST CLEAR THE AUTHENTICATED VIEW', async () => {
  const s = consoleSide([WS_URL]);
  const sub = authSub(s);
  await sleep(1000);
  assert.equal(s.relayAuthed(), true, 'the console did not authenticate before the kill — fixture broken');

  relay.kill('SIGKILL');
  await sleep(1200);

  assert.equal(s.relayAuthed(), false,
    'with the relay dead the console still reports itself authenticated. Every guard that exists to stop the ' +
    'console acting on an empty answer is now open: ensureCareKeyForMembers can mint a SECOND care key and ' +
    'orphan every sealed need, ensureNameKeyForMembers the same for every sealed name, and a minors-list edit ' +
    'can hard-delete the real list and silently un-minor every other child in the church.');
  try { sub.close(); } catch {}
  s.close();
  await startRelay();
});

test('…and re-authenticating on the new socket restores it', async () => {
  // Recovery has to close the loop. A console stuck at "not authenticated" refuses every safeguarding write
  // for the rest of the session — visible and retryable rather than destructive, but still broken.
  const s = consoleSide([WS_URL]);
  const sub1 = authSub(s);
  await sleep(1000);
  relay.kill('SIGKILL');
  await sleep(1200);
  assert.equal(s.relayAuthed(), false, 'the drop was not detected — fixture broken');
  try { sub1.close(); } catch {}
  await startRelay();
  const sub2 = authSub(s);
  await sleep(1200);
  assert.equal(s.relayAuthed(), true,
    'the relay is back and the console has re-authenticated, but it still reports itself unauthenticated — so ' +
    'every list write and key check refuses for the rest of the session');
  try { sub2.close(); } catch {}
  s.close();
});

test('a relay we are connected to but have NOT authenticated to does not count', async () => {
  // The distinction that makes this worth having. Being connected is not being authenticated, and it is the
  // authenticated read that the mint gates are entitled to trust.
  const s = consoleSide([WS_URL]);
  // An ordinary, non-safeguarding REQ: the relay's lazy auth does not challenge it, so the socket opens and
  // stays anonymous.
  const sub = s.pool.subscribeMany([WS_URL], [{ kinds: [1], limit: 1 }], { onevent() {}, oneose() {} });
  await sleep(1000);
  assert.equal(s.pool.listConnectionStatus().get(normalizeURL(WS_URL)), true,
    'the socket did not open at all — fixture broken, this test proves nothing');
  assert.equal(s.relayAuthed(), false,
    'an open but UNAUTHENTICATED socket counts as authenticated. A private doc is withheld from this ' +
    'connection, so the console reads "no care key" for a church that has one, and mints a second.');
  try { sub.close(); } catch {}
  s.close();
});

test('AN ERROR ASKING THE POOL RESOLVES TO "NOT AUTHENTICATED"', () => {
  // Caught by sabotage: flipping this catch to `return true` passed every other test in this file, because
  // nothing else makes listConnectionStatus() throw. An untested catch block in a safeguarding gate is exactly
  // where a wrong default hides.
  //
  // The direction matters and is not symmetric. False → the guards refuse a write, the steward sees "wait a
  // moment and try again", and they retry. True → a minors-list edit republishes over a view we could not
  // verify and hard-deletes the real list, silently un-minoring every other child.
  const throwing = { listConnectionStatus() { throw new Error('pool is gone'); } };
  const isAuthed = new Function('pool', '_authedRelays', 'normalizeURL', 'Set',
    grab('function _isRelayAuthed(') + '\nreturn _isRelayAuthed;')(throwing, new Set(['ws://x/relay']), (u) => u, Set);
  assert.equal(isAuthed(), false,
    'when the pool cannot be asked, the console assumes it IS authenticated. Every trusted-view guard then ' +
    'acts on a view it could not verify — which is the destructive direction, not the annoying one.');
});

// ── the consequence the guards exist for ─────────────────────────────────────────────────────────────────
test('EVERY TRUSTED-VIEW GUARD ASKS THE POOL, NOT A STALE FLAG', () => {
  // Behavioural tests above prove relayAuthed() is right. This proves the guards actually consult it. A fix
  // that corrected relayAuthed() while the internal guards kept reading a never-cleared boolean would leave
  // every destructive path exactly as it was, with the tests above still green.
  const stale = STEWARD.match(/[^.\w]_relayAuthed\b/g) || [];
  assert.deepEqual(stale, [],
    `${stale.length} site(s) still read a bare _relayAuthed flag instead of asking the pool whether a relay ` +
    'is currently connected AND authenticated. Those are the mint gates and list writes; a flag that is set ' +
    'once and never cleared leaves them open for the rest of the session.');
  for (const [name, sig] of [
    ['_requireTrustedView', 'function _requireTrustedView('],
    ['ensureNameKeyForMembers', 'ensureNameKeyForMembers(memberPubs, stewardPubs, opts = {}) {'],
  ]) {
    assert.match(grab(sig), /_isRelayAuthed\(\)/,
      `${name} no longer checks the live auth state, so it will act on whatever an unauthenticated or ` +
      'unreachable relay answered');
  }
});

test('the trusted-view gate REFUSES a list write when the relay is gone', async () => {
  // Executes the shipped _requireTrustedView() against a real, killed relay — the guard that stands between a
  // dropped socket and a hard-deleted safeguarding list.
  const s = consoleSide([WS_URL]);
  const sub = authSub(s);
  await sleep(1000);
  const blocked = [];
  const gate = new Function('_isRelayAuthed', 'window', 'CustomEvent',
    grab('function _requireTrustedView(') + '\nreturn _requireTrustedView;')(
    s._isRelayAuthed, { dispatchEvent: (e) => blocked.push(e) },
    function (t, d) { this.type = t; this.detail = (d || {}).detail; });

  assert.doesNotThrow(() => gate('list of children'), 'the gate refused a write while properly authenticated');

  relay.kill('SIGKILL');
  await sleep(1200);
  assert.throws(() => gate('list of children'), /finished connecting/,
    'with the relay dead, a minors-list write went through on an untrustworthy view. That write republishes ' +
    'the whole list from whatever the console currently holds and hard-deletes the previous version — so ' +
    'every child not in that stale view silently stops being a minor.');
  assert.equal(blocked.length, 1, 'the refusal never reached a screen, so the steward thinks it saved');
  try { sub.close(); } catch {}
  s.close();
  await startRelay();
});
