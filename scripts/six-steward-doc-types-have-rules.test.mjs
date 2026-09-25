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
//     msgtags        content     — the labels the congregation sees on a message
//     sermon:        church key  — SEE BELOW: the content-steward grant was withdrawn the same day
//     backup-meta:   church key  — SEE BELOW: the 'any steward' grant was withdrawn the same day
//     mediakey:      church key  — the envelope is sealed with the SIGNER's key, so only the church's own
//                                  key can mint one a member can open
//     manna-         church key  — a locked module, and one stem over seven sub-types of very different
//                                  sensitivity is the "rule nobody chose" this registry exists to stop
//     relays         church key  — CLAUDE.md rule 10: it decides which OTHER boxes get the whole corpus
//
// ⚠ TWO OF THE THREE STEWARD GRANTS LASTED ONE DAY, AND THE READER IS WHY (AUDIT-steward-doc-rules-2026-09-22,
// F1 + F2, owner's decision "go with B"). A write grant is worth nothing until a reader accepts the signature
// it produces. MEASURED on a live gateway: a delegated steward's church-tagged documents ACK, and then —
//
//     0  _openSermons           src/fellowship.src.js   authors:[cp] + `if (e.pubkey !== cp) return;`
//     0  subscribeSermons       src/steward.src.js      authors:[pub]  (on a DELEGATED console `pub` is the
//                                                       CHURCH's pubkey while `sk` is the steward's)
//     0  subscribePinnedSermon  both                    authors:[pub] + #d
//     0  subscribeBackupMeta    src/steward.src.js      authors:[pub] + #d
//     1  the docs hub / subscribeMessageTags            #church:[cp]   ← the ONE that works end to end
//
// So granting `sermon:` and `backup-meta:` turned a LOUD failure into a SILENT success: the console printed
// "✓ Uploaded … · members notified" and "Saved N records" over documents nobody would ever be served, and
// DashBackup's "the shared record could not be saved" sentence — added the same day, and TRUE — stopped
// printing. Both are church-key-only now. `msgtags` keeps its grant because it is read by `#church:[cp]`.
//
// FIVE ACTORS, EVERY TYPE, ON ONE RELAY CARRYING TWO CHURCHES. The cross-tenant row is not decoration:
// `groupkey:` (2026-09-17) and `voice:` (2026-08-25) were both found by asking exactly it.
//
// ⚠ UPDATED 2026-09-25. `sermon:` and `backup-meta:` are RE-GRANTED to a rostered steward (option A,
// TrinityOne-internal/reference/PLAN-delegated-steward-publishing.md), now that every reader named above has
// been taught to accept a rostered steward's `['church', cp]`-tagged copy — `_openSermons` and both
// `subscribePinnedSermon`s in the two engines, `subscribeSermons`, and `subscribeBackupMeta`. The MATRIX and
// the two tests further down that pinned the withdrawal are updated to match; the sentences above this line
// are left as written because they are the accurate history of WHY the withdrawal happened, which is still
// true and still the reason the re-grant needed the readers fixed first. See
// scripts/a-delegated-stewards-backup-meta-reaches-the-console.test.mjs and
// scripts/a-delegated-stewards-sermons-reach-a-member-phone.test.mjs for the reader-side proof.
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
import { stripComments, stripStrings } from './test-slice.mjs';
import { D, DOC_TYPES, UNDECLARED } from './trinity-doc-types.mjs';

