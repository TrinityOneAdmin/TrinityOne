// SIX DOCUMENT TYPES THAT WERE LIVING ON THE MEMBER CATCH-ALL NOW HAVE RULES OF THEIR OWN.
// Run: node --test scripts/six-steward-doc-types-have-rules.test.mjs
//
// AUDIT-undeclared-doc-types-2026-09-22, finding H1 (HIGH). `efe2dbe` closed accept()'s "any member may
// store an undeclared document type" catch-all, which was right. What it did not do was notice WHO ELSE was
// standing on it. Six types shipped by real console code had no branch in accept() and no rule anywhere:
//
//     trinityone/sermon:    trinityone/msgtags    trinityone/manna-
//     trinityone/mediakey:  trinityone/backup-meta:   trinityone/relays
//
// Measured on a live two-church gateway, both directions, BEFORE anything was changed (the probe in the
// audit, re-run here as the matrix below):
//
//     actor                                       6b6e66d   efe2dbe
//     church key                                  ACK       ACK
//     steward of THIS church who ALSO joined it   ACK       NO      <<< the delegated console, silently
//     steward of ANOTHER church                   ACK       NO
//     ordinary member                             ACK       NO
//
// Both columns are accidents. The left one is the hole (a co-tenant church's member could replace another
// congregation's media-key envelope, its chat tag labels, its trusted-relay list). The right one refuses the
// church's OWN steward — and the console publishes five of the six through feChurch, which signs with the
// STEWARD'S OWN key, so the normal delegated shape (a steward who has also joined the church they help) lost
// all six at once. It failed silently on screen: publishMessageTags discarded publish()'s result and the
// editor toasted "✓ Saved". That half is tested in scripts/a-saved-message-tag-nobody-took-is-not-saved.test.mjs.
//
// THE FIX (owner-approved 2026-09-22): give each of the six a real rule — the church key, or a rostered
// steward with the RIGHT capability — instead of one blanket answer nobody chose. The authority per type,
// and the reason for each, is written in scripts/trinity-doc-types.mjs beside the entry; the short form:
//
//     sermon:        content     — the same branch as pinsermon:, so PUBLISHING and FEATURING agree
//     msgtags        content     — the labels the congregation sees on a message
//     backup-meta:   any         — a shared reminder timestamp; grants nothing, carries no key
//     mediakey:      church key  — the envelope is sealed with the SIGNER's key, so only the church's own
//                                  key can mint one a member can open
//     manna-         church key  — a locked module, and one stem over seven sub-types of very different
//                                  sensitivity is the "rule nobody chose" this registry exists to stop
//     relays         church key  — CLAUDE.md rule 10: it decides which OTHER boxes get the whole corpus
//
// FIVE ACTORS, EVERY TYPE, ON ONE RELAY CARRYING TWO CHURCHES. The cross-tenant row is not decoration:
// `groupkey:` (2026-09-17) and `voice:` (2026-08-25) were both found by asking exactly it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { requireFreePort } from './test-ports.mjs';
import { D, DOC_TYPES, UNDECLARED } from './trinity-doc-types.mjs';

const PORT = 8917;   // unique across scripts/*.test.mjs AND scripts/*.probe.mjs; checked free by requireFreePort
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const NET = 'trinityone';
const ROOT = new URL('../', import.meta.url).pathname;
const GATEWAY = readFileSync(new URL('../scripts/gateway.mjs', import.meta.url), 'utf8');
const now = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };

// THE CAST — two churches on one box, which is the only way the cross-tenant row means anything.
const church = K();      // church A
const churchB = K();     // church B, a co-tenant
const net = K();         // a network key church A declares over itself
const sm = K();          // a steward of A with every capability, who has ALSO joined A — the normal shape
const smFin = K();       // a steward of A scoped EXPLICITLY to ['finance'], also a member of A
const smB = K();         // a steward of B with every capability, also a member of B
const mia = K();         // an ordinary member of A, no stewardship at all

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
const doc = (who, d, content, extra = []) => finalizeEvent({
  kind: 30078, created_at: now(),
  tags: [['d', d], ['t', NET], ...extra],
  content: typeof content === 'string' ? content : JSON.stringify(content),
}, who.sk);

