// A CHURCH'S MAIN COLOUR PAINTS ITS HEADER AND ITS BADGE (owner 2026-11-12, item 3).
//   Run: node --test scripts/a-church-main-colour-paints-its-header.test.mjs
//
// A church has two colours. ACCENT (buttons, links, highlights) is unchanged. MAIN (`mainColor` on the
// kind-0 profile, strict #RRGGBB or '') paints the church's own surfaces: the compact header when there is no
// banner, the badge when there is no picture, and — owner extra — what a banner's faded bottom edge blends
// into. With MAIN unset every one of those is EXACTLY what it was before.
//
// POINT OF USE (CLAUDE.md rule 1): the SHIPPED ChurchPill and ChurchBadge from app/screens-church.jsx are
// compiled and drawn, with churchMainColor / churchOnColor loaded from the REAL app/ui.jsx (not stubbed), and
// the drawn tree's styles are read. Rule 3: nothing matches text in app/*.jsx.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScreen, miniReact, find } from './render-jsx-screen.mjs';

// the REAL engine.js guards are window-scoped; these are copies of their contract (hex or var(--x); data: only)
const safeCssColor = (v, fb) => { const s = typeof v === 'string' ? v.trim() : ''; return (/^#[0-9a-fA-F]{3,8}$/.test(s) || /^var\(--[a-zA-Z0-9-]+\)$/.test(s)) ? s : (fb || 'var(--clay)'); };
const safeImgUrl = (v) => { const s = typeof v === 'string' ? v.trim() : ''; return /^data:image\/[a-zA-Z0-9.+-]+;/.test(s) ? s : ''; };

function helpers(React) {
  return loadScreen('app/ui.jsx', ['churchMainColor', 'churchOnColor', 'churchMainGradient'], {
    React, window: {}, document: { addEventListener() {}, removeEventListener() {}, querySelector: () => null, createElement: () => ({}) },
    navigator: { userAgent: '' }, location: { search: '', hostname: 'x' }, localStorage: { getItem: () => null, setItem() {} },
    setTimeout, clearTimeout, console, Icon: () => null,
  });
}

function church(c) {
  const { React, draw } = miniReact();
  const h = helpers(React);
  const { ChurchPill, ChurchBadge } = loadScreen('app/screens-church.jsx', ['ChurchPill', 'ChurchBadge'], {
    React, console, Icon: () => null, safeImgUrl, safeCssColor,
    churchMainColor: h.churchMainColor, churchOnColor: h.churchOnColor,
    window: {}, document: { querySelector: () => null },
  });
  const tree = draw(ChurchPill, { ctx: { church: c } });
  const pill = find(tree, n => n.props && n.props['data-church-pill'] === '1')[0];
  const badges = find(tree, n => n.props && n.props['data-church-badge'] === '1');
  const lone = draw(ChurchBadge, { church: c });
  const badge = find(lone, n => n.props && n.props['data-church-badge'] === '1')[0];
  return { pill, badges, badge, h };
}

const MAIN = '#1F4E79';
const BANNER = 'data:image/png;base64,AA';

test('no banner + mainColor set: the compact header is filled with MAIN, with readable name ink', () => {
  const r = church({ name: 'Grace', initials: 'GC', mainColor: MAIN, accent: '#C25A38' });
  assert.ok(r.pill, 're-anchor: no [data-church-pill] node drawn');
  assert.equal(r.pill.props.style.background, MAIN, 'the compact church header does not wear the church MAIN colour');
  const name = find(r.pill, n => n.type === 'div' && n.kids && n.kids.includes('Grace'))[0];
  assert.equal(name.props.style.color, '#fff', 'a dark MAIN header did not get white name text');
  const pale = church({ name: 'Grace', initials: 'GC', mainColor: '#F5F0E8' });
  const paleName = find(pale.pill, n => n.type === 'div' && n.kids && n.kids.includes('Grace'))[0];
  assert.equal(paleName.props.style.color, '#2A1B12', 'a pale MAIN header did not get dark name text');
});

test('no banner + accent only: the header is exactly today (surface card, ink name)', () => {
  const r = church({ name: 'Grace', initials: 'GC', accent: '#C25A38' });
  assert.equal(r.pill.props.style.background, 'var(--surface)', 'an accent-only church header changed from today');
  const name = find(r.pill, n => n.type === 'div' && n.kids && n.kids.includes('Grace'))[0];
  assert.equal(name.props.style.color, 'var(--ink)');
});

test('a mainColor that is not a strict #RRGGBB is ignored (anti-beacon): today’s header', () => {
  for (const bad of ['url(https://x.example/b.png)', 'var(--x)', '#abc', 'red', '#1F4E79; background:url(x)', 42]) {
    const r = church({ name: 'Grace', initials: 'GC', mainColor: bad });
    assert.equal(r.pill.props.style.background, 'var(--surface)', 'mainColor ' + JSON.stringify(bad) + ' reached the header');
    assert.equal(r.h.churchMainColor({ mainColor: bad }), null);
  }
});

test('the badge with no picture: MAIN gradient when set, the accent gradient (today) when not', () => {
  const m = church({ name: 'Grace', initials: 'GC', mainColor: MAIN, accent: '#C25A38' });
  assert.equal(m.badge.props.style.background, `linear-gradient(150deg, ${MAIN}, color-mix(in oklab, ${MAIN} 62%, #16120c))`,
    'the picture-less badge does not start its gradient at MAIN');
  const a = church({ name: 'Grace', initials: 'GC', accent: '#C25A38' });
  assert.equal(a.badge.props.style.background, 'linear-gradient(150deg, #C25A38, color-mix(in oklab, #C25A38 62%, #16120c))',
    'an accent-only badge changed from today');
  assert.equal(a.badge.props.style.color, '#fff');
  // the header draws the badge too, so it is the same badge in the header
  assert.equal(m.badges[0].props.style.background, m.badge.props.style.background);
});

test('with a banner: the faded edge blends into MAIN when set, and into the page (today) when not', () => {
  const m = church({ name: 'Grace', initials: 'GC', banner: BANNER, bannerFade: 30, mainColor: MAIN });
  assert.equal(m.pill.props.style.aspectRatio, '3 / 1', 're-anchor: this is not the banner header');
  assert.equal(m.pill.props.style.background, MAIN, 'the banner header does not sit on MAIN, so its fade blends into the page');
  const t = church({ name: 'Grace', initials: 'GC', banner: BANNER, bannerFade: 30, accent: '#C25A38' });
  assert.equal(t.pill.props.style.aspectRatio, '3 / 1');
  assert.equal(t.pill.props.style.background, undefined, 'an accent-only banner header changed from today');
});
