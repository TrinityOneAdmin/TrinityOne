// THE SAFEGUARDING RECORD, DRIVEN RATHER THAN READ.
// Run: node --test scripts/clearance-record.test.mjs
//
// A church can be asked — by a diocese, an insurer, a parent, or a court — who cleared this person to work
// with young people, and when. The first attempt at this shipped none of the following, and its tests passed
// with the whole mechanism deleted, because they matched NAMES IN THE SOURCE instead of running anything.
// This one runs the real function out of the shipped bundle. Every case below is a defect an audit executed
// against the first version:
//
//   1. A brand-new church could never clear its first volunteer. The write refused itself until the record
//      had loaded, and a church that has never cleared anyone has no record to load. Refusing for ever.
//   2. The remembered record was not tied to a church. One church's records were written into another's,
//      a real record in the second church was destroyed, and a third was re-stamped with today's date.
//   3. An older console republishing the plain list wiped the trail permanently.
//   4. Someone already cleared, with no record, was given today's date — the exact back-dating the console
//      panel promises does not happen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const STEWARD = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');

function grab(src, sig) {
  let at = src.indexOf(sig);
  assert.notEqual(at, -1, sig + ' is gone from the shipped bundle — re-anchor this test, or rebuild');
  if (src.slice(Math.max(0, at - 6), at) === 'async ') at -= 6;
  let depth = 0, q = '';
  for (let i = src.indexOf('{', at); i < src.length; i++) {
    const c = src[i], prev = src[i - 1];
    if (q) { if (c === q && prev !== '\\') q = ''; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i === -1) break; continue; }
    if (c === '{') depth++; else if (c === '}' && --depth === 0) return src.slice(at, i + 1);
  }
  assert.fail('could not find the end of ' + sig);
}

const NOW = 1800000000;

