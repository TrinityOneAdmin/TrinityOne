// A STEWARD'S "RESET THIS PERSON'S PHOTO" IS ENFORCED BY THE RELAY, NOT BY THE APP.
//   Run: node --test scripts/a-stewards-photo-reset-is-enforced.test.mjs
//
// What this control is for. Someone in the congregation has put a photograph on their profile that the
// church cannot leave up — it shows a child who is not theirs, or an ex-partner, or it is simply not
// something a church can have on a screen in the foyer. A steward opens that person's row and presses the
// reset. The console tells them, in as many words, that the church now sees only their symbol and that the
// person "cannot set a new photo until you allow it again".
//
// WHAT WAS ACTUALLY TRUE UNTIL THIS FIX. Neither half. `nophoto:` was read by scripts/gateway.mjs in exactly
// two places — who may WRITE the list, and the list of church-scoped d-tags — and nowhere in accept(). The
// relay never tracked the list at all. Measured against a real gateway on 2026-08-31, in a church with
// features.childPhotos on: a suppressed ADULT re-published a kind-0 carrying a photograph and it was
// ACCEPTED; a suppressed CHILD did the same and it was ACCEPTED; both were then served to another member.
// The reset was a display convention of one build of one app, and any older build, any modified build and
// every other Nostr client went on showing the photograph.
//
// WHY A CHILD BEING FINE PROVED NOTHING. With church-wide children's photos off — the default — a minor is
// already refused by childPhotoBlocked, and the console back-fills every minor into this list anyway. So the
// case people look at works, by a different rule, while the case this control is mostly used for — an adult
// — never worked at all. Every test below that involves a child therefore runs in a church that has
// deliberately switched children's photos ON, so that rule is out of the way and only this one can answer.
//
// This file drives a real scripts/gateway.mjs over a WebSocket. It asks the relay, not the app.
//
// THE BOUNDARY, STATED RATHER THAN IMPLIED: this fix stops a suppressed member PUBLISHING a photograph. It
// does not re-filter a kind-0 the relay is already holding — canRead's kind-0 branch consults no photo rule
// — so a photograph published BEFORE the reset can still be served from the store until that member
// publishes again. Nothing below claims otherwise.
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
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { stripComments } from './test-slice.mjs';

const PORT = 8805;   // unique across scripts/*.test.mjs AND scripts/*.probe.mjs — the suite runs files in
                     // parallel and every relay test binds a FIXED port, so a duplicate deadlocks both.
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const NET = 'trinityone';
const MEMBER_D = 'trinityone/member:', MINORS_D = 'trinityone/minors:';
const STEWARDS_D = 'trinityone/stewards:', NOPHOTO_D = 'trinityone/nophoto:';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };

const church = K();   // the console — the vicar's laptop
const adam   = K();   // an adult member. THE CASE THIS CONTROL IS MOSTLY USED FOR, and the one that never worked.
const mia    = K();   // 15, and this church has switched children's photos ON, so childPhotoBlocked cannot answer for her
const bea    = K();   // an adult nobody has reset. Must keep her photograph.
const sam    = K();   // a steward holding the safeguarding job — the console's usual author for this list
const rob    = K();   // an ordinary member, no capabilities. Must not be able to rewrite the list.
const cp = church.pub;

// Monotonic timestamps. kind-0 is REPLACEABLE, so a second profile written in the same second can come back
// as a duplicate and the test would read a stale answer as a fresh one.
let _t = Math.floor(Date.now() / 1000) - 100;
const now = () => ++_t;

let relay, dataDir, pub;

async function waitReady(ms = 15000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const r = await fetch(`http://127.0.0.1:${PORT}/status`); if (r.ok) return; } catch {} await sleep(150); } throw new Error('relay not ready'); }
const connect = () => new Promise((res, rej) => { const ws = new WebSocket(WS_URL); ws.on('open', () => res(ws)); ws.on('error', rej); });
const publish = (ws, evt) => new Promise((res) => { const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === evt.id) { ws.off('message', on); res([m[2], m[3] || '']); } }; ws.on('message', on); ws.send(JSON.stringify(['EVENT', evt])); });
const doc = (who, d, content, tags = []) => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', d], ['t', NET], ...tags], content: typeof content === 'string' ? content : JSON.stringify(content) }, who.sk);
const memberDoc = who => doc(who, MEMBER_D + cp, { joined: now() });
// Exactly what the console writes: { pubkeys: [ … ] }, keyed on the church.
const nophotoDoc = (who, list) => doc(who, NOPHOTO_D + cp, { pubkeys: list.map(p => p.pub) });

