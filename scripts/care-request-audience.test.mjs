// AN "ASK FOR HELP" MUST REACH THE PEOPLE IT PROMISES, OR SAY WHO IT REACHED.
// Run: node --test scripts/care-request-audience.test.mjs
//
// A care request is not readable by whoever is entitled to it — it is readable by whoever the ASKER'S PHONE
// wrapped a key for, at the moment they pressed Send. publishCareRequest picks that audience from the
// church's published care-team roster (careteam:<church>). Nothing afterwards can widen it: adding someone
// to the care team tomorrow does not let them open what was sealed today.
//
// The defect, found by simulation on 2026-08-19 (R3-7). The roster lookup was inline and its failure was
// swallowed:
//
//     try { const evs = await pool.querySync(…CARETEAM_D + cp…); … } catch (e) {}
//     const recips = [...new Set([cp, pub, ...pubs].filter(Boolean))];
//
// pool.querySync RESOLVES EMPTY on a relay that is unreachable, still connecting, or that has not answered
// the auth challenge — so a cold start is indistinguishable from a church with nobody on its care team. When
// that happened the request went out sealed to the church key and the asker alone, the sheet had already
// promised "This goes privately to your care team — no one else sees it", and the toast said "Sent to your
// care team".
//
// What that cost in the parish: two care-team members watched requests arrive that they could not open, under
// a label blaming their own device for not being "on the care team's key list" — the one list they WERE on.
// Anne signed up to drive Edith to hospital and could not see the address, the time, or the phone number. She
// went back to her paper list. This is why the care lifecycle has never once been run end to end.
//
// _fetchCareTeam is the careful form of the same question and had been in this file since the safety-check
// work: null = the audience could not be established, [] = the church genuinely has nobody, a list = these
// people. The rule is stated at _safeReaders and applies here word for word — sealing narrower and reporting
// success is the one failure this feature cannot afford.
//
// This test drives the SHIPPED bundle (vendor/fellowship.js), not src/, and not a paraphrase.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { v2 as nip44 } from 'nostr-tools/nip44';
import { fnBody, stripComments } from './test-slice.mjs';

const VENDOR = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
const hex = (u8) => Array.from(u8).map(b => b.toString(16).padStart(2, '0')).join('');

const churchSk = generateSecretKey(), churchPub = getPublicKey(churchSk);
const askerSk = generateSecretKey(), askerPub = getPublicKey(askerSk);
const anneSk = generateSecretKey(), annePub = getPublicKey(anneSk);
const joyceSk = generateSecretKey(), joycePub = getPublicKey(joyceSk);

// Lift the shipped method and give it the free variables it closes over. Everything here is a stub EXCEPT
// the function under test and the real NIP-44 primitives — the seal has to be genuine or "can Anne open it?"
// is not a real question.
function loadPublish({ team }) {
  const published = [];
  const body = fnBody(VENDOR, 'async publishCareRequest(fields) {', 'publishCareRequest');
  // THE BUNDLER RENAMES WHAT IT LIFTS. In vendor/fellowship.js this function's crypto helpers are no longer
  // called nip44e/nip44ck/finalizeEvent — esbuild rewrote them to encrypt/getConversationKey/finalizeEvent2,
  // and a hard-coded parameter list therefore fed the function three undefined names. The function catches
  // its own encrypt failure and returns null, so the whole test read as "nothing was published" instead of
  // "your stub list is stale". Resolve names through a `with` scope: an unknown name raises a loud
  // ReferenceError naming it, and a trailing digit (finalizeEvent2) falls back to its base name.
  const stubs = {
    window: { Fellowship: { churchPub, ready: Promise.resolve() } },
    sk: askerSk, pub: askerPub,
    _fetchCareTeam: async () => team,                  // null | [] | [pubkeys]
    crypto: webcrypto,
    encrypt: (plain, key) => nip44.encrypt(plain, key),
    getConversationKey: (a, b) => nip44.utils.getConversationKey(a, b),
    nip44e: (plain, key) => nip44.encrypt(plain, key),
    nip44ck: (a, b) => nip44.utils.getConversationKey(a, b),
    _hex: hex,
    finalizeEvent,
    _publishAny: async (_relays, evt) => { published.push(evt); return evt; },
    churchRelays: () => ['wss://test.invalid'],
    NET: 'trinityone', CAREREQ_D: 'trinityone/carereq:', CARETEAM_D: 'trinityone/careteam:',
    // Present so that reverting to the OLD inline lookup RUNS rather than dying on a missing name: the
    // sabotage must fail on the assertion, not on the harness. querySync resolving empty is the exact
    // real-world case — an unreachable or unauthenticated relay.
    pool: { querySync: async () => [] },
    console,
  };
  const scope = new Proxy(stubs, {
    // Claim only the names we stub. `with` otherwise swallows Array, Set, JSON, Math and friends, and the
    // function then dies on its own language rather than on anything we are testing.
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => {
      if (k === Symbol.unscopables) return undefined;
      if (k in t) return t[k];
      const base = String(k).replace(/\d+$/, '');
      if (base in t) return t[base];
      throw new ReferenceError('the lifted function needs `' + String(k) + '` — add a stub for it in loadPublish()');
    },
  });
  const fn = new Function('scope', `with (scope) { return ({ ${body} }).publishCareRequest; }`)(scope);
  return { fn, published };
}

