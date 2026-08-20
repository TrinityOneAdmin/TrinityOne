// EDITING THE STEWARD ROSTER MUST NOT SILENTLY RE-ESCALATE ANYONE.
// Run: node --test scripts/steward-caps-console.test.mjs
//
// The roster is one replaceable document holding both the list of stewards and what each may do. Every
// existing caller of setStewards() passes the LIST alone — "add this steward", "remove that one" — so
// without care each of those republishes a roster with no `caps` key at all. The relay reads that as "this
// church has scoped nobody" and hands every remaining steward full authority again.
//
// A church that had carefully limited an elder to Finance would restore their access to safeguarding,
// membership and the church books by pressing Remove on somebody else. Nothing would say so.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody, stripComments } from './test-slice.mjs';

const VENDOR = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const DASH = readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8');

function lift(anchor, name, stubs) {
  const body = fnBody(VENDOR, anchor, name);
  const scope = new Proxy(stubs, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => {
      if (k === Symbol.unscopables) return undefined;
      if (k in t) return t[k];
      throw new ReferenceError('the lifted function needs `' + String(k) + '` — add a stub');
    },
  });
  // setStewards is an object METHOD, so its body is `setStewards(…) { … }` — neither an expression nor a
  // declaration. Wrap it back into an object literal and take the method off it.
  const method = new RegExp('^' + name + '\\s*\\(').test(body.trim());
  const src2 = method ? `with (scope) { return ({ ${body} }).${name}; }` : `with (scope) { return (${body}); }`;
  return new Function('scope', src2)(scope);
}

const TREASURER = 'a'.repeat(64), PASTORAL = 'b'.repeat(64), PLAIN = 'c'.repeat(64);

function loadSetStewards(existingCaps) {
  const published = [];
  const fn = lift('setStewards(pubkeys, caps, names) {', 'setStewards', {
    _requireTrustedView: () => {},
    sk: new Uint8Array(32), pub: 'church'.padEnd(64, '0'),
    _stewardCaps: existingCaps, _stewardNames: {}, _stewardSince: {},
    now: () => 1787150000,
    STEWARDS_D: 'trinityone/stewards:', NET: 'trinityone',
    finalizeEvent: (t) => t, finalizeEvent2: (t) => t,   // the bundler renames it; accept both
    publish: (e) => { published.push(e); return Promise.resolve(e); },
  });
  return { fn, published };
}
const docOf = (evt) => JSON.parse(evt.content);

test('removing one steward does NOT wipe what the others were scoped to', async () => {
  const { fn, published } = loadSetStewards({ [TREASURER]: ['finance'], [PASTORAL]: ['care'] });
  await fn([TREASURER, PASTORAL]);       // the shape every existing caller uses: list only
  const doc = docOf(published[0]);
  assert.deepEqual(doc.caps, { [TREASURER]: ['finance'], [PASTORAL]: ['care'] },
    'an ordinary roster edit republished with no capabilities, which the relay reads as "nobody is scoped" — ' +
    'so pressing Remove on one steward hands every other steward the church books back');
});

test('a steward who is removed takes their capabilities with them', async () => {
  const { fn, published } = loadSetStewards({ [TREASURER]: ['finance'], [PASTORAL]: ['care'] });
  await fn([TREASURER]);
  assert.deepEqual(docOf(published[0]).caps, { [TREASURER]: ['finance'] },
    'the removed steward is still named in the capability map, which leaves a revoked person listed in the ' +
    'church\'s own record of who may do what');
});

test('an unscoped church still publishes the old, plain shape', async () => {
  const { fn, published } = loadSetStewards({});
  await fn([PLAIN]);
  // `at` is always present now — it is the record of WHEN each steward was given access, which the owner
  // asked for after finding that nothing anywhere said. caps stays absent for a church that scoped nobody.
  const doc = docOf(published[0]);
  assert.deepEqual(doc.pubkeys, [PLAIN]);
  assert.equal(doc.caps, undefined,
    'a church that has never scoped anyone now writes an empty caps object, which is noise in every roster ' +
    'in the field and a needless difference for older relays to parse');
});

test('an explicit grant is honoured over what was there before', async () => {
  const { fn, published } = loadSetStewards({ [TREASURER]: ['finance'] });
  await fn([TREASURER], { [TREASURER]: ['finance', 'care'] });
  assert.deepEqual(docOf(published[0]).caps, { [TREASURER]: ['finance', 'care'] }, 'the caller\'s own grant was ignored');
});

test('the owner is told the limit of what this promise is worth', () => {
  const src = stripComments(DASH);
  const i = src.indexOf('What ');
  assert.ok(src.includes('older version'),
    'the capability editor does not say that a relay running an older version ignores all of this and keeps ' +
    'giving the steward everything. Promising a restriction we cannot see enforced is the failure this ' +
    'project cannot afford.');
  void i;
});

test('the Safeguarding blurb says what it really grants: SEE the lists, not CHANGE them', () => {
  // This test used to require the literal phrase "the child and cleared-adult LISTS stay owner-only", which
  // was the overclaim rather than the guard against one. Only the WRITES are owner-only (gateway.mjs:
  // MINORS_D / APPROVED_D / GUARDIANS_D all demand e.pubkey === cp). The READS are granted — canRead serves
  // those lists to any steward holding `safeguarding` — and since 2026-08-20 the capability also carries the
  // key to the children's register: names, rooms and pickup codes.
  //
  // So an owner reading "stay owner-only" was told the opposite of the truth about the most sensitive data
  // in the app, at the exact moment they were deciding whether to hand it over. Assert the two halves of the
  // real rule, not a phrase.
  const src = stripComments(DASH);
  // The LONGEST of them: `safeguarding:` appears both as a one-word chip label and as the sentence shown
  // under it in the editor. The sentence is the one an owner reads while deciding.
  const blurb = [...src.matchAll(/safeguarding: '([^']*)'/g)].map(m => m[1]).sort((a, b) => b.length - a.length)[0] || '';
  assert.ok(blurb.length > 20, 're-anchor: the Safeguarding capability has no description in the editor at all');
  assert.match(blurb, /\bSEE\b|\bsee\b/,
    'the Safeguarding blurb does not tell the owner that this person will be able to SEE who is marked as a ' +
    'child, which adults are cleared, and the check-in register. That is what the grant actually does.');
  assert.match(blurb, /only you can CHANGE|only you can change/,
    'the blurb does not say that changing those lists stays with the church key, so an owner cannot tell ' +
    'what they are keeping');
  assert.doesNotMatch(blurb, /LISTS stay owner-only|lists stay owner-only/,
    'the blurb still says the lists "stay owner-only". Only the WRITES do — the reads are granted by this ' +
    'very capability, and an owner who believes the lists are withheld has been misled about the one area ' +
    'where being wrong matters most.');
});
