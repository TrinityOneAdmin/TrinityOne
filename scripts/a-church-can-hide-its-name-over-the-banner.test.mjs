// A CHURCH CAN HIDE ITS NAME TEXT OVER THE BANNER (owner 2026-11-06, pilot UI #5).
//   Run: node --test scripts/a-church-can-hide-its-name-over-the-banner.test.mjs
//
// When a church's banner IMAGE already shows its name, printing the name AGAIN as text over the top is
// redundant. A per-church steward switch (console branding panel) sets `features.hideChurchName`; the member
// app reads it and drops the overlaid name — but ONLY on the banner header. The compact (no-banner) header has
// no image carrying the name, so it must always show it.
//
// POINT OF USE (CLAUDE.md rule 1): this renders the SHIPPED ChurchPill from app/screens-church.jsx and reads
// the drawn tree. If the gate on the banner name span is deleted, case 1 goes red (the name renders anyway).
// Rule 3: nothing matches text in app/*.jsx — the component is compiled and run, and the tree is inspected.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScreen, miniReact, texts } from './render-jsx-screen.mjs';

function pill(church) {
  const { React, draw } = miniReact();
  const Stub = (n) => function S(p) { return React.createElement('div', { 'data-stub': n }, p && p.children); };
  const { ChurchPill } = loadScreen('app/screens-church.jsx', ['ChurchPill'], {
    React, console,
    Icon: ({ name }) => React.createElement('i', { 'data-icon': name }),
    ChurchBadge: Stub('ChurchBadge'),
    safeImgUrl: (u) => u || '', safeCssColor: (c) => c,
    window: {}, document: { querySelector: () => null },
  });
  return draw(ChurchPill, { ctx: { church } });
}

const NAME = 'St Aidan of Netherby';
const BANNER = 'data:image/png;base64,AA';

test('banner + hideChurchName ON: the church name is NOT drawn over the banner', () => {
  const tree = pill({ name: NAME, banner: BANNER, features: { hideChurchName: true } });
  assert.ok(!texts(tree).join(' ').includes(NAME),
    'THE DEFECT: the church name still renders over the banner even though the church turned it off');
});

test('banner + hideChurchName OFF/absent: the church name IS drawn over the banner', () => {
  const on = pill({ name: NAME, banner: BANNER, features: {} });
  assert.ok(texts(on).join(' ').includes(NAME), 'the banner name vanished with the flag OFF — the gate is inverted or always-hiding');
  const absent = pill({ name: NAME, banner: BANNER });
  assert.ok(texts(absent).join(' ').includes(NAME), 'a church with no features map lost its banner name — the default must be to SHOW it');
});

test('NO banner + hideChurchName ON: the compact header still shows the name (nothing else carries it)', () => {
  const tree = pill({ name: NAME, features: { hideChurchName: true } });
  assert.ok(texts(tree).join(' ').includes(NAME),
    'the compact (no-banner) header hid the name — the flag must only affect the banner overlay, where an image carries the name');
});
