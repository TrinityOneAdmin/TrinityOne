// "SAVE QR", "SAVE INSTALL QR", "EXPORT CSV" AND THE STATEMENT'S HTML FALLBACK MUST SAVE A FILE ON THE PHONE.
// Run: node --test scripts/save-qr-saves-a-file-on-the-phone.test.mjs
//
// Console audit 2026-09-19, P7. All four buttons ended in `<a download>` + click(). Inside the Capacitor
// WebView that writes no file anywhere under /sdcard, throws nothing, and changes nothing on screen — measured
// on the Oppo. The backup card was cured of exactly this on 2026-08-16 (memory: backup-anchor-download-is-inert);
// these four callers were not.
//
// The fix routes them through TrinityBackup.saveFile via saveConsoleFile (stew-dashboard.jsx). This file
// presses the REAL buttons on the REAL screens, mounted the way the phone mounts them (scripts/console-screens.mjs:
// every console script compiled with esbuild `jsx: 'transform'` into one scope, backup.jsx's real saveFile
// included). The only stand-ins are the browser, window.Steward, and the Capacitor bridge — a Filesystem and a
// Share that record what they were given.
//
// THE RASTER IS BROWSER-ONLY, SO TWO BROWSER PIECES ARE FAKED HERE, MINIMALLY: `Image` (fires onload on the next
// tick) and a `canvas` whose toBlob hands back fixed PNG bytes. Faking them rather than routing the native
// branch around them keeps ONE raster path in production; what this proves is that the bytes toBlob produces are
// the bytes that reach the Filesystem, unchanged.
//
// ⚠ RULE 3 (CLAUDE.md): nothing here matches text in a .jsx file. Each component is called and its output read.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConsole, fakeReact, fakeBrowser, fakeSteward, nodes } from './console-screens.mjs';

// Eight bytes of PNG signature plus a little body: non-empty, recognisable, and not valid UTF-8 — so a path
// that pushed it through a text encoding would not hand these bytes back.
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0xff, 0xfe, 0x80, 0x7f]);
const JOIN_URL = 'https://console.example/?follow=npub1abc&relay=' + encodeURIComponent('wss://relay.example/relay');

// A console on a phone (native: true) or in a browser (native: false), with the four buttons' screens loaded.
// `filesystem`: 'ok' (writes land) | 'refused' (every write throws) | absent (no Filesystem plugin at all).
function console_({ native = true, filesystem = 'ok', share = true } = {}) {
  const { React, reset, flush, fresh, unmount } = fakeReact();
  const Steward = fakeSteward({ npub: 'npub1abc', qrSVG: (t) => '<svg>' + t + '</svg>', joinUrl: () => JOIN_URL, joinLinkIsPrivate: () => false, isSelfHosted: () => false });
  const { window, document } = fakeBrowser({ Steward });
  const writes = [], shares = [], anchors = [];
  if (native) {
    const Plugins = {};
    if (filesystem) Plugins.Filesystem = { writeFile: async (o) => {
      if (filesystem === 'refused') throw new Error('FILE_NOTCREATED');
      writes.push(o); return { uri: 'file:///storage/emulated/0/' + (o.directory === 'DOCUMENTS' ? 'Documents/' : 'Android/data/church.trinityone/cache/') + o.path };
    } };
    if (share) Plugins.Share = { share: async (o) => { shares.push(o); } };
    window.Capacitor = { isNativePlatform: () => true, Plugins };
  }
  // Browser pieces the raster needs, and the anchor recorder for the web rows.
  window.Image = class { set src(v) { this._src = v; setTimeout(() => this.onload && this.onload(), 0); } get src() { return this._src; } };
  const create = document.createElement;
  document.createElement = (tag) => {
    // toDataURL is for churchMarkDataUrl (the statement dialog's logo effect draws a canvas too); it is not on the path under test.
    if (tag === 'canvas') return { width: 0, height: 0, getContext: () => ({ fillStyle: '', fillRect() {}, drawImage() {}, arc() {}, fill() {}, beginPath() {}, closePath() {}, clip() {}, save() {}, restore() {}, fillText() {} }), toBlob(cb, type) { cb(new Blob([PNG], { type })); }, toDataURL: () => 'data:image/png;base64,' };
    if (tag === 'a') { const a = { clicked: 0, click() { this.clicked++; }, remove() {}, style: {} }; anchors.push(a); return a; }
    return create(tag);
  };
  const mods = loadConsole({ React, window, vendor: ['vendor/finance-ledger.js'], expr: '{ JoinModal, JoinCard, DashFinanceBook, FinanceShareStatement }' });
  assert.ok(window.TrinityBackup && window.TrinityBackup.saveFile, 're-anchor: backup.jsx no longer installs window.TrinityBackup.saveFile');
  const button = (tree, label) => nodes(tree).find(n => n.type === 'button' && (n.kids || []).some(k => typeof k === 'string' && k.includes(label)));
  const statuses = (tree) => nodes(tree).filter(n => n.props && n.props.role === 'status').map(n => (n.kids || []).filter(k => typeof k === 'string').join(''));
  // Let the async chain run: Image onload (a tick), toBlob → arrayBuffer → two writes → a share → setState.
  const settle = async (done) => { for (let i = 0; i < 60 && !done(); i++) await new Promise(r => setTimeout(r, 5)); };
  return { React, reset, flush, fresh, unmount, window, mods, writes, shares, anchors, button, statuses, settle };
}

