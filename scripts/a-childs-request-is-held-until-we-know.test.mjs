// A YOUNG PERSON'S REQUEST FOR HELP MUST NOT SIT UNDER THE BUTTON THAT PUBLISHES IT TO THE CHURCH.
// Run: node --test scripts/a-childs-request-is-held-until-we-know.test.mjs
//
// AUDIT 2026-09-04. The console's care-request triage was given this guard on 2026-09-03. The MEMBER APP has
// its own copy of the same triage — a care admin doing the same job on their phone — and was left asking an
// empty list a question it could not yet answer.
//
// The window is every launch. `ctx.safeguard.minors` arrives over a subscription, and until it does an empty
// set answers "no, not from a child" exactly as confidently as a loaded one. A request landing in that window
// was filed with the adults, beside "Set up help" — which publishes a NEED the whole congregation reads,
// signs up to, and which carries a name. That is a private disclosure turned into a notice-board item.
//
// The other half of the rule, and the trap the console hit first: a church that has never marked a child
// never publishes the minors document, so "wait for a non-empty list" would hold every request in the
// confidential queue FOR EVER in exactly those churches — the care module silently switched off. So the
// engine answers a second question (did the relay answer us after it knew who we are?) and this screen
// consumes that answer rather than guessing from the list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadScreen, miniReact, texts, find, button } from './render-jsx-screen.mjs';
import { fnBody } from './test-slice.mjs';

const BUNDLE = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');

const CHILD = 'c'.repeat(64), ADULT = 'a'.repeat(64), ME = 'm'.repeat(64);
const Stub = (n) => function S(p) { return { type: n, props: p, kids: [] }; };

function render({ minors, minorsKnown, from }) {
  const { React, draw } = miniReact();
  const reqs = [{ id: 'req-1', from, forSelf: true, type: 'other', note: 'please could someone talk to me', status: 'open' }];
  const globals = {
    React, console, setTimeout, clearTimeout, setInterval, clearInterval,
    Icon: ({ name }) => React.createElement('i', { 'data-icon': name }),
    ChurchBadge: Stub('ChurchBadge'),
    document: { addEventListener() {}, removeEventListener() {}, querySelector: () => null },
    navigator: { userAgent: '' }, location: { search: '', hostname: 'x' },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    lsGet: (k, d) => d, lsSet: () => {},
    cx: (...a) => a.filter(Boolean).join(' '),
    SectionLabel: Stub('SectionLabel'), Halo: Stub('Halo'), Sheet: Stub('Sheet'), IconBtn: Stub('IconBtn'),
    useTrinityAudio: () => ({ track: null, playing: false }),
    todayISO: () => '2026-09-04',
    fetch: async () => ({ ok: false, json: async () => ({}) }),
    window: {
      addEventListener() {}, removeEventListener() {}, innerWidth: 360,
      Fellowship: {
        myPubkey: ME,
        subscribeCareRequests: (cb) => { cb(reqs); return () => {}; },
        declineCareRequest: async () => ({ id: 'e' }),
        childCareAudience: async () => [],
      },
      TrinityData: { NOTIFICATIONS: [], PLANS: [], VOTD_POOL: [] },
      Bible: { parseRef: () => null, loaded: false, books: () => [], getVerses: () => [], maxChapter: () => 1, activeVersion: 'WEB', refLabel: () => '', defaultLoc: () => ({ book: 43, chap: 1 }) },
    },
  };
  const { CareRequests } = loadScreen('app/screens-today.jsx', ['CareRequests'], globals);
  // The screen works out "am I a care admin?" itself, from the rota — so hand it a real one. A fixture that
  // sets a convenient `ctx.isCareAdmin` would be testing a flag the shipped code never reads.
  const ctx = {
    church: { npub: 'npub1church' },
    safeguard: { minors, approved: [ME], guardians: {}, isMinor: false, cleared: true, minorsKnown },
    churchRosters: [{ team: 'care-team', people: [{ pub: ME }] }],
    canDMPeer: () => true, toast() {},
    care: { myPub: ME, settings: { enabled: true, adminGroupId: 'care-team' } },
  };
  // The list arrives through an effect, so the first draw is empty — as it is on a real phone for an instant.
  draw(CareRequests, { ctx });
  const tree = draw(CareRequests, { ctx });
  return {
    setUpHelpButtons: button(tree, 'Set up help').length,
    words: texts(tree).join(' '),
  };
}

