// CONSOLE GROUP CHAT: REPLY, ON THE SCREEN. Run: node --test scripts/a-console-group-reply-ui.test.mjs
//
// Point of use (CLAUDE.md rules 1 and 3): the real GroupChatModal is sliced out of app/stew-dashboard.jsx,
// compiled and RENDERED through the mini React; the handlers a finger would trigger are called and the drawn
// tree is read. Nothing matches text in app/*.jsx. The engine half is a-console-group-reply-engine.test.mjs.
//
// Users of the code touched (rule 2): GroupChatModal is mounted in three places in app/stew-dashboard.jsx
// (the groups list, the group sheet and the docked chat tray). publishPost gains an optional third argument;
// its other caller (NewPostModal) passes two and is untouched. The existing menu keeps Pin and Remove.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadComponent, Stub, settle } from './console-component-rig.mjs';
import { miniReact, find, texts } from './render-jsx-screen.mjs';

const CHURCH = 'c'.repeat(64), RUTH = 'a'.repeat(64);
const MSGS = [
  { id: 'm1', by: RUTH, text: 'Can someone bring chairs?', ts: 1, mine: false },
  { id: 'm2', by: CHURCH, text: 'I will', ts: 2, mine: true, replyTo: 'm1', quote: { id: 'm1', by: RUTH, text: 'Can someone bring chairs?' } },
  { id: 'm3', by: RUTH, text: 'a reply to something old', ts: 3, mine: false, replyTo: 'old', quote: null },
];

async function chat({ native = false, publish } = {}) {
  const { React, draw } = miniReact();
  const calls = [];
  const win = {
    Steward: {
      pubkey: CHURCH, stewardLabels: () => ({}),
      subscribeGroupChat: (id, cb) => { cb(MSGS); return () => {}; },
      subscribeGroupPin: (id, cb) => { cb(null); return () => {}; },
      subscribeGroupEvents: (id, cb) => { cb([]); return () => {}; },
      publishPost: (...a) => { calls.push(a); return publish ? publish(...a) : Promise.resolve({ id: 'e1' }); },
    },
    Capacitor: native ? { isNativePlatform: () => true } : undefined,
    useStewardMembers: () => [{ pubkey: RUTH, name: 'Ruth' }], useStewardChurch: () => ({ name: 'St Bride’s' }), useStewardStewards: () => [],
    dispatchEvent: () => true, addEventListener() {}, removeEventListener() {},
  };
  const mod = await loadComponent('app/stew-dashboard.jsx', 'function GroupChatModal({ group, onClose }) {', {
    React, window: win, CustomEvent, setTimeout, clearTimeout,
    get TrinityReplyKit() { return globalThis.TrinityReplyKit; },
    Icon: Stub('Icon'), SkBadge: Stub('SkBadge'), useStewDialog: () => ({}),
  });
  const props = { group: { id: 'g1', name: 'Whole Church', kind: 'group' }, onClose() {} };
  const paint = () => draw(mod.GroupChatModal, props);
  paint(); await settle();
  paint();
  const dots = (t, i) => find(t, n => n.type === 'button' && n.props.title === 'Moderate')[i];
  const menuLabels = (t) => find(t, n => n.type === 'button' && /Reply$|Pin message|Unpin message|Remove message/.test(texts(n).join('').trim())).map(n => texts(n).join('').trim());
  const bar = (t) => find(t, n => n.props && n.props['aria-label'] === 'Stop replying')[0];
  const input = (t) => find(t, n => n.type === 'input' && n.props.placeholder === 'Message your church…')[0];
  const sendBtn = (t) => find(t, n => n.type === 'button' && n.props.title === 'Send this message')[0];
  const replyBtn = (t) => find(t, n => n.type === 'button' && /Reply$/.test(texts(n).join('').trim()) && !n.props['aria-label'])[0];
  return { paint, calls, dots, menuLabels, bar, input, sendBtn, replyBtn };
}
const flush = async () => { await settle(); await settle(); };

