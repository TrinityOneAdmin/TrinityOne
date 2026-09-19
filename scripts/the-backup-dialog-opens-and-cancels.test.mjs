// "BACK UP TO A FILE" MUST OPEN, AND CANCEL MUST CLOSE IT — UNLESS A SAVE IS RUNNING.
// Run: node --test scripts/the-backup-dialog-opens-and-cancels.test.mjs
//
// Console audit 2026-09-19, P2. `trinityone.lastcrash` on the phone read
//     ReferenceError: guardedClose is not defined at StewBackupModal
// 8537ba2 (2026-08-23) pointed the Cancel button of StewBackupModal at `guardedClose` and defined it only in
// the sibling SermonEditModal. app/*.jsx are classic scripts in one global scope, so nothing failed at load;
// the modal threw the first time it rendered, and Settings → Church key → "Back up to a file" showed the error
// boundary on every build for 27 days. A steward could not back up the church key from the phone.
//
// No test mounted the modal, so no test saw it. This one mounts it the way the phone does — the whole console
// compiled with esbuild `jsx: 'transform'` (build-steward-apk.sh's `--jsx=transform`) into ONE scope, see
// scripts/console-screens.mjs — and drives the real Cancel, the real Escape listener from stew-modal.jsx and
// the real backdrop onClick. Nothing that decides "close or not" is stubbed: the only stand-ins are the
// browser, window.Steward, and TrinityBackup's file writer (a save that never finishes, to hold `busy`).
//
// ⚠ RULE 3 (CLAUDE.md): nothing here matches text in a .jsx file. The component is called and its output read.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConsole, fakeReact, fakeBrowser, fakeSteward, nodes } from './console-screens.mjs';

function openBackup({ saveFile } = {}) {
  const { React, reset, flush, unmount } = fakeReact();
  const { window, listeners } = fakeBrowser({ Steward: fakeSteward() });
  const { StewBackupModal } = loadConsole({ React, window, expr: '{ StewBackupModal }' });
  // backup.jsx has just installed the REAL window.TrinityBackup; keep its floor (PASS_MIN) and its shape, and
  // replace only the three calls a save makes, so `busy` is reached through the modal's own make().
  const real = window.TrinityBackup;
  assert.ok(real && real.PASS_MIN, 're-anchor: backup.jsx no longer installs window.TrinityBackup');
  const saves = [];
  window.TrinityBackup = { ...real,
    collectSteward: () => ({ v: 1 }), encryptObj: async () => 'ciphertext',
    saveFile: saveFile || ((name, text) => { saves.push(name); return new Promise(() => {}); }),   // never resolves: the save is in flight
  };
  let closed = 0;
  let tree;
  const draw = () => { reset(); tree = StewBackupModal({ church: { name: 'St Test' }, onClose: () => { closed++; } }); flush(); return tree; };
  const button = (label) => nodes(tree).find(n => n.type === 'button' && (n.kids || []).some(k => typeof k === 'string' && k.includes(label)));
  const backdrop = () => tree;                                   // the outermost element is the dimmed backdrop
  const escape = () => listeners.document.keydown.forEach(fn => fn({ key: 'Escape', isComposing: false, preventDefault() {} }));
  const type = (value) => { const input = nodes(tree).find(n => n.type === 'input' && n.props.type === 'password'); assert.ok(input, 're-anchor: no passphrase input rendered'); input.props.onChange({ target: { value } }); };
  return { draw, button, backdrop, escape, type, saves, closed: () => closed, PASS_MIN: real.PASS_MIN, unmount };
}

test('the backup dialog mounts — it does not throw on the way to the screen', () => {
  const m = openBackup();
  let tree;
  assert.doesNotThrow(() => { tree = m.draw(); },
    'THE DEFECT: StewBackupModal threw while rendering, so "Back up to a file" showed the error boundary instead ' +
    'of the dialog. trinityone.lastcrash on the phone, 2026-09-19.');
  const dlg = nodes(tree).find(n => n.props && n.props.role === 'dialog');
  assert.ok(dlg, 'no role="dialog" panel in the rendered tree — re-anchor');
  assert.ok(m.button('Cancel'), 'the dialog has no Cancel button — re-anchor');
  m.unmount();
});

test('while nothing is saving, Cancel closes it — and so do Escape and a tap on the backdrop', () => {
  const m = openBackup();
  m.draw();
  const cancel = m.button('Cancel');
  assert.equal(cancel.props.disabled, false, 'Cancel is disabled before anything has started');
  cancel.props.onClick();
  assert.equal(m.closed(), 1, 'Cancel did not close the dialog');

  m.escape();                                                    // stew-modal.jsx's document listener → useStewDialog → this dialog's close
  assert.equal(m.closed(), 2, 'Escape did not close the dialog (the Escape entry useStewDialog registers is not this dialog’s close)');

  m.backdrop().props.onClick();
  assert.equal(m.closed(), 3, 'a tap on the dimmed backdrop did not close the dialog');
  m.unmount();
});

test('while the file is being written, none of Cancel, Escape or the backdrop closes it', async () => {
  // `busy` is reached through the real path: type a passphrase that passes the floor, press the save button,
  // and give it a file writer that never finishes. A preset state would prove less — it would not show that
  // the guard reads the same `busy` that make() sets.
  const m = openBackup();
  m.draw();
  m.type('four random words here');
  assert.ok('four random words here'.length >= m.PASS_MIN, 'the test passphrase is under backup.jsx’s floor — lengthen it');
  m.draw();
  const save = m.button('Download encrypted backup');
  assert.ok(save, 're-anchor: no save button rendered after typing a passphrase');
  assert.equal(save.props.disabled, false, 'the save button is disabled with a passphrase over the floor in a secure context');
  save.props.onClick();                                          // make(): setBusy(true) then awaits the writer
  await new Promise(r => setTimeout(r, 0));                      // let make() reach saveFile
  await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(m.saves.length, 1, 'the save button did not reach TrinityBackup.saveFile — busy was never set by the real path');
  m.draw();

  const cancel = m.button('Cancel');
  assert.equal(cancel.props.disabled, true, 'Cancel is enabled while the file is being written');
  cancel.props.onClick();
  assert.equal(m.closed(), 0, 'Cancel closed the dialog over a save still in flight — a cancel that cancels nothing');
  m.escape();
  assert.equal(m.closed(), 0, 'Escape closed the dialog over a save still in flight');
  m.backdrop().props.onClick();
  assert.equal(m.closed(), 0, 'a backdrop tap closed the dialog over a save still in flight');
  assert.match(String(m.button('Encrypting')?.kids?.join('') || ''), /Encrypting/, 'the save button does not say the save is running');
  m.unmount();
});
