// AN OWNER MUST BE ABLE TO TELL THEIR STEWARDS APART.
// Run: node --test scripts/steward-roster-identity.test.mjs
//
// From the delegation round, 2026-08-19. The owner added Tom, Grace and Rhys by pasting their codes, and the
// three rows came back reading "Gentle Cedar 36", "Sure Spring 19" and "Quiet Haven 99" — names the app
// derives from each key. They are stable and unguessable, and they are not the names the owner typed. Their
// report: "I only know which is which from the order I added them in", and:
//
//     "a mis-pasted code is a stranger with everything and I'd never spot it"
//
// That is the failure this guards. These are the people who can read the safeguarding notes and the money,
// and the owner was being asked to confirm an identity by a name the product invented.
//
// The second half is the banner. Two code paths can publish one document a moment apart; the newer lands and
// the older is refused with "a newer version of this is already stored". The steward was shown a red, sticky
// "your change could not be saved" — for a change that WAS saved. Measured on a fresh church: the banner
// claimed the approval setting had failed while the relay held approval:true.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody, stripComments } from './test-slice.mjs';

import { v2 as nip44v2 } from 'nostr-tools/nip44';

const VENDOR = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');

// THE NAMES ARE SEALED SINCE 2026-09-05 (finding 1). This document held {"names":{"<pub>":"Ruth Bexley"}}
// in plain text on the relay — the church's officers, by name, beside the keys that identify them. The
// claims below are unchanged (the owner's own label is stored, and survives an unrelated edit); what
// changed is that they now have to be read out of the sealed half. Using the REAL _sealChurchDoc rather
// than a stub matters: a stub would answer the very question the sealing raises.
const RING_KEY = 'cd'.repeat(32);
const unhexKey = (h) => Uint8Array.from(h.match(/.{2}/g).map(x => parseInt(x, 16)));

const DASH = readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8');

function lift(anchor, name, stubs) {
  const body = fnBody(VENDOR, anchor, name);
  const scope = new Proxy(stubs, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => {
      if (k === Symbol.unscopables) return undefined;
      if (k in t) return t[k];
      const base = String(k).replace(/[0-9]+$/, '');
      if (base in t) return t[base];
      throw new ReferenceError('needs a stub for ' + String(k));
    },
  });
  const method = new RegExp('^' + name + '\\s*\\(').test(body.trim());
  return new Function('scope', method ? `with (scope) { return ({ ${body} }).${name}; }` : `with (scope) { return (${body}); }`)(scope);
}

const TOM = 'a'.repeat(64), GRACE = 'b'.repeat(64);
function loadSetStewards(existingCaps, existingNames, existingCt = '') {
  const published = [];
  const fn = lift('setStewards(pubkeys, caps, names) {', 'setStewards', {
    _requireTrustedView: () => {}, sk: new Uint8Array(32), pub: 'church'.padEnd(64, '0'),
    _stewardCaps: existingCaps, _stewardNames: existingNames, _stewardNamesCt: existingCt, _stewardSince: {},
    now: () => 1787150000, _selfVoice: null, _publicVoices: {}, lastProfile: {},   // the console's public by-line rides this same roster (2026-08-26). Empty here deliberately:
    // these cases assert that the owner's PRIVATE labels are stored and carried forward, and a church that has
    // named nobody publicly must still write exactly the shape it always did.
    STEWARDS_D: 'trinityone/stewards:', NET: 'trinityone',
    _sealChurchDoc: realSeal,
    finalizeEvent: (t) => t, publish: (e) => { published.push(e); return Promise.resolve(e); },
  });
  return { fn, published };
}
// Lifted through this file's own lift(), NOT a bare new Function: esbuild renames the nip44 imports, so the
// shipped body calls `encrypt3`, not `nip44e`. lift()'s proxy strips the numeric suffix and finds `encrypt`.
// A hand-rolled scope silently supplied nothing, the try/catch swallowed the ReferenceError, and the sealer
// returned null for every input — which looks exactly like "no church key" rather than a broken harness.
const realSeal = lift('function _sealChurchDoc(obj)', '_sealChurchDoc', {
  _nameKeyRing: [RING_KEY], _unhex: unhexKey,
  encrypt: (plain, k) => nip44v2.encrypt(plain, k),
  decrypt: (ct, k) => nip44v2.decrypt(ct, k),
});

const docOf = (evt) => JSON.parse(evt.content);
// Open the sealed half back into the names map. Also asserts, on every use, that no name reached the wire.
const namesOf = (evt) => {
  const doc = docOf(evt);
  assert.equal(doc.names, undefined, 'a cleartext names map is back on the wire');
  if (typeof doc.n !== 'string') return {};
  return JSON.parse(nip44v2.decrypt(doc.n, unhexKey(RING_KEY)));
};

