// EVERY CHAT WINDOW BEHAVES THE SAME — AND A WRONG ANSWER IS NEVER A DEAD END.
// Run: node --test scripts/chat-parity-and-retry.test.mjs
//
// Three defects, all found on 2026-08-17, all of the same family: a thing was built once and then not carried
// across, or a state was entered with no way out.
//
// 1. TWO REACTION SETS. Group rooms offered ['🙏','❤️','🔥','🙌','✨']; direct messages offered a different
//    six, including 👍 and 😂. So the two reactions a person reaches for most existed in the app but not in
//    the room where the church actually talks. Owner-reported, and the owner's memory of having asked for
//    them was correct — they had simply landed in one surface.
//
// 2. NO SWIPE TO REPLY, anywhere. Believed shipped; the word "swipe" appeared only in the Bible reader and
//    the serving screens. Direct messages had no reply-to-a-message concept at all.
//
// 3. THE 12-WORD CHECK TRAPPED THE PERSON IT EXISTS FOR. `disabled={picked != null}` froze all three answer
//    buttons on the FIRST tap, right or wrong — under a sentence reading "check your paper and tap the right
//    word". The ✕ that looks like clear-and-retry sits inside a disabled button, so it was dead too. The only
//    escape was reloading the app. It fired for exactly one member: the one who wrote their words down wrong.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripComments } from './test-slice.mjs';

const CHAT = readFileSync(new URL('../app/screens-chat.jsx', import.meta.url), 'utf8');
const HELP = readFileSync(new URL('../app/screens-help-main.jsx', import.meta.url), 'utf8');
const FEL  = readFileSync(new URL('../src/fellowship.src.js', import.meta.url), 'utf8');
const BUNDLE = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');

test('there is exactly ONE reaction set, and it has a thumbs up and a laugh', () => {
  const src = stripComments(CHAT);
  const lists = [...src.matchAll(/=\s*\[((?:\s*'[^']*',?)+)\]\s*;/g)]
    .map(m => m[1]).filter(x => /[\u{1F300}-\u{1FAFF}☀-➿]/u.test(x));
  assert.equal(lists.length, 1,
    `found ${lists.length} emoji lists in the chat screen — a second literal list is exactly how group rooms ` +
    'and direct messages drifted into offering different reactions');
  assert.match(lists[0], /👍/, 'a thumbs up is the most reached-for reaction there is');
  assert.match(lists[0], /😂/, 'and a laugh');
  assert.match(src, /const DM_EMOJI = REACT_EMOJIS/, 'direct messages must use the shared set, not a copy');
});

test('a message can be swiped to reply, in group rooms AND in direct messages', () => {
  const src = stripComments(CHAT);
  // Group rooms: on Row, so a verse, a poll and an ordinary message all behave the same.
  assert.match(src, /function Row\(/, 're-anchor: Row has moved');
  assert.match(src, /onTouchStart=\{onTS\} onTouchEnd=\{onTE\}/, 'the bubble row must own the gesture');
  // Direct messages: their own wrapper, since a DM bubble has no Row.
  assert.match(src, /function DMSwipe\(/, 'direct messages need the gesture too — the ask was every chat window');
  assert.match(src, /<DMSwipe /, 'and it has to actually wrap the bubbles');
  // A vertical drag must release the gesture, or the message list stops scrolling.
  const guards = src.match(/if \(Math\.abs\(ddy\) > Math\.abs\(ddx\)\)/g) || [];
  assert.equal(guards.length, 2,
    'both surfaces must let go on a mostly-vertical drag, or swiping to reply breaks scrolling');
});

test('a DM reply is carried INSIDE the encryption, not in a public tag', () => {
  const src = stripComments(FEL);
  assert.match(src, /_dmWrap\(text, replyTo\)/, 'the reply reference is wrapped into the body');
  assert.match(src, /_dmUnwrap\(body\)/, 'and unwrapped on read');
  assert.match(src, /const body = window\.Fellowship\._dmWrap\(content, replyTo\)/,
    'sendDM must encrypt the WRAPPED body — wrapping after encryption would do nothing');
  // The group-room way (a NIP-10 `e` tag) is public. On a kind-4 that publishes "these two ciphertexts belong
  // to one exchange" to whoever holds the relay — real metadata about a private conversation.
  const send = src.slice(src.indexOf('async sendDM('), src.indexOf('async sendDM(') + 700);
  assert.doesNotMatch(send, /\['e',/,
    'a reply tag on a kind-4 leaks the shape of a private conversation to the relay');
  // Old messages are bare strings and must keep working.
  const un = src.slice(src.indexOf('_dmUnwrap(body)'), src.indexOf('_dmUnwrap(body)') + 500);
  assert.match(un, /body\[0\] !== '\{'/, 'every DM ever sent is a bare string — it must still read as text');
  assert.match(un, /return \{ text: body, replyTo: null \}/, 'and unparseable content must not lose the words');
});

test('the 12-word check lets you try again when you get it wrong', () => {
  const src = stripComments(HELP);
  const at = src.indexOf('One quick check');
  assert.notEqual(at, -1, 're-anchor: the verification step has moved');
  const step = src.slice(at, at + 2200);
  assert.match(step, /const show = picked != null && correct;/,
    'freeze the answers only once the member has it RIGHT. `picked != null` froze them on any tap, so the ' +
    'one person this check exists for — the member who wrote their words down wrong — was told to tap the ' +
    'right word by a screen that would no longer accept a tap');
  assert.doesNotMatch(step, /const show = picked != null;/, 'that is the dead-end form');
  assert.match(step, /disabled=\{show\}/, 'and the buttons still lock during the hand-off to the next step');
});

test('the shipped bundle carries the DM reply', () => {
  assert.match(BUNDLE, /_dmUnwrap/, 'rebuild: bash scripts/build-fellowship.sh');
});
