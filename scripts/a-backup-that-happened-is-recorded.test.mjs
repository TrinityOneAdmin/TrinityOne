// A MEMBER WHO HAS BACKED UP MUST NOT BE TOLD FOR EVER THAT THEY HAVE NOT.
// Run: node --test scripts/a-backup-that-happened-is-recorded.test.mjs
//
// Audit item 18, 2026-09-14. MEASURED ON A PHONE before a line was changed — Oppo CPH2477, throwaway
// account, APK 213. Backed up through the "Back up your data" card on You:
//   · trinityone-backup-2026-09-14.json landed in /sdcard/Documents, 1812 bytes
//   · `trinityone.backedup.*` in localStorage: STILL EMPTY
//   · Today still read "Secure your account · Set up recovery so you never lose access if you change phones."
//
// TWO ROUTES PRODUCE A MEMBER BACKUP, and they are not two kinds of thing: both call the SAME
// collectMember(), which embeds `identity` — the member's twelve words — so completing EITHER genuinely
// makes them recoverable on a new phone.
//   · app/identity-extras.jsx doExport — the recovery hub. Recorded it.
//   · app/screens-library.jsx  run     — the card on You. Did not.
// The cost is not cosmetic: a member who did exactly what was asked keeps being nagged and is shown no
// backup date, which teaches them that the one reminder that matters can be ignored.
//
// ⚠ AND THE OPPOSITE ERROR IS ALREADY IN THE RECORD. Audit 2026-09-02 #7: recording a backup on saveFile's
// `res.warn` branch — where the direct write did NOT happen and it fell back, and the message says no copy
// may have been kept — silenced the nudge for precisely the members who had no file. Both directions below.
//
// ⚠ RULE 3: app/*.jsx ships UNBUNDLED, so `false && ` leaves every word in place and a text match still
// passes. Both handlers are LIFTED AND RUN. Nothing here asserts behaviour by matching text in a .jsx file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';

const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const LIB = read('app/screens-library.jsx');
const EXTRAS = read('app/identity-extras.jsx');
const BACKUP = read('app/backup.jsx');
const NPUB = 'npub1throwaway';

// The shipped recorder, lifted and run — this is the single writer both routes must reach.
function recorder() {
  const store = {};
  const fn = new Function('window', 'localStorage',
    fnBody(BACKUP, 'function recordBackup()', 'recordBackup') + '\nreturn recordBackup;')(
      { TrinityIdentity: { current: { npub: NPUB } } },
      { setItem: (k, v) => { store[k] = v; }, getItem: (k) => (k in store ? store[k] : null) });
  return { fn, store };
}

// ── ROUTE 1: the "Back up your data" card on You (app/screens-library.jsx `run`) ────────────────────────
function libraryRoute({ warn = false } = {}) {
  const r = recorder();
  const toasts = [];
  const scope = {
    secure: true, pass: 'a-long-enough-passphrase', busy: '',
    setBusy: () => {}, setDone: () => {}, setPicking: () => {}, setPass: () => {},
    ctx: { toast: (t) => toasts.push(String(t)) },
    PMIN: 12, setTimeout: () => {},
    window: {
      TrinityIdentity: { current: { npub: NPUB } },
      TrinityBackup: {
        checkPass: () => {}, PASS_MIN: 12,
        collectMember: async () => ({ v: 1, kind: 'member', local: {}, identity: 'twelve words here' }),
        encryptObj: async () => 'ciphertext',
        saveFile: async () => (warn ? { warn: 'This app can’t write the file here.' } : { where: 'Documents' }),
        savedWhere: () => 'Documents',
        recordBackup: r.fn,
      },
    },
    String, JSON, Date, Math, Number, Array, Object, Boolean, RegExp, console, Promise, Error,
  };
  const proxy = new Proxy(scope, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k];
      throw new ReferenceError('the shipped backup handler needs a stub for ' + String(k)); },
  });
  const run = new Function('scope', 'with (scope) { ' + fnBody(LIB, 'const run = async (mode) => {', 'run') + '\nreturn run; }')(proxy);
  return { run, store: r.store, toasts };
}

test('backing up from the card on You RECORDS it — the nudge must stop', async () => {
  const L = libraryRoute();
  await L.run('local');
  assert.equal(L.store['trinityone.backedup.' + NPUB] != null, true,
    'A MEMBER BACKED UP AND THE APP DID NOT RECORD IT. Measured on a phone: the file was written, carrying ' +
    'their twelve words, and Today still said "Secure your account". They are nagged for ever for doing ' +
    'exactly what was asked, and the Security screen shows no backup date.');
});

test('…and records a DATE, not a bare flag — the Security screen shows when', async () => {
  const L = libraryRoute();
  await L.run('local');
  const v = L.store['trinityone.backedup.' + NPUB];
  assert.match(String(v), /^\d{4}-\d{2}-\d{2}T/, 'the marker is not an ISO timestamp: ' + JSON.stringify(v));
});

test('a save that FELL BACK records nothing — the nudge must keep asking', async () => {
  // audit 2026-09-02 #7, the opposite error: `warn` means the direct write did not happen and the member
  // may have no file at all. Going quiet there abandons exactly the people who need the reminder.
  const L = libraryRoute({ warn: true });
  await L.run('local');
  assert.equal(L.store['trinityone.backedup.' + NPUB], undefined,
    'A BACKUP WAS RECORDED OVER A SAVE THAT SAYS IT MAY NOT HAVE HAPPENED. The nudge goes quiet for the ' +
    'members most likely to have no file.');
  assert.ok(L.toasts.some(t => /can’t write/.test(t)), 're-anchor: the fallback warning is no longer shown');
});

// ── ROUTE 2: the recovery hub (app/identity-extras.jsx markSaved) ───────────────────────────────────────
test('the recovery hub still records a backup, through the SAME one writer', () => {
  const r = recorder();
  const markSaved = new Function('window', 'localStorage',
    fnBody(EXTRAS, 'const markSaved = () => {', 'markSaved') + '\nreturn markSaved;')(
      { TrinityIdentity: { current: { npub: NPUB } }, TrinityBackup: { recordBackup: r.fn } },
      { setItem: () => { throw new Error('the hub wrote the key itself instead of going through recordBackup'); } });
  markSaved();
  assert.ok(r.store['trinityone.backedup.' + NPUB],
    'the recovery hub no longer records a backup at all — the route that always worked has broken');
});

test('the hub still works if backup.jsx has not loaded', () => {
  // The fallback exists because the sheet can open before that script does. It must not silently stop
  // recording in that window.
  const store = {};
  const markSaved = new Function('window', 'localStorage',
    fnBody(EXTRAS, 'const markSaved = () => {', 'markSaved') + '\nreturn markSaved;')(
      { TrinityIdentity: { current: { npub: NPUB } } },
      { setItem: (k, v) => { store[k] = v; } });
  markSaved();
  assert.ok(store['trinityone.backedup.' + NPUB], 'with no TrinityBackup on the page, nothing was recorded');
});

test('BOTH routes reach the same key, so the nudge cannot disagree with itself', async () => {
  const L = libraryRoute();
  await L.run('local');
  const viaCard = Object.keys(L.store);
  const r = recorder(); r.fn();
  assert.deepEqual(viaCard, Object.keys(r.store),
    'the two backup routes write DIFFERENT keys, so one of them will still be nagged: ' +
    JSON.stringify(viaCard) + ' vs ' + JSON.stringify(Object.keys(r.store)));
});
