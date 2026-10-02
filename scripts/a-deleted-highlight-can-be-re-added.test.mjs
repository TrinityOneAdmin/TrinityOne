// A DELETED ITEM RE-ADDED AFTER THE DELETION MUST SURVIVE RECONCILIATION.
//   Run: node --test scripts/a-deleted-highlight-can-be-re-added.test.mjs
//
// Phase 5 (F2): MyData's reconcile merges a local store with a remote payload. Before this fix, deleting
// a highlight and re-adding the same verse lost the highlight on the next sync — the tombstone had no
// timestamp, so reconcile could not tell "deleted then re-added" from "deleted". The fix records
// `deletedAt` timestamps alongside the tombstone list, and reconcile keeps an item whose `ts` exceeds its
// tombstone time.
//
// Phase 5 (F3): `put` must stamp `ts: Date.now()` on every item it saves, or the comparison above has
// nothing to compare against. Before the fix, `ts` was set FIRST in the Object.assign and then overwritten
// by the item's own `ts` field (which was undefined for most items), producing `ts: undefined`.
//
// CLAUDE.md rule 1: these tests drive the shipped `reconcile` and `put` — delete the feature from the
// source and the test fails. CLAUDE.md rule 3: nothing here matches text in a .jsx file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody, stripComments } from './test-slice.mjs';

const SRC = readFileSync(new URL('../src/mydata.src.js', import.meta.url), 'utf8');
const BUNDLE = readFileSync(new URL('../vendor/mydata.js', import.meta.url), 'utf8');

// A minimal cache that behaves like LocalBackend — getDoc/putDoc keyed by string.
function mockCache() {
  const store = {};
  return {
    getDoc(key) { return store[key] != null ? JSON.parse(JSON.stringify(store[key])) : null; },
    putDoc(key, val) { store[key] = JSON.parse(JSON.stringify(val)); },
    store,
  };
}

// Extract and run reconcile from the SOURCE (not the bundle) so we get the real logic.
// reconcile depends on: cache, tombKey, tombAtKey, schedulePublish. We inject them.
function buildReconcile(cache) {
  const published = [];
  const tombKey = (k) => 'tomb/' + k;
  const tombAtKey = (k) => 'tombat/' + k;
  const schedulePublish = (k) => published.push(k);

  const src = stripComments(SRC);
  const fnSrc = fnBody(src, 'function reconcile(key, payload) {', 'reconcile');
  const fn = new Function('cache', 'tombKey', 'tombAtKey', 'schedulePublish', fnSrc + '\nreturn reconcile;');
  return { reconcile: fn(cache, tombKey, tombAtKey, schedulePublish), published };
}

test('a tombstoned item with a newer ts survives reconcile', () => {
  const cache = mockCache();
  const { reconcile } = buildReconcile(cache);

  const DELETED_AT = 1000;
  const READDED_TS = 2000;

  cache.putDoc('highlights', [{ id: 'gen-1-1', color: 'yellow', ts: READDED_TS }]);
  cache.putDoc('tomb/highlights', ['gen-1-1']);
  cache.putDoc('tombat/highlights', { 'gen-1-1': DELETED_AT });

  const changed = reconcile('highlights', {
    items: [],
    deleted: ['gen-1-1'],
    deletedAt: { 'gen-1-1': DELETED_AT },
  });

  const merged = cache.getDoc('highlights');
  assert.equal(merged.length, 1, 'the re-added item was dropped by reconcile — a highlight deleted and ' +
    're-added on the same device disappears on the next sync');
  assert.equal(merged[0].id, 'gen-1-1');
  assert.equal(merged[0].color, 'yellow');
});

test('a tombstoned item with an OLDER ts is still removed', () => {
  const cache = mockCache();
  const { reconcile } = buildReconcile(cache);

  cache.putDoc('highlights', [{ id: 'gen-1-1', color: 'yellow', ts: 500 }]);
  cache.putDoc('tomb/highlights', ['gen-1-1']);
  cache.putDoc('tombat/highlights', { 'gen-1-1': 1000 });

  reconcile('highlights', { items: [], deleted: ['gen-1-1'], deletedAt: { 'gen-1-1': 1000 } });

  const merged = cache.getDoc('highlights');
  assert.equal(merged.length, 0, 'an item deleted AFTER it was last saved should stay deleted');
});

test('reconcile merges local and remote deletedAt, keeping the later timestamp', () => {
  const cache = mockCache();
  const { reconcile } = buildReconcile(cache);

  cache.putDoc('highlights', []);
  cache.putDoc('tomb/highlights', ['a']);
  cache.putDoc('tombat/highlights', { a: 2000 });

  reconcile('highlights', { items: [], deleted: ['a'], deletedAt: { a: 1000 } });
  const tombAt = cache.getDoc('tombat/highlights');
  assert.equal(tombAt.a, 2000, 'the newer local deletedAt should win over the older remote one');
});

test('put stamps ts: Date.now() LAST so the item always has a fresh timestamp', () => {
  const src = stripComments(SRC);
  const putFn = fnBody(src, 'put: function (type, item) {', 'put');
  const itemAt = putFn.indexOf(', item,');
  assert.notEqual(itemAt, -1, 're-anchor: Object.assign(…, item, …) in put is gone');
  const afterItem = putFn.slice(itemAt);
  assert.match(afterItem, /ts:\s*Date\.now\(\)/,
    'ts: Date.now() must appear AFTER the item spread in Object.assign, so it wins over the item’s own ' +
    'ts field (which is usually undefined). Without it, reconcile has nothing to compare against the ' +
    'tombstone time, and a deleted-then-re-added highlight disappears on the next sync');
});

test('the vendor bundle carries deletedAt in its publish payload', () => {
  assert.match(BUNDLE, /deletedAt/,
    'rebuild: the vendor bundle does not contain deletedAt — run the mydata build');
});

test('the vendor bundle carries the tombAtKey helper', () => {
  assert.match(BUNDLE, /tombat\//,
    'rebuild: the vendor bundle does not contain the tombat/ key prefix');
});
