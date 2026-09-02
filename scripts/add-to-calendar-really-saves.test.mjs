// "ADD TO CALENDAR" EITHER SAVES A FILE OR SAYS IT DID NOT.
// Run: node --test scripts/add-to-calendar-really-saves.test.mjs
//
// AUDIT 2026-08-29, confirmed ON THE DEVICE. svDownloadICS did
//     try { window.open(URL.createObjectURL(new Blob([ics]))) } catch (e) {}
// which is inert inside the APK's WebView: attached over CDP, no throw, no navigation, 104 files in
// /sdcard/Download before and after, nothing in logcat. All three callers toasted success on the next line.
//
// app/backup.jsx had already learned this — "a no-op inside a WebView, so refuse there rather than claim it
// worked" — and hard-throws. This button sat fifteen lines from the comment written to stamp the pattern out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fnBody, stripComments } from './test-slice.mjs';
import { loadScreen, miniReact, texts, find } from './render-jsx-screen.mjs';

const SRC = readFileSync(new URL('../app/screens-serving.jsx', import.meta.url), 'utf8');
function grabFn(src, sig) {
  const at = src.indexOf(sig);
  assert.notEqual(at, -1, sig + ' has moved — re-anchor this test, do not delete it');
  let depth = 0, q = '';
  for (let i = src.indexOf('{', at); i < src.length; i++) {
    const c = src[i], prev = src[i - 1];
    if (q) { if (c === q && prev !== '\\') q = ''; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i === -1) break; continue; }
    if (c === '{') depth++; else if (c === '}' && --depth === 0) return src.slice(at, i + 1);
  }
  assert.fail('could not find the end of ' + sig);
}
// svIcsEsc is the tiny escaper svDownloadICS calls; lift the real one rather than stub it, or the test
// stops covering what actually goes into the file.
const ESC = (() => {
  const l = SRC.split('\n').find(x => x.startsWith('const svIcsEsc'));
  assert.ok(l, 'svIcsEsc has moved — re-anchor this test, do not delete it');
  return l;
})();
const ICS = grabFn(SRC, 'async function svDownloadICS(it, churchName)');
const ADD = grabFn(SRC, 'async function svAddToCalendar(ctx, it)');
const ITEM = { date: '2026-09-06', time: '10:00', teamName: 'Welcome', role: 'Door', service: 'Morning' };

// `saveFile` null = the app has no backup module at all (a browser build).
function phone({ native = true, saveFile = null } = {}) {
  const seen = { saved: null, opened: null, toasts: [] };
  const scope = {
    window: {
      TrinityBackup: saveFile ? { saveFile: (...a) => { seen.saved = a; return saveFile(...a); } } : undefined,
      Capacitor: { isNativePlatform: () => native },
      open: (u) => { seen.opened = u; },
    },
    URL: { createObjectURL: () => 'blob:ics', revokeObjectURL: () => {} },
    Blob: function Blob(parts, o) { this.parts = parts; this.type = o && o.type; },
    setTimeout: () => {},
    Date,
  };
  const args = Object.keys(scope);
  const dl = new Function(...args, ESC + '\n' + ICS + '\nreturn svDownloadICS;')(...args.map(k => scope[k]));
  const add = new Function(...args, 'svDownloadICS', ADD + '\nreturn svAddToCalendar;')(...args.map(k => scope[k]), dl);
  const ctx = { church: { name: 'Trinity LA' }, toast: (m) => seen.toasts.push(m) };
  return { dl, add: (it) => add(ctx, it || ITEM), seen };
}

test('on a phone it hands the file to the chain that actually writes one', async () => {
  const p = phone({ saveFile: async () => ({ saved: true, where: 'documents' }) });
  await p.dl(ITEM, 'Trinity LA');
  assert.ok(p.seen.saved, 'the calendar file never reached the save chain');
  const [filename, body, mode, opts] = p.seen.saved;
  assert.match(filename, /\.ics$/, 'the file is not named as a calendar file');
  assert.match(body, /BEGIN:VCALENDAR/, 'the file is not a calendar');
  assert.equal(opts && opts.mime, 'text/calendar', 'it would be handed over as a JSON backup');
  assert.equal(mode, 'share', 'the member is never offered anywhere to put it');
  assert.equal(p.seen.opened, null, 'it still used the browser download, which writes nothing in the APK');
});

test('on a phone with no way to save, it REFUSES rather than pretending', async () => {
  const p = phone({ native: true, saveFile: null });
  await assert.rejects(() => p.dl(ITEM, 'Trinity LA'), /can.t save/i,
    'the APK silently did nothing and the caller was free to claim success');
});

test('in a browser the ordinary download still works', async () => {
  const p = phone({ native: false, saveFile: null });
  const r = await p.dl(ITEM, 'Trinity LA');
  assert.equal(r.saved, true);
  assert.equal(p.seen.opened, 'blob:ics', 'the browser path was broken while fixing the phone path');
});

