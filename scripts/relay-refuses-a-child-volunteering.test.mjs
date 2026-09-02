// A CHILD MUST NOT BE ABLE TO PUT THEMSELVES FORWARD AS SOMEONE ADULTS SHOULD CONTACT.
//   Run: node --test scripts/relay-refuses-a-child-volunteering.test.mjs
//
// Two documents in the Care module carry a member's name outward to people they have never met, and both
// are written by the member's OWN key — so no console press stands between a young person and the whole
// congregation:
//
//   · `careavail:<churchpub>` — "I'm here to help", with a line of the member's own words. It renders on
//     every member's Care tab under "Ready to help", and it is an INVITATION TO BE CONTACTED. A 15-year-old
//     listing themselves there is a child advertising availability to every adult in the church.
//   · `care:<id>` — a care need. It is not private: depending on the church's visibility setting it is
//     public to the whole congregation or to the care team, and it says what somebody needs and when. A
//     church that switches on `openedBy: 'member'` — the setting that lets ordinary members open their own
//     need without asking a steward first — has opened that write path to every member's key, children
//     included, unless the relay says otherwise. A child needing help must send a PRIVATE request to the
//     care team, which is a different document with a different audience.
//
// Both gates are one clause: `&& !minorOf(e.pubkey, cp)`, in gateway.mjs's write path. Delete either and the
// relay accepts the write. The member app has its own guard in both cases and is not a boundary: a phone can
// run an old build, a modified build, or no build at all — the church's protection has to hold at the relay
// or it does not hold.
//
// MEASURED COVERAGE BEFORE THIS FILE, 2026-09-01:
//   · dropping the clause from `careavail:` already reddens scripts/a-marked-child-is-not-listed-as-a-helper
//     .test.mjs (7 pass / 1 fail). That assertion is a step inside a test about the READ gate, phrased as a
//     re-anchor check, so it is stated here as its own claim as well.
//   · dropping it from `care:` reddened NOTHING in the six test files that so much as mention
//     `openedBy`/`MEALS_OPEN_MEMBER` (135 pass / 0 fail). That gate had no test at all.
//
// A REAL scripts/gateway.mjs on its own port and its own data directory, real WebSockets, real NIP-42 auth,
// and the answers read off the relay's own OK/false. The model is
// scripts/an-adults-only-groups-event-is-not-served-to-a-child.test.mjs.
//
// MEASURED RED/GREEN, 2026-09-01, this file against scripts/gateway.mjs:
//   · the shipped relay                                                       8 pass / 0 fail
//   · careavail: gate drops `&& !minorOf(e.pubkey, cp)`                       7 pass / 1 fail
//   · care: NEED_D gate drops `&& !minorOf(e.pubkey, cp)`                     7 pass / 1 fail
// Each anchor was asserted to occur exactly once in gateway.mjs before the edit, and the file restored
// byte-identical afterwards.
//
// AND WHAT MUST NOT BREAK, which is most of this file. The volunteer register and member-opened needs are
// ordinary, wanted features and most of a church is adults: an adult must still be able to list themselves,
// still be able to open a need when the church allows it, and a church that has NOT switched `openedBy` on
// must still refuse everybody's members — the gate under test must not become the reason the feature works.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { requireFreePort } from './test-ports.mjs';

const PORT = 8818;
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const NET = 'trinityone';
const MEMBER_D = 'trinityone/member:', MINORS_D = 'trinityone/minors:';
const AVAIL_D = 'trinityone/careavail:', NEED_D = 'trinityone/care:';
const MEALS_SETTINGS_D = 'trinityone/meals-settings';
const now = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };

const grace = K();          // the church
const cp = grace.pub;
const mia = K();            // 15. Her church marks her a child.
const ann = K();            // an ordinary ADULT member — the common case, and most of the congregation

let relay, dataDir, pub;

async function waitReady(ms = 15000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const r = await fetch(`http://127.0.0.1:${PORT}/status`); if (r.ok) return; } catch {} await sleep(150); } throw new Error('relay not ready'); }
const connect = () => new Promise((res, rej) => { const ws = new WebSocket(WS_URL); ws.on('open', () => res(ws)); ws.on('error', rej); });
const publish = (ws, evt) => new Promise((res) => { const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { ws.off('message', on); res([m[2], m[3] || '']); } }; ws.on('message', on); ws.send(JSON.stringify(['EVENT', evt])); });
const doc = (who, d, content, tags = [], at = 0) => finalizeEvent({ kind: 30078, created_at: at || now(), tags: [['d', d], ['t', NET], ...tags], content: JSON.stringify(content) }, who.sk);

// "I'm here to help", exactly as the member app writes it: keyed by the CHURCH, signed by the member.
const availDoc = (who, at = 0) => doc(who, AVAIL_D + cp, { note: 'I’m good with computers', ts: now() }, [], at);
// A care need as publishCareNeed shapes it: the id in the d-tag and a ['church', cp] tag, signed by the member.
const needDoc = (who, id, at = 0) => doc(who, NEED_D + id, { title: 'Meals after my operation' }, [['church', cp]], at);
// The church's Care-module settings. `openedBy: 'member'` is the switch under test.
const mealsSettings = (openedBy, at = 0) => doc(grace, MEALS_SETTINGS_D, { enabled: true, visibility: 'church', openedBy, adminGroupId: '' }, [], at);