test('while we do not yet know who the children are, NOTHING is offered "Set up help"', () => {
  const r = render({ minors: [], minorsKnown: false, from: CHILD });
  assert.equal(r.setUpHelpButtons, 0,
    'a request arriving before the safeguarding list did was filed with the adults, under the button that ' +
    'publishes a need the whole congregation reads and signs up to');
  assert.match(r.words, /checking which of these|CHECKING WHO THESE ARE FROM/i,
    'the screen claims to know a request is not from a child while it is still finding out');
});

test('CONTROL: once the lists have arrived, a child\'s request is confidential and has no "Set up help"', () => {
  const r = render({ minors: [CHILD], minorsKnown: true, from: CHILD });
  assert.equal(r.setUpHelpButtons, 0, 'a child\'s request is offered the congregation-wide button');
  assert.match(r.words, /FROM A YOUNG PERSON/, 'a known child\'s request is not marked as one');
});

test('CONTROL: once the lists have arrived, an ADULT\'s request still gets "Set up help"', () => {
  // Without this the fix could be "never offer it", which switches the care module off.
  const r = render({ minors: [CHILD], minorsKnown: true, from: ADULT });
  assert.equal(r.setUpHelpButtons, 1,
    'an adult\'s request lost the control that sets help up — the fix must hold the line, not close the door');
  assert.match(r.words, /REQUESTS FOR HELP/);
});

// ── the engine half, RUN rather than read ─────────────────────────────────────────────────────────────────
//
// The first version of this asserted `/minorsKnown/`, `/sawMinors \|\|/` and `/_relayAuthedAt/` against the
// bundle. That is a token match, and the fourth audit proved it blind: rewriting the rule to
// `sawMinors || !!_relayAuthedAt` — which answers "known" from the mere fact that we once SIGNED an auth —
// left this file 4/0 green. It is named for exactly that distinction, so it has to run the thing.
//
// The shipped subscribeChurchSafeguard, out of vendor/fellowship.js, over a stubbed church-docs hub.
const SUB = fnBody(BUNDLE, 'subscribeChurchSafeguard(churchNpub, onLists) {', 'subscribeChurchSafeguard');
const CP = 'c'.repeat(64), MEHEX = 'e'.repeat(64);

function engine({ authedAt, eosedAt, minorsDoc }) {
  const heard = [];
  const hub = { eosedAt };
  const stubs = {
    window: { Fellowship: { myPubkey: MEHEX } },
    pub: MEHEX, sk: 'k',
    toPub: () => CP,
    pubSet: (a) => new Set(a || []),
    _noPhoto: new Set(),
    _churchRoster: new Map(),
    APPROVED_D: 'trinityone/approved:',
    _relayAuthedAt: authedAt,
    _docsHub: () => hub,
    _onChurchDocs: (_cp, h) => {
      // An unrelated safeguarding doc first, so `emit()` fires even in the cases with no EOSE — otherwise
      // "nothing was emitted" and "emitted false" are the same empty result and the case proves nothing.
      h.onevent({ id: 'n', pubkey: CP, created_at: 1756900000, content: JSON.stringify({ pubkeys: [] }),
                  tags: [['d', 'trinityone/nophoto:' + CP]] }, 'trinityone/nophoto:' + CP);
      if (minorsDoc) h.onevent(minorsDoc, 'trinityone/minors:' + CP);
      if (eosedAt && h.oneose) h.oneose();
      return () => {};
    },
    decrypt: (c) => c, getConversationKey: () => 'k', nip44d: (c) => c, nip44ck: () => 'k',
    SG_ASSUME_KEY: 'trinityone.sgassume.', _mayCache: () => true,
    _fetchChildCareAudience: async () => [],
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    console,
  };
  const DECLARED = new Set(['_sgSelf', 'heard']);
  const scope = new Proxy(stubs, {
    has: (t, k) => !DECLARED.has(String(k)) && ((k in t) || !(String(k) in globalThis)),
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k];
      const base = String(k).replace(/\d+$/, ''); if (base in t) return t[base];
      throw new ReferenceError('the lifted code needs `' + String(k) + '` — add a stub for it in engine()'); },
  });
  const names = Object.keys(stubs);
  new Function(...names, 'scope', 'heard', `
    let _sgSelf = { cp: '', me: '', isMinor: false, known: false };
    with (scope) { ({ ${SUB} }).subscribeChurchSafeguard('npub1c', (o) => heard.push(o)); }`)
    (...names.map(k => stubs[k]), scope, heard);
  assert.ok(heard.length, 'the lifted stream emitted nothing at all — re-anchor this test');
  return heard[heard.length - 1];
}

