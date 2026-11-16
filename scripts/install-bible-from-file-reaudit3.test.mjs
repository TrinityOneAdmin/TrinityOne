// INSTALL A BIBLE FROM A FILE — THE FIXES FROM THE THIRD RE-AUDIT (517d6a32, 2026-11-16).
// Run: node --test scripts/install-bible-from-file-reaudit3.test.mjs
//
// Report: TrinityOne-internal/reference/AUDIT-install-bible-fixes-517d6a32-2026-11-16.html. M1 boot quarantine of a zip the
// reader refuses; M2 the ?module=/hosted download path; L1 shipping and licence; L2 spacing-mark lookalikes; L3 entries that
// share bytes; L4 the Library's "Active" label on a quarantined row; N2 end-record bytes in an honest zip. Every test was
// written first and run against 517d6a32, where it fails (except the controls). Fixtures are small.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { realFflate, enc, readyPhone, phone, bibleDb, sqliteBytes, newStores, sleep, ROOT } from './install-bible-harness.mjs';
import { loadScreen, miniReact, find, texts as rtexts } from './render-jsx-screen.mjs';
import zlib from 'node:zlib';

const lhdr = (name, csz, usz) => { const b = Buffer.alloc(30); b.writeUInt32LE(0x04034b50, 0); b.writeUInt16LE(20, 4); b.writeUInt16LE(8, 8); b.writeUInt32LE(csz, 18); b.writeUInt32LE(usz, 22); b.writeUInt16LE(name.length, 26); return Buffer.concat([b, name]); };
const cdr = (name, csz, usz, off) => { const b = Buffer.alloc(46); b.writeUInt32LE(0x02014b50, 0); b.writeUInt16LE(20, 4); b.writeUInt16LE(20, 6); b.writeUInt16LE(8, 10); b.writeUInt32LE(csz, 20); b.writeUInt32LE(usz, 24); b.writeUInt16LE(name.length, 28); b.writeUInt32LE(off, 42); return Buffer.concat([b, name]); };
const eocd = (n, cdlen, cdoff, comment = Buffer.alloc(0)) => { const b = Buffer.alloc(22); b.writeUInt32LE(0x06054b50, 0); b.writeUInt16LE(n, 8); b.writeUInt16LE(n, 10); b.writeUInt32LE(cdlen, 12); b.writeUInt32LE(cdoff, 16); b.writeUInt16LE(comment.length, 20); return Buffer.concat([b, comment]); };
const locatorBytes = () => { const l = Buffer.alloc(20); l.writeUInt32LE(0x07064b50, 0); return l; };
// an honest Bible zip with a zip64 locator signature stuck in front of the end record: refused by the reader
function refusedZip(db) {
  const good = Buffer.from(realFflate.zipSync({ 'ok.bbl.mybible': db })); const at = good.length - 22;
  return new Uint8Array(Buffer.concat([good.subarray(0, at), locatorBytes(), good.subarray(at)]));
}

// ── M1: boot quarantines a stored zip the reader refuses ───────────────────────────────────────────────────────────
test('M1 — BOOT: a stored zip the READER refuses (here a zip64 locator) is quarantined, nothing loads, fflate.unzipSync is never asked — unchecked and checked:true alike', async () => {
  const db = await bibleDb('RF', 'Refused Bible', 'x');
  for (const checked of [false, true]) {
    const key = 'imported/refused.bbl.mybible.zip';
    const state = newStores();
    state.stores.set('modules', new Map([[key, refusedZip(db)]]));
    state.ls.set('trinityone.installed', JSON.stringify({ [key]: { url: key, id: 'RF', abbr: 'RF', name: 'Refused Bible', kind: 'bible', category: 'bibles', ...(checked ? { checked: true } : {}) } }));
    const calls = [];
    const p = phone({ state, unzipCalls: calls }); await p.boot(); await sleep(80);
    assert.equal(p.Bible.versions().length, 0, `checked=${checked}: a refused stored zip was loaded at boot`);
    assert.deepEqual([...calls], [], `checked=${checked}: unzipSync ran on it`);
    const rec = JSON.parse(state.ls.get('trinityone.installed'))[key];
    assert.equal(rec && rec.quarantined, true, `checked=${checked}: not quarantined: ${JSON.stringify(rec)}`);
    assert.deepEqual(JSON.parse(JSON.stringify(p.Bible.takeQuarantineNotices())), ['Refused Bible']);
  }
});

