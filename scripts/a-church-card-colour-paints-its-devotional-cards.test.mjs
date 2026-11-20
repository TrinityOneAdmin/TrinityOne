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
import { readFileSync } from 'node:fs';
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

// F1 WIRE: publishProfile in the SHIPPED BUNDLE includes cardColor in its JSON output.
// vendor/steward.js is bundled by esbuild — dead code is removed, so if the cardColor field
// is deleted from the source, it disappears from the bundle and this test fails. (CLAUDE.md
// rule 3 explicitly says text matching IS effective against vendor/*.js.)
test('vendor/steward.js publishProfile serialises cardColor', () => {
  const bundle = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
  const fn = bundle.slice(bundle.indexOf('publishProfile'), bundle.indexOf('publishProfile') + 2000);
  assert.ok(fn.includes('cardColor'), 'publishProfile in the bundle must serialise cardColor — if this fails, the field was removed from the source or the bundle is stale');
});

// F3 POINT OF USE: DevoCard in the SHIPPED screen receives and applies the card colour.
// Rule 1: this fails if the cardColor prop or its use is deleted from the screen.
test('DevoCard applies cardColor when passed', () => {
  const onColor = (h) => { try { const c = String(h).replace('#','').slice(0,6).match(/../g).map(x=>parseInt(x,16)/255).map(v=>(v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4))); return (0.2126*c[0]+0.7152*c[1]+0.0722*c[2])>0.42?'#2A1B12':'#fff'; } catch(e) { return '#fff'; } };
  const fns = loadScreen('app/screens-plans.jsx', ['DevoCard'], {
    React: { createElement(tag, props, ...ch) { return { tag, props: props || {}, children: ch }; }, Fragment: 'Fragment' },
    window: { churchCardColor(c) { return c && c.cardColor || null; }, churchOnColor: onColor, churchCardGradient(h, d) { return 'lg'; },
      TrinityData: { PLANS: [], CROSSREFS: {} }, Bible: { parseRef() {} } },
    document: { addEventListener() {}, removeEventListener() {}, querySelector: () => null, createElement: () => ({}) },
    navigator: { userAgent: '' }, location: { search: '', hostname: 'x' }, localStorage: { getItem: () => null, setItem() {} },
    setTimeout, clearTimeout, console,
    churchOnColor: onColor, churchCardColor(c) { return c && c.cardColor || null; }, churchCardGradient(h, d) { return 'lg'; },
    Icon: (p) => ({ tag: 'Icon', props: p }),
    SectionLabel: (p) => ({ tag: 'SectionLabel', props: p }),
    BottomSheet: (p) => ({ tag: 'BottomSheet', props: p }),
    IconBtn: (p) => ({ tag: 'IconBtn', props: p }),
  });
  const tree = fns.DevoCard({ d: { title: 'Test', accent: '' }, onClick: () => {}, cardColor: '#C25A38' });
  const banner = tree.children[0];
  assert.ok(banner && banner.props && banner.props.style && banner.props.style.background === '#C25A38',
    'DevoCard banner background should be the cardColor, got: ' + JSON.stringify(banner?.props?.style?.background));
});
