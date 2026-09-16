// A CHECK-IN HELPER HOLDS ONE SESSION'S REGISTER, AND PROVABLY NOTHING ELSE.
// Run: node --test scripts/checkin-helper-capability.test.mjs
//
// reference/DESIGN-CHECKIN-IN-THE-MEMBER-APP-2026-09-09.md. The owner, committing to the feature: "This
// sounds like a big build that we can't screw up, and we've broken safeguarding stuff before." §6 lists five
// shipped failures and names the pattern in every one — the gate was correct and the screen did not consult
// it, or the test drove something that was not the shipped path.
//
// So THE NEGATIVE TESTS ARE THE POINT OF THIS FILE. In August, granting a steward Finance handed over the
// children's register: there were passing tests over the permission and not one over the refusal. Every
// assertion below runs against a REAL gateway process over a REAL websocket with REAL signed events, and the
// ones that matter assert what does NOT come back.
//
// WHAT THIS FILE DOES NOT COVER, said here rather than discovered later: there is no check-in screen yet, so
// there is no point-of-use test in the sense of CLAUDE.md rule 1. The point of use in this slice IS the relay
// gate, and that is what is driven. When the screens land, they need their own.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { v2 as nip44 } from 'nostr-tools/nip44';
import { requireFreePort } from './test-ports.mjs';
import { buildHelperGrant, HELPER_LIFETIMES, DEFAULT_HELPER_LIFETIME, HELPER_SOURCES, GRANT_SOURCE,
         buildCheckinPermission, PERMISSION_LIFETIMES, KEY_LEAD_SECONDS } from './checkin-role-source.mjs';
import { D, DOC_TYPES } from './trinity-doc-types.mjs';

const PORT = 8902;   // unique across scripts/*.test.mjs AND scripts/*.probe.mjs
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const NET = 'trinityone';
const now = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };
const hex = u8 => [...u8].map(b => b.toString(16).padStart(2, '0')).join('');
const unhex = h => Uint8Array.from(String(h).match(/.{1,2}/g).map(b => parseInt(b, 16)));

// THE CAST. Named for what each one proves, because "user3 cannot read minors:" is a sentence nobody can check.
const church = K();
const sgLead = K();        // a steward the church ticked for Safeguarding — must keep everything they have today
const treasurer = K();     // a steward ticked for Finance ONLY — the August leak, in person
const ada = K();           // on the children's rota for THIS session: the helper
const dan = K();           // a helper who is NOT a member of the congregation — the grant is his whole authority
const ben = K();           // on the children's rota LAST week, and not this week
const cara = K();          // an ordinary member, never on any rota
const gina = K();          // a guardian: her child is checked in today
const hank = K();          // a guardian of a DIFFERENT family
const teen = K();          // an older young person who does have an account, and whose guardian is gina
const rhys = K();          // gina's OTHER child: in guardians:, and NOT in minors:. The aged-out sibling, or
                           // simply a church that keeps one list and not the other. Both are ordinary.
const ella = K();          // CLEARED BY THE CHURCH FOR THE YEAR, and used to drive the lifetime tests, so that
                           // "an ordinary member" (cara) stays genuinely uncleared and her refusals stay real.
const nella = K();         // ON AN ENVELOPE AND NOT CLEARED — the conjunction, in person. The 2026-09-09
                           // restructure requires BOTH, and this is the one who proves the second half.
const zoe = K();           // CLEARED FROM NEXT MONTH. A clearance granted ahead must admit nobody until it opens.

const S_NOW = 'svc-now', S_LAST = 'svc-last', S_SOON = 'svc-soon';
// A SECOND LIVE SESSION, so "revoking one clearance ends EVERY session at once" is a claim about more than
// one document. Under the old model a steward had to revoke each of these separately; that chore is what
// the restructure deleted, and this is the session that would notice if it came back.
const S_TWO = 'svc-two';
// A SESSION A MONTH OUT. Automatic issuance runs ahead, so the relay refuses to SERVE a key more than
// KEY_LEAD_SECONDS before it opens — otherwise a phone cleared for the year could collect them all.
const S_FAR = 'svc-far';
// The conjunction's own session, minted inside its own test so that no earlier test can have taken its
// actor off the envelope and made the refusal come from the wrong half of the rule.
const S_CONJ = 'svc-conj';
const KEY_NOW = '11'.repeat(32), KEY_LAST = '22'.repeat(32), KEY_SOON = '33'.repeat(32);
const KEY_TWO = '44'.repeat(32), KEY_FAR = '55'.repeat(32);

let relay, dataDir, w;
const conn = () => new Promise((r, j) => { const s = new WebSocket(WS_URL); s.on('open', () => r(s)); s.on('error', j); });
const send = (s, e) => new Promise(res => {
  const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === e.id) { s.off('message', on); res([m[2], m[3] || '']); } };
  s.on('message', on); s.send(JSON.stringify(['EVENT', e]));
});
// A socket that AUTHENTICATES as `who` before its write, because several gates are authed-only.
async function publishAs(who, e) {
  const s = await conn();
  const authed = new Promise(res => {
    const on = d => { const m = JSON.parse(d);
      if (m[0] === 'AUTH') { s.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', WS_URL], ['challenge', m[1]]], content: '' }, who.sk)])); res(true); } };
    s.on('message', on); setTimeout(() => res(false), 400);
  });
  s.send(JSON.stringify(['REQ', 'warm', { kinds: [30078], limit: 1 }]));
  await authed; await sleep(80);
  const out = await send(s, e);
  s.close();
  return out;
}
function req(s, sub, f, sk, ms = 700) {
  return new Promise(res => { const out = [];
    const on = d => { const m = JSON.parse(d);
      if (m[0] === 'EVENT' && m[1] === sub) out.push(m[2]);
      else if (m[0] === 'AUTH' && sk) s.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', WS_URL], ['challenge', m[1]]], content: '' }, sk)])); };
    s.on('message', on); s.send(JSON.stringify(['REQ', sub, f]));
    setTimeout(() => { s.off('message', on); res(out); }, ms); });
}
// Ask AS somebody. One socket per question so a stale AUTH can never make a refusal look like a grant.
async function asks(who, filter) {
  const s = await conn();
  await req(s, 'warm', { kinds: [30078], limit: 1 }, who.sk, 300);   // provoke + answer the challenge
  const got = await req(s, 'q' + Math.random().toString(36).slice(2, 7), filter, who.sk);
  s.close();
  return got;
}

const doc = (who, d, content, extra = []) => finalizeEvent({ kind: 30078, created_at: now(),
  tags: [['d', d], ['t', NET], ...extra], content: typeof content === 'string' ? content : JSON.stringify(content) }, who.sk);

// The grant, built by the SHIPPED builder — not restated here. If buildHelperGrant ever stopped agreeing with
// what the relay enforces, these tests would go red rather than testing a copy of the design.
const grant = (session, helpers, from, until, key, opts = {}) => {
  const { doc: body } = buildHelperGrant({ session, source: opts.source || GRANT_SOURCE,
    lifetime: opts.lifetime || DEFAULT_HELPER_LIFETIME, from, until,
    helpers, keepers: [church.pub, sgLead.pub], sessionKeyHex: key,
    wrap: (p, pl) => nip44.encrypt(pl, nip44.utils.getConversationKey(church.sk, p)) });
  if (opts.mangle) opts.mangle(body);
  return finalizeEvent({ kind: 30078, created_at: opts.at || now(),
    tags: [['d', D.CHECKINHELPER + session], ['t', NET], ['church', church.pub], ['session', session]],
    content: JSON.stringify(body) }, church.sk);
};
// A CLEARANCE — `checkinperm:<personPub>`, the document that says a person may hold check-in keys at all.
//
// Built by the SHIPPED builder, like the grant above and for the same reason: if buildCheckinPermission ever
// stopped agreeing with what the relay enforces, these tests would go red rather than testing a copy.
//
// `open` by default — "until a steward ends it" — because that is what an annual clearance looks like most of
// the year, and because a fixture's window must never be the thing that quietly decides a test about WHO.
const permission = (who, opts = {}) => finalizeEvent({ kind: 30078, created_at: opts.at || now(),
  tags: [['d', D.CHECKINPERM + who.pub], ['t', NET], ['church', church.pub], ['person', who.pub]],
  content: JSON.stringify(buildCheckinPermission({ person: who.pub, source: opts.source || 'steward',
    lifetime: opts.lifetime || 'open',
    from: opts.from != null ? opts.from : now() - 86400,
    until: opts.until !== undefined ? opts.until : null })) }, (opts.by || church).sk);
// WITHDRAW ONE. A tombstone on the PERSON, which is what ends every session at once.
const unpermission = (who, at) => finalizeEvent({ kind: 30078, created_at: at || (now() + 5),
  tags: [['d', D.CHECKINPERM + who.pub], ['t', NET], ['church', church.pub], ['deleted', '1']], content: '' }, church.sk);

// A check-in record. Sealed under the session key, p-tagged to the guardian whose child it is (design §7: the
// child has no phone, so the record hangs off the GUARDIAN's key).
const checkin = (who, id, session, guardianPub, key, payload = {}) => doc(who, D.CHECKIN + id,
  nip44.encrypt(JSON.stringify({ id, childName: 'A Child', code: '4821', ...payload }), unhex(key)),
  [['church', church.pub], ['session', session], ...(guardianPub ? [['p', guardianPub]] : [])]);

// BOOT THE RELAY ON THE SAME DATA DIRECTORY. Separated out of before() so a test can restart the box and ask
// its questions again — the relay rehydrates every stored document through note() on each boot, so "what this
// relay believes" and "what this relay has written down" are two different things, and a rule that holds only
// in the first of them is a rule that expires at the next restart. This relay restarts itself.
async function boot() {
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(church.pub) } });
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) break; } catch {} await sleep(150); }
}
async function restart() {
  try { w && w.close(); } catch {}
  await new Promise(r => { relay.on('exit', r); try { relay.kill('SIGKILL'); } catch { r(); } });
  await sleep(300);
  await boot();
  await sleep(500);          // let the rehydrate pass finish before anything is asked
  w = await conn();
}