// A profile carrying a photograph, in the shape identity-avatar.jsx renders.
const profileWithPhoto = (who, name) => finalizeEvent({ kind: 0, created_at: now(), tags: [['t', NET]],
  content: JSON.stringify({ name, av: { kind: 'photo', photo: 'data:image/jpeg;base64,AAAA', color: '#c33' } }) }, who.sk);
// The same profile with no photograph — an ordinary edit, which MUST still land. If it did not, a reset
// member could never publish a profile again, and the app would tell them it had saved.
const profileNoPhoto = (who, name) => finalizeEvent({ kind: 0, created_at: now(), tags: [['t', NET]],
  content: JSON.stringify({ name, av: { kind: 'symbol', symbol: 'dove', color: '#c33' } }) }, who.sk);
// The OTHER shape: a bare NIP-01 `picture`. This is what any non-TrinityOne Nostr client publishes and
// renders, so leaving it open would mean the reset held only inside our own app — which is the whole bug.
const profileWithPicture = (who, name) => finalizeEvent({ kind: 0, created_at: now(), tags: [['t', NET]],
  content: JSON.stringify({ name, picture: 'https://example.invalid/face.jpg' }) }, who.sk);

before(async () => {
  await requireFreePort(PORT, 'a-stewards-photo-reset-is-enforced.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-nophoto-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)],
    { cwd: new URL('..', import.meta.url).pathname,
      env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(cp), RELAY_MAX_EVENTS: '5000' },
      stdio: 'ignore' });
  await waitReady();
  pub = await connect();
  // THE CHURCH HAS SWITCHED CHILDREN'S PHOTOS ON. Deliberate: it takes childPhotoBlocked out of the picture
  // so that every refusal below can only have come from the per-account reset.
  assert.equal((await publish(pub, finalizeEvent({ kind: 0, created_at: now(), tags: [['t', NET]],
    content: JSON.stringify({ name: 'St Mary’s', features: { childPhotos: true } }) }, church.sk)))[0], true, 'church profile');
  for (const who of [adam, mia, bea, sam, rob]) assert.equal((await publish(pub, memberDoc(who)))[0], true, 'joined');
  assert.equal((await publish(pub, doc(church, STEWARDS_D + cp, { pubkeys: [sam.pub], caps: { [sam.pub]: ['safeguarding'] } })))[0], true, 'steward roster');
  assert.equal((await publish(pub, doc(church, MINORS_D + cp, { pubkeys: [mia.pub] })))[0], true, 'minors list');
  await sleep(200);
});
after(async () => { try { pub && pub.close(); } catch {} try { relay && relay.kill('SIGKILL'); } catch {} await sleep(200); try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

test('BEFORE any reset, everyone’s photograph is accepted — the premise, not the fix', async () => {
  // Without this the file could pass with the relay refusing kind-0 for some unrelated reason and prove
  // nothing at all.
  assert.equal((await publish(pub, profileWithPhoto(adam, 'Adam')))[0], true, 're-anchor: an ordinary adult’s photo was already being refused');
  assert.equal((await publish(pub, profileWithPhoto(bea, 'Bea')))[0], true, 're-anchor: an ordinary adult’s photo was already being refused');
  assert.equal((await publish(pub, profileWithPhoto(mia, 'Mia')))[0], true,
    're-anchor: this church switched children’s photos ON and a child’s photo was refused anyway, so the ' +
    'child tests below would be proving the church-wide rule and not this one');
});

test('a steward resets Adam’s and Mia’s photographs', async () => {
  assert.equal((await publish(pub, nophotoDoc(church, [adam, mia])))[0], true, 'photo-suppression list');
  await sleep(250);
});

test('A SUPPRESSED ADULT’S PHOTOGRAPH IS REFUSED — the case that always bites', async () => {
  const [ok, msg] = await publish(pub, profileWithPhoto(adam, 'Adam'));
  assert.equal(ok, false, 'a member whose photograph a steward reset re-published it and the relay took it: ' +
    'the console’s promise that they cannot set a new photo until allowed again is false, and any client ' +
    'shows the picture the church removed');
  assert.match(msg, /blocked|invalid|restricted|refused|not allowed/i, `refused, but with an unhelpful reason: ${msg}`);
});

test('…and it is refused in the bare `picture` shape too, not only ours', async () => {
  // A member on a stock Nostr client sets `picture` and nothing else. If only av.kind==='photo' were
  // checked, the reset would hold inside TrinityOne and nowhere else.
  assert.equal((await publish(pub, profileWithPicture(adam, 'Adam')))[0], false,
    'the reset holds only against our own app’s photo field; a plain NIP-01 `picture` went straight through');
});

test('…but the same person’s profile WITHOUT a photograph is still accepted', async () => {
  // The reset removes a photograph. It does not shut the member out of their own profile: the "about" line
  // and the hide-me-from-the-directory toggle live in this same kind-0, and a whole-event refusal takes them
  // with it. (The display name is sealed separately since Stage 2, so it is NOT what a refusal costs —
  // scripts/profile-overwrite.test.mjs runs the shipped setProfile and pins which fields are at stake.)
  assert.equal((await publish(pub, profileNoPhoto(adam, 'Adam Okonkwo')))[0], true,
    'a suppressed member can no longer publish a profile at all, and the app will tell them it saved');
});

test('AN UNSUPPRESSED MEMBER’S PHOTOGRAPH IS UNTOUCHED — the common case, and most of the congregation', async () => {
  assert.equal((await publish(pub, profileWithPhoto(bea, 'Bea')))[0], true,
    'resetting one person’s photograph stopped everybody else publishing one');
});

test('A SUPPRESSED CHILD IS REFUSED BY THIS RULE, in a church that allows children’s photos', async () => {
  // The separator. childPhotos is ON for this church, so childPhotoBlocked returns false for Mia and cannot
  // be the thing answering here.
  assert.equal((await publish(pub, profileWithPhoto(mia, 'Mia')))[0], false,
    'a child whose photograph a steward reset re-published it in a church that allows children’s photos');
});

test('the church key is not the only author — a SAFEGUARDING steward’s list is honoured', async () => {
  // This is who actually presses the button. If the ingest only trusted the church key, every reset done
  // from a delegated console would be silently inert — the original bug wearing a different hat.
  assert.equal((await publish(pub, nophotoDoc(sam, [adam, mia, bea])))[0], true, 'steward wrote the list');
  await sleep(250);
  assert.equal((await publish(pub, profileWithPhoto(bea, 'Bea')))[0], false,
    'a safeguarding steward’s reset does nothing — only the church key’s counts');
});

test('an ordinary member cannot un-reset themselves by rewriting the list', async () => {
  // The ingest must be no looser than the write gate. If it were, the remedy would be to publish the list
  // with your own name taken out of it.
  assert.equal((await publish(pub, nophotoDoc(rob, [])))[0], false, 're-anchor: any member can rewrite the photo-suppression list');
  await sleep(200);
  assert.equal((await publish(pub, profileWithPhoto(adam, 'Adam')))[0], false,
    'a member emptied the photo-suppression list and everyone’s photograph came back');
});

test('THE RESET IS REVERSIBLE — "until you allow it again" has to be true as well', async () => {
  assert.equal((await publish(pub, nophotoDoc(church, [mia])))[0], true, 'shortened list');
  await sleep(250);
  assert.equal((await publish(pub, profileWithPhoto(adam, 'Adam')))[0], true,
    'a steward allowed the photograph again and the relay went on refusing it — a one-way door');
  assert.equal((await publish(pub, profileWithPhoto(mia, 'Mia')))[0], false,
    'taking one person off the list took everybody off it');
});

test('malformed and empty lists are tolerated, because consoles in the field wrote them', async () => {
  // The relay rehydrates ALL history on every update, so this ingest runs retroactively over documents
  // written by every build that has ever shipped. A throw here would take the whole hydrate down.
  assert.equal((await publish(pub, doc(church, NOPHOTO_D + cp, 'not json at all')))[0], true, 'malformed list stored');
  await sleep(250);
  const r = await fetch(`http://127.0.0.1:${PORT}/status`);
  assert.equal(r.ok, true, 'malformed photo-suppression content took the relay down');
  assert.equal((await publish(pub, profileWithPhoto(mia, 'Mia')))[0], true,
    'unreadable content was treated as "everybody suppressed" rather than as an empty list');
});

test('THE RESET SURVIVES A RESTART — the rehydrate half, which is the step that gets forgotten', async () => {
  // GROUP_CHILDSAFE and CHILD_PHOTOS_OK each shipped with exactly this bug: the map was populated on ingest
  // and never replayed or cleared, so the protection quietly evaporated the next time the relay restarted
  // — and this relay self-updates and restarts on its own.
  assert.equal((await publish(pub, nophotoDoc(church, [adam])))[0], true, 'final list');
  await sleep(250);
  try { pub.close(); } catch {}
  relay.kill('SIGKILL'); await sleep(400);
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)],
    { cwd: new URL('..', import.meta.url).pathname,
      env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(cp), RELAY_MAX_EVENTS: '5000' },
      stdio: 'ignore' });
  await waitReady();
  pub = await connect();
  assert.equal((await publish(pub, profileWithPhoto(adam, 'Adam')))[0], false,
    'the photo-suppression list is not rebuilt from stored events, so every reset in the church is undone ' +
    'by the next restart — and the relay restarts itself');
  assert.equal((await publish(pub, profileWithPhoto(bea, 'Bea')))[0], true,
    're-anchor: after the restart the relay is refusing everybody’s photograph, so the line above proves nothing');
});


