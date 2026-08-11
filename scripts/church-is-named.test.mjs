// THE APP MUST NAME THE CHURCH YOU ARE IN. Run: node --test scripts/church-is-named.test.mjs
//
// THE DEFECT (user-flow audit, confirmed). join.html says "Join St Aidan" — and then the app never says it
// again. Setup is generic ("Welcome to TrinityOne / Have you used TrinityOne before?"), there is no "you have
// joined St Aidan" moment at the end, and the You sheet's MY CHURCH section contained exactly one row:
// "Follow a church / Scan a code or paste a church's link".
//
// So the one screen headed MY CHURCH read as though the member belonged to none. Combined with approval being
// on — where nothing indicates you are pending until you open Community — a member could reasonably believe
// the join had not worked at all.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ID = readFileSync(new URL('../app/identity.jsx', import.meta.url), 'utf8');

const section = (() => {
  const at = ID.indexOf('MY CHURCH');
  assert.notEqual(at, -1, 'the MY CHURCH section is gone — re-anchor this test');
  return ID.slice(at, at + 1600);
})();

test('a member who is in a church sees it named', () => {
  assert.match(section, /ctx\.church && ctx\.church\.name \?/,
    'MY CHURCH never checks whether the member is in one, so it shows the same thing either way');
  assert.match(section, /label=\{ctx\.church\.name\}/,
    'the church is not named. The only row was "Follow a church", which reads as though they belong to none');
});

test('the row leads somewhere useful', () => {
  assert.match(section, /openChurchSwitcher\('list'\)/,
    'the church name is not tappable, or leads to the follow-a-new-church flow — which is the opposite of ' +
    'what a member looking at their own church wants, and it is also where leaving lives');
});

test('following a new church is still offered', () => {
  assert.match(section, /Follow a church/,
    'the follow option was removed along with the fix. A member with no church needs it, and a member with ' +
    'one may be moving');
});
