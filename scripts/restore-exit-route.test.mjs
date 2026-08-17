// LEAVING THE RESTORE ROUTE GOES BACK WHERE YOU CAME FROM.
// Run: node --test scripts/restore-exit-route.test.mjs
//
// IdentityOnboarding serves two entrances. On first run it is the wizard, and the restore panes sit on top of
// it — so "Back" out of them lands on the welcome fork, which is right. Opened from SETTINGS (`initialRestore`,
// app.jsx `idSheet === 'restore'`) there is nothing behind it at all: `setRestoring(false)` fell straight
// through to `intro && !restoring`, the welcome fork, and one more tap put a member who ALREADY HAS an account
// on "What should your church call you?".
//
// So someone who opened Restore to look at it, and pressed Back, was shown the app apparently starting to
// replace them — on the one screen in the product where that fear is real and the consequence is permanent.
// Reported by the owner, 2026-08-16.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody, stripComments } from './test-slice.mjs';

const ID = readFileSync(new URL('../app/identity.jsx', import.meta.url), 'utf8');
const APP = readFileSync(new URL('../app/app.jsx', import.meta.url), 'utf8');

// The REAL exit handler, lifted and executed — a structural "it mentions onSkip" would pass over a version
// that called it on the wrong branch, which is the whole bug.
function loadLeaveRestore(initialRestore) {
  const src = fnBody(ID, 'const leaveRestore = () => {');
  const calls = { setRPhrase: 0, setRErr: 0, setRBusy: 0, setRestoring: [], onSkip: 0 };
  const fn = new Function('initialRestore', 'onSkip', 'setRPhrase', 'setRErr', 'setRBusy', 'setRestoring', 'calls',
    src + '; return leaveRestore;')(
    initialRestore,
    () => { calls.onSkip++; },
    () => { calls.setRPhrase++; }, () => { calls.setRErr++; }, () => { calls.setRBusy++; },
    (v) => { calls.setRestoring.push(v); },
    calls);
  return { leaveRestore: fn, calls };
}

test('opened from settings, Back closes the sheet instead of starting a new account', () => {
  const { leaveRestore, calls } = loadLeaveRestore(true);
  leaveRestore();
  assert.equal(calls.onSkip, 1, 'Back must close the restore sheet and return to Settings');
  assert.deepEqual(calls.setRestoring, [],
    'dropping `restoring` here falls through to the first-run wizard — the app appears to start replacing a ' +
    'member who already has an account');
});

test('opened from first run, Back still returns to the welcome fork', () => {
  const { leaveRestore, calls } = loadLeaveRestore(false);
  leaveRestore();
  assert.equal(calls.onSkip, 0, 'there IS a wizard behind this pane on first run — closing would leave nothing');
  assert.deepEqual(calls.setRestoring, [false], 'back to "have you used TrinityOne before?"');
});

test('leaving clears the typed phrase either way', () => {
  for (const from of [true, false]) {
    const { leaveRestore, calls } = loadLeaveRestore(from);
    leaveRestore();
    assert.equal(calls.setRPhrase, 1, 'a half-typed recovery phrase must not survive on screen after Back');
  }
});

test('the chooser’s Back is wired to it, and says where it goes', () => {
  const chooser = stripComments(ID.slice(ID.indexOf("if (restoring && rMode === 'choose')")));
  const back = chooser.slice(0, chooser.indexOf('>Back') + 8);
  assert.match(back, /onClick=\{leaveRestore\}/, 'the exit button must use the shared handler, not its own reset');
  assert.doesNotMatch(back, /setRestoring\(false\)/, 'that is the bug: it is what falls through into the wizard');
  assert.match(chooser.slice(0, chooser.indexOf('</button>', chooser.indexOf('leaveRestore'))),
    /initialRestore \? 'Back to settings'/,
    'from Settings the label should name where it goes — "Back" on a full-screen pane with no visible parent is a guess');
});

test('settings really does open this pane with initialRestore', () => {
  const app = stripComments(APP);
  const at = app.indexOf("idSheet === 'restore'");
  assert.notEqual(at, -1, 'the settings entry to restore is gone — re-anchor this test');
  const el = app.slice(at, at + 400);
  assert.match(el, /initialRestore/, 'without this prop the pane cannot tell where it was opened from');
  assert.match(el, /onSkip=\{\(\) => setIdSheet\(null\)\}/, 'onSkip is what Back now calls — it must close the sheet');
});
