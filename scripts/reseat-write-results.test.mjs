// A RE-SEAT MUST NOT REPORT WORK IT DID NOT DO. Run: node --test scripts/reseat-write-results.test.mjs
//
// HANDOFF-2026-08-05 §4.2. reseatMember awaited seven church writes and inspected the result of none of them.
// publish() does not throw on refusal — it dispatches an event, returns `false`, and resolves. So every
// `await window.Steward.setX(...)` in here could have been refused by every relay and the function would still
// run to the end and return a report saying it had all happened. The modal then told the steward, flatly:
//
//     "Their child marking, youth clearance and parent link moved across with them,
//      and their new phone has been told."
//
// The worst one has no sentence at all. `blockOld` is the "their phone was STOLEN" tickbox, and the checkbox
// itself promises "Blocks the old key so it can no longer read this church. Do this now — once they are
// reconnected, the old entry leaves your Members list and you cannot block it afterwards." That is accurate
// about the console: reseatOld filters the old key out of the roster, taking the only Block control with it.
// So a refused setBlocked left the thief holding a key that still reads the church, still posts to it, still
// holds the group keys — and left the steward no way to try again, having been shown a success screen.
//
// These lift the SHIPPED reseatMember out of vendor/steward.js and drive it with setters we can refuse, so
// the assertions are about what the function does, not about how its source is spelled.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { stripComments } from './test-slice.mjs';

const STEWARD = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const DASH = readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8');
const K = () => getPublicKey(generateSecretKey());

// brace-match the shipped function out of the bundle (comment- and quote-aware)
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

// Drive the real function. `refuse` names the setters that every relay rejects — i.e. that return false,
// which is exactly what publish() does when the church is offline or every relay refuses the write.
function reseater(refuse = []) {
  const body = grab(STEWARD, 'async reseatMember(oldPub, newPub, o) {');
  const calls = [];
  const setter = (name) => async (...args) => {
    calls.push({ name, args });
    return refuse.includes(name) ? false : { id: name + '-evt' };
  };
  const Steward = {};
  for (const n of ['setReseats', 'setAdmitted', 'setMinors', 'setApproved', 'setGuardians', 'setBlocked']) Steward[n] = setter(n);
  Steward.refreshClearances = async (...args) => {
    calls.push({ name: 'refreshClearances', args });
    // the shipped shape: a per-member tally, not a boolean
    return refuse.includes('refreshClearances')
      ? { results: [], failed: 1, skipped: 0, total: 1, unverified: false, pending: 0 }
      : { results: [], failed: 0, skipped: 0, total: 1, unverified: false, pending: 0 };
  };
  const scope = {
    toPubHex: (x) => (/^[0-9a-f]{64}$/i.test(String(x || '')) ? String(x).toLowerCase() : null),
    now: () => Math.floor(Date.now() / 1000),
    window: { Steward },
  };
  const names = Object.keys(scope);
  const obj = new Function(...names, 'return ({ ' + body + ' });')(...names.map(n => scope[n]));
  return { run: (a, b, o) => obj.reseatMember(a, b, o), calls, called: (n) => calls.some(c => c.name === n) };
}

const oldK = K(), newK = K(), parentK = K();
const minorOpts = () => ({
  reseats: [], admitted: [], minors: [oldK], approved: [], guardians: { [oldK]: [parentK] }, blocked: [],
});

test('the happy path still moves the whole seat', async () => {
  const r = reseater();
  const out = await r.run(oldK, newK, minorOpts());
  assert.equal(out.minorCarried, true);
  assert.equal(out.guardiansCarried, true);
  assert.ok(r.called('setReseats') && r.called('setAdmitted') && r.called('setMinors') && r.called('setGuardians'));
  assert.deepEqual(out.failed || [], [], 'a re-seat where every write landed must report nothing failed');
});

// THE ONE THAT MATTERS MOST. A refused block is not a cosmetic reporting bug: the steward is told the theft
// was handled, the old entry then vanishes from Members, and the only control that could have blocked it goes
// with it. The thief keeps reading the church indefinitely.
test('a refused stolen-phone block is never reported as done', async () => {
  const r = reseater(['setBlocked']);
  let threw = null;
  let out = null;
  try { out = await r.run(oldK, newK, { ...minorOpts(), blockOld: true }); }
  catch (e) { threw = e; }
  assert.ok(threw || (out && out.blockedOld === false),
    'setBlocked was refused by every relay and reseatMember still reported blockedOld:true — the steward is ' +
    'shown a success screen, the old row leaves the roster, and the stolen key can never be blocked');
  if (threw) {
    assert.match(String(threw.message), /block/i, 'the error must name the block, or the steward cannot tell what failed');
    // Aborting is the right answer, but only if it aborts BEFORE the seat moves: once setReseats lands, the
    // old key is filtered out of the roster and the Block control is gone whether or not we threw.
    assert.equal(r.called('setReseats'), false,
      'the block failed but the seat had already moved — the old entry is now out of the roster, so the ' +
      'steward cannot retry the block. Attempt the block first, and abort while the old row is still there.');
  }
});

