import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildVersePage } from './public-verse.mjs';

describe('public verse page', () => {
  it('renders the verse text and reference', () => {
    const html = buildVersePage('John 3:16', 'For God so loved the world', 'WEB');
    assert.ok(html.includes('For God so loved the world'), 'verse text present');
    assert.ok(html.includes('John 3:16'), 'reference present');
    assert.ok(html.includes('WEB'), 'version present');
  });

  it('sets Open Graph tags for link previews', () => {
    const html = buildVersePage('Psalm 23:1', 'The LORD is my shepherd', 'AKJV');
    assert.ok(html.includes('og:title'), 'og:title tag present');
    assert.ok(html.includes('og:description'), 'og:description tag present');
    assert.match(html, /og:title.*content="Psalm 23:1"/, 'og:title has the reference');
    assert.ok(html.includes('The LORD is my shepherd'), 'og:description has verse text');
  });

  it('sets the page title to the reference', () => {
    const html = buildVersePage('Romans 8:28', 'And we know', 'WEB');
    assert.ok(html.includes('<title>Romans 8:28'));
  });

  it('escapes HTML in all fields to prevent XSS', () => {
    const html = buildVersePage(
      '<script>alert(1)</script>',
      'text with <img onerror=alert(1)> and "quotes"',
      '<b>bold</b>'
    );
    assert.ok(!html.includes('<script>alert'), 'script tag escaped in ref');
    assert.ok(!html.includes('<img onerror'), 'img tag escaped in text');
    assert.ok(!html.includes('<b>bold'), 'b tag escaped in version');
    assert.ok(html.includes('&lt;script&gt;'), 'ref is HTML-escaped');
    assert.ok(html.includes('&lt;img onerror'), 'text is HTML-escaped');
  });

  it('handles missing params gracefully', () => {
    const html = buildVersePage('', '', '');
    assert.ok(html.includes('<!DOCTYPE html>'), 'still a valid page');
    assert.ok(html.includes('TrinityOne'), 'branding present');
  });

  it('handles null/undefined params', () => {
    const html = buildVersePage(null, undefined, null);
    assert.ok(html.includes('<!DOCTYPE html>'), 'still a valid page');
  });

  it('truncates very long text to prevent abuse', () => {
    const longText = 'a'.repeat(5000);
    const html = buildVersePage('Ref', longText, 'V');
    assert.ok(!html.includes('a'.repeat(5000)), 'full 5000-char text not present');
    assert.ok(html.includes('a'.repeat(3000)), 'truncated to 3000 chars');
  });

  it('includes the version with a separator when present', () => {
    const html = buildVersePage('Gen 1:1', 'In the beginning', 'WEB');
    assert.ok(html.includes('Gen 1:1'), 'ref present');
    assert.ok(html.includes('WEB'), 'version present');
  });

  it('omits the version separator when version is empty', () => {
    const html = buildVersePage('Gen 1:1', 'In the beginning', '');
    assert.ok(html.includes('Gen 1:1'), 'ref present');
    const refLine = html.split('\n').find(l => l.includes('class="rf"'));
    assert.ok(refLine, 'ref line found');
    assert.ok(!refLine.includes('·'), 'no dot separator when version empty');
  });
});
