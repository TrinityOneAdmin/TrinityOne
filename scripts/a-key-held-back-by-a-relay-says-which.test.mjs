// "NOT SAVED" NAMES THE RELAY THAT IS HOLDING THE KEY BACK.
//   Run: node --test scripts/a-key-held-back-by-a-relay-says-which.test.mjs
//
// A church's FIRST care, name or sermon key is minted only once every relay in the console's set has answered,
// trustworthily, that the church has none (_openKeyRead, src/steward.src.js). That is deliberate — a relay that is
// down may be the one holding the church's envelope — and a proved relay can stay down for as long as its proof
// lasts. The audit of 3bc8905 (finding 3) asked that the steward be told WHY, concretely and briefly, on the
// screens that said only "give it a moment": the calendar and schedule, care, and the sermon upload.
//
// The engine's half (Steward.keyWaitNote, and the sermon upload's own refusal) is pinned in
// key-reads-settle-only-for-the-church-they-asked-about. This file runs the two messages the SCREENS show, lifted
// and executed — never text-matched (rule 3): the schedule screens' schNoKey() from app/stew-schedule.jsx, and the
// care screen's publishNeed() from the shipped vendor/steward-meals.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fnBody, stmt } from './test-slice.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const SCHEDULE = readFileSync(join(ROOT, 'app/stew-schedule.jsx'), 'utf8');
const MEALS = readFileSync(join(ROOT, 'vendor/steward-meals.js'), 'utf8');

function schNoKey(note, keyReady = false) {
  const window = { Steward: { keyWaitNote: (kind) => (kind === 'name' ? note : 'WRONG KIND ASKED'), nameKeyReady: () => keyReady } };
  return new Function('window', `${stmt(SCHEDULE, "const SCH_NO_KEY = ")}\n${fnBody(SCHEDULE, 'function schNoKey() {', 'schNoKey in app/stew-schedule.jsx')}\nreturn schNoKey();`)(window);
}

test('the schedule and calendar "not saved" names the relay holding the name key back', () => {
  const msg = schNoKey('box.example.org isn’t answering');
  assert.match(msg, /box\.example\.org isn’t answering/, 'THE STEWARD IS TOLD ONLY TO WAIT while a relay that is down holds back the church\'s first name key: ' + msg);
  assert.match(msg, /^Not saved/, 'the message no longer says the thing was not saved');
  assert.equal(schNoKey(''), 'Not saved — your church’s key hasn’t arrived yet. Give it a moment and try again.', 'CONTROL: with no relay to name, the message is the one it always was');
});

async function careError(note, checked = false) {
  const S = {
    publishSigned: async () => ({ id: 'x' }), careSeal: () => null, careKeyChecked: () => checked,
    keyWaitNote: (kind) => (kind === 'care' ? note : 'WRONG KIND ASKED'),
  };
  const scope = { S: () => S, uid: (p) => p + '1', crypto, TextEncoder,
    _normNeed: (n) => ({ ...n, dates: [], displayLabel: n.displayLabel || '', notes: '', recipient: '', dietary: [] }) };
  const body = `${stmt(MEALS, 'const SEALED_FIELDS = ')}\n${fnBody(MEALS, 'async function publishNeed(need) {', 'publishNeed in vendor/steward-meals.js')}\nreturn publishNeed;`;
  const publishNeed = new Function(...Object.keys(scope), body)(...Object.values(scope));
  try { await publishNeed({ type: 'meals', displayLabel: 'x' }); return null; } catch (e) { return String(e.message); }
}

test('the care screen\'s refusal names the relay holding the care key back', async () => {
  const msg = await careError('box.example.org isn’t answering');
  assert.match(String(msg), /box\.example\.org isn’t answering/, 'THE CARE SCREEN SAYS ONLY "GIVE IT A MOMENT" while a relay that is down holds back the church\'s first care key: ' + msg);
  assert.equal(await careError(''), 'Still connecting to your church — give it a moment and try again.', 'CONTROL: with no relay to name, the message is the one it always was');
  assert.match(String(await careError('box.example.org isn’t answering', true)), /care key hasn’t reached this device/, 'CONTROL: once the read has settled the other message stands');
});

