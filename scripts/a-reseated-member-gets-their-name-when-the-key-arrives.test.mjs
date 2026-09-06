// THE NAME A CHURCH VOUCHES ACROSS A KEY CHANGE MUST SURVIVE ARRIVING BEFORE THE KEY THAT OPENS IT.
// Run: node --test scripts/a-reseated-member-gets-their-name-when-the-key-arrives.test.mjs
//
// A REGRESSION INTRODUCED BY THE SEALING WORK ITSELF (192da7a), found by the audit of it.
//
// `reseat:` carries a member's display name across a key change. It is the route for somebody who lost
// their 12 words — including a child whose guardian link depends on being recognisable — and losing the
// name here was already a CRITICAL once (AUDIT-2026-07-26 #3).
//
// Sealing that name under the church name key created an ordering problem the cleartext version could not
// have. _noteReseat opens the name ONCE, when the document arrives, and gives up if the key is not held.
// On the phone that matters most — a brand-new install, which is what "I lost my 12 words" means — the
// document ALWAYS arrives first: the console publishes the vouch before setAdmitted, and the new key only
// becomes a name-key recipient after admission echoes back and the enrolment effect re-runs. So the member
// sat unnamed for ever on the one path whose whole purpose is giving them their name back.
//
// Fixed by replaying buffered reseat documents when the key lands (_replayReseats), and by ingesting the key
// before replaying them on a cold boot — which the comment there already claimed was the order.
//
// THE ASSERTION THAT MATTERS is that re-feeding the SAME document works the second time. _noteReseat drops
// anything not newer than _reseatAt, so a replay that the guard swallowed would look exactly like a fix.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { v2 as nip44v2 } from 'nostr-tools/nip44';
import { fnBody, stripComments } from './test-slice.mjs';

const SRC    = readFileSync(new URL('../src/fellowship.src.js', import.meta.url), 'utf8');
const VENDOR = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');

const CP   = 'cc'.repeat(32);
const KEY  = new Uint8Array(32).fill(7);
const MINE = 'dd'.repeat(32);
const NAME = 'Maria Okafor';

function rig({ keyHeld, withReplay = false }) {
  const adopted = [];
  const nameKeys = new Map();
  if (keyHeld) nameKeys.set(CP, [KEY]);
  const scope = {
    _nameKeys: nameKeys,
    nip44d: (ct, k) => nip44v2.decrypt(ct, k),
    _reseatAt: new Map(), _reseatOld: new Map(), _reseatNew: new Map(), _reseatNamed: new Set(),
    RESEAT_D: 'trinityone/reseat:',
    _dtag: (e) => (e.tags.find(t => t[0] === 'd') || [])[1] || '',
    _churchRoster: new Map(),
    _reseatMap: new Map(), _returnAnnounced: new Map(),
    pub: MINE,
    profiles: {},
    // The adoption is DEFERRED (setTimeout 0) and goes through window.Fellowship.setProfile, not a bare
    // local — _noteReseat runs inside the docs hub's onevent, where a throw is logged and swallowed.
    // A rig that captured the wrong function would see zero adoptions and read exactly like the bug.
    window: { Fellowship: { myProfile: null, setProfile: (p) => { adopted.push(p); return Promise.resolve(true); } }, dispatchEvent: () => {} },
    setTimeout, console,
  };
  const body = stripComments(fnBody(SRC, 'function _openChurchDoc(cp, content)', '_openChurchDoc'))
    + '\n' + stripComments(fnBody(SRC, 'function _noteReseat(cp, e)', '_noteReseat'))
    + (withReplay ? '\n' + stripComments(fnBody(SRC, 'function _replayReseats(cp, hub)', '_replayReseats')) : '');
  const names = Object.keys(scope);
  const out = new Function(...names, body + '\nreturn { _noteReseat' + (withReplay ? ', _replayReseats' : '') + ' };')(...names.map(n => scope[n]));
  return { noteReseat: out._noteReseat, replayReseats: out._replayReseats, adopted, giveKey: () => nameKeys.set(CP, [KEY]) };
}

const sealedDoc = (at) => ({
  pubkey: CP, created_at: at,
  content: JSON.stringify({ pairs: [{ old: 'aa'.repeat(32), new: MINE, at, n: nip44v2.encrypt(JSON.stringify({ name: NAME }), KEY) }] }),
});

const tick = () => new Promise(r => setTimeout(r, 0));

test('with the key held, a re-seated member takes the vouched name', async () => {
  const r = rig({ keyHeld: true });
  r.noteReseat(CP, sealedDoc(1788500000));
  await tick();
  assert.equal(r.adopted.length, 1, 'the vouched name was not adopted even with the key present');
  assert.equal(r.adopted[0].name, NAME);
});

test('the document arriving BEFORE the key adopts nothing — and then does, on replay', async () => {
  const r = rig({ keyHeld: false });
  const doc = sealedDoc(1788500000);

  r.noteReseat(CP, doc);
  await tick();
  assert.equal(r.adopted.length, 0, 'a name was adopted from a document that could not be opened');

  // The key lands. _replayReseats re-feeds the SAME buffered document.
  r.giveKey();
  r.noteReseat(CP, doc);
  await tick();
  assert.equal(r.adopted.length, 1,
    'THE DEFECT: re-feeding the reseat document after the key arrived adopted nothing. _reseatAt swallowed ' +
    'the replay, so the member stays "Anonymous …" for ever on the one route that exists to give them ' +
    'their name back.');
  assert.equal(r.adopted[0].name, NAME);
});