// ── M2: the ?module=<url> / hosted download ───────────────────────────────────────────────────────────────────────────
async function lyingZip() {       // declares a Bible-sized entry, inflates to 24 MB
  const db = Buffer.from(await bibleDb('LK', 'Link Bible', 'x'));
  const comp = zlib.deflateRawSync(Buffer.concat([db, Buffer.alloc(24 << 20)]), { level: 9 });
  const X = Buffer.from('x.bbl.mybible');
  const body = Buffer.concat([lhdr(X, comp.length, db.length), comp]);
  const cd = cdr(X, comp.length, db.length, 0);
  return new Uint8Array(Buffer.concat([body, cd, eocd(1, cd.length, body.length)]));
}
const BAD_URL = 'https://example.invalid/bomb.zip';

test('M2 — A LINK\'S ZIP (?module=<https url>) IS READ BY THE BOUNDED READER: a decode bomb is refused, nothing is saved or recorded, and fflate.unzipSync is never asked', async () => {
  const bomb = await lyingZip();
  assert.ok(bomb.length < 100 * 1024);
  const calls = [];
  const p = phone({ hosted: { [BAD_URL]: bomb }, search: '?module=' + encodeURIComponent(BAD_URL), unzipCalls: calls });
  await p.boot(); await sleep(150);
  assert.equal(p.Bible.versions().length, 0, 'the link\'s decode bomb was loaded');
  assert.ok(!p.state.puts.includes(BAD_URL), 'the refused bytes were saved');
  assert.equal(Object.keys(p.installed()).length, 0, 'a record was written for refused bytes');
  assert.deepEqual([...calls], [], 'unzipSync ran on a downloaded zip: ' + calls);
  assert.ok(p.inflates.out < 16 * 1024 * 1024, 'the decode ran on: ' + p.inflates.out);
  // the same through the Library's own install of an absolute url
  const q = phone({ hosted: { [BAD_URL]: bomb } }); await q.boot(); q.Bible._error = null;
  await assert.rejects(q.Bible.installModule({ id: 'x', abbr: 'LK', name: 'Link Bible', kind: 'bible', format: 'MYBIBLE', category: 'bibles', url: BAD_URL }));
  assert.equal(Object.keys(q.installed()).length, 0);
});

test('M2b — THE HONEST LINK STILL WORKS, and its record is read by the bounded reader at every boot (never unzipSync); an OLD stored record of a bomb is quarantined, not decoded', async () => {
  const honest = realFflate.zipSync({ 'ok.bbl.mybible': await bibleDb('HL', 'Honest Link Bible', 'fine') });
  const URL_OK = 'https://example.invalid/honest.zip';
  const calls = [];
  const p = phone({ hosted: { [URL_OK]: honest }, search: '?module=' + encodeURIComponent(URL_OK), unzipCalls: calls });
  await p.boot();
  for (let i = 0; i < 40 && p.Bible.versions().length < 1; i++) await sleep(25);
  assert.equal(p.Bible.versions().length, 1, 'an honest ?module= zip no longer installs');
  assert.ok(p.installed()[URL_OK], 'the link was not recorded');
  const again = phone({ state: p.state, unzipCalls: calls }); await again.boot();
  for (let i = 0; i < 40 && again.Bible.versions().length < 1; i++) await sleep(25);
  assert.equal(again.Bible.versions().length, 1, 'the honest link was not restored at boot');
  assert.deepEqual([...calls], [], 'boot decoded the link\'s zip with unzipSync: ' + calls);
  // an old build saved a bomb under an https key: boot quarantines it
  const bomb = await lyingZip();
  const state = newStores();
  state.stores.set('modules', new Map([[BAD_URL, bomb]]));
  state.ls.set('trinityone.installed', JSON.stringify({ [BAD_URL]: { url: BAD_URL, id: 'LK', abbr: 'LK', name: 'Link Bible', kind: 'bible', category: 'bibles' } }));
  const calls2 = []; const old = phone({ state, unzipCalls: calls2 }); await old.boot(); await sleep(100);
  assert.equal(old.Bible.versions().length, 0); assert.deepEqual([...calls2], []);
  assert.equal(JSON.parse(state.ls.get('trinityone.installed'))[BAD_URL].quarantined, true);
});

