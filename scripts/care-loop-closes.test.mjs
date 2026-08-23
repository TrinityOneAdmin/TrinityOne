// THE CARE LOOP HAS TO CLOSE. Verity asked for a lift and a shop. Callum and Desmond were both standing by,
// willing. Callum saw "No open needs right now" for fifteen minutes across three reloads, and the request was
// sitting on the relay the whole time. Three people wanted the same outcome and the software sat between them.
//
// Run: node --test scripts/care-loop-closes.test.mjs
//
// The mechanism was never broken. A care request only becomes something anyone can volunteer for once a
// steward converts it into a need — and NOTHING told the steward to do it. The Overview, the screen a steward
// actually opens, flagged waiting JOIN requests and waiting STEWARD requests on the same page while saying
// nothing at all about someone asking for help. Miriam read "18 people are waiting to join" and went to
// Members. Two people asking for help were three clicks away and unmentioned.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripComments, fnBody } from './test-slice.mjs';

const STEWD = stripComments(readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8'));

test('C12 — the Overview says when someone is waiting for help', () => {
  // It already does this for two other kinds of waiting, with the same shape both times.
  assert.match(STEWD, /careReqBanner/, 'the Overview still never mentions a waiting care request');
  assert.match(STEWD, /waiting for help|asked for help|asking for help/i,
    'nothing on the Overview names what the person is waiting for');
});

test('C12 — the banner goes where the steward can act, and only if they can', () => {
  // The steward-request banner carries this lesson in its own comment: a delegate followed "Settings →
  // Security" to a page that is owner-gated and found "no such page exists". Care is capability-gated the
  // same way (stewCapState('care')), so a delegate without care must not be sent to a door that is shut.
  const i = STEWD.indexOf('const careReqBanner');
  assert.ok(i > 0, 'no care banner');
  const banner = STEWD.slice(i, STEWD.indexOf('\n  const ', i + 10));
  assert.match(banner, /onTab\('meals'\)/, 'the banner does not lead to the Care page');
  // The gate sits UPSTREAM of the banner — on the count it renders — so assert the mechanism, not the JSX.
  // A first draft of this test read only the banner slice and passed while proving nothing about the gate.
  assert.match(STEWD, /const careAllowed = !!\(careOn && stewCapState\('care'\)\.allowed\)/,
    'the capability is not part of whether this banner can appear');
  const eff = STEWD.slice(STEWD.indexOf('const [openCareReqs'), i);
  assert.match(eff, /if \(!careAllowed/, 'the subscription runs regardless of the capability');
  assert.match(eff, /r\.status === 'open'/, 'the count includes requests that have already been dealt with');
});

test('C12 — it renders in BOTH layouts, not just the wide one', () => {
  // The Overview has a narrow (single-column) and a wide branch, and they list their banners separately.
  // Adding a banner to one of them is how a steward on a laptop sees it and a steward on a tablet does not.
  const wide = (STEWD.match(/\{pendingBanner\}\{careReqBanner\}/g) || []).length;
  const narrow = (STEWD.match(/\{pendingBanner\}\s*\n\s*\{careReqBanner\}/g) || []).length;
  assert.equal(wide + narrow, 2, 'the care banner is missing from one of the two Overview layouts');
});

const TODAY = stripComments(readFileSync(new URL('../app/screens-today.jsx', import.meta.url), 'utf8'));

test('C13 — the helpers’ empty state does not claim nobody needs anything', () => {
  // Callum had listed himself as ready for DIY, Moving and Rides. Verity had asked for a lift. He read "No
  // open needs right now — when someone in the church needs a hand it'll show up here", three times across
  // fifteen minutes, and reasonably concluded nobody did.
  //
  // He cannot be told that a request exists: a care request is sealed to the care team, and it is not a
  // volunteer's business who has asked for what. But the app can stop asserting the opposite of the truth,
  // and can say that there is a step in between — which is the thing nobody knew.
  assert.equal(/No open needs right now/.test(TODAY), false,
    'the empty state still tells a waiting volunteer that no one needs anything');
  assert.match(TODAY, /care team/i,
    'nothing tells a volunteer that requests reach the care team first');
});
