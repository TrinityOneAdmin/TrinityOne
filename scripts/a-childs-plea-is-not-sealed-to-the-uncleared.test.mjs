// A YOUNG PERSON'S REQUEST FOR HELP MUST NOT BE WRAPPED FOR PEOPLE THEIR CHURCH NEVER CLEARED.
//   Run: node --test scripts/a-childs-plea-is-not-sealed-to-the-uncleared.test.mjs
//
// This runs the SHIPPED publishCareRequest out of vendor/fellowship.js, with the real NIP-44 primitives and
// real church-signed clearance documents fed in through pool.querySync. Nothing here stubs the minor/adult
// decision — that is the decision every test below is named after.
//
// THE DEFECT. When this member's own sealed clearance has not reached the phone, `_sgMine().known` is false:
// "we have not heard", which is not "not a child". The code then asked a DIFFERENT question — "has this
// church cleared anyone?" — and read an EMPTY answer as "safeguarding is not in use here, so there is no
// child audience to get wrong". An empty cleared-adults list is not evidence that safeguarding is unused. It
// is evidence that nobody is cleared, which is an ordinary state for a church that has marked its children
// and not yet vetted anybody, and one it can sit in indefinitely.
//
// In that state a young person's request — the disclosure itself, the thing they worked up to sending — was
// sealed to the whole care rota, and the sheet above the form said "This goes privately to your care team".
// A care-team seat is a willingness to cook a meal or give a lift. It is not a vetting check.
//
// AND THE REASON THE OLD CODE GAVE FOR BEING SAFE WAS FALSE, which is how it survived review: "the relay is
// the backstop either way — it refuses to serve a child's request to an uncleared reader whatever this phone
// sealed". True of ONE relay. `_publishAny(churchRelays(), evt)` sends to every relay the church uses, and
// that refusal depends on the relay holding the church's `minors:` document. Measured with two real gateways
// carrying identical churches and rosters: the one WITH `minors:` refused an uncleared care steward, the one
// WITHOUT served him the event — and he holds a key to it, because this phone wrapped one for him. The seal
// is the only thing that travels with the message.
//
// THE FIX: ask the document that answers the question. The relay serves a member their own
// `clearance:<pub>`, so this is a question they can always ask about themselves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { v2 as nip44 } from 'nostr-tools/nip44';
import { fnBody, liftSgMine, liftFetchMyClearance } from './test-slice.mjs';

const VENDOR = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
const hex = (u8) => Array.from(u8).map(b => b.toString(16).padStart(2, '0')).join('');
const CLEARANCE_D = 'trinityone/clearance:';
const now = () => Math.floor(Date.now() / 1000);

const churchSk = generateSecretKey(), churchPub = getPublicKey(churchSk);   // the console — the vicar's laptop
const tomSk    = generateSecretKey(), tomPub    = getPublicKey(tomSk);      // 15. His church has marked him.
const anneSk   = generateSecretKey(), annePub   = getPublicKey(anneSk);     // care rota. Uncleared for youth.
const joyceSk  = generateSecretKey(), joycePub  = getPublicKey(joyceSk);    // care rota. Uncleared for youth.
const graceSk  = generateSecretKey(), gracePub  = getPublicKey(graceSk);    // a cleared youth worker
const hannahSk = generateSecretKey(), hannahPub = getPublicKey(hannahSk);   // a steward with Safeguarding

// The church's own word about ONE member, sealed to that member — exactly what src/steward.src.js's
// publishClearance puts on the wire, and what subscribeChurchSafeguard opens on receipt.
function clearanceDoc({ by = churchSk, minor, at = now(), subject = tomPub }) {
  const ct = nip44.encrypt(JSON.stringify({ minor: !!minor, cleared: false, guardians: [] }),
                           nip44.utils.getConversationKey(by, subject));
  return finalizeEvent({ kind: 30078, created_at: at,
    tags: [['d', CLEARANCE_D + subject], ['t', 'trinityone'], ['p', subject], ['church', churchPub]],
    content: ct }, by);
}

