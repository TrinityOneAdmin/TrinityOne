// Link-preview (Open Graph) cards: every page that sets og:image / twitter:image must point at
// an absolute https URL whose file really exists in the repo, is 1200x630 and is under 300KB
// (WhatsApp drops bigger ones). Reads the html files as DATA and runs the real public-verse.mjs.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildVersePage } from './public-verse.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAX = 300 * 1000;

function metaImages(html) {
  const grab = (re) => { const m = html.match(re); return m ? m[1] : null; };
  return {
    og: grab(/<meta\s+property="og:image"\s+content="([^"]*)"/),
    tw: grab(/<meta\s+name="twitter:image"\s+content="([^"]*)"/),
    type: grab(/<meta\s+property="og:image:type"\s+content="([^"]*)"/),
    alt: grab(/<meta\s+property="og:image:alt"\s+content="([^"]*)"/),
  };
}
function dims(buf) { // PNG IHDR or JPEG SOF
  if (buf.readUInt32BE(0) === 0x89504e47) return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
  assert.equal(buf.readUInt16BE(0), 0xffd8, 'not a PNG or JPEG');
  let i = 2;
  while (i < buf.length) {
    assert.equal(buf[i], 0xff);
    const m = buf[i + 1], len = buf.readUInt16BE(i + 2);
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)];
    i += 2 + len;
  }
  throw new Error('no SOF');
}

const COVER = 'https://trinityone.church/og-cover-v2.jpg';
const EXPECT = {
  'index.html': COVER, 'welcome.html': COVER, 'help.html': COVER,
  'join.html': 'https://app.trinityone.church/og-join-v2.jpg',
  'public-verse.mjs output': COVER,
};
const PAGES = {
  'index.html': readFileSync(join(ROOT, 'index.html'), 'utf8'),
  'welcome.html': readFileSync(join(ROOT, 'welcome.html'), 'utf8'),
  'help.html': readFileSync(join(ROOT, 'help.html'), 'utf8'),
  'join.html': readFileSync(join(ROOT, 'join.html'), 'utf8'),
  'public-verse.mjs output': buildVersePage('Psalm 23:1', 'The LORD is my shepherd', 'AKJV'),
};

describe('link-preview cards', () => {
  for (const [name, html] of Object.entries(PAGES)) {
    it(name + ': og:image and twitter:image are the same absolute https file that exists, 1200x630, <300KB', () => {
      const { og, tw, type, alt } = metaImages(html);
      assert.ok(og && tw, 'both og:image and twitter:image present');
      assert.match(og, /^https:\/\/[a-z0-9.-]+\/[^/?#]+\.(png|jpg)$/, 'absolute https URL');
      assert.equal(og, tw, 'og:image === twitter:image');
      assert.equal(og, EXPECT[name], 'exact expected card URL for ' + name);
      const file = join(ROOT, basename(new URL(og).pathname));
      assert.ok(existsSync(file), 'file exists in repo root: ' + file);
      assert.ok(statSync(file).size < MAX, 'under 300KB, got ' + statSync(file).size);
      assert.deepEqual(dims(readFileSync(file)), [1200, 630]);
      assert.ok(alt && alt.length > 5, 'og:image:alt present');
      assert.equal(type, og.endsWith('.jpg') ? 'image/jpeg' : 'image/png', 'og:image:type matches the file');
    });
  }
  it('public-verse sets twitter:image:alt', () => {
    assert.match(PAGES['public-verse.mjs output'], /name="twitter:image:alt" content="TrinityOne: /);
  });
  it('public-verse sets twitter:title', () => {
    assert.match(PAGES['public-verse.mjs output'], /name="twitter:title" content="Psalm 23:1"/);
  });
  it('the old cards stay in the repo for already-posted links', () => {
    for (const f of ['og-cover.png', 'og-join.png']) assert.ok(existsSync(join(ROOT, f)), f);
  });
});
