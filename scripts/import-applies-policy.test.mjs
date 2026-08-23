// A RESTORE MUST NOT LOSE ANYTHING — and what /import does NOT check, and why.
// Run: node --test scripts/import-applies-policy.test.mjs
//
// /import is the one path into this relay that never calls accept(). On 2026-08-20 a two-pass policy check
// was added to close that, and reverted the same afternoon when an adversarial audit measured what it did to
// an ordinary restore: it deleted the church's ENTIRE finance journal, and every message ever written by
// anyone who had since left.
//
// The mistake was a category error, not a bug. accept() is a WRITE-TIME ADMISSION GATE — "may this author add
// this, right now, given who is a member and what sequence number we are on". An archive cannot answer that.
// Its journal entries get compared against a sequence counter the archive itself has just set, so every one is
// "not the next entry". Its history gets compared against today's membership, so everyone who has left fails.
//
// This file now pins the RESTORE side: whatever hardening is attempted here later must not lose data. The two
// journal/departed-member tests below are the ones that caught it, and they are the reason this file exists.
//
// AND THE FINDING THE PASS WAS BUILT FOR WAS OVERSTATED. Two audits and I all reasoned that because /import
// skips accept(), and accept() holds the minor↔adult DM gate, an archive could walk a grooming attempt in.
// Measured instead of reasoned, the event is stored and served to NOBODY: canRead() applies the same
// safeguardAllows() predicate on the way out, in both directions. Nobody had checked the read gate.
//
// That is the better place for the rule anyway. A write gate is bypassed by any path that writes to the
// store — import, sync, a future restore — while a read gate is bypassed by none of them, because every
// delivery goes through it, and it consults TODAY's clearance rather than whatever was true when the message
// was sent. The tests below pin that invariant, and one of them is the pairing that stops "served to nobody"
// being vacuously true of a relay that serves nothing.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { WebSocket } from 'ws';
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
// Does the RELAY hand this event over, to this person, over the wire it really serves from? Distinct from
// `stored` on purpose: the two answers differ, and the difference is the whole point of this file.
const served = (id, who) => new Promise((resolve) => {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/relay`);
  let got = false;
  ws.on('open', () => ws.send(JSON.stringify(['REQ', 'q', { ids: [id] }])));
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    if (m[0] === 'EVENT' && m[2] && m[2].id === id) got = true;
    if (m[0] === 'AUTH') {
      ws.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', `ws://127.0.0.1:${PORT}/relay`], ['challenge', m[1]]], content: '' }, who.sk)]));
      ws.send(JSON.stringify(['REQ', 'q2', { ids: [id] }]));
    }
  });
  setTimeout(() => { try { ws.close(); } catch {} resolve(got); }, 900);
});

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

test('a restored archive keeps the church\'s ENTIRE finance journal', async () => {
  // The case the first version of this file did not cover, and the one that matters most. accept()'s finance
  // branch demands `seq === FINANCE_SEQ + 1`, and hydrateMaps() has already set FINANCE_SEQ to the archive's
  // HIGH-WATER mark before the policy pass runs. So every entry in the archive is "not the next one" and gets
  // deleted — a church restoring a backup loses its accounts entirely, with HTTP 200 and a cheerful
  // `imported: N` in the response.
  const entries = [1, 2, 3, 4].map(n => finalizeEvent({
    kind: 30078, created_at: now(), tags: [['d', 'finance/journal:' + n], ['t', NET], ['church', cp]],
    content: 'sealed:entry' + n,
  }, church.sk));
  const r = await doImport(entries);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const kept = entries.filter(e => stored(e.id)).length;
  assert.equal(kept, 4,
    `only ${kept} of 4 journal entries survived the restore. accept() is a WRITE-TIME admission gate — ` +
    '"may this author add this entry next?" — and replaying it over an archive asks a question the archive ' +
    'cannot satisfy: every entry is compared against a sequence counter the archive itself just set. A ' +
    'church restoring its backup opens its accounts to find them empty.');
});

test('and it keeps a departed member\'s history', async () => {
  // Same category. accept() evaluates TODAY's membership against a HISTORICAL archive, so everyone who has
  // ever left the church loses everything they ever wrote.
  const gone = K();
  const msg = finalizeEvent({ kind: 1, created_at: now(), tags: [['t', NET], ['t', cp.slice(0, 16) + '-g1']], content: 'from someone who has since left' }, gone.sk);
  const r = await doImport([msg]);          // note: NO member doc for `gone` — they left
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(stored(msg.id), true,
    'the chat history of a member who has since left was deleted on restore. A congregation restoring a ' +
    'backup loses every message from everyone who has ever moved away, been blocked, or died.');
});

test('an imported DM between an uncleared adult and a child is SERVED TO NOBODY', async () => {
  // THE FINDING THAT STARTED ALL THIS WAS OVERSTATED, and it took a measurement to notice. Two adversarial
  // audits and I all reasoned the same way: /import never calls accept(), accept() holds the minor↔adult DM
  // gate, therefore an archive can walk a grooming attempt straight in. The first half is true. The
  // conclusion is not — because canRead() applies the SAME safeguardAllows() predicate on the way OUT.
  //
  // Measured: the event is in the store and is served to nobody at all — not the sender, not the child, not
  // the church. Which is the property that actually protects a child. A write gate can be bypassed by any
  // path that writes to the store; a read gate cannot be bypassed by anything, because every delivery goes
  // through it, and it consults TODAY's clearance rather than whatever was true when the message was sent.
  //
  // This is the invariant worth pinning. Storage of an event nobody can fetch is a disk-space question.
  const bad = dm(adult, child);
  const r = await doImport([bad]);
  assert.equal(r.status, 200, 'the import failed for an unrelated reason: ' + JSON.stringify(r.body));
  assert.equal(stored(bad.id), true,
    're-anchor: the import no longer stores it, so the read-gate assertions below prove nothing');
  for (const [who, label] of [[adult, 'the uncleared adult who sent it'], [child, 'the child'], [church, 'the church itself']]) {
    assert.equal(await served(bad.id, who), false,
      `the relay served a DM between an uncleared adult and a child to ${label}. It arrived in a backup ` +
      'file rather than through the front door, and the read gate is the only thing standing between that ' +
      'event and the child.');
  }
});

test('...while an ordinary adult-to-adult DM imported the same way IS served', () => {
  // The pairing that makes the `false` above mean something. Without it, "served to nobody" is equally
  // consistent with a read gate that serves nothing at all.
  return (async () => {
    const ok = dm(adult, stranger);
    await doImport([memberDoc(stranger), ok]);
    assert.equal(await served(ok.id, adult), true,
      're-anchor: an ordinary DM is not served either, so the safeguarding assertions above are vacuous');
  })();
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
