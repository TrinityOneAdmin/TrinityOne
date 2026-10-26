// Point-of-use tests for the relay dashboard's LOCKED state and two residual findings from the
// token+count integration.  Run: node --test scripts/relay-dashboard-lock-ui.test.mjs   (port-free)
//
// CLAUDE.md rule 1: the lock UI had a well-tested engine and NO test at the point of use — deleting
// noteStatsStatus(), or the line in syncSettingsLock() that blanks the seven stat ids, left every other
// suite green.  control.js ships UNBUNDLED, so a text match passes over dead code (rule 3); these tests
// therefore LIFT the real functions out of control.js (regex + new Function) and RUN them against a DOM
// stub, exactly as scripts/relay-app-copy.test.mjs does.  Delete the feature from control.js and the
// matching assertion below goes red.
//
// Covers:
//   Finding #1 (merge gate) — a /stats 401 shows #dashLocked and resets the 7 headline stat ids to —; a
//                             following 200 unlocks.
//   Finding #3            — statsLocked is written by syncSettingsLock(), so loadConfig()'s setLocked(false)
//                             does not desync it and swallow the next real /stats 401.
//   Finding #2            — the module-init sessionStorage read is wrapped so blocked storage can't stop
//                             the script (poll() is started just below that read).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../relay-app/control.js', import.meta.url), 'utf8');
const STAT_IDS = ['s-today', 's-media', 's-churches', 's-members', 's-events', 's-conns', 's-traffic'];
const STAT_CARDS = ['actCard', 'kindCard', 'topCard'];

// Lift the REAL noteStatsStatus/statsLocked + STAT_CARDS/syncSettingsLock out of control.js and run them.
function liftLock() {
  const statsBlock = SRC.match(/let statsLocked = false;\n  function noteStatsStatus\(status\) \{[\s\S]*?\n  \}\n/);
  const lockBlock = SRC.match(/const STAT_CARDS = \[[^\]]*\];\n  function syncSettingsLock\(locked\) \{[\s\S]*?\n  \}\n/);
  assert.ok(statsBlock, 'statsLocked/noteStatsStatus block gone or reshaped — re-anchor this test');
  assert.ok(lockBlock, 'STAT_CARDS/syncSettingsLock block gone or reshaped — re-anchor this test');
  const els = {};
  const document = { getElementById: (id) => (els[id] ||= { textContent: '', style: {} }) };
  const fn = new Function('document',
    statsBlock[0] + lockBlock[0] + '\nreturn { noteStatsStatus, syncSettingsLock, locked: () => statsLocked };')(document);
  // seed the DOM the way the live page has it: real numbers in the stat cells, cards visible.
  for (const id of STAT_IDS) els[id] = { textContent: '42', style: {} };
  for (const id of STAT_CARDS) els[id] = { textContent: '', style: { display: 'block' } };
  els['dashLocked'] = { textContent: '', style: { display: 'none' } };
  els['storeRow'] = { textContent: '', style: { display: 'table-row' } };
  return { ...fn, els };
}

test('finding #1: a /stats 401 shows the locked card and blanks all seven headline numbers', () => {
  const { noteStatsStatus, locked, els } = liftLock();
  noteStatsStatus(401);
  assert.equal(locked(), true, 'the lock flag never latched on a 401');
  assert.equal(els['dashLocked'].style.display, 'block', '#dashLocked is not shown — the operator gets no explanation');
  for (const id of STAT_CARDS) assert.equal(els[id].style.display, 'none', id + ' was not hidden on lock');
  for (const id of STAT_IDS) assert.equal(els[id].textContent, '—',
    id + ' kept its stale number on a 401 — this is the exact line the merge gate requires a test for');
});

test('finding #1: a following /stats 200 unlocks', () => {
  const { noteStatsStatus, locked, els } = liftLock();
  noteStatsStatus(401);
  noteStatsStatus(200);
  assert.equal(locked(), false, 'the lock flag never cleared on the 200');
  assert.equal(els['dashLocked'].style.display, 'none', '#dashLocked stayed up after the relay answered 200');
  for (const id of STAT_CARDS) assert.equal(els[id].style.display, 'block', id + ' stayed hidden after unlock');
});

test('finding #3: syncSettingsLock keeps statsLocked in step, so an unlock does not swallow the next 401', () => {
  const { noteStatsStatus, syncSettingsLock, locked, els } = liftLock();
  noteStatsStatus(401);
  assert.equal(locked(), true);
  // loadConfig() -> setLocked(false) unlocks THROUGH syncSettingsLock. If that path didn't write statsLocked,
  // the flag would stay true while the UI is unlocked — a desync.
  syncSettingsLock(false);
  assert.equal(locked(), false, 'statsLocked desynced: syncSettingsLock(false) left the flag set');
  // So the NEXT genuine /stats 401 must still re-lock. With a stale-true flag, noteStatsStatus would early-return.
  noteStatsStatus(401);
  assert.equal(els['dashLocked'].style.display, 'block',
    'a /stats 401 after an unlock did not re-lock — statsLocked had desynced and noteStatsStatus early-returned');
});

test('finding #2: the module-init sessionStorage read survives blocked/throwing storage', () => {
  const init = SRC.match(/let adminToken = '';\s*\n\s*try \{ adminToken = sessionStorage\.getItem\(TOKEN_KEY\) \|\| ''; \} catch \(e\) \{\}/);
  assert.ok(init, 'the guarded adminToken init is gone — re-anchor this test (and finding #2 may have regressed)');
  const runInit = (ss) => new Function('sessionStorage', 'TOKEN_KEY', init[0] + '\nreturn adminToken;')(ss, 'K');
  const throwing = { getItem() { throw new Error('storage blocked (private mode)'); } };
  assert.doesNotThrow(() => runInit(throwing),
    'a throwing sessionStorage stops the whole script here, so poll() (started just below) never runs and the hero freezes');
  assert.equal(runInit(throwing), '', 'blocked storage must leave adminToken as the empty string');
  assert.equal(runInit({ getItem: () => 'SAVED' }), 'SAVED', 'a normal read no longer returns the stored token');
});
