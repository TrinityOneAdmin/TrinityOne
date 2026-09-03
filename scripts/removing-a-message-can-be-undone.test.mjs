// REMOVING A MESSAGE IS REVERSIBLE, AND THE CONSOLE NEVER SAID SO.
// Run: node --test scripts/removing-a-message-can-be-undone.test.mjs
//
// AUDIT 2026-09-02 #16. `unhideMessage` has existed on BOTH surfaces since moderation landed and was called
// by nothing at all. So "Remove message" read as permanent to every steward who used it — and it also fired
// and forgot, so a removal the relay refused looked exactly like one it took.
//
// The ordering half matters more than the button. A hide is `d = hide:<msgId>`, so one steward hiding and
// then un-hiding replaces a single addressable document — nothing to resolve. TWO stewards are two
// documents under two authors, both delivered, and the subscription took whichever ARRIVED LAST. So
// "steward B puts back what steward A removed" came out differently depending on which relay answered
// first, and could flip back on the next reconnect. An Undo button over that would be a lie with a nicer
// label, so the resolution is now by the events' own timestamps: the newest decision wins.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const STEW = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const FELL = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');

// Drive the shipped subscribeHidden with events delivered in a chosen order.
function hiddenAfter(bundle, sliceAnchor, events, { memberSide = false } = {}) {
  const i = bundle.indexOf(sliceAnchor);
  assert.ok(i > 0, `${sliceAnchor} is not in the bundle — re-anchor this test`);
  let d = 0, end = -1;
  for (let k = bundle.indexOf('{', i); k < bundle.length; k++) {
    if (bundle[k] === '{') d++;
    else if (bundle[k] === '}') { d--; if (!d) { end = k + 1; break; } }
  }
  const body = bundle.slice(i, end);
  let handlers = null, last = null;
  const pool = { subscribeMany: (_r, _f, h) => { handlers = h; return { close() {} }; } };
  const obj = new Function('pool', 'relays', 'pub', 'HIDE_D', 'window', '_coalesce', '_groupEventTrusted', 'NET', 'Number', 'Set', 'Map',
    'return ({ ' + body + ' })')(
    pool, () => ['wss://r/relay'], 'churchpub', 'trinityone/hidden:',
    { Fellowship: { churchPub: 'churchpub', relays: ['wss://r/relay'] } },
    (f) => f, () => true, 'trinityone', Number, Set, Map);
  const fn = obj[Object.keys(obj)[0]];
  if (memberSide) fn('g1', (s) => { last = s; }); else fn((s) => { last = s; });
  for (const e of events) handlers.onevent(e);
  handlers.oneose();
  return last;
}

const hide = (at) => ({ tags: [['d', 'trinityone/hidden:m1'], ['t', 'g1']], created_at: at, content: '{}', pubkey: 'stewardA' });
const unhide = (at) => ({ tags: [['d', 'trinityone/hidden:m1'], ['t', 'g1'], ['deleted', '1']], created_at: at, content: '', pubkey: 'stewardB' });

for (const [label, bundle, anchor, opts] of [
  ['console', STEW, 'subscribeHidden(cb) {', {}],
  ['member',  FELL, 'subscribeHidden(groupId, cb) {', { memberSide: true }],
]) {
  test(`${label}: a NEWER un-hide wins however the events arrive`, () => {
    const inOrder = hiddenAfter(bundle, anchor, [hide(100), unhide(200)], opts);
    assert.equal(inOrder.has('m1'), false, `${label}: the newer un-hide did not put the message back`);
    // the same two decisions, delivered the other way round — which is entirely up to the relays
    const reversed = hiddenAfter(bundle, anchor, [unhide(200), hide(100)], opts);
    assert.equal(reversed.has('m1'), false,
      `${label}: whether a removed message comes back depends on which relay answered last. Two stewards ` +
      `moderating the same message are two documents; arrival order is not a decision`);
  });

  // NOT a both-ways control: the old code gets one of these two arrival orders wrong as well, so this
  // also goes red against 50e196c. It is here to stop the fix being "always un-hide", which would break
  // moderation entirely in the opposite direction.
  test(`${label}: the other direction: a newer HIDE still wins over an older un-hide`, () => {
    const a = hiddenAfter(bundle, anchor, [unhide(100), hide(200)], opts);
    const b = hiddenAfter(bundle, anchor, [hide(200), unhide(100)], opts);
    assert.equal(a.has('m1'), true, `${label}: a newer removal was ignored — moderation stopped working`);
    assert.equal(b.has('m1'), true, `${label}: a newer removal lost to an older un-hide on arrival order`);
  });
}

test('the console offers an Undo, and it calls unhideMessage', async () => {
  const src = readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8');
  const i = src.indexOf('const doRemove = (m) => {');
  assert.ok(i > 0, 'doRemove is no longer where this test expects it — re-anchor');
  const body = src.slice(i, i + 900);
  assert.match(body, /unhideMessage/,
    'removing a message still offers no way back, though unhideMessage is built on both surfaces and has ' +
    'been called by nothing since the feature landed');
  assert.match(body, /Couldn’t remove/,
    'a removal the relay refused is still indistinguishable from one it took');
});
