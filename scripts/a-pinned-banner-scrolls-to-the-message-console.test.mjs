// CONSOLE: TAPPING THE PINNED BANNER SCROLLS TO THE PINNED MESSAGE. Run:
//   node --test scripts/a-pinned-banner-scrolls-to-the-message-console.test.mjs
//
// Point of use (CLAUDE.md rules 1, 3): the real GroupChatModal is sliced out of app/stew-dashboard.jsx,
// compiled and RENDERED; assertions read the drawn tree. scrollIntoView can't run in the fake DOM, so this
// asserts the WIRING — the row DOM handles, the banner's tap handler, and that Unpin stops propagation.
//
// What was touched (rule 2): GroupChatModal in app/stew-dashboard.jsx — message rows gain data-msg-id={m.id};
// the pinned banner body becomes a role="button" with onClick={scrollToPinned} (which querySelects the row in
// the scroll container and scrollIntoViews it + a brief flash); the Unpin button's onClick now stopPropagation()s
// so tapping X unpins without scrolling. No caller signature changed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileSync, rmSync } from 'node:fs';
import { Stub, settle, ROOT } from './console-component-rig.mjs';
import { miniReact, find, texts } from './render-jsx-screen.mjs';
import { fnBody } from './test-slice.mjs';

const CHURCH = 'c'.repeat(64), RUTH = 'a'.repeat(64);
const ESBUILD = join(ROOT, 'node_modules/.bin/esbuild');
const SRC = readFileSync(join(ROOT, 'app/stew-dashboard.jsx'), 'utf8');
const MSGS = [
  { id: 'm1', by: RUTH, text: 'Can someone bring chairs?', ts: 1, mine: false },
  { id: 'm2', by: CHURCH, text: 'I will', ts: 2, mine: true },
];
const PIN = { msgId: 'm1', text: 'Can someone bring chairs?', by: RUTH, ts: 1 };

