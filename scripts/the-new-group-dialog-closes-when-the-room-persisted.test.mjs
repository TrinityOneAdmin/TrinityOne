// THE NEW GROUP DIALOG CLOSES WHEN THE ROOM ACTUALLY PERSISTED (pilot 2026-11-06, Safari/Apple issue #1, CASE B).
//   Run: node --test scripts/the-new-group-dialog-closes-when-the-room-persisted.test.mjs
//
// THE DEFECT (owner device, 2026-11-05). On Safari/Apple the group WAS created but the dialog never closed. Not a
// failed write and not a close-mechanism bug: publishGroup (the group doc) goes through _publishToRelays, which only
// reports success when EVERY connected relay acks — a deliberate safeguarding rule. On WKWebView a relay's OK ack
// arrives late (past publishTimeout) while the relay HAS stored the event, so publishGroup resolves null, and
// createEncryptedGroup returned {ok:false, reason:'group-not-saved'} although the room (and its key) were on the relay.
// onClose() was skipped, the sheet stayed open, and the OLD "Try again" re-ran create() → a DUPLICATE group.
//
// THE FIX under test. When publishGroup resolves null, createEncryptedGroup consults _spreadOf(GROUP_D+id): if the doc
// LANDED on ≥1 relay it returns {ok:true, partial:true} (the room exists with its key — it is usable), so the dialog
// CLOSES; only a ZERO-relay landing stays {ok:false}. Mirrors sealGroup's already-audited flag-partial decision. The
// all-relays write rule in _publishToRelays is UNCHANGED (a child's safeguarding record must still reach every relay).
//
// THE POINT OF USE (CLAUDE.md rule 1). The real console in headless chromium, a real church, the real New group dialog
// driven by clicks. The Safari late-ack is reproduced by wrapping publishGroup so it does the REAL write (the doc and
// its spread genuinely land) but then returns null — exactly what a dropped OK frame produces. Everything is read back
// from the raw logger signed in as the church (every doc that reaches the relay) and from the live DOM. Rule 3:
// nothing here matches text in app/*.jsx.
//
// WHAT EACH ROW WOULD CATCH
//   · the partial branch removed (createEncryptedGroup returns {ok:false} on a null that landed)  → "the dialog closed": red;
//   · a retry/duplicate path minting a second id                                                  → "exactly one room doc": red;
//   · the failure branch weakened (a true ZERO-relay write treated as created)                    → "stays open, no doc": red.
//
// Skips itself when chromium is unavailable, like scripts/app-boots.test.mjs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { CHROME, openNewChurch, sleep } from './new-church-session.mjs';

let s;
before(async () => {
  if (!CHROME) return;
  s = await openNewChurch({ wizard: 'skip', name: 'ng-persist' });
  await s.waitFor(`window.Steward.nameKeyReady() && !!window.Steward.careSeal({ a: 1 })`, 30000, 'the console to hold its keys');
  await s.press(/^Groups$/); await sleep(800);
});
after(() => { try { s && s.close(); } catch {} });
const SKIP = !CHROME ? 'no chromium' : false;

const groupDocs = () => s.events.filter(e => e.d.startsWith('trinityone/group:'));
const keyDocs = () => s.events.filter(e => e.d.startsWith('trinityone/groupkey:'));
const dialogOpen = () => s.ev(`document.querySelector('input[aria-label="Name"]') ? 'open' : 'closed'`);
const openDialogAndName = async (name) => {
  await s.press(/^New group$/); await sleep(500);
  await s.ev(`(() => { const i=document.querySelector('input[aria-label="Name"]'); const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; set.call(i, ${JSON.stringify(name)}); i.dispatchEvent(new Event('input',{bubbles:true})); return 1; })()`);
};
// the REAL write happens (doc + spread land on the relay), then publishGroup reports null — a dropped OK frame.
const makeLateAck = () => s.ev(`(() => { if (!window.__realPG) window.__realPG = window.Steward.publishGroup; window.Steward.publishGroup = async (g) => { await window.__realPG(g); return null; }; return 1; })()`);
// nothing is written AND null is returned — a genuine zero-relay failure.
const makeHardFail = () => s.ev(`(() => { if (!window.__realPG) window.__realPG = window.Steward.publishGroup; window.Steward.publishGroup = async () => null; return 1; })()`);
const restorePG = () => s.ev(`(() => { if (window.__realPG) window.Steward.publishGroup = window.__realPG; return typeof window.Steward.publishGroup; })()`);

test('a persisted-but-unacked create (Safari late ack) CLOSES the dialog and leaves exactly ONE room doc — no duplicate', { skip: SKIP, timeout: 120000 }, async () => {
  const beforeG = groupDocs().length, beforeK = keyDocs().length;
  await makeLateAck();
  await openDialogAndName('Persisted room');
  assert.equal(await s.ev(`[...document.querySelectorAll('[role=dialog] input[type=checkbox]')].map(i=>i.checked).pop()`), true, 'Encrypted is not ticked by default — the sealed branch is not being exercised');
  await s.press(/^Create group$/);
  // wait for the doc + key to reach the relay and the dialog to settle
  const t0 = Date.now();
  while (Date.now() - t0 < 15000 && !(groupDocs().length > beforeG && keyDocs().length > beforeK)) await sleep(200);
  await sleep(1500);
  // THE FIX: the room persisted, so the dialog closed (it used to stay open and invite a duplicate).
  assert.equal(await dialogOpen(), 'closed', 'the dialog did NOT close although the room persisted on the relay (CASE B not fixed)');
  // exactly ONE room doc and ONE key envelope — no second id minted by any retry/duplicate path
  const added = groupDocs().slice(beforeG).map(e => JSON.parse(e.content));
  assert.equal(added.length, 1, 'expected exactly ONE room doc to reach the relay, got ' + added.length + ' (a duplicate was minted)');
  assert.equal(added[0].name, 'Persisted room');
  assert.equal(added[0].encrypted, true, 'the room is not flagged encrypted');
  assert.equal(keyDocs().length - beforeK, 1, 'expected exactly ONE key envelope, got ' + (keyDocs().length - beforeK));
  await restorePG();
});

test('a genuine ZERO-relay failure still keeps the dialog OPEN and writes nothing (the failure branch is intact)', { skip: SKIP, timeout: 120000 }, async () => {
  assert.equal(await restorePG(), 'function');
  const beforeG = groupDocs().length;
  await makeHardFail();
  await openDialogAndName('Nowhere room');
  await s.press(/^Create group$/);
  await sleep(4000);
  assert.deepEqual(groupDocs().slice(beforeG).map(e => e.content.slice(0, 40)), [], 'a room doc reached the relay on a zero-relay failure');
  assert.equal(await dialogOpen(), 'open', 'the dialog closed on a genuine zero-relay failure — partial logic is treating "nothing landed" as created');
  const said = await s.ev(`(document.querySelector('[role=dialog] [role=status]') || {}).innerText || ''`);
  assert.match(said, /relay didn’t accept|wasn’t created|keys aren’t ready/i, 'the dialog did not say why on a true failure: ' + JSON.stringify(said));
  await s.press(/^Cancel$/); await sleep(300);
  await restorePG();
});
