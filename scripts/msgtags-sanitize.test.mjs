// Steward-defined chat tags must be SANITIZED on read, so a forged/hostile doc can't inject CSS, an
// arbitrary icon, a reserved id, or an unbounded list into a member's chat. Run:
//   node --test scripts/msgtags-sanitize.test.mjs
//
// What this test is, honestly: it EXECUTES the real `_sanitizeMsgTags` extracted from the SHIPPED bundle
// (vendor/fellowship.js — what actually runs on the phone), not a copy. The steward console validates on
// write too, but the member never trusts that: the relay could be hostile and serve a crafted doc, so the
// only defense that matters is this read-side sanitizer. Verified to bite: widen either allowlist, drop the
// reserved-id / dedup / length / count clamp, and a case below turns red.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const BUNDLE = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');

// Pull a top-level declaration out of the bundle by brace-matching from its `function NAME(` / `var NAME =`.
function decl(kind, name) {
  const at = kind === 'fn' ? BUNDLE.indexOf('function ' + name + '(') : BUNDLE.indexOf('var ' + name + ' =');
  assert.notEqual(at, -1, `${name} is missing from the shipped bundle (vendor/fellowship.js)`);
  if (kind === 'var') { const end = BUNDLE.indexOf(';', at); return BUNDLE.slice(at, end + 1); }
  const open = BUNDLE.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < BUNDLE.length; i++) {
    const c = BUNDLE[i];
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return BUNDLE.slice(at, i + 1);
  }
  assert.fail(`could not find the end of ${name}`);
}

// Reconstruct just the sanitizer + its dependencies from the shipped source and hand back the real function.
const sanitize = new Function(
  decl('var', 'MSGTAG_ICONS') + '\n' +
  decl('var', 'MSGTAG_ACCENTS') + '\n' +
  decl('var', 'MSGTAG_RESERVED') + '\n' +
  decl('fn', '_msgTagSlug') + '\n' +
  decl('fn', '_sanitizeMsgTags') + '\n' +
  'return _sanitizeMsgTags;'
)();

test('a CSS-injection accent falls back to an allowlisted colour', () => {
  const out = sanitize([{ label: 'Praise', accent: 'red; background:url(https://evil)' }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].accent, 'clay');   // never the attacker string
  assert.ok(['gold', 'sage', 'clay', 'sky', 'plum', 'teal'].includes(out[0].accent));
});

test('an unknown icon falls back to the default', () => {
  const out = sanitize([{ label: 'Testimony', icon: '<script>' }]);
  assert.equal(out[0].icon, 'sparkle');
});

test('reserved card-kind ids are dropped', () => {
  for (const id of ['verse', 'devotional', 'note', 'poll']) {
    assert.equal(sanitize([{ id, label: 'x' }]).length, 0, `${id} must be rejected`);
  }
});

test('prayer is NOT reserved — it is the editable default tag', () => {
  const out = sanitize([{ id: 'prayer', label: 'Prayer request', icon: 'pray', accent: 'gold' }]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], { id: 'prayer', label: 'Prayer request', icon: 'pray', accent: 'gold' });
});

test('empty / whitespace labels are dropped', () => {
  assert.equal(sanitize([{ label: '' }, { label: '   ' }, { label: '\n\t' }]).length, 0);
});

test('labels are trimmed and capped at 24 chars', () => {
  const out = sanitize([{ label: '  Testimonies of His Faithfulness Forever  ' }]);
  assert.equal(out.length, 1);
  assert.ok(out[0].label.length <= 24, `label was ${out[0].label.length} chars`);
});

test('the list is capped at 6 tags', () => {
  const many = Array.from({ length: 20 }, (_, i) => ({ label: 'Tag ' + i }));
  assert.equal(sanitize(many).length, 6);
});

test('duplicate ids collapse to one', () => {
  const out = sanitize([{ label: 'Praise' }, { label: 'Praise' }, { id: 'praise', label: 'Praise!!' }]);
  assert.equal(out.length, 1);
});

test('a stable id is preserved so a label rename never orphans old messages', () => {
  // the tag keeps id "testimony" even though its label is now "Stories"
  const out = sanitize([{ id: 'testimony', label: 'Stories', icon: 'heart', accent: 'sage' }]);
  assert.deepEqual(out[0], { id: 'testimony', label: 'Stories', icon: 'heart', accent: 'sage' });
});

test('non-array / garbage input yields an empty list, never a throw', () => {
  assert.deepEqual(sanitize(null), []);
  assert.deepEqual(sanitize(undefined), []);
  assert.deepEqual(sanitize('nope'), []);
  assert.deepEqual(sanitize([null, 42, 'x', {}]), []);
});
