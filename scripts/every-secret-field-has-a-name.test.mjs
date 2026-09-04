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

// steward-root.jsx was missing from this list and holds FOUR password fields, including the console's own
// PIN gate. Audit 2026-09-04.
const FILES = ['app/identity.jsx', 'app/identity-extras.jsx', 'app/stew-dashboard.jsx', 'app/steward-root.jsx'];

// FIND THE WHOLE TAG, not `<input[^>]*type="password"[^>]*>`. That pattern stops at the first ">" — and a
// JSX attribute routinely contains one, in an arrow function: `onChange={e => …}`. So any password input
// whose handler is written before `type=` was invisible to it. Measured before this fix: it saw 5 of the 7
// in stew-dashboard.jsx, and steward-root.jsx was not being read at all. A test that silently skips the
// fields it is meant to police is worse than no test, because the count looks reassuring.
//
// Walk out from each `type="password"` to the enclosing `<input`, then forward to the ">" that closes it,
// tracking brace depth so a ">" inside `{...}` does not end the tag.
function passwordTags(src) {
  const out = [];
  for (const m of src.matchAll(/type="password"/g)) {
    const start = src.lastIndexOf('<input', m.index);
    if (start < 0) { out.push('(a password field with no <input before it: ' + src.slice(Math.max(0, m.index - 40), m.index + 20) + ')'); continue; }
    let depth = 0, end = -1;
    for (let i = start; i < src.length; i++) {
      const c = src[i];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0 && i > start) { end = i; break; }
    }
    out.push(src.slice(start, end < 0 ? src.length : end + 1));
  }
  return out;
}

test('every secret field says what it is', () => {
  const unnamed = [];
  let seen = 0;
  for (const f of FILES) {
    const src = stripComments(readFileSync(new URL('../' + f, import.meta.url), 'utf8'));
    const tags = passwordTags(src);
    // The count is part of the assertion: if the extractor ever stops finding them, that must be a failure
    // and not a quietly empty pass.
    assert.equal(tags.length, (src.match(/type="password"/g) || []).length,
      f + ': the tag extractor lost a password field — every one of them must be checked, not most');
    seen += tags.length;
    for (const tag of tags) {
      if (!/aria-label=/.test(tag) && !/aria-labelledby=/.test(tag)) {
        unnamed.push(f + ': ' + tag.slice(0, 90).replace(/\s+/g, ' '));
      }
    }
  }
  assert.ok(seen >= 19, 'only ' + seen + ' password fields found across ' + FILES.length +
    ' files; there were 19 when this was written, so something is no longer being read');
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
    // THE PROPERTY IS "BIG ENOUGH TO HIT", NOT "HAS THESE TWO KEYS". One of these buttons already had
    // padding:14 with margin:-14 — a ~44px target that costs no layout — and asserting on minWidth alone
    // said it was broken, which is how a second `style` came to be added beside the first and silently win.
    // Accept either shape, and say what is actually required.
    assert.match(m[0], /minWidth: 2[4-9]|minHeight: 2[4-9]|padding: (1[0-9]|[2-9][0-9])/,
      'a dismiss button is a bare icon with no padding — under any reasonable touch target, on the screen ' +
      'a steward uses to clear an error');
    assert.equal((m[0].match(/style=/g) || []).length <= 1, true,
      'this button has TWO style props. JSX keeps the last and drops the first silently, so whichever fix ' +
      'was added second is the only one that ran');
  }
});
