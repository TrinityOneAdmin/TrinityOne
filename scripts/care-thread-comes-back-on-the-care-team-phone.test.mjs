// A CARE THREAD DOES NOT VANISH FROM A CARE-TEAM PHONE WHEN HELP IS SET UP (sim item 24, the phone's half).
//   Run: node --test scripts/care-thread-comes-back-on-the-care-team-phone.test.mjs
//
// THE DEFECT: 2249380 fixed the console. A care-team PHONE has its own copy of the same list — CareRequests in
// app/screens-today.jsx, fed by Fellowship.subscribeCareRequests — and it still showed a request only while its
// status was 'open'. "Set up help" (or Close) writes a status, the request left the phone's list, and with it
// went the only Message button the thread had. The person could go on writing; nobody holding a phone saw it.
//
// WHO IS "THE ASKER" HERE. Not the phone's owner. The phone this list is on belongs to a care admin or a cleared
// adult; the asker is the other person, the request's author. (The ASKER's own phone draws MyRequestRow, which has a
// Message button at every status. It is not changed here; the last test only pins that it stays a door.)
//
// FOUR LAYERS, EACH RUN RATHER THAN READ (CLAUDE.md rules 1 and 3 — nothing here matches text in app/*.jsx):
//   1. the rule — careThreadAttention — is covered by scripts/care-thread-comes-back-when-they-write-again.test.mjs
//      and is the SAME function; here it is only LIFTED from the phone's bundle to prove it is the one in use;
//   2. the engine — _openCareRequests LIFTED OUT OF vendor/fellowship.js (the bundle the phone loads), fed events;
//   3. the list — CareRequests compiled from app/screens-today.jsx and DRAWN, CareRequestCard inside it;
//   4. the asker's own row — MyRequestRow, DRAWN at a set-up status.
//
// USERS OF WHAT CHANGED, enumerated:
//   · Fellowship._openCareRequests (src/fellowship.src.js) is reached only through Fellowship.subscribeCareRequests,
//     which has THREE callers: CareRequests (care-team list, app/screens-today.jsx), AskForHelp's `mine` list (the
//     asker's own rows, same file) and nothing else in app/ — grep subscribeCareRequests app/*.jsx. The new field
//     `newMessage` is additive; only CareRequests reads it. `status` and `needId` are unchanged for all three.
//   · CareRequestCard has ONE caller, CareRequests. Its new prop `onSeen` is passed only there.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fnBody } from './test-slice.mjs';
import { loadScreen, miniReact, texts, find, button, reads } from './render-jsx-screen.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const VENDOR = readFileSync(join(ROOT, 'vendor/fellowship.js'), 'utf8');

const CHURCH = 'c'.repeat(64), ASKER = 'a'.repeat(64), STRANGER = 'e'.repeat(64), ME = 'm'.repeat(64), KID = 'k'.repeat(64);
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

