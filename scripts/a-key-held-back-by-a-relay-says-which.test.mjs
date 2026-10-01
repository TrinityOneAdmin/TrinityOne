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

function schNoKey(note) {
  const window = { Steward: { keyWaitNote: (kind) => (kind === 'name' ? note : 'WRONG KIND ASKED') } };
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
