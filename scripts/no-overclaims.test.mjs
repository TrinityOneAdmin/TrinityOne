// The product must not promise a protection it does not deliver. Run: node --test scripts/no-overclaims.test.mjs
//
// AUDIT-2026-07-30 U5. Overclaiming is treated as a DEFECT in TrinityOne, not a copy nitpick — the threat model
// is lawful compulsion and device seizure, so a member may be relying on one of these sentences in front of a
// police officer. Three were verified against the code fact that contradicts them:
//
//   app/identity.jsx:707          "a lost, borrowed, or taken phone is just a locked box"
//                                 -> clearCommunityCache deliberately KEEPS followedChurches/activeChurch, and
//                                    ARCHITECTURE.md says so: the device still reveals which church you follow.
//   app/screens-church.jsx:211    "Following only subscribes you to that church's signed posts"
//                                 -> followChurch() ends by calling announceMembership(), which PUBLISHES an
//                                    identifying membership document (app/app.jsx:671).
//   about.html:229                "Messages are encrypted"
//   features.html:219             "Group rooms and private, encrypted messages"
//                                 -> new groups default to UNencrypted (app/stew-dashboard.jsx:1728
//                                    `useState(false)`), and the app's own chat header says so honestly:
//                                    "Church room · not end-to-end encrypted, so the relay can read messages here"
//                                    (app/screens-chat.jsx:1181). DMs are encrypted; the unqualified claim reads
//                                    as "all of them".
//
// A FOURTH was WITHDRAWN on the owner's correction: "Nothing is held by a big company" (welcome.html,
// about.html). TrinityOne is not a big company, so the sentence is true. The audit read it as a claim about
// where data sits; it is a claim about who stands behind the product. Removed rather than softened — a finding
// that rests on reading a sentence uncharitably is not a finding.
//
// In every remaining case the honest wording ALREADY EXISTS somewhere in the codebase
// (app/identity-extras.jsx:283, app/help-data.jsx:332, app/screens-chat.jsx:1181). The fix is to move it onto
// the screens with reach, never to weaken it — so this file also asserts the honest text is still there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const IDENTITY = read('app/identity.jsx');
const CHURCH = read('app/screens-church.jsx');
const EXTRAS = read('app/identity-extras.jsx');
const CHAT = read('app/screens-chat.jsx');
const DASH = read('app/stew-dashboard.jsx');
const HELP = read('app/help-data.jsx');
const APP = read('app/app.jsx');
// features.html and downloads.html were folded into welcome.html's single scroll on 2026-08-06.
const FEATURES = read('welcome.html');
// EVERY served marketing page, not a hand-listed pair. MARKETING-AUDIT-2026-08-05: this file used to read
// about.html by name, and the trim deleted that page — so the test died with ENOENT rather than telling
// anyone anything. Worse, a hand-listed pair is the wrong shape for the question being asked, which is "does
// the site claim this ANYWHERE": the claim could simply move to a page not on the list. Same lesson as
// no-internal-docs.test.mjs — ask what ships, don't list the paths you happened to look at.
const SITE = readdirSync(new URL('..', import.meta.url).pathname)
  .filter(f => f.endsWith('.html') && f !== 'index.html' && f !== 'steward.html')
  .map(f => [f, read(f)]);
// Strip comments before asserting. These fixes are commented, and the comments necessarily QUOTE the phrases
// being removed — so a naive text search finds the record of the fix and reports it as the bug. JSX comments
// matter as much as `//` ones: my first version stripped only the latter and failed on its own `{/* … */}`.
const code = (s) => s
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')   // JSX comments
  .replace(/\/\*[\s\S]*?\*\//g, '')         // block comments
  .replace(/<!--[\s\S]*?-->/g, '')           // HTML comments
  .split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).join('\n');

test('the PIN screen does not promise a taken phone is "just a locked box"', () => {
  // The code fact: the wipe keeps the church list on purpose, because wiping it strands the member.
  assert.match(code(read('src/fellowship.src.js')), /trinityone\.followedChurches/,
    'followedChurches is no longer kept by the wipe — if that changed, revisit this claim rather than the copy');
  assert.doesNotMatch(code(IDENTITY), /just a locked box/,
    'the onboarding PIN screen still says a taken phone is "just a locked box". A forensic look at the device ' +
    'still shows which church the member belongs to — which is the thing that matters under seizure.');
});