// ── 2. THE ENGINE, lifted from the phone's bundle ────────────────────────────────────────────────────────
function engine() {
  const subs = [];
  const stubs = {
    pool: { subscribeMany: (relays, filters, handlers) => { subs.push({ filters, handlers }); return { close() {} }; } },
    churchRelays: () => ['wss://relay.example'],
    // A sealed body is `{ ok, body }`: openable when ok. Stands in for NIP-44 — it decides nothing about who
    // wrote a message or when; those come from the event's own pubkey and created_at.
    _openSealed: (o) => { if (!o || !o.ok) throw new Error('cannot open'); return o.body; },
    pub: ME, sk: new Uint8Array(32), decrypt: () => '', getConversationKey: () => new Uint8Array(32), _unhex: () => new Uint8Array(0),
    CAREREQ_D: 'trinityone/carereq:', CAREREQSTATUS_D: 'trinityone/carereqstatus:', CARECHAT_D: 'trinityone/carechat:',
  };
  const scope = new Proxy(stubs, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k];
      throw new ReferenceError('the lifted _openCareRequests needs `' + String(k) + '` — add a stub'); },
  });
  // The rule is lifted from the SAME bundle, by the name esbuild gave it there — so this fails if the phone stops
  // calling the shared rule, and cannot pass on a mirror.
  const rule = fnBody(VENDOR, 'function careThreadAttention(', 'careThreadAttention');
  const sub = fnBody(VENDOR, '_openCareRequests(cb, forChurch) {', '_openCareRequests');
  const open = new Function('scope', `with (scope) { ${rule}\n return ({ ${sub} }); }`)(scope)._openCareRequests;
  let latest = null, calls = 0;
  const stop = open((list) => { latest = list; calls++; }, CHURCH);
  const h = subs[subs.length - 1];
  assert.ok(h, 'the lifted subscription never reached pool.subscribeMany — nothing below is exercised');
  const ev = (d, pubkey, created_at, content, extra = []) => ({ id: d + created_at, pubkey, created_at, kind: 30078, tags: [['d', d], ...extra], content: JSON.stringify(content) });
  return {
    filters: h.filters,
    request: (id = 'r1', at = 1000) => h.handlers.onevent(ev('trinityone/carereq:' + id, ASKER, at, { keys: {}, enc: '' })),
    status: (status, at, id = 'r1', needId = 'n1') => h.handlers.onevent(ev('trinityone/carereqstatus:' + id, CHURCH, at, { status, needId })),
    chat: (from, at, msgId, { openable = true, id = 'r1' } = {}) => h.handlers.onevent(ev('trinityone/carechat:' + id + ':' + msgId, from, at, { ok: openable, body: { text: 'hello', at } })),
    row: (id = 'r1') => (latest || []).find(r => r.id === id),
    emits: () => calls,
    stop,
  };
}

test('ENGINE: the phone’s subscription listens for care-chat messages as well as requests', () => {
  const e = engine();
  assert.ok(e.filters.some(f => (f['#t'] || []).includes('carechat')),
    'the phone never subscribes to the thread, so it cannot know the person wrote again. Filters: ' + JSON.stringify(e.filters));
  assert.ok(e.filters.some(f => (f['#t'] || []).includes('carereq') && (f['#t'] || []).includes('carereqstatus')), 're-anchor: the request filter is gone');
  assert.ok(e.filters.every(f => (f['#church'] || [])[0] === CHURCH), 'a filter is not scoped to this church');
});

test('ENGINE: a request set up and then written to again comes back (newMessage), and keeps its need', () => {
  const e = engine();
  e.request(); e.status('approved', 2000);
  assert.equal(e.row().status, 'approved', 're-anchor: the status did not apply');
  assert.equal(e.row().newMessage, false, 'a set-up request with no new message was flagged');
  e.chat(ASKER, 3000, 'm1');
  assert.equal(e.row().newMessage, true, 'THE ASKER WROTE AFTER "SET UP HELP" AND THE PHONE DID NOT NOTICE — the sim finding');
  assert.equal(e.row().needId, 'n1', 'the need it was set up as is lost');
});

test('ENGINE: …and a team reply after that takes it off again; they write once more and it returns', () => {
  const e = engine();
  e.request(); e.status('approved', 2000); e.chat(ASKER, 3000, 'm1');
  assert.equal(e.row().newMessage, true);
  e.chat(CHURCH, 4000, 'm2');
  assert.equal(e.row().newMessage, false, 'a team member replied and the same row stayed on the list');
  e.chat(ASKER, 5000, 'm3');
  assert.equal(e.row().newMessage, true, 'they wrote again after the reply and it did not come back');
});

test('ENGINE: a CLOSED request comes back too, and keeps the closed status', () => {
  const e = engine();
  e.request(); e.status('declined', 2000); e.chat(ASKER, 2500, 'm1');
  assert.equal(e.row().status, 'declined');
  assert.equal(e.row().newMessage, true, 'a closed request the person wrote to again did not come back');
});

