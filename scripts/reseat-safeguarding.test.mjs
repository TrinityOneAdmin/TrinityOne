// A SEAT MOVES WITH EVERYTHING ATTACHED TO IT. Run: node --test scripts/reseat-safeguarding.test.mjs
//
// When a member loses their 12 words, the church cannot give their account back — so a steward vouches for
// them and puts a NEW key into their place. Safeguarding, though, is keyed on the PUBKEY: the `minors:` list
// names a key, the `guardians:` map names a key, and the clearance that tells a child's own phone it is a
// child is SEALED to a key. A re-seat that moves only the seat leaves every one of those pointing at a key
// that no longer exists.
//
// What that costs, measured before this was fixed:
//   * the child's phone reads ADULT — the clearance is sealed to the dead key, and the `minors:` fallback is a
//     list the relay deliberately refuses to serve ordinary members (it is a cleartext list of a
//     congregation's children), so absence reads as adulthood
//   * the RELAY agrees — safeguardAllows() lets anyone DM a key that no church names as a minor
//   * the next Members visit then SEALS `{minor:false}` to the new key: not a gap any more, but a
//     church-signed wrong answer, after which read-before-write skips that member for ever
//   * the parent link still points at the dead key, so a steward who correctly re-ticks "child" STILL leaves
//     the parent unable to message their own child — the one half no amount of hand-repair fixes
//
// The steward is not the backstop here. The confirm screen tells them "ONE thing to finish by hand" and names
// only invite-only groups, which reads as "everything else came across".
//
// These tests assert what the CHILD'S PHONE reads, using the shipped member-side handler lifted out of
// vendor/fellowship.js — not a paraphrase of it. "The relay has a document" is not the invariant.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { SimplePool } from 'nostr-tools/pool';
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { v2 as nip44v2 } from 'nostr-tools/nip44';
import { requireFreePort } from './test-ports.mjs';

const PORT = 8967;                       // unique across scripts/*.test.mjs and *.probe.mjs
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const CLEAR_D = 'trinityone/clearance:';
const now = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };
const church = K();
let relay, dataDir;