test('the ⋯ menu offers Reply AND still offers Pin and Remove', async () => {
  const c = await chat();
  c.dots(c.paint(), 0).props.onClick();
  const labels = c.menuLabels(c.paint());
  assert.ok(labels.some(l => /Reply$/.test(l)), 'no Reply in the menu: ' + labels);
  assert.ok(labels.some(l => /Pin message/.test(l)), 'Pin was lost');
  assert.ok(labels.some(l => /Remove message/.test(l)), 'Remove was lost');
});

test('choosing Reply shows the "replying to" bar, closes the menu, and cancel clears it', async () => {
  const c = await chat();
  assert.equal(c.bar(c.paint()), undefined, 'a reply bar with nothing chosen');
  c.dots(c.paint(), 0).props.onClick();
  c.replyBtn(c.paint()).props.onClick();
  const t = c.paint();
  assert.ok(c.bar(t), 'no reply bar after choosing Reply');
  const said = texts(t).join('');
  assert.match(said, /Replying to Ruth/);
  assert.equal(c.replyBtn(t), undefined, 'the menu stayed open');
  c.bar(t).props.onClick();
  assert.equal(c.bar(c.paint()), undefined, 'cancel did not clear the reply');
});

test('send passes the reply {id, by} to publishPost and clears the bar once it is accepted', async () => {
  const c = await chat();
  c.dots(c.paint(), 0).props.onClick();
  c.replyBtn(c.paint()).props.onClick();
  c.input(c.paint()).props.onChange({ target: { value: 'On my way' } });
  c.sendBtn(c.paint()).props.onClick();
  await flush();
  assert.deepEqual(c.calls, [['On my way', 'g1', { id: 'm1', by: RUTH }]]);
  const t = c.paint();
  assert.equal(c.bar(t), undefined, 'the bar stayed after an accepted send');
  assert.equal(c.input(t).props.value, '');
});

test('a plain send passes no reply', async () => {
  const c = await chat();
  c.input(c.paint()).props.onChange({ target: { value: 'Hello' } });
  c.sendBtn(c.paint()).props.onClick();
  await flush();
  assert.deepEqual(c.calls, [['Hello', 'g1', undefined]]);
});

test('a send nobody accepted KEEPS the reply and the words (resolved false, and thrown)', async () => {
  for (const publish of [() => Promise.resolve(false), () => Promise.reject(new Error('down'))]) {
    const c = await chat({ publish });
    c.dots(c.paint(), 0).props.onClick();
    c.replyBtn(c.paint()).props.onClick();
    c.input(c.paint()).props.onChange({ target: { value: 'On my way' } });
    c.sendBtn(c.paint()).props.onClick();
    await flush();
    const t = c.paint();
    assert.ok(c.bar(t), 'the failed send dropped the reply');
    assert.equal(c.input(t).props.value, 'On my way');
    assert.match(texts(t).join(' | '), /didn’t send/);
  }
});

test('a reply shows its quote; one whose target is not loaded says so', async () => {
  const c = await chat();
  const said = texts(c.paint()).join(' | ');
  assert.ok(said.split('Can someone bring chairs?').length >= 3, 'the quote of m1 is not drawn above m2');
  assert.match(said, /replying to an earlier message/);
});

test('APK: dragging a row right past the arm starts a reply; the web console has no swipe row', async () => {
  const touch = (x, y) => ({ touches: [{ clientX: x, clientY: y }], changedTouches: [{ clientX: x, clientY: y }] });
  const rows = (t) => find(t, n => n.props && n.props.onTouchStart);
  const c = await chat({ native: true });
  assert.equal(rows(c.paint()).length, 3);
  const r = rows(c.paint())[0];
  r.props.onTouchStart(touch(10, 10));
  r.props.onTouchMove(touch(70, 12));
  r.props.onTouchEnd({ changedTouches: [{ clientX: 70, clientY: 12 }] });
  assert.ok(c.bar(c.paint()), 'a swipe past the arm did not start a reply');
  const w = await chat({ native: false });
  assert.equal(rows(w.paint()).length, 0);
});
