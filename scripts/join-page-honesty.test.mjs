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

function run(search) {
  const el = {
    pill: { textContent: "You're invited" }, head: { textContent: 'Join a church' },
    sub: { textContent: 'A warm, private home for your church…' }, openNow: { href: '' },
    getApp: { style: {} }, note: { style: {} }, getAppLabel: { innerHTML: '' },
  };
  const real = {
    document: { getElementById: (id) => el[id] || { style: {}, classList: { add() {}, remove() {} }, textContent: '' }, addEventListener() {} },
    location: { search, hostname: 'trinityone.church', href: '', pathname: '/join.html' },
    navigator: { userAgent: 'Mozilla/5.0' },
    URLSearchParams, console, encodeURIComponent, decodeURIComponent, RegExp, JSON, Math, Date, String,
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
