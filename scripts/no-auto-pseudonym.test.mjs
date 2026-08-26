// A member is never given a name they did not choose. Run: node --test scripts/no-auto-pseudonym.test.mjs
//
// 2026-07-30, owner's call, raised off the device pass: a fresh account was displayed as "Anonymous Bramble" —
// one of twelve words picked deterministically off the pubkey. Two things wrong with that in a CHURCH:
//
//   • it removed any reason to set a real name, because the default already LOOKED like one; and
//   • it made anonymity the product's default posture, when the stated direction is the opposite — real names
//     encouraged, anonymity available and explicit.
//
// It was minted in TWO independent places (the same defect class as the photo-suppression drift): the member's
// own identity in src/identity.src.js, and the per-pubkey fallback for ANYONE unnamed in src/fellowship.src.js.
// A third copy sat in the new-identity sheet. Fixing one and not the others would have left the pseudonym
// alive on most surfaces.
//
// WHAT MUST NOT HAPPEN INSTEAD: a blank. An author-less chat row reads as broken, not as unnamed — the silent-
// failure class this codebase keeps being bitten by. Unnamed people show as "Member", and stay tellable apart
// by their avatar, which is already deterministic per pubkey. So this file guards BOTH directions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const FELLOW_SRC = read('src/fellowship.src.js');
const IDENT_SRC = read('src/identity.src.js');
const FELLOW_BUNDLE = read('vendor/fellowship.js');
const IDENT_BUNDLE = read('vendor/identity.js');
const CHAT = read('app/screens-chat.jsx');
const IDENT_UI = read('app/identity.jsx');

// Strip comments before asserting on code: this fix is heavily commented and the word it removes appears in
// every one of those comments. Asserting on raw text would pass or fail on prose.
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).join('\n');

test('no generated pseudonym survives anywhere in the shipped source', () => {
  for (const [name, src] of [
    ['src/fellowship.src.js', FELLOW_SRC], ['src/identity.src.js', IDENT_SRC],
    ['app/identity.jsx', IDENT_UI], ['app/screens-chat.jsx', CHAT],
  ]) {
    assert.doesNotMatch(code(src), /'Anonymous '\s*\+/,
      `${name} still builds a name by concatenating "Anonymous " with something. A member must never be given ` +
      'a name they did not choose — that is the whole point of this change.');
  }
});

test('the word pool is gone from both engines', () => {
  // The pool is what made it look chosen. A leftover pool is how this comes back.
  for (const [name, src] of [['src/fellowship.src.js', FELLOW_SRC], ['src/identity.src.js', IDENT_SRC]]) {
    assert.doesNotMatch(code(src), /HANDLE_POOL/, `${name} still carries the pseudonym word pool`);
  }
});

test('BOTH shipped bundles carry the change — not just the sources', () => {
  // vendor/ is what actually runs. A source-only assertion passes with a stale bundle, which is exactly how a
  // fix comes to be "done" and absent from every phone.
  assert.doesNotMatch(code(FELLOW_BUNDLE), /HANDLE_POOL|'Anonymous '\s*\+/, 'vendor/fellowship.js is stale — rebuild it');
  assert.doesNotMatch(code(IDENT_BUNDLE), /HANDLE_POOL|'Anonymous '\s*\+/, 'vendor/identity.js is stale — rebuild it');
});

// ── the other direction, which matters just as much ──────────────────────────────────────────────────────
test('an unnamed member is shown as "Member", never as nothing', () => {
  // Lift the real fallback out of the SHIPPED bundle and run it. A blank author is the silent-failure class:
  // the row looks broken rather than unnamed, and that is a worse bug than the one being fixed.
  // Brace-match BOTH helpers. My first version cut hashStr at the first newline, which truncated it mid-body
  // and made the test fail with a syntax error — red, but for the wrong reason, which is the failure mode this
  // whole audit keeps finding.
  const fnAt = (name) => {
    const at = FELLOW_BUNDLE.indexOf('function ' + name + '(');
    assert.notEqual(at, -1, name + '() is missing from the shipped bundle');
    let depth = 0;
    for (let i = FELLOW_BUNDLE.indexOf('{', at); i < FELLOW_BUNDLE.length; i++) {
      const c = FELLOW_BUNDLE[i];
      if (c === '{') depth++; else if (c === '}' && --depth === 0) return FELLOW_BUNDLE.slice(at, i + 1);
    }
    assert.fail('could not find the end of ' + name + '()');
  };
  const colours = FELLOW_BUNDLE.match(/^\s*(?:var|const) COLORS = \[[^\]]*\];/m);
  assert.ok(colours, 'the COLORS table is missing');
  // eslint-disable-next-line no-new-func
  const profile = new Function(`${fnAt('hashStr')}\n${colours[0]}\n${fnAt('profile')}\nreturn profile;`)();
  const p = profile('ab'.repeat(32));
  assert.equal(p.handle, '', 'the base profile invents a handle again — it must be empty so displayFor can say "Member"');
  assert.ok(p.color, 'the per-pubkey colour is gone — unnamed members would be indistinguishable');
});

test('displayFor reports whether a name was CHOSEN, and never returns a blank label', () => {
  const fn = FELLOW_SRC.slice(FELLOW_SRC.indexOf('function displayFor('));
  const body = fn.slice(0, fn.indexOf('\n}') + 2);
  assert.match(body, /named:\s*!!chosen/,
    'displayFor no longer reports `named`. Without it callers go back to inferring "has a name" from ' +
    '`name === handle`, which only worked while the fallback was itself a name.');
  // The label must never be blank — an author-less row reads as broken rather than as unnamed. This asserted
  // the literal `chosen || UNNAMED` until 2026-08-26, when the church by-line work gave the church its own
  // fallback ("Your church") so a vicar's notice would stop arriving signed "Member". The intent is unchanged
  // and is what is checked now: every path through the label ends in a non-empty string. Pinning the spelling
  // rather than the property is how a correct change gets reported as a regression.
  assert.match(body, /const handle = chosen \|\|/,
    'the label no longer falls back to anything — an author-less row would render blank');
  assert.match(body, /UNNAMED/,
    'the ordinary unnamed-member fallback is gone from the label');
  assert.match(code(FELLOW_SRC), /const UNNAMED = 'Member'/, 'the unnamed label is gone or renamed');
});

test('the profile screen asks about names honestly', () => {
  // The old copy said "Leave the name blank to go back to Anonymous River" — it offered the pseudonym as a
  // destination. It cannot say that any more, and it must not have been left saying it.
  assert.doesNotMatch(code(CHAT), /myName\(id\) === id\.handle/,
    'the UI still detects "unnamed" by comparing the name to the handle — that idiom only worked while the ' +
    'fallback was a generated name, and it silently becomes always-false now');
  assert.match(code(CHAT), /function hasName\(/, 'hasName() is gone — the honest check for whether a name was chosen');
  assert.doesNotMatch(CHAT, /go back to <b[^>]*>\{id\.handle\}/, 'the copy still offers the old pseudonym as a destination');
});