// The Invite dialog places JoinCard; the harness never calls child components, so mount the element it placed
// with the props it gave. That is the point of use: delete <JoinCard/> from JoinModal and this returns null.
function inviteCard(c) {
  const { JoinModal, JoinCard } = c.mods;
  c.reset(); const dialog = JoinModal({ onClose() {} }); c.flush();
  const placed = nodes(dialog).find(n => n.type === JoinCard);
  assert.ok(placed, 'THE POINT OF USE: the Invite dialog (JoinModal) no longer places JoinCard');
  c.fresh();
  let tree;
  const draw = () => { c.reset(); tree = JoinCard(placed.props); c.flush(); return tree; };
  draw();
  return { draw, get tree() { return tree; } };
}

const docs = (c) => c.writes.filter(w => w.directory === 'DOCUMENTS');
const b64ToBytes = (s) => Uint8Array.from(Buffer.from(s, 'base64'));

test('on the phone, "Save QR" in the Invite dialog writes one PNG to Documents, offers the share sheet, and says where it went', async () => {
  const c = console_({ native: true });
  const card = inviteCard(c);
  const save = c.button(card.tree, 'Save QR');
  assert.ok(save, 're-anchor: no "Save QR" button on the invite card');
  save.props.onClick();
  await c.settle(() => c.shares.length >= 1);

  const d = docs(c);
  assert.equal(d.length, 1, 'THE DEFECT: pressing Save QR on the phone wrote no file to Documents (it used to click an <a download>, which the WebView ignores)');
  assert.match(d[0].path, /^join-.*\.png$/, 'the file is not named join-<church>.png: ' + d[0].path);
  assert.equal('encoding' in d[0], false, 'the PNG was written with a text encoding — its bytes would be mangled');
  assert.ok(typeof d[0].data === 'string' && d[0].data.length > 0, 'the PNG write carried no content');
  assert.deepEqual(b64ToBytes(d[0].data), PNG, 'the bytes written are not the bytes the canvas produced');
  assert.ok(c.writes.every(w => w.path === d[0].path), 'more than one file name was written: ' + c.writes.map(w => w.path).join(', '));
  assert.equal(c.shares.length, 1, 'the share sheet was not offered exactly once');
  assert.equal(c.anchors.filter(a => a.clicked).length, 0, 'an <a download> was still clicked on the phone');

  card.draw();
  const line = c.statuses(card.tree);
  assert.equal(line.length, 1, 'no role="status" line appeared after the save — the button is still silent on the phone');
  assert.match(line[0], /Documents\/join-.*\.png/, 'the receipt does not name where the file went: ' + JSON.stringify(line[0]));
  c.unmount();
});