before(async () => {
  await requireFreePort(PORT, 'reseat-safeguarding.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-reseat-sg-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, RELAY_MAX_EVENTS: '20000', CHURCH_NPUB: npubEncode(church.pub) },
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) break; } catch {} await sleep(150); }
});
after(() => { try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

const STEWARD = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const FELLOWSHIP = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
function grab(src, sig) {
  let at = src.indexOf(sig);
  assert.notEqual(at, -1, sig + ' is gone from the shipped bundle — re-anchor this test, or rebuild');
  if (src.slice(Math.max(0, at - 6), at) === 'async ') at -= 6;
  let depth = 0, q = '';
  for (let i = src.indexOf('{', at); i < src.length; i++) {
    const c = src[i], prev = src[i - 1];
    if (q) { if (c === q && prev !== '\\') q = ''; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    // Skip // line comments — an apostrophe inside one ("the relay's") otherwise opens a phantom string and
    // the brace matcher runs off the end of the function. The other harnesses learned this the same way.
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i === -1) break; continue; }
    if (c === '{') depth++; else if (c === '}' && --depth === 0) return src.slice(at, i + 1);
  }
  assert.fail('could not find the end of ' + sig);
}

// ── the CHILD'S PHONE, lifted whole out of the shipped member bundle ───────────────────────────────────────
// `_onChurchDocs` is stubbed only to hand back the real handlers; every decision is the shipped one.
// LIFTED ONCE, AT MODULE LOAD — not inside childPhone(). childPhone is called from inside waitUntil's polled
// closure, and waitUntil swallows exceptions (a throw is just "not yet"). So when the shipped bundle is
// rebuilt and this anchor moves, grab()'s own `re-anchor this test, or rebuild` assertion was being eaten:
// the test burned its whole budget and then reported `fixture: the child was never marked in the first
// place`, pointing a maintainer at SAFEGUARDING when the real problem was the build. Extracting here means a
// broken anchor fails at load, loudly, saying what it actually is.
const SAFEGUARD_BODY = grab(FELLOWSHIP, 'subscribeChurchSafeguard(churchNpub, onLists) {');

function childPhone(childKeys, stewards) {
  const body = SAFEGUARD_BODY;
  const decName = (body.match(/\b(decrypt\d*)\(/) || [])[1];
  const ckName = (body.match(/\b(getConversationKey\d*)\(/) || [])[1];
  let handlers = null;
  const scope = {
    toPub: (x) => (/^[0-9a-f]{64}$/i.test(x) ? x.toLowerCase() : null),
    pubSet: (a) => new Set(a || []),
    _noPhoto: new Set(),
    _churchRoster: new Map([[church.pub, new Set(stewards || [])]]),
    _onChurchDocs: (_p, h) => { handlers = h; return () => {}; },
    sk: childKeys.sk, pub: childKeys.pub,
    [decName]: (c, k) => nip44v2.decrypt(c, k),
    [ckName]: (a, b) => nip44v2.utils.getConversationKey(a, b),
    window: { Fellowship: { myPubkey: childKeys.pub } },
  };
  const names = Object.keys(scope);
  const fn = new Function(...names, 'return ({ ' + body + ' });')(...names.map(n => scope[n]));
  let last = null;
  fn.subscribeChurchSafeguard(church.pub, (x) => { last = x; });
  return {
    feed: (e) => handlers.onevent(e, (e.tags.find(t => t[0] === 'd') || [])[1] || ''),
    isMinor: () => (last ? !!last.isMinor : false),
    known: () => (last ? !!last.clearanceKnown : false),
  };
}

// read every safeguarding document the relay will give the CHURCH, and feed them to a phone
async function feedPhoneFromRelay(phone, memberPub) {
  const w = await new Promise((res, rej) => { const s = new WebSocket(WS_URL); s.on('open', () => res(s)); s.on('error', rej); });
  await new Promise(res => {
    const on = d => {
      const m = JSON.parse(d);
      if (m[0] === 'AUTH') w.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now(),
        tags: [['relay', WS_URL], ['challenge', m[1]]], content: '' }, church.sk)]));
      if (m[0] === 'EVENT' && m[1] === 'q') { try { phone.feed(m[2]); } catch (x) {} }
      if (m[0] === 'EOSE' && m[1] === 'q') { w.off('message', on); res(); }
    };
    w.on('message', on);
    w.send(JSON.stringify(['REQ', 'q', { kinds: [30078], '#d': [
      CLEAR_D + memberPub, 'trinityone/minors:' + church.pub, 'trinityone/approved:' + church.pub,
      'trinityone/guardians:' + church.pub] }]));
    setTimeout(res, 2500);   // as above: short, because waitUntil re-runs this
  });
  w.close();
}


// Join the church for real, so a refusal later is about SAFEGUARDING and not about membership. Without this
// the relay refuses the parent's DM either way and the test goes red for a reason it is not testing — which
// is exactly how a test comes to prove nothing.
async function joinChurch(keys) {
  const w = await new Promise((res, rej) => { const x = new WebSocket(WS_URL); x.on('open', () => res(x)); x.on('error', rej); });
  const ev = finalizeEvent({ kind: 30078, created_at: now(),
    tags: [['d', 'trinityone/member:' + church.pub], ['t', 'trinityone'], ['p', church.pub]], content: '{}' }, keys.sk);
  const ok = await new Promise(res => {
    const on = d => { const m = JSON.parse(d);
      if (m[0] === 'AUTH') w.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now(),
        tags: [['relay', WS_URL], ['challenge', m[1]]], content: '' }, keys.sk)]));
      if (m[0] === 'OK' && m[1] === ev.id) { w.off('message', on); res(!!m[2]); } };
    w.on('message', on); w.send(JSON.stringify(['EVENT', ev]));
    setTimeout(() => res(false), 2500);   // SHORT on purpose: this runs inside waitUntil, and a 6s inner
  });                                    // timeout inside a 10s budget allowed only two attempts — see waitUntil
  w.close();
  return ok;
}

