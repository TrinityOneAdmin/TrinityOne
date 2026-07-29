// A parent's children must survive a wipe. Run: node --test scripts/family-rebuild.test.mjs
//
// Reported 2026-07-28: "after restoring Testi Bob, my child is gone… in the console the child is still
// linked, I just can't see it in my app." trinityone.family is written when a child account is created and
// read straight back — nothing ever rebuilt it — and it sits in the locked-boot wipe list. So restoring an
// identity cleared it and the parent's children vanished from the phone, while the relay still held the link.
// Third instance of one pattern today: device-only data, wiped for good reasons, with no route back. The
// other two were the member's name and their picture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../src/fellowship.src.js', import.meta.url), 'utf8');
const V = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
const fn = (() => {
  const at = SRC.indexOf('function _rebuildFamily');
  assert.notEqual(at, -1, 'the family rebuild is gone — a wiped phone loses the parent’s children again');
  return SRC.slice(at, SRC.indexOf('\nfunction ', at + 10));
})();

test('it rebuilds from the parent’s OWN requests, not the church’s guardian map', () => {
  // That map lists every child in the congregation against their parents, and is deliberately served only to
  // stewards. A member may always read back what they themselves signed.
  assert.match(fn, /authors: \[pub\]/, 'the rebuild does not read the parent’s own documents');
  assert.match(fn, /guardreq:/, 'it is not reading guardian requests');
  assert.doesNotMatch(fn, /guardians:/, 'it reads the church’s guardian map, which members are not served');
});

test('it only ever adds — never removes a link we already hold', () => {
  assert.match(fn, /_loadChildren\(\)\.some\(c => c && c\.child === child\)/,
    'it does not check for an existing link, so it will duplicate children on every run');
  assert.doesNotMatch(fn, /removeItem\(FAMILY_KEY\)|setItem\(FAMILY_KEY, '\[\]'\)/,
    'the rebuild clears the list first — a relay that answers slowly would then delete a real child');
});

test('it ignores anything that is not a real child key', () => {
  assert.match(fn, /\^\[0-9a-f\]\{64\}\$/i, 'a malformed d-tag would be stored as a child');
  assert.match(fn, /some\(t => t\[0\] === 'deleted'\)/, 'a withdrawn request would be restored as a live child');
});

test('and it actually runs after an identity arrives', () => {
  // AUDIT-2026-07-28 F11. This used to assert that the CALL SITE TEXT existed inside deriveFromIdentity —
  // and it was green while that call was inert on every path (empty _docsHubs at a cold boot; socket closed
  // by reconnectAll on unlock). A string match cannot see either. The call now hangs off a hub that has
  // actually answered; whether it RETURNS A CHILD is proved by running it against a real relay in
  // scripts/family-rebuild-runs.test.mjs, which is where this assertion's real weight now lives.
  assert.match(SRC, /if \(sk && !hub\.familyRebuilt\)[\s\S]{0,200}_rebuildFamily\(hub\.cp\)/,
    'nothing calls the rebuild from a live, keyed socket, so it can never repair a wiped phone');
  assert.match(V, /_rebuildFamily/, 'the rebuild is missing from the shipped bundle');
});

test('it gives up rather than hanging', () => {
  assert.match(fn, /setTimeout\(finish, \d+\)/, 'a relay that never EOSEs would leave the promise open for ever');
});