test('on the phone, "Save install QR" writes one PNG named install-<church>.png the same way', async () => {
  const c = console_({ native: true });
  const card = inviteCard(c);
  const save = c.button(card.tree, 'Save install QR');
  assert.ok(save, 're-anchor: no "Save install QR" button — installPageUrl() must return a url for the fixture joinUrl (relay=wss://relay.example)');
  save.props.onClick();
  await c.settle(() => c.shares.length >= 1);

  const d = docs(c);
  assert.equal(d.length, 1, 'THE DEFECT: pressing Save install QR on the phone wrote no file to Documents');
  assert.match(d[0].path, /^install-.*\.png$/, 'the file is not named install-<church>.png: ' + d[0].path);
  assert.deepEqual(b64ToBytes(d[0].data), PNG, 'the bytes written are not the bytes the canvas produced');
  assert.equal(c.shares.length, 1, 'the share sheet was not offered exactly once');
  card.draw();
  const line = c.statuses(card.tree);
  assert.equal(line.length, 1, 'no receipt line after saving the install QR');
  assert.match(line[0], /Documents\/install-.*\.png/, 'the receipt does not name the file: ' + JSON.stringify(line[0]));
  c.unmount();
});

test('on the phone, a save that cannot write says so on screen — it never stays silent', async () => {
  // Filesystem refuses Documents and there is no Share plugin to hand the file to: saveFile throws its
  // "won’t let the app save the file" sentence, and the card must show it, not swallow it.
  const c = console_({ native: true, filesystem: 'refused', share: false });
  const card = inviteCard(c);
  c.button(card.tree, 'Save QR').props.onClick();
  await c.settle(() => c.statuses(card.draw()).length >= 1);
  const line = c.statuses(card.tree);
  assert.equal(line.length, 1, 'THE DEFECT, second form: the save failed and the screen said nothing');
  assert.doesNotMatch(line[0], /^Saved/, 'the screen claims a save that did not happen: ' + JSON.stringify(line[0]));
  assert.match(line[0], /won.t let the app save/, 'the failure line is not saveFile’s cannot-write sentence: ' + JSON.stringify(line[0]));
  assert.equal(c.writes.length, 0);
  c.unmount();
});

test('in a browser, "Save QR" is still a download: one anchor with a .png download name is clicked and no Filesystem is touched', async () => {
  const c = console_({ native: false });
  const card = inviteCard(c);
  c.button(card.tree, 'Save QR').props.onClick();
  await c.settle(() => c.anchors.some(a => a.clicked));
  const clicked = c.anchors.filter(a => a.clicked);
  assert.equal(clicked.length, 1, 'the browser path did not click exactly one anchor');
  assert.match(String(clicked[0].download), /^join-.*\.png$/, 'the anchor’s download name is not join-<church>.png: ' + clicked[0].download);
  assert.ok(clicked[0].href, 'the anchor has no href');
  assert.equal(c.writes.length, 0, 'a browser build reached a Capacitor Filesystem');
  assert.equal(c.shares.length, 0);
  card.draw();
  assert.equal(c.statuses(card.tree).length, 0, 'a browser shows its own download bar; the card must not add a receipt line there');
  c.unmount();
});

