// THE REAL _hubDropSlices DELETES ONLY THE RECORDS AND THE ENVELOPES — never the clearance or the key.
//   Run: node --test scripts/hub-drop-slices-keeps-the-clearance-and-the-key.test.mjs
//
// A withdrawal empties a worker's phone (owner 2026-09-11): subscribeCheckinRegister drops the
// `trinityone/checkin:` and `trinityone/checkinhelper:` slices of the church-docs cache so a cold start
// cannot replay a child's name and pickup code. The audit of that commit (3fbe57e-e) noted the reader's own
// test STUBS _hubDropSlices — it proves the reader asks for the right prefixes, never that the real deletion
// keeps the right rows. This does: it runs the shipped _hubDropSlices against a hub carrying all four
// `trinityone/checkin*` document types and asserts the clearance (`checkinperm:`, the doc the `withdrawn`
// state is read from) and the register KEY (`checkinkey:`) survive. A prefix guard that lost its trailing
// colon would delete them — and a withdrawn worker whose clearance was also dropped would read as
// "never cleared", or a re-cleared church would have minted a key this phone had thrown away.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const BUNDLE = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');

// Lift the shipped _hubDropSlices, plus the two helpers it closes over (_dtag, _dkeyOf) and the module-level
// _docsHubs Map it reads. esbuild keeps these as top-level `function`/`const` declarations in the bundle.
function fn(name, kind) {
  const needle = kind === 'const' ? ('var ' + name + ' = ') : ('function ' + name + '(');
  let at = BUNDLE.indexOf(needle);
  if (at === -1 && kind === 'const') at = BUNDLE.indexOf('function ' + name + '(');   // esbuild may keep arrow as fn
  assert.notEqual(at, -1, name + ' missing from the shipped bundle');
  if (kind === 'function' || BUNDLE.startsWith('function', at)) {
    let depth = 0, end = -1;
    for (let i = BUNDLE.indexOf('{', at); i < BUNDLE.length; i++) {
      const c = BUNDLE[i]; if (c === '{') depth++; else if (c === '}' && --depth === 0) { end = i + 1; break; }
    }
    return BUNDLE.slice(at, end);
  }
  const end = BUNDLE.indexOf(';', at);
  return BUNDLE.slice(at, end + 1);
}

// Build a scope with the real _hubDropSlices and the real _dtag/_dkeyOf, over a _docsHubs we control.
function realDrop() {
  const docsHubsHolder = { map: null };
  const src = [
    fn('_dtag', 'const'),
    fn('_dkeyOf', 'function'),
    'const _docsHubs = __hubs;',
    'function _mayCache() { return false; }',
    'let saved = 0; function _docsHubSaveNow() { saved++; }',
    'function clearTimeout() {}',
    fn('_hubDropSlices', 'function'),
    'return _hubDropSlices;',
  ].join('\n');
  const make = new Function('__hubs', src);
  const hubs = new Map();
  return { drop: make(hubs), hubs };
}

const ev = (d) => ({ pubkey: 'church', tags: [['d', d]], content: 'x' });
function hubWith(dtags) {
  const _dtag = (e) => (e.tags.find(t => t[0] === 'd') || [])[1] || '';
  const _dkeyOf = (d) => { const s = String(d); if (s.lastIndexOf('trinityone/', 0) !== 0) return ''; const r = s.slice(11), c = r.indexOf(':'); return c === -1 ? r : r.slice(0, c); };
  const buf = new Map(), idx = new Map();
  for (const d of dtags) { const e = ev(d); const key = 'church|' + d; buf.set(key, e); const dk = _dkeyOf(d); if (!idx.has(dk)) idx.set(dk, new Map()); idx.get(dk).set(key, e); }
  return { cp: 'church', buf, idx, dirty: false };
}

const CLEARANCE = 'trinityone/checkinperm:' + 'a'.repeat(64);
const KEY = 'trinityone/checkinkey:' + 'a'.repeat(64);
const RECORD = 'trinityone/checkin:cimtw6p3anrci';
const ENVELOPE = 'trinityone/checkinhelper:svc123';
const NAME = 'trinityone/name:' + 'a'.repeat(64);

test('a withdrawal drops the records and the envelopes and KEEPS the clearance, the key and unrelated docs', () => {
  const { drop, hubs } = realDrop();
  hubs.set('church', hubWith([CLEARANCE, KEY, RECORD, ENVELOPE, NAME]));
  const n = drop('church', ['trinityone/checkinhelper:', 'trinityone/checkin:']);
  assert.equal(n, 2, 'expected exactly the record and the envelope dropped, got ' + n);
  const left = new Set([...hubs.get('church').buf.values()].map(e => (e.tags.find(t => t[0] === 'd') || [])[1]));
  assert.ok(left.has(CLEARANCE), 'THE CLEARANCE WAS DELETED — a withdrawn worker would read as never cleared, with no line');
  assert.ok(left.has(KEY), 'THE REGISTER KEY WAS DELETED — a re-clearance would mint a key this phone threw away');
  assert.ok(left.has(NAME), 'an unrelated document was deleted — the prefix ate more than check-in');
  assert.ok(!left.has(RECORD), 'the child record was not dropped — its name and pickup code replay on a cold start');
  assert.ok(!left.has(ENVELOPE), 'the session envelope was not dropped');
  // and the idx slices the replay reads are emptied for exactly those two types
  assert.equal(hubs.get('church').idx.get('checkin').size, 0, 'the checkin idx slice still replays the records');
  assert.equal(hubs.get('church').idx.get('checkinhelper').size, 0, 'the checkinhelper idx slice still replays the envelopes');
  assert.equal(hubs.get('church').idx.get('checkinperm').size, 1, 'the clearance idx slice was emptied');
});

test('dropping from a church with no hub is a no-op, not a throw', () => {
  const { drop } = realDrop();
  assert.equal(drop('nobody', ['trinityone/checkin:']), 0);
});