// ── THE OTHER HALF OF THE SAME DOOR ────────────────────────────────────────────────────────────────────
// A whole-event refusal is not free. setProfile carries the PREVIOUS photograph forward into every kind-0 it
// writes, so once the relay refuses photographs from a suppressed member, that member's next NAME change
// carries the old photo, the relay refuses the whole event, and the app says "Profile saved". That is the
// exact failure the church-wide switch had to fix (scripts/church-photos-off-means-off.test.mjs); the
// per-account list is now on the same condition. These tests EXECUTE the shipped bundle, not a copy.
const BUNDLE = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
const SRC    = readFileSync(new URL('../src/fellowship.src.js', import.meta.url), 'utf8');

function liftFn(name, kind = 'function') {
  const re = kind === 'function'
    ? new RegExp('\\n  function ' + name + '\\([\\s\\S]*?\\n  \\}')
    : new RegExp('\\n  (?:var|let|const) ' + name + ' = [\\s\\S]*?;');
  const m = re.exec(BUNDLE);
  assert.ok(m, `could not lift ${name} from vendor/fellowship.js — re-anchor this test, do not delete it`);
  return m[0];
}

test('the shipped bundle answers "has a steward reset MY photograph?" from the real list', () => {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext([
    liftFn('normPub', 'var'),
    liftFn('isPhotoSuppressed'),
    'let pub = null, _noPhoto = new Set();',
    liftFn('_myPhotoReset'),
    'this.api = { _myPhotoReset, setMe: (p) => { pub = p; }, setList: (l) => { _noPhoto = l; } };',
  ].join('\n'), ctx);
  const a = ctx.api;
  a.setMe(adam.pub); a.setList(new Set());
  assert.equal(a._myPhotoReset(), false, 'a member with nobody suppressed was treated as suppressed');
  a.setList(new Set([adam.pub]));
  assert.equal(a._myPhotoReset(), true, 'the member the church reset is not recognised, so their next name change is refused and lost');
  a.setMe(bea.pub);
  assert.equal(a._myPhotoReset(), false, 'it suppressed somebody who is not on the list');
  a.setMe(null);
  assert.equal(a._myPhotoReset(), false, 'it answered true before we even know our own key');
});