// Lift the shipped method and the two safeguarding rules it rests on, and give them the free variables they
// close over. Everything else is a stub; the seal and the clearance documents are real.
function loadPublish({ team, childAudience, clearance = [], relayAuthed, roster = [], sgSelf }) {
  const published = [];
  const body = fnBody(VENDOR, 'async publishCareRequest(fields) {', 'publishCareRequest');
  const sgMine = liftSgMine(VENDOR);
  // NOT A STUB, DELIBERATELY. `_fetchMyClearance` IS the "is this person a child?" answer once the cached one
  // says "we have not heard" — which is the state every test here runs in. Stubbing it would leave this file
  // asserting about a mock of the rule it exists to guard; the repo has shipped that mistake four times.
  const fetchClr = liftFetchMyClearance(VENDOR);
  const stubs = {
    window: { Fellowship: { churchPub, ready: Promise.resolve() } },
    sk: tomSk, pub: tomPub,
    // THE PHONE HAS NOT HEARD. Every case below starts here — it is the whole subject of the fix, and it is
    // reached by a cold start, a church switch, a second account on one device, or a clearance publish that
    // never landed months ago.
    _sgSelf: sgSelf || { cp: churchPub, me: tomPub, isMinor: false, known: false },
    _fetchCareTeam: async () => team,
    _fetchChildCareAudience: async () => (childAudience === undefined ? [] : childAudience),
    // The relay, answering a REQ for this member's own clearance. `#d` is not applied — the lifted function
    // re-checks the d-tag itself, which is what a real relay's looser matching requires of it.
    pool: { querySync: async () => clearance },
    _relayAuthedAt: relayAuthed === undefined ? Date.now() : relayAuthed,
    _churchRoster: new Map([[churchPub, new Set(roster)]]),
    CLEARANCE_D,
    crypto: webcrypto,
    encrypt: (plain, key) => nip44.encrypt(plain, key),
    decrypt: (ct, key) => nip44.decrypt(ct, key),
    getConversationKey: (a, b) => nip44.utils.getConversationKey(a, b),
    nip44e: (plain, key) => nip44.encrypt(plain, key),
    nip44d: (ct, key) => nip44.decrypt(ct, key),
    nip44ck: (a, b) => nip44.utils.getConversationKey(a, b),
    _hex: hex,
    finalizeEvent,
    _publishAny: async (_relays, evt) => { published.push(evt); return evt; },
    churchRelays: () => ['wss://test.invalid', 'wss://second-relay.invalid'],
    NET: 'trinityone', CAREREQ_D: 'trinityone/carereq:', CARETEAM_D: 'trinityone/careteam:',
    console,
  };
  const scope = new Proxy(stubs, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => {
      if (k === Symbol.unscopables) return undefined;
      if (k in t) return t[k];
      const base = String(k).replace(/\d+$/, '');
      if (base in t) return t[base];
      throw new ReferenceError('the lifted function needs `' + String(k) + '` — add a stub for it in loadPublish()');
    },
  });
  const fn = new Function('scope', `with (scope) { ${sgMine} ${fetchClr} return ({ ${body} }).publishCareRequest; }`)(scope);
  return { fn, published };
}

// Can this person actually open what was published? The real unwrap the app does on receipt — not a look at
// the recipient list, which is what a request would show even if the key were wrong.
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

const FIELDS = { type: 'other', forSelf: true, when: 'soon', urgency: 'soon', note: 'I don’t want to go home tonight' };

