// AN ORDINARY MEMBER MAY WRITE ONLY THE DOCUMENT TYPES THIS PRODUCT HAS DECLARED MEMBER-WRITABLE.
// Run: node --test scripts/relay-refuses-undeclared-member-doc-types.test.mjs
//
// THE HOLE, measured on a real gateway at 6b6e66d before the fix (the first test below, run against that
// commit, printed the frame verbatim):
//
//     member mia publishes kind 30078, d=trinityone/zzz:<churchpub>   ->   ["OK", <id>, true, ""]
//
// accept()'s kind-30078 block ends with the "M1 catch-all": `if (!isMember) return false; ...cap...; return
// true;`. So a member of ANY church on the box could store a kind-30078 document under ANY d-tag the relay
// had no rule for — a prefix nobody has invented yet, or a church-only type somebody forgot to write a rule
// for. That is exactly how `voice:` shipped writable by any member (2026-08-25, see the comment above
// `if (d.startsWith(VOICE_D))` in scripts/gateway.mjs), and the same shape was caught again in the week of
// 2026-09-22 on `share:`/`pubevent:`. Reads are default-deny, so a stored forgery only bites when a future
// reader trusts it — but "safe as long as every future reader is careful" is not a rule.
//
// THE FIX (option B, owner-decided 2026-09-22): the catch-all admits an ORDINARY member only for a d-tag that
// matches a DECLARED member-writable type. The list is derived once from the registry
// (scripts/trinity-doc-types.mjs: every DOC_TYPES key whose `write === 'member'`, plus `trinityone/wallet:`
// from UNDECLARED, which its own note records as member-authored). The church key and a network key are
// NOT narrowed — they keep the catch-all exactly as before; a church-key restriction is a separate package.
//
// WHERE IT APPLIES — decided and tested here:
//   • the websocket door (accept())         YES — the tests below
//   • /import (a restore)                   NO  — an archive from a NEWER app may carry a member type this
//                                                 relay does not know yet; refusing it would lose data on
//                                                 restore. accept() is an admission gate, not a retention rule.
//   • syncChurchFromPeer / reconcileChurchWithPeer   NO — same reason, one step further: a peer on a newer
//                                                 version has ALREADY admitted the document, and a mixed
//                                                 fleet is the normal state. The check is also not stateless
//                                                 in the sense carereqIdOk/arrivalIdOk are: their answer is a
//                                                 property of the event alone, this one's depends on which
//                                                 version's registry the judging relay ships.
//
// THIS FILE DERIVES THE MEMBER-WRITABLE LIST ITSELF, from DOC_TYPES, independently of the registry's exported
// MEMBER_WRITABLE_TYPES — and publishes ONE document of EVERY type in it as the member. So a type that goes
// missing from the exported list (a slip in the derivation, or a future edit) is refused at the door and this
// file goes red by name, rather than a real member's rsvp quietly failing on a Sunday.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { v2 as nip44 } from 'nostr-tools/nip44';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { requireFreePort } from './test-ports.mjs';
import { buildHelperGrant, buildCheckinPermission, GRANT_SOURCE } from './checkin-role-source.mjs';
import * as REG from './trinity-doc-types.mjs';
// A namespace import, so this file still LOADS against a registry that predates the export — which is how
// the hole was reproduced against 6b6e66d with this very file: the list test fails, the door tests run.
const { D, DOC_TYPES, UNDECLARED } = REG;
const MEMBER_WRITABLE_TYPES = REG.MEMBER_WRITABLE_TYPES;

const PORT = 8916;   // unique across scripts/*.test.mjs AND scripts/*.probe.mjs; checked free by requireFreePort
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const HOST = `127.0.0.1:${PORT}`;
const NET = 'trinityone';
const ROOT = new URL('../', import.meta.url).pathname;
const now = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };

// THE CAST
const church = K();      // the one configured church
const net = K();         // a NETWORK key the church declares over itself
const mia = K();         // an ORDINARY MEMBER — self-joined, not a steward, not a child
const kid = K();         // a child mia claims as her own in a guardreq: (need not be a member)
const helper = K();      // a cleared, in-window helper, so the church can mint a session envelope
const SESSION = 'svc-sunday-am';
const NEED = 'need1';
const ZZZ = 'trinityone/zzz:';   // a type nobody has declared — the shape of every future hole

let relay, dataDir;

