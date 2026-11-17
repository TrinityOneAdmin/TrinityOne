// A HOSTILE CHURCH ACCENT REACHES NO MARKUP, SVG, <style> OR CSS VARIABLE (audit quiet-link round 4, R4-1).
// Run: node --test scripts/hostile-church-accent-reaches-no-markup.test.mjs
//
// A church's accent is a string a steward typed (or a hostile relay sent) and it is interpolated into CSS, an SVG and a printable page. Six places
// check it is a real hex before use; round 3 tightened all six to 3/4/6/8 digits and only the app root and safeCssColor had a test. These
// run the REAL functions with hostile values and read what comes out:
//   stew-dashboard.jsx  accentStyle (in StewDashboard)  churchMarkDataUrl  BulkInviteModal's slip colour
//   stew-cards.jsx      cardColor, cardInk
//   screens-chat.jsx    cardInk
// Rule 3: nothing matches text in app/*.jsx; the functions are loaded (the whole console, as the phone loads it) and called.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScreen } from './render-jsx-screen.mjs';
import { loadConsole, fakeReact, fakeBrowser, nodes } from './console-screens.mjs';

const HOSTILE = ['red}</style><script>x</script>', '#12345', '#1234567', 'url(x)', 'expression(alert(1))', '#fff;background:url(//evil)', '#abc"onload="x'];
const FALLBACK = 'var(--clay)';
const dirty = (s) => /[<>"'(){};]|script|url|expression|onload/i.test(String(s));

// ── stew-cards.jsx (the console's card renderer) and screens-chat.jsx (the member's): plain functions, lifted ──
const cards = loadScreen('app/stew-cards.jsx', ['cardColor', 'cardInk'], { React: {}, window: {}, document: {}, console });
const chat = loadScreen('app/screens-chat.jsx', ['cardInk'], { React: {}, window: {}, document: {}, console,
  safeCssColor: (v, f) => { const s = typeof v === 'string' ? v.trim() : ''; return /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(s) || /^var\(--[a-zA-Z0-9-]+\)$/.test(s) ? s : (f || 'var(--clay)'); } });

test('CARD-1 — stew-cards cardColor: a hostile accent becomes the fallback; a real hex passes', () => {
  for (const h of HOSTILE) assert.equal(cards.cardColor(h, 'FALLBACK'), 'FALLBACK', JSON.stringify(h));
  for (const ok of ['#abc', '#abcd', '#c25a38', '#c25a38cc']) assert.equal(cards.cardColor(ok, 'FALLBACK'), ok);
});

test('CARD-2 — stew-cards cardInk: a hostile accent becomes var(--clay), never a computed colour or the raw string', () => {
  for (const h of HOSTILE) assert.equal(cards.cardInk(h), FALLBACK, JSON.stringify(h));
  assert.match(cards.cardInk('#c25a38'), /^#[0-9a-f]{6}$/);
});

test('CARD-3 — screens-chat cardInk: a hostile accent becomes var(--clay), never a computed colour or the raw string', () => {
  for (const h of HOSTILE) assert.equal(chat.cardInk(h), FALLBACK, JSON.stringify(h));
  assert.match(chat.cardInk('#c25a38'), /^#[0-9a-f]{6}$/);
});

// ── the console: StewDashboard.accentStyle, churchMarkDataUrl, BulkInviteModal ──
function consoleWith(church, extra = {}) {
  const f = fakeReact();
  const { window } = fakeBrowser();
  const mods = loadConsole({ React: f.React, window, expr: '{ StewDashboard, BulkInviteModal, churchMarkDataUrl }' });
  window.useStewardChurch = () => church;   // AFTER the load: the console's own scripts define the real hook
  Object.assign(window, extra);
  return { f, window, mods };
}

test('CONSOLE-1 — StewDashboard accentStyle: a hostile church accent sets NO --clay variable on the console frame; a real one sets all four', () => {
  const draw = (accent) => {
    const { f, mods } = consoleWith({ name: 'Grace', accent, isNetwork: false });
    f.reset(); const tree = mods.StewDashboard({ initial: 'overview' }); f.flush();
    const chrome = nodes(tree).find(n => n.props && 'accentStyle' in n.props);
    assert.ok(chrome, 're-anchor: the dashboard draws no frame with an accentStyle');
    return chrome.props.accentStyle;
  };
  for (const h of HOSTILE) assert.equal(draw(h), null, `${JSON.stringify(h)} reached the console's CSS variables`);
  const ok = draw('#c25a38');
  assert.equal(ok['--clay'], '#c25a38');
  assert.ok(Object.values(ok).every(v => !dirty(String(v).replace(/color-mix\(in oklab, #c25a38 \d+%, #(000|fff)\)/, ''))));
});

test('CONSOLE-2 — churchMarkDataUrl: a hostile accent draws the fallback colour in the SVG and nothing hostile enters it', async () => {
  const svgs = [];
  const { mods, window } = consoleWith({}, {});
  window.invImgDataUrl = async () => '';
  window.svgToPng = async (svg) => { svgs.push(svg); return 'data:image/png;base64,AA'; };
  for (const h of HOSTILE) {
    svgs.length = 0;
    await mods.churchMarkDataUrl({ picture: '', name: 'Grace Church', accent: h });
    assert.equal(svgs.length, 1, 're-anchor: no SVG was made');
    assert.match(svgs[0], /fill="#b4462f"/, `${JSON.stringify(h)}: the fallback colour is not in the SVG`);
    assert.ok(!svgs[0].includes(h.trim()) || h.trim() === '', `${JSON.stringify(h)} reached the SVG`);
    assert.doesNotMatch(svgs[0], /<script|onload|url\(|expression/i);
  }
  svgs.length = 0;
  await mods.churchMarkDataUrl({ picture: '', name: 'Grace Church', accent: '#2E7D32' });
  assert.match(svgs[0], /fill="#2E7D32"/, 'control: a real accent must be drawn');
});

test('CONSOLE-3 — BulkInviteModal: a hostile accent puts the fallback colour in the printable slips and nothing hostile in the page', async () => {
  const printed = [];
  const run = async (accent) => {
    const { f, window, mods } = consoleWith({ name: 'Grace', accent, picture: '' });
    window.useGoPublicGate = () => ({ blocking: false }); window.skPrintable = (html) => printed.push(html);
    window.invImgDataUrl = async () => ''; window.svgToPng = async () => 'data:image/png;base64,AA';
    window.Steward.joinUrl = () => 'https://x.test/?follow=abc'; window.Steward.qrSVG = () => '<svg/>';
    const draw = () => { f.reset(); const t = mods.BulkInviteModal({ onClose() {} }); f.flush(); return t; };
    let tree = draw();
    const box = nodes(tree).find(n => n.type === 'textarea');
    assert.ok(box, 're-anchor: no names box');
    box.props.onChange({ target: { value: 'Ada Lovelace' } });
    tree = draw();
    const btn = nodes(tree).find(n => n.type === 'button' && n.props.className && /sk-btn--clay/.test(n.props.className) && (n.kids || []).some(k => typeof k === 'string' && /join slips/.test(k)));
    assert.ok(btn, 're-anchor: no "Make N join slips" button');
    printed.length = 0; await btn.props.onClick(); await new Promise(r => setTimeout(r, 20));
    assert.equal(printed.length, 1, 're-anchor: nothing was printed');
    return printed[0];
  };
  for (const h of HOSTILE) {
    const html = await run(h);
    assert.match(html, /border-top:4px solid #b4533f/, `${JSON.stringify(h)}: the fallback colour is not on the slips`);
    assert.ok(!html.includes(h), `${JSON.stringify(h)} reached the printed page`);
  }
  assert.match(await run('#2E7D32'), /border-top:4px solid #2E7D32/, 'control: a real accent must colour the slips');
});