before(async () => {
  await requireFreePort(PORT, 'checkin-helper-capability.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-cih-'));
  await boot();
  w = await conn();

  // everyone but dan joins the congregation. dan is the delegated helper who never did.
  for (const who of [sgLead, treasurer, ada, ben, cara, gina, hank, teen, rhys, ella, nella, zoe]) await send(w, doc(who, D.MEMBER + church.pub, { joined: now() }));
  // the steward roster, with capabilities the owner actually ticked
  await send(w, doc(church, D.STEWARDS + church.pub, { pubkeys: [sgLead.pub, treasurer.pub],
    caps: { [sgLead.pub]: ['safeguarding'], [treasurer.pub]: ['finance'] } }));
  // safeguarding lists
  // TWO LISTS THAT DO NOT AGREE, on purpose: rhys is gina's child in `guardians:` and is NOT in `minors:`.
  // That is not a broken fixture, it is the commonest real state of a church that has used one screen and
  // not the other, and it is what makes the sibling test below able to fail.
  await send(w, doc(church, D.MINORS + church.pub, { pubkeys: [teen.pub] }));
  await send(w, doc(church, D.GUARDIANS + church.pub, { links: { [teen.pub]: [gina.pub], [rhys.pub]: [gina.pub] } }));
  // the two capability-key envelopes as they stand today: the register's, and the books'
  await send(w, doc(church, D.CHECKINKEY + church.pub, { rev: 1, keys: { [church.pub]: 'ct-church', [sgLead.pub]: 'ct-sg' } }));
  await send(w, doc(church, D.FINANCEKEY + church.pub, { rev: 1, keys: { [church.pub]: 'ct-church', [treasurer.pub]: 'ct-fin' } }));
  // THE CHURCH'S OWN ROTA for this session, so the leak test below compares two documents that both exist:
  // the rota a steward can narrow, and the grant nobody could. Sealed in the shipped product (the relay
  // cannot read `assign`), which is exactly why its cleartext twin matters.
  await send(w, doc(church, D.ROTA + S_NOW, 'sealed-rota-ciphertext', [['church', church.pub]]));
  // a ledger entry and a private ask-for-help, so "unreachable" is measured against documents that EXIST
  await publishAs(treasurer, doc(treasurer, D.FIN_JOURNAL + '1', { e: 'sealed-ledger' }, [['church', church.pub]]));
  await publishAs(cara, doc(cara, D.CAREREQ + cara.pub.slice(0, 16) + '-r1', { e: 'sealed-ask' }, [['church', church.pub], ['p', church.pub]]));

  const t = now();
  // ── WHO THE CHURCH HAS CLEARED ────────────────────────────────────────────────────────────────────────
  // The 2026-09-09 restructure. A clearance is scoped to the PERSON and lasts until the church ends it; the
  // session key is a separate document, issued to whoever the clearance admits. THE RELAY REQUIRES BOTH, so
  // every fixture below that expects a helper to work needs a clearance as well as an envelope.
  //
  // BEN IS CLEARED AND IS NOT ON THIS WEEK'S ENVELOPE, deliberately. Under the old model "last week's helper"
  // was somebody the church had not re-authorised; under this one he is cleared for the year and simply not
  // serving today, which is the ordinary case and the harder test.
  //
  // NELLA IS ON AN ENVELOPE AND IS NOT CLEARED. CARA IS NEITHER. ZOE IS CLEARED FROM NEXT MONTH.
  for (const who of [ada, dan, ben, ella]) await send(w, permission(who));
  await send(w, permission(zoe, { lifetime: 'dated', from: t + 30 * 86400, until: t + 60 * 86400 }));
  await sleep(150);
  await send(w, grant(S_NOW,  [ada.pub, dan.pub, nella.pub], t - 600, t + 3600, KEY_NOW));
  await send(w, grant(S_LAST, [ben.pub],          t - 8 * 3600, t - 5 * 3600, KEY_LAST));
  await send(w, grant(S_SOON, [ada.pub, zoe.pub], t + 3600, t + 7000, KEY_SOON));
  await send(w, grant(S_TWO,  [ada.pub],          t - 600, t + 3600, KEY_TWO));
  await send(w, grant(S_FAR,  [ada.pub],          t + 30 * 86400, t + 30 * 86400 + 3600, KEY_FAR));
  // records the church itself wrote, for each session, so a refusal is a refusal of something that is there
  await send(w, checkin(church, 'r-now-gina', S_NOW, gina.pub, KEY_NOW));
  await send(w, checkin(church, 'r-now-hank', S_NOW, hank.pub, KEY_NOW));
  await send(w, checkin(church, 'r-now-teen', S_NOW, teen.pub, KEY_NOW));
  await send(w, checkin(church, 'r-now-rhys', S_NOW, rhys.pub, KEY_NOW));
  await send(w, checkin(church, 'r-last-gina', S_LAST, gina.pub, KEY_LAST));
  await sleep(300);
});
after(() => { try { w && w.close(); } catch {} try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

// ── THE POSITIVE, without which every negative below is vacuous ────────────────────────────────────────────

test('a rostered helper can check a child in, and open this session\'s register', async () => {
  const [ok, msg] = await publishAs(ada, checkin(ada, 'r-now-ada', S_NOW, gina.pub, KEY_NOW, { childName: 'Ada wrote this' }));
  assert.equal(ok, true, 'the helper capability grants nothing at all — a rostered helper was refused: ' + msg);
  await sleep(200);
  const got = await asks(ada, { kinds: [30078], '#d': [D.CHECKIN + 'r-now-gina'] });
  assert.equal(got.length, 1, 'an in-window helper cannot fetch this session\'s register');
  assert.doesNotMatch(got[0].content, /4821/, 'the pickup code is on the wire in the clear');
  const opened = JSON.parse(nip44.decrypt(got[0].content, unhex(KEY_NOW)));
  assert.equal(opened.code, '4821', 'the session key does not open this session\'s records');
});

test('a helper who is not a member of the congregation is admitted by the grant alone', async () => {
  // The realistic case is a rota volunteer who IS a member. This proves the AUTHORITY comes from the grant and
  // not from membership — the same reason the checkin: write rule already admits a delegated steward who never
  // joined the congregation they help run.
  const [ok] = await publishAs(dan, checkin(dan, 'r-now-dan', S_NOW, hank.pub, KEY_NOW));
  assert.equal(ok, true, 'a named helper who is not a member was refused, so a delegated volunteer cannot work');
  const key = await asks(dan, { kinds: [30078], '#d': [D.CHECKINHELPER + S_NOW] });
  assert.equal(key.length, 1, 'a non-member helper cannot fetch the grant carrying their own session key — ' +
    'the church would have granted them the register and then refused them the key that opens it');
  assert.ok(JSON.parse(key[0].content).keys[dan.pub], 'the grant carries no key for the helper it names');
});

// ── "AND PROVABLY NOTHING ELSE" ───────────────────────────────────────────────────────────────────────────

test('with a helper key and nothing else: the SAFEGUARDING REGISTER is unreachable', async () => {
  for (const who of [ada, dan]) {
    assert.deepEqual(await asks(who, { kinds: [30078], '#d': [D.MINORS + church.pub] }), [],
      'a check-in helper was served minors: — the cleartext list of which members are children');
    assert.deepEqual(await asks(who, { kinds: [30078], '#d': [D.GUARDIANS + church.pub] }), [],
      'a check-in helper was served guardians: — the map of every child to their parents');
  }
});

test('with a helper key and nothing else: FINANCE is unreachable', async () => {
  // This is the August leak in reverse. Granting Finance handed over the children's register; the test that
  // was missing was the refusal. Here it is, in the other direction, before anyone can say it was obvious.
  //
  // THE LEDGER, asserted against BOTH helpers — and the second one is the part that changed.
  //
  // WHAT THIS NOTE USED TO SAY, and why it no longer says it. Until 2026-09-16 it recorded a gap found while
  // writing this file: `finance/journal:` had NO read branch in canRead() at all, so it fell to the ordinary
  // effective-member rule and any member of the church could fetch the ledger's ciphertext, while
  // scripts/trinity-doc-types.mjs declared it `read: 'church'`. It was asserted here as it actually was
  // (`ada` — an ordinary member — received 1) with a note saying the registry was describing something the
  // relay did not do, and that fixing it was not that slice's business.
  //
  // IT HAS NOW BEEN FIXED, deliberately, on fix/finance-read-gate-2026-09-16. canRead() has a `finance/`
  // branch that serves the module to the church, its network and a steward holding Finance, and returns. So
  // ada's count moves from 1 to 0 — and the zero is NOT flipped on its own: the line below is a MEMBER's
  // refusal now, which is a different claim from the helper's, and the re-anchor beneath it proves the
  // document is really on the box. What is measured has not weakened; the relay has.
  assert.deepEqual(await asks(dan, { kinds: [30078], '#d': [D.FIN_JOURNAL + '1'] }), [],
    'a check-in helper who is not a member of the congregation was served the church\'s ledger — the grant ' +
    'must confer nothing beyond one session\'s register');
  assert.deepEqual(await asks(ada, { kinds: [30078], '#d': [D.FIN_JOURNAL + '1'] }), [],
    'an ordinary member who is also a check-in helper was served the church\'s ledger. The entries are ' +
    'sealed, but the address and the timestamp are cleartext, so this hands over the shape of the books.');
  assert.equal((await asks(treasurer, { kinds: [30078], '#d': [D.FIN_JOURNAL + '1'] })).length, 1,
    're-anchor: the entry is not on this relay at all, so the two refusals above prove nothing. (The ' +
    'treasurer is the church\'s Finance steward; scripts/the-books-are-not-the-congregations.test.mjs ' +
    'is where that gate is tested in full.)');
  // AND THE PART THAT ACTUALLY DECIDES IT: neither helper holds a key that opens any of it.
  for (const who of [ada, dan]) {
    const env = await asks(who, { kinds: [30078], '#d': [D.FINANCEKEY + church.pub] });
    for (const e of env) assert.equal(JSON.parse(e.content).keys[who.pub], undefined,
      'the books\' key envelope carries a copy wrapped to a check-in helper');
  }
  const seen = await asks(ada, { kinds: [30078], '#d': [D.FINANCEKEY + church.pub] });
  assert.equal(seen.length, 1, 're-anchor: the finance key envelope is not on the relay, so this proves nothing');
});

test('with a helper key and nothing else: CARE is unreachable', async () => {
  for (const who of [ada, dan]) {
    assert.deepEqual(await asks(who, { kinds: [30078], '#d': [D.CAREREQ + cara.pub.slice(0, 16) + '-r1'] }), [],
      'a check-in helper was served a member\'s private ask for help');
  }
});

test('with a helper key and nothing else: the MEMBERS LIST is unreachable', async () => {
  // Asserted with the NON-MEMBER helper, deliberately and honestly. A helper who is also an ordinary member of
  // the church can read the congregation's join documents because they are a member — that is unchanged, and
  // pretending otherwise would be a test that measures the wrong thing. What must be true is that the GRANT
  // confers no membership, which is exactly what dan proves.
  assert.deepEqual(await asks(dan, { kinds: [30078], '#d': [D.MEMBER + church.pub] }), [],
    'a check-in helper who never joined the congregation was served its membership list');
  assert.deepEqual(await asks(dan, { kinds: [30078], '#d': [D.STEWARDS + church.pub] }), [],
    'a check-in helper was served the steward roster');
});

test('THE HELPER NEVER RECEIVES THE CHURCH-WIDE REGISTER KEY', async () => {
  // The heart of it. If the helper were simply added to trinityone/checkinkey: — the obvious reading of "change
  // the wrapping" — they would hold the key to EVERY session's records for ever, and "access ends when the turn
  // does" would be a sentence in a document rather than a property of the system. They get a session key
  // instead, and this is where that is proved.
  const env = await asks(ada, { kinds: [30078], '#d': [D.CHECKINKEY + church.pub] });
  assert.equal(env.length, 1, 're-anchor: the register key envelope is not on the relay, so this proves nothing');
  const keys = JSON.parse(env[0].content).keys;
  assert.equal(keys[ada.pub], undefined,
    'a check-in helper holds the CHURCH-WIDE children\'s register key — every session, past and future, for ever');
  assert.equal(keys[dan.pub], undefined);
  assert.ok(keys[church.pub] && keys[sgLead.pub], 're-anchor: the envelope no longer carries the church + safeguarding lead');
});

// ── "ACCESS ENDS WHEN THE TURN DOES" ──────────────────────────────────────────────────────────────────────

test('LAST WEEK\'S HELPER OPENS NOTHING THIS WEEK', async () => {
  const [ok, msg] = await publishAs(ben, checkin(ben, 'r-now-ben', S_NOW, gina.pub, KEY_NOW));
  assert.equal(ok, false, 'last week\'s crèche volunteer wrote into this week\'s register: ' + msg);
  assert.deepEqual(await asks(ben, { kinds: [30078], '#d': [D.CHECKIN + 'r-now-gina'] }), [],
    'last week\'s helper was served this week\'s children — the entire appeal of tying the key to the rota is ' +
    'that it stops, and it only stops if it is enforced');
  const env = await asks(ben, { kinds: [30078], '#d': [D.CHECKINHELPER + S_NOW] });
  for (const e of env) assert.equal(JSON.parse(e.content).keys[ben.pub], undefined,
    'this week\'s session key was wrapped to last week\'s helper');
});

test('and their own turn, once it is over, is over', async () => {
  const [ok] = await publishAs(ben, checkin(ben, 'r-last-ben', S_LAST, gina.pub, KEY_LAST));
  assert.equal(ok, false, 'a helper wrote into a session whose window had closed — a "session" that never ends ' +
    'is a standing key with a timestamp on it');
  assert.deepEqual(await asks(ben, { kinds: [30078], '#d': [D.CHECKIN + 'r-last-gina'] }), [],
    'a helper kept being served their session\'s register after the session ended');
});

test('a grant that has not opened yet grants nothing', async () => {
  // Minting next month's rota in advance is an ordinary thing for a church to do, and must be safe.
  const [ok] = await publishAs(ada, checkin(ada, 'r-soon-ada', S_SOON, gina.pub, KEY_SOON));
  assert.equal(ok, false, 'a helper wrote into a session that has not started');
});

test('a helper cannot write into the register at large, nor into a session they do not hold', async () => {
  const noSession = doc(ada, D.CHECKIN + 'r-loose', nip44.encrypt('{}', unhex(KEY_NOW)), [['church', church.pub]]);
  assert.equal((await publishAs(ada, noSession))[0], false,
    'a helper wrote a check-in with NO session tag — the grant is per-session, so an untagged record is the ' +
    'register at large and must be refused');
  const wrongSession = checkin(ada, 'r-wrong', S_LAST, gina.pub, KEY_LAST);
  assert.equal((await publishAs(ada, wrongSession))[0], false,
    'this week\'s helper wrote into LAST week\'s session');
});

// ── "A PERSON NOT ON THE ROTA CANNOT OBTAIN THE KEY" ──────────────────────────────────────────────────────

test('an ordinary member cannot obtain the key, write a record, or read one', async () => {
  assert.equal((await publishAs(cara, checkin(cara, 'r-now-cara', S_NOW, gina.pub, KEY_NOW)))[0], false,
    'any member of the church could overwrite a child\'s presence record');
  assert.deepEqual(await asks(cara, { kinds: [30078], '#d': [D.CHECKIN + 'r-now-gina'] }), [],
    'an ordinary member was served a child\'s check-in record');
  // AND THE GRANT ITSELF IS NOT SERVED TO THEM AT ALL — asserted as a REFUSAL, which is the whole point of
  // this file and which this assertion did not do until 2026-09-09. It read `for (const e of env) …`, so when
  // the envelope WAS served the loop simply checked that cara's own slot was absent, and passed. Measured on
  // this branch before the fix: `env.length === 1`. The read gate granted the named helper and then fell
  // through to the ordinary effective-member rule, so every member of the congregation received the grant in
  // full — the cleartext `pubs` array naming everyone rostered to children's work that morning, plus the
  // keeper set off `keys{}`. A church that had narrowed its rota to stewards was still publishing the
  // children's-work half of it to everybody, which reverses a decision the church had explicitly made.
  //
  // An empty list would satisfy the old loop vacuously, so the length is asserted FIRST and the slot check is
  // kept underneath it: if the envelope ever comes back, this says so before anything else is examined.
  const env = await asks(cara, { kinds: [30078], '#d': [D.CHECKINHELPER + S_NOW] });
  assert.deepEqual(env, [],
    'an ordinary member was served the check-in helper grant. Its `pubs` array is CLEARTEXT and names ' +
    'everyone rostered to children\'s work for that session — the relay needs it to enforce the grant, the ' +
    'congregation does not, and a church that narrowed its rota visibility has just had that reversed.');
  for (const e of env) assert.equal(JSON.parse(e.content).keys[cara.pub], undefined,
    'the session key was wrapped to somebody who is not on the rota');
});

// ── THE GRANT IS NOT A SECOND, UNGATED COPY OF THE CHILDREN'S ROTA ────────────────────────────────────────

test('THE ROTA DOES NOT LEAK THROUGH THE GRANT, and the protection does not wait on a settings page', async () => {
  // WHY THIS IS ITS OWN TEST. The grant's `pubs` array is cleartext and names everyone rostered to children's
  // work for that session — the relay has to read what it enforces, exactly as it does for `roster:` and
  // `rota-settings`. Serving it to the congregation publishes the children's-work half of the rota to
  // everybody, and does it through a document no rota screen or rota setting has any say over.
  //
  // THE FIRST HALF: a church that HAS narrowed its rota. `visibility: 'stewards'` is a decision a steward made
  // on a screen; the whole point of the setting is that the congregation does not get to see who serves.
  // Measured on this branch before the fix: cara was correctly refused `rota:` — and was handed the grant.
  await send(w, doc(church, D.ROTA_SETTINGS, { visibility: 'stewards' }));
  await sleep(200);
  assert.deepEqual(await asks(cara, { kinds: [30078], '#d': [D.ROTA + S_NOW] }), [],
    're-anchor: rota-settings is not being enforced at all, so the comparison below proves nothing');
  assert.deepEqual(await asks(cara, { kinds: [30078], '#d': [D.CHECKINHELPER + S_NOW] }), [],
    'the church narrowed its rota to stewards and the congregation was handed the children\'s-work half of ' +
    'it anyway, through the helper grant. A steward\'s decision was silently reversed by a document that ' +
    'settings page does not know exists.');

  // THE SECOND HALF, AND THE ONE THAT MATTERS MORE. Take the setting away entirely — which is the state of
  // EVERY church that exists today, because the default is 'church' and nobody has to open that page. The
  // refusal must be identical. A protection that only arrives once a church has found a settings screen is
  // not a protection; it is a reward for having read the manual.
  await publishAs(church, finalizeEvent({ kind: 30078, created_at: now(),
    tags: [['d', D.ROTA_SETTINGS], ['t', NET], ['church', church.pub], ['deleted', '1']], content: '' }, church.sk));
  await sleep(200);
  assert.equal((await asks(cara, { kinds: [30078], '#d': [D.ROTA + S_NOW] })).length, 1,
    're-anchor: the rota is still withheld with no setting in force, so the two halves are not being compared');
  assert.deepEqual(await asks(cara, { kinds: [30078], '#d': [D.CHECKINHELPER + S_NOW] }), [],
    'the grant is withheld only from churches that configured rota visibility. Every church that has never ' +
    'opened that page — which is all of them — still publishes its children\'s rota to the whole congregation.');

  // AND IT IS A NARROWING, NOT A BLACKOUT. The people who must have it still do, or this "fix" would take the
  // session key away from the volunteer holding the creche.
  assert.equal((await asks(ada, { kinds: [30078], '#d': [D.CHECKINHELPER + S_NOW] })).length, 1,
    'the rostered helper lost their own session key');
  assert.equal((await asks(dan, { kinds: [30078], '#d': [D.CHECKINHELPER + S_NOW] })).length, 1,
    'the helper who is NOT a member of the congregation lost their key — the grant is his whole authority, ' +
    'so he would be granted the register by the church and refused the key that opens it');
  assert.equal((await asks(church, { kinds: [30078], '#d': [D.CHECKINHELPER + S_NOW] })).length, 1,
    'the church cannot read its own grant');
  assert.equal((await asks(sgLead, { kinds: [30078], '#d': [D.CHECKINHELPER + S_NOW] })).length, 1,
    'the safeguarding lead lost the session key, so a helper\'s record becomes unopenable by the one steward ' +
    'accountable for the register');
});

test('NOBODY BUT THE CHURCH KEY MAY MINT A GRANT — not a member, not even the safeguarding lead', async () => {
  const t = now();
  const forge = (who) => {
    const { doc: body } = buildHelperGrant({ session: S_NOW, source: GRANT_SOURCE, lifetime: 'session', from: t - 60, until: t + 600,
      helpers: [who.pub], keepers: [], sessionKeyHex: KEY_NOW,
      wrap: (p, pl) => nip44.encrypt(pl, nip44.utils.getConversationKey(who.sk, p)) });
    return finalizeEvent({ kind: 30078, created_at: t, tags: [['d', D.CHECKINHELPER + S_NOW], ['t', NET], ['church', church.pub]], content: JSON.stringify(body) }, who.sk);
  };
  assert.equal((await publishAs(cara, forge(cara)))[0], false, 'a member minted themselves the children\'s register');
  assert.equal((await publishAs(ada, forge(ada)))[0], false, 'a helper extended their own grant');
  // THE ESCALATION THAT MATTERS. A safeguarding steward can already READ the whole register. What they must not
  // gain is the power to hand it to somebody else — that is a decision only the key-holding owner makes, and it
  // is the same sentence the checkinkey: rule turns on.
  assert.equal((await publishAs(sgLead, forge(sgLead)))[0], false,
    'a delegated safeguarding steward minted a helper grant — they can now hand the children\'s register, and ' +
    'every pickup code in it, to anyone they choose');
  await sleep(150);
  const env = await asks(church, { kinds: [30078], '#d': [D.CHECKINHELPER + S_NOW], authors: [church.pub] });
  assert.equal(env.length, 1);
  assert.deepEqual(JSON.parse(env[0].content).pubs.sort(), [ada.pub, dan.pub, nella.pub].sort(),
    'the church\'s own grant was replaced by a forgery');
});

test('a grant may not be made permanent, nor claim a source nobody implemented', async () => {
  const t = now();
  const bad = (mangle) => {
    const { doc: body } = buildHelperGrant({ session: 'svc-x', source: GRANT_SOURCE, lifetime: 'session', from: t, until: t + 600,
      helpers: [ella.pub], keepers: [], sessionKeyHex: KEY_NOW,
      wrap: (p, pl) => nip44.encrypt(pl, nip44.utils.getConversationKey(church.sk, p)) });
    mangle(body);
    return finalizeEvent({ kind: 30078, created_at: t, tags: [['d', D.CHECKINHELPER + 'svc-x'], ['t', NET]], content: JSON.stringify(body) }, church.sk);
  };
  assert.equal((await publishAs(church, bad(b => { b.until = b.from + HELPER_LIFETIMES.session.max + 1; })))[0], false,
    'the relay stored an unbounded "session" — a standing key with a session-shaped name');
  assert.equal((await publishAs(church, bad(b => { b.until = b.from - 1; })))[0], false,
    'the relay stored a window that closes before it opens');
  assert.equal((await publishAs(church, bad(b => { b.source = 'safeguarding-team'; })))[0], false,
    'a grant claimed a provenance this build has never implemented, and the relay recorded it as if it meant something');
  // AND EVERY DECLARED SOURCE THAT IS NOT THE PINNED ONE — the regression that would look like working
  // software. An envelope built from a rota is the pre-2026-09-09 model, in which a service's rota decided who
  // held a key rather than the church's own clearances.
  for (const src of Object.keys(HELPER_SOURCES).filter(k => k !== GRANT_SOURCE)) {
    assert.equal((await publishAs(church, bad(b => { b.source = src; })))[0], false,
      'the relay stored an envelope declaring source=' + src + '. Who may hold a key is a PERMISSION now, and ' +
      'an envelope deriving its own recipients from a rota is the shape this restructure removed.');
  }
  assert.equal((await publishAs(church, bad(b => { b.session = 'svc-somewhere-else'; })))[0], false,
    'a grant whose d-tag and content name different sessions was stored — a grant for a quiet Tuesday would ' +
    'then open the Sunday register');
  await sleep(150);
  assert.equal((await publishAs(ella, checkin(ella, 'r-x-ella', 'svc-x', gina.pub, KEY_NOW)))[0], false,
    'a refused grant admitted somebody anyway');
});

test('a stale grant replayed after a newer one does not put a removed helper back', async () => {
  // THE REAL SHAPE OF A STALE REPLAY, and it is the shape this test did NOT drive until 2026-09-09. A copy
  // arriving from a rehydrate or a peer sync carries its ORIGINAL created_at inside the signature; nobody can
  // hand it a fresher one without the church's key. So the stale grant below is older, as a real one is.
  //
  // This test used to publish the stale grant with a NEWER created_at and a LOWER `rev`, which drove the only
  // case the (now removed) rev counter could ever decide — see the restart test directly below for what that
  // actually bought.
  const t = now();
  await publishAs(church, grant(S_NOW, [ada.pub], t - 600, t + 3600, KEY_NOW, { at: t + 1 }));
  await sleep(150);
  assert.equal((await publishAs(dan, checkin(dan, 'r-now-dan2', S_NOW, hank.pub, KEY_NOW)))[0], false,
    're-anchor: the grant that drops dan was not applied, so the replay below proves nothing');
  // now the OLD grant arrives again — same helpers as before dan was removed, its own older timestamp
  await publishAs(church, grant(S_NOW, [ada.pub, dan.pub], t - 600, t + 3600, KEY_NOW, { at: t - 3 }));
  await sleep(150);
  assert.equal((await publishAs(dan, checkin(dan, 'r-now-dan3', S_NOW, hank.pub, KEY_NOW)))[0], false,
    'a stale grant replayed a helper the church had already removed back onto the children\'s register');
  assert.equal((await publishAs(ada, checkin(ada, 'r-now-ada2', S_NOW, gina.pub, KEY_NOW)))[0], true,
    'the newest-wins guard also locked out the helper who IS on the current grant');
});

test('AND THE REMOVAL SURVIVES A RESTART — the relay\'s answer is the same after a reboot as before it', async () => {
  // THE DEFECT THIS EXISTS FOR, measured on this branch on 2026-09-09 before it was fixed:
  //
  //     after the church removed dan          -> dan refused
  //     after a stale grant came back         -> dan refused   (the rev guard held)
  //     AFTER A RESTART                       -> DAN COULD WRITE TO THE CHILDREN'S REGISTER AGAIN
  //
  // The ingest carried a `rev` counter in front of its timestamp comparison. Where it fired it refused a
  // document that put() had already STORED, so the relay's live map and the corpus underneath it disagreed —
  // and the reboot resolved the disagreement in favour of the stale grant. The relay restarts itself, so that
  // was a scheduled reversal of a safeguarding decision.
  //
  // WHAT IS ASSERTED IS THE INVARIANT, not one outcome: whatever this relay believes about who may open the
  // children's register, it must still believe it after a restart, because the restart is what re-derives it
  // from what was actually written down. Any future ordering rule that lives only in the map — a rev, a
  // sequence number, an in-memory "seen" set — breaks this test rather than shipping quietly.
  const beforeDan = (await publishAs(dan, checkin(dan, 'r-restart-dan-a', S_NOW, hank.pub, KEY_NOW)))[0];
  const beforeAda = (await publishAs(ada, checkin(ada, 'r-restart-ada-a', S_NOW, gina.pub, KEY_NOW)))[0];
  assert.equal(beforeDan, false, 're-anchor: dan is not the removed helper any more, so this proves nothing');
  assert.equal(beforeAda, true, 're-anchor: ada is not the current helper any more, so this proves nothing');

  await restart();

  assert.equal((await publishAs(dan, checkin(dan, 'r-restart-dan-b', S_NOW, hank.pub, KEY_NOW)))[0], beforeDan,
    'a restart changed the relay\'s mind about a helper the church REMOVED. The live map and the stored ' +
    'corpus disagree, and the reboot resolved it from disk — so the removal was only ever true until the ' +
    'next restart, and this relay restarts itself.');
  assert.equal((await publishAs(ada, checkin(ada, 'r-restart-ada-b', S_NOW, gina.pub, KEY_NOW)))[0], beforeAda,
    'a restart changed the relay\'s mind about the helper who IS rostered — the register goes down on reboot');
  assert.equal((await asks(ada, { kinds: [30078], '#d': [D.CHECKINHELPER + S_NOW] })).length, 1,
    'the grant itself did not come back through the rehydrate, so the helper has no key after a restart');
});

// ── THE PEOPLE WHO MUST KEEP WHAT THEY HAVE ───────────────────────────────────────────────────────────────

test('the church key and the safeguarding lead keep everything they had — this slice narrows nothing', async () => {
  assert.equal((await publishAs(church, checkin(church, 'r-now-church2', S_NOW, gina.pub, KEY_NOW)))[0], true,
    'the church can no longer write its own register');
  // the safeguarding steward, with NO grant naming them anywhere
  assert.equal((await publishAs(sgLead, checkin(sgLead, 'r-now-sg', S_NOW, gina.pub, KEY_NOW)))[0], true,
    'a safeguarding steward was refused the register they have held since August — a session grant must ADD a ' +
    'route, never replace the roster');
  const noSession = doc(sgLead, D.CHECKIN + 'r-sg-loose', nip44.encrypt('{}', unhex(KEY_NOW)), [['church', church.pub]]);
  assert.equal((await publishAs(sgLead, noSession))[0], true,
    'the session tag became mandatory for everyone, so every existing console write stopped working');
  await sleep(150);
  assert.equal((await asks(sgLead, { kinds: [30078], '#d': [D.CHECKIN + 'r-now-gina'] })).length, 1,
    'a safeguarding steward can no longer read the register');
  assert.equal((await asks(church, { kinds: [30078], '#d': [D.CHECKIN + 'r-now-gina'] })).length, 1,
    'the church can no longer read its own register');
  assert.equal((await asks(sgLead, { kinds: [30078], '#d': [D.MINORS + church.pub] })).length, 1,
    'a safeguarding steward lost the minors list as a side effect');
});

test('and the safeguarding lead is given each session\'s key, or a helper\'s record is unopenable', async () => {
  const env = await asks(sgLead, { kinds: [30078], '#d': [D.CHECKINHELPER + S_NOW] });
  assert.equal(env.length, 1);
  const body = JSON.parse(env[0].content);
  const k = nip44.decrypt(body.keys[sgLead.pub], nip44.utils.getConversationKey(sgLead.sk, church.pub));
  assert.equal(k, KEY_NOW, 'the safeguarding lead cannot open what a helper wrote — a check-in only the ' +
    'volunteer who typed it can ever read is not a safeguarding record');
  assert.ok(!body.pubs.includes(sgLead.pub),
    'the safeguarding lead was written into the ENFORCED helper list; their authority must come from the ' +
    'steward roster, or removing them from it would leave a grant still admitting them');
});

// RENAMED AND FLIPPED 2026-09-11, and the old title is kept rather than deleted (CLAUDE.md rules 4 and 8).
// It was 'a Finance-only steward still receives the ciphertext, exactly as today — named, not fixed', and it
// asserted `got.length === 1` under this reasoning:
//
//     "HONESTY, not an endorsement. canRead's privileged short-circuit admits `stewardCan(authed, cp, 'any')`,
//      which any single capability satisfies, and fourteen other rules share that line. Narrowing it is a
//      change to a grant this slice has no business touching. What the treasurer cannot do is OPEN one."
//
// ITS OWN RE-ANCHOR INVITED THIS CHANGE — "if it is now 0 that is a TIGHTENING and probably good, but it was
// not decided here" — and it has now been decided, in its own commit, with the full who-must-keep-it half in
// scripts/a-check-in-record-the-relay-will-share.test.mjs.
//
// AND THE REASONING THE OLD COMMENT RESTED ON WAS TOO KIND TO ITSELF. "They cannot open it" is true and is
// not the whole disclosure: ['p'] and ['session'] are CLEARTEXT because the relay routes on them, `roster:`
// turns a pubkey into a name, and a session resolves to a dated service. So the treasurer did not need to
// open anything to derive "this named parent had a child at church on this date", for the whole history.
// The narrowing is done WITHOUT touching the shared short-circuit: the check-in documents are simply decided
// BEFORE it now, by checkinReader() — so the other fourteen rules are untouched.
test('A FINANCE-ONLY STEWARD IS REFUSED THE REGISTER — decided 2026-09-11, was served it until then', async () => {
  assert.deepEqual(await asks(treasurer, { kinds: [30078], '#d': [D.CHECKIN + 'r-now-gina'] }), [],
    'A STEWARD TICKED FOR FINANCE ALONE WAS SERVED A CHILD\'S CHECK-IN RECORD. Sealed is not the same as ' +
    'withheld: the cleartext tags alone give up which named parent had a child at church on which date.');
  // AND THE SAFEGUARDING LEAD STILL HAS IT, in the same breath, because a narrowing measured only on the
  // person who loses it is how a register goes blank on a Sunday.
  const sg = await asks(sgLead, { kinds: [30078], '#d': [D.CHECKIN + 'r-now-gina'] });
  assert.equal(sg.length, 1, 'the safeguarding lead lost the register alongside the treasurer');
  assert.throws(() => nip44.decrypt(sg[0].content, unhex('44'.repeat(32))),
    're-anchor: the record is not sealed at all');
});

// ── THE GUARDIAN ──────────────────────────────────────────────────────────────────────────────────────────

test('a guardian sees their own child\'s record and PROVABLY NOT another family\'s', async () => {
  const mine = await asks(gina, { kinds: [30078], '#d': [D.CHECKIN + 'r-now-gina'] });
  assert.equal(mine.length, 1, 'a parent cannot see that their own child was checked in');
  const theirs = await asks(gina, { kinds: [30078], '#d': [D.CHECKIN + 'r-now-hank'] });
  assert.deepEqual(theirs, [], 'a parent was served ANOTHER family\'s child\'s check-in record');
  const back = await asks(hank, { kinds: [30078], '#d': [D.CHECKIN + 'r-now-gina'] });
  assert.deepEqual(back, [], 'the leak runs the other way too');
});

test('a guardian of a young person WITH an account reaches their record, through the church\'s own map', async () => {
  const got = await asks(gina, { kinds: [30078], '#d': [D.CHECKIN + 'r-now-teen'] });
  assert.equal(got.length, 1, 'a linked guardian cannot see their own teenager\'s check-in');
  const other = await asks(hank, { kinds: [30078], '#d': [D.CHECKIN + 'r-now-teen'] });
  assert.deepEqual(other, [], 'an unrelated member reached a young person\'s check-in record');
});

test('and the guardian link does not run BACKWARDS — a child is never their parent\'s guardian', async () => {
  // guardianLinkedIn matches in EITHER direction, deliberately, so every caller has to scope it. Without the
  // minorOf() guard the church's own parent-child map would hand a young person their parent's records — the
  // same trap that produced a direct-message route between two children in sim round 3.
  const got = await asks(teen, { kinds: [30078], '#d': [D.CHECKIN + 'r-now-gina'] });
  assert.deepEqual(got, [], 'a young person was served their guardian\'s other child\'s check-in record');
});

test('…AND IT DOES NOT RUN SIDEWAYS EITHER — a sibling the church never marked a minor is still refused', async () => {
  // THE TRAP THE TEST ABOVE DOES NOT CATCH, and the reason it does not: `teen` is in `minors:`, so minorOf()
  // refuses them and the direction of the guardian link is never actually exercised. The whole gate rested on
  // one list, and it stops working the moment a church's two lists differ.
  //
  // `rhys` is that case. The church has him in `guardians:` as gina's child — he IS her child — and has NOT
  // marked him in `minors:`. Two ordinary ways a church arrives here, both in reference/DOMAIN.md territory:
  // he has aged out and somebody updated one list, or the church maintains guardian links and has never used
  // the minors list at all.
  //
  // Measured on this branch before the fix: rhys was served `r-now-gina` — his sibling's check-in record.
  // guardianLinkedIn(h=gina, authed=rhys) matched because gina appears in rhys's own parent set, and
  // !minorOf(rhys) was true because he is not on the minors list. "A guardian of the person named" and "a
  // child of the person named" are the same query when the query is symmetric.
  //
  // WHAT IT LEAKED, stated at its real size rather than inflated: metadata. That the record exists, its
  // d-tag, the session id, the timestamp, and the parent pubkey already in the tag — the body stays sealed
  // under the session key, which rhys does not hold, and everyone involved is one family. It is not a
  // cleartext leak. It is a safeguarding gate that had quietly become a single-list check.
  const mine = await asks(rhys, { kinds: [30078], '#d': [D.CHECKIN + 'r-now-rhys'] });
  assert.equal(mine.length, 1,
    're-anchor: rhys cannot reach his OWN record either, so the refusal below proves nothing about direction');
  const sibling = await asks(rhys, { kinds: [30078], '#d': [D.CHECKIN + 'r-now-gina'] });
  assert.deepEqual(sibling, [],
    'a second child of the same parent — present in guardians: and NOT in minors: — was served the family\'s ' +
    'other check-in record. The gate asked "is this pubkey LINKED to the one named", which matches a sibling ' +
    'as readily as a parent, and minorOf() was the only thing left standing between them.');
  const stranger = await asks(rhys, { kinds: [30078], '#d': [D.CHECKIN + 'r-now-hank'] });
  assert.deepEqual(stranger, [], 'and another family\'s record reached him too');
  // AND THE PARENT KEEPS WHAT SHE MUST HAVE. A refusal that also refused gina would "fix" this by breaking
  // the feature. §8 of the design is the standing rule here: an honest refusal beats a silent wrong answer,
  // but a gate that locks a parent out of her own child's record is neither — it is the leak fixed by
  // breaking the thing the leak was in.
  assert.equal((await asks(gina, { kinds: [30078], '#d': [D.CHECKIN + 'r-now-rhys'] })).length, 1,
    'the direction fix locked a mother out of her own child\'s check-in record');
});

// ── THE CHURCH'S CHOICE OF LIFETIME, ENFORCED BY THE RELAY ────────────────────────────────────────────────
// Owner, 2026-09-09: "we need to be able to make it as flexible as possible, giving control over expiry etc
// where possible by a steward." The arithmetic of each shape is unit-tested in checkin-role-source.test.mjs
// where the clock is a parameter. These are the half that only a live relay can answer: does the box actually
// honour what the church chose, and does revocation beat it.

test('a DAY grant outlives a session, and still ends — the relay honours the church\'s choice', async () => {
  const t = now();
  // a day grant whose window has already run out: the church chose "the whole of that day", and the day is over
  await publishAs(church, grant('svc-yday', [ella.pub], t - 20 * 3600, t - 60, KEY_LAST, { lifetime: 'day' }));
  await sleep(150);
  assert.equal((await publishAs(ella, checkin(ella, 'r-yday', 'svc-yday', gina.pub, KEY_LAST)))[0], false,
    'a DAY grant kept working after its day ended');
  // and one still inside its day works, which is what stops the test above passing for the wrong reason
  await publishAs(church, grant('svc-today', [ella.pub], t - 6 * 3600, t + 6 * 3600, KEY_LAST, { lifetime: 'day' }));
  await sleep(150);
  assert.equal((await publishAs(ella, checkin(ella, 'r-today', 'svc-today', gina.pub, KEY_LAST)))[0], true,
    'a DAY grant did not work during its own day — a church that chose it got nothing');
});

test('AN OPEN-ENDED CLEARANCE DOES NOT EXPIRE — AND THE KEY STILL DOES. The two halves, apart', async () => {
  // THIS TEST REPLACED "an OPEN-ENDED grant does not expire" ON 2026-09-09, and the replacement is the whole
  // restructure in one assertion. There USED to be an open-ended SESSION KEY: a church choosing "until a
  // steward ends it" got an envelope with no `until` at all, which is a standing key to the children's
  // register with a session-shaped name. Under automatic issuance that is worse, not better — nobody clicks it
  // into existence.
  //
  // So the open-ended shape moved to the CLEARANCE, which carries no key. ella is cleared open-endedly, and her
  // KEY for a given morning still ends when that morning does.
  const t = now();
  await publishAs(church, grant('svc-open', [ella.pub], t - 6 * 3600, t + 6 * 3600, KEY_LAST, { lifetime: 'day' }));
  await sleep(150);
  assert.equal((await publishAs(ella, checkin(ella, 'r-open', 'svc-open', gina.pub, KEY_LAST)))[0], true,
    'a helper cleared "until a steward ends it" could not work during her own session — a clearance that never ' +
    'expires must still admit her while a key is live');
  await send(w, checkin(church, 'r-open-church', 'svc-open', gina.pub, KEY_LAST));
  await sleep(150);
  assert.equal((await asks(ella, { kinds: [30078], '#d': [D.CHECKIN + 'r-open-church'] })).length, 1,
    'an open-endedly cleared helper cannot read the register she is meant to be running');
  // AND THE RELAY REFUSES TO STORE AN OPEN-ENDED KEY AT ALL, under any lifetime, from the church's own key.
  // Asserted rather than assumed, because the shape used to be legal and the refusal is what removed it.
  const raw = (life) => {
    const body = { session: 'svc-forever', source: GRANT_SOURCE, lifetime: life, from: t - 600, until: null,
      pubs: [ella.pub], keys: { [ella.pub]: 'ct' } };
    return finalizeEvent({ kind: 30078, created_at: t,
      tags: [['d', D.CHECKINHELPER + 'svc-forever'], ['t', NET], ['church', church.pub]], content: JSON.stringify(body) }, church.sk);
  };
  for (const life of [...Object.keys(HELPER_LIFETIMES), 'open']) {
    assert.equal((await publishAs(church, raw(life)))[0], false,
      'the relay stored a session key with NO END under lifetime=' + life + '. That is a standing key to the ' +
      'children\'s register, and since 2026-09-09 it is minted by machinery rather than by a steward.');
  }
  await sleep(150);
  assert.equal((await publishAs(ella, checkin(ella, 'r-forever', 'svc-forever', gina.pub, KEY_LAST)))[0], false,
    'a refused open-ended envelope admitted somebody anyway');
});

test('REVOCATION BEATS A LIFETIME THAT HAS NOT RUN OUT — the session standing down', async () => {
  // The case the owner named: "somebody leaving under a cloud is precisely when the rota is the wrong source
  // of truth, and waiting for a turn to expire is not an answer."
  const tomb = finalizeEvent({ kind: 30078, created_at: now() + 5,
    tags: [['d', D.CHECKINHELPER + 'svc-open'], ['t', NET], ['church', church.pub], ['deleted', '1']], content: '' }, church.sk);
  assert.equal((await publishAs(church, tomb))[0], true, 'the church cannot stand a session down');
  await sleep(200);
  assert.equal((await publishAs(ella, checkin(ella, 'r-open2', 'svc-open', gina.pub, KEY_LAST)))[0], false,
    'a revoked helper kept writing to the children\'s register hours before the window would have closed');
  assert.deepEqual(await asks(ella, { kinds: [30078], '#d': [D.CHECKIN + 'r-open-church'] }), [],
    'a revoked helper was still served the register — records written by the church, by a steward, and by any ' +
    'other helper must all stop the moment the grant is revoked');
  // THE HONEST RESIDUAL, asserted rather than glossed. canRead()'s FIRST rule is "your own event is always
  // readable by you" (gateway.mjs, above the public allowlist) — it exists because the MyData documents carry no
  // church tag and nothing else could authorise them, and it runs before every d-tag rule in the function. So a
  // revoked helper can still fetch back the records THEY THEMSELVES wrote, and they still hold that session's
  // key, so they can still open those.
  //
  // WHAT REVOCATION DOES AND DOES NOT DO, therefore: it stops them writing, and it stops them reading anything
  // written by anyone else, at once. It does not retract their own entries from them. That is the same shape as
  // rotateCapKey's stated limit ("rotation protects the FUTURE, not the past") and as the departed treasurer
  // keeping their own ledger entries. Changing it means changing a rule fifteen document types depend on, which
  // is not this slice's to do — but it must be written down, because a screen that says "access removed" while
  // this is true would be telling a safeguarding lead something false.
  assert.equal((await asks(ella, { kinds: [30078], '#d': [D.CHECKIN + 'r-open'] })).length, 1,
    're-anchor: an author can no longer read their own event. If that is now 0 the rule above changed, which is ' +
    'a TIGHTENING and probably good — but the comment is then stale and fifteen other document types moved with it');
  // the same, for a lifetime that WOULD have run out on its own but has not yet
  const tomb2 = finalizeEvent({ kind: 30078, created_at: now() + 5,
    tags: [['d', D.CHECKINHELPER + 'svc-today'], ['t', NET], ['church', church.pub], ['deleted', '1']], content: '' }, church.sk);
  assert.equal((await publishAs(church, tomb2))[0], true);
  await sleep(200);
  assert.equal((await publishAs(ella, checkin(ella, 'r-today2', 'svc-today', gina.pub, KEY_LAST)))[0], false,
    'revocation did not beat a DAY lifetime with hours left to run');
});

test('NO CONFIGURATION CHANGES WHAT THE KEY OPENS — every lifetime, every clearance shape, live', async () => {
  // THE INVARIANT, asserted where it can actually be broken. Flexibility is WHEN and WHO. If any combination of
  // settings widened what a helper can reach, this is where it shows — and it is checked against every shape
  // the product offers, not only the default, because the August failure was a configuration nobody tested.
  //
  // THE MATRIX CHANGED SHAPE ON 2026-09-09 and grew rather than shrank. The envelope's `source` is pinned now,
  // so it is no longer an axis; the CLEARANCE's lifetime is a new one, and it is the axis that matters more,
  // because it is the setting a steward will actually touch.
  const t = now();
  let n = 0;
  for (const life of Object.keys(HELPER_LIFETIMES)) {
    for (const clearance of Object.keys(PERMISSION_LIFETIMES)) {
      const sid = `inv-${clearance}-${life}`;
      // NOT A MEMBER OF THE CONGREGATION, deliberately and for the reason the FINANCE test states: a helper who
      // is ALSO an ordinary member reads a church's member-visible documents BECAUSE they are a member, and
      // asserting otherwise would measure the wrong thing. What must be true is that the CLEARANCE and the
      // ENVELOPE together confer nothing beyond one session's register — so this actor has nothing else at all.
      const who = K();
      // the clearance, in the shape under test — each one arranged to be LIVE right now, or the refusals
      // below would pass because nobody was cleared at all
      const pOpts = clearance === 'day'
        ? { lifetime: 'day', from: t - 3600, until: t + 3600 }
        : clearance === 'dated' ? { lifetime: 'dated', from: t - 3600, until: t + 300 * 86400 }
        : { lifetime: 'open', from: t - 3600, until: null };
      assert.equal((await publishAs(church, permission(who, pOpts)))[0], true,
        `the relay refused an ordinary ${clearance} clearance, so this configuration is untested`);
      const until = t + (life === 'day' ? 6 * 3600 : 3600);
      const [ok] = await publishAs(church, grant(sid, [who.pub], t - 600, until, KEY_NOW, { lifetime: life }));
      assert.equal(ok, true, `the relay refused an ordinary ${life} envelope, so this configuration is untested`);
      await sleep(120);
      // the pair is LIVE — proved, so that the refusals below cannot pass because nothing was granted at all
      assert.equal((await publishAs(who, checkin(who, 'r-' + sid, sid, hank.pub, KEY_NOW)))[0], true,
        `re-anchor: the ${clearance}/${life} pair is not live, so every refusal below proves nothing`);
      for (const [what, filter] of [
        ['the safeguarding register', { kinds: [30078], '#d': [D.MINORS + church.pub] }],
        ['the guardian map', { kinds: [30078], '#d': [D.GUARDIANS + church.pub] }],
        ['the church ledger', { kinds: [30078], '#d': [D.FIN_JOURNAL + '1'] }],
        ['a private ask for help', { kinds: [30078], '#d': [D.CAREREQ + cara.pub.slice(0, 16) + '-r1'] }],
        ['the steward roster', { kinds: [30078], '#d': [D.STEWARDS + church.pub] }],
        ['another session\'s key', { kinds: [30078], '#d': [D.CHECKINHELPER + S_NOW] }],
        ['somebody else\'s clearance', { kinds: [30078], '#d': [D.CHECKINPERM + ada.pub] }],
      ]) {
        assert.deepEqual(await asks(who, filter), [],
          `with clearance=${clearance} and lifetime=${life}, a check-in helper reached ${what} — a setting has ` +
          'changed WHAT the key opens, which no setting may ever do');
      }
      const env = await asks(who, { kinds: [30078], '#d': [D.CHECKINKEY + church.pub] });
      for (const e of env) assert.equal(JSON.parse(e.content).keys[who.pub], undefined,
        `with clearance=${clearance} and lifetime=${life}, the helper was given the CHURCH-WIDE register key`);
      n++;
    }
  }
  assert.equal(n, Object.keys(HELPER_LIFETIMES).length * Object.keys(PERMISSION_LIFETIMES).length,
    're-anchor: not every configuration was exercised');
});

// ══ THE PERMISSION: THE HALF THAT SAYS WHO ════════════════════════════════════════════════════════════════
// reference/FINDING-CHECKIN-GRANTS-SHOULD-BE-PER-PERSON-2026-09-09.md, the owner's DECIDED block. Everything
// here is driven against the live relay, and the assertions that matter are refusals.

test('AN ENVELOPE ALONE ADMITS NOBODY — the conjunction, which is what makes ONE revocation enough', async () => {
  // nella is named in an envelope and holds the key wrapped to her. She has NO clearance.
  //
  // WHY THE RELAY REQUIRES BOTH. Session keys are issued automatically and ahead of time, so if the envelope
  // alone admitted, withdrawing somebody's clearance on Tuesday would leave every envelope already minted for
  // the next fortnight still admitting them — and a steward would have to hunt down one document per Sunday,
  // which is exactly the chore this restructure deleted.
  //
  // ITS OWN SESSION, MINTED HERE, AND THAT IS NOT TIDINESS. This test used nella's slot on `svc-now` — and the
  // stale-replay test earlier in this file REPLACES that envelope with one naming only ada, so by the time this
  // ran nella was refused for not being on the envelope at all and the clearance check was never reached.
  // Measured by sabotage on 2026-09-09: with `checkinPermitted` forced to return true for somebody who has no
  // clearance record, this test stayed GREEN. A fresh envelope makes the missing clearance the only thing that
  // can be refusing her.
  const tc = now();
  assert.equal((await publishAs(church, grant(S_CONJ, [ada.pub, nella.pub], tc - 600, tc + 3600, KEY_NOW)))[0], true,
    'the church could not mint the envelope this test turns on');
  await sleep(200);
  assert.equal((await asks(ada, { kinds: [30078], '#d': [D.CHECKINHELPER + S_CONJ] })).length, 1,
    're-anchor: nobody at all is served this envelope, so nella\'s refusal below proves nothing');
  const env = await asks(nella, { kinds: [30078], '#d': [D.CHECKINHELPER + S_CONJ] });
  assert.deepEqual(env, [],
    'somebody named in an envelope but cleared by nobody was handed this session\'s key. Being on a document ' +
    'the church minted last month is not the same as being cleared today.');
  assert.equal((await publishAs(nella, checkin(nella, 'r-conj-nella', S_CONJ, gina.pub, KEY_NOW)))[0], false,
    'an uncleared person named in an envelope wrote into the children\'s register');
  // AND IT ONLY NARROWS. ada is on the SAME envelope and IS cleared, so the conjunction has not simply broken
  // the feature — which is the way a refusal like this usually passes for the wrong reason.
  assert.equal((await publishAs(ada, checkin(ada, 'r-conj-ada', S_CONJ, gina.pub, KEY_NOW)))[0], true,
    'the cleared helper on the same envelope was refused too, so the refusal above is the session failing ' +
    'rather than the clearance being required');
  await sleep(150);
  assert.deepEqual(await asks(nella, { kinds: [30078], '#d': [D.CHECKIN + 'r-conj-ada'] }), [],
    'an uncleared person named in an envelope was served the register');
});

test('A CLEARANCE THAT HAS NOT OPENED YET CLEARS NOBODY', async () => {
  // zoe is cleared FROM NEXT MONTH and is named on svc-soon's envelope. Granting a January clearance in
  // December is an ordinary thing for a church to do, and it must admit nobody until January.
  assert.deepEqual(await asks(zoe, { kinds: [30078], '#d': [D.CHECKINHELPER + S_SOON] }), [],
    'a clearance that starts next month handed somebody a session key today');
  assert.equal((await publishAs(zoe, checkin(zoe, 'r-soon-zoe', S_SOON, gina.pub, KEY_SOON)))[0], false,
    'a clearance that starts next month admitted somebody today');
  // and the church's own record of her clearance IS there, so this is not passing because nothing was published
  assert.equal((await asks(church, { kinds: [30078], '#d': [D.CHECKINPERM + zoe.pub] })).length, 1,
    're-anchor: zoe has no clearance document at all, so the refusals above prove nothing');
});

test('THE CLEARANCE IS NOT SERVED TO THE CONGREGATION — it names the church\'s cleared team', async () => {
  // The same reasoning, at the same size, as the grant. A church that narrowed its rota visibility said the
  // congregation does not get to see who serves; a second, ungated document naming everyone cleared for
  // children's work takes that back without telling anybody.
  assert.deepEqual(await asks(cara, { kinds: [30078], '#d': [D.CHECKINPERM + ada.pub] }), [],
    'an ordinary member was served another member\'s check-in clearance — the church\'s cleared safeguarding ' +
    'team, published to the whole congregation through a document no settings page knows exists');
  assert.deepEqual(await asks(dan, { kinds: [30078], '#d': [D.CHECKINPERM + ada.pub] }), [],
    'a check-in helper was served ANOTHER helper\'s clearance');
  assert.deepEqual(await asks(gina, { kinds: [30078], '#d': [D.CHECKINPERM + ada.pub] }), [],
    'a parent was served the list of who the church has cleared');
  // AND THE PEOPLE WHO MUST HAVE IT STILL DO, or this "fix" would hide a clearance from the person it clears.
  assert.equal((await asks(ada, { kinds: [30078], '#d': [D.CHECKINPERM + ada.pub] })).length, 1,
    'a cleared helper cannot read her own clearance — her screen has no way to say when it ends');
  assert.equal((await asks(church, { kinds: [30078], '#d': [D.CHECKINPERM + ada.pub] })).length, 1,
    'the church cannot read the clearance it granted');
  assert.equal((await asks(sgLead, { kinds: [30078], '#d': [D.CHECKINPERM + ada.pub] })).length, 1,
    'the safeguarding lead cannot see who the church has cleared');
  // NARROWED 2026-09-11, and the note this replaces said the opposite: "HONESTY, not an endorsement… canRead's
  // privileged short-circuit admits stewardCan(authed, cp, 'any'), which any single capability satisfies.
  // Narrowing that is a change to a grant fourteen other rules share and is not this slice's to make." It was
  // narrowed without touching that grant — the check-in documents are decided BEFORE the short-circuit now.
  // A clearance IS the church's cleared safeguarding team, one person at a time, so a treasurer reading it is
  // the same disclosure the line four above withholds from a parent.
  assert.deepEqual(await asks(treasurer, { kinds: [30078], '#d': [D.CHECKINPERM + ada.pub] }), [],
    'a steward ticked for Finance alone was served a clearance — the church\'s cleared safeguarding team');
  // AND A NON-MEMBER HELPER READS HIS OWN, because the grant is his whole authority — he may never have joined
  // the congregation at all.
  assert.equal((await asks(dan, { kinds: [30078], '#d': [D.CHECKINPERM + dan.pub] })).length, 1,
    'a helper who is not a member of the congregation cannot read his own clearance');
});

// RENAMED AND NARROWED 2026-09-10, and the old title is kept here rather than deleted (CLAUDE.md rules 4
// and 8). It was 'NOBODY BUT THE CHURCH KEY MAY CLEAR ANYBODY — not a member, not even the safeguarding
// lead', and it included `sgLead` in the loop below on this reasoning:
//
//     "THE SHARPER OF THE TWO MINTS, and the one that most needed deciding. A safeguarding steward can
//      already READ the whole register; what they must not gain is the power to say who ELSE may. Since
//      2026-09-09 this document is the ONLY thing that says it, so widening it here would make widening the
//      envelope a formality. Owner-only is also the only direction that can be relaxed later."
//
// THE OWNER RELAXED IT, in its own commit, and every refusal that now bounds it is asserted in
// scripts/checkin-permission-mint-widening.test.mjs — including, at greater length than here, a co-tenant
// church's steward and an UNSCOPED steward, neither of whom this file has an actor for.
//
// The last sentence of that comment was the good one and it held: relaxing was a one-line change with a
// test. The "formality" sentence was wrong and is corrected where the rule lives — the session key is
// wrapped with the CHURCH key, so widening the envelope is not a formality, it is impossible without it.
//
// WHAT IS ASSERTED HERE NOW is the part that did not change: a clearance is not something an ordinary
// member, a helper, or a steward ticked for something else can write.
test('A MEMBER, A HELPER AND A FINANCE STEWARD STILL MAY NOT CLEAR ANYBODY', async () => {
  for (const who of [cara, ada, treasurer]) {
    assert.equal((await publishAs(who, permission(cara, { by: who })))[0], false,
      'somebody with no safeguarding tick cleared a person for the children\'s register');
  }
  // AND THE ONE THAT DID CHANGE, asserted so this file cannot be read as still claiming otherwise: the
  // church's own safeguarding steward MAY, and the relay enforces it.
  assert.equal((await publishAs(sgLead, permission(ella, { by: sgLead })))[0], true,
    'the safeguarding steward cannot clear anybody — the 2026-09-10 widening is not in effect here');
  await sleep(150);
  assert.equal((await publishAs(cara, checkin(cara, 'r-now-cara2', S_NOW, gina.pub, KEY_NOW)))[0], false,
    'a refused clearance admitted somebody anyway');
  assert.deepEqual(await asks(church, { kinds: [30078], '#d': [D.CHECKINPERM + cara.pub] }), [],
    'a forged clearance was stored — an ordinary member is now on the church\'s cleared list');
});

test('A CLEARANCE THE RELAY CANNOT VOUCH FOR INSTALLS NOTHING — never an unbounded one', async () => {
  const t = now();
  const raw = (mangle) => {
    const body = { person: ella.pub, source: 'steward', lifetime: 'dated', from: t - 60, until: t + 300 * 86400 };
    mangle(body);
    return finalizeEvent({ kind: 30078, created_at: t,
      tags: [['d', D.CHECKINPERM + ella.pub], ['t', NET], ['church', church.pub]], content: JSON.stringify(body) }, church.sk);
  };
  assert.equal((await publishAs(church, raw(b => { b.until = null; })))[0], false,
    'the relay stored a DATED clearance with no end — "cleared until the 4th" became "cleared for ever"');
  assert.equal((await publishAs(church, raw(b => { b.until = b.from + 401 * 86400; })))[0], false,
    'the relay stored a clearance past the cap the lifetime it declares carries');
  assert.equal((await publishAs(church, raw(b => { b.until = b.from - 1; })))[0], false,
    'the relay stored a clearance that closes before it opens');
  assert.equal((await publishAs(church, raw(b => { b.source = 'invented'; })))[0], false,
    'a clearance claimed a provenance this build has never implemented');
  assert.equal((await publishAs(church, raw(b => { b.source = GRANT_SOURCE; })))[0], false,
    'a clearance cited the clearances as its own provenance — a loop in a safeguarding record');
  assert.equal((await publishAs(church, raw(b => { b.person = zoe.pub; })))[0], false,
    'a clearance whose d-tag and body name DIFFERENT people was stored — the d-tag is what every lookup uses, ' +
    'so that clears the wrong person');
  assert.equal((await publishAs(church, raw(b => { b.lifetime = 'session'; })))[0], false,
    'a SESSION KEY lifetime was accepted for a clearance');
  // AND ONE SPELLING OF THE D-TAG ONLY. Two spellings of the same suffix would be two addressable documents
  // writing one map entry — a name the relay gates under one form and a client publishes under another.
  //
  // WHAT THIS ASSERTS AND WHAT IT DOES NOT: it proves the npub-spelled document is refused. It does NOT
  // isolate WHICH rule refuses it — measured by sabotage on 2026-09-09, removing the explicit 64-hex pin in
  // accept() changed no result here, because the parser already requires a 64-hex `person` and the gate
  // requires it to equal the suffix. The outcome is what matters and is what is claimed.
  const npubD = finalizeEvent({ kind: 30078, created_at: t,
    tags: [['d', D.CHECKINPERM + npubEncode(ella.pub)], ['t', NET], ['church', church.pub]],
    content: JSON.stringify({ person: ella.pub, source: 'steward', lifetime: 'open', from: t - 60, until: null }) }, church.sk);
  assert.equal((await publishAs(church, npubD))[0], false,
    'a clearance was stored under an npub-spelled d-tag. Every lookup keys on that suffix, so the same person ' +
    'would then have two clearance documents and one map entry — a name gated under one spelling and published ' +
    'under another.');
  // AND THE ORDINARY ONE STILL LANDS, or every refusal above passes because the relay refuses everything
  assert.equal((await publishAs(church, raw(() => {})))[0], true,
    're-anchor: the relay refuses an ordinary clearance too, so nothing above proves anything');
});

test('A HELPER CANNOT REACH BACKWARDS OR FAR FORWARDS FOR A KEY', async () => {
  // THE BLAST RADIUS THE OWNER PAID MACHINERY FOR. Session keys are issued automatically and ahead of time; the
  // relay independently bounds which of them a named helper may FETCH, so a phone belonging to somebody cleared
  // for the year cannot collect the year's keys in one REQ.
  //
  // BACKWARDS: ben is cleared and is named on last week's envelope, which has closed. Its records are
  // window-gated anyway, so refusing the key costs him nothing and denies an offline phone a year of catching up.
  assert.deepEqual(await asks(ben, { kinds: [30078], '#d': [D.CHECKINHELPER + S_LAST] }), [],
    'a cleared helper was handed the key to a session that has already ended. A phone that was off all year ' +
    'could come back and collect every past envelope in one request.');
  // FORWARDS: ada is cleared and is named on a session a MONTH out, which is beyond KEY_LEAD_SECONDS.
  assert.deepEqual(await asks(ada, { kinds: [30078], '#d': [D.CHECKINHELPER + S_FAR] }), [],
    'a cleared helper was handed the key to a session a month away. A console that issued a year ahead would ' +
    'then have put a year of session keys within reach of one phone.');
  // AND EARLY FETCH STILL WORKS, which is how a Sunday actually starts — svc-soon opens in an hour.
  assert.equal((await asks(ada, { kinds: [30078], '#d': [D.CHECKINHELPER + S_SOON] })).length, 1,
    'a helper can no longer fetch her key before her session opens. Ten minutes early is how a Sunday starts, ' +
    'and refusing it looks like an empty room rather than a gate.');
  assert.ok(KEY_LEAD_SECONDS < 30 * 86400 && KEY_LEAD_SECONDS > 3600,
    're-anchor: the lead is no longer between an hour and a month, so the two cases above are not what they say');
});

test('…AND AN UNFILTERED QUERY RETURNS ONLY THAT HELPER\'S OWN SESSION', async () => {
  // THE TEST THE d-TAG SWEEP ABOVE CANNOT BE: a refusal per named document proves nothing about the document
  // nobody named. This asks for EVERYTHING and reads what comes back.
  const got = await asks(dan, { kinds: [30078], limit: 500 });
  const ds = got.map(e => (e.tags.find(t => t[0] === 'd') || [])[1] || '');
  for (const d of ds) {
    const ownEvent = got.find(e => (e.tags.find(t => t[0] === 'd') || [])[1] === d).pubkey === dan.pub;
    const isThisSession = d === D.CHECKINHELPER + S_NOW || d === D.CHECKINPERM + dan.pub ||
      (d.startsWith(D.CHECKIN) && !d.startsWith(D.CHECKINHELPER) && !d.startsWith(D.CHECKINPERM));
    assert.ok(ownEvent || isThisSession,
      'an unfiltered query as a check-in helper returned `' + d + '` — a document outside this session\'s ' +
      'register reached somebody whose whole authority is one session\'s grant');
  }
  // and the check-in records that DID come back are this session's, not every session's
  for (const e of got) {
    const d = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
    if (!d.startsWith(D.CHECKIN) || d.startsWith(D.CHECKINHELPER) || d.startsWith(D.CHECKINPERM)) continue;
    if (e.pubkey === dan.pub) continue;                       // his own events, by canRead's first rule
    assert.equal((e.tags.find(t => t[0] === 'session') || [])[1], S_NOW,
      'a helper was served a check-in record from a session he does not hold: ' + d);
  }
  assert.ok(got.length > 0, 're-anchor: an unfiltered query returned nothing at all, so this proves nothing');
});

test('NOTHING BLOCKS A CHECK-IN: the church and its safeguarding lead need no clearance at all', async () => {
  // reference/DOMAIN.md, "Check-in supports a safeguarded church; it does not enforce safeguarding": a ratio
  // outside policy, a lapsed clearance, a gap in the rota — none of these may stop a child being checked in.
  //
  // NEITHER THE CHURCH NOR THE SAFEGUARDING LEAD HAS A `checkinperm:` DOCUMENT. The conjunction added on
  // 2026-09-09 must not have reached them: their authority is the church key and the steward roster, and the
  // desk must work on a morning when nobody has cleared anybody.
  assert.deepEqual(await asks(church, { kinds: [30078], '#d': [D.CHECKINPERM + sgLead.pub] }), [],
    're-anchor: the safeguarding lead HAS a clearance document, so the writes below prove nothing about ' +
    'whether the new gate reached her');
  assert.equal((await publishAs(church, checkin(church, 'r-noblock-church', S_TWO, gina.pub, KEY_TWO)))[0], true,
    'the church cannot check a child in without clearing itself first');
  assert.equal((await publishAs(sgLead, checkin(sgLead, 'r-noblock-sg', S_TWO, gina.pub, KEY_TWO)))[0], true,
    'a safeguarding steward was refused the register because nobody had granted her a check-in clearance. The ' +
    'permission layer must ADD a route for volunteers, never gate the people who already hold the register.');
  await sleep(150);
  assert.equal((await asks(sgLead, { kinds: [30078], '#d': [D.CHECKIN + 'r-noblock-church'] })).length, 1,
    'the safeguarding lead cannot read the register without a clearance of her own');
  assert.equal((await asks(gina, { kinds: [30078], '#d': [D.CHECKIN + 'r-noblock-church'] })).length, 1,
    'a parent cannot see her own child\'s check-in because of the new gate — nothing about a helper\'s ' +
    'clearance may reach the guardian route');
});

test('WITHDRAWING ONE CLEARANCE ENDS EVERY SESSION AT ONCE, AND SURVIVES A RESTART', async () => {
  // THE POINT OF THE RESTRUCTURE, asserted at the relay. Under the old model "remove this person" meant one
  // tombstone per service, for every service already minted. Here it is one document, and it must take effect
  // immediately, on every session, and still be true after the reboot that re-derives everything from disk.
  //
  // Kept near the end: it removes ada, whom the tests above depend on.
  // A SECOND CLEARED HELPER ON THE SAME ENVELOPE, so that "one person's withdrawal" can be told apart from
  // "the session stopped working". S_NOW names only ada by now — the stale-replay test above removed dan from
  // it — so the pair is arranged here rather than assumed.
  const t0 = now();
  await publishAs(church, grant(S_TWO, [ada.pub, ella.pub], t0 - 600, t0 + 3600, KEY_TWO, { at: t0 + 1 }));
  await sleep(200);
  const liveNow = (await publishAs(ada, checkin(ada, 'r-rev-a', S_NOW, gina.pub, KEY_NOW)))[0];
  const liveTwo = (await publishAs(ada, checkin(ada, 'r-rev-b', S_TWO, gina.pub, KEY_TWO)))[0];
  const liveElla = (await publishAs(ella, checkin(ella, 'r-rev-x', S_TWO, hank.pub, KEY_TWO)))[0];
  assert.equal(liveNow, true, 're-anchor: ada is not a live helper on svc-now, so the refusal below proves nothing');
  assert.equal(liveTwo, true, 're-anchor: ada is not a live helper on svc-two, so "every session" has nothing to bite on');
  assert.equal(liveElla, true, 're-anchor: the second helper is not live either, so "everybody else" proves nothing');

  assert.equal((await publishAs(church, unpermission(ada)))[0], true, 'the church cannot withdraw a clearance');
  await sleep(250);

  assert.equal((await publishAs(ada, checkin(ada, 'r-rev-c', S_NOW, gina.pub, KEY_NOW)))[0], false,
    'a withdrawn clearance kept working on the session she was already serving');
  assert.equal((await publishAs(ada, checkin(ada, 'r-rev-d', S_TWO, gina.pub, KEY_TWO)))[0], false,
    'a withdrawn clearance kept working on a SECOND live session. One withdrawal must end every session at ' +
    'once, or the steward is back to hunting down one document per Sunday — which is the chore this ' +
    'restructure exists to delete.');
  assert.deepEqual(await asks(ada, { kinds: [30078], '#d': [D.CHECKIN + 'r-noblock-church'] }), [],
    'a withdrawn helper was still served the register');
  assert.deepEqual(await asks(ada, { kinds: [30078], '#d': [D.CHECKINHELPER + S_NOW] }), [],
    'a withdrawn helper was still handed this session\'s key — the envelope still names her, and being named ' +
    'on a document the church minted last month is not being cleared today');
  // AND THE OTHER HELPER ON THE SAME ENVELOPE IS UNTOUCHED, or this "works" by breaking the session.
  assert.equal((await publishAs(ella, checkin(ella, 'r-rev-e', S_TWO, hank.pub, KEY_TWO)))[0], true,
    'withdrawing one person\'s clearance stopped everybody else on the same envelope');

  await restart();

  assert.equal((await publishAs(ada, checkin(ada, 'r-rev-f', S_NOW, gina.pub, KEY_NOW)))[0], false,
    'A RESTART PUT A WITHDRAWN HELPER BACK ON THE CHILDREN\'S REGISTER. The live map and the stored corpus ' +
    'disagree, so the withdrawal was only ever true until the next reboot — and this relay reboots itself.');
  assert.equal((await publishAs(ada, checkin(ada, 'r-rev-g', S_TWO, gina.pub, KEY_TWO)))[0], false,
    'and on the second session too');
  assert.deepEqual(await asks(ada, { kinds: [30078], '#d': [D.CHECKINHELPER + S_NOW] }), [],
    'a restart handed a withdrawn helper the session key again');
  assert.equal((await publishAs(ella, checkin(ella, 'r-rev-h', S_TWO, hank.pub, KEY_TWO)))[0], true,
    'the restart took the register away from the helper who is still cleared — the creche goes down on reboot');
  assert.equal((await publishAs(sgLead, checkin(sgLead, 'r-rev-i', S_NOW, gina.pub, KEY_NOW)))[0], true,
    'the restart took the register away from the safeguarding lead');
});

test('AN OLDER TOMBSTONE REPLAYED DOES NOT UNDO A CLEARANCE GRANTED AFTER IT', async () => {
  // The sibling of the grant's stale-replay test, and it matters more here: this document is what the whole
  // feature now turns on. A copy arriving from a rehydrate or a peer sync carries its ORIGINAL created_at
  // inside the signature and cannot be handed a fresher one.
  // TIMESTAMPS CHOSEN, NOT TAKEN FROM THE CLOCK. The test above withdrew ada's clearance a few seconds into
  // the future (a tombstone must beat the document it revokes), so a re-clearance stamped `now()` would be
  // refused by event-store as stale and this test would prove nothing about replays. `t` is comfortably newer
  // than that withdrawal and well inside the +900s the store accepts.
  const t = now() + 120;
  assert.equal((await publishAs(church, permission(ada, { at: t })))[0], true, 'the church cannot re-clear somebody');
  await sleep(200);
  assert.equal((await publishAs(ada, checkin(ada, 'r-re-a', S_NOW, gina.pub, KEY_NOW)))[0], true,
    're-anchor: re-clearing ada did not work, so the replay below proves nothing');
  // REFUSED A LAYER BELOW THE INGEST, and that is the protection rather than a quirk. event-store's put()
  // compares created_at before note() ever runs, so a stale tombstone never reaches the map at all — which is
  // also why it cannot be undone by a restart. The OK is `false`, and a test asserting `true` here would have
  // been asserting that the relay swallowed a stale replay.
  assert.equal((await publishAs(church, unpermission(ada, t - 60)))[0], false,
    'the relay STORED a withdrawal older than the clearance already on disk. Every replay from a rehydrate or ' +
    'a peer sync now gets a second chance to take a clearance away.');
  await sleep(200);
  assert.equal((await publishAs(ada, checkin(ada, 'r-re-b', S_NOW, gina.pub, KEY_NOW)))[0], true,
    'an OLDER withdrawal replayed after a newer clearance took the clearance away. A stale copy from a ' +
    'rehydrate must not undo a decision the church made after it.');
});


// ── STANDING THE SESSION DOWN ─────────────────────────────────────────────────────────────────────────────

test('the church can end a session early, and it takes effect at once', async () => {
  // Kept LAST: it removes the grant every test above depends on.
  const tomb = finalizeEvent({ kind: 30078, created_at: now() + 10,
    tags: [['d', D.CHECKINHELPER + S_NOW], ['t', NET], ['church', church.pub], ['deleted', '1']], content: '' }, church.sk);
  assert.equal((await publishAs(church, tomb))[0], true, 'the church cannot stand its own session down');
  await sleep(200);
  assert.equal((await publishAs(ada, checkin(ada, 'r-after-revoke', S_NOW, gina.pub, KEY_NOW)))[0], false,
    'a helper kept writing to the register after the church revoked the session');
  assert.deepEqual(await asks(ada, { kinds: [30078], '#d': [D.CHECKIN + 'r-now-gina'] }), [],
    'a revoked helper was still served the register');
  // and the safeguarding lead is untouched by it
  assert.equal((await asks(sgLead, { kinds: [30078], '#d': [D.CHECKIN + 'r-now-gina'] })).length, 1,
    'revoking a session grant took the register away from the safeguarding lead as well');
});

// ── THE SWEEP. KEPT LAST ON PURPOSE ───────────────────────────────────────────────────────────────────────
// It PLANTS a document at every declared d-tag so that its refusals are measured against things that exist,
// and several of those d-tags are ones the relay gates on (`stewards:`, `joinpolicy:`, `minors:`). Written
// anywhere but the end of this file it would quietly change what every test after it is testing.

test('A HELPER KEY OPENS THE REGISTER AND PROVABLY NOTHING ELSE — every declared document type, swept', async () => {
  // THE NEGATIVE, AT ITS FULL WIDTH. The tests above name the document types somebody thought of; this one asks
  // the registry for ALL of them, so a type added next month is covered the day it lands rather than the day
  // somebody remembers.
  //
  // AND IT IS MEASURED AGAINST DOCUMENTS THAT ARE THERE. A refusal of a d-tag nothing has ever written is not a
  // refusal, it is an empty relay — the vacuous-pass shape this file has been bitten by before. So each type is
  // planted first (as the church, which is allowed to write most of them), and the count of types that actually
  // landed is asserted separately from the count swept.
  //
  // Driven with `dan`, the helper who is NOT a member of the congregation, deliberately: a helper who is also a
  // member reads a church's member-visible documents BECAUSE they are a member, and asserting otherwise would
  // measure the wrong thing. What must be true is that the GRANT confers nothing, which is what dan proves.
  const about = new Set([D.CHECKIN, D.CHECKINHELPER, D.CHECKINPERM]);   // the three this capability IS, tested by name above
  // AND THE TWO THAT ARE PUBLIC BY DESIGN, skipped by reading the registry's own `read` column rather than by a
  // hand-written list, so a type that becomes public later cannot slip through as an exception nobody declared:
  //   • `relay-net` — CLAUDE.md rule 10. The proof that a relay is ours is a document you must read from a relay
  //     you have not yet proved, so gating it means no phone can ever bootstrap. Load-bearing, not a leak.
  //   • `joinpolicy:` — a stranger has to be able to see whether a church is open before they can ask to join.
  // Neither has anything to do with the children's register, and asserting a refusal of them would be asserting
  // that this slice broke the network.
  const publicByDesign = new Set(Object.keys(DOC_TYPES).filter(k => DOC_TYPES[k].read === 'public'));
  assert.equal(publicByDesign.size, 2,
    'the set of PUBLIC document types changed. This test skips them because they are public on purpose; if a ' +
    'third has appeared, it needs its own decision rather than a silent exemption here.');
  let checked = 0, planted = 0, skipped = 0;
  for (const prefix of Object.keys(DOC_TYPES)) {
    if (about.has(prefix)) continue;
    if (publicByDesign.has(prefix)) { skipped++; continue; }
    const dtag = prefix.endsWith(':') ? prefix + church.pub : prefix;
    await publishAs(church, doc(church, dtag, { swept: true }, [['church', church.pub], ['p', church.pub]]));
    const there = (await asks(church, { kinds: [30078], '#d': [dtag] })).length > 0;
    if (there) planted++;
    assert.deepEqual(await asks(dan, { kinds: [30078], '#d': [dtag] }), [],
      'a check-in helper who is not a member of the congregation was served `' + dtag + '`. The grant must ' +
      'confer one session\'s register and nothing else.');
    checked++;
  }
  assert.ok(checked >= 27, 'the registry sweep covered only ' + checked + ' document types. It is meant to be ' +
    'every declared one, and a shrinking count means types stopped being DECLARED rather than stopped leaking.');
  assert.ok(planted >= 27, 'only ' + planted + ' of the ' + checked + ' document types swept actually exist on ' +
    'the relay, so most of the refusals above are refusals of nothing at all — which is the vacuous pass this ' +
    'file exists to avoid');
  assert.equal(skipped, publicByDesign.size, 're-anchor: the public-by-design skip list and what was skipped disagree');
});