const conn = () => new Promise((r, j) => { const s = new WebSocket(WS_URL); s.on('open', () => r(s)); s.on('error', j); });
// Returns the WHOLE OK frame, so a failure prints exactly what the relay said.
const send = (s, e) => new Promise(res => {
  const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === e.id) { s.off('message', on); res(m); } };
  s.on('message', on); s.send(JSON.stringify(['EVENT', e]));
  setTimeout(() => res(['(no reply)', e.id, null, '']), 5000);
});
async function publishAs(who, e) {
  const s = await conn();
  const authed = new Promise(res => {
    const on = d => {
      const m = JSON.parse(d);
      if (m[0] === 'AUTH') { s.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', WS_URL], ['challenge', m[1]]], content: '' }, who.sk)])); res(true); }
    };
    s.on('message', on); setTimeout(() => res(false), 600);
  });
  s.send(JSON.stringify(['REQ', 'warm', { kinds: [30078], limit: 1 }]));
  await authed;
  await sleep(100);
  const out = await send(s, e); s.close(); return out;
}
function req(s, sub, f, sk, ms = 700) {
  return new Promise(res => {
    const out = [];
    const on = d => {
      const m = JSON.parse(d);
      if (m[0] === 'EVENT' && m[1] === sub) out.push(m[2]);
      else if (m[0] === 'AUTH' && sk) s.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', WS_URL], ['challenge', m[1]]], content: '' }, sk)]));
    };
    s.on('message', on); s.send(JSON.stringify(['REQ', sub, f]));
    setTimeout(() => { s.off('message', on); res(out); }, ms);
  });
}
async function asks(who, filter) {
  const s = await conn();
  await req(s, 'warm', { kinds: [30078], limit: 1 }, who.sk, 350);
  const got = await req(s, 'q' + Math.random().toString(36).slice(2, 7), filter, who.sk);
  s.close(); return got;
}
const doc = (who, d, content, extra = []) => finalizeEvent({
  kind: 30078, created_at: now(),
  tags: [['d', d], ['t', NET], ...extra],
  content: typeof content === 'string' ? content : JSON.stringify(content),
}, who.sk);
const nip98 = (who, path, extra = []) => 'Nostr ' + Buffer.from(JSON.stringify(finalizeEvent({
  kind: 27235, created_at: now(), tags: [['u', `http://${HOST}${path}`], ['method', 'POST'], ...extra], content: '',
}, who.sk))).toString('base64');
const importAs = async (who, events) => {
  const r = await fetch(`http://127.0.0.1:${PORT}/import`, {
    method: 'POST',
    headers: { Authorization: nip98(who, '/import', [['church', church.pub]]), 'Content-Type': 'application/x-ndjson' },
    body: events.map(e => JSON.stringify(e)).join('\n') + '\n',
  });
  return [r.status, await r.json().catch(() => ({}))];
};

before(async () => {
  await requireFreePort(PORT, 'relay-refuses-undeclared-member-doc-types.test.mjs (it spawns its own gateway)');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-undeclared-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: ROOT, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(church.pub), TRINITY_TAILSCALE_BIN: '/nonexistent' },
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 25000) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) break; } catch {} await sleep(150); }
  const w = await conn();
  // mia joins; the church declares its network key, opens a care need, clears a helper and mints a session
  // envelope so that an arrival — the one member type that needs live church state — can be written.
  assert.equal((await send(w, doc(mia, D.MEMBER + church.pub, { joined: now() })))[2], true, 'fixture: mia could not join');
  assert.equal((await send(w, doc(church, D.NETWORK + net.pub, { joined: now() })))[2], true, 'fixture: the church could not declare its network');
  assert.equal((await send(w, doc(church, D.NEED + NEED, { title: 'Meals for the Smiths' }, [['church', church.pub]])))[2], true, 'fixture: the church could not open a care need');
  assert.equal((await send(w, doc(church, D.CHECKINPERM + helper.pub,
    buildCheckinPermission({ person: helper.pub, source: 'steward', lifetime: 'open', from: now() - 86400, until: null }),
    [['church', church.pub], ['person', helper.pub]])))[2], true, 'fixture: the church could not clear the helper');
  await sleep(250);
  const { doc: grant, failed } = buildHelperGrant({
    session: SESSION, source: GRANT_SOURCE, lifetime: 'session', from: now() - 600, until: now() + 3600,
    helpers: [helper.pub], keepers: [church.pub], sessionKeyHex: '11'.repeat(32),
    wrap: (p, pl) => nip44.encrypt(pl, nip44.utils.getConversationKey(church.sk, p)),
  });
  assert.deepEqual(failed, [], 'fixture: the session envelope could not be wrapped');
  assert.equal((await send(w, doc(church, D.CHECKINHELPER + SESSION, grant, [['church', church.pub], ['session', SESSION]])))[2], true, 'fixture: the church could not mint the session envelope');
  w.close();
  await sleep(300);
});
after(() => { try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

// ── THE LIST, DERIVED HERE AND NOT TAKEN FROM THE REGISTRY'S EXPORT ─────────────────────────────────────
const derived = [
  ...Object.keys(DOC_TYPES).filter(p => DOC_TYPES[p].write === 'member'),
  'trinityone/wallet:',
];

test('the registry exports exactly the member-writable list this file derives', () => {
  assert.ok(derived.length >= 21, 'the derived list looks too small to be real: ' + derived.length);
  assert.ok('trinityone/wallet:' in UNDECLARED && /MEMBER-authored/.test(UNDECLARED['trinityone/wallet:']),
    'wallet: is no longer in UNDECLARED as a member-authored type — re-check whether it belongs in the list');
  assert.ok(Array.isArray(MEMBER_WRITABLE_TYPES), 'the registry exports no MEMBER_WRITABLE_TYPES list at all');
  assert.deepEqual([...MEMBER_WRITABLE_TYPES].sort(), [...derived].sort(),
    'MEMBER_WRITABLE_TYPES has drifted from "every write:member type, plus wallet:" — the relay would refuse ' +
    'a member their own document, or admit one nobody declared');
  assert.ok(Object.isFrozen(MEMBER_WRITABLE_TYPES), 'the list is mutable at runtime');
});

// ── THE HOLE ─────────────────────────────────────────────────────────────────────────────────────────────
test('an ORDINARY MEMBER writing a type nobody declared is refused at the door, and told why', async () => {
  const e = doc(mia, ZZZ + church.pub, { forged: true }, [['church', church.pub]]);
  const frame = await publishAs(mia, e);
  console.log('relay answered a member\'s ' + ZZZ + ' write with: ' + JSON.stringify(frame));
  assert.equal(frame[2], false,
    'THE HOLE: a member stored a kind-30078 document under a d-tag the relay has no rule for. Frame: ' + JSON.stringify(frame));
  assert.match(String(frame[3]), /undeclared document type/,
    'refused, but with a reason that does not name the problem: ' + JSON.stringify(frame[3]));
  // …and it is not on disk either. A member's own event is always readable by its author, so an empty
  // read-back by mia is "not stored", not "not served".
  assert.equal((await asks(mia, { kinds: [30078], authors: [mia.pub], '#d': [ZZZ + church.pub] })).length, 0,
    'refused at the frame and stored anyway');
});

test('a church-authored type the relay has no branch for is refused to a member too', async () => {
  // trinityone/sermon: used to be in UNDECLARED — client-used, church content, and accept() had no rule for
  // it, so it fell to this same catch-all. RE-ANCHORED 2026-09-22: it now has a branch of its own (church
  // key, its network, or a steward with the content capability — see
  // scripts/six-steward-doc-types-have-rules.test.mjs, which drives the whole five-actor matrix). The
  // question this test asks is unchanged and still worth asking here: a MEMBER may not write it, and the
  // CHURCH still can. What changed is which line refuses the member — its own branch rather than the
  // catch-all — which is why the reason is no longer asserted to name an undeclared type.
  assert.ok('trinityone/sermon:' in DOC_TYPES && DOC_TYPES['trinityone/sermon:'].write === 'steward',
    're-anchor: sermon: is no longer a declared steward-written type');
  const frame = await publishAs(mia, doc(mia, 'trinityone/sermon:s1', { title: 'not mine to write' }, [['church', church.pub]]));
  assert.equal(frame[2], false, 'a member wrote a church-authored type the relay has no rule for: ' + JSON.stringify(frame));
  const own = await publishAs(church, doc(church, 'trinityone/sermon:s1', { title: 'Sunday' }));
  assert.equal(own[2], true, 'the CHURCH can no longer write its own undeclared content — the fix narrowed the wrong key: ' + JSON.stringify(own));
});

// ── A BARE NAME MATCHES EXACTLY; A PREFIXED ONE MATCHES BY PREFIX ────────────────────────────────────────
// AUDIT-undeclared-doc-types-2026-09-22, finding M2. memberDocTypeOk's own comment claims "a bare name (the
// MyData six and chatseen) exactly, so `trinityone/notesX` is not `trinityone/notes`" — and NOTHING in this
// file asked. Sabotage S3, scoped inside that function (the anchor appears twice in gateway.mjs; the sibling
// is relayGatesType):
//
//     -    if (p.endsWith(':') ? s.startsWith(p) : s === p) return true;
//     +    if (s.startsWith(p)) return true;
//
// left this file 28/28 GREEN while a member became free to write `trinityone/notesXYZ-<timestamp>` — an
// unbounded novel-d-tag namespace under seven stems, bounded only by MEMBER_DOC_CAP. The fix's own headline
// property, a BOUNDED member namespace, could be deleted in one character with every test still passing.
//
// Both halves are pinned, because they fail in opposite directions: widen the bare rule and the hole is back;
// narrow the prefixed rule and every real rsvp/careslot/carereq stops being accepted on a Sunday.
test('a member may NOT write a bare member type with anything appended', async () => {
  const frame = await publishAs(mia, finalizeEvent({
    kind: 30078, created_at: now(), tags: [['d', 'trinityone/notesXYZ-' + now()]], content: 'SEALED',
  }, mia.sk));
  assert.equal(frame[2], false,
    'THE MEMBER NAMESPACE IS UNBOUNDED AGAIN: `trinityone/notes` is a BARE declared name and must match a ' +
    'd-tag EXACTLY. Matching it by prefix hands every member a novel-d-tag namespace under each bare stem, ' +
    'which is the hole this file exists to close. Frame: ' + JSON.stringify(frame));
  assert.equal((await asks(mia, { kinds: [30078], authors: [mia.pub], '#d': ['trinityone/notesXYZ-' + now()] })).length, 0,
    'refused at the frame and stored anyway');
});

test('a member CAN still write a prefixed member type with a suffix — the other direction', async () => {
  // The same rule, read the other way. `trinityone/rsvp:` ends in ':' and must match by PREFIX, or every
  // real reply a member sends is refused. Pinning only the refusal above would let a "fix" for it turn every
  // declared prefix into an exact match and break the app in the quietest possible way.
  const frame = await publishAs(mia, doc(mia, D.RSVP + 'evt-prefix-check', { going: true }, [['p', church.pub]]));
  assert.equal(frame[2], true,
    'A PREFIXED MEMBER TYPE IS NO LONGER MATCHED BY PREFIX — a member cannot RSVP at all: ' + JSON.stringify(frame));
});

// ── EVERY DECLARED MEMBER-WRITABLE TYPE STILL LANDS ──────────────────────────────────────────────────────
// One shape per type that the relay's OWN rule for that type accepts from an ordinary member (read out of
// accept() in scripts/gateway.mjs). A type in `derived` with no shape here fails loudly below — a new
// member-writable type must be added HERE, with a shape, or it is not covered.
const carereqId = mia.pub.slice(0, 16) + '-' + 'a1b2c3';   // ID_OWNER_RE: the id names its asker
const SHAPES = {
  'trinityone/member:':         () => doc(mia, D.MEMBER + church.pub, { joined: now() }),
  'trinityone/stewardreq:':     () => doc(mia, D.STEWARDREQ + church.pub, { note: 'happy to help' }, [['p', church.pub]]),
  'trinityone/name:':           () => doc(mia, D.NAME + church.pub, 'SEALED-NAME', [['p', church.pub]]),
  'trinityone/guardreq:':       () => doc(mia, D.GUARDREQ + kid.pub, { child: kid.pub, parent: mia.pub }, [['p', church.pub]]),
  'trinityone/careslot:':       () => doc(mia, D.SLOT + NEED + ':2026-10-04', { note: 'lasagne' }, [['church', church.pub]]),
  'trinityone/careavail:':      () => doc(mia, D.AVAIL + church.pub, { days: ['sat'] }, [['p', church.pub]]),
  'trinityone/checkinarrival:': () => doc(mia, D.CHECKINARRIVAL + SESSION + ':' + mia.pub,
    nip44.encrypt(JSON.stringify({ at: now() }), nip44.utils.getConversationKey(mia.sk, mia.pub)),
    [['church', church.pub], ['session', SESSION]]),
  'trinityone/carereq:':        () => doc(mia, D.CAREREQ + carereqId, 'SEALED-TO-CARE-TEAM', [['church', church.pub]]),
  'trinityone/carechat:':       () => doc(mia, D.CARECHAT + carereqId + ':m1', 'SEALED-MESSAGE', [['church', church.pub], ['p', mia.pub]]),
  'trinityone/safe:':           () => doc(mia, D.SAFE + church.pub, 'SEALED-TO-CHECK-CREATOR', [['p', church.pub]]),
  'trinityone/rsvp:':           () => doc(mia, D.RSVP + 'evt1', { going: true }, [['p', church.pub]]),
  'trinityone/reqreply:':       () => doc(mia, D.REQREPLY + 'req1', { answer: 'accept' }, [['p', church.pub]]),
  'trinityone/unavail:':        () => doc(mia, D.UNAVAIL + mia.pub, { dates: ['2026-10-11'] }, [['p', church.pub]]),
  // MyData: signed by the member, sealed to themselves, NO church tag of any kind — tags: [['d', …]] only.
  'trinityone/highlights':      () => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', 'trinityone/highlights']], content: 'SEALED' }, mia.sk),
  'trinityone/bookmarks':       () => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', 'trinityone/bookmarks']], content: 'SEALED' }, mia.sk),
  'trinityone/notes':           () => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', 'trinityone/notes']], content: 'SEALED' }, mia.sk),
  'trinityone/journal':         () => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', 'trinityone/journal']], content: 'SEALED' }, mia.sk),
  'trinityone/prayer':          () => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', 'trinityone/prayer']], content: 'SEALED' }, mia.sk),
  'trinityone/settings':        () => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', 'trinityone/settings']], content: 'SEALED' }, mia.sk),
  'trinityone/chatseen':        () => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', 'trinityone/chatseen']], content: 'SEALED' }, mia.sk),
  // the wallet, as src/fellowship.src.js publishes it: d = 'trinityone/wallet:<suffix>', a ['t'] tag, no church
  'trinityone/wallet:':         () => doc(mia, 'trinityone/wallet:main', 'SEALED-WALLET'),
};

test('every member-writable type has a shape in this file', () => {
  const unshaped = derived.filter(p => !(p in SHAPES));
  assert.deepEqual(unshaped, [], 'a member-writable type has no shape here, so nothing proves a member can still write it');
  const extra = Object.keys(SHAPES).filter(p => !derived.includes(p));
  assert.deepEqual(extra, [], 'a shape here is for a type the registry no longer calls member-writable');
});

for (const p of derived) {
  test('the member can still write ' + p, async () => {
    const frame = await publishAs(mia, SHAPES[p]());
    assert.equal(frame[2], true, 'A DECLARED MEMBER TYPE IS REFUSED TO A MEMBER: ' + p + ' — ' + JSON.stringify(frame));
  });
}

// ── THE CHURCH KEY AND A NETWORK KEY ARE NOT NARROWED ────────────────────────────────────────────────────
test('the church key keeps the catch-all: it can still write an undeclared type', async () => {
  const frame = await publishAs(church, doc(church, ZZZ + church.pub, { churchOwn: true }));
  assert.equal(frame[2], true, 'the church key was refused its own undeclared document — that is a separate package, not this one: ' + JSON.stringify(frame));
});

test('a network key keeps the catch-all too', async () => {
  const untagged = await publishAs(net, doc(net, ZZZ + church.pub, { viaNetwork: true }));
  assert.equal(untagged[2], true, 'a network key was refused an undeclared document it could write before: ' + JSON.stringify(untagged));
  const tagged = await publishAs(net, doc(net, ZZZ + church.pub + ':tagged', { viaNetwork: true }, [['church', church.pub]]));
  assert.equal(tagged[2], true, 'a network key naming its church was refused an undeclared document: ' + JSON.stringify(tagged));
});

// ── /import IS NOT NARROWED: a restore keeps what a newer app wrote ──────────────────────────────────────
test('/import retains a member-authored type this relay has never heard of, and serves it to its author', async () => {
  // The same document the door refuses above, arriving inside the church's archive. A relay one version
  // behind the phones must not drop it on restore — accept() answers "may this be written NOW", not "should
  // this be kept" (see accept-is-not-a-retention-rule).
  const e = doc(mia, ZZZ + church.pub, { fromANewerApp: true }, [['church', church.pub]]);
  const [status, body] = await importAs(church, [e]);
  assert.equal(status, 200, '/import refused the church key — the ingest door is not being exercised: ' + JSON.stringify(body));
  assert.equal(body.imported, 1, 'THE IMPORT DOOR DROPPED A MEMBER DOCUMENT OF A TYPE IT DOES NOT KNOW — a restore from a newer ' +
    'app loses data. imported=' + body.imported + ' invalid=' + body.invalid);
  await sleep(300);
  const got = await asks(mia, { kinds: [30078], authors: [mia.pub], '#d': [ZZZ + church.pub] });
  assert.equal(got.length, 1, 'imported and then not served to its own author');
  assert.equal(got[0].id, e.id);
});
