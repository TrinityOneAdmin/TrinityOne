// COMPARE MODE SHOWS A SECOND VERSION PILL THAT LETS THE READER PICK THE COMPARISON TRANSLATION.
// Run: node --test scripts/compare-version-picker-pill.test.mjs
//
// Point-of-use (CLAUDE.md rule 1): the REAL ReadHeader is loaded from app/screens-read.jsx through
// loadScreen + miniReact and DRAWN. The test taps the pill a member would tap. Nothing here matches
// text in app/*.jsx (rule 3).
//
// Users of what changed (rule 2): ReadHeader gains two optional props (cmpAbbr, onCompareVersion).
// Its one caller is ReadScreen (line ~1911). VersionSheet is reused unchanged with different onPick.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScreen, miniReact, find, reads } from './render-jsx-screen.mjs';

function header(opts = {}) {
  const { React, draw } = miniReact();
  const calls = { compare: 0, cmpVersion: 0, version: 0 };
  const Icon = ({ name }) => React.createElement('i', { 'data-icon': name });
  const IconBtn = (p) => React.createElement('button', { 'data-iconbtn': p.name, onClick: p.onClick, style: p.style }, React.createElement(Icon, { name: p.name }));
  const mod = loadScreen('app/screens-read.jsx', ['ReadHeader'], {
    React, Icon, IconBtn,
    ReadPlansTabs: () => React.createElement('div', { 'data-stub': 'tabs' }),
    window: {},
  });
  const props = {
    ctx: {}, loc: { book: 'John', ch: 3 }, version: 'KJV',
    onBook() {}, onChapter() {}, onVersion() { calls.version++; },
    onSettings() {}, onCompare() { calls.compare++; },
    onListen() {}, narrating: false, canListen: false,
    compare: opts.compare || false,
    cmpAbbr: opts.cmpAbbr || null,
    onCompareVersion() { calls.cmpVersion++; },
  };
  return { calls, draw: () => draw(mod.ReadHeader, props) };
}

const versionPills = (tree) => find(tree, n => n.type === 'button' && n.props && n.props.style && n.props.style.fontWeight === 700 && n.props.style.fontSize === 13);
const comparePill = (tree) => find(tree, n => n.type === 'button' && n.props && n.props['data-tour'] === 'compare-version')[0];

test('compare off: no second version pill', () => {
  const h = header({ compare: false, cmpAbbr: null });
  const t = h.draw();
  assert.equal(comparePill(t), undefined, 'a compare pill appeared when compare is off');
});

test('compare on with cmpAbbr: a second version pill shows the compare translation', () => {
  const h = header({ compare: true, cmpAbbr: 'BSB' });
  const t = h.draw();
  const pill = comparePill(t);
  assert.ok(pill, 'no compare version pill when compare is on');
  assert.ok(reads(pill).includes('BSB'), 'the pill does not show the compare abbr; got: ' + reads(pill));
});

test('tapping the compare pill fires onCompareVersion, not onVersion', () => {
  const h = header({ compare: true, cmpAbbr: 'BSB' });
  const t = h.draw();
  comparePill(t).props.onClick();
  assert.equal(h.calls.cmpVersion, 1, 'onCompareVersion was not called');
  assert.equal(h.calls.version, 0, 'onVersion was called — the tap went to the wrong picker');
});

test('compare on but cmpAbbr null (single translation): no compare pill', () => {
  const h = header({ compare: true, cmpAbbr: null });
  const t = h.draw();
  assert.equal(comparePill(t), undefined, 'a compare pill appeared with no second translation');
});