test('the member is told it was saved, not that it was downloaded, when it went to a share sheet', async () => {
  const p = phone({ saveFile: async () => ({ saved: true, where: 'shared' }) });
  await p.add();
  assert.deepEqual(p.seen.toasts, ['Saved — choose where to keep it']);
});

test('a failure is reported as a failure — this is the whole defect', async () => {
  const p = phone({ native: true, saveFile: null });
  await p.add();
  assert.equal(p.seen.toasts.length, 1);
  assert.doesNotMatch(p.seen.toasts[0], /download|added/i,
    'the member was told the event was added to their calendar when no file was written');
  assert.match(p.seen.toasts[0], /can.t save/i);
});

test('every "add to calendar" control goes through the one helper', () => {
  // Three call sites toasted success independently; that is how they drifted from the truth in the first
  // place. There must be no direct caller of svDownloadICS left in the screen.
  //
  // STRENGTHENED 2026-08-30. The first version of this filtered out any line containing `await
  // svDownloadICS` — which is exactly what a new offending control would be written as, so the check
  // excused the very thing it exists to catch. Anchor on POSITION instead: every mention of the helper in
  // the code must be its own definition or inside svAddToCalendar, wherever it sits on the line and however
  // it is awaited. Comments are stripped first so the prose above it cannot satisfy the check.
  const code = stripComments(SRC);
  const defAt = code.indexOf('async function svDownloadICS(');
  assert.notEqual(defAt, -1, 'svDownloadICS has moved — re-anchor this test, do not delete it');
  const add = fnBody(code, 'async function svAddToCalendar(ctx, it)', 'svAddToCalendar');
  const addAt = code.indexOf(add), addEnd = addAt + add.length;
  const strays = [...code.matchAll(/svDownloadICS\s*\(/g)].map(m => m.index)
    .filter(i => !(i > defAt - 30 && i < defAt + 40) && !(i > addAt && i < addEnd))
    .map(i => 'line ' + (code.slice(0, i).split('\n').length));
  assert.deepEqual(strays, [],
    'a control calls svDownloadICS directly and can toast success over a file that was never written');
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════
// AUDIT 2026-08-30 — three more things that came in with the fix above.
//
// 97f4ff0 made this button really save a file by reusing `saveFile` from app/backup.jsx. Reusing the chain
// that works was right. What came with it:
//
//   (a) THE SHEET STOPPED CLOSING. The row it replaced ended `onClose()`; the replacement dropped it. The
//       member taps "Add to my calendar" in the Manage sheet, the sheet stays open, and they tap again — a
//       second file, and on a phone a second share sheet on top of the first.
//   (b) BACKUP WORDING REACHED A CALENDAR BUTTON. `saveFile` is backup-specific in four places this path can
//       reach: "…open TrinityOne in a browser to make a backup", 'use "Save to device"' (a button that only
//       exists on the backup card), the raw Capacitor string "Share canceled", and where:'cloud' read as
//       "Downloaded". Worse, svAddToCalendar DISCARDED `r.warn` — the sentence saying no copy was kept —
//       which three of saveFile's four other callers honour. CLAUDE.md rule 2 exactly.
//   (c) THE BROWSER SHARE PATH IGNORED THE NEW OPTIONS. The three native paths were parameterised; the
//       browser one still hardcoded application/json and "TrinityOne backup", so on a PWA the .ics was
//       offered as a JSON backup and calendar apps — which filter by MIME type — removed themselves from the
//       chooser. (The auditor's claim that the FILENAME was wrong too is not true; the filename is passed.)
//
// These run the REAL chain: the real saveFile lifted out of app/backup.jsx, behind the real svDownloadICS.
// ══════════════════════════════════════════════════════════════════════════════════════════════════════════
const BACKUP = readFileSync(new URL('../app/backup.jsx', import.meta.url), 'utf8');
const SAVEFILE = fnBody(BACKUP, 'async function saveFile(filename, text, mode, opts) {', 'saveFile');

// A phone (or browser) with the REAL saveFile behind the REAL svDownloadICS. `fs` decides what the
// filesystem plugin does; `share` decides what the share sheet does; `webShare` drives the browser path.
function realChain({ native = true, fs = 'ok', share = 'ok', webShare = null } = {}) {
  const seen = { toasts: [], shared: [], webShared: [], wrote: [], anchored: [] };
  const Filesystem = {
    writeFile: async ({ path, directory }) => {
      seen.wrote.push(directory);
      if (directory === 'DOCUMENTS' && fs !== 'ok') throw new Error('EACCES');
      return { uri: 'file:///storage/emulated/0/' + (directory === 'CACHE' ? 'cache' : 'Documents') + '/' + path };
    },
  };
  const Share = {
    share: async (o) => { seen.shared.push(o); if (share !== 'ok') throw new Error('Share canceled'); },
  };
  const scope = {
    window: {
      Capacitor: { isNativePlatform: () => native, Plugins: native ? { Filesystem, Share: share === 'missing' ? null : Share } : null },
    },
    navigator: webShare
      ? { canShare: () => true, share: async (o) => { seen.webShared.push(o); } }
      : { canShare: () => false },
    document: { createElement: () => ({ set href(v) { seen.anchored.push(v); }, get href() { return 'blob:x'; }, click() {}, remove() {}, style: {} }), body: { appendChild() {} } },
    URL: { createObjectURL: () => 'blob:ics', revokeObjectURL: () => {} },
    Blob: function Blob(parts, o) { this.parts = parts; this.type = o && o.type; },
    File: function File(parts, name, o) { this.parts = parts; this.name = name; this.type = o && o.type; },
    setTimeout: () => {},
    Date,
  };
  const args = Object.keys(scope);
  const saveFile = new Function(...args, SAVEFILE + '\nreturn saveFile;')(...args.map(k => scope[k]));
  // svDownloadICS reaches saveFile through window.TrinityBackup, exactly as it does in the app.
  scope.window.TrinityBackup = { saveFile };
  const dl = new Function(...args, ESC + '\n' + ICS + '\nreturn svDownloadICS;')(...args.map(k => scope[k]));
  const add = new Function(...args, 'svDownloadICS', ADD + '\nreturn svAddToCalendar;')(...args.map(k => scope[k]), dl);
  const ctx = { church: { name: 'Trinity LA' }, toast: (m) => seen.toasts.push(m) };
  return { saveFile, run: () => add(ctx, ITEM), seen };
}

// The words a member must never see from a CALENDAR button.
const BACKUP_WORDS = /backup|back up|Save to device|Share canceled/i;

test('(b) a calendar save that fails does not talk to the member about backups', async () => {
  // The phone will not write to Documents and has no way to hand the file anywhere: saveFile throws, and
  // its default sentence tells the member to open TrinityOne in a browser TO MAKE A BACKUP.
  const c = realChain({ fs: 'deny', share: 'missing' });
  await c.run();
  assert.equal(c.seen.toasts.length, 1, 'the member was told nothing at all');
  assert.doesNotMatch(c.seen.toasts[0], BACKUP_WORDS,
    'a member who tapped "Add to my calendar" was told to open the app in a browser to make a backup. They ' +
    'were not making a backup and there is no backup to make');
});

test('(b) a share sheet the member closed is explained in English, not in Capacitor', async () => {
  // @capacitor/share rejects a dismissed sheet with the bare string "Share canceled", and every caller of
  // saveFile puts e.message straight in front of the member.
  const c = realChain({ fs: 'deny', share: 'cancel' });
  await c.run();
  assert.equal(c.seen.toasts.length, 1);
  assert.doesNotMatch(c.seen.toasts[0], /Share canceled/,
    'the member was shown a plugin’s internal string as if it were a sentence');
  assert.doesNotMatch(c.seen.toasts[0], BACKUP_WORDS);
  assert.match(c.seen.toasts[0], /again/i,
    'nothing was kept and the member is not told they can have another go');
});

test('(b) the "no copy was kept" warning is not thrown away', async () => {
  // Documents is refused, so the file went to CACHE — which Android clears when it likes — and straight
  // into a share sheet. saveFile says so in `warn`. Three of its four other callers show that sentence.
  const c = realChain({ fs: 'deny', share: 'ok' });
  await c.run();
  assert.equal(c.seen.toasts.length, 1);
  assert.match(c.seen.toasts[0], /no copy was kept/i,
    'the member was told the file was saved when saveFile had just said, in so many words, that if they ' +
    'closed the sheet without keeping it nothing was kept');
  assert.doesNotMatch(c.seen.toasts[0], /^Downloaded/,
    'and it was called a download, which is the exact claim the warning contradicts');
});

test('(b) a file written to the phone is not announced as a "download"', async () => {
  const c = realChain({ fs: 'ok', share: 'ok' });
  await c.run();
  assert.deepEqual(c.seen.wrote, ['DOCUMENTS', 'CACHE'], 'the durable write or the share offer was lost');
  assert.equal(c.seen.toasts.length, 1);
  assert.doesNotMatch(c.seen.toasts[0], /^Downloaded/,
    'saveFile returns where:"cloud" here — the file is in the phone’s Documents folder, not its Downloads ' +
    '— and the member was sent looking in the wrong place');
  assert.match(c.seen.toasts[0], /calendar/i, 'it no longer says what to do with the file');
});

test('(b) the share sheet a calendar file goes into is titled as a calendar file', async () => {
  const c = realChain({ fs: 'ok', share: 'ok' });
  await c.run();
  assert.ok(c.seen.shared.length, 'nothing was offered to another app at all');
  const offered = JSON.stringify(c.seen.shared[0]);
  assert.doesNotMatch(offered, BACKUP_WORDS, 'the calendar file was offered to the chooser as a backup');
});

test('(c) in a browser the calendar file is shared AS a calendar file', async () => {
  const c = realChain({ native: false, webShare: true });
  await c.run();
  assert.equal(c.seen.webShared.length, 1, 'the browser share path was not taken');
  const { files, title } = c.seen.webShared[0];
  assert.equal(files[0].type, 'text/calendar',
    'on a PWA the .ics was offered as application/json — calendar apps filter the chooser by MIME type, so ' +
    'they removed themselves from the list and the member had no way to add the event');
  assert.match(files[0].name, /\.ics$/, 'the filename was lost (this half of the report was already fine)');
  assert.doesNotMatch(title, BACKUP_WORDS, 'the chooser called the member’s rota entry a TrinityOne backup');
});

test('(b/c) the four BACKUP callers still get the backup wording — defaults unchanged', async () => {
  // saveFile's four callers are listed above it in app/backup.jsx. Three pass no options at all, so every
  // sentence parameterised for the calendar must still default to exactly what it said before.
  const c = realChain({ fs: 'deny', share: 'missing' });
  await assert.rejects(() => c.saveFile('trinityone-backup.json', '{}', undefined, undefined),
    /open TrinityOne in a browser to make a backup/,
    'the church-key backup lost the sentence that tells a steward what to do instead');
  const b = realChain({ fs: 'ok', share: 'ok' });
  await b.saveFile('trinityone-backup.json', '{}', undefined, undefined);
  assert.equal(b.seen.shared[0].title, 'TrinityOne backup', 'the backup share sheet lost its title');
  const w = realChain({ native: false, webShare: true });
  await w.saveFile('trinityone-backup.json', '{}', undefined, undefined);
  assert.equal(w.seen.webShared[0].files[0].type, 'application/json', 'a backup is no longer shared as JSON');
  assert.equal(w.seen.webShared[0].title, 'TrinityOne backup');
});

// ── (a) the Manage sheet closes ───────────────────────────────────────────────────────────────────────────
// Rendered, not read: CLAUDE.md rule 3. app/screens-serving.jsx ships unbundled, so a source match would
// pass over `false && onClose()`.
function manageSheet() {
  const { React, draw } = miniReact();
  const seen = { closed: 0, toasts: [], saved: 0 };
  const mod = loadScreen('app/screens-serving.jsx', ['ManageSheet'], {
    React,
    window: {
      TrinityBackup: { saveFile: async () => { seen.saved++; return { saved: true, where: 'cloud', uri: 'file:///x/Documents/a.ics' }; } },
      Capacitor: { isNativePlatform: () => true },
      Fellowship: { myPubkey: 'mehex' },
      addEventListener: () => {}, removeEventListener: () => {},
      localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    },
    document: { createElement: () => ({ style: {}, appendChild() {}, remove() {}, click() {} }), body: { appendChild() {}, removeChild() {} }, addEventListener() {}, removeEventListener() {} },
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    Icon: () => null, IconBtn: () => null,
    BottomSheet: ({ open, children }) => (open ? children : null),
    safeCssColor: (c) => c,
  });
  const ctx = { toast: (m) => seen.toasts.push(m), church: { name: 'Trinity LA' }, myPubkey: 'mehex' };
  const item = { ...ITEM, accent: 'var(--clay)', icon: 'hand', id: 'r1' };
  const draw1 = () => draw(mod.ManageSheet, { open: true, item, onClose: () => { seen.closed++; }, onSwap: () => {}, ctx });
  return { draw: draw1, seen };
}

test('(a) CONTROL: the Manage sheet offers "Add to my calendar" and it saves a file', async () => {
  const m = manageSheet();
  const row = find(m.draw(), n => n.type === 'button' && texts(n).join(' ').includes('Add to my calendar'));
  assert.equal(row.length, 1, 'the calendar row is gone from the Manage sheet — re-anchor this test');
  row[0].props.onClick();
  await new Promise(r => setTimeout(r, 0));
  assert.equal(m.seen.saved, 1, 'the row no longer saves anything');
});

test('(a) …and tapping it CLOSES the sheet, so the member cannot save it twice', async () => {
  const m = manageSheet();
  find(m.draw(), n => n.type === 'button' && texts(n).join(' ').includes('Add to my calendar'))[0].props.onClick();
  assert.equal(m.seen.closed, 1,
    'the sheet stayed open over a save that can take twelve seconds, with the row still under the ' +
    'member’s thumb. The row this replaced ended onClose(); reusing the save chain dropped it. Tapping ' +
    'again writes a second file and, on a phone, stacks a second share sheet on the first');
});