// ── L1: the data and the generator are not shipped; the licence text is beside the data ────────────────────────────────
test('L1 — scripts/data and the generator are export-ignored (so the relay bundle and Suite payload do not carry them), and the Unicode licence text sits beside the data', () => {
  for (const f of ['scripts/data/confusables-18.0.txt', 'scripts/gen-confusables-table.py']) {
    const r = spawnSync('git', ['check-attr', 'export-ignore', '--', f], { cwd: ROOT, encoding: 'utf8' });
    assert.match(r.stdout, /export-ignore: set/, `${f} would ship in git archive: ${r.stdout}`);
  }
  const lic = ROOT + 'scripts/data/UNICODE-LICENSE-3.0.txt';
  assert.ok(existsSync(lic), 'no licence text beside the Unicode data');
  const t = readFileSync(lic, 'utf8');
  assert.match(t, /UNICODE LICENSE V3/); assert.match(t, /COPYRIGHT AND PERMISSION NOTICE/); assert.match(t, /Permission is hereby granted, free of charge/); assert.match(t, /THE DATA FILES AND SOFTWARE ARE PROVIDED "AS IS"/);
});

// ── L2: spacing marks are letters' lookalikes, not accents ─────────────────────────────────────────────────────────────
test('L2 — A SPACING-MARK LOOKALIKE (Telugu anusvara, which the Unicode table maps to "o") is labelled; plain accents still come off', async () => {
  const p = await readyPhone();
  assert.match('ం', /\p{Mc}/u, 'fixture: U+0C02 should be a spacing mark');
  const r = await p.Bible.installFromBytes(await bibleDb('KJL2', 'King James Versiంn', 'x'), '');
  assert.equal(r.renamed, true, 'a spacing-mark lookalike of "o" wore the catalogue name: ' + JSON.stringify(r));
  const r2 = await p.Bible.installFromBytes(await bibleDb('KJL3', 'Kíng Jámes Vérsion', 'y'), '');
  assert.equal(r2.renamed, true, 'plain accents stopped being stripped');
});

// ── L3: entries must not share bytes ─────────────────────────────────────────────────────────────────────────────────────
test('L3 — TWO DIRECTORY ENTRIES ON ONE STREAM (honest sizes, so nothing else would object) are refused; the real modules still install', async () => {
  const db = Buffer.from(await bibleDb('SH', 'Shared Bible', 'x'));
  const comp = zlib.deflateRawSync(db, { level: 9 });
  const A = Buffer.from('a.bbl.mybible'), B = Buffer.from('b.bbl.mybible');
  const body = Buffer.concat([lhdr(A, comp.length, db.length), comp]);
  const cd = Buffer.concat([cdr(A, comp.length, db.length, 0), cdr(B, comp.length, db.length, 0)]);
  const zip = new Uint8Array(Buffer.concat([body, cd, eocd(2, cd.length, body.length)]));
  const p = await readyPhone();
  assert.deepEqual(await p.Bible.installFromBytes(zip, 'shared.zip'), { ok: false, reason: 'unusable' });
  assert.equal(Object.keys(p.installed()).length, 0);
  // and the large honest case: 200 entries on one 24 KB stream is refused, not decoded 200 times
  const many = Buffer.concat(Array.from({ length: 200 }, (_, i) => cdr(Buffer.from('e' + i + '.txt'), comp.length, db.length, 0)));
  const z2 = new Uint8Array(Buffer.concat([body, many, eocd(200, many.length, body.length)]));
  const before = p.inflates.n;
  assert.deepEqual(await p.Bible.installFromBytes(z2, 'many.zip'), { ok: false, reason: 'unusable' });
  assert.equal(p.inflates.n, before, 'the shared stream was decoded');
});