// WAIT FOR THE STATE, DON'T GUESS HOW LONG IT TAKES.
//
// This test drives a REAL relay: the console publishes minors/guardians/admitted documents, the gateway
// ingests them into its in-memory maps, and only then does a DM decision reflect them. That gap is real work,
// not a fixed cost, so the `await sleep(400)` this replaced was a bet on how loaded the machine was. It won
// when the test ran alone and lost about two runs in three inside the full suite — always failing on the
// FIXTURE line ("the parent could not reach their child even before the reconnect"), never on the assertion
// the test exists to make.
//
// That matters more than an ordinary flake: this is a safeguarding test, and one that reddens at random
// teaches the reflex "just run it again" — which is precisely how a genuine safeguarding regression would be
// waved through. Polling keeps the assertion exactly as strict (a condition that never becomes true still
// fails, just later) while removing the guess.
async function waitUntil(check, ms = 10000, every = 120) {
  const t0 = Date.now();
  for (;;) {
    let v = false;
    try { v = await check(); } catch (e) { v = false; }
    if (v) return true;
    if (Date.now() - t0 >= ms) return false;
    await sleep(every);
  }
}

// EVERY FIXTURE PUBLISH IS CHECKED. This is the flake's real cause, and it took an audit to see it.
//
// The console's own code checks these — `if (!await w(() => window.Steward.setMinors(next))) throw …` in
// src/steward.src.js. This test threw the return values away. `publish()` is `Promise.any` over the pool with
// a 1500ms connection budget, so under load it can resolve FALSE, and the relay then holds no minors or
// guardians document at all. The test's next line asks "can the parent reach their child?", the relay says
// no because nothing marks anyone, and the failure surfaces 10 seconds later as
// `fixture: the parent could not reach their child even before the reconnect` — pointing at safeguarding
// when the truth is that a write never landed. Measured by the audit of 2026-08-18: publish minors, withhold
// guardians, and the control fails after 10062ms with exactly that wording.
//
// Retry, because a fixture must be reliable, then ASSERT, because a fixture that quietly gave up is how a
// test comes to prove nothing. The assertions under test are untouched and stay strict.
async function mustPublish(what, fn, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    last = await fn();
    if (last !== false && last !== null && last !== undefined) return last;
    await sleep(1100);   // replaceable docs are newest-wins to the SECOND; retrying inside one is refused
  }
  assert.fail(`fixture: ${what} never landed on the relay (last result: ${JSON.stringify(last)}). The test `
    + 'below would have blamed safeguarding for a write that simply never arrived.');
}

// may this key DM that one, as far as the relay is concerned?
async function parentDM(from, toPub) {
  const w = await new Promise((res, rej) => { const x = new WebSocket(WS_URL); x.on('open', () => res(x)); x.on('error', rej); });
  const dm = finalizeEvent({ kind: 4, created_at: now(), tags: [['p', toPub]], content: 'are you ok love' }, from.sk);
  const ok = await new Promise(res => {
    const on = d => { const m = JSON.parse(d);
      if (m[0] === 'AUTH') w.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now(),
        tags: [['relay', WS_URL], ['challenge', m[1]]], content: '' }, from.sk)]));
      if (m[0] === 'OK' && m[1] === dm.id) { w.off('message', on); res(!!m[2]); } };
    w.on('message', on); w.send(JSON.stringify(['EVENT', dm]));
    setTimeout(() => res(false), 2500);   // SHORT on purpose: this runs inside waitUntil, and a 6s inner
  });                                    // timeout inside a 10s budget allowed only two attempts — see waitUntil
  w.close();
  return ok;
}

