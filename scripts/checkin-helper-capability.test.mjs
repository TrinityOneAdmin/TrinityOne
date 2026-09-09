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
import { buildHelperGrant, HELPER_LIFETIMES, DEFAULT_HELPER_LIFETIME, HELPER_SOURCES } from './checkin-role-source.mjs';
import { D } from './trinity-doc-types.mjs';

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

const S_NOW = 'svc-now', S_LAST = 'svc-last', S_SOON = 'svc-soon';
const KEY_NOW = '11'.repeat(32), KEY_LAST = '22'.repeat(32), KEY_SOON = '33'.repeat(32);

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
  const { doc: body } = buildHelperGrant({ session, source: opts.source || 'rota',
    lifetime: opts.lifetime || DEFAULT_HELPER_LIFETIME, from, until,
    helpers, keepers: [church.pub, sgLead.pub], sessionKeyHex: key,
    wrap: (p, pl) => nip44.encrypt(pl, nip44.utils.getConversationKey(church.sk, p)) });
  if (opts.mangle) opts.mangle(body);
  return finalizeEvent({ kind: 30078, created_at: opts.at || now(),
    tags: [['d', D.CHECKINHELPER + session], ['t', NET], ['church', church.pub], ['session', session]],
    content: JSON.stringify(body) }, church.sk);
};
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
  for (const who of [sgLead, treasurer, ada, ben, cara, gina, hank, teen, rhys]) await send(w, doc(who, D.MEMBER + church.pub, { joined: now() }));
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
  await send(w, grant(S_NOW,  [ada.pub, dan.pub], t - 600, t + 3600, KEY_NOW));
  await send(w, grant(S_LAST, [ben.pub],          t - 8 * 3600, t - 5 * 3600, KEY_LAST));
  await send(w, grant(S_SOON, [ada.pub],          t + 3600, t + 7000, KEY_SOON));
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
  // THE LEDGER, asserted against the NON-MEMBER helper. Measured while writing this file, 2026-09-09, and it
  // is worth writing down because it surprised me: `finance/journal:` has NO read branch in canRead() at all.
  // It falls to the ordinary effective-member rule, so ANY member of the church can already fetch the
  // ledger's ciphertext — while scripts/trinity-doc-types.mjs declares it `read: 'church'`. The entries are
  // church-encrypted, so this is not a plaintext leak; it is the registry describing something the relay does
  // not do, which is exactly the class of gap that registry exists to make visible. NOT this slice's to fix —
  // reported, not changed — and asserted here as it actually is so this test never encodes a false belief.
  assert.deepEqual(await asks(dan, { kinds: [30078], '#d': [D.FIN_JOURNAL + '1'] }), [],
    'a check-in helper who is not a member of the congregation was served the church\'s ledger — the grant ' +
    'must confer nothing beyond one session\'s register');
  assert.equal((await asks(ada, { kinds: [30078], '#d': [D.FIN_JOURNAL + '1'] })).length, 1,
    're-anchor: an ordinary member no longer receives the ledger ciphertext. That is a TIGHTENING and probably ' +
    'right, but it was not decided here, and the note above about the registry is now stale');
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
    const { doc: body } = buildHelperGrant({ session: S_NOW, source: 'rota', lifetime: 'session', from: t - 60, until: t + 600,
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
  assert.deepEqual(JSON.parse(env[0].content).pubs.sort(), [ada.pub, dan.pub].sort(),
    'the church\'s own grant was replaced by a forgery');
});

