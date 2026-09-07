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
// ASYNC since 2026-09-03: toggleMinor now AWAITS setMinors/setApproved so it can refuse to paint a
// safeguarding change the relay did not accept (audit #4). The lift must await it too, or `calls` is read
// before the writes have been recorded and every assertion here reads an empty list.
async function runToggle({ marking, kidPhotosAllowed, alreadySuppressed, cleared = false, pk = 'kidpub' }) {
  const body = slice('const toggleMinor = async (pk) => {', '\n  };') + '\n  };';
  const calls = { minors: [], approved: [], nophoto: [], reseal: [], notice: [] };
  const sg = {
    minors: marking ? [] : [pk],
    approved: cleared ? [pk] : [],
    nophoto: alreadySuppressed ? [pk] : [],
    clearedKnown: true,
  };
  // `guardians` / `parentSet`: toggleMinor now reads the parent map when MARKING, to end any guardian role the
  // person holds (a child is never a guardian — D2). Nobody here is a guardian; that path has its own tests in
  // console-safeguarding-controls-are-wired.test.mjs.
  const fn = new Function('sg', 'minorsSet', 'nophotoSet', 'kidPhotosAllowed', 'window', '_reseal', 'setMinorNotice', 'calls', 'nameByPub', 'guardians', 'parentSet',
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
    (n) => calls.notice.push(n),
    calls,
    { },   // nameByPub — only read on the failure branches, which these cases do not take
    {}, new Set(),   // guardians, parentSet
  );
  await fn(pk);
  return calls;
}

test('marking a member as a child suppresses the photo they already have', async () => {
  const c = await runToggle({ marking: true, kidPhotosAllowed: false });
  assert.equal(c.nophoto.length, 1,
    'the member is marked as a child and their photograph keeps rendering on every other member\'s device — ' +
    'measured on a phone, this is the vector that needs no tampering at all');
  assert.ok(c.nophoto[0].includes('kidpub'), 'the child was not actually added to the suppression list');
});

test('…and they are still recorded as a child', async () => {
  const c = await runToggle({ marking: true, kidPhotosAllowed: false });
  assert.equal(c.minors.length, 1, 'the child mark itself stopped being published');
  assert.ok(c.minors[0].includes('kidpub'));
});

test('a church that ALLOWS children’s photos is left alone', async () => {
  // Churches safeguard differently. If this church has chosen to permit them, we do not overrule it.
  const c = await runToggle({ marking: true, kidPhotosAllowed: true });
  assert.equal(c.nophoto.length, 0,
    'a church that deliberately allows children’s photos had one suppressed anyway');
});

test('somebody already on the suppression list is not written twice', async () => {
  const c = await runToggle({ marking: true, kidPhotosAllowed: false, alreadySuppressed: true });
  assert.equal(c.nophoto.length, 0, 'republishes the whole list for no change, on every mark');
});

test('UNMARKING does not un-suppress — a steward’s own moderation must survive', async () => {
  const c = await runToggle({ marking: false, kidPhotosAllowed: false, alreadySuppressed: true });
  assert.equal(c.nophoto.length, 0,
    'unmarking a child re-allowed their photo. That list is also how a steward suppresses a photo for ' +
    'ordinary moderation, and the two cannot be told apart — silently undoing that is the worse mistake.');
});

test('UNMARKING someone who was NOT suppressed must not suppress them', async () => {
  // This case exists because the previous test could not catch a missing `!unmarking`: it passed
  // alreadySuppressed, so the `!nophotoSet.has(pk)` guard blocked the write anyway and a sabotage that
  // dropped the unmarking check stayed green. Two guards, one of them masking the other, is exactly how a
  // test ends up unable to fail.
  const c = await runToggle({ marking: false, kidPhotosAllowed: false, alreadySuppressed: false });
  assert.equal(c.nophoto.length, 0,
    'unmarking a child SUPPRESSED their photo — the opposite of what the action means');
});

