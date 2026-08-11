// The care-key RING: rotating the key must not destroy what was sealed before it.
// Run: node --test scripts/care-key-ring.test.mjs
//
// WHY. Until now the church care key was only ever added to, never rotated — so a member who was blocked kept
// a working copy of the key to the congregation's care records for ever ("we removed him" did not mean "he can
// no longer read them"). But rotating naively is worse: a need sealed with the old key becomes unreadable to
// everyone, which is precisely the permanent loss that destroyed a real care need on 2026-07-24.
//
// So the envelope now carries the current key FOLLOWED BY the superseded ones, wrapped together per member:
// seal with the newest, open with whichever still works. This drives the SHIPPED bundle (vendor/steward.js)
// rather than a copy, so it fails if the real behaviour changes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { v2 as nip44 } from 'nostr-tools/nip44';

const BUNDLE = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const hex = (u8) => Array.from(u8).map(b => b.toString(16).padStart(2, '0')).join('');
const unhex = (h) => new Uint8Array(h.match(/.{1,2}/g).map(b => parseInt(b, 16)));

function body(name) {
  const at = BUNDLE.indexOf(name);
  assert.notEqual(at, -1, `${name} missing from the shipped bundle`);
  const open = BUNDLE.indexOf(') {', at) + 2;
  let depth = 0;
  for (let i = open; i < BUNDLE.length; i++) {
    const c = BUNDLE[i];
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return BUNDLE.slice(at, i + 1);
  }
  assert.fail(`could not find the end of ${name}`);
}

test('a need sealed with an OLD key still opens after rotation (the ring is real)', () => {
  // Model the shipped shape exactly: seal with ring[0], open by trying each key in turn.
  const oldKey = hex(webcrypto.getRandomValues(new Uint8Array(32)));
  const newKey = hex(webcrypto.getRandomValues(new Uint8Array(32)));
  const sealedBefore = nip44.encrypt(JSON.stringify({ displayLabel: 'The Okonkwo family' }), unhex(oldKey));
  const ring = [newKey, oldKey];   // after rotation: newest first
  const open = (ct) => { for (const k of ring) { try { return JSON.parse(nip44.decrypt(ct, unhex(k))); } catch (e) {} } return null; };
  assert.deepEqual(open(sealedBefore), { displayLabel: 'The Okonkwo family' }, 'pre-rotation records must survive rotation');
  const sealedAfter = nip44.encrypt(JSON.stringify({ displayLabel: 'New need' }), unhex(ring[0]));
  assert.deepEqual(open(sealedAfter), { displayLabel: 'New need' }, 'and new records seal with the current key');
  // the whole point: someone holding ONLY the old key cannot read what was sealed after the rotation
  let leaked = null; try { leaked = nip44.decrypt(sealedAfter, unhex(oldKey)); } catch (e) {}
  assert.equal(leaked, null, 'a removed member holding the old key must not read post-rotation records');
});

test('careOpen in the shipped bundle tries every key in the ring', () => {
  assert.match(body('careOpen('), /_careKeyRing/,
    'careOpen must walk the ring — with a single key, every need sealed before a rotation becomes permanently unreadable');
});

test('the envelope wraps the whole ring, not just the current key', () => {
  const b = body('ensureCareKeyForMembers(');
  assert.match(b, /_careKeyRing/, 'the published envelope must carry the ring so members can open older needs');
});

test('rotation exists, is gated like minting, and keeps the old keys', () => {
  const b = body('rotateCareKey(');
  assert.match(b, /_isRelayAuthed\(\)/, 'rotation must not run from an untrusted view — same rule as minting');
  // Assert the CONSTRUCTION carries the old ring forward — matching the name alone passes even if the new
  // ring is built as [fresh] and the old keys are dropped (verified: that sabotage slipped through once).
  // `full` since 2026-08-11: the candidate ring is now sized down to fit a large church's envelope, so the
  // full history and the ring actually published are two different things. The invariant is unchanged —
  // whatever is published must START from the fresh key and carry the previous ones behind it.
  assert.match(b, /full\s*=\s*\[\s*fresh\s*,\s*\.\.\./, 'the new ring must be [fresh, ...previous] — otherwise rotation destroys the church’s history');
  assert.match(b, /ring = cand/, 'the published ring must come from that candidate list, not be minted separately');
  assert.match(b, /_careKeyRev/, 'the envelope revision must advance so a lagging relay cannot resurrect the old one');
});

test('the MEDIA key has the same ring + rotation (a removed member must not keep sermon access)', () => {
  const rot = body('rotateMediaKey(');
  assert.match(rot, /_isRelayAuthed\(\)/, 'media rotation must not run from an untrusted view');
  assert.match(rot, /ring\s*=\s*\[\s*fresh\s*,\s*\.\.\./, 'the new ring must be [fresh, ...previous], or every existing sermon becomes unplayable');
  // both publishers must ship the ring, not a lone key, or members lose older sermons
  assert.match(body('mediaEncryptor('), /_mediaKeyRing/, 'upload path must publish the ring');
  assert.match(body('ensureMediaKeyForMembers('), /_mediaKeyRing/, 'distribution path must publish the ring');
});

test('legacy envelopes (a bare hex key, no ring) are still readable', () => {
  // A church upgrading mid-flight has an envelope holding a plain hex string, not a JSON array.
  const ingest = BUNDLE.slice(BUNDLE.indexOf('function _ingestCareKeyEnv'), BUNDLE.indexOf('function _ingestCareKeyEnv') + 1200);
  assert.match(ingest, /Array\.isArray/, 'the ingest must detect the array form');
  assert.match(ingest, /\[plain\]/, 'and fall back to treating a bare string as a one-key ring');
});
