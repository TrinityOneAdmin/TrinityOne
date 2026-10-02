// EVERY `directory:` THE APP HANDS THE CAPACITOR FILESYSTEM MUST BE ONE THE PLUGIN ACCEPTS.
// Run: node --test scripts/filesystem-directories-are-the-plugins-own.test.mjs
//
// Audit 2026-09-19 (P7/P9, "Missed by both") and then MEASURED on the Oppo the same night: five console call
// sites passed `directory: 'Cache'`. `@capacitor/filesystem` compares the string exactly — `Directory.Cache`
// is `"CACHE"` (dist/esm/definitions.js), the Android plugin switches on `"CACHE"` (Filesystem.java) and
// rejects anything else with `INVALID_DIR` (FilesystemPlugin.java). So the church-DATA backup on a phone
// showed "✗ INVALID_DIR", the invite poster's Save PDF fell back to sharing a link, the statement PDF rejected,
// and the Install slip's print fell to window.print (a no-op in the WebView). backup.jsx and share-app.jsx
// were spelling it correctly all along, which is why "Save QR" and "Back up to a file" worked next to them.
//
// Two tests:
//   1. the literal, pinned to the plugin's OWN enum, read from node_modules at test time — a plugin upgrade
//      that renames a directory fails here, not on the phone. This one greps app/ source: it asserts a
//      literal against an enum, not behaviour (rule 3 is about behaviour).
//   2. the behaviour, at the point of use: the REAL DashBackup mounted the way the phone mounts it
//      (scripts/console-screens.mjs), a Filesystem that refuses exactly what the Android plugin refuses,
//      "Back up church data" pressed, and the receipt on screen read.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { Directory } from '../node_modules/@capacitor/filesystem/dist/esm/definitions.js';
import { loadConsole, fakeReact, fakeBrowser, fakeSteward, nodes } from './console-screens.mjs';

const ROOT = new URL('../', import.meta.url);
const ACCEPTED = new Set(Object.values(Directory));

test('the plugin still publishes the directory ids this test pins against', () => {
  // Re-anchor guard: if the enum vanished or changed shape, the grep test below would pass vacuously.
  assert.ok(ACCEPTED.has('CACHE') && ACCEPTED.has('DOCUMENTS'), 'Directory enum no longer has CACHE/DOCUMENTS: ' + [...ACCEPTED].join(','));
  assert.ok(!ACCEPTED.has('Cache'), 'the plugin now accepts mixed case — this test can be retired');
});

test('every directory: literal in app/ is one of the plugin’s own ids (exact case)', () => {
  const hits = [];
  for (const f of readdirSync(new URL('app/', ROOT))) {
    if (!f.endsWith('.jsx')) continue;
    const src = readFileSync(new URL('app/' + f, ROOT), 'utf8');
    for (const m of src.matchAll(/directory\s*:\s*([^,}\n]+)/g)) {
      hits.push({ where: 'app/' + f + ':' + src.slice(0, m.index).split('\n').length, token: m[1].trim() });
    }
  }
  assert.ok(hits.length >= 5, 'the grep found ' + hits.length + ' directory: sites — the app writes files through at least five; re-anchor the pattern');
  const bad = [];
  for (const h of hits) {
    const lit = h.token.match(/^['"]([^'"]*)['"]$/);
    if (!lit) { bad.push(h.where + ' passes a non-literal (' + h.token + ') — pin it or extend this test'); continue; }
    if (!ACCEPTED.has(lit[1])) bad.push(h.where + ' passes ' + h.token + ' — the plugin rejects it with INVALID_DIR; accepted: ' + [...ACCEPTED].join(', '));
  }
  assert.deepEqual(bad, [], 'THE DEFECT:\n  ' + bad.join('\n  '));
});

// ── the point of use: Settings → Backup & data → "Back up church data" ───────────────────────────────────────

const ZIP = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0xff, 0xfe, 0x80, 0x7f]);   // not valid UTF-8 on purpose

