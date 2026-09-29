// AN UPLOAD THAT FAILED TO NOTIFY SAYS SO.
//   Run: node --test scripts/an-upload-that-failed-to-notify-says-so.test.mjs
//
// THE DEFECT. `doUpload` in `app/stew-dashboard.jsx` called `pinSermon` inside a try/catch and
// discarded the result. The success message always said "members notified" regardless of whether the
// pin reached the relay. So a steward whose connection dropped after the blob uploaded believed
// everyone had been told, when nobody had.
//
// THE FIX captures the pin result and says "saved, but members weren't notified" when it failed.
//
// Callers: `doUpload` is called by `SermonEditModal.onSave` and the DashSermons component.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';

const DASH = readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8');
const UPLOAD_DECL = fnBody(DASH, 'const doUpload = async (f, fields) => {', 'doUpload');
const UPLOAD = UPLOAD_DECL.replace(/^const doUpload\s*=\s*/, '');

function run({ pinResult }) {
  let msg = '';
  const scope = {
    _churchOnly: false,
    encOn: false,
    mirrorHosts: '',
    members: [],
    notify: true,
    sermonsLoaded: true,
    sermons: [],
    uploadedSigs: { current: new Set() },
    setUpBusy: () => {},
    setUpMsg: (m) => { msg = m; },
    fmtSize: () => '1MB',
    SERMON_OWNER_ONLY: '',
    window: {
      Steward: {
        mediaEncryptor: null,
        uploadBlob: async () => ({ sha256: 'abc', host: 'h', hosts: ['h'], mime: 'audio/mp3', size: 1000, enc: false }),
        publishSermon: async () => ({ id: 's1' }),
        pinSermon: async () => pinResult,
      },
    },
    setTimeout: globalThis.setTimeout,
  };
  const fn = new Function('scope', `with (scope) { return (${UPLOAD}); }`)(
    new Proxy(scope, {
      has: (t, k) => (k in t) || !(String(k) in globalThis),
      get: (t, k) => {
        if (k === Symbol.unscopables) return undefined;
        if (k in t) return t[k];
        if (String(k) in globalThis) return globalThis[String(k)];
        throw new ReferenceError('doUpload needs `' + String(k) + '`');
      },
      set: (t, k, v) => { t[k] = v; return true; },
    })
  );
  return fn({ name: 'sermon.mp3', size: 1000, type: 'audio/mp3', lastModified: 1 }, { title: 'Sunday' })
    .then(() => msg);
}

test('a successful pin says "members notified"', async () => {
  const msg = await run({ pinResult: true });
  assert.match(msg, /members notified/,
    'CONTROL: a successful pin should say members were notified');
  assert.doesNotMatch(msg, /weren.t notified/,
    'a successful pin should NOT say members were not notified');
});

test('a failed pin says members were NOT notified', async () => {
  const msg = await run({ pinResult: false });
  assert.doesNotMatch(msg, /· members notified/,
    'A FAILED PIN STILL SAYS "MEMBERS NOTIFIED" — the steward believes everyone was told when ' +
    'nobody was, because the pin that drives the relay push and the Today card never landed');
  assert.match(msg, /weren.t notified/,
    'the message should tell the steward members were not notified');
});
