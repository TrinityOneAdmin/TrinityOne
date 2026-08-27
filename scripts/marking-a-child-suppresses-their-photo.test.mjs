// MARKING SOMEBODY AS A CHILD MUST DEAL WITH THE PHOTOGRAPH THEY ALREADY HAVE.
// Run: node --test scripts/marking-a-child-suppresses-their-photo.test.mjs
//
// The relay now refuses a NEW photo from a minor whose church has children's photos switched off
// (scripts/relay-child-photo.test.mjs). It cannot rewrite a kind-0 that somebody already signed — and the
// ordinary way a church discovers a member is under 18 is that they are already here, with a picture.
//
// Confirmed on the OPPO against the live relay, 2026-08-27, with children's photos OFF throughout:
//     Bram (adult) sets a photo      -> renders on another member's phone, alt="Bram Whitlock's picture", 44px
//     steward marks Bram as a CHILD  -> relay minors list now contains him
//     that member's phone, fresh unlock -> STILL renders his photograph, 44px, visible
//
// No tampering, no old build. The console already cleaned up the adjacent state in that same action — it
// correctly dropped his youth clearance — so the path knows how to tidy; the photo was simply not on the list.
//
// The fix puts them on the church's nophoto: suppression list, which every client already honours through
// suppressPhotoAv(). It is NOT reversed on unmarking, deliberately — that list is also how a steward
// suppresses a photo for ordinary moderation, and the two cannot be told apart.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripComments } from './test-slice.mjs';

const SRC = readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8');

const slice = (from, to) => {
  const a = SRC.indexOf(from);
  assert.ok(a >= 0, `re-anchor: could not find ${JSON.stringify(from)}`);
  const b = SRC.indexOf(to, a + from.length);
  assert.ok(b > a, `re-anchor: could not find ${JSON.stringify(to)}`);
  return SRC.slice(a, b);
};

// Run the SHIPPED toggleMinor with everything it touches injected, and record what it publishes.
function runToggle({ marking, kidPhotosAllowed, alreadySuppressed, pk = 'kidpub' }) {
  const body = slice('const toggleMinor = (pk) => {', '\n  };') + '\n  };';
  const calls = { minors: [], approved: [], nophoto: [], reseal: [] };
  const sg = {
    minors: marking ? [] : [pk],
    approved: [],
    nophoto: alreadySuppressed ? [pk] : [],
    clearedKnown: true,
  };
  const fn = new Function('sg', 'minorsSet', 'nophotoSet', 'kidPhotosAllowed', 'window', '_reseal', 'calls',
    body + '\nreturn toggleMinor;')(
    sg,
    new Set(sg.minors),
    new Set(sg.nophoto),
    kidPhotosAllowed,
    { Steward: {
      setMinors: (l) => { calls.minors.push(l); return true; },
      setApproved: (l) => { calls.approved.push(l); },
      setNoPhoto: (l) => { calls.nophoto.push(l); },
    } },
    (...a) => calls.reseal.push(a),
    calls,
  );
  fn(pk);
  return calls;
}

test('marking a member as a child suppresses the photo they already have', () => {
  const c = runToggle({ marking: true, kidPhotosAllowed: false });
  assert.equal(c.nophoto.length, 1,
    'the member is marked as a child and their photograph keeps rendering on every other member\'s device — ' +
    'measured on a phone, this is the vector that needs no tampering at all');
  assert.ok(c.nophoto[0].includes('kidpub'), 'the child was not actually added to the suppression list');
});

test('…and they are still recorded as a child', () => {
  const c = runToggle({ marking: true, kidPhotosAllowed: false });
  assert.equal(c.minors.length, 1, 'the child mark itself stopped being published');
  assert.ok(c.minors[0].includes('kidpub'));
});

test('a church that ALLOWS children’s photos is left alone', () => {
  // Churches safeguard differently. If this church has chosen to permit them, we do not overrule it.
  const c = runToggle({ marking: true, kidPhotosAllowed: true });
  assert.equal(c.nophoto.length, 0,
    'a church that deliberately allows children’s photos had one suppressed anyway');
});

test('somebody already on the suppression list is not written twice', () => {
  const c = runToggle({ marking: true, kidPhotosAllowed: false, alreadySuppressed: true });
  assert.equal(c.nophoto.length, 0, 'republishes the whole list for no change, on every mark');
});

test('UNMARKING does not un-suppress — a steward’s own moderation must survive', () => {
  const c = runToggle({ marking: false, kidPhotosAllowed: false, alreadySuppressed: true });
  assert.equal(c.nophoto.length, 0,
    'unmarking a child re-allowed their photo. That list is also how a steward suppresses a photo for ' +
    'ordinary moderation, and the two cannot be told apart — silently undoing that is the worse mistake.');
});

test('UNMARKING someone who was NOT suppressed must not suppress them', () => {
  // This case exists because the previous test could not catch a missing `!unmarking`: it passed
  // alreadySuppressed, so the `!nophotoSet.has(pk)` guard blocked the write anyway and a sabotage that
  // dropped the unmarking check stayed green. Two guards, one of them masking the other, is exactly how a
  // test ends up unable to fail.
  const c = runToggle({ marking: false, kidPhotosAllowed: false, alreadySuppressed: false });
  assert.equal(c.nophoto.length, 0,
    'unmarking a child SUPPRESSED their photo — the opposite of what the action means');
});

test('the comment explaining why it is one-way is still there', () => {
  // Not decoration: the next reader will otherwise "fix" the asymmetry above and reopen it.
  const around = stripComments(slice('const toggleMinor = (pk) => {', '\n  };'));
  assert.match(around, /setNoPhoto/, 're-anchor: toggleMinor no longer touches the suppression list at all');
});