test('ENGINE: re-writing the status ("seen") takes it off until they write again', () => {
  const e = engine();
  e.request(); e.status('approved', 2000); e.chat(ASKER, 3000, 'm1');
  e.status('approved', 3500);
  assert.equal(e.row().newMessage, false, 'marking it seen left it on the list');
  e.chat(ASKER, 4000, 'm2');
  assert.equal(e.row().newMessage, true);
});

test('ENGINE: only a message this phone can OPEN counts, and only the ASKER’s own makes it come back', () => {
  const e = engine();
  e.request(); e.status('approved', 2000);
  e.chat(ASKER, 3000, 'm1', { openable: false });
  assert.equal(e.row().newMessage, false, 'a message the phone cannot open made the request look unanswered');
  e.chat(STRANGER, 3100, 'm2');
  assert.equal(e.row().newMessage, false, 'somebody who is not the asker made the request come back');
});

test('ENGINE: the order events arrive in does not matter, and one request’s thread never counts for another', () => {
  const e = engine();
  e.chat(ASKER, 3000, 'm1'); e.status('approved', 2000); e.request();
  assert.equal(e.row().newMessage, true, 'a thread message that arrived BEFORE its request was lost');
  e.request('r2'); e.status('approved', 2000, 'r2');
  assert.equal(e.row('r2').newMessage, false, 'r1’s thread message came back r2');
});

test('ENGINE: an ordinary OPEN request is untouched', () => {
  const e = engine();
  e.request();
  assert.equal(e.row().status, 'open');
  assert.equal(e.row().newMessage, false, 'an open request is already listed; it must not also claim to have returned');
});

// ── 3. THE LIST ──────────────────────────────────────────────────────────────────────────────────────────
const REQ = (over) => ({ id: 'r1', from: ASKER, forSelf: true, type: 'meals', note: 'a lift please', status: 'open', needId: '', newMessage: false, ...over });
const Stub = (n) => function S(p) { return { type: n, props: p, kids: [] }; };

function list(initial, { minors = [], minorsKnown = true, seenResult = { id: 'e' } } = {}) {
  const { React, draw } = miniReact();
  const calls = { seen: [], decline: [], emit: null };
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
    todayISO: () => '2026-10-03',
    fetch: async () => ({ ok: false, json: async () => ({}) }),
    window: {
      addEventListener() {}, removeEventListener() {}, innerWidth: 360,
      Fellowship: {
        myPubkey: ME,
        subscribeCareRequests: (cb) => { calls.emit = cb; cb(initial); return () => {}; },
        declineCareRequest: async (r) => { calls.decline.push(r.id); return { id: 'e' }; },
        setCareRequestStatus: async (...a) => { calls.seen.push(a); return seenResult; },
        subscribeCareChat: (id, cb) => { cb([]); return () => {}; },
        sendCareChat: async () => ({ id: 'x' }),
        childCareAudience: async () => [],
      },
      TrinityData: { NOTIFICATIONS: [], PLANS: [], VOTD_POOL: [] },
      Bible: { parseRef: () => null, loaded: false, books: () => [], getVerses: () => [], maxChapter: () => 1, activeVersion: 'WEB', refLabel: () => '', defaultLoc: () => ({ book: 43, chap: 1 }) },
    },
  };
  const { CareRequests } = loadScreen('app/screens-today.jsx', ['CareRequests'], globals);
  // The screen works out "am I a care admin?" itself, from the rota — so hand it a real one.
  const ctx = {
    church: { npub: 'npub1church' },
    safeguard: { minors, approved: [ME], guardians: {}, isMinor: false, cleared: true, minorsKnown },
    churchRosters: [{ team: 'care-team', people: [{ pub: ME }] }],
    canDMPeer: () => true, toast() {},
    care: { myPub: ME, settings: { enabled: true, adminGroupId: 'care-team' } },
  };
  const redraw = () => draw(CareRequests, { ctx });
  redraw();                       // the list arrives through an effect, so the first draw is empty — as on a real phone
  return { tree: redraw(), redraw, calls };
}
const words = (tree) => reads(tree);

