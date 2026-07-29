// The welcome screen's mark must be the app's actual logo. Run: node --test scripts/brand-mark.test.mjs
//
// ARCHITECTURE-AUDIT-2026-07-30 A7. Reported by the owner during the device pass and confirmed on hardware:
// the first screen of a first launch showed a mark that is not the app icon.
//
//     icons/halo.svg      ONE continuous 270° arc, gold dot at the TOP        <- what the welcome screen drew
//     icons/icon-512.png  a BROKEN ring of three arcs, gold dot CENTRED       <- what the home screen shows
//
// Two different marks, not two renderings of one. A member taps a segmented ring with a centred dot and lands
// on a welcome screen showing a continuous arc with a dot at the top. The same file is also the favicon on six
// marketing pages, and icons/steward-halo.svg repeated the mismatch for the console.
//
// There is a comment at app/identity.jsx:312 recording that this image was DELIBERATELY changed to halo.svg
// from "a generic waving hand, which said nothing and matched nothing" — a real improvement that stopped one
// step short, replacing a wrong image with a nearly-right one.
//
// The corrected geometry was MEASURED off assets/icon-foreground.png (centreline r=184.2, stroke 34.5, three
// 17° gaps at 120° spacing, dot r=34), then rendered and diffed against it at 1.5% — antialiasing only.
//
// This guard is structural rather than a pixel diff on purpose: rasterising an SVG needs ImageMagick or a
// browser, and a test that silently skips when its renderer is absent is exactly how the release gate came to
// pass with zero coverage of the thing it gates (see the note in bundle-contents.test.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const MEMBER = read('icons/halo.svg');
const STEWARD = read('icons/steward-halo.svg');
const IDENTITY = read('app/identity.jsx');

for (const [name, svg, bg, gold] of [
  ['icons/halo.svg', MEMBER, '#C25A38', '#E0B860'],
  ['icons/steward-halo.svg', STEWARD, '#241C12', '#C8962E'],
]) {
  test(`${name} is the BROKEN-RING mark, not the old single arc`, () => {
    const arcs = svg.match(/<path\b[^>]*\bd="M [^"]*A /g) || [];
    assert.equal(arcs.length, 3,
      `expected three arc segments (the broken ring the launcher icon actually uses); found ${arcs.length}. ` +
      'One arc means the old continuous-halo shape is back, and the welcome screen no longer matches the app icon.');
  });

  test(`${name} puts the dot in the CENTRE`, () => {
    const dot = svg.match(/<circle[^>]*cx="(\d+)"[^>]*cy="(\d+)"[^>]*r="(\d+)"/);
    assert.ok(dot, 'the centre dot is missing');
    const [, cx, cy, r] = dot.map(Number);
    assert.equal(cx, 256, 'the dot is not horizontally centred');
    assert.equal(cy, 256,
      `the dot is at cy=${cy}, not 256. cy=140 is the OLD mark, where the dot sat at the top of a single arc — ` +
      'that is the exact regression this test exists for.');
    assert.ok(r >= 30 && r <= 40, `dot radius ${r} is outside the measured range (34)`);
  });

  test(`${name} keeps the brand palette`, () => {
    assert.match(svg, new RegExp(bg, 'i'), 'the background colour changed');
    assert.match(svg, new RegExp(gold, 'i'), 'the gold changed');
    assert.match(svg, /#F4EEE2/i, 'the cream stroke colour changed');
  });
}

test('the two marks are the same artwork, differing only in ground and gold', () => {
  // A console that drifts to a different SHAPE is the same bug one app over.
  const shape = (s) => (s.match(/<path\b[^>]*\bd="([^"]*)"/g) || []).join('|');
  assert.equal(shape(MEMBER), shape(STEWARD),
    'the member and steward marks have diverged in geometry — they must differ only in colour');
});

test('the welcome screen renders the mark, and it is the shared file', () => {
  // A corrected asset nobody points at fixes nothing.
  assert.match(IDENTITY, /src="icons\/halo\.svg"/,
    'the first-launch wizard no longer renders icons/halo.svg — if it was pointed at another asset, that asset ' +
    'is now the one that has to match the launcher icon, and this guard is watching the wrong file');
});