const PORT = 8917;   // unique across scripts/*.test.mjs AND scripts/*.probe.mjs; checked free by requireFreePort
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const NET = 'trinityone';
const ROOT = new URL('../', import.meta.url).pathname;
const GATEWAY = readFileSync(new URL('../scripts/gateway.mjs', import.meta.url), 'utf8');
// THE SAME SOURCE WITH COMMENTS *AND* STRING LITERALS BLANKED, offsets intact. Every structural assertion in
// this file reads a DECISION, and a decision must not be satisfiable by prose — in a comment
// (AUDIT-undeclared-doc-types-2026-09-22 M1) or, one step along, in a string literal
// (AUDIT-steward-doc-rules-2026-09-22 F6). A self-check that both strippers really stripped lives in
// scripts/registry-wiring.test.mjs, which is the file whose guard the string door defeated.
const GATEWAY_CODE = stripStrings(stripComments(GATEWAY));
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
// THE ONE ACTOR THAT CAN TELL THE TWO NETWORK QUESTIONS APART — a MEMBER of A who is also the NETWORK key
// of B. AUDIT-steward-doc-rules-2026-09-22 F7: the L1 fix below was pinned only by a source-text match,
// because the actor the test used (A's own network key) never reaches the `_undeclared` reason branch at all.
const netB = K();        // declared by church B as its network, and separately joined church A as a member

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
  await must('B could not declare its network', doc(churchB, D.NETWORK + netB.pub, { joined: now() }));
  await must('netB could not join A as an ordinary member', doc(netB, D.MEMBER + church.pub, { joined: now() }));
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
//
// ⚠ UPDATED 2026-09-25 (option A, PLAN-delegated-steward-publishing.md, Phase 1 + 2). `sermon:` and
// `backup-meta:` were re-granted to a rostered steward once their readers were fixed to actually serve a
// steward-signed copy — see the two dedicated test files named at the bottom of this file's header comment.
// `sermon:` needs the CONTENT capability (it is congregation-facing, the same bar as msgtags); `backup-meta:`
// needs only 'any' (its whole point is that ANY steward taking a backup resets everyone's nudge), so a
// steward scoped to finance-only — refused for sermon: — is ACCEPTED for backup-meta:. Neither of the last
// two columns changes: a steward of a co-tenant church, and a plain member, still have no authority here.
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

// ── CLAUDE.md RULE 10: BOTH SHAPES OF THE TRUSTED-RELAY LIST ─────────────────────────────────────────────
test('a steward cannot write the trusted-relay list even when the envelope NAMES the church', async () => {
  // THE MATRIX ROW ABOVE IS NOT ENOUGH ON ITS OWN, and this test exists because a scoped sabotage proved it.
  // The shipped console signs `trinityone/relays` with a raw finalizeEvent(…, sk) and NO ['church'] tag
  // (syncEnable/syncDisable in src/steward.src.js), so a widening written as
  // `|| stewardCan(e.pubkey, namedChurch(e), 'content')` — the shape every other delegated rule on this box
  // uses — is INERT against that envelope: namedChurch() returns '' and the grant can never fire. Sabotaging
  // the rule that way left this file 41/0, which is exactly the mis-aimed-sabotage failure CLAUDE.md warns
  // about, arriving through the fixture rather than through the replace.
  //
  // So ask the question in the shape a future "fix" would actually produce: the same document, church-tagged,
  // from a steward holding every capability the church has. Rule 10 says which relays a church talks to is
  // the security boundary, and a delegate is not the authority for it in EITHER shape.
  const tagged = await publishAs(sm, doc(sm, D.RELAYS, [{ pubkey: 'aa', url: 'ws://a' }, { pubkey: 'bb', url: 'ws://b' }], [['church', church.pub]]));
  assert.equal(tagged[2], false,
    'A DELEGATED STEWARD WROTE THE CHURCH\'S TRUSTED-RELAY LIST. That document decides which OTHER relay ' +
    'boxes are handed this congregation\'s whole corpus (note()\'s TRUSTED_RELAYS / PEER_URLS). CLAUDE.md ' +
    'rule 10. Frame: ' + JSON.stringify(tagged));
  // …and the church key still writes it in both shapes, or cross-relay sync cannot be turned on at all.
  // ⚠ THE SLEEP IS NOT DECORATION, and it was a REAL FLAKE before it was here (seen 2026-09-22, one run in
  // several). `trinityone/relays` is ADDRESSABLE and keyed on (author, d-tag); the matrix above has already
  // written it as the church key, and the relay refuses a replacement whose created_at is not NEWER than
  // the copy it holds. Land both inside one second and this assertion fails as a stale replacement, which
  // reads exactly like "the church key has been locked out of its own document".
  await sleep(1100);
  assert.equal((await publishAs(church, doc(church, D.RELAYS, [{ pubkey: 'aa', url: 'ws://a' }, { pubkey: 'bb', url: 'ws://b' }], [['church', church.pub]])))[2], true,
    'the church key can no longer write its own trusted-relay list with a church tag present');
});