test('LIST: a set-up request the person wrote to again is listed, with Message and "Seen", WITHOUT "Set up help" or "Close"', () => {
  const p = list([REQ({ status: 'approved', needId: 'n1', newMessage: true })]);
  assert.match(words(p.tree), /Wrote again — help is already set up/,
    'the returned request is not on the phone’s list — the care admin has no door to the thread. Drew: ' + words(p.tree).slice(0, 400));
  assert.equal(button(p.tree, 'Message').length, 1, 'no Message button on the returned request');
  assert.equal(button(p.tree, 'Set up help').length, 0, 'a request that already has its need was offered "Set up help" a second time');
  assert.equal(button(p.tree, 'Close — not needed').length, 0, 'a returned thread offers a "close" that would tell the asker help was cancelled');
  assert.equal(button(p.tree, 'Seen — no reply needed').length, 1, 'no way to clear it without replying');
});

test('LIST: a CLOSED request that returns may be set up after all', () => {
  const p = list([REQ({ status: 'declined', newMessage: true })]);
  assert.match(words(p.tree), /Wrote again — you had closed this request/);
  assert.equal(button(p.tree, 'Set up help').length, 1, 'a closed request that came back cannot be set up');
  assert.equal(button(p.tree, 'Message').length, 1);
  assert.equal(button(p.tree, 'Close — not needed').length, 0);
});

test('LIST: a set-up request with NOTHING new is not listed (the list does not fill with finished work)', () => {
  const p = list([REQ({ status: 'approved', needId: 'n1', newMessage: false }), REQ({ id: 'r2', status: 'declined', newMessage: false })]);
  assert.equal(button(p.tree, 'Message').length, 0, 'finished work is listed');
  assert.doesNotMatch(words(p.tree), /Wrote again|REQUESTS FOR HELP/);
});

test('LIST: an OPEN request is exactly as before — Set up help, Message, Close', async () => {
  const p = list([REQ()]);
  assert.match(words(p.tree), /Asked for help/);
  assert.equal(button(p.tree, 'Set up help').length, 1);
  assert.equal(button(p.tree, 'Message').length, 1);
  assert.equal(button(p.tree, 'Seen — no reply needed').length, 0, 'an open request offers "Seen", which would write a status over a request nobody has dealt with');
  const close = button(p.tree, 'Close — not needed');
  assert.equal(close.length, 1);
  close[0].props.onClick(); await flush();
  assert.deepEqual(p.calls.decline, ['r1'], 'Close no longer closes the request');
  assert.deepEqual(p.calls.seen, [], 'Close wrote a status itself');
});

test('LIST: "Seen" re-writes the SAME status and need — it must not close the request', async () => {
  const p = list([REQ({ status: 'approved', needId: 'n1', newMessage: true })]);
  button(p.tree, 'Seen — no reply needed')[0].props.onClick(); await flush();
  assert.deepEqual(p.calls.seen, [['r1', ASKER, { status: 'approved', needId: 'n1' }]],
    'Seen did not re-write the request’s own status. Calls: ' + JSON.stringify(p.calls.seen));
  assert.deepEqual(p.calls.decline, [], 'Seen CLOSED the request — the asker would be told help was cancelled');
});

test('LIST: a "Seen" that did not land says so, and the row stays', async () => {
  const p = list([REQ({ status: 'approved', needId: 'n1', newMessage: true })], { seenResult: null });
  button(p.tree, 'Seen — no reply needed')[0].props.onClick(); await flush();
  const t = p.redraw();
  assert.match(words(t), /didn’t reach the church — it will stay on your list/, 'a refused "Seen" is silent. Drew: ' + words(t).slice(0, 500));
  assert.equal(button(t, 'Message').length, 1, 'the row left although nothing was written');
});