const minorsEvent = { id: 'm', pubkey: CP, created_at: 1756900000,
                      content: JSON.stringify({ pubkeys: ['kid'] }), tags: [['d', 'trinityone/minors:' + CP]] };

test('an EOSE from a relay we have not proved ourselves to is NOT an answer', () => {
  const o = engine({ authedAt: 0, eosedAt: 1000, minorsDoc: null });
  assert.equal(o.minorsKnown, false,
    'the relay answered before it knew who we are — an empty list from that read means "we were not told", ' +
    'not "this church has no children"');
});

test('no EOSE at all is not an answer either', () => {
  assert.equal(engine({ authedAt: 500, eosedAt: 0, minorsDoc: null }).minorsKnown, false,
    'the screen was told the lists had arrived before anything arrived');
});

test('a church that has never marked a child is still ANSWERED', () => {
  // The trap the console hit first: waiting for the document itself would hold every request confidential
  // for ever here, which is the care module silently switched off.
  assert.equal(engine({ authedAt: 500, eosedAt: 600, minorsDoc: null }).minorsKnown, true,
    'a church with no children never publishes the list, so this would never become known and every ' +
    'request would sit in the confidential queue for ever');
});

test('the document itself answers, even before an authenticated EOSE', () => {
  const o = engine({ authedAt: 0, eosedAt: 0, minorsDoc: minorsEvent });
  assert.equal(o.minorsKnown, true, 'we are holding the list and still claiming not to know');
  assert.deepEqual(o.minors, ['kid']);
});

test('the answer comes from the HUB\'s eose, not the wall clock when we were called', () => {
  // A late-registering handler has oneose() invoked synchronously against a REPLAYED buffer, so stamping
  // Date.now() there would read a pre-auth answer as a post-auth one on every re-registration.
  assert.equal(engine({ authedAt: 900, eosedAt: 500, minorsDoc: null }).minorsKnown, false,
    'the hub EOSEd before we proved who we are, and this read it as an answer anyway');
});

test('ANCHOR: the shipped rule still has both halves (this one is a token check, and knows it)', () => {
  // The shipped subscribeChurchSafeguard, out of vendor/fellowship.js. A church that has never marked a child
  // publishes no minors document, so `sawMinors` alone would hold every request confidential for ever there.
  const BUNDLE = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
  const i = BUNDLE.indexOf('subscribeChurchSafeguard(');
  assert.ok(i > 0, 'subscribeChurchSafeguard is not in the bundle — re-anchor this test');
  let d = 0, end = i;
  for (let k = BUNDLE.indexOf('{', i); k < BUNDLE.length; k++) {
    if (BUNDLE[k] === '{') d++;
    else if (BUNDLE[k] === '}') { d--; if (!d) { end = k + 1; break; } }
  }
  const body = BUNDLE.slice(i, end);
  assert.match(body, /minorsKnown/, 'the member-side safeguarding stream no longer reports whether it knows');
  assert.match(body, /sawMinors\s*\|\|/,
    'minorsKnown must be satisfied by the document OR by an authenticated answer — the document alone leaves ' +
    'a church that has never marked a child waiting for ever');
  assert.match(body, /_relayAuthedAt/,
    'the second question is missing: an EOSE from a relay that does not yet know who we are is not an answer');
});
