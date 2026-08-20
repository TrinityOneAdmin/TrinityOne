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

const VENDOR = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
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
function loadSetStewards(existingCaps, existingNames) {
  const published = [];
  const fn = lift('setStewards(pubkeys, caps, names) {', 'setStewards', {
    _requireTrustedView: () => {}, sk: new Uint8Array(32), pub: 'church'.padEnd(64, '0'),
    _stewardCaps: existingCaps, _stewardNames: existingNames, _stewardSince: {},
    now: () => 1787150000, STEWARDS_D: 'trinityone/stewards:', NET: 'trinityone',
    finalizeEvent: (t) => t, publish: (e) => { published.push(e); return Promise.resolve(e); },
  });
  return { fn, published };
}
const docOf = (evt) => JSON.parse(evt.content);

test('the owner\'s own name for a steward is what gets stored', async () => {
  const { fn, published } = loadSetStewards({}, {});
  await fn([TOM], undefined, { [TOM]: 'Tom Ferris' });
  assert.deepEqual(docOf(published[0]).names, { [TOM]: 'Tom Ferris' },
    'the roster keeps no record of what the owner calls this person, so every screen falls back to a name ' +
    'the app invented and the owner cannot tell one steward from another');
});

test('and it survives an unrelated edit, like removing somebody else', async () => {
  const { fn, published } = loadSetStewards({}, { [TOM]: 'Tom Ferris', [GRACE]: 'Grace Okoro' });
  await fn([TOM]);                       // the shape every existing caller uses: list only
  assert.deepEqual(docOf(published[0]).names, { [TOM]: 'Tom Ferris' },
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
  const at = body.indexOf('_lastOk.get');
  const fire = body.indexOf('steward-publish-error');
  assert.ok(at > 0 && at < fire,
    'the check runs after the alarm is already raised, so the steward still sees "could not be saved" for a ' +
    'change that is saved');
});