const ALL_CAPS = ['content', 'members', 'finance', 'care', 'safeguarding', 'sealedrooms'];

before(async () => {
  await requireFreePort(PORT, 'six-steward-doc-types-have-rules.test.mjs (it spawns its own gateway)');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-sixtypes-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: ROOT, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, TRINITY_TAILSCALE_BIN: '/nonexistent',
      CHURCH_NPUB: `${npubEncode(church.pub)},${npubEncode(churchB.pub)}` },
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 25000) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) break; } catch {} await sleep(150); }
  const w = await conn();
  const must = async (label, e) => assert.equal((await send(w, e))[2], true, 'fixture: ' + label);
  await must('A could not write its steward roster', doc(church, D.STEWARDS + church.pub,
    { pubkeys: [sm.pub, smFin.pub], caps: { [sm.pub]: ALL_CAPS, [smFin.pub]: ['finance'] } }));
  await must('B could not write its steward roster', doc(churchB, D.STEWARDS + churchB.pub,
    { pubkeys: [smB.pub], caps: { [smB.pub]: ALL_CAPS } }));
  await must('A could not declare its network', doc(church, D.NETWORK + net.pub, { joined: now() }));
  await must('mia could not join A', doc(mia, D.MEMBER + church.pub, { joined: now() }));
  await must('sm could not join A', doc(sm, D.MEMBER + church.pub, { joined: now() }));
  await must('smFin could not join A', doc(smFin, D.MEMBER + church.pub, { joined: now() }));
  await must('smB could not join B', doc(smB, D.MEMBER + churchB.pub, { joined: now() }));
  w.close();
  await sleep(300);
});
after(() => { try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

// ── THE SIX, IN THE SHAPE THE SHIPPED CONSOLE PUBLISHES THEM ─────────────────────────────────────────────
// Five go out through feChurch, which stamps ['church',<cp>] when the console is delegated. `relays` does
// NOT: syncEnable/syncDisable in src/steward.src.js sign it with a raw finalizeEvent(…, sk) and no church
// tag at all, which is one of the reasons it can only ever be the church's own key.
const CP = () => church.pub;
const SHAPES = {
  'trinityone/sermon:':      who => doc(who, D.SERMON + 's1', { id: 's1', title: 'Sunday', sha256: 'aa' }, [['church', CP()]]),
  'trinityone/msgtags':      who => doc(who, D.MSGTAGS, { tags: [{ id: 'prayer', label: 'Prayer request' }] }, [['church', CP()]]),
  'trinityone/manna-':       who => doc(who, D.MANNA + 'fund:f1', 'SEALED-UNDER-THE-FINANCE-KEY', [['church', CP()], ['enc', '1']]),
  'trinityone/mediakey:':    who => doc(who, D.MEDIAKEY + CP(), { keys: {}, rev: now() }, [['church', CP()]]),
  'trinityone/backup-meta:': who => doc(who, D.BACKUPMETA + CP(), { at: now(), remind: 'monthly' }, [['church', CP()]]),
  'trinityone/relays':       who => doc(who, D.RELAYS, [{ pubkey: 'aa', url: 'ws://a' }, { pubkey: 'bb', url: 'ws://b' }]),
};

// WHO MAY WRITE EACH ONE — the table this commit exists to write down. `true` = must be ACKed.
const MATRIX = {
  //                          church  network  steward+member  steward scoped   steward of   plain
  //                          key     of A     all capabilities to finance only  church B     member
  'trinityone/sermon:':      [true,   true,    true,            false,           false,       false],
  'trinityone/msgtags':      [true,   true,    true,            false,           false,       false],
  'trinityone/backup-meta:': [true,   true,    true,            true,            false,       false],
  'trinityone/mediakey:':    [true,   true,    false,           false,           false,       false],
  'trinityone/manna-':       [true,   true,    false,           false,           false,       false],
  'trinityone/relays':       [true,   false,   false,           false,           false,       false],
};
const ACTORS = [
  ['the church key', () => church],
  ['a network key of that church', () => net],
  ['a steward with every capability who is also a member', () => sm],
  ['a steward scoped to finance only', () => smFin],
  ['a steward of a DIFFERENT church on the same relay', () => smB],
  ['an ordinary member with no stewardship', () => mia],
];

test('every one of the six is declared, and none of them is member-writable', () => {
  for (const p of Object.keys(MATRIX)) {
    assert.ok(p in DOC_TYPES, p + ' is not in DOC_TYPES — it was moved out of UNDECLARED into a real rule, so it must be declared');
    assert.ok(!(p in UNDECLARED), p + ' is still listed as knowingly-undeclared while the relay now gates it by name');
    assert.notEqual(DOC_TYPES[p].write, 'member',
      p + ' is declared member-writable. None of these six may be: the registry derives MEMBER_WRITABLE_TYPES from ' +
      'this column and accept()\'s catch-all reads it, so this word alone would re-open the hole (AUDIT M3).');
  }
});

for (const [type, row] of Object.entries(MATRIX)) {
  for (let i = 0; i < ACTORS.length; i++) {
    const [label, who] = ACTORS[i];
    const want = row[i];
    test(`${type} — ${want ? 'ACCEPTED' : 'REFUSED'} for ${label}`, async () => {
      const frame = await publishAs(who(), SHAPES[type](who()));
      assert.equal(frame[2], want,
        (want
          ? 'A LEGITIMATE AUTHOR IS REFUSED — this is the silent-console half of H1, where the write is lost and the screen says saved. '
          : 'AN AUTHOR WITH NO AUTHORITY WAS ACCEPTED — these documents are ADDRESSABLE, so a write REPLACES the church\'s. ')
        + type + ' / ' + label + ' — the relay answered: ' + JSON.stringify(frame));
    });
  }
}

// ── THE INCOHERENCE THE AUDIT NAMED, CLOSED BY CONSTRUCTION ──────────────────────────────────────────────
test('a content steward may PUBLISH a sermon as well as FEATURE one', async () => {
  // The sharp edge of H1. The relay has granted a content-capable delegated steward `pinsermon:` since the
  // content-docs branch was written; with no rule of its own, `sermon:` was decided by the catch-all — so
  // after efe2dbe the same steward could feature a sermon they were not allowed to publish. Both answers
  // now come from the SAME branch, so they cannot drift apart again.
  const pin = await publishAs(sm, doc(sm, D.PINSERMON + church.pub, { id: 's1', title: 'Sunday', sha256: 'aa' }, [['church', church.pub]]));
  assert.equal(pin[2], true, 'the control moved: a content steward can no longer feature a sermon either — ' + JSON.stringify(pin));
  const put = await publishAs(sm, SHAPES['trinityone/sermon:'](sm));
  assert.equal(put[2], true, 'a content steward may feature a sermon and not publish one — the incoherence is still open: ' + JSON.stringify(put));
  // …and they are literally the same branch, not two rules that happen to agree today.
  assert.match(GATEWAY, /d\.startsWith\(CATEGORY_D\) \|\| d\.startsWith\(PINSERMON_D\) \|\| d\.startsWith\(SERMON_D\)/,
    'sermon: has been moved out of the branch that decides pinsermon:. Two rules for publishing and featuring ' +
    'is how they disagreed in the first place.');
});

// ── THE DIAGNOSTIC, WHICH IS NOT THE DECISION BUT IS STILL A CLAIM ───────────────────────────────────────
test('a refused member is no longer told the relay has no rule for a type it now gates', async () => {
  // AUDIT L1's sibling, found by running this matrix: relayGatesType() matched a BARE name exactly, so
  // `trinityone/manna-` — one declared name standing for seven d-tags built from it — never matched any
  // real manna document. The relay refused it under MANNA_D's own branch and then said "this relay has no
  // rule for it", which is the one sentence that sends a steward to update their app for no reason.
  const frame = await publishAs(mia, SHAPES['trinityone/manna-'](mia));
  assert.equal(frame[2], false, 'a member wrote a benevolence document');
  assert.doesNotMatch(String(frame[3]), /undeclared document type/,
    'the relay gates trinityone/manna- by name and still reports it as a type it has never heard of: ' + JSON.stringify(frame[3]));
  // …while a genuinely unknown type still gets the honest, actionable reason.
  const zzz = await publishAs(mia, doc(mia, 'trinityone/zzz:' + church.pub, { forged: true }, [['church', church.pub]]));
  assert.equal(zzz[2], false);
  assert.match(String(zzz[3]), /undeclared document type/,
    'the "this relay needs updating" reason has stopped firing for a type nobody has declared: ' + JSON.stringify(zzz[3]));
});

test('the OK-frame reason asks the network question accept() asked, not a relay-wide lookalike', async () => {
  // AUDIT L1. The reason computation used `NETWORKS.has(evt.pubkey)` — the merged set, "a network of ANY
  // church on this box" — while accept() scopes it to the church the event NAMES. So church A's own network
  // key, writing an undeclared document that names church A, was accepted by accept() and would have been
  // described by the generic reason had it been refused. The observable half is the co-tenant case: A's
  // network key naming church B is refused, and must NOT be excused as "a network" in the reason.
  const asB = await publishAs(net, doc(net, 'trinityone/zzz:' + churchB.pub, { crossTenant: true }, [['church', churchB.pub]]));
  assert.equal(asB[2], false, 'a network key of church A wrote an undeclared document naming church B: ' + JSON.stringify(asB));
  assert.match(GATEWAY, /const _rIsNetwork = _rcp \? networkOf\(evt\.pubkey, _rcp\) : NETWORKS\.has\(evt\.pubkey\);/,
    'the OK-frame reason is back on the relay-wide NETWORKS set, so it can describe a refusal by a rule that ' +
    'did not make it (AUDIT-undeclared-doc-types-2026-09-22 L1)');
  // and the un-scoped case is unchanged: A's network key writing A's own undeclared document still lands.
  const asA = await publishAs(net, doc(net, 'trinityone/zzz:' + church.pub + ':own', { own: true }, [['church', church.pub]]));
  assert.equal(asA[2], true, 'the network key lost the catch-all it is supposed to keep: ' + JSON.stringify(asA));
});

// ── AND THE ONE THING THAT MUST NOT HAVE CHANGED ─────────────────────────────────────────────────────────
test('/import still retains all six, whoever wrote them — a gate is not a retention rule', async () => {
  // accept-is-not-a-retention-rule. These rules are ADMISSION control at the websocket door. An archive
  // restored onto this relay carries whatever the church's own consoles wrote over the years, including
  // documents written before these rules existed and by keys that have since left the roster. Refusing them
  // on ingest would delete a church's sermons on the day it restores a backup.
  const olds = Object.keys(SHAPES).map(p => SHAPES[p](mia));   // authored by a plain member: refused at the door above
  const nip98 = 'Nostr ' + Buffer.from(JSON.stringify(finalizeEvent({
    kind: 27235, created_at: now(),
    tags: [['u', `http://127.0.0.1:${PORT}/import`], ['method', 'POST'], ['church', church.pub]], content: '',
  }, church.sk))).toString('base64');
  const r = await fetch(`http://127.0.0.1:${PORT}/import`, {
    method: 'POST', headers: { Authorization: nip98, 'Content-Type': 'application/x-ndjson' },
    body: olds.map(e => JSON.stringify(e)).join('\n') + '\n',
  });
  assert.equal(r.status, 200, '/import refused the church key — the ingest door is not being exercised');
  const body = await r.json();
  assert.equal(body.imported, olds.length,
    'THE IMPORT DOOR DROPPED DOCUMENTS THE FRONT DOOR REFUSES. A restore must not lose a church\'s history ' +
    'because a write rule changed since it was written. imported=' + body.imported + ' invalid=' + body.invalid);
});
