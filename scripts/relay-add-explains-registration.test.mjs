// ADDING A RELAY IS NOT REGISTERING WITH IT, AND THE CONSOLE NOW SAYS SO.
// Run: node --test scripts/relay-add-explains-registration.test.mjs
//
// Round 9's vicar was asked to add the church's second office computer as a spare relay. He did, correctly,
// and then stopped — because nothing happened and nothing told him why:
//   "I typed our second office computer's address, ws://127.0.0.1:8001/relay, into the Add relay box and
//    pressed Add relay... Because of that I never got to the bit about keeping the two in step."
//
// He had not missed a step; the step was invisible. A relay only carries a church once that church is
// REGISTERED on it — gateway.mjs publishes `enforces: CHURCH_PUBS.size > 0`, and the console refuses to count
// a relay whose own NIP-11 says enforces:false. So the box sat in the list, read-only and uncounted,
// syncEnable() went on refusing below two boxes, and trinityone/relays was never published. That chain is
// what round 8 recorded as "a self-hosted church cannot tell its delegates where it lives"; the cause was
// this missing sentence, not a missing mechanism.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripComments } from './test-slice.mjs';

const DASH = stripComments(readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8'));

test('adding a relay tells the steward it is not yet registered', () => {
  assert.match(DASH, /addedNote/,
    'nothing is shown after a relay is added, so the steward is left where round 9\'s vicar was');
  assert.match(DASH, /registered/i,
    'the note does not mention registration — the one thing still to do');
});

test('the note appears only after a SUCCESSFUL add', () => {
  const fn = DASH.slice(DASH.indexOf('const addRelay = () =>'));
  const body = fn.slice(0, fn.indexOf('\n  const '));
  assert.match(body, /if \(!r\)[\s\S]{0,160}setAddedNote\(''\)/,
    'a failed add still shows the "added" note, which would tell a steward their relay is in the list when ' +
    'it is not');
  assert.match(body, /setAddedNote\(String\(r\)\)/, 'the note does not name the relay that was added');
});