test('A CHURCH THAT HAS CLEARED NOBODY DOES NOT TAKE A CHILD’S MESSAGE', async () => {
  // THE DEFECT, exactly. Tom is marked. His clearance has not reached this phone. His church has marked its
  // children and has not yet vetted anybody, so the cleared-adults list is empty — and the old code read that
  // as "safeguarding is not in use here" and sealed his words to Anne and Joyce on the care rota.
  const { fn, published } = loadPublish({
    team: [annePub, joycePub],                       // a full care rota, and it must make no difference
    childAudience: [],                               // this church has cleared nobody
    clearance: [clearanceDoc({ minor: true })],      // …but its own record says Tom is a child
  });
  const res = await fn(FIELDS);
  assert.equal(published.length, 0,
    'Tom’s disclosure was published sealed to the care rota. An empty cleared-adults list was treated as ' +
    '"this church does not use safeguarding"; it only ever meant "nobody is cleared".');
  assert.equal(res && res.error, 'no-one-cleared',
    'the app did not say WHY, so the screen cannot tell him what to do instead');
});

test('…and had it published, the uncleared rota WOULD have been able to open it', async () => {
  // Anchors the harm rather than assuming it: with the same inputs and the member believed to be an adult,
  // this is precisely who holds a key. Run against the ADULT branch to show the seal is genuine and that
  // Anne is a real reader of it, so "nothing was published" above is a protection and not a broken stub.
  const { fn, published } = loadPublish({
    team: [annePub, joycePub], childAudience: [],
    sgSelf: { cp: churchPub, me: tomPub, isMinor: false, known: true },   // the church says: an adult
  });
  await fn(FIELDS);
  assert.equal(published.length, 1);
  assert.equal(canOpen(published[0], anneSk, annePub), true,
    're-anchor: the seal is not real, so the test above proves nothing');
  assert.equal(canOpen(published[0], joyceSk, joycePub), true, 'same for the second rota seat');
});

test('a marked child in a church that HAS cleared someone reaches the cleared adult, and only them', async () => {
  const { fn, published } = loadPublish({
    team: [annePub, joycePub],
    childAudience: [gracePub],                       // Grace is the church's cleared youth worker
    clearance: [clearanceDoc({ minor: true })],
  });
  const res = await fn(FIELDS);
  assert.ok(res && !res.error, 'a child could not ask for help at all: ' + JSON.stringify(res));
  assert.equal(published.length, 1);
  assert.equal(canOpen(published[0], graceSk, gracePub), true,
    'the one adult this church cleared cannot open it — nobody is coming');
  assert.equal(canOpen(published[0], churchSk, churchPub), true, 'the office is a child’s route of last resort');
  assert.equal(canOpen(published[0], anneSk, annePub), false,
    'a child’s disclosure is readable by the care rota. Anne may be entirely trustworthy; her church has not ' +
    'cleared her to be near children, and this is not her business.');
  assert.equal(canOpen(published[0], joyceSk, joycePub), false, 'same for the second rota seat');
  assert.equal(res.toChildAudience, true, 'the caller cannot tell the child who actually received this');
});

test('the church’s own record is believed when a STEWARD wrote it — which is who marks a child', async () => {
  // In practice a delegated steward with the safeguarding job does the marking, not the owner's console, and
  // the relay accepts a clearance from a current roster steward. If only the church key were honoured here,
  // the fix would work in tests and not in the churches that use delegation.
  const { fn, published } = loadPublish({
    team: [annePub, joycePub], childAudience: [],
    clearance: [clearanceDoc({ by: hannahSk, minor: true })],
    roster: [hannahPub],
  });
  const res = await fn(FIELDS);
  assert.equal(published.length, 0, 'a clearance written by the church’s own safeguarding steward was ignored');
  assert.equal(res && res.error, 'no-one-cleared');
});

test('AN ADULT IS NOT REFUSED just because their clearance has not reached the phone', async () => {
  // The other half, and it is not a nicety: this is the ordinary member of a safeguarding church on a cold
  // start. Inferring from the cleared list refused them outright ("this church uses safeguarding — do not
  // guess"). Their own record answers the question outright, so they can ask for help.
  const { fn, published } = loadPublish({
    team: [annePub, joycePub],
    childAudience: [gracePub],                       // this church very much does use safeguarding
    clearance: [clearanceDoc({ minor: false })],     // …and says this member is not a child
  });
  const res = await fn(FIELDS);
  assert.ok(res && !res.error, 'an adult was refused help despite their church having answered about them: ' + JSON.stringify(res));
  assert.equal(canOpen(published[0], anneSk, annePub), true, 'the ordinary care path broke');
  assert.equal(res.toChildAudience, false, 'an adult was told their request went to the child audience');
});

