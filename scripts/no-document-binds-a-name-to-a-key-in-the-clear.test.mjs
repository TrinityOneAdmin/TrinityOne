// A SEIZED RELAY MUST NOT YIELD THE CONGREGATION'S NAMES BESIDE ITS KEYS.
// Run: node --test scripts/no-document-binds-a-name-to-a-key-in-the-clear.test.mjs
//
// Finding 1 of the 2026-09-05 re-verification audit, measured by reading relay/relay.sqlite rather than a
// screen. Five documents wrote a person's name next to their pubkey in plain text:
//
//   roster:      {"people":[{"name":"Margaret Hoyle","pub":"44a2d349…"}]}   ← the serving and care teams
//   stewards:    {"names":{"9501ad2f…":"Ruth Bexley"}}                      ← the church's officers, + caps
//   voice:       who speaks for the church, by name and office
//   stewardreq:  who has ASKED for authority and not yet been granted it
//   reseat:      a display name bound to TWO keys — "this person, before and after"
//
// Put beside `minors:` and `guardians:` (cleartext by design, pubkeys only), a seized disk yielded the care
// team by name, which keys are children, and which named adult answers for each. Members' own display names
// were already sealed; these five defeated that for exactly the people a compelled authority asks about.
//
// THE TRAP THIS TEST ALSO GUARDS. The roster cannot simply be sealed: six grants in the relay read its
// pubkeys — careAdmin(), team-scoped rota visibility, and four team-room audience checks. Seal the lot and
// all six become "nobody": a care team with no admin, team rooms served to no one. So `roster:` is split —
// `pubs` in the clear for the relay, names inside `e`. A future change that seals `pubs` too would look
// tidier and would silently unstaff every team, so the relay half is asserted here as well.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { v2 as nip44v2 } from 'nostr-tools/nip44';
import { fnBody, stripComments } from './test-slice.mjs';

const STEW = readFileSync(new URL('../src/steward.src.js', import.meta.url), 'utf8');
const GATE = readFileSync(new URL('../scripts/gateway.mjs', import.meta.url), 'utf8');

const unhex = (h) => Uint8Array.from(h.match(/.{2}/g).map(x => parseInt(x, 16)));
const KEY = 'ab'.repeat(32);

const NAME = 'Margaret Hoyle';
const PUB  = '44a2d349d40a5b33d9b8bc95f23182333adcdb7e1efbf6762f9042b779b66a11';

// Drive the REAL publishRoster with a real nip44 and a real ring; `publish` is a spy, because what is under
// test is what reaches the wire, not whether the socket worked.
function rosterRig(ring = [KEY]) {
  const sent = [];
  const scope = {
    sk: new Uint8Array(32), _nameKeyRing: ring.slice(), _unhex: unhex,
    nip44e: (plain, k) => nip44v2.encrypt(plain, k),
    nip44d: (ct, k) => nip44v2.decrypt(ct, k),
    NAME_KEY_WAIT_MS: 150, ROSTER_D: 'trinityone/roster:', NET: 'trinityone',
    now: () => 1788573385, feChurch: (e) => e,
    publish: (e) => { sent.push(e); return Promise.resolve(true); },
  };
  const body = stripComments(fnBody(STEW, 'function _sealChurchDoc(obj)', '_sealChurchDoc'))
    + '\n' + stripComments(fnBody(STEW, 'function _sealChurchDocReady(obj)', '_sealChurchDocReady'))
    + '\n' + stripComments(fnBody(STEW, 'function _openChurchDoc(content)', '_openChurchDoc'))
    + '\nconst publishRoster = ' + stripComments(fnBody(STEW, 'async publishRoster(teamId, roster)', 'publishRoster'))
        .replace('async publishRoster(teamId, roster)', 'async function (teamId, roster)') + ';';
  const names = Object.keys(scope);
  const fns = new Function(...names, body + '\nreturn { publishRoster, open: _openChurchDoc };')(...names.map(n => scope[n]));
  return { ...fns, sent };
}

test('a team roster puts no name on the wire', async () => {
  const r = rosterRig();
  const out = await r.publishRoster('t1', { roles: [{ id: 'r1', name: 'Greeter' }], people: [{ id: 'p1', name: NAME, pub: PUB }], pods: [] });
  assert.ok(out, 'the roster did not publish at all');
  assert.equal(r.sent.length, 1);
  const wire = r.sent[0].content;
  assert.doesNotMatch(wire, new RegExp(NAME),
    'THE DEFECT: the serving team is on the relay with its members named. Anyone holding the disk reads the ' +
    'care team, and beside minors:/guardians: learns which named adult answers for which child.');
  assert.doesNotMatch(wire, /Greeter/, 'the role names are in the clear too — they describe the team');
});

