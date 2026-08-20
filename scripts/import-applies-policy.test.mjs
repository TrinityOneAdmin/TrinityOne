// AN ARCHIVE MAY NOT CARRY IN WHAT THE FRONT DOOR REFUSES.
// Run: node --test scripts/import-applies-policy.test.mjs
//
// /import was the one path into this relay that never called accept(). Signatures were verified, and note()
// re-checks authorship before it trusts a roster or a safeguarding list — so the obvious attack (forge the
// church's own minors: list) was never available. What WAS available is everything accept() enforces beyond
// authorship, and the sharpest of those is the minor↔adult DM gate: an archive could carry kind-4 messages
// from an uncleared adult to a child, and this relay would serve them from then on.
//
// /import is owner-only (_exportAuth), so this needs the church key holder to restore a hostile file — which
// is exactly the shape of a migration someone offers to "help" with.
//
// THE OTHER HALF OF THIS FILE MATTERS MORE. Refusing too much here is far worse than refusing too little: a
// restore that silently drops events is a church losing its history at the moment it is trying to recover it.
// accept() reads maps built FROM the events being imported, so a naive inline check refuses most of a real
// archive on arrival order alone. The tests below hold both ends: nothing legitimate is dropped, and the
// safeguarding gate still applies.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { DatabaseSync } from 'node:sqlite';
import { requireFreePort } from './test-ports.mjs';

const PORT = 8994;
const NET = 'trinityone';
const now = () => Math.floor(Date.now() / 1000);
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };

const church = K(), adult = K(), child = K(), stranger = K();
const cp = church.pub;
let relay, dataDir;

async function waitReady(ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/status`); if (r.ok) return; } catch {}
    await new Promise(r => setTimeout(r, 150));
  }
  throw new Error('relay never came up on :' + PORT);
}
// NIP-98 proof bound to /import, signed by the church key (the only key /import accepts)
const auth = (path) => 'Nostr ' + Buffer.from(JSON.stringify(finalizeEvent({
  kind: 27235, created_at: now(), content: '',
  tags: [['u', `http://127.0.0.1:${PORT}${path}`], ['method', 'POST'], ['church', cp]],
}, church.sk))).toString('base64');

const doImport = async (events) => {
  const r = await fetch(`http://127.0.0.1:${PORT}/import`, {
    method: 'POST', headers: { Authorization: auth('/import'), 'Content-Type': 'application/x-ndjson' },
    body: events.map(e => JSON.stringify(e)).join('\n'),
  });
  const body = await r.json();
  await new Promise(res => setTimeout(res, 700));   // the policy pass runs on setImmediate after the response
  return { status: r.status, body };
};
// ASK THE STORE, NOT THE WIRE. The first two versions of this probe asked the relay over a socket, and both
// were unable to tell "the relay dropped it" from "the relay will not serve it to you" — canRead() gates
// kind-4 by participation, and a minor's DMs are gated harder still. The safeguarding test below passed
// against a relay that had kept the message, and passed again when the deletion was sabotaged out. It proved
// nothing twice.
//
// The policy pass DELETES from the event store, so the store is the thing to ask. This is the same file the
// relay serves from, opened read-only.
const stored = (id) => {
  const db = new DatabaseSync(join(dataDir, 'relay.sqlite'), { readOnly: true });
  try { return !!db.prepare('SELECT 1 FROM events WHERE id = ?').get(id); }
  finally { try { db.close(); } catch {} }
};

const memberDoc = (who) => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', 'trinityone/member:' + cp], ['t', NET]], content: '{}' }, who.sk);
const minorsDoc = () => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', 'trinityone/minors:' + cp], ['t', NET]], content: JSON.stringify({ pubkeys: [child.pub] }) }, church.sk);
const groupDoc  = () => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', 'trinityone/group:' + cp.slice(0, 16) + '-g1'], ['t', NET], ['church', cp]], content: JSON.stringify({ name: 'Sunday', kind: 'group' }) }, church.sk);
const chatMsg   = (who) => finalizeEvent({ kind: 1, created_at: now(), tags: [['t', NET], ['t', cp.slice(0, 16) + '-g1']], content: 'hello church' }, who.sk);
const dm        = (from, to) => finalizeEvent({ kind: 4, created_at: now(), tags: [['p', to.pub]], content: 'sealed' }, from.sk);

before(async () => {
  await requireFreePort(PORT, 'import-applies-policy.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-import-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(cp), RELAY_MAX_EVENTS: '5000' }, stdio: 'ignore',
  });
  await waitReady();
});
after(() => { try { relay.kill(); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

test('a legitimate archive restores COMPLETELY, whatever order it is in', async () => {
  // Deliberately the worst order: the chat message and the member document arrive BEFORE the group and the
  // member doc they depend on. This is what killed the naive inline-accept() version — every one of these is
  // refused on arrival and a church loses its history restoring it.
  const msg = chatMsg(adult), am = memberDoc(adult), grp = groupDoc(), cm = memberDoc(child);
  const r = await doImport([msg, am, grp, cm, minorsDoc()]);
  assert.equal(r.status, 200, 'the import was rejected outright: ' + JSON.stringify(r.body));
  assert.equal(r.body.imported, 5, 're-anchor: not everything was stored in the first place');

  for (const [what, e] of [['the chat message', msg], ['the member document', am], ['the group', grp], ['the child\'s member document', cm]]) {
    assert.equal(stored(e.id), true,
      `${what} was dropped by the import policy pass. A restore that silently discards events is a church ` +
      'losing its history at the moment it is trying to recover it — far worse than the leak this pass ' +
      'exists to close. accept() depends on maps built FROM the archive, so the check must run AFTER the ' +
      'whole file is stored and hydrated, never per-event on arrival.');
  }
});

test('an archive may NOT carry a DM from an uncleared adult to a child', async () => {
  // The `false` below only means something because the adult-to-adult test returns `true` through the very
  // same probe: that pairing is what proves this reads "the relay dropped it" rather than "the relay would
  // not show it to me".
  // The child is now marked (minors: imported above) and the adult is on no cleared list. accept() refuses
  // this at the front door; before the policy pass, an archive walked it straight in and the relay served it.
  const bad = dm(adult, child);
  const r = await doImport([bad]);
  assert.equal(r.status, 200, 'the import failed for an unrelated reason: ' + JSON.stringify(r.body));
  assert.equal(stored(bad.id), false,
    'a kind-4 from an uncleared adult to a child survived the import. The relay refuses this message when it ' +
    'is sent, and now serves it because it arrived in a backup file — the safeguarding gate is bypassable by ' +
    'anyone who can get the church key holder to restore an archive.');
});

test('and an ordinary DM between two adults is untouched', async () => {
  // The other end of the same rule. Over-refusing here would silently delete a congregation's private
  // messages on restore.
  const ok = dm(adult, stranger);
  const r = await doImport([memberDoc(stranger), ok]);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(stored(ok.id), true,
    'an ordinary adult-to-adult DM was dropped on import — the policy pass is deleting private messages a ' +
    'church is trying to restore');
});

test('the church\'s own documents always survive a restore', async () => {
  // The owner's own corpus is the part a restore exists for. If any rule ever refuses these, the pass has to
  // be reconsidered rather than the archive.
  const own = groupDoc(), lists = minorsDoc();
  const r = await doImport([own, lists]);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(stored(own.id), true, 'the church\'s own group document was dropped on restore');
  assert.equal(stored(lists.id), true, 'the church\'s own safeguarding list was dropped on restore');
});
