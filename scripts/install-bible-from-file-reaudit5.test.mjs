// INSTALL A BIBLE FROM A FILE — ROUND 5 (fc697355): R5-1. Run: node --test scripts/install-bible-from-file-reaudit5.test.mjs
//
// When the lists that say what is OURS cannot be read at boot (offline, a short read), a published catalogue Bible looks like a
// stranger's file, and a transient failure used to quarantine it for good as "unsafe". Now: lists unreadable + reader refuses =
// SKIP this boot (not loaded, not quarantined, not marked, retried next boot); lists readable + refused = quarantined, as before.
// A record that is not ours still never loads unless the reader accepts it. Written first; the offline-skip tests fail on fc697355.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { realFflate, file, sleep, phone, bibleDb, newStores } from './install-bible-harness.mjs';

const AKJV = 'modules/eng-akjv.bbl.mybible';
const rec = (url, name = 'Pub') => ({ url, id: 'x', abbr: 'PUB', name, kind: 'bible', format: 'MySword', category: 'bibles' });
const seed = (url, bytes, extra = {}) => { const st = newStores(); st.stores.set('modules', new Map([[url, bytes]])); st.ls.set('trinityone.installed', JSON.stringify({ [url]: { ...rec(url), ...extra } })); return st; };
const recOf = (st, url) => JSON.parse(st.ls.get('trinityone.installed'))[url];
async function refusedZip() {
  const good = Buffer.from(realFflate.zipSync({ 'ok.bbl.mybible': await bibleDb('OK', 'Ok Bible', 'x') })); const at = good.length - 22;
  const loc = Buffer.alloc(20); loc.writeUInt32LE(0x07064b50, 0);
  return new Uint8Array(Buffer.concat([good.subarray(0, at), loc, good.subarray(at)]));
}

test('R5-1a — OFFLINE, a PUBLISHED Bible whose stored bytes cannot be read this boot is SKIPPED, not quarantined, and loads on a later boot once the lists are readable', async () => {
  const full = file(AKJV), cut = full.slice(0, 8192);                 // a SQLite header, then cut short (probe q16)
  const st = seed(AKJV, cut);
  const a = phone({ state: st, catalogDown: true }); await a.boot(); await sleep(150);
  assert.equal(a.Bible.versions().length, 0);
  const r = recOf(st, AKJV);
  assert.ok(r && !r.quarantined && !r.checked && r.told === undefined, 'a published module was branded: ' + JSON.stringify(r));
  assert.deepEqual(JSON.parse(JSON.stringify(a.Bible.takeQuarantineNotices())), [], 'the member was told a published Bible is unsafe');
  // a later boot: the bytes are readable and the lists are readable: it loads (it is ours, so it takes the catalogue path)
  st.stores.get('modules').set(AKJV, full);
  const b = phone({ state: st }); await b.boot();
  for (let i = 0; i < 100 && b.Bible.versions().length < 1; i++) await sleep(25);
  assert.equal(b.Bible.versions().length, 1, 'the skipped Bible did not load on the next boot');
  assert.ok(!recOf(st, AKJV).quarantined);
});

test('R5-1b — OFFLINE, a record the reader ACCEPTS still loads (nothing is skipped just because the lists are down)', async () => {
  const kjv = file('modules/eng-kjv.zip');
  const st = seed('modules/eng-kjv.zip', kjv, { format: 'USFM', name: 'King James Version' });
  const calls = []; const p = phone({ state: st, catalogDown: true, unzipCalls: calls }); await p.boot();
  for (let i = 0; i < 100 && p.Bible.versions().length < 1; i++) await sleep(25);
  assert.equal(p.Bible.versions().length, 1, 'an acceptable record was not loaded while offline');
  assert.deepEqual([...calls], [], 'a record that is not provably ours was read with unzipSync');
});

test('R5-1c — OFFLINE, a STRANGER\'S refused zip never loads: it is SKIPPED this boot (not quarantined yet), and QUARANTINED at the first boot where the lists are readable', async () => {
  const key = '//evil.example/x.zip';
  const st = seed(key, await refusedZip(), { name: 'Legacy' });
  const calls = []; const a = phone({ state: st, catalogDown: true, unzipCalls: calls }); await a.boot(); await sleep(120);
  assert.equal(a.Bible.versions().length, 0, 'a refused stranger loaded while offline');
  assert.deepEqual([...calls], [], 'unzipSync ran on it');
  assert.ok(!recOf(st, key).quarantined, 'skipped this boot, not branded yet');
  const b = phone({ state: st, unzipCalls: calls }); await b.boot(); await sleep(150);
  assert.equal(b.Bible.versions().length, 0);
  assert.equal(recOf(st, key).quarantined, true, 'never quarantined once the lists were readable');
  assert.deepEqual([...calls], []);
});

test('R5-1d — ONLINE the refusal is permanent, as before: a stranger\'s refused zip is quarantined at the first boot, and told once', async () => {
  const key = ' https://evil.example/x.zip';
  const st = seed(key, await refusedZip(), { name: 'Legacy Link' });
  const p = phone({ state: st }); await p.boot(); await sleep(120);
  assert.equal(recOf(st, key).quarantined, true);
  assert.deepEqual(JSON.parse(JSON.stringify(p.Bible.takeQuarantineNotices())), ['Legacy Link']);
});

test('R5-1e — EITHER list being unreadable is enough to skip (not quarantine): only the catalogue down, only the eBible mirror down', async () => {
  for (const down of ['catalog', 'mirror']) {
    const st = seed(AKJV, file(AKJV).slice(0, 8192));
    const p = phone({ state: st, catalogDown: down }); await p.boot(); await sleep(150);
    assert.ok(!recOf(st, AKJV).quarantined, `${down} down: a published Bible was branded unsafe`);
  }
});