test('kidPhotosAllowed is derived from the CHURCH, and derived correctly', async () => {
  // runToggle injects kidPhotosAllowed as a free variable, so the real derivation sits outside the slice it
  // runs. The audit's exact defeat: change that one line to `const kidPhotosAllowed = true;` and a photo-OFF
  // church silently stops suppressing marked children's existing photos while all these tests stay green.
  // So evaluate the SHIPPED expression against real church shapes.
  const line = (SRC.match(/const kidPhotosAllowed = ([^;]+);/) || [])[1];
  assert.ok(line, 're-anchor: kidPhotosAllowed is no longer derived here at all');
  const derive = new Function('church', `return (${line});`);
  assert.equal(derive({ features: { childPhotos: true } }), true,
    'a church that ALLOWS children’s photos is read as disallowing, so it gets overruled');
  assert.equal(derive({ features: {} }), false,
    'a church with the setting absent is read as ALLOWING — the default must be off');
  assert.equal(derive({ features: { childPhotos: false } }), false, 'an explicit false is read as allowing');
  assert.equal(derive({}), false, 'a church with no features at all is read as allowing');
  assert.equal(derive({ features: { childPhotos: 'yes' } }), false,
    'a non-boolean unlocks children’s photos — this must be an identity check, not a truthy one');
});

test('the comment explaining why it is one-way is still there', async () => {
  // Not decoration: the next reader will otherwise "fix" the asymmetry above and reopen it.
  const around = stripComments(slice('const toggleMinor = async (pk) => {', '\n  };'));
  assert.match(around, /setNoPhoto/, 're-anchor: toggleMinor no longer touches the suppression list at all');
});

// ── the RECONCILE for children marked before this build shipped ─────────────────────────────────────────────
// toggleMinor only helps from the day it ships. A church that marked its under-18s months ago is exactly the
// population at risk and no mark action ever fires again for them. Found by audit after the first version of
// this fix covered fresh marks only.
function runReconcile({ minors, nophoto, kidPhotosAllowed, loaded = true, authed = true, twice = false, failPublish = false, state = null }) {
  // Anchored on this effect's OWN wording. It is deliberately unlike the clearance back-fill's opening line,
  // because relay-clearance.test.mjs slices that one out by searching for `if (!sg.loaded) return` — writing
  // this effect with the same line handed four of those tests the wrong function to assert against.
  const body = slice('    if (!sg || !sg.loaded) return;', '}, [kidPhotosAllowed,');
  const published = [];
  const sg = { loaded, minors, nophoto };
  const win = { Steward: {
    churchPub: 'cp', actingChurch: null,
    relayAuthed: () => authed,
    // HOW PRODUCTION ACTUALLY FAILS. publish() catches internally and `return false` when every relay
    // refuses — it does NOT reject. The first version of this mock rejected, so it validated a path production
    // never takes and passed over a fix that was wrong for the real failure. 'reject' is kept as a second
    // shape because setNoPhoto can also throw synchronously before it ever publishes.
    setNoPhoto: (l) => { published.push(l);
      if (failPublish === 'reject') return Promise.reject(new Error('connection failure'));
      if (failPublish) return Promise.resolve(false);          // the real one
      return Promise.resolve(true); },
  } };
  // `body` already starts at the effect's first guard and ends before its deps array, so it IS the statement
  // list — no trimming. The previous version hunted for `=>` and cut from there, which silently mangled the
  // slice the moment the anchor moved.
  const run = new Function('sg', 'nophotoSet', 'kidPhotosAllowed', 'window', '__state',
    'let nophotoBackfillDone = __state.done;\nreturn function(){' + body + '\n__state.done = nophotoBackfillDone; __state.read = function(){ return nophotoBackfillDone; }; };')(
    sg, new Set(nophoto), kidPhotosAllowed, win, (state || { done: '' }));
  run(); if (twice) run();
  // setNoPhoto is now called inside a promise chain, so the publish lands a microtask later — assert before
  // that and every one of these passes against an empty array, which is how a test stops testing anything.
  return new Promise(res => setTimeout(() => { if (state && state.read) state.done = state.read(); res(published); }, 0));
}

test('a child marked BEFORE this shipped is suppressed on the next console visit', async () => {
  const out = await runReconcile({ minors: ['kid1', 'kid2'], nophoto: [], kidPhotosAllowed: false });
  assert.equal(out.length, 1, 'a church that did its safeguarding before this build gets no protection at all');
  assert.deepEqual(out[0].sort(), ['kid1', 'kid2']);
});

test('an existing suppression entry is kept, not replaced', async () => {
  // setNoPhoto REPLACES the whole list, so dropping an entry here silently un-suppresses somebody a steward
  // switched off by hand.
  const out = await runReconcile({ minors: ['kid1'], nophoto: ['adultModerated'], kidPhotosAllowed: false });
  assert.deepEqual(out[0].sort(), ['adultModerated', 'kid1'],
    'a steward’s own moderation entry was dropped from the list');
});

