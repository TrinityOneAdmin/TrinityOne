// A NEW CHURCH'S CONSOLE SIGNS IN WITHOUT WAITING TO BE ASKED.
//   Run: node --test scripts/a-new-church-signs-in-on-its-own.test.mjs
//
// THE DEFECT (measured 2026-10-02, main at d73d8fb). The relay challenges lazily (NIP-42): only a REQ that names
// invite-only content, or matches something it would withhold, gets an AUTH frame. A brand-new church has nothing
// private yet, so the console is never challenged, never signs in, and every key gate in it (_isRelayAuthed,
// _keyReadAuthedOn) stays shut. Church made through the real screens on a fresh relay, no reload, no tab opened:
// 53 s on the Overview with no AUTH challenge; a service and a rota refused after their 4 s wait; "Still
// connecting to your church" on a care need. It cured itself only when the steward opened a tab whose reads
// happened to match something private.
//
// THE FIX under test is the console's: a moment after a socket to one of the church's relays is up, a socket
// that has not been asked to sign in sends the one filter every relay answers with an AUTH frame
// (`#d: safetycheck:<church>`) — _loginSoon / _loginCheck in src/steward.src.js.
//
// THE POINT OF USE (CLAUDE.md rule 1). A real gateway on a FREE port, the real console in headless chromium, a
// church made through the real screens and left on the Overview — nothing private exists (no member, no room, no
// key) and no tab is opened, which is exactly the state in which nothing else provokes a challenge. The test reads
// the console's own frames (CDP) and its own answer to relayAuthed(). Rule 3: nothing here matches text in app/*.jsx.
//
// WHAT EACH ROW WOULD CATCH
//   · _loginSoon deleted from the socket door (src/steward.src.js)  → the console is never challenged; red.
// The relay needs no change for this: it works against every relay that already challenges a REQ for the
// safety-check document.
//
// Skips itself when chromium is unavailable, like scripts/app-boots.test.mjs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { CHROME, openNewChurch } from './new-church-session.mjs';

let s;
before(async () => { if (!CHROME) return; s = await openNewChurch({ wizard: 'skip', name: 'signin' }); });
after(() => { try { s && s.close(); } catch {} });
const SKIP = !CHROME ? 'no chromium' : false;

test('a church with nothing private yet: the console is signed in on the Overview, without a tab opened', { skip: SKIP, timeout: 120000 }, async () => {
  // precondition, so the row below proves something: nothing private exists that an ordinary read could match
  const priv = s.rows(`kind = 30078 AND (dtag LIKE 'trinityone/member:%' OR dtag LIKE 'trinityone/group:%' OR dtag LIKE 'trinityone/groupkey:%' OR dtag LIKE 'trinityone/carekey:%' OR dtag LIKE 'trinityone/namekey:%')`);
  assert.deepEqual(priv.map(r => r.d), [], 'the church already holds private documents, so a challenge could have come from the reads: this test would prove nothing');
  await s.waitFor(`window.Steward.relayAuthed()`, 15000, 'the console to be signed in');
  assert.equal(await s.ev(`window.Steward.relayAuthed()`), true);
  // …and it was the console's own question that did it: the first challenge the relay sent came AFTER a REQ for
  // the safety-check document of THIS church, and nothing before it provoked one.
  const challenge = s.firstFrame(/^AUTH CHALLENGE/);
  assert.ok(challenge, 'the relay never challenged the console');
  const ask = s.frames.find(f => f.dir === '>' && /^REQ .*safetycheck:/.test(f.f));
  assert.ok(ask, 'the console never sent the sign-in question, so the challenge below was not provoked by it: ' + JSON.stringify(s.frames.filter(f => /AUTH/.test(f.f))));
  assert.ok(ask.f.includes('safetycheck:' + s.churchPub), 'the sign-in question names another church');
  assert.ok(ask.t <= challenge.t, 'the challenge came before the console asked: something else provoked it, and this test is not about the console\'s question');
  // a moment, not a minute: from the first frame this console sent to the challenge
  const first = s.frames.find(f => f.dir === '>');
  assert.ok(challenge.t - first.t < 6000, 'it took ' + (challenge.t - first.t) + ' ms from the console\'s first frame to be challenged');
});

test('the console answers the challenge it provoked, and asks a bounded number of times, only about its own church', { skip: SKIP, timeout: 60000 }, async () => {
  const asks = s.frames.filter(f => f.dir === '>' && /^REQ .*safetycheck:/.test(f.f));
  assert.ok(asks.length >= 1 && asks.length <= 3, 'the sign-in question was sent ' + asks.length + ' times');
  assert.ok(asks.every(f => f.f.includes('safetycheck:' + s.churchPub)), 'a sign-in question named another church: ' + asks.map(f => f.f).join(' | '));
  assert.ok(s.frames.some(f => f.dir === '>' && f.f === 'AUTH RESPONSE'), 'the console never answered a challenge');
});