// the church console, driving the SHIPPED engine against the real relay
function consoleSide() {
  const pool = new SimplePool({ verifyEvent, websocketImplementation: WebSocket, maxWaitForConnection: 1500 });
  // Top-level DECLARATIONS concatenate; object-literal METHODS have to be wrapped back into an object, or
  // `setMinors(pubkeys) { … }` is a syntax error at statement position.
  // publish() waits for the church to exist on a relay (R5-5); lift its gate too. _regGate starts null,
  // the already-registered state, so nothing here waits.
  const decls = 'let _regGate = null; const REG_GATE_MS = 45000;\n'
    + grab(STEWARD, 'async function _waitForRegistration()')
    + grab(STEWARD, 'async function publish(evt)')
    + grab(STEWARD, 'var _beatsDoc = ') + ';\n'
    + grab(STEWARD, 'function _memberHonours(') + grab(STEWARD, 'function _topWeMustAnswer(')
    + grab(STEWARD, 'function _newestByD(') + grab(STEWARD, 'function _connectedRelays(')
    + grab(STEWARD, 'function _guardiansDiffer(')
    + grab(STEWARD, 'async function _clearancesMatching(') + grab(STEWARD, 'function _clearanceOutranks(')
    + grab(STEWARD, 'async function _publishToRelays(evt, urls)');
  const methods = [
    grab(STEWARD, 'publishClearance(memberPub, status, urls)'),
    grab(STEWARD, 'refreshClearances(memberPubs, minors, approved, guardians)'),
    grab(STEWARD, 'async _refreshClearancesNow(memberPubs, minors, approved, guardians)'),
    grab(STEWARD, 'setMinors(pubkeys)'), grab(STEWARD, 'setApproved(pubkeys, opts)'),
    grab(STEWARD, 'setGuardians(links)'), grab(STEWARD, 'setReseats(pairs)'),
    grab(STEWARD, 'setAdmitted(pubkeys)'), grab(STEWARD, 'setBlocked(pubkeys)'),
    grab(STEWARD, 'async reseatMember(oldPub, newPub, o)'),
  ].join(',\n');
  const encName = (methods.match(/=\s*(encrypt\d*)\(/) || [])[1];
  const decName = (decls.match(/\b(decrypt\d*)\(/) || [])[1];
  const ckName = (methods.match(/\b(getConversationKey\d*)\(/) || [])[1];
  // esbuild renames imported bindings (finalizeEvent2, getPublicKey2, encrypt3 …). Bind what the bundle
  // actually emitted — guessing the names makes every publish throw inside the engine's own try/catch and
  // return null, which looks exactly like the bug under test.
  const all = decls + methods;
  const feName = (all.match(/\b(finalizeEvent\d*)\(/) || [])[1];
  const gpName = (all.match(/\b(getPublicKey\d*)\(/) || [])[1];
  const nuName = (all.match(/\b(normalizeURL\d*)\(/) || [])[1];
  assert.ok(encName && decName && ckName && feName, 'the bundle no longer signs/encrypts the way this test expects — re-anchor');
  const scope = {
    pool, relays: () => [WS_URL], sk: church.sk, pub: church.pub, actingChurch: '',
    churchPub: church.pub, CLEARANCE_D: CLEAR_D, NET: 'trinityone',
    MINORS_D: 'trinityone/minors:', APPROVED_D: 'trinityone/approved:', GUARDIANS_D: 'trinityone/guardians:',
    RESEAT_D: 'trinityone/reseat:', ADMITTED_D: 'trinityone/admitted:', BLOCKED_D: 'trinityone/blocked:',
    _careRoster: new Set(), _careRosterKnown: true, _clearanceSent: new Map(), _clearanceQueue: Promise.resolve(),
    _relaysTouched: new Set(), _returnAnnounced: new Map(),
    _isRelayAuthed: () => true, _requireTrustedView: () => {}, _viewingNetwork: () => false,
    _authFuture: (e) => (e.created_at || 0) > Math.floor(Date.now() / 1000) + 600,
    _CLOCK_SKEW: 600, now, toPubHex: (p) => (/^[0-9a-f]{64}$/i.test(p) ? p.toLowerCase() : null),
    [feName]: finalizeEvent, feChurch: (t) => finalizeEvent(t, church.sk),
    ...(gpName ? { [gpName]: getPublicKey } : {}), ...(nuName ? { [nuName]: (u) => u } : {}),
    [encName]: (a, k) => nip44v2.encrypt(a, k), [decName]: (c, k) => nip44v2.decrypt(c, k),
    [ckName]: (a, b) => nip44v2.utils.getConversationKey(a, b),
    setTimeout, console,
    window: { Steward: {}, dispatchEvent: () => {} },
  };
  const names = Object.keys(scope);
  const api = new Function(...names, decls + '\nreturn ({ ' + methods + ' });')(...names.map(n => scope[n]));
  scope.window.Steward = api;
  return { api, close: () => { try { pool.close([WS_URL]); } catch (e) {} } };
}

test('a reconnected child is still a child on their own phone', async () => {
  const parent = K(), child = K(), newKey = K();
  const s = consoleSide();
  try {
    // The church marks the child and links their parent, then seals the record their phone reads.
    await mustPublish('setMinors', () => s.api.setMinors([child.pub]));
    await mustPublish('setGuardians', () => s.api.setGuardians({ [child.pub]: [parent.pub] }));
    await mustPublish('refreshClearances', () => s.api.refreshClearances([child.pub], [child.pub], []));
    assert.equal(await waitUntil(async () => {
      const p = childPhone(child, []);
      await feedPhoneFromRelay(p, child.pub);
      return p.isMinor();
    }), true, 'fixture: the child was never marked in the first place');

    // They lose their phone. The steward reconnects them onto a new key — exactly as the console does.
    // The console passes its current view of the church, exactly as the modal does — the engine holds no
    // copy of these lists, by design, so a caller that forgets one is the defect this test exists to catch.
    await mustPublish('reseatMember', () => s.api.reseatMember(child.pub, newKey.pub, {
      name: 'Sara', reseats: [], admitted: [child.pub],
      minors: [child.pub], approved: [], guardians: { [child.pub]: [parent.pub] },
    }));
    const stillAChild = await waitUntil(async () => {
      const p = childPhone(newKey, []);
      await feedPhoneFromRelay(p, newKey.pub);
      return p.isMinor();
    });
    assert.equal(stillAChild, true,
      'the reconnected child\'s own phone reads ADULT. Their safeguarding record is sealed to the key they '
      + 'lost, and the minors list the app falls back to is one the relay refuses to serve ordinary members — '
      + 'so an absence reads as adulthood. The relay opens too: nothing names this key as a minor, so adult '
      + 'DMs and adults-only rooms are allowed. Nobody is told, and the confirm screen says the only thing '
      + 'left to do by hand is invite-only groups.');
  } finally { s.close(); }
});

test('…and their parent can still reach them', async () => {
  // The half a steward CANNOT repair by hand. Re-ticking "child" on the new row restores the marking, but the
  // guardian map still names the dead key — so the parent is refused a DM to their own child, and the child
  // is refused one to their parent (a child may only DM a CLEARED adult, and a parent is linked, not cleared).
  const parent = K(), child = K(), newKey = K();
  const s = consoleSide();
  try {
    assert.ok(await joinChurch(parent), 'fixture: the parent could not join the church');
    assert.ok(await joinChurch(child), 'fixture: the child could not join the church');
    assert.ok(await joinChurch(newKey), 'fixture: the new key could not join the church');
    await mustPublish('setAdmitted', () => s.api.setAdmitted([parent.pub, child.pub, newKey.pub]));
    await mustPublish('setMinors', () => s.api.setMinors([child.pub]));
    await mustPublish('setGuardians', () => s.api.setGuardians({ [child.pub]: [parent.pub] }));
    // CONTROL: before the reconnect, the parent CAN reach their child — so a refusal afterwards is the
    // guardian link breaking, not membership or anything else.
    assert.equal(await waitUntil(() => parentDM(parent, child.pub)), true,
      'fixture: the parent could not reach their child even before the reconnect');
    await mustPublish('reseatMember', () => s.api.reseatMember(child.pub, newKey.pub, {
      name: 'Sara', reseats: [], admitted: [child.pub],
      minors: [child.pub], approved: [], guardians: { [child.pub]: [parent.pub] },
    }));
    const ok = await waitUntil(() => parentDM(parent, newKey.pub));
    assert.equal(ok, true,
      'a linked parent can no longer message their own child after the child was reconnected. The guardian '
      + 'map still points at the key they lost. This is the half no steward can put right by hand — re-ticking '
      + '"child" restores the marking and leaves the family severed, silently.');
  } finally { s.close(); }
});
