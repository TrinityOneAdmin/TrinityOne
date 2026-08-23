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
  assert.match(fn, /ok !== false.*_reseal|then\(\(ok\)/s, 'the member is told before the church document says so');
  assert.match(fn, /listKnown/, 'the write is not told whether this console has read the list');
});
