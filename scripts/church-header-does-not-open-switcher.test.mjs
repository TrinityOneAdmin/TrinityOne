// THE COMMUNITY HEADER NO LONGER OPENS THE CHURCH SWITCHER (owner 2026-10-16).
//   Run: node --test scripts/church-header-does-not-open-switcher.test.mjs
//
// The church banner/pill used to be a button that opened the "Your churches" switcher (with a chevron). The
// owner moved that access to You -> "Follow a church" (identity.jsx, already present), so the header is now
// display-only. This renders the shipped ChurchPill (both the banner and the compact variant) and proves no
// control in it calls ctx.openChurchSwitcher. Rule 3: reads the drawn tree, not source text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScreen, miniReact, find } from './render-jsx-screen.mjs';

function pill({ banner = false } = {}) {
  const { React, draw } = miniReact();
  const Stub = (n) => function S(p) { return React.createElement('div', { 'data-stub': n }, p && p.children); };
  const { ChurchPill } = loadScreen('app/screens-church.jsx', ['ChurchPill'], {
    React, console,
    Icon: ({ name }) => React.createElement('i', { 'data-icon': name }),
    ChurchBadge: Stub('ChurchBadge'),
    safeImgUrl: (u) => u || '', safeCssColor: (c) => c,
    window: {}, document: { querySelector: () => null },
  });
  let switched = 0;
  const ctx = { church: { name: 'Pixel Test 1013', banner: banner ? 'data:image/png;base64,AA' : '' },
    openChurchSwitcher: () => { switched++; } };
  const tree = draw(ChurchPill, { ctx });
  return { tree, switched: () => switched };
}

for (const banner of [false, true]) {
  test(`the ${banner ? 'banner' : 'compact'} church header has no control that opens the switcher`, () => {
    const p = pill({ banner });
    const clickers = find(p.tree, n => n.props && typeof n.props.onClick === 'function');
    for (const c of clickers) c.props.onClick({ stopPropagation() {}, preventDefault() {} });
    assert.equal(p.switched(), 0,
      'a control in the church header still opens the switcher — the owner moved that to You -> Follow a church');
  });
}

test('the header still shows the church name (it is a display, not a dead button)', () => {
  const { loadScreen: ls, miniReact: mr } = { loadScreen, miniReact };
  const p = pill({ banner: false });
  const { texts } = { texts: (n, out = []) => { if (n == null) return out; if (Array.isArray(n)) { n.forEach(x => texts(x, out)); return out; } if (typeof n === 'object') { (n.kids || []).forEach(x => texts(x, out)); } else { out.push(String(n)); } return out; } };
  assert.ok(texts(p.tree).join(' ').includes('Pixel Test 1013'), 'the church name no longer shows in the header');
});