// Can this person actually open what was published? The real unwrap the app does on receipt.
const canOpen = (evt, readerSk, readerPub) => {
  try {
    const o = JSON.parse(evt.content);
    const mine = o.keys && o.keys[readerPub];
    if (!mine) return false;
    const kh = nip44.decrypt(mine, nip44.utils.getConversationKey(readerSk, evt.pubkey));
    JSON.parse(nip44.decrypt(o.enc, Uint8Array.from(kh.match(/.{1,2}/g).map(b => parseInt(b, 16)))));
    return true;
  } catch { return false; }
};

const FIELDS = { type: 'meals', forSelf: true, when: 'once', urgency: 'soon', note: 'Chemo Tuesdays — lift to hospital' };

test('the care team can open a request when the roster IS known', async () => {
  const { fn, published } = loadPublish({ team: [annePub, joycePub] });
  const res = await fn(FIELDS);
  assert.ok(res, 'nothing was published at all');
  assert.equal(published.length, 1);
  assert.ok(canOpen(published[0], anneSk, annePub), 'Anne is on the care team and still cannot open the request');
  assert.ok(canOpen(published[0], joyceSk, joycePub), 'Joyce is on the care team and still cannot open the request');
  assert.equal(res.narrowed, false, 'a healthy send reported itself as narrowed');
  assert.equal(res.teamCount, 2, 'the caller cannot see how many people this reached');
});

test('when the roster CANNOT be established, the caller is told — not thanked', async () => {
  // null is what _fetchCareTeam returns for a relay that is unreachable, still connecting, or unauthenticated.
  const { fn, published } = loadPublish({ team: null });
  const res = await fn(FIELDS);
  assert.ok(res, 'the request was dropped entirely — the church leader must still receive it');
  assert.equal(res.narrowed, true,
    'the request went out sealed to the church leader and the asker alone, and reported plain success. The ' +
    'member is then told "Sent to your care team" about a message no one on that team can open.');
  assert.equal(canOpen(published[0], anneSk, annePub), false, 're-anchor: this is genuinely the narrow case');
});

test('a church with genuinely nobody on the team is a DIFFERENT answer from "we could not ask"', async () => {
  const { fn } = loadPublish({ team: [] });
  const res = await fn(FIELDS);
  assert.equal(res.narrowed, false, 'an authenticated relay answering "nobody on the team" is a real answer');
  assert.equal(res.teamCount, 0,
    'the caller cannot distinguish an empty care team from a full one, so it cannot tell the member the truth');
});

test('the church leader can ALWAYS open it, however the lookup went', async () => {
  for (const team of [null, [], [annePub]]) {
    const { fn, published } = loadPublish({ team });
    await fn(FIELDS);
    assert.ok(canOpen(published[0], churchSk, churchPub),
      'the owner cannot triage this request, so a narrowed send reaches nobody at all (team=' + JSON.stringify(team) + ')');
  }
});

test('it asks _fetchCareTeam rather than running its own swallowed query', () => {
  // The structural half: an inline querySync here is how the failure got swallowed in the first place, and a
  // future edit that "inlines it for speed" reintroduces exactly this defect. Comments are stripped — this
  // repo has shipped an assertion satisfied by the comment explaining the rule.
  const body = stripComments(fnBody(VENDOR, 'async publishCareRequest(fields) {', 'publishCareRequest'));
  assert.match(body, /_fetchCareTeam\(/, 'publishCareRequest no longer uses the careful roster lookup');
  assert.doesNotMatch(body, /querySync/,
    'publishCareRequest runs its own roster query again. querySync resolves EMPTY on an unreachable or ' +
    'unauthenticated relay, which is indistinguishable from a church that has named nobody.');
});

// ── AND WHAT THE ASKER IS TOLD AFTERWARDS. The toast was fixed first; the row that stays on screen was not,
// and it is the one a member re-reads while they wait. Found on a phone: a church with no care team sealed a
// request to two keys — the leader and the asker — and the row still said "your care team will be in touch".
test('the asker\'s own row counts who can actually open it', () => {
  const sub = fnBody(VENDOR, '_openCareRequests(cb, forChurch) {', '_openCareRequests');
  assert.match(sub, /Object\.keys\(o\.keys/,
    'the request list never counts the envelope key list, so the audience size it reports is not measured');
  assert.match(sub, /recipients,/, 'the count is computed but never attached to the request');
});

test('a request only the leader holds is not described as reaching the care team', () => {
  const TODAY = readFileSync(new URL('../app/screens-today.jsx', import.meta.url), 'utf8');
  const row = fnBody(stripComments(TODAY), 'function MyRequestRow(', 'MyRequestRow');
  assert.match(row, /recipients/,
    'MyRequestRow promises "your care team will be in touch" without ever checking whether anyone on that ' +
    'team holds a key to the request. In a church with no care team that sentence is false, and the member ' +
    'waits for people who cannot see it.');
});