function console_({ binary }) {
  const { React, reset, flush, fresh, unmount } = fakeReact();
  const exported = binary
    ? { data: ZIP, binary: true, mime: 'application/zip', count: 7, filename: 'trinityone-backup.zip', encrypted: true, media: 2 }
    : { data: '{"records":[1,2,3]}', binary: false, mime: 'application/json', count: 3, filename: 'trinityone-backup.json', encrypted: false, media: 0 };
  // `actingChurch: ''` — THE OWNER CONSOLE. AUDIT-steward-doc-rules-round5-2026-09-23 finding 3 gated
  // "Back up church data" on `stewCapState('content').owner`, which reads `window.Steward.actingChurch`.
  // fakeSteward()'s Proxy returns a bare function (truthy) for any key not in its base object, so an
  // unset `actingChurch` reads as truthy — the console under test here reads as a DELEGATE, the button
  // never reaches exportChurchData at all, and the receipt is the owner-only refusal instead of a save.
  // This test is about the phone's Filesystem plugin, not delegation, so it is explicit about which
  // console it is.
  const Steward = fakeSteward({ actingChurch: '', exportChurchData: async () => exported, mediaSize: async () => ({ count: 0, bytes: 0 }) });
  const { window } = fakeBrowser({ Steward });
  const writes = [], shares = [];
  // The Android plugin, as far as this test needs it: an id outside the enum is INVALID_DIR, nothing is written.
  window.Capacitor = { isNativePlatform: () => true, Plugins: {
    Filesystem: { writeFile: async (o) => {
      if (!ACCEPTED.has(o.directory)) throw new Error('INVALID_DIR');
      writes.push(o); return { uri: 'file:///data/user/0/church.trinityone/' + o.directory.toLowerCase() + '/' + o.path };
    } },
    Share: { share: async (o) => { shares.push(o); return { activityType: 'com.android.chooser' }; } },
  } };
  const mods = loadConsole({ React, window, expr: '{ DashBackup }' });
  let tree;
  const draw = () => { reset(); tree = mods.DashBackup(); flush(); return tree; };
  const button = (label) => nodes(tree).find(n => n.type === 'button' && (n.kids || []).some(k => typeof k === 'string' && k.includes(label)));
  const receipt = () => nodes(tree).filter(n => (n.kids || []).some(k => k === '✓ ' || k === '✗ ')).map(n => (n.kids || []).filter(k => typeof k === 'string').join(''));
  const settle = async (done) => { for (let i = 0; i < 60 && !done(); i++) await new Promise(r => setTimeout(r, 5)); };
  return { window, exported, writes, shares, draw, button, receipt, settle, fresh, unmount, get tree() { return tree; } };
}

for (const binary of [false, true]) {
  test('on the phone, "Back up church data" (' + (binary ? 'zip' : 'json') + ') writes the file the plugin accepts, hands it to the share sheet, and the receipt is not INVALID_DIR', async () => {
    const c = console_({ binary });
    c.draw();
    const btn = c.button('Back up church data');
    assert.ok(btn, 're-anchor: no "Back up church data" button on the Backup & data card');
    btn.props.onClick();
    await c.settle(() => c.receipt().length >= 1 || (c.draw(), c.receipt().length >= 1));
    c.draw();
    const line = c.receipt();
    assert.equal(line.length, 1, 'no receipt line after pressing Back up church data');
    assert.doesNotMatch(line[0], /INVALID_DIR/, 'THE DEFECT: the phone refused the directory id the console passed: ' + JSON.stringify(line[0]));
assert.match(line[0], /records/, 'the receipt is not a success line: ' + JSON.stringify(line[0]));
    // saveFile writes to DOCUMENTS first (durable), then to CACHE for the share sheet
    assert.equal(c.writes.length, 2, 'the backup should be written twice: DOCUMENTS (durable) + CACHE (share), got ' + c.writes.length);
    assert.equal(c.writes[0].directory, 'DOCUMENTS', 'the durable backup must go to DOCUMENTS, not ' + c.writes[0].directory);
    assert.equal(c.writes[0].path, c.exported.filename);
    assert.equal(c.writes[1].directory, 'CACHE', 'the share copy must go to CACHE');
    if (binary) {
      assert.equal('encoding' in c.writes[0], false, 'a zip was written with a text encoding');
      assert.deepEqual(Uint8Array.from(Buffer.from(c.writes[0].data, 'base64')), ZIP, 'the zip bytes written are not the bytes exported');
    } else {
      assert.equal(c.writes[0].encoding, 'utf8', 'the JSON backup must be written as utf8 text');
      assert.equal(c.writes[0].data, c.exported.data);
    }
    assert.equal(c.shares.length, 1, 'the share sheet was not offered exactly once');
    assert.equal(c.shares[0].url, 'file:///data/user/0/church.trinityone/cache/' + c.exported.filename, 'the share sheet was not handed the CACHE copy');
    assert.equal(Number(c.window.localStorage.getItem('trinityone.lastBackupAt')) > 0, true, 'lastBackupAt was not recorded after a successful backup');
    c.unmount();
  });
}
