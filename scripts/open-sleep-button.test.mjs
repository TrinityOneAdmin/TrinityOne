// Point-of-use test for the relay panel's "Open sleep settings" button wiring (relay-app/control.js).
// Run: node --test scripts/open-sleep-button.test.mjs
//
// The bug: the old handler hid the button (b.style.display='none') whenever the open failed or was
// unsupported — and Linux returned unsupported every time — so the button vanished on the first press and
// could never be pressed again. This lifts the REAL wireOpenSleepButton out of control.js (the
// OPEN-SLEEP-BTN-BEGIN/END slice the panel actually calls) and runs it against a fake DOM + fake fetch.
// It is executed, not text-matched, so it defeats the unbundled-dead-code trap (CLAUDE.md rule 3): re-adding
// the hide, or deleting the wiring, turns it red.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const SRC = readFileSync(join(ROOT, 'relay-app', 'control.js'), 'utf8');
const m = SRC.match(/\/\/ OPEN-SLEEP-BTN-BEGIN[^\n]*\n([\s\S]*?)\/\/ OPEN-SLEEP-BTN-END/);
assert.ok(m, 'OPEN-SLEEP-BTN markers are gone from control.js — the button wiring was removed; re-anchor this test');
const { wireOpenSleepButton } = new Function(m[1] + '\nreturn { wireOpenSleepButton };')();

function fakeDom() {
  const btn = { id: 'openSleepBtn', style: { display: 'inline-block' }, onclick: null };
  const hint = { id: 'sleepHint', style: { display: 'none' }, textContent: '' };
  const doc = { getElementById: (id) => (id === 'openSleepBtn' ? btn : id === 'sleepHint' ? hint : null) };
  return { doc, btn, hint };
}
// A fetch stub that resolves to a given {ok, body}. Counts its calls so we can prove a retry is possible.
function stubFetch(result) {
  const calls = [];
  const fn = async (url, opts) => { calls.push({ url, opts }); return { ok: result.ok, json: async () => result.body }; };
  fn.calls = calls;
  return fn;
}

test('an unsupported/failed open leaves the button VISIBLE and shows a hint', async () => {
  const { doc, btn, hint } = fakeDom();
  const fetchFn = stubFetch({ ok: true, body: { ok: false, unsupported: true } }); // Linux, no settings binary
  wireOpenSleepButton(doc, fetchFn, () => ({}));
  assert.equal(typeof btn.onclick, 'function', 'the button must be wired');
  await btn.onclick();
  assert.notEqual(btn.style.display, 'none', 'REGRESSION GUARD: the button must NOT be hidden on failure');
  assert.equal(hint.style.display, 'inline', 'a hint is shown instead');
  assert.match(hint.textContent, /power settings/i, 'the hint tells the operator what to do');
});

test('the button can be pressed a SECOND time (retry is possible)', async () => {
  const { doc, btn } = fakeDom();
  const fetchFn = stubFetch({ ok: true, body: { ok: false, unsupported: true } });
  wireOpenSleepButton(doc, fetchFn, () => ({}));
  await btn.onclick();
  await btn.onclick();
  assert.equal(fetchFn.calls.length, 2, 'both presses reached the gateway — the button was never disabled or hidden');
  assert.notEqual(btn.style.display, 'none');
});

test('a successful open clears the hint and keeps the button visible', async () => {
  const { doc, btn, hint } = fakeDom();
  hint.style.display = 'inline'; hint.textContent = 'leftover';
  const fetchFn = stubFetch({ ok: true, body: { ok: true } });
  wireOpenSleepButton(doc, fetchFn, () => ({}));
  await btn.onclick();
  assert.equal(hint.style.display, 'none', 'success clears the hint');
  assert.equal(hint.textContent, '');
  assert.notEqual(btn.style.display, 'none', 'the button stays available');
});

test('a thrown fetch (relay unreachable) is handled and still leaves the button visible', async () => {
  const { doc, btn, hint } = fakeDom();
  const fetchFn = async () => { throw new Error('offline'); };
  wireOpenSleepButton(doc, fetchFn, () => ({}));
  await btn.onclick();
  assert.notEqual(btn.style.display, 'none', 'an exception must not hide the button');
  assert.equal(hint.style.display, 'inline', 'the hint still appears on error');
});

test('wiring is idempotent — a second wire does not replace the handler', () => {
  const { doc, btn } = fakeDom();
  wireOpenSleepButton(doc, stubFetch({ ok: true, body: { ok: true } }), () => ({}));
  const first = btn.onclick;
  wireOpenSleepButton(doc, stubFetch({ ok: true, body: { ok: true } }), () => ({}));
  assert.equal(btn.onclick, first, 'already-wired button keeps its single handler (_wired guard)');
});