// ── A CONSOLE STILL SIGNING IN SAYS SO (new church, 2026-10-02) ─────────────────────────────────────────────────
// In a new church's first moments the console holds no key YET because it is still signing in and reading — nothing
// is wrong, and "your key hasn't arrived" / "still connecting" sends a steward looking for a fault. Steward.keysSettingUp
// is true only until the sign-in and the key read have settled; both screens say "Setting up your church's keys…" then,
// and the care screen WAITS (bounded) for its key instead of refusing on the spot.
test('the schedule "not saved" says the keys are being set up while the console is still signing in — and only then', () => {
  const run = (setting) => {
    const window = { Steward: { keysSettingUp: (k) => (k === 'name' ? setting : 'WRONG KIND ASKED'), keyWaitNote: () => 'box.example.org isn’t answering', nameKeyReady: () => false } };
    return new Function('window', `${stmt(SCHEDULE, "const SCH_NO_KEY = ")}\n${fnBody(SCHEDULE, 'function schNoKey() {', 'schNoKey in app/stew-schedule.jsx')}\nreturn schNoKey();`)(window);
  };
  assert.equal(run(true), 'Setting up your church’s keys… try again in a moment.', 'a console still signing in told the steward its key "hasn\'t arrived"');
  assert.match(run(false), /box\.example\.org isn’t answering/, 'CONTROL: once the sign-in and read have settled, the plainer message that names the relay stands');
});

async function careRun(S0) {
  const S = { publishSigned: async (e) => ({ ...e, created_at: 1 }), ...S0 };
  const scope = { S: () => S, uid: (p) => p + '1', crypto, TextEncoder,
    _normNeed: (n) => ({ ...n, dates: [], displayLabel: n.displayLabel || '', notes: '', recipient: '', dietary: [] }),
    NEED_D: 'trinityone/care:', NET: 'trinityone', now: () => 1 };
  const body = `${stmt(MEALS, 'const SEALED_FIELDS = ')}\n${fnBody(MEALS, 'async function publishNeed(need) {', 'publishNeed in vendor/steward-meals.js')}\nreturn publishNeed;`;
  const publishNeed = new Function(...Object.keys(scope), body)(...Object.values(scope));
  try { return { saved: await publishNeed({ type: 'meals', displayLabel: 'x' }) }; } catch (e) { return { err: String(e.message) }; }
}
test('a care need opened while the console is still signing in WAITS for the care key and then saves, sealed', async () => {
  let ready = false, waited = null;
  const r = await careRun({
    keysSettingUp: (k) => k === 'care' && !ready,
    waitForKey: async (k, ms) => { waited = [k, ms]; ready = true; return true; },   // the key lands while we wait
    careSeal: () => (ready ? 'SEALED' : null), careKeyChecked: () => ready,
  });
  assert.deepEqual(waited && waited[0], 'care', 'publishNeed did not wait for the care key');
  assert.ok(waited[1] > 0 && waited[1] <= 20000, 'the wait is not bounded sensibly: ' + waited[1]);
  assert.ok(r.saved && r.saved.id, 'the need was refused although the key arrived while it waited: ' + JSON.stringify(r));
});
test('a care need whose key never comes says the keys are being set up, not "still connecting"', async () => {
  const r = await careRun({ keysSettingUp: () => true, waitForKey: async () => false, careSeal: () => null, careKeyChecked: () => false });
  assert.equal(r.err, 'Setting up your church’s keys… try again in a moment.');
});
test('CONTROL: a console that has signed in and read and holds no care key is refused at once, without waiting', async () => {
  let waited = false;
  const r = await careRun({ keysSettingUp: () => false, waitForKey: async () => { waited = true; return false; }, careSeal: () => null, careKeyChecked: () => true });
  assert.equal(waited, false, 'it waited for a key that is not coming');
  assert.match(r.err, /care key hasn’t reached this device/);
});

// …AND ONLY WHEN THE KEY IS WHAT IS MISSING (audit of 5276297, LOW): a save can come back empty for other reasons, and
// a relay's name appended to those sends the steward after the wrong thing.
test('the schedule "not saved" names a relay ONLY when the name key really has not arrived', () => {
  assert.equal(schNoKey('box.example.org isn’t answering', true), 'Not saved — your church’s key hasn’t arrived yet. Give it a moment and try again.',
    'A RELAY WAS NAMED ON A SAVE THAT FAILED FOR ANOTHER REASON — the church\'s name key is here');
});
