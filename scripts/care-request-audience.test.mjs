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
function loadPublish({ team, sgSelf, childAudience }) {
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
    // A CHILD IS SEALED TO A DIFFERENT AUDIENCE, and asked a different question first. `_sgSelf` is what this
    // phone has been told about ITSELF by its own church — `known:false` means the answer has not arrived,
    // which is not the same as "not a child" and must never be treated as such.
    _sgSelf: sgSelf || { cp: churchPub, isMinor: false, known: true },
    _fetchChildCareAudience: async () => (childAudience === undefined ? [] : childAudience),
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


// ── A CHILD'S REQUEST GOES TO THE ADULTS THE CHURCH HAS CLEARED, NOT TO THE CARE ROTA ────────────────────
// Owner's line, 2026-08-26: "if children can ask for care, they should be restricted to Only care team, that
// won't always be the case, so appropriate settings need to be available to the stewards to manage who can
// care for children, separate to other standard care requests."
//
// A care-team seat is a willingness to cook a meal or give a lift. It is not a vetting check, and a church
// that has not cleared someone to be near children has said something specific by not doing so. Before this,
// a child's opening message — the disclosure itself — was wrapped for every seat on the care rota, while the
// FOLLOW-UP thread had required youth clearance since the day it was written. The protection started one
// message too late, and the message it missed is the one that matters.
const clearedSk = generateSecretKey(), clearedPub = getPublicKey(clearedSk);

test('a child’s request is sealed to a CLEARED adult', async () => {
  const { fn, published } = loadPublish({
    team: [annePub, joycePub],                          // the ordinary care rota
    sgSelf: { cp: churchPub, isMinor: true, known: true },
    childAudience: [clearedPub],                        // …and the one adult this church has cleared
  });
  const res = await fn(FIELDS);
  assert.ok(res && !res.error, 'a child could not ask for help at all: ' + JSON.stringify(res));
  assert.equal(published.length, 1);
  assert.ok(canOpen(published[0], clearedSk, clearedPub),
    'the cleared adult cannot open a child’s request — the only people allowed to help cannot read it');
});

test('…and NOT to an uncleared member of the care team', async () => {
  const { fn, published } = loadPublish({
    team: [annePub, joycePub],
    sgSelf: { cp: churchPub, isMinor: true, known: true },
    childAudience: [clearedPub],
  });
  await fn(FIELDS);
  assert.equal(canOpen(published[0], anneSk, annePub), false,
    'a child’s disclosure is readable by the whole care rota. Anne may be entirely trustworthy; the point is ' +
    'that her church has not cleared her to be near children, and this is not her business.');
  assert.equal(canOpen(published[0], joyceSk, joycePub), false, 'same for the second care-team seat');
});

test('the church’s own console can always open it', async () => {
  // Deliberate, and the same reason the relay keeps the church key in safeguardAllows: the office must be a
  // child's route of last resort, and the console holder is the accountable adult.
  const { fn, published } = loadPublish({
    team: [], sgSelf: { cp: churchPub, isMinor: true, known: true }, childAudience: [clearedPub],
  });
  await fn(FIELDS);
  assert.ok(canOpen(published[0], churchSk, churchPub), 'the church itself cannot open a child’s request');
});

test('a church that has cleared NOBODY does not take the message', async () => {
  // The worst outcome this feature has is a form, a send, a thank-you, and not one person who can read it.
  // For a child working up to telling someone something difficult, that is worse than no feature at all.
  const { fn, published } = loadPublish({
    team: [annePub, joycePub],                          // a full care rota, and it makes no difference
    sgSelf: { cp: churchPub, isMinor: true, known: true }, childAudience: [],
  });
  const res = await fn(FIELDS);
  assert.equal(published.length, 0, 'a child’s words were published where nobody cleared can read them');
  assert.equal(res && res.error, 'no-one-cleared', 'the app did not say WHY, so the screen cannot tell them what to do');
});

test('“we could not find out” never falls back to the care team', async () => {
  // querySync resolves empty on a relay that is unreachable, still connecting, or has not answered the auth
  // challenge — the same trap that caused the original defect in this file. Guessing wrong here hands a
  // child's words to people their church declined to clear.
  const { fn, published } = loadPublish({
    team: [annePub, joycePub],
    sgSelf: { cp: churchPub, isMinor: true, known: true }, childAudience: null,
  });
  const res = await fn(FIELDS);
  assert.equal(published.length, 0, 'an unreachable relay caused a child’s request to go to the care rota');
  assert.equal(res && res.error, 'unknown-audience');
});

test('if we have not heard whether the sender is a child, we do not assume they are an adult', async () => {
  // A phone that has just started, or has never received its clearance, knows nothing. Refusing costs one
  // retry; assuming adult publishes a child's disclosure to the whole rota.
  const { fn, published } = loadPublish({
    team: [annePub, joycePub],
    sgSelf: { cp: churchPub, isMinor: false, known: false },
  });
  const res = await fn(FIELDS);
  assert.equal(published.length, 0, 'an unknown clearance was treated as "adult"');
  assert.equal(res && res.error, 'unknown-clearance');
});

test('an ADULT’s request is untouched by any of this', async () => {
  // The whole point of the change is that the two paths are separate. A grown-up asking for a lift still goes
  // to the care team exactly as before.
  const { fn, published } = loadPublish({ team: [annePub, joycePub] });
  const res = await fn(FIELDS);
  assert.ok(res && !res.error);
  assert.ok(canOpen(published[0], anneSk, annePub), 'the ordinary care path broke');
  assert.ok(canOpen(published[0], joyceSk, joycePub));
});

test('the RELAY refuses to serve a child’s request to an uncleared reader', () => {
  // The seal is the real protection, but it is chosen on one phone at one moment. The relay is the boundary,
  // and it must ask the same question of the REQUEST that it has always asked of the follow-up thread.
  const GW = stripComments(readFileSync(new URL('../scripts/gateway.mjs', import.meta.url), 'utf8'));
  const at = GW.indexOf("if (d.startsWith(CAREREQ_D)) {   ");
  assert.notEqual(at, -1, 're-anchor: the care-request read branch has moved');
  const branch = GW.slice(at, GW.indexOf('\n    }', at));
  assert.match(branch, /MINORS\.has\(e\.pubkey\)[\s\S]{0,80}safeguardAllows\(e\.pubkey, authed\)/,
    'a child’s disclosure is served to anyone with a care-team seat — the follow-up thread has been gated ' +
    'since the day it was written, and the opening message was not');
  const guardAt = branch.indexOf('safeguardAllows');
  const returnAt = branch.indexOf('return (authed');
  assert.ok(guardAt !== -1 && returnAt !== -1 && guardAt < returnAt,
    'the safeguarding check sits after the return that grants access, so it never runs');
});

test('…and the RESOLUTION of a child’s request, which names them, is gated too', () => {
  // "Handled" for a child's request tells an uncleared reader that that child asked for help, which is most
  // of what the gate above exists to withhold.
  const GW = stripComments(readFileSync(new URL('../scripts/gateway.mjs', import.meta.url), 'utf8'));
  const at = GW.indexOf('if (d.startsWith(CAREREQSTATUS_D)) {   ');
  assert.notEqual(at, -1, 're-anchor: the resolution read branch has moved');
  const branch = GW.slice(at, GW.indexOf('\n    }', at));
  assert.match(branch, /MINORS\.has\(pHex\)[\s\S]{0,80}safeguardAllows\(pHex, authed\)/,
    'the resolution of a child’s request is served to the whole care team');
});

test('the screen does not offer a child a form that goes nowhere', () => {
  const TODAY = stripComments(readFileSync(new URL('../app/screens-today.jsx', import.meta.url), 'utf8'));
  assert.match(TODAY, /childCareAudience/,
    'the card never asks whether anyone can receive a child’s request, so it offers the form regardless');
  assert.match(TODAY, /CARE_SEND_REFUSAL/,
    'a refusal has no wording, so the child is shown a generic failure or, worse, a thank-you');
  // …and a refusal must not be read as a send. `if (ok)` was true for every refusal object.
  assert.match(TODAY, /if \(ok && ok\.error\)/,
    'the submit handler treats a refusal object as success and thanks the child for a message nobody received');
});
