// THE INVITE PAGE MUST NOT INVITE PEOPLE WHO HAVE NO INVITATION.
// Run: node --test scripts/join-page-honesty.test.mjs
//
// THE DEFECT (user-flow audit, confirmed by driving it). join.html opened bare said "YOU'RE INVITED / Join a
// church" to a visitor with no invitation and nothing to join with, then offered a button that opened the app
// with an empty church — generic onboarding, with nothing anywhere saying that a code from their church is
// the missing piece.
//
// And `?c=` was printed verbatim: a mistyped or truncated link rendered "Join npub1bogus", showing a member a
// raw key-shaped string as their church's name.
//
// This drives the real join.js against a minimal DOM rather than reading it, because the page is three
// branches and the wrong one is the default.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const JS = readFileSync(new URL('../join.js', import.meta.url), 'utf8');

// `oldEngine` stands in for a WebView that predates unicode property escapes (Chrome under 64 — an Android 7
// phone whose WebView was never updated). Such an engine rejects \p{L} with /u, and if the pattern is written
// as a LITERAL it rejects it at parse time, which kills the entire file rather than one check.
function run(search, { oldEngine = false } = {}) {
  const el = {
    pill: { textContent: "You're invited" }, head: { textContent: 'Join a church' },
    sub: { textContent: 'A warm, private home for your church…' }, openNow: { href: '' },
    getApp: { style: {} }, note: { style: {} }, getAppLabel: { innerHTML: '' },
  };
  const real = {
    document: { getElementById: (id) => el[id] || { style: {}, classList: { add() {}, remove() {} }, textContent: '' }, addEventListener() {} },
    location: { search, hostname: 'trinityone.church', href: '', pathname: '/join.html' },
    navigator: { userAgent: 'Mozilla/5.0' },
    URLSearchParams, console, encodeURIComponent, decodeURIComponent, JSON, Math, Date, String,
    RegExp: oldEngine
      ? function (src, flags) {
          if (String(flags || '').includes('u') && /\\p\{/.test(String(src))) throw new SyntaxError('Invalid property name');
          return new RegExp(src, flags);
        }
      : RegExp,
  };
  const sandbox = new Proxy(real, { has: () => true, get: (t, k) => (k in t ? t[k] : undefined) });
  new Function('S', 'with(S){' + JS + '}')(sandbox);
  return { pill: el.pill.textContent, head: el.head.textContent, sub: el.sub.textContent, href: el.openNow.href };
}

test('a real invitation names the church and the person', () => {
  const r = run('?follow=npub1abc&name=Deborah&c=St%20Aidan');
  assert.equal(r.head, 'Join St Aidan', 'the church a member was invited to is no longer named');
  assert.match(r.pill, /Deborah/, 'the name on the slip is no longer greeted');
});

test('no invitation says so, instead of claiming one', () => {
  const r = run('');
  assert.doesNotMatch(r.pill, /invited/i,
    'a visitor with no invitation is still told "You\'re invited". They have nothing to join with, and the ' +
    'page does not mention that a code from their church is what is missing');
  assert.match(r.head, /invitation/i, 'the heading does not say what they need');
  assert.match(r.sub, /link or code from yours/i,
    'nothing explains where an invitation comes from, so the visitor has no next step');
});

test('a key-shaped code is never shown as a church name', () => {
  for (const bad of ['?c=npub1bogus', '?c=nsec1whatever', '?c=' + 'a'.repeat(64)]) {
    const r = run(bad);
    assert.doesNotMatch(r.head, /npub1|nsec1|a{20}/,
      `a malformed code (${bad}) was printed as the church's name. A member should never be shown a raw ` +
      'key-shaped string and told it is their church');
  }
});

test('an ordinary church name still shows, including punctuation and non-Latin script', () => {
  assert.equal(run('?c=' + encodeURIComponent("St Mary's, Fenwick")).head, "Join St Mary's, Fenwick");
  assert.equal(run('?c=' + encodeURIComponent('كنيسة النعمة')).head, 'Join كنيسة النعمة',
    'the name filter rejects non-Latin scripts, which would blank the church name for exactly the ' +
    'congregations this product is aimed at');
});

// An engine without unicode property escapes must lose NOTHING here. Written as a regex literal this was a
// PARSE-time failure, so join.js did not run at all on such a phone: no church named, no invitation greeted,
// no app button wired — a blank, silent page for exactly the older devices this product is meant to reach.
test('an older phone still gets the whole join page', () => {
  const r = run('?follow=npub1abc&name=Deborah&c=St%20Aidan', { oldEngine: true });
  assert.equal(r.head, 'Join St Aidan',
    'join.js did not run at all on an engine without \\p{L}. Written as a literal, that pattern fails at ' +
    'PARSE time and takes the entire file with it — the visitor gets a page that does nothing, silently');
  assert.match(r.pill, /Deborah/, 'the named slip is not greeted on an older phone');
});

test('an older phone still refuses a key-shaped name', () => {
  const r = run('?follow=npub1abc&c=npub1bogus000000000000000000', { oldEngine: true });
  assert.doesNotMatch(r.head, /npub1/,
    'the fallback pattern accepts key-shaped text, so an older phone shows a member a raw key as their ' +
    "church's name — the defect this check exists to prevent, reintroduced for the oldest devices");
});

test('an older phone still shows a non-Latin church name', () => {
  const r = run('?follow=npub1abc&c=' + encodeURIComponent('كنيسة القديس مرقس'), { oldEngine: true });
  assert.match(r.head, /كنيسة/,
    'the fallback is narrower than the strict pattern, so an Arabic-named church is treated as key-shaped ' +
    'and left unnamed. The fallback must be BROADER, not tighter — its only job is refusing keys');
});

// A SOURCE CHECK, DELIBERATELY, because the defect cannot be reproduced in Node: Node parses \p{L} happily,
// so the three tests above would pass just as well against a regex LITERAL — a literal never reaches the
// RegExp constructor the old-engine stub replaces, so the fallback would sit there untouched and unproven.
// The thing that actually matters is WHERE the pattern is written, and only the text can say that.
test('no unicode-property pattern is written as a literal, where it fails at parse time', () => {
  // Comment lines are stripped first: the note explaining this very rule contains both `\p{L}` and "/u", and
  // matched itself. Prose cannot fail to parse; only code can.
  const code = JS.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  const literals = code.match(/\/[^\n/]*\\p\{[^\n]*\/[a-z]*u[a-z]*/g) || [];
  assert.deepEqual(literals, [],
    'a \\p{…} pattern is written as a regex literal:\n    ' + literals.join('\n    ') +
    '\n  On a WebView older than Chrome 64 that is a PARSE error, so the whole of join.js fails to load and ' +
    'the page silently does nothing at all. Build it with new RegExp inside a try/catch instead, so the same ' +
    'failure costs one check rather than the file.');
});
