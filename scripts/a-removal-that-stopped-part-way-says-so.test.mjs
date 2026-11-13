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
