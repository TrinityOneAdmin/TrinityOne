// WHEN AND WHERE A CHURCH GATHERS MUST NOT BE LEGIBLE TO ITS RELAY.
// Run: node --test scripts/church-calendar-sealed.test.mjs
//
// THE DEFECT (protocol audit + a direct read of relay/relay.sqlite, 2026-08-15). Church calendar documents
// were stored in the clear:
//
//   event    {"date":"2026-07-24","time":"10:30","title":"Sunday Service","where":"…"}
//   service  {"date":"2026-07-26","time":"10:30","name":"Sunday Service"}
//   rota     {"service":"svc-2026-08-02","assign":{"Welcome":["abd…"]}}
//
// Members' NAMES were sealed; the gatherings they attend were not. For a congregation where meeting is the
// risk, the address and the timetable are the operational intelligence that matters, and `rota` adds an
// attendance record on top. Every previous audit missed it — including one aimed at safeguarding — because
// the question asked was whether a mechanism was sound, not what is readable in the database.
//
// These five are sealable at no cost to relay policy: the relay routes on the `d` tag and the author and
// never opens them. (minors/approved/guardians/admitted/stewards/group/sermon ARE parsed by the relay to
// enforce rules server-side; sealing those would move enforcement to clients and is deliberately out of
// scope — see reference/PLAN-2026-08-15-CLEARTEXT.md.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { v2 as nip44v2 } from 'nostr-tools/nip44';
import { fnBody, stripComments } from './test-slice.mjs';

const STEW = readFileSync(new URL('../src/steward.src.js', import.meta.url), 'utf8');
const FELLOW = readFileSync(new URL('../src/fellowship.src.js', import.meta.url), 'utf8');
const VENDOR_S = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const VENDOR_F = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');

const hex = (b) => Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');
const unhex = (h) => Uint8Array.from(h.match(/.{2}/g).map(x => parseInt(x, 16)));

// Drive the REAL console-side pair against a real nip44 and a real key ring.
function stewardRig(ringHex = []) {
  const scope = {
    _nameKeyRing: ringHex,
    _unhex: unhex,
    nip44e: (plain, k) => nip44v2.encrypt(plain, k),
    nip44d: (ct, k) => nip44v2.decrypt(ct, k),
    console: { warn: () => {} },
  };
  const body = stripComments(fnBody(STEW, 'function _sealChurchDoc(obj)', '_sealChurchDoc'))
    + '\n' + stripComments(fnBody(STEW, 'function _openChurchDoc(content)', '_openChurchDoc'));
  const names = Object.keys(scope);
  return new Function(...names, body + '\nreturn { seal: _sealChurchDoc, open: _openChurchDoc };')(...names.map(n => scope[n]));
}

// …and the REAL member-side opener, which keys off a Map of Uint8Array rings.
function memberRig(cp, keys = []) {
  const scope = {
    _nameKeys: new Map([[cp, keys]]),
    nip44d: (ct, k) => nip44v2.decrypt(ct, k),
  };
  const body = stripComments(fnBody(FELLOW, 'function _openChurchDoc(cp, content)', '_openChurchDoc'));
  const names = Object.keys(scope);
  return new Function(...names, body + '\nreturn _openChurchDoc;')(...names.map(n => scope[n]));
}

const EVENT = { date: '2026-07-24', time: '10:30', title: 'Sunday Service', where: '14 Fenwick Road' };

test('a sealed event carries no date, time, title or address on the wire', () => {
  const key = crypto.getRandomValues(new Uint8Array(32));
  const wire = stewardRig([hex(key)]).seal(EVENT);
  for (const secret of ['2026-07-24', '10:30', 'Sunday Service', 'Fenwick']) {
    assert.ok(!wire.includes(secret),
      `"${secret}" is readable in the stored document. This is what a compelled relay operator reads without ` +
      'any key at all — the address and the timetable of a congregation for whom meeting is the risk');
  }
});

test('the church can read its own calendar back', () => {
  const key = crypto.getRandomValues(new Uint8Array(32));
  const rig = stewardRig([hex(key)]);
  assert.deepEqual(rig.open(rig.seal(EVENT)), EVENT, 'the console sealed a document it cannot itself reopen');
});

test('a member holding the church name key reads it', () => {
  const key = crypto.getRandomValues(new Uint8Array(32));
  const cp = 'ab'.repeat(32);
  const wire = stewardRig([hex(key)]).seal(EVENT);
  assert.deepEqual(memberRig(cp, [key])(cp, wire), EVENT);
});

test('a rotated ring still opens what the old key sealed', () => {
  // Rotation must never hide the church's own history — the ring carries superseded keys for exactly this.
  const oldK = crypto.getRandomValues(new Uint8Array(32));
  const newK = crypto.getRandomValues(new Uint8Array(32));
  const wire = stewardRig([hex(oldK)]).seal(EVENT);
  assert.deepEqual(stewardRig([hex(newK), hex(oldK)]).open(wire), EVENT,
    'after a rotation the church can no longer read its own past gatherings');
});

test('a member with no key gets null — never a half-read document', () => {
  const key = crypto.getRandomValues(new Uint8Array(32));
  const cp = 'ab'.repeat(32);
  const wire = stewardRig([hex(key)]).seal(EVENT);
  assert.equal(memberRig(cp, [])(cp, wire), null,
    'a member without the key got something back. null is what tells the screen to say "waiting for your ' +
    'key"; anything else risks rendering a blank or partial entry as though it were the truth');
  assert.equal(memberRig(cp, [crypto.getRandomValues(new Uint8Array(32))])(cp, wire), null, 'a wrong key opened it');
});

test('documents written before this shipped still open', () => {
  // Every event in every existing church is plain JSON. Sealing must not orphan them.
  const legacy = JSON.stringify(EVENT);
  assert.deepEqual(stewardRig([]).open(legacy), EVENT, 'the console lost every event written before the change');
  assert.deepEqual(memberRig('ab'.repeat(32), [])('ab'.repeat(32), legacy), EVENT, 'members lost the church history');
});

test('with no key yet the console writes cleartext rather than refusing', () => {
  // Deliberate, and the ONLY place this project fails open: a church whose name key has not arrived must
  // still be able to run its calendar, and unlike the chat send nothing here claims a protection it is not
  // delivering. Refusing would trade a legible calendar for no calendar.
  const wire = stewardRig([]).seal(EVENT);
  assert.deepEqual(JSON.parse(wire), EVENT);
});

test('a locked document is kept and marked, not dropped', () => {
  for (const [what, src] of [['the console', STEW], ['the member app', FELLOW]]) {
    const code = stripComments(src);
    assert.match(code, /_locked: true/,
      `${what} drops a calendar document it cannot open. An empty calendar is indistinguishable from a church ` +
      'with nothing on — the silent-blank failure this project treats as its worst');
  }
});

test('all five calendar documents are sealed, not just the one that was measured', () => {
  const sealed = (stripComments(STEW).match(/const content = _sealChurchDoc\(doc\);/g) || []).length;
  assert.equal(sealed, 5,
    `${sealed} of the 5 calendar documents are sealed. event, service, room, booking and rota each carry the ` +
    'time or the place of a gathering; leaving any one of them readable leaks the same fact by another route');
});

test('the shipped bundles carry it', () => {
  assert.match(VENDOR_S, /_sealChurchDoc/, 'vendor/steward.js predates this — run bash scripts/build-steward.sh');
  assert.match(VENDOR_F, /_openChurchDoc/, 'vendor/fellowship.js predates this — run bash scripts/build-fellowship.sh');
});
