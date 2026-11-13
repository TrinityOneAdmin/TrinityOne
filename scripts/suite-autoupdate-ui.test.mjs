// Point-of-use test for the Suite JS auto-update control (P4) in relay-app/control.js.
// Run: node --test scripts/suite-autoupdate-ui.test.mjs
//
// This lifts the REAL wireSuiteAutoUpdate out of control.js (the SUITE-AUTOUPDATE-UI-BEGIN/END slice that
// loadUpdate actually calls on a packaged Suite box) and runs it against a fake DOM + fake fetch. It is
// executed, not text-matched, so it defeats the unbundled-dead-code trap (CLAUDE.md rule 3): delete the
// control's wiring, drop the {autoUpdate} body, or re-introduce the "hide on error" bug and these go red.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const SRC = readFileSync(join(ROOT, 'relay-app', 'control.js'), 'utf8');
const m = SRC.match(/\/\/ SUITE-AUTOUPDATE-UI-BEGIN[^\n]*\n([\s\S]*?)\/\/ SUITE-AUTOUPDATE-UI-END/);
assert.ok(m, 'SUITE-AUTOUPDATE-UI markers are gone from control.js — the control wiring was removed; re-anchor this test');
const { wireSuiteAutoUpdate } = new Function(m[1] + '\nreturn { wireSuiteAutoUpdate };')();

function el(id, extra) {
  return Object.assign({ id, style: {}, dataset: {}, disabled: false, onchange: null, value: '', checked: false, textContent: '' }, extra || {});
}
function fakeDom(active) {
  const els = {
    suiteAutoToggle: el('suiteAutoToggle'),
    suiteAutoTime: el('suiteAutoTime', { value: '03:00' }),
    suiteAutoStatus: el('suiteAutoStatus'),
    suiteAutoHint: el('suiteAutoHint', { style: { display: 'none' } }),
  };
  const doc = { getElementById: (id) => (id in els ? els[id] : null), activeElement: active || null };
  return { doc, els };
}
// A fetch stub resolving {ok} and recording its calls (so we can read the POST body and count retries).
function okFetch(ok = true) {
  const calls = [];
  const fn = async (url, opts) => { calls.push({ url, opts }); return { ok, json: async () => ({ ok }) }; };
  fn.calls = calls;
  return fn;
}
const noAuth = () => ({});

test('toggle ON posts {autoUpdate:true} to /settings', async () => {
  const { doc, els } = fakeDom();
  const f = okFetch();
  wireSuiteAutoUpdate(doc, f, noAuth, { enabled: false, at: '03:00' });
  assert.equal(typeof els.suiteAutoToggle.onchange, 'function', 'the toggle must be wired');
  els.suiteAutoToggle.checked = true;
  await els.suiteAutoToggle.onchange();
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, '/settings');
  assert.equal(f.calls[0].opts.method, 'POST');
  assert.deepEqual(JSON.parse(f.calls[0].opts.body), { autoUpdate: true });
});

test('toggle OFF posts {autoUpdate:false}', async () => {
  const { doc, els } = fakeDom();
  const f = okFetch();
  wireSuiteAutoUpdate(doc, f, noAuth, { enabled: true, at: '03:00' });
  els.suiteAutoToggle.checked = false;
  await els.suiteAutoToggle.onchange();
  assert.deepEqual(JSON.parse(f.calls[0].opts.body), { autoUpdate: false });
});

test('the time field posts {autoUpdateAt:"HH:MM"}', async () => {
  const { doc, els } = fakeDom();
  const f = okFetch();
  wireSuiteAutoUpdate(doc, f, noAuth, { enabled: true, at: '03:00' });
  els.suiteAutoTime.value = '04:30';
  await els.suiteAutoTime.onchange();
  assert.equal(f.calls[0].url, '/settings');
  assert.deepEqual(JSON.parse(f.calls[0].opts.body), { autoUpdateAt: '04:30' });
});

test('status line renders a STAGED update from the /update suite payload', () => {
  const { doc, els } = fakeDom();
  wireSuiteAutoUpdate(doc, okFetch(), noAuth, { enabled: true, at: '03:00', windowEnd: '05:00', installedVersion: '1.2.3', staged: { version: '1.2.4' } });
  // audit be258b42 H1: the old "staged for tonight" is replaced by the real rule — the window, or the next start.
  assert.match(els.suiteAutoStatus.textContent, /1\.2\.4 is downloaded and installs between 03:00 and 05:00/);
  assert.match(els.suiteAutoStatus.textContent, /next time the Suite starts/);
});

