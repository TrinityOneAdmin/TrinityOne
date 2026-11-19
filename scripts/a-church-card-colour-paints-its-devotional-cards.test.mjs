// A CHURCH'S CARD COLOUR PAINTS ITS DEVOTIONAL AND READING PLAN CARDS (owner 2026-11-19).
//   Run: node --test scripts/a-church-card-colour-paints-its-devotional-cards.test.mjs
//
// A church has three colours. ACCENT (buttons, links, highlights) and MAIN (header, badge) are unchanged.
// CARD (`cardColor` on the kind-0 profile, strict #RRGGBB or '') paints the devotional, reading plan and
// verse-prompt cards. With CARD unset every surface falls back to sage green, exactly as it was before.
//
// These tests exercise the HELPER FUNCTIONS from app/ui.jsx — churchCardColor and churchCardGradient —
// which are the validation layer that every surface calls. If they reject a value, no surface paints it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScreen } from './render-jsx-screen.mjs';

function helpers() {
  const React = { createElement() {} };
  return loadScreen('app/ui.jsx', ['churchCardColor', 'churchCardGradient'], {
    React, window: {}, document: { addEventListener() {}, removeEventListener() {}, querySelector: () => null, createElement: () => ({}) },
    navigator: { userAgent: '' }, location: { search: '', hostname: 'x' }, localStorage: { getItem: () => null, setItem() {} },
    setTimeout, clearTimeout, console, Icon: () => null,
  });
}

test('churchCardColor returns the hex when a valid #RRGGBB is given', () => {
  const h = helpers();
  assert.equal(h.churchCardColor({ cardColor: '#5E8C6A' }), '#5E8C6A');
});

test('churchCardColor returns null when cardColor is unset', () => {
  const h = helpers();
  assert.equal(h.churchCardColor({}), null);
});

test('churchCardColor rejects url() injection (anti-beacon)', () => {
  const h = helpers();
  assert.equal(h.churchCardColor({ cardColor: 'url(evil)' }), null);
});

test('churchCardColor rejects 3-character hex (#FFF)', () => {
  const h = helpers();
  assert.equal(h.churchCardColor({ cardColor: '#FFF' }), null);
});

test('churchCardColor rejects other invalid values', () => {
  const h = helpers();
  for (const bad of ['red', 'var(--x)', '#1F4E79; background:url(x)', 42, null, undefined]) {
    assert.equal(h.churchCardColor({ cardColor: bad }), null, 'should reject ' + JSON.stringify(bad));
  }
  assert.equal(h.churchCardColor(null), null, 'should handle null church');
  assert.equal(h.churchCardColor(undefined), null, 'should handle undefined church');
});

test('churchCardGradient produces a linear-gradient starting with the given hex and angle', () => {
  const h = helpers();
  const result = h.churchCardGradient('#5E8C6A', 155);
  assert.ok(result.startsWith('linear-gradient(155deg, #5E8C6A'), 'gradient should start with the colour at the given angle, got: ' + result);
  assert.ok(result.includes('color-mix'), 'gradient should use color-mix for the dark end');
});
