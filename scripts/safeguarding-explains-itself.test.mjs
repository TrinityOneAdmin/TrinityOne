// A SAFEGUARDING REFUSAL MUST BE HONEST TO ONE SIDE AND DISCREET TO THE OTHER.
// Run: node --test scripts/safeguarding-explains-itself.test.mjs
//
// From round 3 of the simulation, 2026-08-19. The gate itself works exactly as designed. What it never did
// was explain itself, and in one place it said something untrue.
//
// THE YOUNG PERSON. A 15-year-old saw 23 of 26 people in her church marked "Restricted", could message three,
// and tapping any of them did nothing at all. The chip carried a `title` attribute — a tooltip, which does not
// exist on a phone. Her own words: "A young person might think the app is broken, not that it's protecting
// them."
//
// THE ADULT. An uncleared adult messaged four teenagers and reported them "all sent successfully". The relay
// had none of them: it refuses a DM between a child and an adult who is not cleared to work with youth, and
// it refuses permanently. The app said "No signal — we'll send it as soon as you're back online", which is
// the message for an outage. He waited for replies to messages nobody would ever receive.
//
// AND THE LINE THIS MUST NOT CROSS. The adult is never told WHY the person is restricted. Saying "that
// account belongs to a child" would turn a safeguarding refusal into a way to enumerate the children in a
// congregation — the very thing that keeps the minors list from ordinary members in the first place.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody, stripComments } from './test-slice.mjs';

const CHAT = readFileSync(new URL('../app/screens-chat.jsx', import.meta.url), 'utf8');
const VENDOR = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');

const dmFailWording = new Function(fnBody(CHAT, 'function dmFailWording(evt) {', 'dmFailWording') + '\nreturn dmFailWording;')();

test('a permanently refused message is NOT described as waiting for signal', () => {
  const said = dmFailWording({ _delivered: false, _refused: 'blocked: not permitted for this group' });
  assert.doesNotMatch(said, /back online|signal/i,
    'a message the relay refuses by policy was described as queued until the phone is back online. It will ' +
    'never be sent, and the sender waits for a reply to a message nobody received.');
  assert.match(said, /not delivered/i, 'the sender is not plainly told the message did not arrive');
});

test('and it does NOT disclose that the other person is a child', () => {
  const said = dmFailWording({ _delivered: false, _refused: 'blocked: not permitted for this group' });
  // \b matters: "messages" contains "age", and the first draft of this test failed on its own wording.
  assert.doesNotMatch(said, /\b(child|children|minor|young|under.?18|their age)\b/i,
    'the refusal names the reason, which turns safeguarding into a way to work out which accounts in a ' +
    'congregation belong to children — exactly what withholding the minors list prevents');
});

test('an ordinary outage still reads as an outage', () => {
  const said = dmFailWording({ _delivered: false });
  assert.match(said, /back online|signal/i,
    'a genuine offline send now reads as a permanent refusal, which would tell people to give up on a ' +
    'message that is simply queued');
});

test('the young person IS told, in their own app, what their account is', () => {
  const body = stripComments(fnBody(CHAT, 'function RestrictedExplainer(', 'RestrictedExplainer'));
  assert.match(body, /isMinor/,
    'one explanation is shown to everybody. The young person needs to know their account is set up that way ' +
    'and who they can still reach; the adult must not be told any of it.');
  assert.match(body, /young person/i, 'nothing in the sheet says what the account actually is');
});

test('the adult half of that sheet never mentions a child', () => {
  const body = stripComments(fnBody(CHAT, 'function RestrictedExplainer(', 'RestrictedExplainer'));
  const adultHalf = body.slice(body.indexOf(') : ('));
  assert.doesNotMatch(adultHalf, /child|minor|young person|under.?18/i,
    'the branch shown to an adult names what the other account is, which discloses exactly what safeguarding ' +
    'is protecting');
});

test('the restricted control is reachable — not a tooltip on a phone', () => {
  const src = stripComments(CHAT);
  const i = src.indexOf(' Restricted</');
  assert.ok(i > 0, 're-anchor: the Restricted chip is no longer in this file under that text');
  const around = src.slice(Math.max(0, i - 700), i);
  assert.match(around, /onClick=/,
    'the Restricted chip is not tappable, so the only explanation of the whole restriction is a `title` ' +
    'tooltip — which does not exist on a touchscreen. That was 310 wasted actions for one simulated member.');
  assert.match(around, /aria-label=/,
    'the chip has no accessible name, so it is unreachable by name to a screen reader and to the actor CLI');
});

test('sendDM keeps the REASON, not just the fact of failure', () => {
  const body = stripComments(fnBody(VENDOR, 'async sendDM(peerPub, content, replyTo) {', 'sendDM'));
  assert.match(body, /isPermanentRefusal\(/,
    'sendDM throws the failure reason away, so every caller has to guess whether to promise a retry. The ' +
    'machinery to tell a refusal from an outage is already in this file.');
  assert.match(body, /_refused/, 'the reason is computed and never attached to the event the caller receives');
});

test('a young person\'s own profile says what the account is — and says who can see that', () => {
  const ID = stripComments(readFileSync(new URL('../app/identity.jsx', import.meta.url), 'utf8'));
  const i = ID.indexOf('young person');
  assert.ok(i > 0,
    'nothing on the young person\'s own profile says their account is set up that way. The restriction is ' +
    'then only ever met as a refusal, which is how it reads as a broken app rather than a protection.');
  const block = ID.slice(Math.max(0, i - 900), i + 600);
  assert.match(block, /isMinor/, 'the line is shown to everyone, not only to the young person whose account it is');
  assert.match(block, /Only you and your church|stewards see this/i,
    'it does not say who else can see this, which is the first thing a teenager will want to know');
});