test('…and it still says what the PIN genuinely does', () => {
  // Over-correction check: the answer is an honest sentence, not a missing one. A PIN screen that promises
  // nothing would put members off setting one, which is worse than the overclaim.
  const at = code(IDENTITY).indexOf('Without a PIN');
  assert.notEqual(at, -1, 'the PIN explanation has gone entirely — members need a reason to set one');
  const para = code(IDENTITY).slice(at, at + 700);
  assert.match(para, /can’t be opened|cannot be opened|read your messages/,
    'the screen no longer says what a PIN protects, so a member has no reason to set one');
});

test('the join screen does not claim following is passive', () => {
  assert.match(APP, /announceMembership/, 'followChurch no longer announces — if that changed, the copy can go back');
  assert.doesNotMatch(code(CHURCH), /only subscribes you/,
    'the join screen still says following "only subscribes you". It publishes an identifying membership ' +
    'document, and this is the screen where that matters most.');
});

test('marketing does not claim messages are encrypted while groups default to plaintext', () => {
  assert.match(DASH, /const \[encrypted, setEncrypted\] = React\.useState\(false\)/,
    'group encryption is no longer off by default — if that changed, these claims become true and can return');
  const offenders = SITE.filter(([, html]) => /Messages are encrypted/.test(code(html))).map(([f]) => f);
  assert.deepEqual(offenders, [],
    'these pages say "Messages are encrypted" unqualified, while new group rooms are plaintext: ' +
    offenders.join(', '));
  assert.doesNotMatch(code(FEATURES), /private, encrypted messages/,
    'features.html still lists "Group rooms and private, encrypted messages" — the group rooms are not encrypted');
});