test('a grant may not be made permanent, nor claim a source nobody implemented', async () => {
  const t = now();
  const bad = (mangle) => {
    const { doc: body } = buildHelperGrant({ session: 'svc-x', source: 'rota', lifetime: 'session', from: t, until: t + 600,
      helpers: [cara.pub], keepers: [], sessionKeyHex: KEY_NOW,
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
  assert.equal((await publishAs(church, bad(b => { b.session = 'svc-somewhere-else'; })))[0], false,
    'a grant whose d-tag and content name different sessions was stored — a grant for a quiet Tuesday would ' +
    'then open the Sunday register');
  await sleep(150);
  assert.equal((await publishAs(cara, checkin(cara, 'r-x-cara', 'svc-x', gina.pub, KEY_NOW)))[0], false,
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

test('a Finance-only steward still receives the ciphertext, exactly as today — named, not fixed', async () => {
  // HONESTY, not an endorsement. canRead's privileged short-circuit admits `stewardCan(authed, cp, 'any')`,
  // which any single capability satisfies, and fourteen other rules share that line. Narrowing it is a change
  // to a grant this slice has no business touching. What the treasurer cannot do is OPEN one — that is
  // checkin-key-separation.test.mjs, and it is the protection that actually holds.
  const got = await asks(treasurer, { kinds: [30078], '#d': [D.CHECKIN + 'r-now-gina'] });
  assert.equal(got.length, 1, 're-anchor: this changed. If it is now 0 that is a TIGHTENING and probably good, ' +
    'but it was not decided here and the comment above is stale');
  assert.throws(() => nip44.decrypt(got[0].content, unhex('44'.repeat(32))),
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
  await publishAs(church, grant('svc-yday', [cara.pub], t - 20 * 3600, t - 60, KEY_LAST, { lifetime: 'day' }));
  await sleep(150);
  assert.equal((await publishAs(cara, checkin(cara, 'r-yday', 'svc-yday', gina.pub, KEY_LAST)))[0], false,
    'a DAY grant kept working after its day ended');
  // and one still inside its day works, which is what stops the test above passing for the wrong reason
  await publishAs(church, grant('svc-today', [cara.pub], t - 6 * 3600, t + 6 * 3600, KEY_LAST, { lifetime: 'day' }));
  await sleep(150);
  assert.equal((await publishAs(cara, checkin(cara, 'r-today', 'svc-today', gina.pub, KEY_LAST)))[0], true,
    'a DAY grant did not work during its own day — a church that chose it got nothing');
});

test('an OPEN-ENDED grant does not expire, because only a steward ends it', async () => {
  const t = now();
  // no `until` at all. The relay stores it ONLY because the grant declares the lifetime whose point that is.
  await publishAs(church, grant('svc-open', [cara.pub], t - 30 * 24 * 3600, null, KEY_LAST, { lifetime: 'open' }));
  await sleep(150);
  assert.equal((await publishAs(cara, checkin(cara, 'r-open', 'svc-open', gina.pub, KEY_LAST)))[0], true,
    'a church that chose "until a steward ends it" had its grant expire on its own — a month later it was ' +
    'already dead, and nobody would find out until a Sunday morning');
  await send(w, checkin(church, 'r-open-church', 'svc-open', gina.pub, KEY_LAST));
  await sleep(150);
  assert.equal((await asks(cara, { kinds: [30078], '#d': [D.CHECKIN + 'r-open-church'] })).length, 1,
    'an open-ended helper cannot read the register they are meant to be running');
});

test('REVOCATION BEATS A LIFETIME THAT HAS NOT RUN OUT — including one that never would', async () => {
  // The case the owner named: "somebody leaving under a cloud is precisely when the rota is the wrong source
  // of truth, and waiting for a turn to expire is not an answer." For the open-ended lifetime this is not one
  // protection among several — it is the ONLY thing that ends access, so it has to be immediate.
  const tomb = finalizeEvent({ kind: 30078, created_at: now() + 5,
    tags: [['d', D.CHECKINHELPER + 'svc-open'], ['t', NET], ['church', church.pub], ['deleted', '1']], content: '' }, church.sk);
  assert.equal((await publishAs(church, tomb))[0], true, 'the church cannot revoke an open-ended grant');
  await sleep(200);
  assert.equal((await publishAs(cara, checkin(cara, 'r-open2', 'svc-open', gina.pub, KEY_LAST)))[0], false,
    'a revoked helper kept writing to the children\'s register — with an open-ended lifetime, revocation is the ' +
    'only thing that ever ends access, so it failing is the whole feature failing');
  assert.deepEqual(await asks(cara, { kinds: [30078], '#d': [D.CHECKIN + 'r-open-church'] }), [],
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
  assert.equal((await asks(cara, { kinds: [30078], '#d': [D.CHECKIN + 'r-open'] })).length, 1,
    're-anchor: an author can no longer read their own event. If that is now 0 the rule above changed, which is ' +
    'a TIGHTENING and probably good — but the comment is then stale and fifteen other document types moved with it');
  // the same, for a lifetime that WOULD have run out on its own but has not yet
  const tomb2 = finalizeEvent({ kind: 30078, created_at: now() + 5,
    tags: [['d', D.CHECKINHELPER + 'svc-today'], ['t', NET], ['church', church.pub], ['deleted', '1']], content: '' }, church.sk);
  assert.equal((await publishAs(church, tomb2))[0], true);
  await sleep(200);
  assert.equal((await publishAs(cara, checkin(cara, 'r-today2', 'svc-today', gina.pub, KEY_LAST)))[0], false,
    'revocation did not beat a DAY lifetime with hours left to run');
});

test('NO CONFIGURATION CHANGES WHAT THE KEY OPENS — every source, every lifetime, against the live relay', async () => {
  // THE INVARIANT, asserted where it can actually be broken. Flexibility is WHEN and WHO. If any combination of
  // settings widened what a helper can reach, this is where it shows — and it is checked against every shape
  // the product offers, not only the default, because the August failure was a configuration nobody tested.
  const t = now();
  let n = 0;
  for (const source of Object.keys(HELPER_SOURCES)) {
    for (const life of Object.keys(HELPER_LIFETIMES)) {
      const sid = `inv-${source}-${life}`;
      const until = HELPER_LIFETIMES[life].max == null ? null : t + 3600;
      const [ok] = await publishAs(church, grant(sid, [dan.pub], t - 600, until, KEY_NOW, { source, lifetime: life }));
      assert.equal(ok, true, `the relay refused an ordinary ${source}/${life} grant, so this configuration is untested`);
      await sleep(120);
      // the grant is LIVE — proved, so that the refusals below cannot pass because nothing was granted at all
      assert.equal((await publishAs(dan, checkin(dan, 'r-' + sid, sid, hank.pub, KEY_NOW)))[0], true,
        `re-anchor: the ${source}/${life} grant is not live, so every refusal below proves nothing`);
      for (const [what, filter] of [
        ['the safeguarding register', { kinds: [30078], '#d': [D.MINORS + church.pub] }],
        ['the guardian map', { kinds: [30078], '#d': [D.GUARDIANS + church.pub] }],
        ['the church ledger', { kinds: [30078], '#d': [D.FIN_JOURNAL + '1'] }],
        ['a private ask for help', { kinds: [30078], '#d': [D.CAREREQ + cara.pub.slice(0, 16) + '-r1'] }],
        ['the membership list', { kinds: [30078], '#d': [D.MEMBER + church.pub] }],
        ['the steward roster', { kinds: [30078], '#d': [D.STEWARDS + church.pub] }],
      ]) {
        assert.deepEqual(await asks(dan, filter), [],
          `with source=${source} and lifetime=${life}, a check-in helper reached ${what} — a setting has changed ` +
          'WHAT the key opens, which no setting may ever do');
      }
      const env = await asks(dan, { kinds: [30078], '#d': [D.CHECKINKEY + church.pub] });
      for (const e of env) assert.equal(JSON.parse(e.content).keys[dan.pub], undefined,
        `with source=${source} and lifetime=${life}, the helper was given the CHURCH-WIDE register key`);
      n++;
    }
  }
  assert.equal(n, Object.keys(HELPER_SOURCES).length * Object.keys(HELPER_LIFETIMES).length,
    're-anchor: not every configuration was exercised');
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
