// A YOUNG PERSON'S OWN PROFILE SHEET MUST NOT OFFER THEM A PHOTOGRAPH.
//   Run: node --test scripts/a-childs-photo-control-is-off.test.mjs
//
// `allowPhoto` in app/identity.jsx is the whole of the child-photo decision on the member's own device. It is
// computed in ProfileSheet and handed to <AvatarPicker allowPhoto={allowPhoto} />, which is the control that
// offers "choose a photograph" instead of a symbol or an initial. Four things have to be true at once for it
// to be offered:
//     const allowPhoto = !!(ctx && ctx.church)                                         // you are in a church
//       && !(_cf && _cf.memberPhotos === false)                                        // which uses photos
//       && (!(ctx.safeguard.isMinor) || !!(_cf && _cf.childPhotos))                    // ← the child clause
//       && !(ctx.safeguard.photoBlocked);                                              // and not reset by a steward
//
// Measured 2026-09-01: NO TEST ANYWHERE READ allowPhoto. Deleting the third line — the child clause — left
// the whole suite green, and a 15-year-old whose church has not opted children in is handed the camera on
// their own profile screen. What follows is not hypothetical: the relay refuses the resulting kind-0 for a
// minor in a photos-off church, so the young person picks a picture of themselves, presses Save, and the
// church's own protection turns it into a write that fails. The suppression path that exists for children
// who already had a photo (scripts/marking-a-child-suppresses-their-photo.test.mjs) is the cleanup for
// pictures that got through BEFORE a marking; this is the control that stops one being offered afterwards.
//
// The default is what carries the safety. A church that has said nothing about children's photographs —
// which is every church until it opens that setting — must be read as NOT allowing them, so this is an
// identity check on `childPhotos` and never a truthy one. The console derives the same fact independently as
// `kidPhotosAllowed` (app/stew-dashboard.jsx) and that derivation has its own tests; this is the member
// half, and the two are read by different code on different devices.
//
// HOW IT ASSERTS. CLAUDE.md rule 3 — app/identity.jsx ships UNBUNDLED, so deleting or disabling that clause
// leaves the rest of the file untouched and any text-matching assertion still passes. So the REAL
// ProfileSheet is sliced out by brace-match, compiled with the same esbuild the packaged build uses,
// rendered through the miniature React in scripts/render-jsx-screen.mjs, driven into edit mode through the
// button a member actually presses, and the value read OFF THE AvatarPicker ELEMENT IN THE TREE. That is
// the point of use (rule 1): if the prop stops being passed, this file goes red too.
//
// MEASURED RED/GREEN, 2026-09-01, each sabotage scoped to ProfileSheet, the anchor asserted to occur exactly
// once inside it, and app/identity.jsx restored byte-identical:
//   · the shipped screen                                                         6 pass / 0 fail
//   · the child clause deleted from allowPhoto                                   4 pass / 2 fail
//   · `!!(_cf && _cf.childPhotos)` -> `(!!_cf && _cf.childPhotos !== false)`      5 pass / 1 fail
//   · `allowPhoto={allowPhoto}` dropped from <AvatarPicker>                      0 pass / 6 fail
// CLAUDE.md says all-red means suspect the harness. It is not the harness here: the two rows above it are
// partial reds out of the same harness, and with the prop gone the AvatarPicker element carries `undefined`
// where every case expects a definite true or false — which is itself the defect, because a control offered
// on the strength of a missing prop is decided by whatever AvatarPicker's own default happens to be.
//
// Also measured, and the reason this file exists: `grep -rn allowPhoto scripts/ vendor/` returns NOTHING
// outside this file. The value was computed on every member's profile screen and read by no test at all.
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

