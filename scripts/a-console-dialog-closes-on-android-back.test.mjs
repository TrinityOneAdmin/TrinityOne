// ANDROID BACK CLOSES THE CONSOLE DIALOG ON TOP — EVERY DIALOG, ONE AT A TIME, AND ONLY WHILE ONE IS OPEN.
//   Run: node --test scripts/a-console-dialog-closes-on-android-back.test.mjs
//
// Device round 2026-10-01 (Oppo): "Parents of …" (a CkModal) and the schedule's service dialog ignored the phone's
// Back button — only a handful of console dialogs had wired their own Capacitor listener, one by one, and
// Capacitor calls EVERY backButton listener, so a dialog over a dialog that each held one closed both. Now the
// console's dialog stack (app/stew-modal.jsx, the stack Escape already used) holds ONE native listener while any
// dialog is open, and Back closes the top one — the member app's useBackLayer way (app/ui.jsx).
//
// The real useStewDialog out of app/stew-modal.jsx and the real CkModal out of app/stew-dashboard.jsx (rule 3:
// they run; nothing matches their text), against a fake Capacitor App plugin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadScreen, miniReact } from './render-jsx-screen.mjs';
import { fnBody } from './test-slice.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const DASH = readFileSync(join(ROOT, 'app/stew-dashboard.jsx'), 'utf8');

function fakeApp() {
  const listeners = [];
  return {
    listeners,
    App: { addListener: (ev, fn) => { const e = { ev, fn }; listeners.push(e); return { remove: () => { const i = listeners.indexOf(e); if (i >= 0) listeners.splice(i, 1); } }; } },
    back: () => { for (const e of listeners.filter(x => x.ev === 'backButton')) e.fn(); },
    count: () => listeners.filter(x => x.ev === 'backButton').length,
  };
}
// The shipped hook, with a React whose effects the test runs AND cleans up (the shared miniReact never runs a
// cleanup, and a dialog leaving the stack is half of what is under test here).
function hookHarness(cap) {
  const effects = [];
  const R = {
    useRef: (v) => ({ current: v === undefined ? null : v }),
    useEffect: (fn) => { effects.push(fn); },
    createElement: () => null,
  };
  const win = { Capacitor: { Plugins: { App: cap.App } }, dispatchEvent() {}, addEventListener() {}, removeEventListener() {} };
  const doc = { addEventListener() {}, activeElement: null };
  const mod = loadScreen('app/stew-modal.jsx', ['useStewDialog'], { React: R, window: win, document: doc, CustomEvent: function () {}, setTimeout: () => 0, clearTimeout: () => {} });
  // open a dialog: render its hook once and run its effect; returns its close-down (the effect's cleanup)
  const open = (onClose) => { effects.length = 0; mod.useStewDialog(onClose); const cleanups = effects.map(f => f()).filter(Boolean); return () => cleanups.forEach(c => c()); };
  return { open };
}

test('one dialog open: ONE Back listener; Back closes it; closed, the listener is gone (Back does what it always did)', () => {
  const cap = fakeApp(), h = hookHarness(cap);
  assert.equal(cap.count(), 0, 'CONTROL: a Back listener with no dialog open');
  let closed = 0;
  const shut = h.open(() => { closed++; });
  assert.equal(cap.count(), 1, `${cap.count()} Back listeners for one open dialog`);
  cap.back();
  assert.equal(closed, 1, 'Android Back did not close the open dialog');
  shut();
  assert.equal(cap.count(), 0, 'the Back listener outlived the last dialog — Back would no longer leave the app');
});

test('a dialog over a dialog: Back closes the TOP one only', () => {
  const cap = fakeApp(), h = hookHarness(cap);
  const closed = [];
  const shutOuter = h.open(() => closed.push('outer'));
  const shutInner = h.open(() => closed.push('inner'));
  assert.equal(cap.count(), 1, `${cap.count()} Back listeners for two open dialogs — Capacitor calls every one, so both would close`);
  cap.back();
  assert.deepEqual(closed, ['inner'], 'Back closed ' + JSON.stringify(closed) + ' — not just the dialog on top');
  shutInner();
  cap.back();
  assert.deepEqual(closed, ['inner', 'outer'], 'with the inner dialog gone, Back did not close the outer one');
  shutOuter();
  assert.equal(cap.count(), 0, 'a Back listener outlived both dialogs');
});

// The real component, compiled out of its file with the real useStewDialog, drawn open; how many Back
// listeners it left, and whether Back closed it.
async function openOnBack(file, name, props) {
  const cap = fakeApp();
  const { React, draw } = miniReact();
  const win = { Capacitor: { Plugins: { App: cap.App } }, dispatchEvent() {}, addEventListener() {}, removeEventListener() {} };
  const doc = { addEventListener() {}, activeElement: null };
  const modal = loadScreen('app/stew-modal.jsx', ['useStewDialog'], { React, window: win, document: doc, CustomEvent: function () {}, setTimeout: () => 0, clearTimeout: () => {} });
  const src = fnBody(readFileSync(join(ROOT, file), 'utf8'), 'function ' + name + '(', name);
  const tmp = join(tmpdir(), 'bk-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try { writeFileSync(tmp, src + '\nexport { ' + name + ' };\n'); js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' }); }
  finally { rmSync(tmp, { force: true }); }
  const g = { React, Icon: () => null, useStewDialog: modal.useStewDialog };
  const key = '__bk_' + Math.random().toString(36).slice(2);
  globalThis[key] = g;
  const mod = await import('data:text/javascript;base64,' + Buffer.from(Object.keys(g).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n') + '\n' + js).toString('base64'));
  delete globalThis[key];
  let closed = 0;
  draw(mod[name], { ...props, onClose: () => { closed++; } });
  const listeners = cap.count();
  cap.back();
  return { listeners, closed };
}

test('THE CALL SITE: "Parents of …" (a CkModal) closes on Android Back', async () => {
  const r = await openOnBack('app/stew-dashboard.jsx', 'CkModal', { title: 'Parents of Cleo', children: null });
  assert.equal(r.listeners, 1, 'the open "Parents of …" dialog registered ' + r.listeners + ' Back listeners');
  assert.equal(r.closed, 1, 'ANDROID BACK DID NOT CLOSE "Parents of …" (device round 2026-10-01)');
});
test('THE CALL SITE: a schedule dialog (SchModal — the service, rota and run-sheet dialogs) closes on Android Back', async () => {
  const r = await openOnBack('app/stew-schedule.jsx', 'SchModal', { title: 'Sunday service', children: null });
  assert.equal(r.listeners, 1, 'the open schedule dialog registered ' + r.listeners + ' Back listeners');
  assert.equal(r.closed, 1, 'ANDROID BACK DID NOT CLOSE the schedule dialog (device round 2026-10-01)');
});
