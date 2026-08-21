// A CHURCH CAN TAKE A GUARDIAN LINK AWAY. THE PARENT'S APP HAS TO FIND OUT.
// Run: node --test scripts/guardian-link-removal.test.mjs
//
// Found in round 7 while checking a different finding, and the checking is the point: the reported finding —
// "the guardian link is invisible to the parent" — turned out to be MY OWN setup artifact. I had seeded the
// round by calling setGuardians() directly, and the notice that tells a parent is a SEPARATE publish that
// only the console's Link-parent button makes. With the notice sent, the parent's app shows the child.
//
// What was real sat next to it. linkParent() calls notifyGuardian(); unlinkParent() called nothing. And the
// parent's app stores the link in localStorage, where nothing ever removed it — so a guardian the church had
// removed went on being shown that child, indefinitely.
//
// Not an access hole: the relay refuses their DMs, because the guardians: document is the authority and it
// had dropped them. It is an app telling someone they are a child's guardian after the church has decided
// they are not, which in safeguarding is its own kind of wrong. unlinkParent's own comment already said
// "removing a link matters more than adding one".
//
// Verified live before and after: link -> the parent's app lists the child; remove -> 0 local links and
// "No children set up yet".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripComments, fnBody } from './test-slice.mjs';

const STEW = readFileSync(new URL('../src/steward.src.js', import.meta.url), 'utf8');
const FELL = readFileSync(new URL('../src/fellowship.src.js', import.meta.url), 'utf8');
const DASH = stripComments(readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8'));

test('the console can tell a parent a link was removed', () => {
  const body = stripComments(fnBody(STEW, 'notifyGuardianRemoved(parentPubIn, childPubIn) {', 'notifyGuardianRemoved'));
  assert.match(body, /removed: childPub/, 'the removal notice does not name the child being removed');
  assert.match(body, /nip44e\(/, 'the removal notice is not sealed to the parent — the child link would ride in cleartext');
  assert.match(body, /GUARDNOTICE_D \+ parentPub/, 're-anchor: the notice no longer goes to the parent\'s own doc');
});

test('unlinking actually sends it', () => {
  // The whole defect was a missing call site, not a missing capability.
  // A GENEROUS WINDOW, because stripComments() replaces comments with SPACES to preserve offsets — a 700-char
  // slice of this function was almost entirely whitespace and missed the call it was looking for.
  const unlink = DASH.slice(DASH.indexOf('const unlinkParent ='), DASH.indexOf('const unlinkParent =') + 1600);
  assert.ok(unlink.length > 50, 're-anchor: unlinkParent is gone');
  assert.match(unlink, /notifyGuardianRemoved\(parentPub, childPub\)/,
    'unlinkParent still tells the parent nothing, so their app keeps showing a child the church has ' +
    'removed them from — for ever, because the link lives in localStorage');
  assert.match(unlink, /setGuardians\(next\)/, 're-anchor: the unlink no longer updates the church document');
});

test('and the parent\'s app honours it', () => {
  const body = stripComments(fnBody(FELL, 'subscribeGuardianNotices() {', 'subscribeGuardianNotices'));
  assert.match(body, /dec\.removed/, 'the parent\'s app ignores a removal notice');
  assert.match(body, /_removeChildLink\(dec\.removed\)/, 'the removal does not drop the locally stored link');
  // and the removal must be handled BEFORE the "must have a child" guard, or it falls out as malformed
  const removedAt = body.indexOf('dec.removed');
  const childGuard = body.indexOf('!dec.child');
  assert.ok(removedAt > 0 && childGuard > removedAt,
    'the removal branch runs after the `!dec.child` guard, which returns first — so a removal notice is ' +
    'discarded as malformed and the link is never dropped');
});

test('removing a link cannot leave the local store holding it', () => {
  const src = stripComments(FELL);
  assert.match(src, /function _removeChildLink\(childPub\)[\s\S]{0,220}?FAMILY_KEY/,
    're-anchor: _removeChildLink no longer writes back to the family store');
  assert.match(src, /filter\(c => c && c\.child !== childPub\)/,
    'the removal does not filter the child out of the stored list');
});
