// "Nothing here" and "we could not reach it" are different things. Run: node --test scripts/honest-empty-states.test.mjs
//
// AUDIT-2026-07-31 U6/U8. Two findings, one habit: the app knows why something is missing and says something
// untrue instead.
//
//   U6  screens-extras Listen: `setData({ episodes: [], error: 'offline' })` was already being written, and
//       the empty state never read it. A member with no signal was told "Your church hasn't added an audio
//       feed yet" — the app blaming the church for the member's connection. Relay-down and genuinely-empty
//       rendered identically, which is the silent-emptiness class this codebase keeps producing.
//
//   U8  --mono was USED but never DEFINED in the member app, so `font-family: var(--mono)` fell back to the
//       proportional UI font. The one place it is used is the phone-to-phone CHECK CODE — the string a member
//       compares character by character to be sure they are moving their account to their OWN phone and not to
//       an attacker holding up a substituted QR (AUDIT-2026-07-26 S5). In a proportional face l/I/1 and 0/O
//       are near-identical, which is exactly the confusion that check exists to prevent. Not cosmetic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const EXTRAS = read('app/screens-extras.jsx');
const INDEX = read('index.html');

test('the Listen screen does not blame the church for a failed fetch', () => {
  const at = EXTRAS.indexOf('Nothing to listen to yet');
  assert.notEqual(at, -1, 're-anchor: the Listen empty state moved');
  // BOTH lines must be conditional, asserted separately. A window around the title contains the paragraph
  // too, so a single search passes while the heading still says "Nothing to listen to yet" over an error —
  // sabotage proved exactly that.
  // Skip comment lines. The fix's own comment QUOTES the old string, so a naive search finds the record of the
  // fix and reports it as the bug — the same trap that bit the no-overclaims tests earlier today.
  const titleLine = EXTRAS.split('\n').find(l => l.includes('Nothing to listen to yet') && !/^\s*(\/\/|\*|\{\/\*)/.test(l) && l.includes('<div'));
  assert.ok(titleLine, 're-anchor: the Listen title moved');
  assert.match(titleLine, /data && data\.error/,
    'the HEADING still says "Nothing to listen to yet" when the fetch failed. The app already knows better — ' +
    'data.error is set — and tells the member their church has not added an audio feed, blaming the church ' +
    'for the member\'s connection.');
  const block = EXTRAS.slice(Math.max(0, at - 600), at + 900);
  assert.match(block, /your connection, not your church/i,
    'the error case does not say whose fault it is. "Nothing here" and "we could not reach it" must not read ' +
    'the same, or a member goes and asks a steward to fix their own signal.');
});

test('…and a failed fetch actually records that it failed', () => {
  // The message is worthless if the catch throws the reason away — which is how this shipped: one path set
  // `error` and the other silently produced an empty list indistinguishable from a church with no feed.
  const at = EXTRAS.indexOf('.catch(');
  assert.notEqual(at, -1, 're-anchor: the fetch catch moved');
  assert.match(EXTRAS.slice(at, at + 200), /error:/,
    'the catch still swallows the failure into a bare empty list, so the honest message above can never fire');
});

test('THE CHECK CODE RENDERS IN A MONOSPACE FACE', () => {
  // The security-relevant one. This is the string a member reads aloud or compares by eye during a
  // phone-to-phone transfer; if l/I/1 or 0/O are indistinguishable, the comparison stops being a check.
  const uses = read('app/identity-extras.jsx');
  assert.match(uses, /fontFamily: 'var\(--mono\)'/, 're-anchor: the check code no longer asks for --mono');
  assert.match(INDEX, /--mono:\s*[^;]*monospace/,
    '--mono is used by the phone-to-phone check code but is not DEFINED in the member app, so it falls back ' +
    'to the proportional UI font. A member comparing that code character by character cannot reliably tell ' +
    'l from I from 1, or 0 from O — which is the exact confusion the check exists to prevent.');
});
