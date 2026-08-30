// REMOVING AN ABUSIVE POST MUST LOOK LIKE SOMETHING IS HAPPENING.
// Run: node --test scripts/moderation-shows-its-work.test.mjs
//
// AUDIT 2026-08-30, and this one is a REGRESSION we caused. Commit e06cb36 stopped the three moderation
// controls (pin / unpin / remove) claiming success over a publish that had failed — right, and it stands.
// But reporting the real outcome means AWAITING the publish, and the publish they used, `_publishAny`,
// raises every relay's give-up to WEDGE_ACK_MS = 11s and then waits on all of them. Nothing else changed:
//
//   · the actions menu closed on the tap, so the leader's own control vanished;
//   · the post stayed on screen — it only goes when the tombstone echoes back on the subscription;
//   · no spinner, no dimmed control, no line of text anywhere said the app had heard them;
//   · nothing stopped a second, third, fourth tap, each one publishing again;
//   · the pinned banner's ✕ gave no feedback of any kind.
//
// So a leader removing a phone number a child had posted looked at an unchanged screen for up to eleven
// seconds. That is arguably worse than the instant lie it replaced, and it happens at the exact moment the
// person is least able to wait and most likely to keep tapping.
//
// Three fixes, all asserted here:
//   1. a busy line that is actually ON THE SCREEN while the publish is in flight (rendered, not lifted);
//   2. a re-entry guard that a double tap cannot race past, and disabled controls so it is visible;
//   3. src/fellowship.src.js publishes these BOUNDED, so the wait ends at PUBLISH_TIMEOUT_MS (12s) instead
//      of whenever a silent socket feels like settling.
// …and the honest outcome reporting from e06cb36 still works, both ways round.
//
// CLAUDE.md rule 3: nothing here matches text in app/*.jsx. The screen is COMPILED AND RENDERED and the
// assertions read the resulting tree; the bundle check at the bottom reads vendor/fellowship.js, where the
// bundler removes dead code so a disabled branch really does disappear.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadScreen, miniReact, texts, find } from './render-jsx-screen.mjs';
import { fnBody, stripComments } from './test-slice.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const tick = () => new Promise(r => setTimeout(r, 0));

const GROUP = { id: 'g1', name: 'Youth', accent: 'var(--clay)', kind: 'Group' };
const POST = { id: 'm1', pubkey: 'themhex', handle: 'sam', text: 'call me on 07700 900123', _ts: 1756500000 };

// A ChatRoom wired to a relay we control: `settle` decides when — and how — the moderation publish finishes.
function room({ pinned = null } = {}) {
  const { React, draw } = miniReact();
  const calls = { pin: 0, unpin: 0, hide: 0 };
  const toasts = [];
  let release = null;
  const pending = () => new Promise((res, rej) => { release = { res, rej }; });
  const Fellowship = {
    myPubkey: 'mehex',
    relays: ['wss://relay.example'],
    relayReady: () => true,
    groupEncState: () => 'clear',
    pinPost: () => { calls.pin++; return pending(); },
    unpin: () => { calls.unpin++; return pending(); },
    hideMessage: () => { calls.hide++; return pending(); },
    react: () => {},
    requestProfiles: () => {},
    outboxFor: () => [],
    onOutbox: () => () => {},
    // one real message in the room — the thing a leader is trying to remove
    subscribeGroup: (_gid, add) => { add({ id: POST.id, pubkey: POST.pubkey, kind: 1, created_at: POST._ts, tags: [], content: POST.text }); return () => {}; },
    subscribeReactions: () => () => {},
    subscribeGroupPin: (_gid, cb) => { cb(pinned); return () => {}; },
    subscribeHidden: (_gid, cb) => { cb(new Set()); return () => {}; },
    subscribeMessageTags: (_np, cb) => { cb([]); return () => {}; },
    displayFor: () => ({ handle: 'sam', color: '#888' }),
    canAddGroupEvent: () => false,
  };
  const win = {
    Fellowship,
    TrinityData: { CHAT_IDENTITY: { handle: 'me', color: '#123456' }, GROUPS: [], RELAYS: [] },
    TrinityIdentity: { current: { handle: 'me', color: '#123456' } },
    addEventListener: () => {}, removeEventListener: () => {},
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    confirm: () => true,
  };
  const mod = loadScreen('app/screens-chat.jsx', ['ChatRoom'], {
    React,
    window: win,
    document: { createElement: () => ({ style: {}, appendChild() {}, remove() {}, click() {} }), body: { appendChild() {}, removeChild() {} }, addEventListener() {}, removeEventListener() {} },
    location: { search: '', href: 'https://app.trinityone.church/' },
    // Timers are stubbed so the polled connection/encryption reads never fire and nothing keeps the test
    // process alive. Neither is under test here.
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    lsGet: (_k, d) => d, lsSet: () => {},
    todayISO: () => '2026-08-30',
    Icon: () => null,
    IconBtn: ({ name }) => React.createElement('button', { title: name }),
    // the shell components render their children and nothing else, so the room's own markup is what the
    // assertions below see
    // the real Overlay renders nothing while `open` is false (app/ui.jsx); the room under test is open
    Overlay: ({ open, children }) => (open ? children : null),
    UserAvatar: () => null, SectionLabel: ({ children }) => children, BottomSheet: ({ children }) => children,
    safeCssColor: (c) => c,
    D: { GROUPS: [], RELAYS: [] },
  });
  const ctx = {
    toast: (m) => toasts.push(m),
    church: { npub: 'npub1church', name: 'Trinity LA', id: 'c1' },
    myLeaderGroups: [{ id: 'g1' }],
    churchEvents: [],
    safeguard: {},
    myPubkey: 'mehex',
    openDM: () => {},
  };
  const render = () => draw(mod.ChatRoom, { group: GROUP, open: true, onClose: () => {}, ctx, docked: true });
  render();                       // first pass: effects deliver the pin / hidden set / messages
  return {
    draw: render,
    calls, toasts,
    finish: (v) => { release.res(v); return tick().then(tick); },
    fail: (e) => { release.rej(e); return tick().then(tick); },
  };
}

