// INSTALL A BIBLE FROM A FILE — ROUND 4 (772b022a, 2026-11-16): R4-1 .. R4-6.
// Run: node --test scripts/install-bible-from-file-reaudit4.test.mjs
// Report: TrinityOne-internal/reference/AUDIT-install-bible-fixes-517d6a32-2026-11-16.html#round4. Written first and run against
// 772b022a, where every test here except the controls fails. Small fixtures only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import zlib from 'node:zlib';
import { realFflate, file, enc, sleep, phone, bibleDb, newStores, ROOT } from './install-bible-harness.mjs';

const lhdr = (name, csz, usz) => { const b = Buffer.alloc(30); b.writeUInt32LE(0x04034b50, 0); b.writeUInt16LE(20, 4); b.writeUInt16LE(8, 8); b.writeUInt32LE(csz, 18); b.writeUInt32LE(usz, 22); b.writeUInt16LE(name.length, 26); return Buffer.concat([b, name]); };
const cdr = (name, csz, usz) => { const b = Buffer.alloc(46); b.writeUInt32LE(0x02014b50, 0); b.writeUInt16LE(20, 4); b.writeUInt16LE(20, 6); b.writeUInt16LE(8, 10); b.writeUInt32LE(csz, 20); b.writeUInt32LE(usz, 24); b.writeUInt16LE(name.length, 28); return Buffer.concat([b, name]); };
const eocd = (n, cdlen, cdoff) => { const b = Buffer.alloc(22); b.writeUInt32LE(0x06054b50, 0); b.writeUInt16LE(n, 8); b.writeUInt16LE(n, 10); b.writeUInt32LE(cdlen, 12); b.writeUInt32LE(cdoff, 16); return b; };
async function lyingZip() {   // declares a Bible-sized entry, inflates to 24 MB
  const db = Buffer.from(await bibleDb('LK', 'Link Bible', 'x'));
  const comp = zlib.deflateRawSync(Buffer.concat([db, Buffer.alloc(24 << 20)]), { level: 9 });
  const X = Buffer.from('x.bbl.mybible');
  const body = Buffer.concat([lhdr(X, comp.length, db.length), comp]);
  const cd = cdr(X, comp.length, db.length);
  return new Uint8Array(Buffer.concat([body, cd, eocd(1, cd.length, body.length)]));
}
// an honest Bible zip with a zip64 locator signature in front of the end record: the reader refuses it
async function refusedZip() {
  const good = Buffer.from(realFflate.zipSync({ 'ok.bbl.mybible': await bibleDb('OK', 'Ok Bible', 'x') })); const at = good.length - 22;
  const loc = Buffer.alloc(20); loc.writeUInt32LE(0x07064b50, 0);
  return new Uint8Array(Buffer.concat([good.subarray(0, at), loc, good.subarray(at)]));
}
const seed = (key, bytes, name = 'Legacy', checked = false) => {
  const st = newStores(); st.stores.set('modules', new Map([[key, bytes]]));
  st.ls.set('trinityone.installed', JSON.stringify({ [key]: { url: key, id: 'OK', abbr: 'OK', name, kind: 'bible', category: 'bibles', ...(checked ? { checked: true } : {}) } }));
  return st;
};

test('R4-1 — BOOT: a record under ANY url that is not an exact catalogue url is read by the bounded reader and quarantined if refused: //host, a leading space or tab before https:, HTTPS:, and a bare name', async () => {
  const refused = await refusedZip();
  for (const key of ['https://evil.example/x.zip', 'HTTPS://evil.example/x.zip', '//evil.example/x.zip', ' https://evil.example/x.zip', '\thttps://evil.example/x.zip', 'evil.zip', 'modules/not-ours.zip']) {
    for (const checked of [false, true]) {   // checked:true leaves ONLY the reader's refusal to catch it
      const st = seed(key, refused, 'Legacy', checked);
      const calls = []; const p = phone({ state: st, unzipCalls: calls }); await p.boot(); await sleep(80);
      assert.equal(!!JSON.parse(st.ls.get('trinityone.installed'))[key].quarantined, true, `${JSON.stringify(key)} checked=${checked}: not quarantined`);
      assert.equal(p.Bible.versions().length, 0, `${JSON.stringify(key)} checked=${checked}: loaded`);
      assert.deepEqual([...calls], [], `${JSON.stringify(key)} checked=${checked}: unzipSync ran`);
    }
  }
  // controls: an honest zip under such a key loads through the reader (no unzipSync); an exact catalogue url keeps the catalogue path
  const honest = realFflate.zipSync({ 'ok.bbl.mybible': await bibleDb('OK', 'Ok Bible', 'x') });
  const calls = []; const p = phone({ state: seed('//evil.example/honest.zip', honest), unzipCalls: calls }); await p.boot();
  for (let i = 0; i < 40 && p.Bible.versions().length < 1; i++) await sleep(25);
  assert.equal(p.Bible.versions().length, 1); assert.deepEqual([...calls], []);
  const q = phone({ state: seed('modules/eng-kjv.zip', file('modules/eng-kjv.zip'), 'King James Version') }); await q.boot();
  for (let i = 0; i < 60 && q.Bible.versions().length < 1; i++) await sleep(25);
  assert.equal(q.Bible.versions().length, 1, 'a catalogue record stopped loading');
});

