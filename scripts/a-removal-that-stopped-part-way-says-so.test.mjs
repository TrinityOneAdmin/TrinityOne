// A REMOVE THAT STOPPED PART-WAY DOES NOT SAY "LEFT ALONE". Run: node --test scripts/a-removal-that-stopped-part-way-says-so.test.mjs
// Audit N8. When the helper's delete stops part-way it records move.refusal.code = remove-delete-failed; the card must say
// the copy may be partly gone, not that it was left alone. Lifts the REAL stOldCopy / stLeftovers / stRemoveNote out of
// relay-app/control.js (rule 3: run the function, do not match its text) and runs them with the card's own dependencies
// stubbed; so the point of use (stOldCopy and stLeftovers calling stRemoveNote) is exercised too, not just the wording.
// Also runs the REAL helper delete with a failing `rm` to prove the code the card is keyed on is what the helper writes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = readFileSync(join(ROOT, 'relay-app/control.js'), 'utf8');
function lift(name) {
  const a = SRC.indexOf('  function ' + name + '('); assert.ok(a >= 0, name + ' is gone from control.js');
  const b = SRC.indexOf('\n  }\n', a) + 5; return SRC.slice(a, b);
}
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function card() {
  const body = ['stRemoveNote', 'stOldCopy', 'stLeftovers'].map(lift).join('\n');
  return new Function('esc', 'stPlace', 'stGB', 'stState', 'ST_TRASH_SVG', body + '\nreturn { stOldCopy, stLeftovers };')(esc, () => ({ label: 'USB' }), () => '1 GB', { removeArmed: null }, '');
}
const base = refusal => ({ canChange: true, requests: {}, leftovers: [], oldCopy: { path: '/mnt/usb/old', exists: true, since: null }, move: { state: 'awaiting-confirm', refusal } });

test('a delete that stopped part-way says the copy may be partly gone and points at the log; it never says "left alone"', () => {
  const c = card();
  const html = c.stOldCopy(base({ code: 'remove-delete-failed', at: 'x' }));
  assert.match(html, /stopped part-way/); assert.match(html, /may already be gone/); assert.match(html, /move\.log/);
  assert.doesNotMatch(html, /left alone/);
});
test('a remove refused before anything was deleted does say it was left alone, with the code', () => {
  const html = card().stOldCopy(base({ code: 'remove-no-moved-note' }));
  assert.match(html, /left alone \(no-moved-note\)/); assert.doesNotMatch(html, /part-way/);
});
test('no refusal, or a move refusal, adds nothing; with no old copy the note is shown by the leftovers list', () => {
  const c = card();
  assert.doesNotMatch(c.stOldCopy(base(null)), /part-way|left alone/);
  assert.doesNotMatch(c.stOldCopy(base({ code: 'not-in-fstab' })), /part-way|left alone/);
  const r = { ...base({ code: 'remove-delete-failed' }), oldCopy: null, leftovers: [{ path: '/mnt/usb/x', exists: true, kind: 'set-aside', since: null }] };
  assert.match(c.stLeftovers(r), /stopped part-way/);
  assert.doesNotMatch(c.stLeftovers(base({ code: 'remove-delete-failed' })), /part-way/, 'shown twice: once by the old copy and once by the leftovers');
});
test('the helper writes remove-delete-failed when its delete stops part-way (what the card is keyed on)', () => {
  const w = mkdtempSync(join(tmpdir(), 'trin-n8-'));
  try {
    const old = join(w, 'old'), live = join(w, 'live'), bin = join(w, 'bin'); for (const d of [old, live, bin]) mkdirSync(d);
    writeFileSync(join(old, 'MOVED-TO'), 'm'); writeFileSync(join(old, 'relay-key.json'), JSON.stringify({ sk: 'a', pub: 'P' })); writeFileSync(join(old, 'a.dat'), 'x');
    writeFileSync(join(bin, 'rm'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    const state = join(w, 's.json');
    writeFileSync(state, JSON.stringify({ dataDir: live, relayPub: 'P', move: { state: 'awaiting-confirm', mode: 'copy', from: old, to: live, relayPub: 'P', oldCopy: { path: old, since: 'x' } } }));
    writeFileSync(join(w, 'req.json'), JSON.stringify({ path: old }));
    const r = spawnSync(process.execPath, [join(ROOT, 'scripts/relay-move-server.mjs'), 'remove-old', '--state', state, '--request', join(w, 'req.json'), '--live', live], { encoding: 'utf8', env: { ...process.env, PATH: bin + ':' + process.env.PATH } });
    assert.equal(r.status, 2);
    assert.equal(JSON.parse(readFileSync(state, 'utf8')).move.refusal.code, 'remove-delete-failed');
  } finally { rmSync(w, { recursive: true, force: true }); }
});

// Full audit L-8 / question (d): the three refusals the Suite's code update adds (GET /storage `refuse`, and a move the
// launcher refused, storage.json launcher.lastRefusal) each get their own sentence on the card — run through the REAL
// stReason and stLauncherNote, never the "can't be used (code)" fallback that would show the raw code.
test('a move that must wait for the Suite\'s code update says why, in words, wherever the card shows it', () => {
  const body = ['stReason', 'stLauncherNote'].map(lift).join('\n');
  const c = new Function('esc', 'stGB', 'ST_BAD_SVG', body + '\nreturn { stReason, stLauncherNote };')(esc, () => '1 GB', '');
  const fallback = c.stReason('no-such-code');
  assert.match(fallback, /no-such-code/, 'fixture: the fallback names the raw code');
  const want = {
    'suite-update-applying': /installing an update/i,
    'suite-data-held-aside': /needs attention after an update.*restart this computer/i,
    'suite-update-due': /about to be installed.*few minutes/i,
  };
  for (const [code, re] of Object.entries(want)) {
    const s = c.stReason(code);
    assert.doesNotMatch(s, new RegExp(code), code + ' falls back to the raw code: ' + s);
    assert.match(s, re, code + ': ' + s);
    // the same code recorded by the launcher's own refusal (move_blocked) reaches the card through stLauncherNote
    const html = c.stLauncherNote({ launcher: { lastRefusal: { kind: 'move', code } } });
    assert.ok(html.includes('The move was refused') && html.includes(esc(s)), code + ' on the launcher note: ' + html);
  }
  assert.doesNotMatch(c.stReason('suite-update-due'), /hour/i, 'the update block lasts minutes, not hours (full audit L-8)');
});