test('the owner\'s own name for a steward is what gets stored', async () => {
  const { fn, published } = loadSetStewards({}, {});
  await fn([TOM], undefined, { [TOM]: 'Tom Ferris' });
  assert.deepEqual(namesOf(published[0]), { [TOM]: 'Tom Ferris' },
    'the roster keeps no record of what the owner calls this person, so every screen falls back to a name ' +
    'the app invented and the owner cannot tell one steward from another');
});

test('and it survives an unrelated edit, like removing somebody else', async () => {
  const { fn, published } = loadSetStewards({}, { [TOM]: 'Tom Ferris', [GRACE]: 'Grace Okoro' });
  await fn([TOM]);                       // the shape every existing caller uses: list only
  assert.deepEqual(namesOf(published[0]), { [TOM]: 'Tom Ferris' },
    'removing one steward wiped the names of the others — so pressing Remove on one person puts the invented ' +
    'names back for everybody');
});

test('a church that has named nobody still writes the plain old shape', async () => {
  const { fn, published } = loadSetStewards({}, {});
  await fn([TOM]);
  // `at` rides on every roster now (the record of when access was granted); `names` must not.
  const doc = docOf(published[0]);
  assert.deepEqual(doc.pubkeys, [TOM]);
  assert.equal(doc.names, undefined, 'an empty names object is being written for no reason');
});

test('the console asks for the name, and refuses to add without one', () => {
  const src = stripComments(DASH);
  assert.match(src, /Their name, as you know them/, 'there is nowhere for the owner to type who this person is');
  assert.match(src, /Give them a name first/,
    'a steward can still be added nameless, which lands them in the list under an invented name — exactly ' +
    'the state the owner could not read');
});

test('the row leads with the owner\'s name, not the invented one', () => {
  const src = stripComments(DASH);
  assert.match(src, /const label = labels\[pk\] \|\| m\.name \|\| niceName\(pk\)/,
    'the invented name still wins over what the owner called them');
});

test('a refusal of our OWN superseded write does not alarm the steward', () => {
  const body = stripComments(fnBody(VENDOR, 'async function publish(evt) {', 'publish'));
  assert.match(body, /_lastOk/,
    'nothing records which of our writes the relay accepted, so a "newer version already stored" refusal of ' +
    'our own older copy is indistinguishable from a real failure');
  assert.match(body, /newer version/i, 're-anchor: the refusal is no longer recognised by its reason');
  // SCOPED TO THE CATCH BLOCK, and it has to be. publish() now raises steward-publish-error from a SECOND,
  // earlier place too — an empty publish set under the closed-network gate (plan C4), where nothing was
  // written and a superseded copy of our own is not even possible. Comparing whole-body offsets would read
  // that unrelated dispatch as the alarm this test is about, and report a correct ordering as broken.
  const catchAt = body.indexOf('catch (e) {');
  assert.ok(catchAt > 0, 're-anchor: publish() no longer has a catch block');
  const cb = body.slice(catchAt);
  const at = cb.indexOf('_lastOk.get');
  const fire = cb.indexOf('steward-publish-error');
  assert.ok(at > 0 && fire > 0 && at < fire,
    'the check runs after the alarm is already raised, so the steward still sees "could not be saved" for a ' +
    'change that is saved');
});

test('labels we hold but cannot open are carried forward, never wiped', async () => {
  // THE RACE THE THIRD AUDIT FOUND, and it is a data-loss bug the SEALING introduced.
  //
  // This document is read once, on subscribe. The church name key arrives on a DIFFERENT subscription. So on
  // any boot where the stewards doc wins that race — ordinary, not just a slow link — the labels cannot be
  // opened and _stewardNames is {} for the whole session. The next Add or Remove then republished a document
  // with no `n` at all, and because these are newest-wins addressable documents, every label the owner had
  // typed was gone for every steward, permanently, with no way back.
  //
  // Before 192da7a the labels were cleartext and this could not happen.
  const ct = JSON.parse(realSeal({ [TOM]: 'Tom Ferris' })).e;
  const { fn, published } = loadSetStewards({}, {}, ct);   // labels held as ciphertext, never opened
  await fn([TOM, GRACE]);                                   // an ordinary edit: add somebody
  const doc = docOf(published[0]);
  assert.equal(doc.n, ct,
    'THE DEFECT: an edit made while the labels were unreadable republished the roster without them. Every ' +
    'name the owner typed for every steward is deleted, and nothing can recover it.');
  assert.equal(doc.names, undefined, 'a cleartext names map is back on the wire');
  assert.deepEqual(nip44v2.decrypt(doc.n, unhexKey(RING_KEY)), JSON.stringify({ [TOM]: 'Tom Ferris' }),
    'the carried-forward ciphertext no longer decrypts to the owner\'s labels');
});
