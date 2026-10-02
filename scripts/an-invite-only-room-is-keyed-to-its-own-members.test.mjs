// AN INVITE-ONLY ROOM IS KEYED TO ITS OWN MEMBERS, AND A DELEGATE DOES NOT MINT OVER THE OWNER'S KEY (sim finding 3).
//   Run: node --test scripts/an-invite-only-room-is-keyed-to-its-own-members.test.mjs
//
// THE DEFECT. ensureGroupKeys (src/steward.src.js) heals an encrypted room that has no key by minting one. Two faults:
//   1. it keyed EVERY room to the church-wide member list, so a key minted for an invite-only room (a Leaders room) was
//      wrapped to everyone in the church — a child included — and the room was readable by them;
//   2. it looked for the existing envelope with `authors: [churchPub]`. On a delegated console `churchPub` is the
//      DELEGATE'S own key ("our key signs, the church's context reads"), so the owner's envelope was never found and,
//      with no sealed traffic yet to make it refuse, the delegate minted a competing, newer one.
// Measured in the sim: a Leaders groupkey authored by the delegate, wrapped to ten keys including a child.
//
// THE FIX. An invite-only room is keyed to its own members (the whole congregation only for an open room); the
// envelope is looked up under the church AND this console's key.
//
// This RUNS the shipped ensureGroupKeys, lifted out of vendor/steward.js, against a fake relay pool that answers by
// filter. publishGroupKey is the recorder: the decision under test (who is passed to it, and whether it is called at all)
// is made inside ensureGroupKeys. KeyDistributor (stew-dashboard.jsx) is its only product caller.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';

const VENDOR = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const OWNER = 'c'.repeat(64), DELEGATE = 'd'.repeat(64);
const A = 'a'.repeat(64), B = 'b'.repeat(64), CHILD = '9'.repeat(64);

function run({ actingChurch = '', groups, memberPubs, envelopeAuthoredBy = null }) {
  const asked = [], minted = [];
  const pubKey = actingChurch ? DELEGATE : OWNER;   // `pub` / `churchPub`: on a delegated console, this device's own key
  const scope = {
    actingChurch, pub: pubKey, sk: new Uint8Array(32), churchSk: new Uint8Array(32), churchPub: pubKey,
    _isRelayAuthed: () => true, _skeys: {},
    relays: () => ['wss://r'], GROUP_D: 'trinityone/group:', GROUPKEY_D: 'trinityone/groupkey:',
    pool: { querySync: async (_r, filters) => {
      const f = filters[0]; asked.push(f);
      if (f.kinds && f.kinds[0] === 30078 && f['#d'] && f['#d'][0].startsWith('trinityone/group:')) return [{ id: 'canary', pubkey: OWNER }];   // the group's own definition: reads work
      if (f.kinds && f.kinds[0] === 30078 && f['#d'] && f['#d'][0].startsWith('trinityone/groupkey:'))
        return (envelopeAuthoredBy && f.authors.includes(envelopeAuthoredBy)) ? [{ id: 'env', pubkey: envelopeAuthoredBy }] : [];
      return [];   // no sealed traffic in the room
    } },
    Array, Set, Promise, console,
  };
  scope.record = (id, recips, opts) => { minted.push({ id, recips, opts }); return Promise.resolve({}); };
  const method = fnBody(VENDOR, 'async ensureGroupKeys(groups, memberPubs) {', 'ensureGroupKeys');
  const proxy = new Proxy(scope, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k]; if (String(k) in globalThis) return globalThis[String(k)]; throw new ReferenceError('needs a stub for ' + String(k)); },
  });
  // `this.publishGroupKey` inside the lifted method resolves on the object it is lifted into: the recorder
  const api = new Function('scope', `with (scope) { return ({ ${method}, publishGroupKey(id, recips, opts) { return record(id, recips, opts); } }); }`)(proxy);
  return { done: api.ensureGroupKeys(groups, memberPubs), minted, asked };
}

const rooms = [
  { id: 'leaders', name: 'Leaders', encrypted: true, visibility: 'invite', members: [A] },
  { id: 'all', name: 'Everyone', encrypted: true, visibility: 'open' },
  { id: 'nobody', name: 'New', encrypted: true, visibility: 'invite', members: [] },
  { id: 'plain', name: 'Plain', encrypted: false, visibility: 'open' },
];

test('an invite-only room is keyed to ITS members; an open room to the whole church; an empty invite room to nobody extra', async () => {
  const r = run({ groups: rooms, memberPubs: [A, B, CHILD] });
  await r.done;
  const by = Object.fromEntries(r.minted.map(m => [m.id, m.recips]));
  assert.deepEqual(Object.keys(by).sort(), ['all', 'leaders', 'nobody'], 'rooms keyed: ' + Object.keys(by) + ' (every encrypted room that had no key, and no plain one)');
  assert.deepEqual(by.leaders, [A], 'AN INVITE-ONLY ROOM WAS KEYED TO THE WHOLE CHURCH — a child can read the Leaders room: ' + JSON.stringify(by.leaders));
  assert.deepEqual(by.all.sort(), [A, B, CHILD].sort(), 'an open room must be keyed to everyone');
  assert.deepEqual(by.nobody, [], 'an invite-only room nobody is invited to was keyed to the congregation');
  assert.ok(r.minted.every(m => m.opts && m.opts.background === true), 'a healing mint is a background write (a refusal must not raise the standing alarm)');
});

test('the envelope is looked up under the church AND this console’s own key, so a delegate does not mint over the owner’s', async () => {
  const r = run({ actingChurch: OWNER, groups: [rooms[0]], memberPubs: [A, B], envelopeAuthoredBy: OWNER });
  await r.done;
  const lookup = r.asked.find(f => f['#d'] && f['#d'][0].startsWith('trinityone/groupkey:'));
  assert.ok(lookup, 'the envelope was never looked up');
  assert.ok(lookup.authors.includes(OWNER) && lookup.authors.includes(DELEGATE), 'the lookup asked for ' + JSON.stringify(lookup.authors) + ' — the owner’s envelope can only be found under the church’s key');
  assert.deepEqual(r.minted, [], 'A DELEGATE MINTED A COMPETING KEY over an envelope the owner had already published');
});

test('CONTROL: with no envelope anywhere, a delegate still heals a keyless room (the lookup is not simply refusing)', async () => {
  const r = run({ actingChurch: OWNER, groups: [rooms[0]], memberPubs: [A, B], envelopeAuthoredBy: null });
  await r.done;
  assert.equal(r.minted.length, 1, 'a keyless room was left keyless');
  assert.deepEqual(r.minted[0].recips, [A]);
});