test('LIST: a returned request I WROTE myself is not put back on my own list; somebody else’s is', () => {
  const mine = list([REQ({ from: ME, forSelf: false, forName: 'Mrs Okafor', status: 'approved', needId: 'n1', newMessage: true })]);
  assert.equal(button(mine.tree, 'Message').length, 0, 'the care admin is shown her own follow-ups as if someone else had written');
  const theirs = list([REQ({ from: ASKER, status: 'approved', needId: 'n1', newMessage: true })]);
  assert.equal(button(theirs.tree, 'Message').length, 1, 're-anchor: another member’s returned request disappeared too');
  const open = list([REQ({ from: ME, forSelf: false, forName: 'Mrs Okafor' })]);
  assert.equal(button(open.tree, 'Set up help').length, 1, 're-anchor: a request I filed for someone else is no longer listed while open');
});

test('LIST: a returned CHILD’s request offers Message and Seen, and never "Set up help"', () => {
  const p = list([REQ({ from: KID, status: 'declined', newMessage: true })], { minors: [KID] });
  assert.equal(button(p.tree, 'Message').length, 1, 'a young person who wrote again has no door');
  assert.equal(button(p.tree, 'Set up help').length, 0, 'a child’s returned thread was offered the button that publishes a need to the whole church');
  assert.equal(button(p.tree, 'Seen — no reply needed').length, 1);
  assert.match(words(p.tree), /FROM A YOUNG PERSON/, 're-anchor: a child’s request is no longer filed under the confidential heading');
});

test('LIST: the conversation the admin is typing in outlives the row — replying must not close it', () => {
  const p = list([REQ({ status: 'approved', needId: 'n1', newMessage: true })]);
  button(p.tree, 'Message')[0].props.onClick();
  let t = p.redraw();
  assert.ok(texts(t).includes('Care conversation'), 're-anchor: Message did not open the conversation');
  p.calls.emit([REQ({ status: 'approved', needId: 'n1', newMessage: false })]);   // the reply lands, the row leaves the list…
  t = p.redraw();
  assert.ok(texts(t).includes('Care conversation'),
    'THE CONVERSATION VANISHED WHEN ITS ROW DID. A care admin who replies to a returned thread loses the window ' +
    'mid-conversation, because the list returned nothing once it was empty');
  assert.equal(button(t, 'Message').length, 0, 'the answered row is still listed');
});

// ── 4. THE ASKER'S OWN ROW — untouched, and still a door at every status ─────────────────────────────────
test('ASKER: the person who asked still has a Message button on a request that was set up', () => {
  const { React, draw } = miniReact();
  const globals = {
    React, console, setTimeout, clearTimeout, setInterval, clearInterval,
    Icon: ({ name }) => React.createElement('i', { 'data-icon': name }),
    ChurchBadge: Stub('ChurchBadge'),
    document: { addEventListener() {}, removeEventListener() {}, querySelector: () => null },
    navigator: { userAgent: '' }, location: { search: '', hostname: 'x' },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    lsGet: (k, d) => d, lsSet: () => {}, cx: (...a) => a.filter(Boolean).join(' '),
    SectionLabel: Stub('SectionLabel'), Halo: Stub('Halo'), Sheet: Stub('Sheet'), IconBtn: Stub('IconBtn'),
    useTrinityAudio: () => ({ track: null, playing: false }), todayISO: () => '2026-10-03',
    fetch: async () => ({ ok: false, json: async () => ({}) }),
    window: { addEventListener() {}, removeEventListener() {}, innerWidth: 360, Fellowship: { myPubkey: ME },
      TrinityData: { NOTIFICATIONS: [], PLANS: [], VOTD_POOL: [] },
      Bible: { parseRef: () => null, loaded: false, books: () => [], getVerses: () => [], maxChapter: () => 1, activeVersion: 'WEB', refLabel: () => '', defaultLoc: () => ({ book: 43, chap: 1 }) } },
  };
  const { MyRequestRow } = loadScreen('app/screens-today.jsx', ['MyRequestRow'], globals);
  for (const status of ['approved', 'declined']) {
    const tree = draw(MyRequestRow, { r: REQ({ from: ME, status }), isMinor: false, onCancel() {}, onMessage() {} });
    assert.equal(button(tree, 'Message').length, 1, 'the asker lost the door to their own thread at status ' + status);
  }
});
