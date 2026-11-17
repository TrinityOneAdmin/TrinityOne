// THE CONSOLE PUTS ON THE PUBLIC FEED ONLY THE VERSE PROMPT A MEMBER'S PHONE WOULD ACCEPT AS THE CHURCH'S.
//   Run: node --test scripts/the-public-verse-prompt-is-only-the-churchs-own.test.mjs
//
// AUDIT-phone-widget-c60c0f72-2026-11-16 F2. The owner console mirrors the church's verse prompt into the public,
// refs-only copy every member's home-screen widget shows as "Your church is reading". It used to take ANY author's prompt,
// newest first. Members read the prompt through subscribeChurchVersePrompt (src/fellowship.src.js), which trusts only
// _churchVoice — the church key or a steward STILL on the signed roster — newest wins, and an exact same-second tie
// goes to the LOWEST event id. A former steward's newer prompt (or one from a skewed clock) was therefore published
// to every widget while the in-app card refused it.
//
// The shipped functions are lifted out of vendor/steward.js (bundle names) and driven with real event shapes; the
// writer is a recording publish(). What is asserted is the BODY the console would put on the public feed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';

const BUNDLE = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const CHURCH = 'c'.repeat(64), STEWARD = 'a'.repeat(64), FORMER = 'f'.repeat(64);
const VP = 'trinityone/verse-prompt', PV = 'trinityone/pubverse:';
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

function one(decl) {
  const i = BUNDLE.indexOf(decl);
  assert.ok(i >= 0, decl + ' is not in vendor/steward.js — re-anchor');
  assert.equal(BUNDLE.indexOf(decl, i + 1), -1, decl + ' appears twice — ambiguous');
  return fnBody(BUNDLE, i, decl);
}
function mirror({ roster = [STEWARD], rosterKnown = true } = {}) {
  const w = { pub: CHURCH, share: { versePrompt: true }, shareKnown: true, copiesKnown: true, vprompts: new Map(),
    vcopy: null, vcopyTs: 0, vbusy: false, vfail: null };
  const written = [];
  const scope = {
    VERSE_PROMPT_D: VP, PUBVERSE_D: PV, NET: 'trinityone', pub: CHURCH, sk: 'sk', actingChurch: null,
    _careRosterKnown: rosterKnown, _careRoster: new Set(roster), _web: w,
    _webQueueSync: () => {}, now: () => 1790000000, feChurch: (t) => t,
    publish: async (evt) => { written.push(evt); return true; },
  };
  const src = [one('function _publicVerseBody('), one('function _webVerseNote('), one('function _webVersePrompt('), one('async function _webVerseMirror(')].join('\n');
  const api = new Function(...Object.keys(scope), src + '\nreturn { _webVerseNote, _webVerseMirror };')(...Object.values(scope));
  const note = (by, ts, ref, id) => api._webVerseNote(w, { pubkey: by, created_at: ts, id: id || (by.slice(0, 2) + ts), tags: [['d', VP]], content: JSON.stringify({ ref, note: 'n', schedule: [] }) }, VP);
  const run = async () => { await api._webVerseMirror(w); await settle(); const last = written[written.length - 1]; return last && last.content ? JSON.parse(last.content).ref : null; };
  return { note, run, written };
}

test('CONTROL: the church\'s own prompt is mirrored', async () => {
  const m = mirror();
  m.note(CHURCH, 100, 'John 3:16');
  assert.equal(await m.run(), 'John 3:16');
});

test('a FORMER steward\'s NEWER prompt is NOT put on the public feed — members would refuse it', async () => {
  const m = mirror({ roster: [STEWARD] });
  m.note(CHURCH, 100, 'John 3:16');
  m.note(FORMER, 200, 'FORMER 9:9');
  assert.equal(await m.run(), 'John 3:16', 'the public copy carries a prompt from someone no longer on the roster');
});

test('a CURRENT steward\'s newer prompt is mirrored (the same rule members apply)', async () => {
  const m = mirror({ roster: [STEWARD] });
  m.note(CHURCH, 100, 'John 3:16');
  m.note(STEWARD, 200, 'Psalms 23:1');
  assert.equal(await m.run(), 'Psalms 23:1');
});

test('before the roster is known only the church\'s own copy counts (never publish what members may refuse)', async () => {
  const m = mirror({ roster: [], rosterKnown: false });
  m.note(CHURCH, 100, 'John 3:16');
  m.note(STEWARD, 200, 'Psalms 23:1');
  assert.equal(await m.run(), 'John 3:16');
});

test('an exact same-second tie goes to the LOWEST event id, whichever arrived last — as members break it', async () => {
  const m = mirror({ roster: [STEWARD] });
  m.note(STEWARD, 300, 'HIGHER 1:1', 'ff00');
  m.note(CHURCH, 300, 'LOWER 1:1', '0a00');
  assert.equal(await m.run(), 'LOWER 1:1');
  const n = mirror({ roster: [STEWARD] });
  n.note(CHURCH, 300, 'LOWER 1:1', '0a00');
  n.note(STEWARD, 300, 'HIGHER 1:1', 'ff00');
  assert.equal(await n.run(), 'LOWER 1:1', 'the later-arriving copy won a same-second tie');
});