// The busy line is whatever the screen puts up with role="status" — read out of the tree, never matched
// against the source.
const busyLine = (tree) => find(tree, n => n.props && n.props.role === 'status').map(n => texts(n).join(' ')).join(' | ');

test('CONTROL: the room renders, and Remove reaches Fellowship.hideMessage', async () => {
  // If this fails, every assertion below is meaningless.
  const r = room();
  const tree = r.draw();
  const dots = find(tree, n => n.type === 'button' && n.props.title === 'Message actions');
  assert.ok(dots.length, 'the leader actions button is gone from the room — re-anchor this test');
  dots[0].props.onClick();
  const remove = find(r.draw(), n => n.type === 'button' && texts(n).join(' ').includes('Remove message'));
  assert.equal(remove.length, 1, 'the Remove control is gone from the actions menu — re-anchor this test');
  remove[0].props.onClick();
  assert.equal(r.calls.hide, 1, 'Remove no longer asks the relay to hide anything at all');
});

test('while the removal is in flight the room SAYS SO — the whole regression', async () => {
  const r = room();
  find(r.draw(), n => n.type === 'button' && n.props.title === 'Message actions')[0].props.onClick();
  find(r.draw(), n => n.type === 'button' && texts(n).join(' ').includes('Remove message'))[0].props.onClick();
  const during = r.draw();
  assert.match(busyLine(during), /Removing/,
    'the leader tapped Remove on an abusive post, the menu closed over it, the post stayed exactly where ' +
    'it was, and NOTHING on the screen said the app had heard them — for up to eleven seconds');
  await r.finish({ id: 'tombstone' });
  const after = r.draw();
  assert.equal(busyLine(after), '', 'the busy line never clears, so the room now looks permanently stuck');
  assert.deepEqual(r.toasts, ['Message removed'], 'the honest outcome reporting from e06cb36 was lost');
});

test('a second tap during those seconds does not publish a second time', async () => {
  // The pinned banner's ✕ is the control that STAYS on screen through its own action — the menu ones close
  // — so it is the one a worried leader really can hit twice, and the auditor's "zero feedback" case.
  const r = room({ pinned: { msgId: 'm1', text: 'call me on 07700 900123', by: 'themhex', ts: 1756500000 } });
  const x = find(r.draw(), n => n.type === 'button' && n.props.title === 'Unpin');
  assert.equal(x.length, 1, 'the pinned banner no longer offers Unpin — re-anchor this test');
  x[0].props.onClick();
  const during = r.draw();
  assert.match(busyLine(during), /Unpinning/, 'the banner ✕ still gives the leader no feedback whatsoever');
  const again = find(during, n => n.type === 'button' && n.props.title === 'Unpin')[0];
  assert.equal(again.props.disabled, true, 'nothing on screen shows the control is already working');
  again.props.onClick();
  assert.equal(r.calls.unpin, 1,
    'a second tap published a second unpin. Every tap in those eleven seconds was another event on the ' +
    'relay, and the reason people tap again is that the first tap looked like it did nothing');
  await r.finish({ id: 'tombstone' });
  assert.deepEqual(r.toasts, ['Unpinned']);
  assert.equal(find(r.draw(), n => n.type === 'button' && n.props.title === 'Unpin')[0].props.disabled, false,
    'the control never becomes usable again — one failed unpin would lock the banner for the session');
});

