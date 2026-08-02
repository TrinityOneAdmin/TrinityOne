// A CACHE KEY IS WRITTEN TO DISK AND KEPT. Run: node --test scripts/sw-cache-key.test.mjs
//
// Cache Storage keys on the FULL request URL, and `caches.keys()` hands every key back to anything that can
// reach the browser profile — DevTools, an extension, a seized laptop. So whatever ends up in a cached URL is
// stored in the clear, indefinitely, long after the app has tidied the address bar.
//
// The member invite link carries a 12-word recovery phrase in the FRAGMENT (`inviteUrlFor`, app/identity-
// extras.jsx), with a comment saying it is put there "precisely so it never persists" — true of the network,
// because a fragment is never sent to the server, and false of the cache. Measured on a real profile before
// this was fixed: a cache key of `http://host/#invite=<the whole phrase>`, while the address bar already read
// `http://host/`.
//
// The loss is permanent: that phrase IS the member's account, and the key cannot be rotated without losing
// their place in the church. If it is a child's invite, it is the child's account.
//
// This drives the SHIPPED `cacheSafeReq` lifted out of sw.js, not a copy of it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SW = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

function shippedCacheSafeReq() {
  const qsLine = (SW.match(/const SENSITIVE_QS = \[[^\]]*\];/) || [])[0];
  assert.ok(qsLine, 'SENSITIVE_QS is gone from sw.js — re-anchor this test');
  const at = SW.indexOf('const cacheSafeReq = (req) => {');
  assert.notEqual(at, -1, 'cacheSafeReq is gone from sw.js — re-anchor this test');
  let depth = 0, end = -1;
  for (let i = SW.indexOf('{', at); i < SW.length; i++) {
    if (SW[i] === '{') depth++;
    else if (SW[i] === '}' && --depth === 0) { end = i + 1; break; }
  }
  assert.notEqual(end, -1, 'could not find the end of cacheSafeReq');
  const body = SW.slice(at, end) + ';';
  return new Function('URL', 'Request', qsLine + '\n' + body + '\nreturn cacheSafeReq;')(URL, Request);
}

const PHRASE = 'subject math soda peanut brass source wash ethics train peanut mail bonus';

test('a recovery phrase in the FRAGMENT never reaches the cache key', () => {
  const cacheSafeReq = shippedCacheSafeReq();
  const url = 'https://app.trinityone.church/?follow=npub1abc&relay=wss%3A%2F%2Fr#invite=' + encodeURIComponent(PHRASE);
  const out = cacheSafeReq(new Request(url));
  assert.equal(out.url.includes('invite'), false,
    'the invite fragment survives into the cache key, so the member’s 12 words are written to disk and '
    + 'readable for ever by anything that can open Cache Storage. The address-bar scrub does not help — that '
    + 'tidies history, not the cache. Cached key was: ' + out.url);
  for (const w of PHRASE.split(' ')) {
    assert.equal(out.url.includes(w), false, 'a word of the recovery phrase is still in the cache key: ' + out.url);
  }
  assert.equal(out.url.startsWith('https://app.trinityone.church/'), true,
    'the request must still point at the same page — stripping the secret must not change what is fetched');
});

test('the named query parameters are still stripped', () => {
  // The 2026-06-25 fix. Kept as a regression pin: these DO reach the server, so the list is load-bearing in a
  // way the fragment is not, and removing an entry changes what is fetched rather than only what is stored.
  const cacheSafeReq = shippedCacheSafeReq();
  const out = cacheSafeReq(new Request('https://app.trinityone.church/join?invite=' + encodeURIComponent(PHRASE) + '&church=npub1xyz'));
  assert.equal(out.url.includes('invite'), false, 'the ?invite= query is back in the cache key: ' + out.url);
  assert.equal(out.url.includes('church='), false, 'the ?church= query is back in the cache key: ' + out.url);
});

test('an ordinary request is passed through untouched', () => {
  // cacheSafeReq rebuilds the Request when it changes anything, and a rebuilt Request loses properties the
  // caller may rely on. Anything with no secret in it must come back as the SAME object.
  const cacheSafeReq = shippedCacheSafeReq();
  const req = new Request('https://app.trinityone.church/vendor/fellowship.js');
  assert.equal(cacheSafeReq(req), req, 'a plain asset request was needlessly rebuilt');
});
