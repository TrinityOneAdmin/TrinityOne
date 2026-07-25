// A new church must leave setup with its rhythm on the calendar.
// Run: node --test scripts/wizard-meetings.test.mjs
//
// The owner set up a test church and found an empty calendar. Not a publishing bug: the ONLY wizard that
// pre-filled Sunday Service / Midweek was StewWizard (stew-console.jsx), which renders solely with ?setup=1 and
// no key. The wizard a real new church gets is the first-run one in stew-dashboard.jsx, and it had no meetings
// step at all — so nothing was ever published and nothing said so.
//
// Verified by walking the real console headless: the wizard now runs name -> recovery key -> PIN -> spaces ->
// "Your regular meetings" -> rota -> done, and publishMeeting is called with both rows and DISTINCT ids.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const DASH = readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8');

test('the first-run wizard has a meetings step that publishes', () => {
  assert.match(DASH, /title="Your regular meetings"/, 'the meetings step is gone — new churches finish with an empty calendar again');
  assert.match(DASH, /const saveMeetings = async \(\) => \{/, 'the meetings step must actually publish');
  assert.match(DASH, /await Promise\.resolve\(window\.Steward\.publishMeeting\(/,
    'publishing must be awaited — fire-and-forget lands the steward on an empty calendar with no error');
});

test('the two prefilled meetings cannot collide', () => {
  // Both rows are created in one expression. Keying them on Date.now() alone gave them the SAME id, and these
  // are replaceable docs — so the second silently DELETED the first and only one meeting survived.
  const at = DASH.indexOf('const [meetings, setMeetings] = React.useState');
  assert.notEqual(at, -1, 'the prefilled meetings are gone');
  const block = DASH.slice(at, at + 420);
  assert.match(block, /Sunday Service/); assert.match(block, /Midweek/);
  const ids = block.match(/_wizMeetingId\(\)/g) || [];
  assert.equal(ids.length, 2, 'each meeting must get its own generated id');
  assert.doesNotMatch(block, /id: 'evt' \+ Date\.now\(\)/, 'Date.now() alone collides for rows created together');
});

test('the step order and progress bar stay consistent', () => {
  // meetings sits between spaces and rota (rota is "who serves on a Sunday", so the Sunday must exist first),
  // and the wizard is now 7 screens — a progress bar drawing 6 would never fill.
  assert.match(DASH, /if \(step === 4\) return \(\s*<WizShell step=\{step\} title="Your regular meetings"/);
  assert.match(DASH, /if \(step === 5\) return \(\s*<WizShell step=\{step\} title="Serving rota"/);
  assert.match(DASH, /\[0, 1, 2, 3, 4, 5, 6\]\.map\(i =>/, 'the progress bar must have one segment per screen');
});
