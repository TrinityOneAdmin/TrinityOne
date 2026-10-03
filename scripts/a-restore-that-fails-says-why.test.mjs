// A RESTORE THAT FAILS SAYS WHY. Sim round 2026-10-02, finding #54 ("Restore failed" with no reason).
// Run: node --test scripts/a-restore-that-fails-says-why.test.mjs
//
// Opening a backup sealed to a DIFFERENT church key makes the browser's AES-GCM decrypt reject with an
// OperationError whose message is the EMPTY STRING. The console's Restore button then fell back to its own
// generic "Restore failed" - the one place a steward most needs a reason ("is this the right church? the right
// file?") said nothing. Same for a file that is not JSON and an archive fflate cannot open.
//
// Users of the changed code (rule 2): _openBackup has two callers, restoreChurchData and the unused
// `decryptBackup` pass-through; restoreChurchData has ONE caller, the console's backup page (DashBackup's
// doRestore in app/stew-dashboard.jsx), which prints e.message, and scripts/restore-scope.test.mjs fails if a
// second caller appears. Messages that already carried a reason are unchanged.
//
// HOW IT ASSERTS (rule 3): the SHIPPED vendor/steward.js runs whole in a vm (scripts/fellowship-vm.mjs), signed in
// as church A with a real key, and restoreChurchData is called with real bytes: a backup sealed to church B (made
// the way _sealToChurch makes one), a file that is not a backup, and a corrupt zip. What is read is the message
// the console would print.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import * as nip44 from 'nostr-tools/nip44';
import { loadFellowship } from './fellowship-vm.mjs';

const b64 = (u8) => Buffer.from(u8).toString('base64');
async function sealedTo(churchPubHex, plaintext) {
  const esk = generateSecretKey();
  const convKey = nip44.getConversationKey(esk, churchPubHex);
  const key = await crypto.subtle.importKey('raw', convKey, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext)));
  return new TextEncoder().encode(JSON.stringify({ trinityone_backup: 'encrypted-v1', alg: 'nip44-ecdh-secp256k1+aes-256-gcm', fmt: 'jsonl', epk: getPublicKey(esk), iv: b64(iv), ct: b64(ct) }));
}

async function consoleAs(words) {
  const { S } = loadFellowship({ bundle: 'steward' });
  await S.restoreKey(words);
  return S;
}
const A = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const reasonOf = async (S, bytes) => { try { await S.restoreChurchData(bytes); } catch (e) { return String(e && e.message); } return null; };

test('a backup sealed to another church says so, rather than nothing', async () => {
  const S = await consoleAs(A);
  const other = getPublicKey(generateSecretKey());
  const msg = await reasonOf(S, await sealedTo(other, '{"kind":1}\n'));
  assert.ok(msg, 'the restore did not fail at all - the fixture is wrong');
  assert.notEqual(msg, '', 'THE DEFECT: the failure carries an empty message, so the screen can only say "Restore failed"');
  assert.match(msg, /different church|another church|not this church/i, 'the reason should say it was made for a different church. Got: ' + msg);
});

test('a file that is not a backup says so', async () => {
  const S = await consoleAs(A);
  const msg = await reasonOf(S, new TextEncoder().encode('{"trinityone_backup":"encrypted-v1","epk":"zz","iv":"","ct":""}'));
  assert.ok(msg && msg.length > 12, 'a malformed backup envelope failed without a usable reason: ' + JSON.stringify(msg));
});

test('a corrupt archive says so', async () => {
  const S = await consoleAs(A);
  const msg = await reasonOf(S, new Uint8Array([0x50, 0x4b, 3, 4, 9, 9, 9, 9, 9, 9, 9, 9]));
  assert.ok(msg, 'a corrupt zip did not fail at all');
  assert.match(msg, /damaged|corrupt/i, 'a corrupt archive gave a technical or empty reason: ' + JSON.stringify(msg));
});

test('a failure that already had a reason keeps it (no events in the file)', async () => {
  const S = await consoleAs(A);
  assert.match(await reasonOf(S, new TextEncoder().encode('   ')), /no church data/i);
});