before(async () => {
  await requireFreePort(PORT, 'relay-refuses-a-child-volunteering.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-childvol-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)],
    { cwd: new URL('..', import.meta.url).pathname,
      env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(cp), RELAY_MAX_EVENTS: '5000' },
      stdio: 'ignore' });
  await waitReady();
  pub = await connect();
  for (const who of [mia, ann]) assert.equal((await publish(pub, doc(who, MEMBER_D + cp, { joined: now() })))[0], true, 'joined the church');
  assert.equal((await publish(pub, mealsSettings('member')))[0], true, 'the church allows members to open their own needs');
  await sleep(200);
});
after(async () => { try { pub && pub.close(); } catch {} try { relay && relay.kill('SIGKILL'); } catch {} await sleep(200); try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

// ── the premise ────────────────────────────────────────────────────────────────────────────────────────────
test('CONTROL: before anyone is marked, BOTH members may volunteer and open a need', async () => {
  // Without this, every refusal below could be a relay that refuses everything, or a Care module that is off.
  for (const [who, label] of [[mia, 'Mia'], [ann, 'Ann']]) {
    assert.equal((await publish(pub, availDoc(who)))[0], true, `re-anchor: ${label} could not list herself as a helper at all`);
    assert.equal((await publish(pub, needDoc(who, 'need-' + label)))[0], true, `re-anchor: ${label} could not open a need, so openedBy:'member' is not in force`);
  }
  await sleep(150);
});

test('the church marks Mia as a child', async () => {
  assert.equal((await publish(pub, doc(grace, MINORS_D + cp, { pubkeys: [mia.pub] })))[0], true, 'the minors list was refused');
  await sleep(250);
});

// ── gap 6: "I'm here to help" ──────────────────────────────────────────────────────────────────────────────
test('A CHILD MAY NOT LIST HERSELF AS SOMEONE TO CONTACT FOR HELP', async () => {
  const [ok, why] = await publish(pub, availDoc(mia, now() + 1));
  assert.equal(ok, false,
    'a 15-year-old was accepted onto the church’s "Ready to help" register, with a line of her own words, ' +
    'inviting every adult in the congregation to contact her privately. The client filters minors out of ' +
    'that list from `minors:`, which this relay deliberately does not serve to ordinary members, so the ' +
    'relay is the only place this can be stopped. Relay said: ' + JSON.stringify(why));
});

test('…and an ADULT still lists herself, which is the whole point of the register', async () => {
  assert.equal((await publish(pub, availDoc(ann, now() + 1)))[0], true,
    'the volunteer register stopped accepting ordinary adults — the gate is refusing the congregation, ' +
    'not its children');
});

// ── gap 7: opening a care need in a church that lets members do it ─────────────────────────────────────────
test('A CHILD MAY NOT OPEN A CARE NEED, EVEN WHERE THE CHURCH LETS MEMBERS OPEN THEIR OWN', async () => {
  const [ok, why] = await publish(pub, needDoc(mia, 'need-mia-2'));
  assert.equal(ok, false,
    'a child opened a care need. A need is not a private message to the care team: by this church’s own ' +
    'visibility setting it is shown to the congregation, saying what a named young person needs and when. ' +
    'A child asking for help must reach the care team privately instead. Relay said: ' + JSON.stringify(why));
});

test('…and an ADULT member still opens one, because that setting is what the church switched on', async () => {
  assert.equal((await publish(pub, needDoc(ann, 'need-ann-2')))[0], true,
    'a church that deliberately opened need-creation to its members can no longer have any member use it — ' +
    'the feature is off for everyone, and nothing on the screen says why');
});

// ── the setting itself still means something ───────────────────────────────────────────────────────────────
test('a church that has NOT opened needs to its members still refuses an adult member', async () => {
  // The pair for the test above: without it, "an adult may open a need" would pass just as well on a relay
  // that let ANY member of ANY church open one, which is the shape AUDIT-2026-07-30 S3 had to close.
  assert.equal((await publish(pub, mealsSettings('steward', now() + 1)))[0], true, 'the settings change was refused');
  await sleep(250);
  assert.equal((await publish(pub, needDoc(ann, 'need-ann-3')))[0], false,
    'an ordinary member opened a care need in a church that never allowed it');
  // …and the child is still refused, which is the state most churches are in.
  assert.equal((await publish(pub, needDoc(mia, 'need-mia-3')))[0], false, 'a child opened a need in a church that allows nobody to');
});

test('the CHURCH ITSELF still opens a need for the child — a child in trouble must still be helped', async () => {
  // The gate refuses a child WRITING, never a child being cared for. If this broke, the safest church in the
  // pilot would be the one that could not feed a 15-year-old's family.
  assert.equal((await publish(pub, needDoc(grace, 'need-for-mia')))[0], true,
    'the church key can no longer open a care need on a member’s behalf — the care team has lost its own module');
});