// MARKETING-AUDIT-2026-08-05 D5. features.html sold "Reminders reach you even with the app closed" as a plain
// tick, unqualified. It is true on Android — Capacitor LocalNotifications hands the schedule to the OS, which
// fires it whether or not the app is running. On web it is a `setTimeout` "while this tab is alive"
// (app/reminders.jsx), which dies with the tab. And there is no iOS app: downloads.html routes iPhone users to
// "Open in your browser", so for every iPhone member the sentence was simply false — on the feature whose whole
// value is that it reaches you when you are NOT looking. A rota reminder that silently never arrives is worse
// than none, because they stopped checking.
test('the reminders claim is qualified to the platform that can keep it', () => {
  const REM = code(read('app/reminders.jsx'));
  // The code fact first, so this test dies honestly the day web/iOS gets real background delivery. Anchored on
  // EXECUTABLE code, not the comment that describes it: code() strips comments, so matching the explanation
  // would assert against text this very helper deletes — and would then fail for a reason it is not testing.
  assert.match(REM, /webTimers\[id\] = setTimeout\(/,
    'the web reminder path is no longer a tab-lifetime setTimeout — if it can now deliver with the app ' +
    'closed, the unqualified claim becomes true and may return');
  assert.match(REM, /LN\.schedule\(/,
    'native no longer schedules OS notifications, so even the Android half of the claim needs re-checking');
  assert.doesNotMatch(code(FEATURES), /Reminders reach you even with the app closed/,
    'features.html still promises reminders "even with the app closed" without naming Android. On web and ' +
    'iOS that is a setTimeout on a live tab — and the site sends iPhone users to the browser, so those ' +
    'members are being promised the one thing this feature cannot do for them.');
  // Over-correction check: the capability is real on Android and should still be sold.
  assert.match(code(FEATURES), /On Android, reminders reach you with the app closed/,
    'the reminders capability has been dropped entirely rather than qualified — it genuinely works on Android');
});

test('the waiting-for-approval screen does not tell a member to close the app', () => {
  // AUDIT-2026-07-30 U3. The code facts, asserted first so this test dies honestly if push ever ships:
  const REM = read('app/reminders.jsx');
  assert.match(code(REM), /if \(isNative\(\)\) return;/,
    'native push registration is no longer skipped — if the APK can receive push now, the promise can come back');
  const cats = code(REM).match(/const cats = \{[^}]*\}/);
  assert.ok(cats, 're-anchor: the push categories moved');
  assert.doesNotMatch(cats[0], /approv/i,
    'an approval category exists now — if the relay can push an approval, this screen may promise it again');
  // …and the promise itself must be gone. "so you can close the app" is the harmful half: it is an instruction,
  // on the most anxious screen a newcomer sees, that guarantees they miss the thing they are waiting for.
  assert.doesNotMatch(code(CHAT), /close the app until then/,
    'the waiting-for-approval screen still tells the member they can close the app. The APK gets no push, so ' +
    'the only approval signal is an in-session toast — closing the app is precisely how to miss it.');
  assert.doesNotMatch(code(CHAT), /we’ll let you know the moment you’re approved/,
    'the screen still promises a notification the APK cannot receive');
});

test('…and it still tells them what WILL happen, rather than going silent', () => {
  // Over-correction check: deleting the reassurance would leave a newcomer staring at "Waiting for approval"
  // with no idea whether to wait, retry, or give up. The fix is honesty, not absence.
  const at = code(CHAT).indexOf('has been sent');
  assert.notEqual(at, -1, 're-anchor: the pending-approval copy moved');
  const para = code(CHAT).slice(at, at + 400);
  assert.match(para, /within a day|Leave this open|check back/,
    'the pending screen no longer says what to expect. A member who is told nothing assumes it is broken.');
});

test('the honest wording that already existed is still there', () => {
  // These sentences are the source material for every fix above. Losing them would be the real regression.
  assert.match(EXTRAS, /can still tell that you use TrinityOne and which church you belong to/,
    'the honest PIN retraction has been deleted — that is the sentence the fix is built on');
  // 2026-08-13: this used to require the sentence in the chat header. The owner removed it from the room —
  // a permanent warning on a screen opened twenty times a day is not read, it is wallpaper. That is a design
  // call and it stands. What must NOT happen is the fact disappearing with the banner, so the requirement
  // moved rather than relaxed: the room still labels itself, and the explanation is now answerable in Help.
  assert.match(HELP, /the server that carries your church’s messages can read what is written there/,
    'the only remaining explanation that a church room is readable by the server is gone. The room label ' +
    '("Not encrypted") states the fact but does not say who can read it, and the Help entry beside this one ' +
    'tells members their direct messages are private — with nothing about rooms, that reads as though ' +
    'everything is');
});

// 2026-08-13: the owner shortened this to a pill, because the full sentence wrapped to two lines and read as
// a standing warning banner over every room — and a warning you see twenty times a day stops being read.
// Shortening the DISPLAY is a design call and a fair one. Losing the sentence is not: the threat model is
// lawful compulsion, and a member may be relying on "the relay can read messages here" in front of someone
// official. So the requirement is that the short state is honest on its own AND the full sentence is still
// reachable from it — present in the file is not the same as reachable on the screen.
test('the room labels its encryption state, and the explanation is findable', () => {
  assert.match(CHAT, /'Not encrypted'/,
    'the collapsed pill no longer states the unencrypted case at all. A room that the relay can read must ' +
    'say so even in its quietest form — silence there reads as safety');
  assert.match(CHAT, /'End-to-end encrypted'/, 'the collapsed pill no longer distinguishes an encrypted room');
  assert.doesNotMatch(CHAT, /not end-to-end encrypted, so the relay can read messages here/,
    'the removed banner is back in the room. It was taken out deliberately — if it is wanted again that is ' +
    'a decision to make on purpose, not something to drift back in');
});

test('the withdrawn "big company" line is left alone', () => {
  // Recorded so a later pass does not "fix" it again. It is true: TrinityOne is not a big company.
  // about.html carried a second copy and was deleted by the 2026-08-05 trim; welcome.html is where the
  // sentence lives now, and it survived the trim intact.
  assert.match(read('welcome.html'), /big company/,
    'the "big company" line was removed. It was withdrawn as a finding on the owner\'s correction — the sentence ' +
    'is about who stands behind the product, not about where data sits, and it is honest.');
});
