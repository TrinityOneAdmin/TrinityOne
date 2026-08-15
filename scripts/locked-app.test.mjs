// A PIN-locked app must not announce which church you belong to.
// Run: node --test scripts/locked-app.test.mjs
//
// AUDIT-2026-07-27, found by testing a claim the marketing notes listed as safe to make: "locked with a PIN,
// the app is a plain Bible reader — the church side isn't reachable". It wasn't. On a cold boot with the gate
// up, and again after "read the Bible without unlocking", the Today screen drew the church's NAME. Hiding just
// the name was not enough either: the card underneath still read "Serving & events · RSVP · your rota", which
// tells a checkpoint the same thing. Verified in a browser before and after.
//
// SCOPE, so nobody reads more into this than it earns: this defeats a GLANCE — someone picking the phone up.
// The device still STORES the church list and its cached documents in the clear, so anyone who examines it
// finds the church anyway. The claim that a locked app reveals no church needs the encrypt-at-rest work.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const APP = readFileSync(new URL('../app/app.jsx', import.meta.url), 'utf8');
const TODAY = readFileSync(new URL('../app/screens-today.jsx', import.meta.url), 'utf8');

test('a locked app has no church in context at all', () => {
  const at = APP.indexOf('church: commLocked ?');
  assert.notEqual(at, -1,
    'ctx.church is no longer nulled while locked — every church-derived screen reads it, so the church name comes back');
  // The property is a single context line, so read exactly that line. The old fnBody slice here was
  // call-shaped and silently ran on into openChurchSwitcher's body (AUDIT-2026-08-10 item E) — the
  // assertion only ever matched on the anchor's own line, so the line IS the honest window.
  const line = APP.slice(at, APP.indexOf('\n', at));
  assert.match(line, /commLocked \? null/, 'locked must yield null, not a fallback church');
});

test('the serving card cannot render without a church', () => {
  const at = TODAY.indexOf('{!ctx.church ? null : (servNext || servPendingN)');
  assert.notEqual(at, -1,
    'the serving card renders unconditionally again — "Serving & events · RSVP · your rota" on a locked phone says church as loudly as the name did');
});

test('the honest limit is written down next to the fix', () => {
  // If the next person reads this as full deniability they will repeat the marketing claim that started it.
  const at = APP.indexOf('church: commLocked ?');
  const around = APP.slice(Math.max(0, at - 1400), at);
  assert.match(around, /still STORES|encrypt-at-rest|examining the device/i,
    'the at-rest limitation must stay documented beside the change, or this reads as more than it is');
});

test('no surface promises more than the lock delivers', () => {
  // The claim that started this — "locked, the app is a plain Bible reader" — was in ARCHITECTURE.md and in two
  // places a member reads while deciding whether to rely on it. The screen part is now true. The part that
  // isn't, and cannot be until the church cache is encrypted at rest, is that examining the phone reveals
  // nothing. Copy that implies otherwise is the most dangerous thing in this repo, because the people it
  // misleads are the ones the product exists for.
  const ARCH = readFileSync(new URL('../ARCHITECTURE.md', import.meta.url), 'utf8');
  const EXTRAS = readFileSync(new URL('../app/identity-extras.jsx', import.meta.url), 'utf8');
  const IDENT = readFileSync(new URL('../app/identity.jsx', import.meta.url), 'utf8');
  assert.match(ARCH, /not plausible deniability/i, 'the architecture doc states the limit');
  assert.match(ARCH, /still stores the church list/i, 'and says concretely what leaks');
  assert.match(EXTRAS, /which church you belong to/i,
    'the in-app explainer must tell a member what the PIN does NOT hide — they may be deciding on it under real risk');
  for (const [name, src] of [['identity-extras.jsx', EXTRAS], ['identity.jsx', IDENT]]) {
    assert.doesNotMatch(src, /the app looks like a plain Bible reader|the app is a plain Bible reader/,
      name + ' still tells a member the app merely "looks like" a Bible reader, which claims deniability it does not have');
  }
});
