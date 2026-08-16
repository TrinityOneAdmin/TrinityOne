// A BACKUP THAT DID NOT SAVE MUST NOT REPORT THAT IT DID.
// Run: node --test scripts/backup-saves-somewhere.test.mjs
//
// MEASURED ON A DEVICE (OPPO CPH2477, Android 12, 2026-08-16): clicking an `<a download>` inside the Capacitor
// WebView produces NO FILE ANYWHERE — not Downloads, not Documents, not app storage — and raises no error.
// `saveFile` returned `{ saved: true, where: 'downloads' }` from exactly that path. Every caller then marked
// the member as backed up (silencing the backup nudge that exists to catch this) and told them the file was
// safe. The member believes they hold a copy of their account, and does not.
//
// The default path was no better. It wrote to CACHE — which Android clears whenever it likes — and opened a
// share sheet. Dismissing the sheet left nothing on the phone, and the app said "Backup created". THREE of the
// four callers passed no mode and therefore took that path, including the one that saves the CHURCH KEY.
// Owner-reported as "back up to device doesn't actually download on the APK", on a Pixel; reproduced on the
// OPPO; the same shape had already been seen in the relay's own backup.
//
// So the rule this file exists to hold: on native, always write a durable copy FIRST and let sharing be an
// offer on top of a file that already exists — and where nothing can be written, THROW, because a caller
// cannot be trusted not to turn a returned object into "saved".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody, stripComments } from './test-slice.mjs';

const BACKUP = readFileSync(new URL('../app/backup.jsx', import.meta.url), 'utf8');
const EXTRAS = readFileSync(new URL('../app/identity-extras.jsx', import.meta.url), 'utf8');
const DASH   = readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8');

// The REAL saveFile, lifted from the shipped source and driven against a fake Capacitor bridge.
function loadSaveFile({ native = false, filesystem = true, share = true, shareThrows = false, webShare = false } = {}) {
  const writes = [], shares = [], anchors = [];
  const Plugins = {};
  if (filesystem) {
    Plugins.Filesystem = { writeFile: async (o) => { writes.push(o); return { uri: 'file:///storage/emulated/0/' + (o.directory === 'CACHE' ? 'cache' : 'Documents') + '/' + o.path }; } };
  }
  if (share) {
    Plugins.Share = { share: async (o) => { if (shareThrows) throw new Error('Share canceled'); shares.push(o); } };
  }
  const win = { Capacitor: { Plugins, isNativePlatform: () => native } };
  const doc = { createElement: () => ({ click() { anchors.push(this.download); }, remove() {}, set href(v) { this._h = v; }, get href() { return this._h; } }), body: { appendChild() {} } };
  const nav = webShare ? { canShare: () => true, share: async () => { shares.push('web'); } } : {};
  const fn = new Function('window', 'document', 'navigator', 'URL', 'Blob', 'File', 'setTimeout',
    fnBody(BACKUP, 'async function saveFile(') + '; return saveFile;')(
    win, doc, nav, { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
    function Blob() {}, function File() {}, () => {});
  return { saveFile: fn, writes, shares, anchors };
}

test('on the app, a plain "save a backup" writes a durable file — not just a share sheet', async () => {
  const { saveFile, writes, shares } = loadSaveFile({ native: true });
  const res = await saveFile('backup.json', '{}');          // no mode: the path 3 of 4 callers take
  assert.equal(res.saved, true);
  assert.equal(res.where, 'device', 'the member must end up with a file on the phone, whatever they do with the sheet');
  assert.ok(writes.some(w => w.directory === 'DOCUMENTS'), 'a durable copy must be written before anything is offered');
  assert.match(res.uri, /Documents/, 'the caller needs the location to be able to say where it went');
  assert.equal(shares.length, 1, 'sharing is still offered — it is how a copy reaches Drive');
});

test('dismissing the share sheet does not lose the backup', async () => {
  const { saveFile, writes } = loadSaveFile({ native: true, shareThrows: true });
  const res = await saveFile('backup.json', '{}');
  assert.equal(res.saved, true, 'closing the sheet is a choice, not a failure — the file is already written');
  assert.equal(res.where, 'device');
  assert.ok(writes.some(w => w.directory === 'DOCUMENTS'));
});

test('"save to device" never opens a sheet', async () => {
  const { saveFile, writes, shares } = loadSaveFile({ native: true });
  const res = await saveFile('backup.json', '{}', 'local');
  assert.equal(res.where, 'device');
  assert.equal(shares.length, 0, 'the member asked for the device, not for a chooser');
  assert.ok(writes.every(w => w.directory === 'DOCUMENTS'), 'no CACHE copy is needed when nothing is shared');
});

test('on the app, a path that cannot write THROWS instead of claiming success', async () => {
  for (const opts of [{ native: true, filesystem: false, share: false }, { native: true, filesystem: false, share: true }]) {
    const { saveFile, anchors } = loadSaveFile(opts);
    await assert.rejects(() => saveFile('backup.json', '{}'),
      /can’t write the file here/,
      'an <a download> inside a WebView produces no file at all — returning an object here is how the member ' +
      'gets told their account is backed up when nothing was written');
    assert.equal(anchors.length, 0, 'and it must not even try — a silent no-op is what this guards');
  }
});

test('in a real browser the download still works', async () => {
  const { saveFile, anchors } = loadSaveFile({ native: false, filesystem: false, share: false });
  const res = await saveFile('backup.json', '{}', 'local');
  assert.equal(res.saved, true);
  assert.equal(res.where, 'downloads');
  assert.deepEqual(anchors, ['backup.json'], 'a browser download is real — only the WebView cannot do it');
});

test('savedWhere turns a uri into something a person can go and look at', () => {
  const savedWhere = new Function(fnBody(BACKUP, 'function savedWhere(') + '; return savedWhere;')();
  assert.equal(savedWhere({ where: 'device', uri: 'file:///storage/emulated/0/Documents/trinityone-backup-2026-08-16.json' }),
    'Documents/trinityone-backup-2026-08-16.json');
  assert.equal(savedWhere({ where: 'device' }), 'your Documents folder');
  assert.equal(savedWhere({ where: 'downloads' }), 'your downloads');
  assert.equal(savedWhere(null), '', 'no result → say nothing rather than invent a place');
});

// ── the callers have to use the answer ───────────────────────────────────────────────────────────────────
// Comment-stripped: the comments at both sites name saveFile and savedWhere.

test('the member’s backup says where the file went', () => {
  const doExport = stripComments(fnBody(EXTRAS, 'const doExport = async () => {'));
  assert.match(doExport, /const res = await window\.TrinityBackup\.saveFile\(/, 'the result carries the location');
  assert.match(doExport, /savedWhere\(res\)/,
    '"save it somewhere safe" is advice, not a receipt — and this path used to write nothing at all');
});

test('the church backup says where the church key went', () => {
  const src = stripComments(DASH);
  const at = src.indexOf("saveFile('trinityone-' +");
  assert.notEqual(at, -1, 'the church backup is gone — re-anchor this test');
  const around = src.slice(at - 200, at + 500);
  assert.match(around, /const res = await window\.TrinityBackup\.saveFile\(/,
    'this file is the only copy of the church key — the steward must be able to check it exists');
  assert.match(around, /savedWhere\(res\)/);
});
