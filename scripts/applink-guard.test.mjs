// The app-link handler is an ATTACK SURFACE, not a convenience.
// Run: node --test scripts/applink-guard.test.mjs
//
// AUDIT 2026-07-25. Claiming https links in the manifest means Android — and any other installed app, since
// MainActivity is exported and Capacitor forwards getData() from any launch intent with no host check — can
// hand this code a URL. Two independent reviews found the same headline: `invite` was in the forwarded key
// list, and `?invite=<12 words>` reaches importMnemonic(), which REPLACES the device identity. The QUERY key
// stays refused for ever.
//
// 2026-11-24 (QR App Links round): the manifest now ALSO claims the ROOT path on app.trinityone.church and
// /join on trinityone.church, because that is what the handed-out QRs actually encode (joinLinkFor,
// inviteUrlFor, Steward.memberInviteUrl — see scripts/qr-links-open-the-app.test.mjs). The seed-carrying
// slips put the seed in the URL FRAGMENT (#invite=), so safeQuery now returns {q, frag} and carries the
// fragment REBUILT — only the `invite` key, re-encoded — never passed through. Adoption behind it is gated
// by an explicit confirm (L4, 2026-07-06), the same one a browser-opened slip gets.
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
  const hostsAt = APP.indexOf("const APP_HOSTS", keysAt);
  assert.notEqual(hostsAt, -1, 'APP_HOSTS missing — the host allow-list is gone or renamed');
  const src = APP.slice(keysAt, APP.indexOf('\n', keysAt)) + '\n'
            + APP.slice(hostsAt, APP.indexOf('\n', hostsAt)) + '\n'
            + APP.slice(start, end) + '; return safeQuery;';
  return new Function(src)();
}

const q = realSafeQuery();
const parse = (u) => { const r = q(u); return r === null ? null : Object.fromEntries(new URLSearchParams(r.q)); };
const frag = (u) => { const r = q(u); return r === null ? null : (r.frag || ''); };
const REAL = 'https://app.trinityone.church';
const APEX = 'https://trinityone.church';

test('a seed can never be carried in from the QUERY', () => {
  const got = parse(`${REAL}/join?follow=npub1abc&invite=word1+word2+word3`);
  assert.ok(got, 'the legitimate follow part should still be accepted');
  assert.equal(got.invite, undefined,
    'invite is forwarded from the query again — one tap would replace the member’s identity with an attacker’s key');
  assert.equal(frag(`${REAL}/join?follow=npub1abc&invite=word1+word2+word3`), '',
    'a ?invite= query must not be promoted into the fragment either');
});

test('only our own https hosts are accepted', () => {
  assert.equal(parse('https://evil.tld/join?follow=npub1abc'), null, 'a foreign host must be refused');
  assert.equal(parse('http://app.trinityone.church/join?follow=npub1abc'), null, 'cleartext http must be refused');
  assert.equal(parse('https://app.trinityone.church.evil.tld/join?follow=npub1abc'), null, 'a suffix-matched host must be refused');
  assert.ok(parse(`${REAL}/join?follow=npub1abc`), 'the app host must be accepted');
  assert.ok(parse(`${APEX}/join?follow=npub1abc`),
    'the web console runs on the marketing apex too (steward.html on Pages) and its printed /join QRs must be handled');
});

test('every path Android claims is handled — and ONLY those paths', () => {
  // The /join prefix also matches the real assets. If safeQuery rejects them, the app opens and silently
  // discards the invite — the failure this whole feature exists to remove.
  for (const p of ['/join', '/join/', '/join.html', '/join.js']) {
    assert.ok(parse(`${REAL}${p}?follow=npub1abc`), `${p} must be handled`);
  }
  assert.equal(parse(`${REAL}/joinsomething?follow=npub1abc`), null, 'an unrelated path must not be treated as an invite');
  // The ROOT path on the APP host is now claimed by the manifest — it is what every member-side QR encodes
  // (invite-a-friend, guardian→child handoff, Set up accounts slips) — so it MUST be handled or each of
  // those QRs opens the app to a blank first-run with the invite thrown away.
  assert.ok(parse(`${REAL}/?follow=npub1abc`), 'the app-host root path is a real invite shape (member QRs) and must be handled');
  // The marketing apex root is NOT claimed, and a crafted intent must get exactly what a real tap gets: nothing.
  assert.equal(parse(`${APEX}/?follow=npub1abc`), null, 'the marketing apex root is not claimed and must stay refused');
  assert.equal(parse(`${REAL}/install?follow=npub1abc`), null, 'unclaimed paths on the app host must stay refused');
});

test('a handed-over account’s seed rides the fragment through — rebuilt, never passed through', () => {
  const u = `${REAL}/?follow=npub1abc&relay=wss://x.tld#invite=alpha%20beta%20gamma`;
  assert.ok(parse(u), 'a slip’s root-path link must be accepted');
  assert.equal(frag(u), '#invite=alpha%20beta%20gamma', 'dropping the fragment turns a scanned slip into a plain join and loses the handed account');
  // Only the invite key survives; anything else smuggled into the fragment is discarded.
  assert.equal(frag(`${REAL}/?follow=npub1abc#invite=alpha&evil=1&invite2=x`), '#invite=alpha');
  assert.equal(frag(`${REAL}/?follow=npub1abc#notinvite=zzz`), '', 'a non-invite fragment must vanish');
  assert.equal(frag(`${REAL}/join?follow=npub1abc`), '', 'no fragment, nothing invented');
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
  assert.equal(parse(`${REAL}/?name=Ada#invite=alpha`), null,
    'a seed with no church is not a slip this product makes — refuse the whole link, never adopt from it');
});
