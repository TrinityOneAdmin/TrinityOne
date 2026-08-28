// THE CARE-REQUEST ID CHECK MUST SIT AT EVERY DOOR INTO THE STORE.
// Run: node --test scripts/carereq-guard-at-every-door.test.mjs
//
// The first attempt at this protection was a map of who-claimed-which-id, enforced in accept(). accept() is
// the LIVE write door. Three other paths call store.put() directly and never reach it — /import, cursor
// peer-sync and negentropy reconcile — so a forged request could arrive by replication, sit beside the
// genuine one (addressable events are stored per author), and every reader would pick newest-wins. An audit
// found it, 2026-08-28. This relay's own doctrine says it plainly: "A write gate is bypassed by anything that
// writes to the store."
//
// The fix made the id name its owner, so the check is stateless and true at any door. But a stateless check
// still has to be CALLED. This test is structural on purpose: it is the only thing that will notice when a
// fifth door is added next year, and a behavioural test of /import would need a NIP-98 proof and of peer-sync
// a second relay — neither of which notices a NEW path either.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('./gateway.mjs', import.meta.url), 'utf8');
const LINES = SRC.split('\n');

// Every place an event is written to the durable store.
function putSites() {
  const out = [];
  for (let i = 0; i < LINES.length; i++) {
    const l = LINES[i];
    if (!/store\.put\(/.test(l)) continue;
    if (l.trim().startsWith('//')) continue;      // prose ABOUT store.put — this file explains itself at length
    out.push(i);
  }
  return out;
}

test('every store.put is either accept-gated or carries the id check', () => {
  const sites = putSites();
  assert.ok(sites.length >= 4, `expected at least 4 store.put sites, found ${sites.length} — re-anchor this test`);
  const unguarded = [];
  for (const i of sites) {
    // include the line ITSELF: the negentropy path is a one-liner that verifies, checks and puts in sequence,
    // so a window of preceding lines alone reports it unguarded when it is not.
    //
    // AND THE CALL MUST GATE THE WRITE, not merely appear near it. Two defeats found by audit, 2026-08-28,
    // both leaving this green while a door stood open:
    //   `if (carereqIdOk(e, dtag(e))) { }`            — the token is there, the effect is not
    //   `// carereqIdOk() is applied upstream`         — a comment, in a new door with no call at all
    // So: ignore comment lines, and require the refusal shape — a NEGATED call that returns, continues or
    // increments-and-continues. That is the only form that actually stops the put underneath it.
    const window = LINES.slice(Math.max(0, i - 14), i + 1)
      .filter(l => !l.trim().startsWith('//'))
      .join('\n');
    // Deliberately not bracket-counting: the argument is `dtag(e)`, so the call nests a paren and a regex that
    // counts them is wrong in a way that reads as the app being broken. Require the NEGATED call and a bail-out
    // close behind it.
    const guarded = /!\s*carereqIdOk\([\s\S]{0,60}?(return|continue|\+\+)/.test(window);
    // Exactly ONE site may rely on accept() — the live publish path — and it is named, not guessed at. A
    // proximity search for "accept(" in the preceding lines matched unrelated prose and let an unguarded
    // /import through: the escape hatch was wider than the rule it was excusing.
    const liveGated = /putRes = store\.put\(evt, resolveChurch\(evt\)\)/.test(LINES[i]);
    if (!guarded && !liveGated) unguarded.push(i + 1);
  }
  assert.deepEqual(unguarded, [],
    `store.put at gateway.mjs:${unguarded.join(', ')} accepts an event without checking that a care-request ` +
    'id names its author. A forged request written there sits beside the genuine one and every reader takes ' +
    'newest-wins, so the steward\'s reply seals to the forger and the asker gets nothing.');
});

test('the check is stateless — it reads the event, not a map', () => {
  const at = SRC.indexOf('function carereqIdOk(');
  assert.ok(at > 0, 're-anchor: carereqIdOk has gone');
  const fn = SRC.slice(at, SRC.indexOf('\n}', at));
  assert.doesNotMatch(fn, /CAREREQ_OWNER/,
    'the id check consults the ownership map, so it is bookkeeping again and inherits every door the map had');
  assert.match(fn, /ID_OWNER_RE/, 'it no longer uses the shared owner-prefix pattern that group ids use');
  assert.match(fn, /e\.pubkey/, 'it does not compare the id against the event author at all');
});

test('an id with no owner prefix is still allowed through', () => {
  // Old builds mint a bare random id. Refusing those refuses a request for help because somebody has not
  // updated their app — the worst thing on this screen to refuse.
  const at = SRC.indexOf('function carereqIdOk(');
  const fn = SRC.slice(at, SRC.indexOf('\n}', at));
  assert.match(fn, /if \(!m\) return true;/,
    'a request from an app that predates self-naming ids is refused outright');
});

test('the read gate refuses to SERVE a mismatched copy', () => {
  // So anything already on disk from before the fix is inert, rather than relying on having caught it inbound.
  const at = SRC.indexOf("if (d.startsWith(CAREREQ_D)) {   // a member's private ask-for-help");
  assert.ok(at > 0, 're-anchor: the carereq read gate has moved');
  assert.match(SRC.slice(at, at + 700), /carereqIdOk\(e, d\)/,
    'the relay will still serve a forged copy that is already stored, and readers take newest-wins');
});