// ── THE TWO GRANTS THAT WERE WITHDRAWN, AND ARE NOW REAL ON BOTH SIDES ───────────────────────────────────
test('a content steward may FEATURE a sermon AND PUBLISH one, and BOTH now reach a reader', async () => {
  // AUDIT-steward-doc-rules-2026-09-22 F1 withdrew this grant because the readers could not serve it —
  // measured 0 rows on all three shipped readers for a delegated steward's church-tagged `sermon:`. Option A
  // (PLAN-delegated-steward-publishing.md) closed that gap 2026-09-25: `_openSermons` and both
  // `subscribePinnedSermon`s (src/fellowship.src.js, src/steward.src.js) and `subscribeSermons`
  // (src/steward.src.js) all now accept `authors:[cp]` OR `'#church':[cp]`, trusting only a currently
  // rostered author. The RELAY-SIDE half is what this test pins; the READER-SIDE half — that a member phone
  // and the publishing steward's own console genuinely display it — is proven in
  // scripts/a-delegated-stewards-sermons-reach-a-member-phone.test.mjs, which is the one this grant would be
  // worthless without.
  const pin = await publishAs(sm, doc(sm, D.PINSERMON + church.pub, { id: 's1', title: 'Sunday', sha256: 'aa' }, [['church', church.pub]]));
  assert.equal(pin[2], true,
    'a content steward can no longer feature a sermon — pinsermon: has been narrowed. Frame: ' + JSON.stringify(pin));
  const put = await publishAs(sm, SHAPES['trinityone/sermon:'](sm));
  assert.equal(put[2], true,
    'A CONTENT STEWARD WAS REFUSED PUBLISHING A SERMON. The readers now serve a rostered steward\'s ' +
    'church-tagged copy (option A, 2026-09-25), so this grant should be real again, matching pinsermon:. ' +
    'Frame: ' + JSON.stringify(put));
  // …and a steward scoped to FINANCE ONLY — who lacks the content capability — still may not, on either half.
  const pinFin = await publishAs(smFin, doc(smFin, D.PINSERMON + church.pub, { id: 's1', title: 'Sunday', sha256: 'aa' }, [['church', church.pub]]));
  assert.equal(pinFin[2], false, 'a finance-only steward can feature a sermon: ' + JSON.stringify(pinFin));
  const putFin = await publishAs(smFin, SHAPES['trinityone/sermon:'](smFin));
  assert.equal(putFin[2], false, 'a finance-only steward can publish a sermon: ' + JSON.stringify(putFin));
  // …and sermon: is decided in the SAME branch as pinsermon: now — the readers agree, so the write rule
  // should too, rather than living in a narrower branch of its own that the next edit could re-diverge.
  assert.doesNotMatch(GATEWAY_CODE, /if \(d\.startsWith\(SERMON_D\)\) return leaderOf\(ownCp\(\)\);/,
    'sermon: still has its own church-key-only accept() branch, separate from pinsermon: — the re-grant did not land');
  assert.match(GATEWAY_CODE, /d\.startsWith\(PINSERMON_D\) \|\| d\.startsWith\(SERMON_D\)/,
    'sermon: is not in the same content-steward branch as pinsermon: any more — re-anchor this test if the ' +
    'branch was reshaped rather than reverted');
});

