// The steward console must draw members' avatars — and must never fetch a remote one.
// Run: node --test scripts/console-avatars.test.mjs
//
// AUDIT-2026-07-28. subscribeMembers has always stored each member's `av` and a `hasPhoto` flag, and every
// console screen threw them away and drew initials. A roster of unnamed people was a wall of identical grey
// badges — on exactly the screen where a steward decides whether to approve someone.
//
// The security half matters more than the cosmetic half: a member's avatar is attacker-controlled, published
// to the relay by them. An <img src="https://…"> would leak the steward's IP, rough location and online time
// to whoever published that profile — the deanonymisation this product forbids everywhere else.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const DATA = readFileSync(new URL('../app/stew-data.jsx', import.meta.url), 'utf8');
const DASH = readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8');

// lift the two guards and run them for real
const guards = (() => {
  // Brace-matched: _avPhoto became a multi-line function when the prefix-only check was replaced, and a
  // take-to-end-of-line lifter silently stopped loading it — turning a real security test into a file that
  // would not even parse. Extract properly.
  const grab = (name) => {
    const at = DATA.indexOf('const ' + name + ' =');
    assert.notEqual(at, -1, name + ' is gone from stew-data.jsx');
    const semi = DATA.indexOf(';', at), brace = DATA.indexOf('{', at);
    if (brace === -1 || semi < brace) return DATA.slice(at, DATA.indexOf('\n', at));   // one-liner
    let d = 0;
    for (let i = brace; i < DATA.length; i++) {
      const c = DATA[i];
      if (c === '{') d++; else if (c === '}' && --d === 0) return DATA.slice(at, DATA.indexOf(';', i) + 1);
    }
    assert.fail('could not find the end of ' + name);
  };
  return new Function(grab('_avPhoto') + '\n' + grab('_avColor') + '\nreturn { photo: _avPhoto, color: _avColor };')();
})();

test('a member cannot break out of the CSS url() and beacon the steward', () => {
  // THE ONE MY FIRST TEST MISSED. It only fed payloads that fail the data: prefix, so it passed against a
  // guard that validated the PREFIX ONLY and interpolated the rest raw into an unquoted url(). An unquoted
  // url token ends at ')', so a member could publish a valid prefix followed by ') , url(https://…' and the
  // console rendered a two-layer background, fetching the attacker's server and handing over the steward's
  // IP, location and online times. Proven against the vulnerable code before the fix. AUDIT-2026-07-28.
  for (const evil of [
    'data:image/png;base64,iVBORw0KGgo=) , url(https://attacker.example/beacon.png',
    'data:image/png;base64,AAA) url(https://evil.example/x.png',
    'data:image/png;base64,AAA\n) url(https://evil.example/x.png',
    'data:image/png;base64,AAA") url(https://evil.example/x.png',
    'data:image/svg+xml;base64,AAA',            // svg is a script vector; not in the allowlist
    'data:image/png,rawnotbase64) url(https://evil.example/x.png',
  ]) {
    assert.equal(guards.photo({ kind: 'photo', photo: evil }), '',
      'this reaches the CSS and fetches a remote resource: ' + evil.slice(0, 50));
  }
  // and something enormous should not be decoded into several badges at once
  assert.equal(guards.photo({ kind: 'photo', photo: 'data:image/png;base64,' + 'A'.repeat(600 * 1024) }), '',
    'a megabyte avatar is accepted');
});

test('a remote avatar URL is never embedded', () => {
  for (const bad of [
    'https://evil.example/track.png', 'http://evil.example/t.gif', '//evil.example/t.png',
    'javascript:alert(1)', 'data:text/html,<script>', ' https://evil.example/x.png',
  ]) {
    assert.equal(guards.photo({ kind: 'photo', photo: bad }), '',
      'the console would fetch ' + bad + ' — leaking the steward’s IP to whoever published that profile');
  }
});

test('a real embedded photo IS drawn', () => {
  const ok = 'data:image/png;base64,iVBORw0KGgo=';
  assert.equal(guards.photo({ kind: 'photo', photo: ok }), ok);
  assert.equal(guards.photo({ kind: 'symbol', photo: ok }), '', 'only a photo avatar should use the photo field');
});

test('the colour cannot smuggle anything into the CSS gradient', () => {
  // It is interpolated straight into a background shorthand, so url() in there is another beacon.
  for (const bad of ['red; background:url(https://evil.example/t.png)', 'url(https://evil.example/t.png)', 'var(--x)', '']) {
    assert.equal(guards.color({ color: bad }), '', 'a crafted colour reached the stylesheet: ' + bad);
  }
  assert.equal(guards.color({ color: '#5E8C6A' }), '#5E8C6A');
});

test('SkBadge accepts an avatar at all', () => {
  assert.match(DATA, /function SkBadge\(\{[^}]*\bav = null\b/, 'SkBadge no longer takes an avatar');
  assert.match(DATA, /if \(avPic\) picture = avPic;/, 'a member photo is not used even when present');
  assert.match(DATA, /if \(!picture && avCol\) accent = avCol;/,
    'members without a photo fall back to identical badges again');
});

test('the console passes it where it draws a member', () => {
  // Count the attribute directly. Matching /<SkBadge[^>]*av=\{m\.av\}/ silently missed one, because that
  // badge's initials expression contains "w => w[0]" — the > ends [^>]* early. A test that undercounts is
  // worse than none: it would have reported a wired-up screen as unwired.
  const sites = [...DASH.matchAll(/av=\{m\.av\}/g)];
  assert.ok(sites.length >= 3, 'expected the members list, pending joins and the picker; found ' + sites.length);
  // the one that matters most: deciding whether to approve someone
  // Anchor on the list HEADER, not on 'pendingJoins.map' — whose first occurrence is a Set() built 6800
  // characters earlier, so the window landed nowhere near the render and failed against correct code.
  const at = DASH.indexOf('Requests to join');
  assert.notEqual(at, -1, 'the pending-joins list moved — re-anchor this test');
  assert.match(DASH.slice(at, at + 2500), /av=\{m\.av\}/,
    'join requests still show a faceless badge, which is the screen where a steward approves a stranger');
});

test('the console chat shows who is speaking', () => {
  // Reported 2026-07-28: avatars appeared in the members list but not in the steward's chat window, because
  // GroupChatModal drew a name and nothing else. On a busy group that is the hardest way to follow a
  // conversation, and it is the same data the members list already had.
  const at = DASH.indexOf('function GroupChatModal');
  assert.notEqual(at, -1, 'the console group chat is gone');
  const fn = DASH.slice(at, DASH.indexOf('\nfunction ', at + 10));
  assert.match(fn, /const avFor = /, 'the chat cannot look up a sender’s avatar');
  assert.match(fn, /<SkBadge[\s\S]{0,120}av=\{avFor\(m\.by\)\}/,
    'incoming messages still show a bare name with no face or symbol');
});