test('in a browser, the file behind the "Save QR" download is the DECODED PNG — its bytes, not their base64 text', async () => {
  // Audit 2026-09-19 (P7 table, sabotage K): with the Blob built from the undecoded base64 string, the row
  // above still passed — an anchor with a .png name was clicked. A desktop "Save QR" would then have
  // downloaded base64 TEXT named .png. So capture what the anchor points at and read its bytes.
  const c = console_({ native: false });
  // Every object URL made while the button runs (the raster makes one for its SVG <img> too), keyed by url,
  // so the download is whichever one the CLICKED anchor's href names.
  const blobs = new Map();
  const RealURL = c.window.URL;
  c.window.URL = class extends RealURL { static createObjectURL(b) { const u = 'blob:console.example/' + (blobs.size + 1); blobs.set(u, b); return u; } static revokeObjectURL() {} };
  const card = inviteCard(c);
  c.button(card.tree, 'Save QR').props.onClick();
  await c.settle(() => c.anchors.some(a => a.clicked));
  const clicked = c.anchors.filter(a => a.clicked);
  assert.equal(clicked.length, 1, 'the browser path did not click exactly one anchor');
  const blob = blobs.get(clicked[0].href);
  assert.ok(blob, 'the clicked anchor’s href is not an object URL made during the save: ' + clicked[0].href);
  assert.equal(blob.type, 'image/png', 'the download is not typed image/png: ' + JSON.stringify(blob.type));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  assert.deepEqual(Array.from(bytes.subarray(0, 8)), [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'THE DEFECT: the file does not start with the PNG signature — the browser would download base64 text named .png: ' + Buffer.from(bytes).toString('latin1').slice(0, 24));
  assert.deepEqual(Array.from(bytes), Array.from(PNG), 'the bytes downloaded are not the bytes the canvas produced');
  c.unmount();
});

test('on the phone, Finance → "Export CSV" writes one .csv to Documents and shows the receipt', async () => {
  const c = console_({ native: true });
  const { DashFinanceBook } = c.mods;
  let tree;
  const draw = () => { c.reset(); tree = DashFinanceBook(); c.flush(); return tree; };
  draw();
  const btn = c.button(tree, 'Export CSV');
  assert.ok(btn, 're-anchor: no "Export CSV" button on the finance screen');
  btn.props.onClick();
  await c.settle(() => c.shares.length >= 1);

  const d = docs(c);
  assert.equal(d.length, 1, 'THE DEFECT: Export CSV on the phone wrote no file to Documents');
  assert.match(d[0].path, /^finance-\d{4}-\d{2}-\d{2}\.csv$/, 'the export is not named finance-<date>.csv: ' + d[0].path);
  assert.equal(d[0].encoding, 'utf8', 'a CSV is text and must be written as utf8');
  assert.match(String(d[0].data), /^"seq","date","memo"/, 'the CSV written does not start with the header row');
  assert.equal(c.shares.length, 1, 'the share sheet was not offered exactly once');
  draw();
  const line = c.statuses(tree);
  assert.equal(line.length, 1, 'no receipt line on the finance screen after the export');
  assert.match(line[0], /Documents\/finance-.*\.csv/, 'the receipt does not name the file: ' + JSON.stringify(line[0]));
  c.unmount();
});

test('on the phone, the statement dialog’s "Download" (HTML fallback, no jsPDF loaded) writes one .html to Documents and the flash says where', async () => {
  const c = console_({ native: true });
  const { FinanceShareStatement } = c.mods;
  const F = c.window.FinanceLedger;
  assert.equal(typeof F?.createBook, 'function', 're-anchor: vendor/finance-ledger.js no longer defines FinanceLedger.createBook');
  assert.equal(c.window.jspdf, undefined, 'the harness has jsPDF — this test drives the HTML fallback and needs it absent');
  const book = F.createBook({ baseCurrency: 'GBP', decimals: 2 });
  let tree;
  const draw = () => { c.reset(); tree = FinanceShareStatement({ book, F, churchName: 'St Test', accent: '', logo: '', canPost: false, onPostToMembers() {}, onClose() {} }); c.flush(); return tree; };
  draw();
  const btn = c.button(tree, 'Download');
  assert.ok(btn, 're-anchor: no "Download" button in the statement dialog');
  assert.equal(btn.props.disabled, false, 'Download is disabled with the default sections on — fixture problem, not a finding');
  btn.props.onClick();
  await c.settle(() => c.shares.length >= 1);

  const d = docs(c);
  assert.equal(d.length, 1, 'THE DEFECT: the statement’s HTML fallback on the phone wrote no file to Documents');
  assert.match(d[0].path, /\.html$/, 'the statement is not saved as .html: ' + d[0].path);
  assert.match(String(d[0].data), /<html|<!doctype/i, 'the file written is not the statement HTML');
  assert.equal(c.shares.length, 1);
  draw();
  const flash = nodes(tree).filter(n => n.type === 'p').map(n => (n.kids || []).filter(k => typeof k === 'string').join('')).filter(t => /Documents\//.test(t));
  assert.equal(flash.length, 1, 'the dialog’s flash line does not say where the statement went — it used to print "Downloaded" over nothing');
  c.unmount();
});

test('in a browser, "Export CSV" is still a download: one anchor with a .csv download name is clicked', async () => {
  const c = console_({ native: false });
  const { DashFinanceBook } = c.mods;
  c.reset(); const tree = DashFinanceBook(); c.flush();
  c.button(tree, 'Export CSV').props.onClick();
  await c.settle(() => c.anchors.some(a => a.clicked));
  const clicked = c.anchors.filter(a => a.clicked);
  assert.equal(clicked.length, 1, 'the browser path did not click exactly one anchor');
  assert.match(String(clicked[0].download), /^finance-.*\.csv$/, 'the anchor’s download name is not finance-<date>.csv: ' + clicked[0].download);
  assert.equal(c.writes.length, 0, 'a browser build reached a Capacitor Filesystem');
  c.unmount();
});