test('setProfile drops the reset photograph BEFORE the published body is built', () => {
  // Order is the whole point. Stripping after the body is stringified publishes the photo anyway, the relay
  // refuses the event, and the member's name change is silently lost.
  const i = SRC.search(/\n  async setProfile\(/);
  assert.ok(i > 0, 're-anchor: setProfile is gone');
  const fn = stripComments(SRC.slice(i, SRC.indexOf('requestProfiles(pubkeys)', i)));
  const strip = fn.indexOf('_myPhotoReset()');
  const body  = fn.indexOf('JSON.stringify(wire)');
  assert.ok(strip > 0, 'a member whose photograph a steward reset carries it into every later profile edit, ' +
    'so the relay refuses the whole event and their name change is lost while the app says it saved');
  assert.ok(body > 0, 're-anchor: the profile body is no longer built with JSON.stringify(wire)');
  assert.ok(strip < body, 'the photo is stripped AFTER the published body is built, so it still goes out');
  // Both fields the relay inspects — av.kind==='photo' and a bare `picture` — or the event is still refused.
  const line = fn.slice(strip, strip + 200);
  assert.match(line, /p\.picture = ''/, 'the `picture` field still carries the photo, so the relay still refuses');
  assert.match(line, /_stripPhoto\(/, 'the `av` field still carries the photo, so the relay still refuses');
});

test('the shipped bundle carries the client half — a src-only fix ships nothing', () => {
  assert.match(BUNDLE, /_myPhotoReset/, 'vendor/fellowship.js predates this fix — run: npm run build:fellowship');
});
