// A DISCARDED RESTORE PUTS BACK THE DEVICE'S STEWARD KEYS (S-10).
//   Run: node --test scripts/console-restore-defers-steward-keys.test.mjs
//
// THE DEFECT. applySteward called restoreLocal immediately, which overwrites steward localStorage
// keys (network-keys, active-id, etc.) BEFORE the PIN is set. If the user then chose "Keep my
// current church" (discardUnsavedKey), the memory key was discarded but the file's localStorage
// keys — including another church's network-keys — stayed on this device. Result: the steward's
// network list showed the other church's network, and the active-id pointed at the wrong church.
//
// THE FIX. applySteward snapshots the current steward keys, writes the filtered file keys, and
// stashes the snapshot. discardUnsavedKey calls _undoStewardRestore which restores the snapshot.
// setPin calls _commitStewardRestore which clears it.
//
// Additional: applySteward also filters out church-key and church-key.removing from the file,
// and merges network-keys by pub instead of overwriting.
//
// Callers: applySteward: stew-dashboard.jsx (file restore). _undoStewardRestore: discardUnsavedKey
// in steward.src.js. _commitStewardRestore: setPin in steward.src.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadConsole, fakeReact, fakeBrowser, fakeSteward } from './console-screens.mjs';
import { fnBody } from './test-slice.mjs';

function setupBackupContext() {
  const { React } = fakeReact();
  const Steward = fakeSteward({
    hasKey: false,
    exportMnemonic: () => '',
    restoreKey: () => {},
  });
  const { window, localStorage } = fakeBrowser({ Steward });
  const mods = loadConsole({
    React, window,
    expr: '({ applySteward: window.TrinityBackup.applySteward, _undoStewardRestore: window.TrinityBackup._undoStewardRestore, _commitStewardRestore: window.TrinityBackup._commitStewardRestore })',
    files: ['app/backup.jsx'],
  });
  return { mods, localStorage, window };
}

test('a discarded restore puts back this device’s steward localStorage keys', () => {
  const { mods, localStorage } = setupBackupContext();

  localStorage.setItem('trinityone.steward.network-keys', JSON.stringify([{ pub: 'mynet', name: 'My Church' }]));
  localStorage.setItem('trinityone.steward.active-id', 'my-active-id');

  mods.applySteward({
    kind: 'steward',
    churchKey: '',
    local: {
      'trinityone.steward.network-keys': JSON.stringify([{ pub: 'theirnet', name: 'Their Church' }]),
      'trinityone.steward.active-id': 'their-active-id',
    },
  });

  assert.equal(localStorage.getItem('trinityone.steward.active-id'), 'their-active-id',
    'applySteward did not write the file’s keys to localStorage');

  mods._undoStewardRestore();

  assert.equal(localStorage.getItem('trinityone.steward.active-id'), 'my-active-id',
    '_undoStewardRestore did not put back the device’s active-id');
  const nk = JSON.parse(localStorage.getItem('trinityone.steward.network-keys'));
  assert.ok(nk.some(r => r.pub === 'mynet'),
    '_undoStewardRestore did not put back the device’s network key');
});

test('a committed restore keeps the file’s keys and undo is a no-op', () => {
  const { mods, localStorage } = setupBackupContext();

  localStorage.setItem('trinityone.steward.network-keys', JSON.stringify([{ pub: 'mynet', name: 'My Church' }]));
  localStorage.setItem('trinityone.steward.active-id', 'my-active-id');

  mods.applySteward({
    kind: 'steward',
    churchKey: '',
    local: {
      'trinityone.steward.network-keys': JSON.stringify([{ pub: 'theirnet', name: 'Their Church' }]),
      'trinityone.steward.active-id': 'their-active-id',
    },
  });

  mods._commitStewardRestore();
  mods._undoStewardRestore();

  assert.equal(localStorage.getItem('trinityone.steward.active-id'), 'their-active-id',
    'after commit, undo should be a no-op — the file’s active-id was lost');
});

test('applySteward merges network-keys by pub, device copy wins', () => {
  const { mods, localStorage } = setupBackupContext();

  localStorage.setItem('trinityone.steward.network-keys', JSON.stringify([
    { pub: 'shared', name: 'Device Name' },
    { pub: 'onlymine', name: 'Only Mine' },
  ]));

  mods.applySteward({
    kind: 'steward',
    churchKey: '',
    local: {
      'trinityone.steward.network-keys': JSON.stringify([
        { pub: 'shared', name: 'File Name' },
        { pub: 'onlytheirs', name: 'Only Theirs' },
      ]),
    },
  });

  const nk = JSON.parse(localStorage.getItem('trinityone.steward.network-keys'));
  const pubs = nk.map(r => r.pub);
  assert.ok(pubs.includes('shared'), 'shared network missing');
  assert.ok(pubs.includes('onlymine'), 'device-only network lost');
  assert.ok(pubs.includes('onlytheirs'), 'file-only network lost');
  const shared = nk.find(r => r.pub === 'shared');
  assert.equal(shared.name, 'Device Name',
    'device copy should win on a shared pub — the file’s stale name was kept instead');
});

test('applySteward excludes church-key and church-key.removing from the file', () => {
  const { mods, localStorage } = setupBackupContext();

  mods.applySteward({
    kind: 'steward',
    churchKey: '',
    local: {
      'trinityone.steward.church-key': 'imported-seed',
      'trinityone.steward.church-key.removing': 'true',
      'trinityone.steward.active-id': 'ok-value',
    },
  });

  assert.equal(localStorage.getItem('trinityone.steward.church-key'), null,
    'applySteward wrote church-key from the file — makes _bootKeyState answer plaintext on next boot');
  assert.equal(localStorage.getItem('trinityone.steward.church-key.removing'), null,
    'applySteward wrote church-key.removing — puts this device into mid-removal state');
  assert.equal(localStorage.getItem('trinityone.steward.active-id'), 'ok-value',
    'sanity: non-excluded keys should still be written');
});

const STEWARD = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');

test('discardUnsavedKey in the vendor bundle calls _undoStewardRestore', () => {
  const fn = fnBody(STEWARD, 'discardUnsavedKey()', 'discardUnsavedKey');
  assert.match(fn, /_undoStewardRestore/,
    'discardUnsavedKey no longer calls _undoStewardRestore — a discarded restore leaves the file’s keys on this device');
});

test('setPin in the vendor bundle calls _commitStewardRestore', () => {
  const fn = fnBody(STEWARD, 'async setPin(pin)', 'setPin');
  assert.match(fn, /_commitStewardRestore/,
    'setPin no longer calls _commitStewardRestore — a successful PIN leaves the snapshot armed and a later discard would revert the restore');
});
