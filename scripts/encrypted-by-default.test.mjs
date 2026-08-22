// A CHURCH IS ENCRYPTED UNLESS ITS STEWARD DECIDES OTHERWISE.
// Run: node --test scripts/encrypted-by-default.test.mjs
//
// Owner's decision, 2026-08-22: "Everything should probably just default to encrypted unless the user decides
// against it, so prayer wall, yeah encrypted."
//
// It was the other way round. `encryptComms` is a church feature flag that is ABSENT on a new church, and
// both readers treated absent as OFF — so every church started with unsealed rooms and had to find a setting
// to fix it. Round 9's members noticed, from opposite directions:
//   Grace:  "The Prayer Wall is labelled 'Not encrypted.' So is the Youth group... My direct messages ARE
//            encrypted. So the app encrypts my chat with one person, but not the place where people post
//            about their health, their new job, and their loneliness."
//   Priya:  "Every chat has a grey 'Not encrypted' label at the top, which made me hesitate before posting
//            something personal on the Prayer Wall."
// Priya had already posted which hospital ward she works on.
//
// ABSENT NOW MEANS ON. Only an explicit `encryptComms: false` — a steward deliberately turning it off — leaves
// a church's new rooms unsealed. This changes the DEFAULT for new groups; it does not reach back and reseal
// rooms that already exist, which stay exactly as their church left them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripComments } from './test-slice.mjs';

const DASH = stripComments(readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8'));

test('a new group is sealed unless the church turned encryption off', () => {
  const m = DASH.match(/const encByDefault = [^;]+;/);
  assert.ok(m, 'encByDefault not found');
  assert.equal(/!!\(church\.features && church\.features\.encryptComms\)/.test(m[0]), false,
    'a church with no encryptComms flag — which is every brand-new church — still creates UNSEALED groups. ' +
    'Absent must mean on.');
  assert.match(m[0], /!==\s*false/,
    'the default must turn on an explicit `false` only, so a steward who never touched the setting gets ' +
    'encryption and one who deliberately turned it off keeps their choice');
});

test('the settings toggle agrees with what the church actually does', () => {
  const m = DASH.match(/const encOn = [^;]+;/);
  assert.ok(m, 'encOn not found');
  assert.equal(/f\.encryptComms === true/.test(m[0]), false,
    'the toggle reads absent as OFF while new groups are being sealed — the screen would contradict the ' +
    'behaviour, which is how a steward ends up not trusting either');
  assert.match(m[0], /!==\s*false/, 'the toggle must read absent the same way the behaviour does');
  // …and it must not claim more than is true. "Encrypt all comms" means every room IS sealed; on a church
  // that still has unsealed rooms the switch has to read OFF, or the console shows a protection that is not
  // there. A new church has no rooms, so it reads ON from the first minute, honestly.
  assert.match(m[0], /encUnsealed\.length === 0/,
    'the toggle would read ON for an existing church whose rooms are still unsealed — an overclaimed ' +
    'protection, which is the one thing this product must never do');
});

test('turning it off is still possible, and still explicit', () => {
  assert.match(DASH, /encryptComms: false/,
    'a steward can no longer turn encryption off — the decision was "default", not "compulsory"');
});