// The SHIPPED ProfileSheet, compiled and rendered, then driven into edit mode the way a member gets there.
// Everything it takes from other app files is furniture; a name it needs that is not here is a
// ReferenceError at the point of use, deliberately.
async function photoControl({ church, safeguard }) {
  const src = fnBody(SRC, 'function ProfileSheet(', 'ProfileSheet');
  const tmp = join(tmpdir(), 'kidphoto-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, src + '\nexport { ProfileSheet };\n');
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const { React, draw } = miniReact();
  const globals = {
    React, useId: React.useState, useIdE: React.useEffect,
    window: { TrinityData: { RELAYS: [] }, TrinityWallet: null, Fellowship: null, TrinityLN: null },
    AvatarPicker: Stub('AvatarPicker'), Overlay: function Overlay(p) { return p.children; },
    Icon: Stub('Icon'), IconBtn: Stub('IconBtn'), UserAvatar: Stub('UserAvatar'),
    DirectoryToggle: Stub('DirectoryToggle'), BackupCard: Stub('BackupCard'),
    AppVersion: Stub('AppVersion'), FamilySheet: Stub('FamilySheet'),
    WALLET_ENABLED: false, navigator: { clipboard: null }, setTimeout, clearTimeout, console,
  };
  const key = '__kidphoto_' + Math.random().toString(36).slice(2);
  globalThis[key] = globals;
  const preamble = Object.keys(globals).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  const { ProfileSheet } = await import('data:text/javascript;base64,' + Buffer.from(preamble + '\n' + js).toString('base64'));

  const ctx = { church, safeguard, toast() {}, openChurchSwitcher() {}, openHelp() {} };
  const props = { open: true, onClose() {}, onSave() {}, ctx,
    identity: { name: 'Mia Whitlock', avatar: null, npub: 'npub1miaaaaaaaaaaaaaaaaaaaaaa' } };
  let tree = draw(ProfileSheet, props);
  // The member's own route in: the profile view's own edit control.
  const edit = find(tree, n => n.type === 'button' && texts(n).join('').includes('Edit name & mark'));
  assert.equal(edit.length, 1, 'the profile sheet no longer offers a way into edit mode — re-anchor this test');
  edit[0].props.onClick();
  tree = draw(ProfileSheet, props);
  const pickers = find(tree, n => typeof n.type === 'function' && n.type.name === 'AvatarPicker');
  assert.equal(pickers.length, 1, 'the edit screen no longer renders exactly one AvatarPicker — re-anchor this test');
  return pickers[0].props.allowPhoto;
}

const CHILD = { isMinor: true }, ADULT = { isMinor: false };

// ── the gap ────────────────────────────────────────────────────────────────────────────────────────────────
test('A CHILD IS NOT OFFERED A PHOTOGRAPH — the church has said nothing about children’s photos', async () => {
  // Every church, until it deliberately opens that setting. The default has to carry the safety.
  assert.equal(await photoControl({ church: { name: 'Grace', features: {} }, safeguard: CHILD }), false,
    'a young person’s own profile screen offered them the camera. Their church has not opted children in, so ' +
    'the relay will refuse the kind-0 they sign — they choose a picture of themselves, press Save, and the ' +
    'church’s own protection turns it into a write that fails');
  assert.equal(await photoControl({ church: { name: 'Grace' }, safeguard: CHILD }), false,
    'a church with no features object at all — a brand-new one — offered a child the camera');
});

test('…and NOT on a truthy reading of the setting, which is how a default becomes an opt-out', async () => {
  assert.equal(await photoControl({ church: { name: 'Grace', features: { childPhotos: false } }, safeguard: CHILD }), false,
    'a church that explicitly said no was read as saying yes');
});

test('…but a church that DID opt its children in is not overruled', async () => {
  // Safeguarding is mechanism, not policy (reference/DOMAIN.md): churches differ, and a church that has
  // decided this for itself must get what it decided.
  assert.equal(await photoControl({ church: { name: 'Grace', features: { childPhotos: true } }, safeguard: CHILD }), true,
    'a church that deliberately allows children’s photographs had the control taken off its young people’s ' +
    'screens anyway');
});

// ── and the rest of the rule, so a fix here cannot be "switch it off for everyone" ─────────────────────────
test('AN ADULT IS STILL OFFERED A PHOTOGRAPH — the common case, and most of the church', async () => {
  assert.equal(await photoControl({ church: { name: 'Grace', features: {} }, safeguard: ADULT }), true,
    'ordinary adult members can no longer set a photograph at all');
});

test('…and the other two clauses still stand: a photos-off church, and a steward’s reset', async () => {
  assert.equal(await photoControl({ church: { name: 'Grace', features: { memberPhotos: false } }, safeguard: ADULT }), false,
    'a church that does not use photographs at all was still offering the camera');
  assert.equal(await photoControl({ church: { name: 'Grace', features: {} }, safeguard: { isMinor: false, photoBlocked: true } }), false,
    'a member whose photo a steward turned off was offered a new one, so the reset can be undone by its subject');
});

test('…and somebody in no church at all is offered nothing', async () => {
  assert.equal(await photoControl({ church: null, safeguard: ADULT }), false,
    'a member with no church was offered a church-governed control');
});
