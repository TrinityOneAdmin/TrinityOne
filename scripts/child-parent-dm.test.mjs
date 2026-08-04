// A child must be able to message their own parent — and must NOT be able to be tricked into it.
// Run: node --test scripts/child-parent-dm.test.mjs
//
// UX audit 2026-08-04, finding #2. docs/security/SAFEGUARDING.md promises "the child can message their
// parent". canDMPeer derived that exemption from the church's `guardians:` map, which the relay deliberately
// serves ONLY to stewards (it maps every child in the congregation to their parents). So on a child's device
// the map was permanently {}, `linked` was permanently false, and the composer was replaced with "Speak with
// your church leaders if you need to get in touch." The relay would have allowed it (safeguardAllows passes on
// guardianLinkedIn); the client refused first. Asymmetric, too: the parent is not a minor, so the parent could
// write and the child could not reply — in exactly the case where a child has a worry about someone at church.
//
// THE FIX AND THE TRAP IT AVOIDS. The child's own `clearance:` doc is NIP-44-sealed by the church key to that
// child and already carries minor/cleared; the confirmed parents now ride there. The tempting alternative —
// reading the `guardreq:` documents, which are p-tagged to the child and readable by them today — is UNSAFE: a
// guardian request is authored by the CLAIMED parent and accept() enforces only that the author is who they
// say they are (SECURITY-AUDIT-2026-07-20 C1), never that they are that child's parent. A client trusting one
// would let any adult self-declare as a child's parent and bypass the restriction entirely. The last test here
// exists to stop that being introduced later as a "simplification".
//
// STRUCTURAL, and says so: canDMPeer is a closure inside app.jsx's context object and publishClearance sits in
// a bundled object literal with a live relay pool, so neither can be lifted and executed here. Verified to
// FAIL against main.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';

const APP = readFileSync(new URL('../app/app.jsx', import.meta.url), 'utf8');
const STEWARD = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const FELLOW = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');

test('the church seals the child’s CONFIRMED parents into their own clearance', () => {
  const fn = fnBody(STEWARD, 'publishClearance(memberPub, status, urls)', 'publishClearance');
  assert.match(fn, /guardians:\s*guards/,
    'the clearance no longer carries the confirmed parent list — a child has no safe way to learn who their ' +
    'parent is, and canDMPeer falls back to a map their device is never served');
  // hex-validated and de-duped on the way in: this list decides who may DM a minor.
  assert.match(fn, /\[0-9a-f\]\{64\}/, 'the guardian list is no longer validated as pubkeys before being sealed');
});

test('a change of parent link is re-sealed, so the child actually learns', () => {
  const fn = fnBody(STEWARD, 'async _refreshClearancesNow', '_refreshClearancesNow');
  assert.match(fn, /guardians:\s*guardsFor\(h\)/, 'the refresh no longer sends the parent list');
  assert.match(fn, /sameList\(a\.guardians,\s*b\.guardians\)/,
    'same() no longer compares guardian lists, so a link that CHANGED is treated as already-written and the ' +
    'child keeps the old sealed answer for ever');
});

test('the member app reads its own sealed parents, not the church-wide map', () => {
  assert.match(FELLOW, /myGuardians/,
    'the engine no longer emits myGuardians — the child’s app has nothing but the steward-only map again');
  const fn = fnBody(APP, 'canDMPeer: (peer)', 'canDMPeer');
  assert.match(fn, /safeguard\.myGuardians/, 'canDMPeer no longer consults the child’s own sealed parent list');
  const mine = fn.indexOf('myGuardians'), block = fn.indexOf('safeguard.isMinor');
  assert.ok(mine !== -1 && block !== -1 && mine < block,
    'the parent exemption must be evaluated BEFORE the minor refusal, or a child is blocked from their own parent');
});

test('and a child is still refused an uncleared, unlinked adult', () => {
  const fn = fnBody(APP, 'canDMPeer: (peer)', 'canDMPeer');
  assert.match(fn, /safeguard\.isMinor\s*&&\s*!\(peer\s*&&\s*approved\.includes\(peer\)\)/,
    'the core restriction is gone — a child may now DM any adult');
});

test('the client NEVER derives a parent link from a guardreq document', () => {
  // The unsafe shortcut. A guardreq is authored by the claimed parent and proves only authorship. If this ever
  // appears in the member app's DM gate, any adult can declare themselves a child's parent.
  // Strip comments first — this file's own explanation of WHY the shortcut is unsafe names it, and an
  // assertion that trips on its own rationale is a test that punishes documentation.
  const code = fnBody(APP, 'canDMPeer: (peer)', 'canDMPeer')
    .split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
  assert.ok(!/guardreq/i.test(code),
    'canDMPeer consults guardreq — a request is authored by the CLAIMED parent and proves nothing about the ' +
    'link. Any adult could self-declare as a child’s parent. Use the church-sealed clearance.');
});