// ── L4: the Library at the point of use ──────────────────────────────────────────────────────────────────────────────────
test('L4 — LIBRARY: a quarantined row that shares the active Bible\'s abbreviation does NOT say "Active", and its Remove button removes it', async () => {
  const { React, draw } = miniReact();
  const { Icon } = loadScreen('app/icons.jsx', ['Icon'], { React, window: {} });
  const removed = [], toasts = [];
  const recs = [{ url: 'imported/aaa/old.bbl.mybible', abbr: 'OLD', name: 'Old Import', kind: 'bible', category: 'bibles', quarantined: true }];
  const win = { Bible: { installedMap: () => Object.fromEntries(recs.map(r => [r.url, r])), activeVersion: 'OLD', activeUrl: null, removeModule: async (u) => { removed.push(u); return true; }, isInstalled: () => true, subscribe: () => () => {}, versions: () => [], exportModule: async () => null }, TrinityData: {}, addEventListener() {}, removeEventListener() {} };
  win.isShareableModule = loadScreen('app/share-app.jsx', ['isShareableModule'], { React, window: {}, btoa }).isShareableModule;
  const { InstalledBrowser } = loadScreen('app/screens-library.jsx', ['InstalledBrowser'], { React, window: win, Icon, document: { addEventListener() {}, removeEventListener() {} }, Spinner: () => null, ScreenScroll: (p) => p.children, safeCssColor: (c) => c || 'var(--clay)' });
  const tree = draw(InstalledBrowser, { ctx: { toast: (m) => toasts.push(m) }, category: null, force: () => {} });
  assert.doesNotMatch(rtexts(tree).join(' '), /Active/, 'a file that was never opened is shown as the Active Bible');
  const btn = find(tree, n => n.type === 'button' && rtexts(n).join(' ').includes('Remove'));
  assert.equal(btn.length, 1);
  await btn[0].props.onClick();
  assert.deepEqual(removed, ['imported/aaa/old.bbl.mybible'], 'Remove did not reach removeModule; toasts: ' + toasts);
  assert.ok(!toasts.some(t => /Switch to another Bible/.test(t)));
});

// ── N2: end-record bytes inside an honest zip ───────────────────────────────────────────────────────────────────────────
test('N2 — AN HONEST ZIP that carries end-record bytes FAR from its end installs; the same bytes inside the last 64 KB are refused (and why)', async () => {
  const eocdSig = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  const p = await readyPhone();
  const db = await bibleDb('NE', 'End Bytes Bible', 'x');
  // the signature sits in a STORED file's data, more than 64 KB before the end of the archive
  const filler = Buffer.concat([eocdSig, Buffer.alloc(80 * 1024, 7)]);
  const far = realFflate.zipSync({ 'blob.bin': new Uint8Array(filler), 'ok.bbl.mybible': db }, { level: 0 });
  assert.ok(far.length > 65558, 'fixture: the signature must be out of the end-record window');
  const r = await p.Bible.installFromBytes(far, 'far.zip');
  assert.equal(r.ok, true, 'an honest zip with end-record bytes in its middle was refused: ' + JSON.stringify(r));
  // inside the last 64 KB the reader refuses it: a stored copy may be shared with a phone running an older reader that
  // scans the tail differently, so a second end-record signature there is ambiguity we do not keep
  const near = realFflate.zipSync({ 'ok.bbl.mybible': db, 'blob.bin': new Uint8Array(Buffer.concat([eocdSig, Buffer.alloc(100, 7)])) }, { level: 0 });
  assert.ok(near.length < 65558);
  const p2 = await readyPhone();
  assert.deepEqual(await p2.Bible.installFromBytes(near, 'near.zip'), { ok: false, reason: 'unusable' });
});
