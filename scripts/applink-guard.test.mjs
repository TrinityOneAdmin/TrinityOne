// The app-link handler is an ATTACK SURFACE, not a convenience.
// Run: node --test scripts/applink-guard.test.mjs
//
// AUDIT 2026-07-25. Claiming https://app.trinityone.church/join in the manifest means Android — and any other
// installed app, since MainActivity is exported and Capacitor forwards getData() from any launch intent with no
// host check — can hand this code a URL. Two independent reviews found the same headline: `invite` was in the
// forwarded key list, and `?invite=<12 words>` reaches importMnemonic(), which REPLACES the device identity.
// Nothing in the product builds such a URL (inviteUrlFor puts the seed in the fragment, at the root path), so
// the only producer is an attacker — and the app-link turned it into one tap into the native app.
//
// This executes the REAL safeQuery lifted out of app/app.jsx rather than asserting on its source text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const APP = readFileSync(new URL('../app/app.jsx', import.meta.url), 'utf8');

function realSafeQuery() {
  const keysAt = APP.indexOf("const JOIN_KEYS = [");
  assert.notEqual(keysAt, -1, 'JOIN_KEYS missing — the app-link handler is gone or renamed');
  const start = APP.indexOf('const safeQuery = (url) => {', keysAt);
  assert.notEqual(start, -1, 'safeQuery missing');
  let depth = 0, end = -1;
  for (let i = APP.indexOf('{', start); i < APP.length; i++) {
    const c = APP[i];
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) { end = i + 1; break; }
  }
  const src = APP.slice(keysAt, APP.indexOf('\n', keysAt)) + '\n'
            + APP.slice(APP.indexOf("const APP_HOST", keysAt), APP.indexOf('\n', APP.indexOf("const APP_HOST", keysAt))) + '\n'
            + APP.slice(start, end) + '; return safeQuery;';
  return new Function(src)();
}

const q = realSafeQuery();
const parse = (u) => { const r = q(u); return r === null ? null : Object.fromEntries(new URLSearchParams(r)); };
const REAL = 'https://app.trinityone.church';

test('a seed can never be carried in from a link', () => {
  const got = parse(`${REAL}/join?follow=npub1abc&invite=word1+word2+word3`);
  assert.ok(got, 'the legitimate follow part should still be accepted');
  assert.equal(got.invite, undefined,
    'invite is forwarded again — one tap would replace the member’s identity with an attacker’s key');
});

test('only our own https host is accepted', () => {
  assert.equal(parse('https://evil.tld/join?follow=npub1abc'), null, 'a foreign host must be refused');
  assert.equal(parse('http://app.trinityone.church/join?follow=npub1abc'), null, 'cleartext http must be refused');
  assert.equal(parse('https://app.trinityone.church.evil.tld/join?follow=npub1abc'), null, 'a suffix-matched host must be refused');
  assert.ok(parse(`${REAL}/join?follow=npub1abc`), 'the real host must be accepted');
});

test('every path Android claims under pathPrefix="/join" is handled', () => {
  // The manifest prefix also matches the real assets. If safeQuery rejects them, the app opens and silently
  // discards the invite — the failure this whole feature exists to remove.
  for (const p of ['/join', '/join/', '/join.html', '/join.js']) {
    assert.ok(parse(`${REAL}${p}?follow=npub1abc`), `${p} must be handled`);
  }
  assert.equal(parse(`${REAL}/joinsomething?follow=npub1abc`), null, 'an unrelated path must not be treated as an invite');
  assert.equal(parse(`${REAL}/?follow=npub1abc`), null, 'the root path is not an invite link');
});

test('relayname survives — it is the only recovery for a stale tunnel URL', () => {
  const got = parse(`${REAL}/join?follow=npub1abc&relay=wss://x.tld&relayname=stmarys&name=Ada&c=St+Marys`);
  assert.equal(got.relayname, 'stmarys',
    'dropping relayname makes the app path WORSE than the browser path for self-hosted churches: the printed ?relay= goes stale and nothing can resolve it');
  assert.equal(got.relay, 'wss://x.tld');
  assert.equal(got.name, 'Ada');
});

test('a cleartext relay is refused but the rest of the invite still works', () => {
  const got = parse(`${REAL}/join?follow=npub1abc&relay=ws://plain.tld`);
  assert.ok(got, 'the invite must still be usable');
  assert.equal(got.relay, undefined, 'an unencrypted relay must never be adopted from a public link');
});

test('a link with no church is not an invite at all', () => {
  assert.equal(parse(`${REAL}/join?name=Ada`), null, 'without follow there is nothing to join');
});
