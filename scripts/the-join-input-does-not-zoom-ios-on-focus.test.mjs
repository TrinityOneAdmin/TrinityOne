// THE CHURCH-JOIN INPUT IS >= 16px, so iOS WKWebView does not auto-zoom the whole app on focus.
//   Run: node --test scripts/the-join-input-does-not-zoom-ios-on-focus.test.mjs
//
// WHY (2026-11-25): on a real iPhone, opening Community -> "join a church" zoomed the entire app in. iOS
// zooms a WKWebView when a focused text field's font is < 16px, and the join input (FollowChurch in
// app/screens-church.jsx) carries `autoFocus`, so it zooms the MOMENT the join screen opens — and the zoom
// sticks until the app is relaunched. The field (and the camera-fallback paste textarea) were 14px / 13px.
// Pinned to 16px. This had regressed before (the networks client-engine change), hence this guard.
//
// POINT OF USE (CLAUDE.md rules 1+3): renders the SHIPPED FollowChurch and QRScanner from
// app/screens-church.jsx via loadScreen + miniReact and reads the drawn tree. If the input is dead-coded
// or removed, the test fails because the element is not in the rendered output — unlike a source-text regex,
// which would still match dead code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScreen, miniReact, find } from './render-jsx-screen.mjs';

function renderFollowChurch() {
  const { React, draw } = miniReact();
  const Stub = (n) => function S(p) { return React.createElement('div', { 'data-stub': n }, p && p.children); };
  const { FollowChurch } = loadScreen('app/screens-church.jsx', ['FollowChurch'], {
    React, console, URLSearchParams, location: { search: '' },
    Icon: ({ name }) => React.createElement('i', { 'data-icon': name }),
    IconBtn: Stub('IconBtn'), ChurchBadge: Stub('ChurchBadge'),
    BottomSheet: ({ children }) => React.createElement('div', { 'data-sheet': 1 }, children),
    safeImgUrl: (u) => u || '', safeCssColor: (c) => c,
    window: { makeNameDisambiguator: (_l, name) => (c) => name(c) }, document: { querySelector: () => null },
    navigator: { mediaDevices: null },
  });
  const ctx = { followChurch: () => false };
  return draw(FollowChurch, { onBack: () => {}, onFollowed: () => {}, ctx });
}

function renderQRScanner() {
  const { React, draw } = miniReact();
  const Stub = (n) => function S(p) { return React.createElement('div', { 'data-stub': n }, p && p.children); };
  const { QRScanner } = loadScreen('app/screens-church.jsx', ['QRScanner'], {
    React, console, URLSearchParams, location: { search: '' },
    Icon: ({ name }) => React.createElement('i', { 'data-icon': name }),
    IconBtn: Stub('IconBtn'), ChurchBadge: Stub('ChurchBadge'),
    BottomSheet: ({ children }) => React.createElement('div', { 'data-sheet': 1 }, children),
    safeImgUrl: (u) => u || '', safeCssColor: (c) => c,
    window: { ensureJsQR: null }, document: { querySelector: () => null },
    navigator: { mediaDevices: null },
  });
  const props = { onResult: () => {}, onCancel: () => {}, prompt: 'Scan', onManual: () => {}, manualPrompt: 'Paste' };
  draw(QRScanner, props);
  return draw(QRScanner, props);
}

test('the church-join input (autoFocus) is >= 16px so iOS does not zoom on focus', () => {
  const tree = renderFollowChurch();
  const inputs = find(tree, n => n && n.type === 'input' && n.props && n.props['aria-label'] === 'Church name, code, or invite link');
  assert.ok(inputs.length > 0, 'the join input is not in the rendered FollowChurch — it may have been removed or dead-coded');
  const fs = inputs[0].props.style && inputs[0].props.style.fontSize;
  assert.ok(typeof fs === 'number' && fs >= 16,
    `the join input font is ${fs}px — iOS auto-zooms a focused input < 16px, and this one autoFocuses on screen open; keep it >= 16`);
});

test('the camera-fallback paste textarea is also >= 16px', () => {
  const tree = renderQRScanner();
  const areas = find(tree, n => n && n.type === 'textarea' && n.props && n.props['data-qr-manual']);
  assert.ok(areas.length > 0, 'the paste textarea is not in the rendered QRScanner — it may have been removed or dead-coded');
  const fs = areas[0].props.style && areas[0].props.style.fontSize;
  assert.ok(typeof fs === 'number' && fs >= 16,
    `the paste textarea font is ${fs}px — keep it >= 16 to avoid iOS focus-zoom`);
});