test('a church that ALLOWS children’s photos is left alone', async () => {
  assert.equal((await runReconcile({ minors: ['kid1'], nophoto: [], kidPhotosAllowed: true })).length, 0,
    'a church that deliberately permits children’s photos was overruled');
});

test('nothing is republished when there is nothing missing', async () => {
  assert.equal((await runReconcile({ minors: ['kid1'], nophoto: ['kid1'], kidPhotosAllowed: false })).length, 0,
    'republishes the whole list on every tick');
});

test('it does not fire before the lists have loaded, or before the relay authed', async () => {
  // The minors document is served only to an authenticated reader, so an unauthenticated read looks exactly
  // like a church with no children — and acting on that would publish a wrong list.
  assert.equal((await runReconcile({ minors: ['kid1'], nophoto: [], kidPhotosAllowed: false, loaded: false })).length, 0,
    'acted on lists that had not arrived');
  assert.equal((await runReconcile({ minors: ['kid1'], nophoto: [], kidPhotosAllowed: false, authed: false })).length, 0,
    'acted on an unauthenticated read, where an empty minors list is indistinguishable from no children');
});

test('A FAILED PUBLISH IS RETRIED — the claim is given back', async () => {
  // setNoPhoto returns a promise and publish() THROWS on a connection failure. The first version wrapped the
  // call in a bare try/catch, which catches only a synchronous error — so a failed send was recorded as done,
  // nothing retried for the rest of the session, and a child's existing photo went on showing. Audit 2026-08-28.
  // Both failure shapes. resolve(false) is what publish() really does when every relay refuses; a rejection
  // only happens if setNoPhoto throws before publishing. The first version tested ONLY the rejection, which
  // is why it passed over a fix that handled only rejections.
  for (const shape of [true, 'reject']) {
    const state = { done: '' };
    const out = await runReconcile({ minors: ['kid1'], nophoto: [], kidPhotosAllowed: false, failPublish: shape, state });
    assert.equal(out.length, 1, `it did not even attempt the publish (${shape})`);
    assert.equal(state.done, '',
      `the signature stayed claimed after a ${shape === 'reject' ? 'rejected' : 'refused (resolve false)'} ` +
      'publish, so nothing will retry this session and the child\'s photo keeps rendering on every other ' +
      'member\'s device');
  }
});

test('running twice on the same state publishes once', async () => {
  assert.equal((await runReconcile({ minors: ['kid1'], nophoto: [], kidPhotosAllowed: false, twice: true })).length, 1,
    'the lists re-emit on every tick, so this would republish forever');
});

// ── unmarking a child also revokes their clearance, and must SAY SO ─────────────────────────────────────────
// The revocation itself is deliberate: leaving a stale clearance behind is how a six-year-old becomes someone
// the relay treats as cleared to privately message children. What was wrong is that it happened in silence, so
// a steward correcting a mis-tap destroyed a real volunteer's clearance with no warning and no hint that
// re-clearing was needed. Found on the device, 2026-08-27.
test('unmarking a CLEARED child tells the steward their clearance went with it', async () => {
  const c = await runToggle({ marking: false, kidPhotosAllowed: false, cleared: true });
  assert.equal(c.approved.length, 1, 'the clearance was NOT revoked — a stale clearance on a former child is ' +
    'the exact hazard the surrounding code exists to prevent');
  const said = c.notice.filter(Boolean);
  assert.equal(said.length, 1, 'the clearance was revoked in silence');
  assert.match(said[0].text, /clearance/i, 'the message does not mention the clearance that was removed');
  assert.match(said[0].text, /Clear for youth/, 'it does not say how to put it back');
});

test('unmarking someone who was NOT cleared says nothing', async () => {
  const c = await runToggle({ marking: false, kidPhotosAllowed: false, cleared: false });
  assert.deepEqual(c.notice.filter(Boolean), [], 'it claims a clearance was removed when there was none');
});

test('MARKING says nothing about clearances — it removes none', async () => {
  const c = await runToggle({ marking: true, kidPhotosAllowed: false, cleared: false });
  assert.deepEqual(c.notice.filter(Boolean), [], 'marking someone as a child reported a clearance removal');
});
