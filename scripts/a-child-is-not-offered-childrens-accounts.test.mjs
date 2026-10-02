// A YOUNG PERSON'S OWN PROFILE SHEET MUST NOT OFFER THEM "CHILDREN'S ACCOUNTS".
//   Run: node --test scripts/a-child-is-not-offered-childrens-accounts.test.mjs
//
// Sim finding (block A2, item 10). The "Children’s accounts" row in ProfileSheet was gated only on
// `window.Fellowship.createChildAccount` existing, so a person the church had marked as a child was offered the
// way into FamilySheet — the one screen that mints a child account, joins it to the church and files a
// guardian request. The row beside it ("Wallet") and the young-person notices already check
// `ctx.safeguard.isMinor`; this one was missed. It is the ONLY entry to FamilySheet.
//
// THE ENGINE HALF (createChildAccount refuses a confirmed minor, and fails open for everyone else) is in
// scripts/child-account-tells-the-truth.test.mjs, where the harness that lifts the shipped function lives.
//
// HOW IT ASSERTS. CLAUDE.md rules 1 and 3: the REAL ProfileSheet is sliced out of app/identity.jsx by
// brace-match, compiled with the packaged build's esbuild, rendered through the miniature React in
// scripts/render-jsx-screen.mjs, and the row is looked for ON THE RENDERED TREE. Nothing here matches text in
// the .jsx file, so `false &&` in front of the condition cannot satisfy it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fnBody } from './test-slice.mjs';
import { miniReact, find, texts } from './render-jsx-screen.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const SRC = readFileSync(join(ROOT, 'app/identity.jsx'), 'utf8');
const Stub = (n) => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };

async function profile({ safeguard, withEngine = true }) {
  const src = fnBody(SRC, 'function ProfileSheet(', 'ProfileSheet');
  const tmp = join(tmpdir(), 'kidacct-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, src + '\nexport { ProfileSheet };\n');
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const { React, draw } = miniReact();
  const globals = {
    React, useId: React.useState, useIdE: React.useEffect,
    window: { TrinityData: { RELAYS: [] }, TrinityWallet: null, TrinityLN: null,
      Fellowship: withEngine ? { createChildAccount: async () => ({ ok: true }) } : {} },
    AvatarPicker: Stub('AvatarPicker'), Overlay: function Overlay(p) { return p.children; },
    Icon: Stub('Icon'), IconBtn: Stub('IconBtn'), UserAvatar: Stub('UserAvatar'),
    DirectoryToggle: Stub('DirectoryToggle'), BackupCard: Stub('BackupCard'),
    AppVersion: Stub('AppVersion'), FamilySheet: Stub('FamilySheet'), ChildrenAtChurchSheet: Stub('ChildrenAtChurchSheet'),
    WALLET_ENABLED: false, navigator: { clipboard: null }, setTimeout, clearTimeout, console,
  };
  const key = '__kidacct_' + Math.random().toString(36).slice(2);
  globalThis[key] = globals;
  const preamble = Object.keys(globals).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  const { ProfileSheet } = await import('data:text/javascript;base64,' + Buffer.from(preamble + '\n' + js).toString('base64'));
  const ctx = { church: { name: 'Grace', npub: 'npub1churchaaaaaaaaaaaaaaaaaa', features: {} }, safeguard, toast() {}, openChurchSwitcher() {}, openHelp() {} };
  const tree = draw(ProfileSheet, { open: true, onClose() {}, onSave() {}, ctx,
    identity: { name: 'Mia Whitlock', avatar: null, npub: 'npub1miaaaaaaaaaaaaaaaaaaaaaa' } });
  return { tree, words: texts(tree).join(' ') };
}

const rowFor = (tree, label) => find(tree, n => typeof n.type === 'function' && n.props && n.props.label === label);

test('control: an ADULT is offered "Children’s accounts" (and the sibling "Children at church" row is there)', async () => {
  const { tree } = await profile({ safeguard: { isMinor: false } });
  assert.equal(rowFor(tree, 'Children at church').length, 1, 're-anchor: the MY FAMILY section did not render at all');
  assert.equal(rowFor(tree, 'Children’s accounts').length, 1,
    'an ordinary adult lost the way to set up and look after a child’s account');
});

test('A CHILD IS NOT OFFERED "Children’s accounts" — the only way into the screen that mints child accounts', async () => {
  const { tree, words } = await profile({ safeguard: { isMinor: true } });
  assert.equal(rowFor(tree, 'Children at church').length, 1, 're-anchor: the MY FAMILY section did not render, so the absence below is vacuous');
  assert.equal(rowFor(tree, 'Children’s accounts').length, 0,
    'A MARKED CHILD WAS OFFERED THE SCREEN THAT MINTS CHILD ACCOUNTS. Screen read: ' + words);
});

test('…and an engine without createChildAccount still hides the row from an adult (the original condition stands)', async () => {
  const { tree } = await profile({ safeguard: { isMinor: false }, withEngine: false });
  assert.equal(rowFor(tree, 'Children’s accounts').length, 0, 'the row was shown with no engine behind it');
});
