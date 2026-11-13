// A MOVE REQUEST IS USED ONCE — no rename, copy, failure, refusal or rollback leaves .move-request anywhere.
// Run: node --test scripts/a-move-request-is-used-once.test.mjs
//
// Audit B M-1 (AUDIT-B-relay-storage-steps3-4-1de8ca07). The gateway writes <data>/.move-request and stops; nothing
// ever deleted it. A same-drive RENAME carried it into the new live folder, and a failed copy left it in the old one,
// so the card said "already under way" for ever and a launcher acting on the file would start another move at every
// close. The mover now consumes it as its first act. Drives the REAL scripts/relay-move.mjs on real folders; the one
// fake is the EXDEV a second filesystem would raise (injected rename), as in relay-move-verifies-before-it-switches.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readdirSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { moveRelayData, rollbackMove, beginCheck, jsonPointer, jsonFieldStore, LEAF, STAMP } from './relay-move.mjs';

function rig() {
  const base = mkdtempSync(join(tmpdir(), 'trin-move-once-'));
  const from = join(base, 'app-data', 'data'); mkdirSync(from, { recursive: true });
  const drive = join(base, 'drive'); mkdirSync(drive);
  const to = join(drive, LEAF);
  const sk = generateSecretKey(), pub = getPublicKey(sk);
  writeFileSync(join(from, 'relay-key.json'), JSON.stringify({ sk: Buffer.from(sk).toString('hex'), pub }));
  writeFileSync(join(from, STAMP), JSON.stringify({ relayPub: pub }));
  const db = new DatabaseSync(join(from, 'relay.sqlite'));
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE events(id TEXT); CREATE TABLE deletions(id TEXT); CREATE TABLE meta(k TEXT, v TEXT);');
  for (let i = 0; i < 20; i++) db.prepare('INSERT INTO events VALUES (?)').run('e' + i);
  db.close();
  // what the gateway leaves behind, plus a half-written one from a killed write
  writeFileSync(join(from, '.move-request'), JSON.stringify({ drive, target: to, relayPub: pub, requestedAt: new Date().toISOString() }));
  writeFileSync(join(from, '.move-request.tmp-123'), '{');
  const cfg = join(base, 'config', 'storage.json');
  const pointer = jsonPointer(cfg), journal = jsonFieldStore(cfg, 'move');
  pointer.write(from, pub);
  return { base, from, to, pub, pointer, journal, opts: extra => ({ from, to, pointer, journal, relayRunning: async () => false, mounts: null, ...extra }),
    done: () => rmSync(base, { recursive: true, force: true }) };
}
const exdev = () => { let first = true; return (a, b) => { if (first) { first = false; throw Object.assign(new Error('EXDEV'), { code: 'EXDEV' }); } return renameSync(a, b); }; };
// every place a request could survive
function requestsLeft(t) {
  const out = [];
  for (const d of [t.from, t.to, ...readdirSync(join(t.to, '..')).map(n => join(t.to, '..', n)), ...readdirSync(join(t.from, '..')).map(n => join(t.from, '..', n))]) {
    let names = []; try { names = readdirSync(d); } catch { continue; }
    for (const n of names) if (n.startsWith('.move-request')) out.push(join(d, n));
  }
  return [...new Set(out)];
}

test('same-drive RENAME: the request is not carried into the new folder, and none is left at the old path', async () => {
  const t = rig();
  try {
    const r = await moveRelayData(t.opts({}));
    assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.mode, 'rename');
    assert.deepEqual(requestsLeft(t), [], 'a request survived a rename');
  } finally { t.done(); }
});

test('cross-drive COPY: no request in the new folder or the old copy', async () => {
  const t = rig();
  try {
    const r = await moveRelayData(t.opts({ rename: exdev() }));
    assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.mode, 'copy');
    assert.deepEqual(requestsLeft(t), [], 'a request survived a copy');
  } finally { t.done(); }
});

test('a copy that FAILS verification leaves no request in the old folder (the relay restarts there)', async () => {
  const t = rig();
  try {
    const r = await moveRelayData(t.opts({ rename: exdev(), _afterCopy: async (to) => { writeFileSync(join(to, 'relay-key.json'), '{"tampered":1}'); } }));
    assert.equal(r.ok, false, 'the tampered copy was accepted');
    assert.deepEqual(requestsLeft(t), [], 'a failed copy left the request behind — it would be acted on again at the next close');
  } finally { t.done(); }
});

test('a REFUSED move still consumes the request: one request, one attempt', async () => {
  const t = rig();
  try {
    const r = await moveRelayData(t.opts({ to: join(t.base, 'drive', 'not-the-fixed-leaf') }));
    assert.equal(r.ok, false); assert.equal(r.code, 'target-not-fixed-leaf');
    assert.deepEqual(requestsLeft(t), [], 'a refused move left the request behind');
  } finally { t.done(); }
});

test('ROLLBACK of a rename and of a copy never brings a request back', async () => {
  for (const mode of ['rename', 'copy']) {
    const t = rig();
    try {
      const r = await moveRelayData(t.opts(mode === 'copy' ? { rename: exdev() } : {}));
      assert.equal(r.ok, true, mode + ': ' + JSON.stringify(r));
      await beginCheck({ journal: t.journal });
      const rb = rollbackMove({ journal: t.journal, pointer: t.pointer });
      assert.equal(rb.ok, true, mode + ' rollback: ' + JSON.stringify(rb));
      assert.equal(t.pointer.read(), t.from);
      assert.deepEqual(requestsLeft(t), [], mode + ': a rollback left or restored a request');
    } finally { t.done(); }
  }
});
