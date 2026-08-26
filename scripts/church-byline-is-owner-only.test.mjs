// THE BY-LINE UNDER A CHURCH NOTICE IS THE CHURCH'S OWN, AND NOBODY ELSE MAY TOUCH IT.
// Run: node --test scripts/church-byline-is-owner-only.test.mjs
//
// A member reading a notice from their church sees who signed it — "Margaret, Churchwarden". That name lives
// in its own document, d=voice:<churchpub>, published by the church key.
//
// IT SHIPPED WITHOUT A WRITE RULE ON THE RELAY (2026-08-25). The registry declared it church-only and the
// member app already refuses a voice document not signed by the church key, so no forged name could ever have
// been DISPLAYED. What actually happened was quieter and worse: with no rule of its own the document fell to
// the member catch-all at the end of accept(), and these documents are ADDRESSABLE — a write to a d-tag that
// already exists REPLACES what was there. So any member of ANY church sharing the relay could publish
// voice:<some other church> with a newer timestamp and delete that congregation's real by-lines. Every notice
// in that church would show no signature at all, with nothing on screen to explain it.
//
// Two things had to be true for that to go unnoticed, and this file guards the first while
// scripts/doc-registry.test.mjs now guards the second: the branch was never written, and the registry guard
// credited EVERY declared type as gated by the relay rather than only the ones the relay actually references.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripComments } from './test-slice.mjs';
import { D } from './trinity-doc-types.mjs';

const GW = readFileSync(new URL('../scripts/gateway.mjs', import.meta.url), 'utf8');
const FEL = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');

// Lift the relay's actual decision and RUN it, rather than asserting on the shape of the text.
function verdict({ author, dtag, knownChurches }) {
  const src = stripComments(GW);
  const line = (src.match(/if \(d\.startsWith\(VOICE_D\)\) return [^\n]*/) || [])[0];
  assert.ok(line, 'the relay has no write rule for the by-line document at all — that is the bug this file is about');
  const expr = line.replace(/^if \(d\.startsWith\(VOICE_D\)\) return /, '').replace(/;\s*$/, '');
  // eslint-disable-next-line no-new-func
  return new Function('d', 'e', 'CHURCH_PUBS', 'VOICE_D', 'return (' + expr + ');')(
    dtag, { pubkey: author }, new Set(knownChurches), D.VOICE);
}

const CHURCH_A = 'a'.repeat(64), CHURCH_B = 'b'.repeat(64), MEMBER = 'c'.repeat(64);
const both = [CHURCH_A, CHURCH_B];

test('the church may set its own by-line', () => {
  assert.equal(verdict({ author: CHURCH_A, dtag: D.VOICE + CHURCH_A, knownChurches: both }), true,
    'the church cannot publish the name shown under its own notices — the feature does not work at all');
});

test('an ordinary member may NOT', () => {
  assert.equal(verdict({ author: MEMBER, dtag: D.VOICE + CHURCH_A, knownChurches: both }), false,
    'any member can replace the by-lines of their own church, and every notice loses its signature');
});

test('and NEITHER MAY ANOTHER CHURCH ON THE SAME RELAY — this is the one that bit', () => {
  // Cross-tenant is the recurring shape in this file's history: seven separate rules have been scoped after
  // shipping relay-wide. A rule that asks "is this key A church" instead of "is this key THIS church" is the
  // same mistake every time.
  assert.equal(verdict({ author: CHURCH_B, dtag: D.VOICE + CHURCH_A, knownChurches: both }), false,
    'one congregation can wipe another congregation’s by-lines — silent, and repeatable');
});

test('a church this relay has never been told about may not write one either', () => {
  assert.equal(verdict({ author: CHURCH_A, dtag: D.VOICE + CHURCH_A, knownChurches: [CHURCH_B] }), false,
    'an unknown key can claim to be a church and write church documents');
});

test('the branch sits ABOVE the member catch-all, or it never runs', () => {
  // Ordering is the whole defect: the catch-all is what accepted these writes. A branch placed after it is
  // decoration.
  const src = stripComments(GW);
  const branch = src.indexOf('d.startsWith(VOICE_D)');
  const catchall = src.indexOf('const mine = store.query({ kinds: [30078], authors: [e.pubkey]');
  assert.ok(branch !== -1 && catchall !== -1, 're-anchor: one of the two landmarks has moved');
  assert.ok(branch < catchall, 'the by-line rule is below the member catch-all, so the catch-all answers first');
});

test('the member app still refuses a by-line not signed by the church, belt and braces', () => {
  // The relay is now the boundary, but this check is what meant no forged NAME was ever displayed even while
  // the door was open. It stays.
  assert.match(stripComments(FEL), /_absorbVoice[\s\S]{0,200}e\.pubkey !== cp[\s\S]{0,20}return false/,
    'the app now trusts whatever the relay hands it as the church’s by-line');
});
