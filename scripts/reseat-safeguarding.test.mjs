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
function childPhone(childKeys, stewards) {
  const body = grab(FELLOWSHIP, 'subscribeChurchSafeguard(churchNpub, onLists) {');
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
    setTimeout(res, 8000);
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
    setTimeout(() => res(false), 6000);
  });
  w.close();
  return ok;
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
    setTimeout(() => res(false), 6000);
  });
  w.close();
  return ok;
}

// the church console, driving the SHIPPED engine against the real relay
function consoleSide() {
  const pool = new SimplePool({ verifyEvent, websocketImplementation: WebSocket, maxWaitForConnection: 1500 });
  // Top-level DECLARATIONS concatenate; object-literal METHODS have to be wrapped back into an object, or
  // `setMinors(pubkeys) { … }` is a syntax error at statement position.
  const decls = grab(STEWARD, 'async function publish(evt)')
    + grab(STEWARD, 'var _beatsDoc = ') + ';\n'
    + grab(STEWARD, 'function _memberHonours(') + grab(STEWARD, 'function _topWeMustAnswer(')
    + grab(STEWARD, 'function _newestByD(') + grab(STEWARD, 'function _connectedRelays(')
    + grab(STEWARD, 'async function _clearancesMatching(') + grab(STEWARD, 'function _clearanceOutranks(')
    + grab(STEWARD, 'async function _publishToRelays(evt, urls)');
  const methods = [
    grab(STEWARD, 'publishClearance(memberPub, status, urls)'),
    grab(STEWARD, 'refreshClearances(memberPubs, minors, approved, guardians)'),
    grab(STEWARD, 'async _refreshClearancesNow(memberPubs, minors, approved, guardians)'),
    grab(STEWARD, 'setMinors(pubkeys)'), grab(STEWARD, 'setApproved(pubkeys)'),
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
    await s.api.setMinors([child.pub]);
    await s.api.setGuardians({ [child.pub]: [parent.pub] });
    await s.api.refreshClearances([child.pub], [child.pub], []);
    await sleep(600);

    const before = childPhone(child, []);
    await feedPhoneFromRelay(before, child.pub);
    assert.equal(before.isMinor(), true, 'fixture: the child was never marked in the first place');

    // They lose their phone. The steward reconnects them onto a new key — exactly as the console does.
    // The console passes its current view of the church, exactly as the modal does — the engine holds no
    // copy of these lists, by design, so a caller that forgets one is the defect this test exists to catch.
    await s.api.reseatMember(child.pub, newKey.pub, {
      name: 'Sara', reseats: [], admitted: [child.pub],
      minors: [child.pub], approved: [], guardians: { [child.pub]: [parent.pub] },
    });
    await sleep(600);

    const after = childPhone(newKey, []);
    await feedPhoneFromRelay(after, newKey.pub);
    assert.equal(after.isMinor(), true,
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
    await s.api.setAdmitted([parent.pub, child.pub, newKey.pub]);
    await s.api.setMinors([child.pub]);
    await s.api.setGuardians({ [child.pub]: [parent.pub] });
    await sleep(400);

    // CONTROL: before the reconnect, the parent CAN reach their child — so a refusal afterwards is the
    // guardian link breaking, not membership or anything else.
    assert.equal(await parentDM(parent, child.pub), true, 'fixture: the parent could not reach their child even before the reconnect');
    await s.api.reseatMember(child.pub, newKey.pub, {
      name: 'Sara', reseats: [], admitted: [child.pub],
      minors: [child.pub], approved: [], guardians: { [child.pub]: [parent.pub] },
    });
    await sleep(600);

    const ok = await parentDM(parent, newKey.pub);
    assert.equal(ok, true,
      'a linked parent can no longer message their own child after the child was reconnected. The guardian '
      + 'map still points at the key they lost. This is the half no steward can put right by hand — re-ticking '
      + '"child" restores the marking and leaves the family severed, silently.');
  } finally { s.close(); }
});
