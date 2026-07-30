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
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const IDENTITY = read('app/identity.jsx');
const CHURCH = read('app/screens-church.jsx');
const EXTRAS = read('app/identity-extras.jsx');
const CHAT = read('app/screens-chat.jsx');
const DASH = read('app/stew-dashboard.jsx');
const APP = read('app/app.jsx');
const ABOUT = read('about.html');
const FEATURES = read('features.html');
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
  assert.doesNotMatch(code(ABOUT), /Messages are encrypted/,
    'about.html still says "Messages are encrypted" unqualified, while new group rooms are plaintext');
  assert.doesNotMatch(code(FEATURES), /private, encrypted messages/,
    'features.html still lists "Group rooms and private, encrypted messages" — the group rooms are not encrypted');
});

test('the honest wording that already existed is still there', () => {
  // These sentences are the source material for every fix above. Losing them would be the real regression.
  assert.match(EXTRAS, /can still tell that you use TrinityOne and which church you belong to/,
    'the honest PIN retraction has been deleted — that is the sentence the fix is built on');
  assert.match(CHAT, /not end-to-end encrypted, so the relay can read messages here/,
    'the chat header no longer tells members a church room is readable by the relay');
});

test('the withdrawn "big company" line is left alone', () => {
  // Recorded so a later pass does not "fix" it again. It is true: TrinityOne is not a big company.
  assert.match(read('about.html') + read('welcome.html'), /big company/,
    'the "big company" line was removed. It was withdrawn as a finding on the owner\'s correction — the sentence ' +
    'is about who stands behind the product, not about where data sits, and it is honest.');
});