test('a refused child marking is not reported as carried across', async () => {
  const r = reseater(['setMinors']);
  let out = null, threw = null;
  try { out = await r.run(oldK, newK, minorOpts()); } catch (e) { threw = e; }
  assert.ok(threw || (out && (out.minorCarried === false || (out.failed || []).length > 0)),
    'the minors list was refused and the re-seat still reported the child marking as carried. The new key is ' +
    'not marked as a child anywhere, so the relay lets any adult DM them — and the modal says it moved across');
});

test('a refused parent link is not reported as carried across', async () => {
  const r = reseater(['setGuardians']);
  let out = null, threw = null;
  try { out = await r.run(oldK, newK, minorOpts()); } catch (e) { threw = e; }
  assert.ok(threw || (out && (out.guardiansCarried === false || (out.failed || []).length > 0)),
    'the guardians map was refused and the re-seat still reported the parent link as carried — the half a ' +
    'steward cannot repair by hand, reported as done');
});

test('a refused clearance re-seal is reported', async () => {
  const r = reseater(['refreshClearances']);
  let out = null, threw = null;
  try { out = await r.run(oldK, newK, minorOpts()); } catch (e) { threw = e; }
  assert.ok(threw || (out && (out.failed || []).length > 0),
    'refreshClearances reported failed>0 and the re-seat still claimed "their new phone has been told"');
});

// If the vouch itself is refused there is no re-seat at all. Admitting the new key anyway gives a stranger's
// key posting rights in the church while the roster still shows two of the same person — the exact state the
// "record the vouch FIRST" ordering exists to avoid, which only works if the result is looked at.
test('a refused vouch stops the re-seat rather than admitting the new key anyway', async () => {
  const r = reseater(['setReseats']);
  let threw = null;
  try { await r.run(oldK, newK, minorOpts()); } catch (e) { threw = e; }
  assert.ok(threw, 'the re-seat record was refused and reseatMember carried on regardless');
  assert.equal(r.called('setAdmitted'), false,
    'the vouch was refused and the new key was admitted anyway — it can now post to the church while no ' +
    'record connects it to the member it is supposed to be');
});

// An honest engine behind a screen that ignores it is not a fix. The modal awaited reseatMember purely for
// its side effects, threw the report away, and set done=true — so every branch above would be invisible.
test('the confirm screen reads the report instead of asserting it', () => {
  const code = stripComments(DASH);
  assert.match(code, /await window\.Steward\.reseatMember\([\s\S]{0,400}?\);\s*\n\s*setRes\(/,
    'ReseatModal still discards reseatMember’s result, so nothing it reports can reach the steward');
  // The unconditional sentence, verbatim as it shipped.
  assert.ok(!/moved across with\s*\n?\s*them, and their new phone has been told/.test(code),
    'the modal still states the child marking, youth clearance and parent link moved across regardless of ' +
    'whether any of those writes landed');
  assert.match(code, /res\.blockedOld/,
    'the stolen-phone block still has no sentence on the confirm screen — the one write whose silent failure ' +
    'leaves a thief reading the church, reported neither way');
});

// The same-second tie-break (HANDOFF §6). event-store resolves a created_at tie by lowest event id, so a write
// landing in the same second as the previous version of that doc loses roughly half the time. Before the
// results were checked this lost the write in silence; checking them alone would have turned it into a visible
// "couldn't save the child marking" for something that is only a clock collision. It has to actually succeed.
test('a write refused on a same-second tie is retried, not surfaced as a failure', async () => {
  const body = grab(STEWARD, 'async reseatMember(oldPub, newPub, o) {');
  const tries = { setMinors: 0 };
  const Steward = {};
  for (const n of ['setReseats', 'setAdmitted', 'setApproved', 'setGuardians', 'setBlocked']) Steward[n] = async () => ({ id: n });
  // refuse ONCE, exactly as a tie-break does, then accept — the retry has a later created_at and cannot tie
  Steward.setMinors = async () => (++tries.setMinors === 1 ? false : { id: 'minors' });
  Steward.refreshClearances = async () => ({ results: [], failed: 0, skipped: 0, total: 1, unverified: false, pending: 0 });
  const scope = {
    toPubHex: (x) => (/^[0-9a-f]{64}$/i.test(String(x || '')) ? String(x).toLowerCase() : null),
    now: () => Math.floor(Date.now() / 1000),
    window: { Steward },
  };
  const names = Object.keys(scope);
  const obj = new Function(...names, 'return ({ ' + body + ' });')(...names.map(n => scope[n]));
  const out = await obj.reseatMember(oldK, newK, minorOpts());
  assert.equal(tries.setMinors, 2, 'the refused write was never retried — a clock collision becomes a hard failure');
  assert.equal(out.minorCarried, true, 'the retry landed but the re-seat still reported the marking as not carried');
});