test('status line renders an APPLIED update (incl. store-degraded note)', () => {
  let { doc, els } = fakeDom();
  wireSuiteAutoUpdate(doc, okFetch(), noAuth, { enabled: true, installedVersion: '1.2.4', lastOutcome: 'applied' });
  assert.match(els.suiteAutoStatus.textContent, /Updated to 1\.2\.4/i);
  ({ doc, els } = fakeDom());
  wireSuiteAutoUpdate(doc, okFetch(), noAuth, { enabled: true, installedVersion: '1.2.4', lastOutcome: 'applied-store-degraded' });
  assert.match(els.suiteAutoStatus.textContent, /Updated to 1\.2\.4/i);
  assert.match(els.suiteAutoStatus.textContent, /store/i, 'subtle store-degraded note is shown');
});

test('status line renders a ROLLED-BACK update', () => {
  const { doc, els } = fakeDom();
  wireSuiteAutoUpdate(doc, okFetch(), noAuth, { enabled: true, lastOutcome: 'rolledback' });
  assert.match(els.suiteAutoStatus.textContent, /rolled back/i);
});

test('the control is DISABLED while saving and RE-ENABLED after', async () => {
  const { doc, els } = fakeDom();
  let release;
  const f = (url, opts) => { f.calls.push({ url, opts }); return new Promise((res) => { release = () => res({ ok: true, json: async () => ({ ok: true }) }); }); };
  f.calls = [];
  wireSuiteAutoUpdate(doc, f, noAuth, { enabled: false });
  els.suiteAutoToggle.checked = true;
  const p = els.suiteAutoToggle.onchange();
  assert.equal(els.suiteAutoToggle.disabled, true, 'toggle disabled during the in-flight save');
  assert.equal(els.suiteAutoTime.disabled, true, 'time disabled during the in-flight save');
  release();
  await p;
  assert.equal(els.suiteAutoToggle.disabled, false, 'toggle re-enabled after the save');
  assert.equal(els.suiteAutoTime.disabled, false, 'time re-enabled after the save');
});

test('a FAILED save (r.ok=false) shows a hint, keeps the control VISIBLE and re-enabled', async () => {
  const { doc, els } = fakeDom();
  const f = okFetch(false);
  wireSuiteAutoUpdate(doc, f, noAuth, { enabled: false });
  els.suiteAutoToggle.checked = true;
  await els.suiteAutoToggle.onchange();
  assert.match(els.suiteAutoHint.textContent, /save/i, 'an inline hint explains the failure');
  assert.equal(els.suiteAutoHint.style.display, 'inline');
  assert.notEqual(els.suiteAutoToggle.style.display, 'none', 'REGRESSION GUARD: the control is NOT hidden on error');
  assert.equal(els.suiteAutoToggle.disabled, false, 'and it is re-enabled so a retry is possible');
});

test('a THROWN fetch is handled, control stays visible, and a SECOND press retries', async () => {
  const { doc, els } = fakeDom();
  let throwIt = true;
  const calls = [];
  const f = async (url, opts) => { calls.push({ url, opts }); if (throwIt) throw new Error('offline'); return { ok: true, json: async () => ({ ok: true }) }; };
  wireSuiteAutoUpdate(doc, f, noAuth, { enabled: false });
  els.suiteAutoToggle.checked = true;
  await els.suiteAutoToggle.onchange();
  assert.notEqual(els.suiteAutoToggle.style.display, 'none', 'an exception must not hide the control');
  assert.match(els.suiteAutoHint.textContent, /save/i);
  assert.equal(els.suiteAutoToggle.disabled, false, 'control re-enabled after the exception');
  // retry: the network comes back and the second press reaches the gateway
  throwIt = false;
  await els.suiteAutoToggle.onchange();
  assert.equal(calls.length, 2, 'both presses reached the gateway — the control was never disabled or hidden');
});

test('a daytime/evening time shows an inline warning; an early-morning time does not', () => {
  let { doc, els } = fakeDom();
  wireSuiteAutoUpdate(doc, okFetch(), noAuth, { enabled: true, at: '22:00' });
  assert.equal(els.suiteAutoHint.style.display, 'inline');
  assert.match(els.suiteAutoHint.textContent, /nobody is using it/i, 'warns that an evening time restarts the relay while it may be in use');
  ({ doc, els } = fakeDom());
  wireSuiteAutoUpdate(doc, okFetch(), noAuth, { enabled: true, at: '03:00' });
  assert.equal(els.suiteAutoHint.style.display, 'none', '03:00 is safe — no warning');
});

test('wiring is idempotent — a second wire keeps the single handler but re-renders status', () => {
  const { doc, els } = fakeDom();
  wireSuiteAutoUpdate(doc, okFetch(), noAuth, { enabled: false, installedVersion: '1.0.0' });
  const first = els.suiteAutoToggle.onchange;
  wireSuiteAutoUpdate(doc, okFetch(), noAuth, { enabled: true, installedVersion: '2.0.0', lastOutcome: 'rolledback' });
  assert.equal(els.suiteAutoToggle.onchange, first, 'already-wired toggle keeps its single handler (_wired guard)');
  assert.match(els.suiteAutoStatus.textContent, /rolled back/i, 'but the status re-renders from the fresh payload');
});
