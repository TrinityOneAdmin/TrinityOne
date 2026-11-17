// EVERY SAMPLE FILE THE OWNER'S TESTER GETS INSTALLS, AND ITS TEXT READS, AFTER INSTALL AND AFTER A RELAUNCH.
// Run: node --test scripts/install-bible-samples.test.mjs
//
// scripts/install-bible-samples.mjs builds one small known-good file per supported format (and three known-bad ones) from
// modules/eng-web.zip, modules/eng-kjv.zip and text written for the purpose; scripts/make-test-bibles.mjs writes them to
// TrinityOne-internal/test-bibles/. This test installs each through the REAL path (Bible.pickFile's own input and change
// handler, the real engine.js in a vm), reads what the tester is told to look for, then boots a second engine over the same
// stores (a relaunch) and reads it again. So the folder the tester gets cannot drift into files that do not work.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { phone, sleep } from './install-bible-harness.mjs';
import { buildSamples } from './install-bible-samples.mjs';

const SAMPLES = await buildSamples();
const good = SAMPLES.filter(s => !s.bad), bad = SAMPLES.filter(s => s.bad);
const plain = (x) => JSON.parse(JSON.stringify(x));

async function pick(p, name, bytes) {
  p.Bible.pickFile();
  const events = []; p.Bible.onFileInstall(e => events.push(e));
  await p.fakeInput.listeners.change({ target: { files: [{ name, size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) }], value: '' } });
  const res = events.find(e => e.phase === 'result');
  return res && res.result;
}
// what the tester is told to look for, read through the engine's own API
function seen(p, s, r) {
  const c = s.check;
  if (c.commentary) return plain(p.Bible.getCommentary(c.commentary[0], c.commentary[1])).filter(b => b.kind === 'module').flatMap(b => b.rows.map(x => x.html)).join(' ');
  if (c.dict) return plain(p.Bible.searchDict(c.dict.toLowerCase(), 5)).map(x => JSON.stringify(x)).join(' ');
  if (c.xref) { const m = plain(p.Bible.getCrossRefs(c.xref[0], c.xref[1], r.abbr)); return (m[c.xref[2]] || []).join(' '); }
  const v = plain(p.Bible.getVerses(c.book, c.chapter, r.abbr)).find(x => Number(x.v) === c.verse);
  return v ? v.text : '';
}
async function ready(opts) { const p = phone(opts); await p.boot(); p.Bible._error = null; return p; }

for (const s of good) {
  test(`SAMPLE ${s.file}: installs as ${s.kind}, and what the tester checks reads — after install and after a relaunch`, async () => {
    const p = await ready();
    const r = await pick(p, s.file, s.bytes);
    assert.equal(r && r.ok, true, `${s.file} was refused: ${JSON.stringify(r)}`);
    assert.equal(r.kind, s.kind, `${s.file} installed as ${r.kind}`);
    assert.equal(r.renamed, false, `${s.file} was labelled "(from a file)" - the tester would see a different name than the README says: ${r.name}`);
    assert.equal(r.name, s.name, `${s.file}: the result screen says "${r.name}", the README says "${s.name}"`);
    assert.ok(seen(p, s, r).includes(s.check.text), `${s.file}: after install, expected "${s.check.text}" but read: ${seen(p, s, r).slice(0, 200)}`);
    // a relaunch over the same stores: every module comes back and still reads
    const again = phone({ state: p.state }); await again.boot();
    for (let i = 0; i < 100 && !(seen(again, s, r).includes(s.check.text)); i++) await sleep(30);
    assert.ok(seen(again, s, r).includes(s.check.text), `${s.file}: after a relaunch, expected "${s.check.text}" but read: ${seen(again, s, r).slice(0, 200)}`);
    // the same file again is "already here", never a second copy
    const twice = await pick(await (async () => { const q = phone({ state: p.state }); await q.boot(); return q; })(), s.file, s.bytes);
    assert.equal(twice && twice.already, true, `${s.file}: a second install was not recognised: ${JSON.stringify(twice)}`);
  });
}

for (const s of bad) {
  test(`KNOWN-BAD ${s.file} is refused ("can't use this file"), and nothing is installed`, async () => {
    const p = await ready();
    const before = JSON.stringify(p.installed());
    const r = await pick(p, s.file, s.bytes);
    assert.deepEqual(r, { ok: false, reason: 'unusable' }, `${s.file}: ${JSON.stringify(r)}`);
    assert.equal(JSON.stringify(p.installed()), before);
    assert.equal(p.Bible.versions().length + p.Bible.commentaryList().length, 0);
  });
}

test('the sample set covers every kind the importer has, and every file is small', () => {
  assert.deepEqual([...new Set(good.map(s => s.kind))].sort(), ['bible', 'comment', 'crossref', 'dict']);
  assert.ok(bad.length >= 3);
  for (const s of SAMPLES) assert.ok(s.bytes.length < 400 * 1024, `${s.file} is ${s.bytes.length} bytes`);
  assert.equal(new Set(SAMPLES.map(s => s.file)).size, SAMPLES.length);
  for (const s of SAMPLES) assert.ok(s.source && s.licence && s.see && s.format, `${s.file} lacks provenance for the README`);
});

test('SAMPLE REPRO — building the samples again gives the same bytes for every file (zip timestamps are fixed)', async () => {
  await sleep(2200);   // a zip stamps 2-second time: two builds in one instant would match even with the clock in them
  const again = await buildSamples();
  assert.equal(again.length, SAMPLES.length);
  for (let i = 0; i < again.length; i++) assert.deepEqual(Buffer.from(again[i].bytes), Buffer.from(SAMPLES[i].bytes), `${again[i].file} differs between two builds`);
});
