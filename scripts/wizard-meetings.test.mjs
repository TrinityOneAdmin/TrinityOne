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
const CONSOLE = readFileSync(new URL('../app/stew-console.jsx', import.meta.url), 'utf8');

// Execute the REAL id generator rather than counting calls to it. The previous version of this file asserted
// `_wizMeetingId()` appeared twice — which stayed green when the generator itself was changed to a colliding
// one, i.e. it passed while reproducing the exact bug named in its own comment.
function realWizMeetingId() {
  const m = CONSOLE.match(/function _wizMeetingId\(\) \{[^}]*\}/);
  assert.ok(m, '_wizMeetingId missing from app/stew-console.jsx');
  return new Function(m[0] + '; return _wizMeetingId;')();
}
// The full statement starting at `header`, balancing (), [] and {} together — balancing braces alone breaks on
// a destructuring header like `const [a, setA] = ...` and silently returns a truncated slice, which is how a
// structural assertion ends up passing against text it never actually read.
function bodyOf(src, header) {
  const at = src.indexOf(header);
  assert.notEqual(at, -1, `not found: ${header}`);
  const open = { '(': ')', '[': ']', '{': '}' };
  const stack = []; let started = false;
  for (let i = at + header.length; i < src.length; i++) {
    const c = src[i];
    if (open[c]) { stack.push(open[c]); started = true; }
    else if (c === ')' || c === ']' || c === '}') {
      if (stack.pop() !== c) assert.fail(`unbalanced near ${header}`);
      if (started && !stack.length) return src.slice(at, i + 1);
    }
  }
  assert.fail(`unterminated: ${header}`);
}

test('the first-run wizard has a meetings step that publishes', () => {
  assert.match(DASH, /title="Your regular meetings"/, 'the meetings step is gone — new churches finish with an empty calendar again');
  assert.match(DASH, /const saveMeetings = async \(\) => \{/, 'the meetings step must actually publish');
  assert.match(DASH, /await Promise\.resolve\(window\.Steward\.publishMeeting\(/,
    'publishing must be awaited — fire-and-forget lands the steward on an empty calendar with no error');
});

test('the id generator really is collision-free within one tick', () => {
  // Both rows are created in one synchronous expression, and these are REPLACEABLE docs — two rows sharing an
  // id means the second silently DELETES the first, so only one meeting ever reaches the calendar.
  // Drawn in a tight loop so Date.now() is constant across draws: that is exactly the failing condition.
  const gen = realWizMeetingId();
  const seen = new Set();
  for (let i = 0; i < 5000; i++) seen.add(gen());
  assert.equal(seen.size, 5000, 'ids collide when generated in the same millisecond — the second meeting would delete the first');
});

test('both prefilled meetings are created with generated ids', () => {
  const block = bodyOf(DASH, 'const [meetings, setMeetings] = React.useState');
  assert.match(block, /Sunday Service/); assert.match(block, /Midweek/);
  assert.equal((block.match(/_wizMeetingId\(\)/g) || []).length, 2, 'each meeting must get its own generated id');
});

test('every filled meeting is published — no slicing or capping', () => {
  const body = bodyOf(DASH, 'const saveMeetings = async () =>');
  assert.match(body, /const rows = meetings\.filter\(m => m\.title\.trim\(\)\);/, 'rows must be every titled meeting');
  assert.match(body, /for \(const m of rows\)/, 'the publish loop must iterate ALL rows');
  assert.doesNotMatch(body, /\.slice\(/, 'the publish list must not be sliced — a cap silently drops meetings');
  assert.doesNotMatch(body, /rows\[0\]/, 'only publishing the first row would drop every other meeting');
});

test('the step order and progress bar stay consistent', () => {
  // meetings sits between spaces and rota (rota is "who serves on a Sunday", so the Sunday must exist first),
  // and the wizard is now 7 screens — a progress bar drawing 6 would never fill.
  assert.match(DASH, /if \(step === 4\) return \(\s*<WizShell step=\{step\} title="Your regular meetings"/);
  assert.match(DASH, /if \(step === 5\) return \(\s*<WizShell step=\{step\} title="Serving rota"/);
  assert.match(DASH, /\[0, 1, 2, 3, 4, 5, 6\]\.map\(i =>/, 'the progress bar must have one segment per screen');
});