// THE CONTROLS INSIDE A BUBBLE FOLLOW THE BUSY STATE — AND STOP FOLLOWING IT WHEN IT ENDS.
//
// Added 2026-08-30 after the harness was taught to honour useMemo dependency arrays. The bubbles are built
// by a memo whose deps end in `modBusy`; every other test here changes `menuFor` in the same breath (the
// menu closes on the tap), so all five stayed green with `modBusy` deleted from that array. This is the one
// sequence where `modBusy` moves on its own: the leader unpins from the BANNER, whose ✕ leaves the bubble
// menus alone, and then opens a message's menu while that publish is still in flight. When the unpin lands,
// nothing else about the thread has changed — so if the memo is not listening for it, the Pin and Remove
// buttons under their thumb stay greyed out and dead over a room that is no longer busy at all.
test('the in-bubble Pin and Remove controls follow the busy state, and are released when it ends', async () => {
  const r = room({ pinned: { msgId: 'm1', text: 'call me on 07700 900123', by: 'themhex', ts: 1756500000 } });
  const modItems = (tree) => find(tree, n => n.type === 'button' &&
    /Pin message|Unpin message|Remove message/.test(texts(n).join(' ')));

  // unpin from the banner: this sets the busy state WITHOUT touching which bubble menu is open
  find(r.draw(), n => n.type === 'button' && n.props.title === 'Unpin')[0].props.onClick();
  // …and now open a message's actions menu, mid-publish
  find(r.draw(), n => n.type === 'button' && n.props.title === 'Message actions')[0].props.onClick();
  const during = modItems(r.draw());
  assert.equal(during.length, 2, 'the bubble menu no longer offers Pin and Remove — re-anchor this test');
  assert.ok(during.every(b => b.props.disabled === true),
    'a moderation publish is in flight and the controls in the message menu are still live — a second tap ' +
    'from here publishes again, which is the regression this file exists for');

  await r.finish({ id: 'tombstone' });
  const after = modItems(r.draw());
  assert.equal(after.length, 2, 'the bubble menu emptied when the unpin finished');
  assert.ok(after.every(b => b.props.disabled === false),
    'the unpin finished and the Pin/Remove controls in the open menu are still disabled and dimmed. The ' +
    'thread is not busy any more; the leader is looking at dead buttons over a room that is working');
});

test('…and a moderation action that FAILED still says so, and lets them try again', async () => {
  for (const [what, settle] of [['a refusal', (r) => r.finish(null)], ['a thrown error', (r) => r.fail(new Error('timeout'))]]) {
    const r = room();
    find(r.draw(), n => n.type === 'button' && n.props.title === 'Message actions')[0].props.onClick();
    find(r.draw(), n => n.type === 'button' && texts(n).join(' ').includes('Remove message'))[0].props.onClick();
    await settle(r);
    assert.equal(r.toasts.length, 1, `${what}: the leader was told nothing`);
    assert.match(r.toasts[0], /still visible to the group/,
      `${what}: the post is still there and the leader was not told — this is what e06cb36 fixed`);
    assert.equal(busyLine(r.draw()), '', `${what}: the busy line is stuck on screen after a failure`);
    // and the guard released, so a retry is possible
    find(r.draw(), n => n.type === 'button' && n.props.title === 'Message actions')[0].props.onClick();
    find(r.draw(), n => n.type === 'button' && texts(n).join(' ').includes('Remove message'))[0].props.onClick();
    assert.equal(r.calls.hide, 2, `${what}: the leader can never retry — the guard was never released`);
  }
});

test('the moderation publishes are BOUNDED in the shipped bundle', () => {
  // Reading vendor/*.js, not app/*.jsx: the bundler removes dead code there, so a call that is no longer
  // reachable really does vanish and this cannot be satisfied by a disabled branch. Comments are stripped
  // so the note ABOVE these functions cannot satisfy the check either (the `assertOrder` lesson).
  const SRC = readFileSync(join(ROOT, 'vendor/fellowship.js'), 'utf8');
  for (const sig of ['async pinPost(churchNpub, groupId, msg) {', 'async unpin(churchNpub, groupId) {',
                     'async hideMessage(churchNpub, groupId, msgId) {', 'async unhideMessage(churchNpub, groupId, msgId) {']) {
    const body = stripComments(fnBody(SRC, sig, sig));
    assert.match(body, /_publishBounded\(/,
      sig + ' does not use the bounded publish, so a silent relay leaves the leader waiting with no end');
    assert.doesNotMatch(body, /_publishAny\(/,
      sig + ' still uses _publishAny, which raises every relay to WEDGE_ACK_MS (11s) and waits on all of them');
  }
});