// ── THE SUFFIX SCOPING THE COMMIT CALLED "STRUCTURALLY IMPOSSIBLE", ASKED IN THE SHAPE THAT CAN ANSWER ────
test('a CO-TENANT CHURCH KEY cannot reach church A’s media key or backup record, in any envelope shape', async () => {
  // AUDIT-steward-doc-rules-2026-09-22 F4. The matrix above cannot see this and said so was fine, because
  // EVERY shape in SHAPES carries ['church', CP()] — and with a church tag present, a SUFFIX-scoped rule and
  // an ownCp()-scoped one agree for every actor in the matrix. Two scoped sabotages proved it: replacing
  //     if (d.startsWith(MEDIAKEY_D))   return leaderOf(d.slice(MEDIAKEY_D.length));
  //     if (d.startsWith(BACKUPMETA_D)) return leaderOf(d.slice(BACKUPMETA_D.length));
  // with `leaderOf(ownCp())` left this file 42 pass / 0 fail while a co-tenant church key overwrote church
  // A's media-key envelope — the AUDIT-2026-07-24 CRITICAL-1/2 class, and losing that envelope makes every
  // encrypted sermon undecryptable for the whole congregation.
  //
  // So ask it where the two rules DISAGREE: an envelope with NO church tag at all (ownCp() then falls back
  // to the author, who is a church), and one tagged with the WRONG church (ownCp() takes the tag). The
  // d-tag names church A in both, which is the only thing that should decide.
  for (const [type, d] of [['mediakey:', D.MEDIAKEY + church.pub], ['backup-meta:', D.BACKUPMETA + church.pub]]) {
    for (const [shape, extra] of [['UNTAGGED', []], ['TAGGED CHURCH B', [['church', churchB.pub]]]]) {
      const frame = await publishAs(churchB, doc(churchB, d, { keys: {}, at: now(), rev: now() }, extra));
      assert.equal(frame[2], false,
        'A CO-TENANT CHURCH KEY WROTE CHURCH A\'S ' + type + ' DOCUMENT (' + shape + '). These are ' +
        'ADDRESSABLE, so the write REPLACES — for mediakey: that is every encrypted sermon in church A made ' +
        'undecryptable, by a congregation that merely shares a relay. The rule must scope on the d-tag ' +
        'SUFFIX, which names the church, and not on ownCp(), which the author or the tag can supply. ' +
        'Frame: ' + JSON.stringify(frame));
    }
  }
  // …and church A's own key still writes both in both shapes, or the scoping has locked the owner out.
  // ⚠ THE SLEEP IS NOT DECORATION. Both are ADDRESSABLE documents keyed on (author, d-tag), and the relay
  // refuses a replacement whose created_at is not newer than the copy it already holds — the matrix above
  // has already written each of these as the church key. Without a second between them the second write is
  // refused as a stale replacement and the failure reads exactly like a broken rule. It did.
  for (const d of [D.MEDIAKEY + church.pub, D.BACKUPMETA + church.pub]) {
    assert.equal((await publishAs(church, doc(church, d, { keys: {}, at: now(), rev: now() })))[2], true,
      'the church key can no longer write its own ' + d.slice(0, 24) + '… with no church tag');
    await sleep(1100);
    assert.equal((await publishAs(church, doc(church, d, { keys: {}, at: now(), rev: now() }, [['church', church.pub]])))[2], true,
      'the church key can no longer write its own ' + d.slice(0, 24) + '… with a church tag');
    await sleep(1100);
  }
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
  // ⚠ THE ROW THAT ACTUALLY DRIVES THE FIX — AUDIT-steward-doc-rules-2026-09-22 F7. The two assertions above
  // and below pass with the L1 fix REVERTED, because `net` is not in MEMBERS and so never reaches the
  // `_undeclared` branch at all; only the source match went red, which is a text match doing a behaviour
  // test's job. The discriminating actor is a key that is a MEMBER of A *and* the NETWORK of B, writing an
  // undeclared document that NAMES CHURCH A:
  //   · accept() asks networkOf(author, A) → false → refused (unchanged either way)
  //   · the reason asks the same question with the fix → "undeclared document type …"
  //   · the reason asks NETWORKS.has(author) without it → true → the generic "not a member" sentence, which
  //     is the one that tells a steward to go and check something that is not wrong.
  // Measured both ways on a live gateway, 2026-09-22.
  const crossed = await publishAs(netB, doc(netB, 'trinityone/zzz:' + church.pub + ':crossnet', { crossNet: true }, [['church', church.pub]]));
  assert.equal(crossed[2], false, 'a member of A who is B\'s network key wrote an undeclared document: ' + JSON.stringify(crossed));
  assert.match(String(crossed[3]), /undeclared document type/,
    'THE REASON IS ASKING THE RELAY-WIDE NETWORK QUESTION AGAIN. This author is a network of church B and a ' +
    'plain member of church A; the event names church A, so accept() refused them AS A MEMBER — and the ' +
    'reason excused them as "a network" and printed the generic sentence instead of the honest one. ' +
    '(AUDIT-undeclared-doc-types-2026-09-22 L1.) Frame: ' + JSON.stringify(crossed));
  assert.match(GATEWAY_CODE, /const _rIsNetwork = _rcp \? networkOf\(evt\.pubkey, _rcp\) : NETWORKS\.has\(evt\.pubkey\);/,
    'the OK-frame reason is back on the relay-wide NETWORKS set, so it can describe a refusal by a rule that ' +
    'did not make it (AUDIT-undeclared-doc-types-2026-09-22 L1)');
  // and the un-scoped case is unchanged: A's network key writing A's own undeclared document still lands.
  const asA = await publishAs(net, doc(net, 'trinityone/zzz:' + church.pub + ':own', { own: true }, [['church', church.pub]]));
  assert.equal(asA[2], true, 'the network key lost the catch-all it is supposed to keep: ' + JSON.stringify(asA));
});