test('…but the KEYS stay readable, or six relay grants silently become "nobody"', async () => {
  const r = rosterRig();
  await r.publishRoster('t1', { roles: [], people: [{ id: 'p1', name: NAME, pub: PUB }], pods: [] });
  const c = JSON.parse(r.sent[0].content);
  assert.ok(Array.isArray(c.pubs), 'the roster has no cleartext `pubs` list — the relay cannot resolve a care admin');
  assert.ok(c.pubs.includes(PUB), 'the member is not in `pubs`, so they are on no team as far as the relay knows');
  assert.equal(typeof c.e, 'string', 'the names are not sealed into `e`');
});

test('the console can read its own roster back', async () => {
  // Sealing that nobody can open is data loss, not privacy.
  const r = rosterRig();
  await r.publishRoster('t1', { roles: [{ id: 'r1', name: 'Greeter' }], people: [{ id: 'p1', name: NAME, pub: PUB }], pods: [] });
  const back = r.open(r.sent[0].content);
  assert.ok(back && Array.isArray(back.people), 'the sealed roster did not open back into a roster');
  assert.equal(back.people[0].name, NAME, 'the name did not survive the round trip');
  assert.equal(back.people[0].pub, PUB);
  assert.equal(back.roles[0].name, 'Greeter');
});

test('with no church key the roster is refused, not written in the clear', async () => {
  const r = rosterRig([]);
  const out = await r.publishRoster('t1', { roles: [], people: [{ id: 'p1', name: NAME, pub: PUB }], pods: [] });
  assert.equal(out, null, 'the caller was told the roster saved');
  assert.equal(r.sent.length, 0, 'a roster with names in it was published with no key to seal them');
});

test('the relay still reads old cleartext rosters, and new split ones', () => {
  // The rollout is relays-first, and it is only safe because an updated relay keeps understanding every
  // roster already on its disk — it rehydrates all history on update.
  // STRIP FIRST, THEN SLICE. Slicing the raw file and stripping afterwards measures the window in COMMENT
  // characters — this branch carries a 12-line note explaining why the keys stay readable, which pushed the
  // code itself past the end of the window and failed a true assertion. (Bit me writing this very test.)
  // SLICED, NOT WINDOWED. Two earlier drafts of this test took a fixed number of characters after the
  // anchor and both read a truncated slice — stripComments pads with spaces rather than deleting, so the
  // 12-line note above this branch went on filling the window it occupied. scripts/test-windows.test.mjs
  // exists to catch exactly that and did; fnBody walks the braces instead, so the note can grow.
  const parse = stripComments(fnBody(GATE, 'else if (d.startsWith(ROSTER_D)', 'the relay roster branch')).replace(/\s+/g, ' ');
  assert.match(parse, /c\.pubs/, 'the relay does not read the new `pubs` list — every team room goes empty');
  assert.match(parse, /c\.people/, 'the relay dropped the fallback — every roster written before today unstaffs itself');
});

test('the other four name-carrying documents are sealed too', () => {
  // Each is asserted where it is BUILT. These are src/, not app/, so dead code would be stripped from the
  // bundle rather than left readable — but the check is on the source that produces the bundle, so it is a
  // wiring claim, not a behaviour one. The behaviour claims are the executed tests above.
  const checks = [
    ['setStewards(pubkeys, caps, names)', /_sealChurchDoc\(nextNames\)/, 'the steward list still names its officers in the clear'],
    ['_voiceSave()', /_sealChurchDoc\(doc\)/, 'who speaks for the church is still in the clear'],
    ['requestSteward(', /nip44e\(/, 'a steward request still names the person asking'],
    ['setReseats(pairs)', /_sealChurchDoc\(\{ name: nm \}\)/, 'a re-seat still binds a display name to two keys in the clear'],
  ];
  for (const [sig, re, msg] of checks) {
    const body = stripComments(fnBody(STEW, sig, sig));
    assert.match(body, re, msg);
  }
});

test('no publisher writes a bare `names` or `name` field beside keys any more', () => {
  // The absence check, scoped to the four functions rather than the whole file — a plain search would hit a
  // sibling and report exactly what a blind test reports.
  const st = stripComments(fnBody(STEW, 'setStewards(pubkeys, caps, names)', 'setStewards'));
  assert.doesNotMatch(st, /doc\.names = /, 'setStewards still writes a cleartext names map');
  const rs = stripComments(fnBody(STEW, 'setReseats(pairs)', 'setReseats'));
  assert.doesNotMatch(rs, /out\.name = nm/, 'setReseats still writes the display name in the clear');
});
