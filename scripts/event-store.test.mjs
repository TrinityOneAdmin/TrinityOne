// Durable event store: retention, replaceable/addressable dedup, the tag-filter data-loss guard, per-church
// cull fairness, far-future rejection, and matchFilter exactness.  Run: node --test scripts/event-store.test.mjs
//
// These pin behaviours that protect church data and privacy — a regression here is silent data loss or a
// pinned-stale replaceable doc, so the store gets committed coverage independent of the running relay.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openStore, matchFilter, replKey } from './event-store.mjs';

const now = () => Math.floor(Date.now() / 1000);
let _n = 0;
const ev = (o = {}) => ({ id: o.id || 'id' + (++_n), pubkey: o.pubkey || 'pk1', kind: o.kind ?? 1, created_at: o.created_at ?? 1000, tags: o.tags || [], content: o.content ?? 'x' });
const store = () => openStore(':memory:', { maxEvents: 3 });

test('replKey classifies ephemeral / replaceable / addressable', () => {
  assert.equal(replKey(ev({ kind: 1 })), null);                                   // ephemeral (chat/DM)
  assert.equal(replKey(ev({ kind: 4 })), null);                                   // DM = ephemeral
  assert.equal(replKey(ev({ pubkey: 'p', kind: 0 })), 'p:0');                     // profile (replaceable)
  assert.equal(replKey(ev({ pubkey: 'p', kind: 10002 })), 'p:10002');            // relay list (replaceable)
  assert.equal(replKey(ev({ pubkey: 'p', kind: 30078, tags: [['d', 'member:x']] })), 'p:30078:member:x'); // addressable by d
  assert.equal(replKey(ev({ pubkey: 'p', kind: 30078, tags: [] })), 'p:30078:');  // addressable, empty d
});

test('matchFilter: authors / kinds / since / until / #tags', () => {
  const e = ev({ pubkey: 'A', kind: 1, created_at: 500, tags: [['t', 'group1'], ['p', 'X']] });
  assert.ok(matchFilter(e, { authors: ['A'] }));
  assert.ok(!matchFilter(e, { authors: ['B'] }));
  assert.ok(matchFilter(e, { kinds: [1, 4] }));
  assert.ok(!matchFilter(e, { kinds: [0] }));
  assert.ok(matchFilter(e, { since: 400, until: 600 }));
  assert.ok(!matchFilter(e, { since: 600 }));
  assert.ok(!matchFilter(e, { until: 400 }));
  assert.ok(matchFilter(e, { '#t': ['group1'] }));
  assert.ok(matchFilter(e, { '#t': ['other', 'group1'] }));                       // OR within a tag's values
  assert.ok(!matchFilter(e, { '#t': ['nope'] }));
  assert.ok(!matchFilter(e, { '#t': ['group1'], '#p': ['Y'] }));                  // AND across tag keys
  assert.ok(matchFilter(e, { '#t': ['group1'], '#p': ['X'] }));
});

test('put: stored / duplicate', () => {
  const s = store();
  const a = ev({ id: 'dup', kind: 1 });
  assert.equal(s.put(a, 'C'), 'stored');
  assert.equal(s.put(a, 'C'), 'duplicate');                                       // same id → no-op
  assert.equal(s.count(), 1);
  s.close();
});

test('put: far-future created_at is REJECTED (clock-skew/malice can\'t pin stale replaceables)', () => {
  const s = store();
  assert.equal(s.put(ev({ kind: 0, pubkey: 'p', created_at: now() + 10000 }), 'p'), 'future');
  assert.equal(s.put(ev({ kind: 0, pubkey: 'p', created_at: now() + 300 }), 'p'), 'stored');   // within 15-min skew tolerance
  s.close();
});

test('replaceable: newest wins, older rejected as have-newer — regardless of arrival order', () => {
  for (const order of [['old', 'new'], ['new', 'old']]) {
    const s = store();
    const mk = t => ev({ pubkey: 'pk', kind: 30078, created_at: t, tags: [['d', 'member:x']], content: 'v' + t });
    const seq = order.map(o => o === 'old' ? 1000 : 2000);
    const res = seq.map(t => s.put(mk(t), 'C'));
    // whichever arrived first stored; the older one is have-newer, the newer replaces
    assert.ok(res.includes('stored'));
    const got = s.query({ kinds: [30078], '#d': ['member:x'] });
    assert.equal(got.length, 1, 'exactly one kept for the addressable key');
    assert.equal(got[0].created_at, 2000, 'the NEWEST version is the survivor (' + order.join('→') + ')');
    s.close();
  }
});

