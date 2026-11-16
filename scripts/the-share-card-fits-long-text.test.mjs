// THE "SHARE AS IMAGE" CARD FITS LONG TEXT: SMALLER WORDS FIRST, THEN A TALLER CARD, AND ONLY THEN "…".
// Run: node --test scripts/the-share-card-fits-long-text.test.mjs
//
// Owner report (2026-11-16): the card cut the text off. It was a CSS box (4:5, overflow hidden) sized to the
// phone, so about 130 characters fitted on a 360px phone. The card is now a picture drawn by shareCardLayout /
// shareCardRender (app/share-app.jsx): 1080 wide, words 64px down to 36px on 1080 x 1350, then the card grows
// to at most 1080 x 1920, and only past that is text cut with an ellipsis (`truncated: true`).
//
// The REAL shareCardLayout is compiled from app/share-app.jsx and run with a fixed-width `measure` (each
// character is half the font size wide — an assumption of this test, not of the code). That the real canvas
// lays out and paints a long passage is in scripts/the-verse-card-is-a-real-png.test.mjs; that the preview of
// the picture fits a phone is in scripts/the-share-card-preview-fits-a-phone.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScreen, miniReact } from './render-jsx-screen.mjs';

const { React } = miniReact();
const noop = () => {};
const GLOBALS = {
  React, window: {}, btoa, File, Blob, fetch: noop, console, navigator: {}, document: {}, URL, setTimeout,
  Icon: noop, IconBtn: noop, Overlay: noop, BottomSheet: noop,
};
const { shareCardLayout, shareCardClip } = loadScreen('app/share-app.jsx', ['shareCardLayout', 'shareCardClip'], GLOBALS);
const measure = (t, font) => String(t).length * Number(/(\d+)px/.exec(font)[1]) * 0.5;
const words = (n) => { const w = 'and the Lord said blessed are those who walk in the light of grace'.split(' '); let o = ''; for (let i = 0; o.length < n; i++) o += (o ? ' ' : '') + w[i % w.length]; return o.slice(0, n).trim(); };
const q = (t) => '“' + t + '”';
const joined = (lines) => lines.join(' ');

test('a 150-character verse fits a 1080 x 1350 card, uncut', () => {
  const t = q(words(150));
  const L = shareCardLayout(measure, t, '');
  assert.equal(L.W, 1080); assert.equal(L.H, 1350);
  assert.equal(L.truncated, false);
  assert.equal(joined(L.lines), t, 'the words on the card are not the verse');
});

test('the words get smaller before the card gets taller', () => {
  const L = shareCardLayout(measure, q(words(420)), '');
  assert.equal(L.H, 1350, `a 420-character passage made the card ${L.H} tall — the font should step down first`);
  assert.ok(L.size < 64 && L.size >= 36, `size ${L.size}`);
  assert.equal(L.truncated, false);
});

test('a 900-character passage grows the card instead of cutting it', () => {
  const t = q(words(900));
  const L = shareCardLayout(measure, t, '');
  assert.ok(L.H > 1350 && L.H <= 1920, `a 900-character passage gave a ${L.H}-tall card`);
  assert.equal(L.truncated, false, 'a 900-character passage was cut');
  assert.equal(joined(L.lines), t);
});

test('only past 1080 x 1920 at 36px is text cut — with an ellipsis, and truncated: true', () => {
  const t = q(words(5000));
  const L = shareCardLayout(measure, t, '');
  assert.equal(L.H, 1920); assert.equal(L.size, 36);
  assert.equal(L.truncated, true);
  const last = L.lines[L.lines.length - 1];
  assert.ok(last.endsWith('…'), `the cut text does not end in an ellipsis: "${last}"`);
  assert.ok(t.startsWith(joined(L.lines).slice(0, -1).trim()), 'the cut text is not the start of the passage');
});