// The shipped setApproved, given a scope that records what it would publish instead of talking to a relay.
function runSetApproved({ pub, trail, pubkeys, listKnown }) {
  const body = grab(STEWARD, 'setApproved(pubkeys, opts)');
  const FINALIZE = (body.match(/\b(finalizeEvent\w*)\s*\(/) || [])[1];
  assert.ok(FINALIZE, 'the shipped function no longer signs an event — re-anchor this test');
  let published = null;
  const scope = {
    _requireTrustedView: () => {},
    sk: new Uint8Array(32),
    pub,
    now: () => NOW,
    _clearedTrail: trail,
    // esbuild renames imported bindings, so bind whatever name the SHIPPED bundle actually uses rather than
    // the one in the source. Discovered from the bundle, not guessed — a guess here fails as "refused".
    [FINALIZE]: (evt) => evt,
    _publishToRelays: (evt) => { published = JSON.parse(evt.content); return Promise.resolve(true); },
    APPROVED_D: 'trinityone/approved:',
    NET: 'trinityone',
  };
  const fn = new Function(...Object.keys(scope), 'return async function ' + body + ';')(...Object.values(scope));
  return Promise.resolve(fn(pubkeys, { listKnown })).then(() => published, (e) => ({ _rejected: String(e && e.message) }));
}

const A = 'a'.repeat(64), B = 'b'.repeat(64), C = 'c'.repeat(64);
const CHURCH1 = '1'.repeat(64), CHURCH2 = '2'.repeat(64);
const EMPTY = { cp: '', map: {}, list: [], loaded: false };

test('a brand-new church can clear its first volunteer', async () => {
  // The whole feature was unusable for every new church: refused, and retrying could never work because the
  // only thing that would create the record was the write being refused.
  const out = await runSetApproved({ pub: CHURCH1, trail: EMPTY, pubkeys: [A], listKnown: true });
  assert.equal(out && out._rejected, undefined, 'the first clearance was refused: ' + (out && out._rejected));
  assert.deepEqual(out.pubkeys, [A], 'the list the relay reads is wrong');
  assert.equal(out.cleared[A].at, NOW, 'the first volunteer got no date, though we knew the list was empty');
});

test('it never refuses, even knowing nothing', async () => {
  // Not knowing must degrade to an honest "no record", never to a block.
  const out = await runSetApproved({ pub: CHURCH1, trail: EMPTY, pubkeys: [A], listKnown: false });
  assert.equal(out && out._rejected, undefined, 'still refuses when the previous list is unknown');
  assert.equal(out.cleared[A].at, 0, 'it invented a date it could not know');
});

test('an existing record keeps its own date', async () => {
  const trail = { cp: CHURCH1, map: { [A]: { by: CHURCH1, at: 111 } }, list: [A], loaded: true };
  const out = await runSetApproved({ pub: CHURCH1, trail, pubkeys: [A, B], listKnown: true });
  assert.equal(out.cleared[A].at, 111, "someone else's clearance was re-stamped with today");
  assert.equal(out.cleared[B].at, NOW, 'the genuinely new person got no date');
});

test('someone already cleared but unrecorded is NOT back-dated to today', async () => {
  // The console panel says in so many words that old clearances are not back-dated.
  const trail = { cp: CHURCH1, map: {}, list: [A], loaded: true };
  const out = await runSetApproved({ pub: CHURCH1, trail, pubkeys: [A, B], listKnown: true });
  assert.equal(out.cleared[A].at, 0, 'an old clearance was given today’s date');
  assert.equal(out.cleared[B].at, NOW, 'the new person was not recorded');
});

test('one church’s records can never be written into another’s', async () => {
  // Executed against the first version: church A's records — note text included — landed in church B's
  // document, a real record of B's was destroyed, and a third person was re-stamped with today.
  const strayed = { cp: CHURCH1, map: { [A]: { by: CHURCH1, at: 111, note: 'DBS 0012345' } }, list: [A, C], loaded: true };
  const out = await runSetApproved({ pub: CHURCH2, trail: strayed, pubkeys: [A, B], listKnown: true });
  assert.equal(out.cleared[A].at, NOW, "another church's clearance date crossed over");
  assert.equal(JSON.stringify(out).includes('DBS 0012345'), false, "another church's note crossed over");
});

test('nothing sensitive is invited into a document members can read', async () => {
  // The relay serves approved: to every member ON PURPOSE, so a child's app knows whom they may message.
  // A certificate number does not belong in it. The field is gone until there is a stewards-only document.
  const out = await runSetApproved({ pub: CHURCH1, trail: EMPTY, pubkeys: [A], listKnown: true });
  assert.equal('note' in out.cleared[A], false, 'the record still carries a free-text note');
  assert.equal(/note:/.test(grab(STEWARD, 'setApproved(pubkeys, opts)')), false,
    'a note can still be written into the member-readable clearance list');
});

// ── the two screens that show it ───────────────────────────────────────────────────────────────────
import { stripComments } from './test-slice.mjs';
const IDENT = stripComments(readFileSync(new URL('../app/identity.jsx', import.meta.url), 'utf8'));
const STEWD = stripComments(readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8'));

test('a volunteer is told they are cleared, without being told a falsehood about who else can see', () => {
  assert.match(IDENT, /cleared you to work with young people/, 'a volunteer still cannot see their own clearance');
  assert.match(IDENT, /clearanceKnown/, 'a cold start would read as a definite no rather than staying quiet');
  // Scoped to the CLEARED banner. The young person's banner beside it says "only you and your church's
  // stewards see this" and that is TRUE for the minors list, which the relay really does keep to stewards —
  // a first draft of this assertion searched the whole file and failed on that correct sentence.
  const i = IDENT.indexOf('cleared you to work with young people');
  const block = IDENT.slice(IDENT.lastIndexOf('{ctx && ctx.safeguard', i), i + 200);
  assert.equal(/Only you and your church.s stewards see this/.test(block), false,
    'it still tells a volunteer their clearance is private when every member can read the list');
  assert.match(block, /Others in your church can see/, 'it does not say who else can see this');
});

test('a failed write does not put a clearance badge on the volunteer’s phone', () => {
  // The first version resealed immediately, so a write that never landed still told the volunteer they were
  // cleared, while the church document said nothing and the relay went on refusing them.
  const i = STEWD.indexOf('const toggleApproved');
  const fn = STEWD.slice(i, STEWD.indexOf('\n  const guardReqs', i));
  // THIS ASSERTION USED TO BE UNFAILABLE. Its second alternative, `then((ok)`, matched whether or not the
  // guard was there, so putting the original defect straight back left all eight tests green — in the very
  // test written to stop me doing that. Assert the guard itself, and nothing that merely resembles it.
  assert.match(fn, /if \(ok !== false\) _reseal\(/,
    'a write that never landed can still put a clearance badge on the volunteer’s phone');
  assert.match(fn, /listKnown/, 'the write is not told whether this console has read the list');
});

const ROOT = stripComments(readFileSync(new URL('../app/steward-root.jsx', import.meta.url), 'utf8'));

test('one church’s cached lists cannot vouch for another church', () => {
  // The console keeps its own copy of every list. It was keyed by a counter that only moves on a church
  // SWITCH — and restoring a key does not move it. So after a restore the screen repainted the previous
  // church's cleared adults, marked as loaded, while the key underneath was a different church; one press of
  // "Clear for youth" then wrote those people into the wrong church's record with today's date, and the relay
  // let them contact children in a church that had never cleared them.
  assert.match(ROOT, /const key = method \+ '\|' \+ idv \+ '\|' \+ _who/,
    'the cached lists are still not tied to the church they came from');
  // The "has this loaded?" helper builds the same key by hand; if it drifts it silently answers no for
  // everything, and its callers use it to decide whether a pending-members list can be trusted.
  const i = ROOT.indexOf('window.stewardStreamLoaded =');
  assert.match(ROOT.slice(i, i + 320), /actingChurch \|\| S0\.churchPub/,
    'the loaded-check no longer builds the same key as the cache it reads');
});

test('the clearance list is asked about ITSELF, not about the list of children', () => {
  // A brand-new church clears its first volunteer before marking any child. Asking the minors document
  // whether we had looked meant the answer was always no, and a clearance granted that minute was written
  // as "no record of when".
  const STEWSRC = stripComments(readFileSync(new URL('../src/steward.src.js', import.meta.url), 'utf8'));
  assert.match(STEWSRC, /const clearedKnown = \(\) => sawApproved \|\| \(sawEose && _isRelayAuthed\(\)\)/,
    'nothing asks whether the CLEARED list itself has been read');
  assert.equal(/listKnown: !!sg\.loaded/.test(STEWD), false,
    'the console still answers from the list of children');
  assert.match(STEWD, /listKnown: !!sg\.clearedKnown/, 'the console does not pass the clearance signal');
});

// ── an older console republishing the plain list must not erase the record ─────────────────────────
// This path had NO executed coverage. It is the one that matters when a church has two stewards and one of
// them has a stale browser tab: the old bundle writes the list with no record attached, and treating that as
// "the record is empty" wiped every clearance date — and the wipe then echoed back as the truth.
function runApprovedHandler(events) {
  const body = grab(STEWARD, 'subscribeSafeguard(onLists)');
  const CP = '1'.repeat(64);
  let out = null;
  const scope = {
    pub: CP,
    pool: { subscribeMany: (_r, _f, h) => { for (const e of events) h.onevent(e); h.oneose(); return { close() {} }; } },
    relays: () => ['wss://x'],
    _byChurch: () => true,
    _authFuture: () => false,
    _isRelayAuthed: () => true,
    _applyNoPhotoList: () => {},
    _clearedTrail: { cp: '', map: {}, list: [], loaded: false },
    MINORS_D: 'trinityone/minors:', APPROVED_D: 'trinityone/approved:',
    NOPHOTO_D: 'trinityone/nophoto:', GUARDIANS_D: 'trinityone/guardians:',
    NET: 'trinityone',
  };
  const names = Object.keys(scope);
  const fn = new Function(...names, 'return ({ ' + body + ' });')(...names.map(n => scope[n]));
  fn.subscribeSafeguard((lists) => { out = lists; });
  return out;
}
const ev = (d, content, at) => ({ tags: [['d', d]], content: JSON.stringify(content), created_at: at, pubkey: '1'.repeat(64) });

test('an older console republishing the plain list does not erase the record', () => {
  const A = 'a'.repeat(64), CP = '1'.repeat(64);
  const modern = ev('trinityone/approved:' + CP, { pubkeys: [A], cleared: { [A]: { by: CP, at: 555 } } }, 100);
  const legacy = ev('trinityone/approved:' + CP, { pubkeys: [A] }, 200);   // no record attached
  const out = runApprovedHandler([modern, legacy]);
  assert.ok(out, 'the handler never reported anything');
  assert.deepEqual(out.approved, [A], 'the list itself was lost');
  assert.equal(out.cleared[A] && out.cleared[A].at, 555,
    'a write from an older console erased the clearance date');
});

test('the clearance list being absent is only trusted when the relay actually answered', () => {
  // EOSE alone is not evidence — it also fires on a client timeout and on a dropped socket. Believing it then
  // would stamp today's date onto people cleared years ago.
  const out = runApprovedHandler([]);
  assert.equal(out.clearedKnown, true, 'an authenticated relay saying "that is everything" was not believed');
});
