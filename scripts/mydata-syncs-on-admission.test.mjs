// PERSONAL DOCUMENTS WRITTEN WHILE WAITING FOR APPROVAL MUST BE PUSHED UP THE MOMENT APPROVAL LANDS.
// Run: node --test scripts/mydata-syncs-on-admission.test.mjs
//
// MEASURED LIVE, 2026-08-18, against the running relay:
//
//   12:27:01  journal entry written while pending  -> relay refused (d=trinityone/journal,
//             why="not a member or not permitted", authed=null). The sheet closed with no error.
//   12:28:28  steward admitted the member
//   12:28-12:31  polled every 30s. Journal still ABSENT, although the app had already recorded
//             `wasadmitted` and had stopped showing itself as pending.
//   12:32     app reloaded -> all FIVE MyData docs published within 30s.
//
// So nothing is permanently lost — the device copy is authoritative and the startup reconcile republishes it.
// But between writing while pending and the next restart, the only copy is on the phone, and the app gives no
// hint of that. A member journalling while they wait for their vicar is precisely the person this matters to.
//
// accept() is not wrong to refuse: a pending member cannot NIP-42 authenticate, so the refusal is correct
// relay behaviour. The fix belongs on the client, at the moment the refusal stops being true.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripComments } from './test-slice.mjs';

const FEL = stripComments(readFileSync(new URL('../src/fellowship.src.js', import.meta.url), 'utf8'));
const MD  = stripComments(readFileSync(new URL('../src/mydata.src.js', import.meta.url), 'utf8'));
const MDV = readFileSync(new URL('../vendor/mydata.js', import.meta.url), 'utf8');
const FEV = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');

test('admission announces itself', () => {
  const at = FEL.indexOf('function _noteAdmitted(');
  assert.notEqual(at, -1, 're-anchor: _noteAdmitted has moved');
  const end = FEL.indexOf('\nconst _docsHubs', at);
  const fn = FEL.slice(at, end === -1 ? at + 3000 : end);
  assert.match(fn, /trinity-admitted/,
    'nothing signals the moment a member is admitted, so no other subsystem can react to it');
  // it must fire alongside the existing recovery, not instead of it
  assert.match(fn, /refetchChurchDocs\(\)/, 're-anchor: the church-doc recovery has gone');
});

test('MyData retries its refused publishes when that happens', () => {
  assert.match(MD, /addEventListener\('trinity-admitted'/,
    'MyData only re-publishes on its startup kick, so documents refused while pending waited for a restart');
  // the identity listener is the pattern being mirrored; if it goes, this test is checking the wrong thing
  assert.match(MD, /addEventListener\('trinity-identity'/, 're-anchor: the identity kick has changed shape');
});

test('both shipped bundles carry it', () => {
  assert.match(FEV, /trinity-admitted/, 'rebuild: bash scripts/build-fellowship.sh');
  assert.match(MDV, /trinity-admitted/, 'rebuild the mydata bundle');
});