test('nothing is ever cut unless truncated is true (lengths 20 to 3000, with and without thoughts)', () => {
  for (let n = 20; n <= 3000; n += 70) {
    for (const c of ['', words(Math.min(400, n))]) {
      const t = q(words(n));
      const L = shareCardLayout(measure, t, c);
      if (L.truncated) continue;
      assert.equal(joined(L.lines), t, `${n} characters: words dropped without truncated`);
      assert.equal(joined(L.cLines), c, `${n} characters: thoughts dropped without truncated`);
      // and every line fits the width
      for (const ln of [...L.lines]) assert.ok(measure(ln, L.fonts.verse) <= 1080 - 2 * 104, `a line is wider than the card: "${ln}"`);
    }
  }
});

test('thoughts are laid out under the verse, and a long passage cannot squeeze them off the card', () => {
  const c = words(300);
  const L = shareCardLayout(measure, q(words(150)), c);
  assert.equal(joined(L.cLines), c);
  assert.equal(L.truncated, false);
  assert.ok(L.cSize < L.size, 'the thoughts are not set smaller than the verse');
  const big = shareCardLayout(measure, q(words(5000)), words(2000));
  assert.equal(big.truncated, true);
  assert.ok(big.cLines.length >= 2, `a long passage left the thoughts ${big.cLines.length} line(s)`);
  assert.ok(big.cLines[big.cLines.length - 1].endsWith('…'));
  assert.ok(big.lines.length >= 2);
});

// ── audit of c8334475, NITs ──
test('a newline in the thoughts starts a new line on the card; a blank line is kept once', () => {
  const L = shareCardLayout(measure, q('Jesus wept.'), 'First thought.\n\n\nSecond thought.\nThird.');
  assert.deepEqual(L.cLines, ['First thought.', '', 'Second thought.', 'Third.']);
});

test('a long word is broken between graphemes — never inside an emoji sequence', () => {
  const fam = '\u{1F468}‍\u{1F469}‍\u{1F467}', thumb = '\u{1F44D}\u{1F3FD}';
  const word = (fam + thumb).repeat(120);
  const L = shareCardLayout(measure, q('Rejoice.'), word);
  assert.ok(L.cLines.length > 1, 're-anchor: the word did not need breaking');
  const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  for (const ln of L.cLines) for (const g of Array.from(seg.segment(ln.replace(/…$/, '')), x => x.segment)) {
    assert.ok(g === fam || g === thumb, `a line holds a broken emoji sequence: ${JSON.stringify(g)}`);
  }
});

test('right-to-left text is flagged per block (verse and thoughts), by its first strong letter', () => {
  const heb = 'בְּרֵאשִׁית בָּרָא אֱלֹהִים';
  const a = shareCardLayout(measure, q(heb), 'Beautiful in the original.');
  assert.equal(a.rtl, true); assert.equal(a.cRtl, false);
  const b = shareCardLayout(measure, q('In the beginning'), heb);
  assert.equal(b.rtl, false); assert.equal(b.cRtl, true);
});

// ── re-audit of 6f0e2871 ──
test('a cut that lands just after a blank line ends on the text, not on a lone "…"', () => {
  const m = (t) => measure(t, '500 36px x');
  assert.deepEqual(shareCardClip(m, ['First thought.', '', 'Second thought.', 'Third.'], 2, 872), ['First thought.\u2026']);
  // and the ordinary case is unchanged
  assert.deepEqual(shareCardClip(m, ['one', 'two', 'three'], 2, 872), ['one', 'two\u2026']);
});

test('with no Intl.Segmenter (older WebView) a long word still wraps, by code point, without throwing', () => {
  const { shareCardLayout: noSeg } = loadScreen('app/share-app.jsx', ['shareCardLayout'], { ...GLOBALS, Intl: {} });
  const word = 'abcdefghij'.repeat(300);
  const L = noSeg(measure, q('Rejoice.'), word);
  assert.ok(L.cLines.length > 1, 'the long word was not wrapped');
  assert.ok(L.cLines.join('').replace(/\u2026$/, '').length > 0 && word.startsWith(L.cLines.join('').replace(/\u2026$/, '')), 'the wrapped word is not the word');
});
