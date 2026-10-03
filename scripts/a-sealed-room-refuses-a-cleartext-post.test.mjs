// A CONSOLE WITH NO KEY FOR A SEALED ROOM MUST REFUSE THE POST, NOT SEND IT IN THE CLEAR.
//   Run: node --test scripts/a-sealed-room-refuses-a-cleartext-post.test.mjs
//
// Without the fix, publishPost skipped encryption when _skeys[group] was
// empty and posted the message as plaintext — visible to anyone with relay
// access. The fix tracks which groups are sealed (_sealedGroupIds) and
// refuses when the key is absent.
//
// This test lifts publishPost from the SHIPPED steward bundle and runs it
// with a sealed group that has no key. CLAUDE.md §1: it fails if the fix
// is deleted from the screen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';

const STEWARD = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');

test('publishPost returns null for a sealed group with no key — shipped bundle, run', async () => {
  const body = fnBody(STEWARD, 'publishPost(content, group) {', 'publishPost');
  let published = null;
  const scope = {
    sk: new Uint8Array(32).fill(1),
    _skeys: {},
    _sealedGroupIds: new Set(['prayer-room']),
    publish: (evt) => { published = evt; return Promise.resolve(evt); },
    feChurch: (e) => e,
    now: () => 1000,
    NET: 'test',
    pub: 'aabb',
    nip44e: () => { throw new Error('should not be called'); },
    encrypt2: () => { throw new Error('should not be called'); },
    Promise,
    console,
  };
  const fn = new Function('scope', 'with (scope) { return ({ ' + body + ' }); }')(scope);
  const result = await fn.publishPost('Hello world', 'prayer-room');
  assert.equal(result, null, 'publishPost did not refuse — it would have posted cleartext into a sealed room');
  assert.equal(published, null, 'publishPost published an event when it should have refused');
});

test('publishPost encrypts normally when the key IS available — shipped bundle, run', async () => {
  const body = fnBody(STEWARD, 'publishPost(content, group) {', 'publishPost');
  let published = null;
  const fakeKey = new Uint8Array(32).fill(42);
  const scope = {
    sk: new Uint8Array(32).fill(1),
    _skeys: { 'prayer-room': [fakeKey] },
    _sealedGroupIds: new Set(['prayer-room']),
    publish: (evt) => { published = evt; return Promise.resolve(evt); },
    feChurch: (e) => e,
    now: () => 1000,
    NET: 'test',
    pub: 'aabb',
    encrypt2: (text, key) => 'ENCRYPTED:' + text,
    Promise,
    console,
  };
  const fn = new Function('scope', 'with (scope) { return ({ ' + body + ' }); }')(scope);
  const result = await fn.publishPost('Hello world', 'prayer-room');
  assert.ok(result, 'publishPost returned null even though the key was available');
  assert.equal(result.content, 'ENCRYPTED:Hello world', 'the post was not encrypted');
  assert.ok(result.tags.some(t => t[0] === 'enc' && t[1] === '1'), 'the enc tag is missing');
});

test('publishPost allows plaintext in an UNSEALED group — shipped bundle, run', async () => {
  const body = fnBody(STEWARD, 'publishPost(content, group) {', 'publishPost');
  let published = null;
  const scope = {
    sk: new Uint8Array(32).fill(1),
    _skeys: {},
    _sealedGroupIds: new Set(),
    publish: (evt) => { published = evt; return Promise.resolve(evt); },
    feChurch: (e) => e,
    now: () => 1000,
    NET: 'test',
    pub: 'aabb',
    Promise,
    console,
  };
  const fn = new Function('scope', 'with (scope) { return ({ ' + body + ' }); }')(scope);
  const result = await fn.publishPost('Hello world', 'announce');
  assert.ok(result, 'publishPost refused a plaintext post in an unsealed group');
  assert.equal(result.content, 'Hello world', 'the post content was modified');
});
