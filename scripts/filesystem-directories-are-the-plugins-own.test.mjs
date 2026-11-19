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

// A CALL TO A ZERO-ARGUMENT HELPER IS ACCEPTED ONLY WHEN ITS BODY PROVABLY RETURNS LITERALS (2026-11-19).
// app/audio-store.jsx picks the platform's directory once — `const DIR = () => { …; return ios ? 'LIBRARY' : 'DATA'; }`
// — and passes `directory: DIR()` at 14 sites. That is not a literal, but it is no less checkable: the helper is
// found in the SAME file (exactly one definition), and every value it can return is resolved to string literals —
// a literal, or a ternary whose branches resolve. Anything else is unprovable and fails like any other non-literal:
// a helper that returns a variable, has more than one return or a return that is not last, nests a function, or
// is not defined in the file. The literals it returns are then checked against the plugin's enum like any other.
function stringLit(e) { const m = e.match(/^(['"])([^'"\\]*)\1$/); return m ? m[2] : null; }
function topLevel(e, ch, from = 0) {   // index of `ch` at bracket depth 0 and outside quotes, or -1
  let depth = 0, q = '';
  for (let i = from; i < e.length; i++) {
    const c = e[i];
    if (q) { if (c === '\\') i++; else if (c === q) q = ''; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (!depth && c === ch) return i;
    if ('([{'.includes(c)) depth++; else if (')]}'.includes(c)) depth--;
  }
  return -1;
}
// The set of string literals expression `e` can evaluate to, or null if that cannot be shown.
function literalsOf(e) {
  e = e.trim();
  const lit = stringLit(e);
  if (lit !== null) return [lit];
  if (e[0] === '(' && topLevel(e, ')', 1) === e.length - 1) return literalsOf(e.slice(1, -1));   // ( … ) wrapping it all
  const q = topLevel(e, '?');
  if (q === -1) return null;
  const colon = topLevel(e, ':', q + 1);
  if (colon === -1) return null;
  const a = literalsOf(e.slice(q + 1, colon)), b = literalsOf(e.slice(colon + 1));
  return a && b ? [...a, ...b] : null;
}
// `name()` resolved through its definition in `src`: { values } or { why } when it cannot be proved.
function helperReturns(src, name) {
  const defs = [...src.matchAll(new RegExp('(?:const|let|var)\\s+' + name + '\\s*=\\s*\\(\\s*\\)\\s*=>\\s*|function\\s+' + name + '\\s*\\(\\s*\\)\\s*', 'g'))];
  if (defs.length !== 1) return { why: defs.length + ' definitions of ' + name + ' in this file (need exactly 1)' };
  let at = defs[0].index + defs[0][0].length;
  if (src[at] !== '{') {   // expression-bodied arrow: up to the `;` at depth 0
    const end = topLevel(src.slice(at), ';');
    const vals = literalsOf(src.slice(at, at + end));
    return vals ? { values: vals } : { why: name + '() returns something other than string literals' };
  }
  const close = topLevel(src.slice(at + 1), '}');
  const body = src.slice(at + 1, at + 1 + close);
  const code = body.replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, "''");   // strings blanked: 'function' in a typeof check is not a function
  if (/\bfunction\b|=>/.test(code)) return { why: name + '() nests a function; not provable here' };
  const rets = [...body.matchAll(/\breturn\b/g)];
  if (rets.length !== 1) return { why: name + '() has ' + rets.length + ' returns (need exactly 1, last)' };
  const from = rets[0].index + 'return'.length, semi = topLevel(body.slice(from), ';');
  const expr = body.slice(from, semi === -1 ? body.length : from + semi);
  if (body.slice(semi === -1 ? body.length : from + semi + 1).trim()) return { why: name + '()’s return is not its last statement' };
  const vals = literalsOf(expr);
  return vals ? { values: vals } : { why: name + '() returns something other than string literals: ' + expr.trim() };
}

test('every directory: literal in app/ is one of the plugin’s own ids (exact case)', () => {
  const hits = [];
  for (const f of readdirSync(new URL('app/', ROOT))) {
    if (!f.endsWith('.jsx')) continue;
    const src = readFileSync(new URL('app/' + f, ROOT), 'utf8');
    for (const m of src.matchAll(/directory\s*:\s*([^,}\n]+)/g)) {
      hits.push({ where: 'app/' + f + ':' + src.slice(0, m.index).split('\n').length, token: m[1].trim(), src });
    }
  }
  assert.ok(hits.length >= 5, 'the grep found ' + hits.length + ' directory: sites — the app writes files through at least five; re-anchor the pattern');
  const bad = [];
  for (const h of hits) {
    const call = h.token.match(/^([A-Za-z_$][\w$]*)\(\)$/);
    if (call) {
      const r = helperReturns(h.src, call[1]);
      if (r.why) { bad.push(h.where + ' passes ' + h.token + ', which cannot be proved to return only literals: ' + r.why); continue; }
      for (const v of r.values) if (!ACCEPTED.has(v)) bad.push(h.where + ' passes ' + h.token + ', which can return \'' + v + '\' — the plugin rejects it with INVALID_DIR; accepted: ' + [...ACCEPTED].join(', '));
      continue;
    }
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
