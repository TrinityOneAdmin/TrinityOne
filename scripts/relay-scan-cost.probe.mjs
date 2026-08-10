// PROBE (not a test): how long can ONE unauthenticated request make the relay freeze?
//
//   node scripts/relay-scan-cost.probe.mjs [eventCount]     default 300000
//
// WHY. The relay answers a REQ synchronously on the same thread that serves every other church. A filter that
// cannot use an index falls back to scanning rows newest-first, and a REQ may carry several filters. Two
// defences already exist — MAX_FILTERS_PER_REQ (32) and a scan budget shared across all filters of one REQ
// (300,000 rows) — so the question is not "is it unbounded" but "is the bound low enough", and that is a
// number, not an opinion. Nothing here changes the relay; it measures it.
//
// The cost is paid BEFORE the sender has proved who they are, so it is reachable by anyone who can open a
// socket, and nothing limits how often they may ask.
import { openStore } from './event-store.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const N = parseInt(process.argv[2] || '300000', 10);
const dir = mkdtempSync(join(tmpdir(), 'scancost-'));
const store = openStore(join(dir, 'probe.sqlite'), { maxEvents: N + 1000 });

// Events that match the indexed part of the filter but NOT the tag being asked for — the shape that forces a
// scan to keep going. A crafted filter looks ordinary; it just never finds what it claims to want.
const CHURCH = 'c'.repeat(64);
console.log(`  seeding ${N.toLocaleString()} events…`);
const t0 = Date.now();
for (let i = 0; i < N; i++) {
  store.put({
    id: (i.toString(16).padStart(64, '0')),
    pubkey: CHURCH, created_at: 1700000000 + i, kind: 1,
    tags: [['t', 'trinityone'], ['p', CHURCH]],
    content: 'x', sig: '0'.repeat(128),
  });
}
console.log(`  seeded in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

const time = (label, fn) => {
  const s = process.hrtime.bigint();
  const r = fn();
  const ms = Number(process.hrtime.bigint() - s) / 1e6;
  console.log(`  ${label.padEnd(46)} ${ms.toFixed(0).padStart(6)} ms   rows returned: ${r}`);
  return ms;
};

// ONE filter asking for a tag value that is never present: the scan runs to its cap.
const nasty = { kinds: [1], '#t': ['no-such-tag-value'], limit: 500 };
time('one filter, no budget (per-filter cap only)', () => store.query({ ...nasty }).length);

// What a real REQ does: 32 filters sharing one budget. This is the number that matters.
const budget = { left: 300000 };
time('32 filters sharing the 300,000-row budget', () => {
  let n = 0;
  for (let i = 0; i < 32; i++) n += store.query({ ...nasty, '#t': ['none-' + i] }, budget).length;
  return n;
});

// And what it would cost with a tighter allowance, to size the fix rather than guess it.
for (const cap of [100000, 50000, 20000]) {
  const b = { left: cap };
  time(`32 filters sharing a ${cap.toLocaleString()}-row budget`, () => {
    let n = 0;
    for (let i = 0; i < 32; i++) n += store.query({ ...nasty, '#t': ['none-' + i] }, b).length;
    return n;
  });
}

// A HONEST comparison: the same shape of request a real member sends, so the cap can be chosen without
// breaking legitimate reads.
const b2 = { left: 300000 };
time('a normal read (indexed tag that exists)', () =>
  store.query({ kinds: [1], '#t': ['trinityone'], limit: 500 }, b2).length);

try { store.db.close(); } catch {}
rmSync(dir, { recursive: true, force: true });