test('R4-2 — THE CACHE-HIT HALF of fetchAndCacheModule reads the cached bytes with the bounded reader too: a cached bomb under an absolute url is refused with no request, an honest cached zip loads without unzipSync', async () => {
  const URL_BAD = 'https://example.invalid/cached-bomb.zip', URL_OK = 'https://example.invalid/cached-ok.zip';
  const bomb = await lyingZip();
  const honest = realFflate.zipSync({ 'ok.bbl.mybible': await bibleDb('CH', 'Cached Honest', 'x') });
  const st = newStores(); st.stores.set('modules', new Map([[URL_BAD, bomb], [URL_OK, honest]]));    // cached, but NO installed record
  const calls = []; const p = phone({ state: st, unzipCalls: calls }); await p.boot(); p.Bible._error = null;
  await assert.rejects(p.Bible.installModule({ id: 'b', abbr: 'LK', name: 'Link Bible', kind: 'bible', format: 'MYBIBLE', category: 'bibles', url: URL_BAD }));
  assert.equal(p.Bible.versions().length, 0, 'a cached decode bomb was loaded');
  assert.ok(!p.fetched.includes(URL_BAD), 'it was fetched although cached');
  assert.deepEqual([...calls], [], 'unzipSync ran on cached bytes');
  assert.ok(p.inflates.out < 16 * 1024 * 1024, 'the decode ran on: ' + p.inflates.out);
  await p.Bible.installModule({ id: 'o', abbr: 'CH', name: 'Cached Honest', kind: 'bible', format: 'MYBIBLE', category: 'bibles', url: URL_OK });
  assert.equal(p.Bible.versions().length, 1); assert.deepEqual([...calls], []);
});

test('R4-3 — THE LICENCE NOTICE SHIPS WITH THE TABLE: the Unicode License v3 text is in engine.js beside _CONF_DATA, which is what the bundle, the APK and Pages carry', () => {
  const eng = readFileSync(ROOT + 'engine.js', 'utf8');
  const at = eng.indexOf('const _CONF_DATA =');
  assert.ok(at > 0);
  const near = eng.slice(Math.max(0, at - 4500), at);
  for (const must of ['UNICODE LICENSE V3', 'COPYRIGHT AND PERMISSION NOTICE', 'Permission is hereby granted, free of charge', 'THE DATA FILES AND SOFTWARE ARE PROVIDED "AS IS"', 'copyright holder']) assert.ok(near.includes(must), `engine.js does not carry "${must}" beside the table`);
});

test('R4-4 — the "import" filter that CAN be tested is tested: a dictionary file whose name is the Library\'s own import row ("Import a dictionary…") is not mistaken for a published module', async () => {
  const p = phone({}); await p.boot(); p.Bible._error = null;
  // an import ROW has no kind of module, so catOf files it under "bibles": a BIBLE file with its name is the one that would be wrongly held
  const r = await p.Bible.installFromBytes(await bibleDb('IMP', 'Import a dictionary…', 'x'), '');
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.renamed, false, 'a catalogue import ROW (not a module) reserved a name: ' + JSON.stringify(r));
});

test('R4-5 — IF THE CATALOGUE CANNOT BE READ a ?module= link is refused (fail closed), with no request, even for a url that is in the catalogue', async () => {
  const p = phone({ catalogDown: true, hosted: { 'modules/eng-kjv.zip': realFflate.zipSync({ '02-GEN.usfm': enc('\\id GEN - Kjv\n\\c 1\n\\p\n\\v 1 x\n') }) }, search: '?module=modules/eng-kjv.zip' });
  await p.boot(); await sleep(100);
  assert.ok(!p.fetched.includes('modules/eng-kjv.zip'), 'a request was made although the catalogue could not vouch for the link: ' + p.fetched);
  assert.equal(p.Bible.versions().length, 0); assert.equal(Object.keys(p.installed()).length, 0);
  assert.equal(p.Bible.takeLinkNotice(), true);
});

test('R4-6 — A REFUSED LINK IS SHOWN ONCE: reconnecting with no Bible loaded re-runs boot, and the refusal sheet does not come back for the same link', async () => {
  const p = phone({ search: '?module=' + encodeURIComponent('https://evil.example/x.zip') });
  const seen = []; p.Bible.onFileInstall(ev => seen.push(ev.phase));
  await p.boot(); await sleep(80);
  assert.equal(p.Bible.versions().length, 0);
  assert.deepEqual(seen, ['link-refused']);
  await p.goOnline(); await sleep(80); await p.goOnline(); await sleep(80);
  assert.deepEqual(seen, ['link-refused'], 'the refusal was shown again on reconnect: ' + seen);
  // and the pending (nobody listening yet) form is told once too
  const q = phone({ search: '?module=' + encodeURIComponent('https://evil.example/y.zip') });
  await q.boot(); await sleep(60); await q.goOnline(); await sleep(60);
  assert.equal(q.Bible.takeLinkNotice(), true); assert.equal(q.Bible.takeLinkNotice(), false);
});