// Slice GroupChatModal (+ groupIcon) out of `src` (default = the real file; a sabotage passes a modified copy),
// compile it and inject the globals it reads. Mirrors console-component-rig loadComponent but takes source text.
async function loadGCM(src = SRC) {
  const pieces = [fnBody(src, 'function GroupChatModal({ group, onClose }) {', 'GroupChatModal'), fnBody(src, 'function groupIcon(', 'groupIcon')];
  const tmp = join(tmpdir(), 'pin-gcm-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, pieces.join('\n') + '\nexport { GroupChatModal, groupIcon };\n');
    js = execFileSync(ESBUILD, [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8', maxBuffer: 1 << 26 });
  } finally { rmSync(tmp, { force: true }); }
  const unpinCalls = [];
  const g = {
    React: null, window: {
      Steward: { pubkey: CHURCH, stewardLabels: () => ({}),
        subscribeGroupChat: (id, cb) => { cb(MSGS); return () => {}; },
        subscribeGroupPin: (id, cb) => { cb(PIN); return () => {}; },
        subscribeGroupEvents: (id, cb) => { cb([]); return () => {}; },
        publishPost: () => Promise.resolve({ id: 'e1' }), unpin: () => { unpinCalls.push(1); return Promise.resolve(true); } },
      useStewardMembers: () => [{ pubkey: RUTH, name: 'Ruth' }], useStewardChurch: () => ({ name: 'St Bride' }), useStewardStewards: () => [],
      dispatchEvent: () => true, addEventListener() {}, removeEventListener() {} },
    CustomEvent, setTimeout, clearTimeout, document: { addEventListener() {}, removeEventListener() {} },
    get TrinityReplyKit() { return globalThis.TrinityReplyKit; },
    Icon: Stub('Icon'), SkBadge: Stub('SkBadge'), useStewDialog: () => ({}),
    cardRenderable: () => false, ConsoleCard: Stub('ConsoleCard'),
  };
  const { React, draw } = miniReact();
  g.React = React; g.window.React = React;
  const key = '__pin_gcm_' + Math.random().toString(36).slice(2);
  globalThis[key] = g;
  const preamble = Object.keys(g).filter(k => k !== 'React' || true).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  const mod = await import('data:text/javascript;base64,' + Buffer.from(preamble + '\n' + js).toString('base64'));
  const props = { group: { id: 'g1', name: 'Whole Church', kind: 'group' }, onClose() {} };
  const paint = () => draw(mod.GroupChatModal, props);
  paint(); await settle(); const tree = paint();
  return { tree, unpinCalls };
}

const rowFor = (tree, id) => find(tree, n => n.props && n.props['data-msg-id'] === id)[0];
const bannerBtn = (tree) => find(tree, n => n.props && n.props.title === 'Go to the pinned message')[0];
const unpinBtn = (tree) => find(tree, n => n.type === 'button' && n.props && n.props.title === 'Unpin')[0];

test('every message row carries data-msg-id equal to its id', async () => {
  const { tree } = await loadGCM();
  assert.ok(rowFor(tree, 'm1'), 'the row for m1 has no data-msg-id handle');
  assert.ok(rowFor(tree, 'm2'), 'the row for m2 has no data-msg-id handle');
});

test('the pinned banner body is a tappable control with an onClick, distinct from the Unpin button', async () => {
  const { tree } = await loadGCM();
  const b = bannerBtn(tree);
  assert.ok(b, 'the pinned banner body is not a tappable control (title "Go to the pinned message" missing)');
  assert.equal(typeof b.props.onClick, 'function', 'the pinned banner body has no onClick');
  assert.equal(b.props.role, 'button', 'the pinned banner body is not a button affordance');
  assert.notEqual(b.props.title, 'Unpin', 'the banner body must not be the Unpin button');
});

test('tapping Unpin stops propagation (so it unpins without scrolling) and still unpins', async () => {
  const { tree, unpinCalls } = await loadGCM();
  const x = unpinBtn(tree);
  assert.ok(x, 'the Unpin button is missing');
  let stopped = 0;
  x.props.onClick({ stopPropagation: () => { stopped++; } });
  assert.equal(stopped, 1, 'the Unpin button does not stop propagation — tapping X would also scroll');
  assert.equal(unpinCalls.length, 1, 'Unpin no longer unpins');
});

test('SABOTAGE: removing data-msg-id from the row drops the handle; removing the banner onClick drops the tap', async () => {
  const noHandle = SRC.replace('<div key={m.id} data-msg-id={m.id} {...swipe(m)}', '<div key={m.id} {...swipe(m)}');
  assert.notEqual(noHandle, SRC, 'the row data-msg-id anchor did not match — re-scope');
  const { tree: t1 } = await loadGCM(noHandle);
  assert.ok(!rowFor(t1, 'm1'), 'the row still had a data-msg-id with the handle removed — the test is not pinned to it');

  const noTap = SRC.replace('onClick={scrollToPinned}', 'data-no-tap="1"');
  assert.notEqual(noTap, SRC, 'the banner onClick anchor did not match — re-scope');
  const { tree: t2 } = await loadGCM(noTap);
  const b = bannerBtn(t2);
  assert.ok(!b || typeof b.props.onClick !== 'function', 'the banner still had a tap handler with scrollToPinned removed');
});

// ── #6: the pinned banner is operable by KEYBOARD (Enter/Space), not mouse/touch only ───────────────────────
test('the pinned banner body handles Enter/Space (keyboard a11y)', async () => {
  const { tree } = await loadGCM();
  const b = bannerBtn(tree);
  assert.equal(typeof b.props.onKeyDown, 'function', 'the pinned banner has no onKeyDown — it is not keyboard-operable');
  let prevented = 0;
  b.props.onKeyDown({ key: 'Enter', preventDefault: () => { prevented++; } });
  b.props.onKeyDown({ key: ' ', preventDefault: () => { prevented++; } });
  assert.equal(prevented, 2, 'Enter and Space are not handled by the banner');
  let other = 0;
  b.props.onKeyDown({ key: 'a', preventDefault: () => { other++; } });
  assert.equal(other, 0, 'a non-activation key should be ignored by the banner');
});

test('SABOTAGE (console banner keyboard): removing onKeyDown drops keyboard operation', async () => {
  const noKey = SRC.replace(/onKeyDown=\{\(e\) => \{ if \(e\.key === 'Enter' \|\| e\.key === ' '\) \{ e\.preventDefault\(\); scrollToPinned\(\); \} \}\} title="Go to the pinned message"/, 'title="Go to the pinned message"');
  assert.notEqual(noKey, SRC, 'the banner onKeyDown anchor did not match — re-scope');
  const { tree } = await loadGCM(noKey);
  const b = bannerBtn(tree);
  assert.ok(!b || typeof b.props.onKeyDown !== 'function', 'the banner still had onKeyDown after removal');
});