test('query: tag-filter must NOT drop older matching rows behind a chatty tag (regression #19)', () => {
  const s = store();
  // 40 newer "chatty" events + 3 older "quiet" ones, same kind+church. The quiet ones are OLDEST.
  for (let i = 0; i < 40; i++) s.put(ev({ kind: 1, created_at: 5000 + i, tags: [['t', 'chatty']] }), 'C');
  for (let i = 0; i < 3; i++)  s.put(ev({ kind: 1, created_at: 1000 + i, tags: [['t', 'quiet']] }), 'C');
  // The old bug: SQL `ORDER BY created_at DESC LIMIT lim` returns newest lim rows (all chatty) then matchFilter → 0 quiet.
  const quiet = s.query({ kinds: [1], '#t': ['quiet'], limit: 50 });
  assert.equal(quiet.length, 3, 'all 3 quiet events returned despite 40 newer chatty ones');
  assert.ok(quiet.every(e => e.tags.some(t => t[1] === 'quiet')));
  // limit still honoured on the POST-match set
  assert.equal(s.query({ kinds: [1], '#t': ['quiet'], limit: 2 }).length, 2);
  s.close();
});

test('query: results are newest-first and limit is clamped', () => {
  const s = store();
  for (let i = 0; i < 6; i++) s.put(ev({ kind: 1, created_at: 1000 + i }), 'C');
  const got = s.query({ kinds: [1] });
  assert.equal(got[0].created_at, 1005);                                          // newest first
  assert.equal(got[got.length - 1].created_at, 1000);
  assert.equal(s.query({ kinds: [1], limit: 2 }).length, 2);
  s.close();
});

test('query: shared cross-filter budget bounds a tag scan', () => {
  const s = store();
  for (let i = 0; i < 20; i++) s.put(ev({ kind: 1, created_at: 3000 + i, tags: [['t', 'chatty']] }), 'C');
  const budget = { left: 3 };
  const got = s.query({ kinds: [1], '#t': ['no-match'] }, budget);               // scans, matches nothing
  assert.equal(got.length, 0);
  assert.ok(budget.left <= 0, 'budget was spent by the tag scan and stopped it early');
  s.close();
});

test('cull: per-church ephemeral fairness — a chatty church can\'t age out a quiet one; structured never culled', () => {
  const s = store();   // maxEvents = 3 (per-church ephemeral budget)
  for (let i = 0; i < 8; i++) s.put(ev({ kind: 1, created_at: 4000 + i }), 'Chatty');   // 8 ephemeral in Chatty
  for (let i = 0; i < 2; i++) s.put(ev({ kind: 1, created_at: 4100 + i }), 'Quiet');    // 2 ephemeral in Quiet
  s.put(ev({ kind: 30078, pubkey: 'pk', created_at: 100, tags: [['d', 'roster']] }), 'Chatty'); // structured
  const culled = s.cull();
  assert.equal(culled, 5, 'Chatty trimmed from 8 → 3 ephemeral');
  // exportChurch reads the resolved church COLUMN (not a tag), oldest-first
  const chatty = s.exportChurch('Chatty');
  assert.equal(chatty.filter(e => e.kind === 1).length, 3, 'Chatty keeps its NEWEST 3 ephemeral');
  assert.equal(s.exportChurch('Quiet').filter(e => e.kind === 1).length, 2, 'Quiet untouched (under budget)');
  assert.equal(chatty.filter(e => e.kind === 30078).length, 1, 'structured roster doc survives the cull');
  // the survivors are the newest three
  assert.deepEqual(chatty.filter(e => e.kind === 1).map(e => e.created_at).sort((a, b) => b - a), [4007, 4006, 4005]);
  s.close();
});

test('exportChurchSince returns a church\'s events at/after a cursor, oldest-first', () => {
  const s = store();
  for (let i = 0; i < 5; i++) s.put(ev({ kind: 1, created_at: 2000 + i }), 'C');
  s.put(ev({ kind: 1, created_at: 9999 }), 'Other');
  const since = s.exportChurchSince('C', 2002);
  assert.deepEqual(since.map(e => e.created_at), [2002, 2003, 2004]);             // oldest-first, ≥ cursor, church-scoped
  s.close();
});
