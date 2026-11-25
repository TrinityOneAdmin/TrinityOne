// THE WIDGET'S "N NEW MESSAGES" COUNT (Direct Mode, Deliverable 3) IS BARE AND CLEARS ON EVERY PATH.
//   Run: node scripts/run-tests.mjs scripts/the-widget-message-count-is-bare-and-clears-with-the-church.test.mjs
//
// Everything here is lifted from the shipped source and EXECUTED (CLAUDE.md rule 3), not text-matched:
//  - bg-entry.js widgetCountAction + finish: what the reader tells the worker to do to the count, and that finish()
//    really attaches it to the summary the worker reads (release path, DP_DEBUG false).
//  - screens-extras.jsx dpSetTier's leaving-on-device branch: really calls the clear (the point of USE, rule 1).
//  - identity.src.js widgetClearChurch (the lock / forget-device / remember-expiry / church-switch path): really
//    calls TrinityWidget.clearMessageCount as well as clearPrompt.
// The native half (WidgetStore.shownCount age/clock rule, the worker's prefs write) is Kotlin/Java: checked by compiling
// and on the device, not here.
// Callers of the lifted code: widgetCountAction/finish only __dpStart; dpWidgetCountClear only dpSetTier
// (leaving the on-device tier); widgetClearChurch only widgetForgetChurch and rememberClear.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';

const BG = readFileSync(new URL('../plugins/trinity-directpush/js/bg-entry.js', import.meta.url), 'utf8');
const EXT = readFileSync(new URL('../app/screens-extras.jsx', import.meta.url), 'utf8');
const IDS = readFileSync(new URL('../src/identity.src.js', import.meta.url), 'utf8');

const widgetCountAction = new Function(fnBody(BG, 'function widgetCountAction(', 'widgetCountAction') + '\nreturn widgetCountAction;')();

test('a real count sets; a REAL zero or a reader that may not run clears; an unanswered run keeps', () => {
  assert.deepEqual(widgetCountAction('new-events', 4), { op: 'set', n: 4 });
  for (const v of ['genuinely-0-new', 'not-opted-in', 'identity-mismatch', 'no-church']) assert.deepEqual(widgetCountAction(v, 0), { op: 'clear' }, v);
  for (const v of ['AUTH-FAILED-OR-CLOCK-SKEW (count is NOT a real zero)', 'NO-ANSWER (timeout) (count is NOT a real zero)', 'gate2-fail', 'gate2-empty', undefined, 'no-summary'])
    assert.deepEqual(widgetCountAction(v, 0), { op: 'keep' }, String(v));
  assert.deepEqual(widgetCountAction('new-events', 0), { op: 'keep' }, 'no positive count is never "set"');
  assert.deepEqual(widgetCountAction('new-events', NaN), { op: 'keep' });
});

test('the summary the worker reads carries only the decision: a number, never a name or text (release path)', () => {
  const reports = [];
  const finish = new Function('rep', 'DP_DEBUG', 'widgetCountAction', 'window', fnBody(BG, 'function finish(', 'finish') + '\nreturn finish;')(
    (o) => reports.push(o), false, widgetCountAction, {});
  finish({ verdict: 'new-events', newSinceCursor: 3, byKind: { 4: 3 }, groupIds: 2, cursor: 1 });
  assert.equal(reports.length, 1);
  assert.deepEqual(reports[0], { stage: 'summary', verdict: 'new-events', newSinceCursor: 3, widget: { op: 'set', n: 3 } });
  finish({ verdict: 'genuinely-0-new', newSinceCursor: 0 });
  assert.deepEqual(reports[1].widget, { op: 'clear' });
});

test('POINT OF USE: leaving the on-device tier clears the widget count', () => {
  // The clear now lives in dpSetTier's "leaving a tier" cleanup: switching AWAY from on-device (to push or off)
  // drops both the lock-readable key and the widget count. Slice that one branch and execute it — delete the
  // dpWidgetCountClear() line and this fails.
  const src = EXT.slice(EXT.indexOf('const dpSetTier = async (next) => {'));
  const leave = src.slice(src.indexOf("if (prev === 'ondevice')"), src.indexOf("if (prev === 'push')"));
  assert.ok(leave.length > 20 && leave.length < 400, 'sliced the leaving-on-device branch');
  const calls = [];
  const run = new Function('prev', 'dpBgKeyClear', 'dpWidgetCountClear', leave + '\n;');
  run('ondevice', () => calls.push('bgkey-clear'), () => calls.push('clear-count'));
  assert.deepEqual(calls, ['bgkey-clear', 'clear-count'], 'leaving on-device must clear both the lock-readable key and the widget count');
  // and the helper reaches the native plugin, tolerating an APK without the method
  const clearFn = new Function('calls', fnBody(EXT, 'function dpWidgetCountClear(', 'dpWidgetCountClear') + '\nreturn dpWidgetCountClear;')(calls);
  const seen = [];
  globalThis.window = { Capacitor: { Plugins: { TrinityWidget: { clearMessageCount: () => { seen.push('native'); return Promise.resolve(); } } } } };
  clearFn(); assert.deepEqual(seen, ['native']);
  globalThis.window = { Capacitor: { Plugins: { TrinityWidget: {} } } }; assert.doesNotThrow(() => clearFn());
  globalThis.window = {}; assert.doesNotThrow(() => clearFn());
});

test('POINT OF USE: lock / forget-device / remember-expiry / church switch (widgetClearChurch) clears the count with the church settings', () => {
  const seen = [];
  const win = { Capacitor: { Plugins: { TrinityWidget: { clearPrompt: () => { seen.push('prompt'); return Promise.resolve(); }, clearMessageCount: () => { seen.push('count'); return Promise.resolve(); } } } } };
  const mk = new Function('window', fnBody(IDS, 'function _widgetPlugin(', '_widgetPlugin') + '\n' + fnBody(IDS, 'function widgetClearChurch(', 'widgetClearChurch') + '\nreturn widgetClearChurch;');
  mk(win)();
  assert.deepEqual(seen.sort(), ['count', 'prompt']);
  const old = { Capacitor: { Plugins: { TrinityWidget: { clearPrompt: () => Promise.resolve() } } } };
  assert.doesNotThrow(() => mk(old)(), 'an older APK without the method');
});
