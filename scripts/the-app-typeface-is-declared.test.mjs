// THE APP'S TYPEFACE IS ACTUALLY DECLARED.
//   Run: node --test scripts/the-app-typeface-is-declared.test.mjs
//
// Sora is the UI and display face of both apps (index.html: --font-ui / --font-display), served from vendor/fonts/.
// On 2026-09-29 a commit about guardian links (15a4bec) also regenerated vendor/fonts/fonts.css — the third-party
// build (`npm run build:vendor`, which the notes call the wrong command for app work) rewrote it from a font list
// without Sora — and every @font-face for Sora vanished. The font files stayed on disk, nothing declared them, and
// every screen quietly fell back to the system font. Nothing checked it; a 1px layout test in the release run was
// the only thing that noticed (2026-09-30). This checks the declaration itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const CSS = readFileSync(new URL('../vendor/fonts/fonts.css', import.meta.url), 'utf8');
const INDEX = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const faces = [...CSS.matchAll(/@font-face\s*\{([^}]*)\}/g)].map(m => m[1]);
const sora = faces.filter(f => /font-family:\s*'Sora'/.test(f));

test('CONTROL: the app still names Sora as its UI and display face', () => {
  assert.match(INDEX, /--font-ui:\s*'Sora'/);
  assert.match(INDEX, /--font-display:\s*'Sora'/);
});

test('Sora is declared at every weight the app uses, 400 to 800', () => {
  const weights = new Set(sora.map(f => (f.match(/font-weight:\s*(\d+)/) || [])[1]));
  for (const w of ['400', '500', '600', '700', '800'])
    assert.ok(weights.has(w), `vendor/fonts/fonts.css declares no Sora at weight ${w} — the app falls back to the system font`);
});

test('every Sora declaration points at a font file that is really there', () => {
  assert.ok(sora.length > 0, 'no Sora @font-face at all');
  for (const f of sora) {
    const src = (f.match(/url\(([^)]+)\)/) || [])[1];
    assert.ok(src && existsSync(new URL('../vendor/fonts/' + src, import.meta.url)), `Sora points at a missing file: ${src}`);
  }
});