test('a church that has never used safeguarding does not lock its adults out', async () => {
  // No clearance for anybody, because nothing has ever been marked. Refusing on that absence alone would
  // block every ordinary adult in every such church from asking for help — a far larger harm than the one
  // being prevented. This path is unchanged, deliberately.
  const { fn, published } = loadPublish({ team: [annePub, joycePub], childAudience: [], clearance: [] });
  const res = await fn(FIELDS);
  assert.ok(res && !res.error, 'an ordinary adult cannot ask for help at all: ' + JSON.stringify(res));
  assert.equal(published.length, 1);
  assert.equal(canOpen(published[0], anneSk, annePub), true, 'and it did not even reach the care team');
});

test('no record about this member, in a church that DOES clear people, is still a refusal', async () => {
  // Unchanged from before the fix, and still right: the church uses safeguarding, it has said nothing about
  // this person, and guessing is what this whole branch exists not to do.
  const { fn, published } = loadPublish({ team: [annePub, joycePub], childAudience: [gracePub], clearance: [] });
  const res = await fn(FIELDS);
  assert.equal(published.length, 0, 'an unknown clearance was treated as "adult"');
  assert.equal(res && res.error, 'unknown-clearance');
});

test('an unauthenticated relay’s silence is not an answer', async () => {
  // querySync RESOLVES EMPTY on a relay that is unreachable, still connecting, or that has not answered the
  // auth challenge — the trap that caused the original care-request defect. "Nothing found" only means
  // something once we know we were genuinely connected when we asked.
  const { fn, published } = loadPublish({
    team: [annePub, joycePub], childAudience: [], clearance: [], relayAuthed: 0,
  });
  const res = await fn(FIELDS);
  assert.equal(published.length, 0, 'an unreachable relay’s empty answer was read as "this church has no children"');
  assert.equal(res && res.error, 'unknown-clearance');
});

test('a clearance signed by a STRANGER is not the church’s word', async () => {
  // Anyone may sign an event at any d-tag. Without an authorship check, a forged "not a minor" at a child's
  // clearance tag would be believed and their request sealed to the whole rota — a way for one member to
  // strip another's safeguarding from the outside.
  const { fn, published } = loadPublish({
    team: [annePub, joycePub],
    childAudience: [gracePub],                                       // so a believed forgery is observable
    clearance: [clearanceDoc({ by: anneSk, minor: false })],         // Anne is not the church and not a steward
  });
  const res = await fn(FIELDS);
  assert.equal(published.length, 0, 'a document signed by an ordinary member decided this member is an adult');
  assert.equal(res && res.error, 'unknown-clearance');
});

test('a FUTURE-DATED "not a minor" cannot outrank the church’s current record', async () => {
  // Newest-wins makes a far-future copy permanent: it pins the answer where no honest correction can ever
  // reach it. Measured on the console side: a steward's phone running 11 minutes fast wrote "not a minor" for
  // a child and the member app obeyed it. The same 600s bound the subscription and src/steward.src.js use.
  const { fn, published } = loadPublish({
    team: [annePub, joycePub], childAudience: [],
    clearance: [clearanceDoc({ minor: false, at: now() + 86400 }), clearanceDoc({ minor: true })],
  });
  const res = await fn(FIELDS);
  assert.equal(published.length, 0,
    'a clearance dated tomorrow said "not a minor" and beat the church’s real one, and a child’s disclosure ' +
    'went to the care rota');
  assert.equal(res && res.error, 'no-one-cleared');
});