// ── THE ACTOR THE ACTOR TABLE LEFT OUT, WHICH IS A NEW GRANT AND NOT A TIDY-UP ───────────────────────────
test('a steward who never joined the church may write msgtags, and nothing else in this set', async () => {
  // AUDIT-steward-doc-rules-2026-09-22 F8, CLAUDE.md rule 2. `2ff0f43`'s actor table has six rows and none
  // of them is "a steward of THIS church who has NOT also joined it as a member". That actor was refused
  // all six types at `6b6e66d` AND at `efe2dbe`, and is now ACCEPTED for one of them — an undeclared
  // widening of who may write a church's chat tag labels.
  //
  // IT IS A GOOD CHANGE, which is exactly why it has to be written down rather than discovered. It is the
  // `groupkey:` defect of 2026-09-17 in the other direction: the registry's own note records that "a
  // steward of THIS church who had not also joined it was REFUSED her own room's key", because the rule in
  // front of it asked the relay-wide `isMember`. stewardCan() asks the church's OWN steward roster and
  // nothing else, so a delegate the church appointed can act for it without first joining it as a member.
  //
  // THE SCOPE OF THE GRANT WAS ONE TYPE WHEN THIS TEST WAS WRITTEN, and is now three: `sermon:` and
  // `backup-meta:` were granted to a steward on 2026-09-22, withdrawn the same day (F1/F2) because their
  // readers could not serve the result, and RE-GRANTED 2026-09-25 (option A) once the readers were fixed —
  // see PLAN-delegated-steward-publishing.md and the two dedicated test files. `smNoJoin` holds every
  // capability (ALL_CAPS below), so both are ACCEPTED for them now, same as msgtags.
  const smNoJoin = K();
  const w = await conn();
  // Re-sign A's roster with BOTH stewards on it. Addressable and keyed on (author, d-tag), so it must be
  // newer than the copy `before()` wrote — see the sleep note in the trusted-relay test above.
  await sleep(1100);
  const roster = await send(w, doc(church, D.STEWARDS + church.pub,
    { pubkeys: [sm.pub, smFin.pub, smNoJoin.pub], caps: { [sm.pub]: ALL_CAPS, [smFin.pub]: ['finance'], [smNoJoin.pub]: ALL_CAPS } }));
  assert.equal(roster[2], true, 'fixture: church A could not re-sign its steward roster — ' + JSON.stringify(roster));
  w.close();
  await sleep(300);

  // …and they really never joined: no trinityone/member:<A> document was ever published for this key.
  const want = {
    'trinityone/msgtags': true,          // GRANTED — content steward, read by #church:[cp], reaches members
    'trinityone/sermon:': true,          // withdrawn 2026-09-22 (F1), RE-GRANTED 2026-09-25 (option A)
    'trinityone/backup-meta:': true,     // withdrawn 2026-09-22 (F2), RE-GRANTED 2026-09-25 (option A)
    'trinityone/mediakey:': false,
    'trinityone/manna-': false,
    'trinityone/relays': false,
  };
  for (const [type, ok] of Object.entries(want)) {
    const frame = await publishAs(smNoJoin, SHAPES[type](smNoJoin));
    assert.equal(frame[2], ok,
      (ok
        ? 'A STEWARD THIS CHURCH APPOINTED IS REFUSED BECAUSE THEY HAVE NOT ALSO JOINED IT AS A MEMBER — '
          + 'that is the groupkey: defect of 2026-09-17 coming back. '
        : 'A STEWARD WHO NEVER JOINED THIS CHURCH WROTE ' + type + '. That is a grant nobody has recorded; '
          + 'if it is deliberate it belongs in the actor table. ')
      + type + ' — the relay answered: ' + JSON.stringify(frame));
  }
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
