// A ROOM THE STEWARD CHOSE TO ENCRYPT IS NEVER CREATED WITHOUT ITS KEY.
//   Run: node --test scripts/an-encrypted-room-is-never-made-without-its-key.test.mjs
//
// THE DEFECT (measured 2026-10-02, main at d73d8fb). The New group dialog published the room flagged `encrypted`,
// THEN tried to save its key, and when the key could not be saved it published the room again with `encrypted:
// false` and raised "“Leaders” was created WITHOUT encryption — its key could not be saved. Seal it from the Groups
// list once this console is connected." In a new church's first minutes the console has not signed in, so it failed
// every time: a room the steward chose to encrypt, in the clear, on the relay's disk. (The setup wizard did the same
// and said nothing at all — pinned in the-wizard-does-not-advance-over-rooms-it-never-made.test.mjs.)
//
// THE FIX under test: Steward.createEncryptedGroup makes the KEY first and the flagged room second, waiting (bounded)
// for the sign-in; and the dialog calls it and has no fallback. If the key cannot be made, nothing is created, the
// dialog stays open with everything typed, and says why.
//
// THE POINT OF USE (CLAUDE.md rule 1). The real console in headless chromium, a church made through the real
// screens, the real New group dialog driven by clicks. The key is made to fail the two ways publishGroupKey can fail
// (null: could not be made / not signed in; false: reached no relay) by replacing that one engine method in the page
// — the thing under test is what the DIALOG then does, not the method. Everything is read back from a raw logger
// signed in as the church, which sees every document that reaches the relay, including one written and replaced.
// Rule 3: nothing here matches text in app/*.jsx.
//
// WHAT EACH ROW WOULD CATCH
//   · the fallback restored in the dialog (publish the room anyway when the key fails)  → "no room reaches the relay": red;
//   · the dialog closing before the room exists                                         → "the dialog stays open": red;
//   · the key made AFTER the room again                                                 → the same first row.
//
// Skips itself when chromium is unavailable, like scripts/app-boots.test.mjs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { CHROME, openNewChurch, sleep } from './new-church-session.mjs';

let s;
before(async () => {
  if (!CHROME) return;
  s = await openNewChurch({ wizard: 'skip', name: 'roomkey' });
  await s.waitFor(`window.Steward.nameKeyReady() && !!window.Steward.careSeal({ a: 1 })`, 30000, 'the console to hold its keys');
  await s.press(/^Groups$/); await sleep(800);
});
after(() => { try { s && s.close(); } catch {} });
const SKIP = !CHROME ? 'no chromium' : false;

const groupDocs = () => s.events.filter(e => e.d.startsWith('trinityone/group:'));
const openDialogAndName = async (name) => {
  await s.press(/^New group$/); await sleep(500);
  await s.ev(`(() => { const i=document.querySelector('input[aria-label="Name"]'); const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; set.call(i, ${JSON.stringify(name)}); i.dispatchEvent(new Event('input',{bubbles:true})); return 1; })()`);
};
const failTheKeyWith = (v) => s.ev(`(() => { if (!window.__realPGK) window.__realPGK = window.Steward.publishGroupKey; window.Steward.publishGroupKey = async () => ${v}; return 1; })()`);
const restoreTheKey = () => s.ev(`(() => { window.Steward.publishGroupKey = window.__realPGK; return typeof window.Steward.publishGroupKey; })()`);

for (const [label, value] of [['could not be made (null — not signed in, or no church key)', 'null'], ['reached no relay (false)', 'false']]) {
  test(`the key ${label}: no room reaches the relay, the dialog stays open with what was typed, and it says why`, { skip: SKIP, timeout: 120000 }, async () => {
    const before0 = groupDocs().length;
    await failTheKeyWith(value);
    await openDialogAndName('Leaders ' + value);
    assert.equal((await s.ev(`[...document.querySelectorAll('[role=dialog] input[type=checkbox]')].map(i=>i.checked).pop()`)), true, 'Encrypted is not ticked by default in a new church');
    await s.press(/^Create group$/);
    await sleep(3500);
    // NOTHING reached the relay: not a room flagged encrypted, and above all not a room created in the clear
    assert.deepEqual(groupDocs().slice(before0).map(e => e.content.slice(0, 60)), [], 'THE DEFECT: a room reached the relay although its key could not be made');
    // the dialog is still there, with the name still typed in it
    assert.equal(await s.ev(`(document.querySelector('input[aria-label="Name"]') || {}).value`), 'Leaders ' + value, 'the dialog lost what the steward typed (or closed)');
    const said = await s.ev(`(document.querySelector('[role=dialog] [role=status]') || {}).innerText || ''`);
    assert.match(said, /keys aren’t ready yet/, 'the dialog said nothing about the keys: ' + JSON.stringify(said));
    assert.match(said, /nothing was made unencrypted/, 'it did not say what did NOT happen');
    // …and the old banner is gone for good
    const blocked = await s.ev(`window.__blocked.map(b => b.message).join(' | ')`);
    assert.doesNotMatch(blocked, /WITHOUT encryption/, 'the console still raises "created WITHOUT encryption": ' + blocked);
    await s.press(/^Cancel$/); await sleep(300);
    await restoreTheKey();
  });
}

test('with the key available again the same dialog creates the room sealed: flagged encrypted, with its key envelope', { skip: SKIP, timeout: 120000 }, async () => {
  const before0 = groupDocs().length;
  assert.equal(await restoreTheKey(), 'function');
  await openDialogAndName('Leaders');
  await s.press(/^Create group$/);
  const t0 = Date.now(); while (Date.now() - t0 < 15000 && !(s.events.some(e => e.d.startsWith('trinityone/groupkey:')) && groupDocs().length > before0)) await sleep(200);
  const docs = groupDocs().slice(before0).map(e => JSON.parse(e.content));
  assert.equal(docs.length, 1, 'expected exactly one room document, got ' + docs.length);
  assert.equal(docs[0].name, 'Leaders');
  assert.equal(docs[0].encrypted, true, 'the room is not flagged encrypted');
  const gk = s.events.filter(e => e.d.startsWith('trinityone/groupkey:'));
  assert.equal(gk.length >= 1, true, 'no key envelope reached the relay');
  const roomId = groupDocs().slice(before0)[0].d.slice('trinityone/group:'.length);
  assert.ok(gk.some(e => e.d === 'trinityone/groupkey:' + roomId), 'the key envelope is for another room');
  // KEY FIRST: the envelope was written before the room it opens
  const keyAt = gk.find(e => e.d === 'trinityone/groupkey:' + roomId).t, roomAt = groupDocs().slice(before0)[0].t;
  assert.ok(keyAt <= roomAt, 'the room was written before its key (' + roomAt + ' < ' + keyAt + ') — a window in which it is flagged encrypted with no envelope');
  assert.equal(await s.ev(`document.querySelector('input[aria-label="Name"]') ? 'open' : 'closed'`), 'closed', 'the dialog did not close after a successful create');
});
