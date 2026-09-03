// A PIN BOX A SCREEN READER CANNOT NAME.
// Run: node --test scripts/every-secret-field-has-a-name.test.mjs
//
// AUDIT 2026-09-02 #27. A `type="password"` input with only a `placeholder` has no accessible name once
// anything is typed into it — the placeholder disappears, and a screen reader announces "edit text, secure".
// On these screens that box is the church key's PIN, a backup passphrase, or the code that unlocks a
// restored account. Guessing which is not something to ask of somebody who cannot see the layout.
//
// Also here: the modal that never announced itself, and a document-wide Escape handler that stole Escape
// from an open <select>.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripComments } from './test-slice.mjs';

const FILES = ['app/identity.jsx', 'app/identity-extras.jsx', 'app/stew-dashboard.jsx'];

test('every secret field says what it is', () => {
  const unnamed = [];
  for (const f of FILES) {
    const src = stripComments(readFileSync(new URL('../' + f, import.meta.url), 'utf8'));
    for (const m of src.matchAll(/<input[^>]*type="password"[^>]*>/g)) {
      const tag = m[0];
      if (!/aria-label=/.test(tag) && !/aria-labelledby=/.test(tag)) {
        unnamed.push(f + ': ' + tag.slice(0, 90).replace(/\s+/g, ' '));
      }
    }
  }
  assert.deepEqual(unnamed, [],
    'these secret fields have no accessible name. Once something is typed the placeholder is gone and a ' +
    'screen reader can only say "edit text, secure" — and one of these is the PIN that unlocks a church ' +
    'key:\n  ' + unnamed.join('\n  '));
});

test('the New group modal announces itself as a dialog', () => {
  const src = stripComments(readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8'));
  const i = src.indexOf('function NewGroupModal');
  assert.ok(i > 0, 're-anchor: NewGroupModal has moved');
  // the component is long; the dialog root is ~5.6k in. Slice to the NEXT top-level function instead of
  // guessing a window — a short window here reports a fix that is present as missing.
  const nextFn = src.indexOf('\nfunction ', i + 10);
  const body = src.slice(i, nextFn > 0 ? nextFn : i + 9000);
  assert.match(body, /role="dialog"/,
    'the New group modal is a plain div. A screen-reader user is dropped inside it with nothing saying a ' +
    'dialog opened — every other console modal announces itself');
  assert.match(body, /aria-modal="true"/, 'the modal does not mark the page behind it as inert');
  assert.match(body, /aria-labelledby=/, 'the dialog has no accessible name');
});

test('a document-wide Escape does not steal Escape from a select or an IME', () => {
  const src = stripComments(readFileSync(new URL('../app/stew-modal.jsx', import.meta.url), 'utf8'));
  const i = src.indexOf("if (e.key !== 'Escape'");
  assert.ok(i > 0, 're-anchor: the Escape handler has moved');
  const body = src.slice(i, i + 700);
  assert.match(body, /isComposing/,
    'Escape is swallowed mid-composition, so cancelling an IME candidate closes the whole modal and loses ' +
    'what was typed');
  assert.match(body, /SELECT/,
    'Escape is swallowed while a <select> is open, so dismissing the dropdown shuts the modal instead');
  const guardsBefore = body.indexOf('isComposing') < body.indexOf('preventDefault');
  assert.ok(guardsBefore, 'the guards run AFTER preventDefault, so the key is already stolen');
});

test('the dismiss buttons can be hit and can be named', () => {
  const src = stripComments(readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8'));
  for (const m of src.matchAll(/<button[^>]*Dismiss this message[^>]*>/g)) {
    assert.match(m[0], /aria-label=/, 'a dismiss button has a title but no accessible name');
    assert.match(m[0], /minWidth: 24|minHeight: 24/,
      'a dismiss button is a bare 15px icon — under any reasonable touch target, on the screen a steward ' +
      'uses to clear an error');
  }
});