test('a document written before sealing still works, with or without a key', async () => {
  const plain = { pubkey: CP, created_at: 1788500000,
    content: JSON.stringify({ pairs: [{ old: 'aa'.repeat(32), new: MINE, at: 1788500000, name: NAME }] }) };
  for (const keyHeld of [true, false]) {
    const r = rig({ keyHeld });
    r.noteReseat(CP, plain);
    await tick();
    assert.equal(r.adopted.length, 1, `a pre-sealing reseat stopped working (keyHeld=${keyHeld}) — every one already on a relay`);
    assert.equal(r.adopted[0].name, NAME);
  }
});

test('the replay is wired into every path where the key can arrive', () => {
  // src/, not app/, so dead code would be stripped from the bundle rather than left readable — this is a
  // wiring claim; the behaviour claims are the executed tests above.
  // ENUMERATE EVERY CALL SITE, not the ones that happen to match a shape. The first version of this test
  // anchored on `_ingestNameKey(...); _replaySealedNames` — and the LIVE arrival branch inlines its name
  // loop instead of calling _replaySealedNames, so the regex never looked at it. That is the one path the
  // whole fix existed for: four call sites, three wired, and a test that could only see the three.
  // COLLAPSE THE WHITESPACE FIRST. stripComments pads comments with spaces rather than deleting them, so a
  // window measured in characters over the stripped text is mostly blanks — this bit me twice before and
  // once more writing this very assertion. And skip the DEFINITION: `function _ingestNameKey(` is not a
  // call site, and counting it made the test demand a replay inside the function itself.
  const clean = stripComments(SRC).replace(/\s+/g, ' ');
  const sites = [...clean.matchAll(/_ingestNameKey\(/g)].filter(m => !clean.slice(Math.max(0, m.index - 10), m.index).includes('function '));
  assert.ok(sites.length >= 4, `only ${sites.length} _ingestNameKey call sites found — re-anchor rather than lowering this`);
  for (const m of sites) {
    const after = clean.slice(m.index, m.index + 700);
    assert.match(after, /_replayReseats\(/,
      'a path that ingests the church name key does not replay the re-seats. A member whose vouched name ' +
      'arrived before the key stays "Anonymous …" until the app is restarted — and the live arrival is ' +
      'exactly the path a newly admitted member takes.');
  }
  assert.match(stripComments(VENDOR), /_replayReseats/, 'the shipped bundle predates this fix — rebuild');
});

test('on a cold boot the key is ingested before the re-seats are replayed', () => {
  // The two lines used to run the other way round, so the vouched name was opened before the key that opens
  // it. Comments are stripped first: an ordering check satisfied by the comment explaining the rule is one
  // this repo has shipped a safeguarding bug through before.
  // SCOPED TO _docsHub. A plain search found the identical line inside _replayReseats itself, which is
  // defined further up the file, and reported the order backwards — the sibling-match trap this codebase
  // warns about, hit while writing the test for it.
  const clean = stripComments(fnBody(SRC, 'function _docsHub(cp)', '_docsHub')).replace(/\s+/g, ' ');
  const key = clean.indexOf("_ingestNameKey(cp, e); } _replayChurchCalendar(cp, hub);");
  const res = clean.indexOf("_replayReseats(cp, hub);");
  assert.ok(key !== -1 && res !== -1, 're-anchor: the cold-boot hydration has changed shape');
  assert.ok(key < res,
    'the cold-boot path replays re-seats BEFORE ingesting the church name key, so a sealed vouched name is ' +
    'opened before the key that opens it and is lost');
});

test('_replayReseats itself does the work — not just the call sites', async () => {
  // THE GAP THE THIRD AUDIT FOUND IN THIS FILE. Gutting _replayReseats to `return;` while leaving both call
  // sites in place left every test above green: the mechanism tests call _noteReseat directly, and the
  // wiring test only greps for the call. So the fix was proven at the function it did not need to change
  // and nowhere at the function it added. This runs the real helper against a real buffer.
  const r = rig({ keyHeld: false, withReplay: true });
  const doc = { ...sealedDoc(1788500000), tags: [['d', 'trinityone/reseat:' + CP]] };
  const hub = { buf: new Map([['k', doc]]) };

  r.noteReseat(CP, doc);          // arrives before the key
  await tick();
  assert.equal(r.adopted.length, 0);

  r.giveKey();
  r.replayReseats(CP, hub);       // the helper, not a hand-rolled loop
  await tick();
  assert.equal(r.adopted.length, 1,
    'THE DEFECT: _replayReseats ran and adopted nothing. Every call site can be correct and the member ' +
    'still stays "Anonymous …" — the call sites are wired to a function that does nothing.');
  assert.equal(r.adopted[0].name, NAME);
});
