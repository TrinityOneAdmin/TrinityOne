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
  const direct = SRC.split('\n')
    .map((l, i) => [i + 1, l])
    .filter(([, l]) => l.includes('svDownloadICS(') && !l.includes('async function svDownloadICS') && !l.includes('await svDownloadICS'));
  assert.deepEqual(direct.map(([n]) => n), [],
    'a control calls svDownloadICS directly and can toast success over a file that was never written');
});
