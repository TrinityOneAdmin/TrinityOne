// A MEMBER ON A NEW PHONE MUST BE ABLE TO USE THE BACKUP FILE THEY WERE TOLD TO MAKE.
// Run: node --test scripts/restore-from-file.test.mjs
//
// THE DEFECT THIS CLOSES (UX audit 2026-08-16, F1). "Bring your account back" offered four routes — old phone,
// someone set this up for me, 12 words, lost my words. There was no "I have my backup file". Both file inputs
// lived behind an account that already existed, so the one artefact that carries EVERYTHING — identity,
// church, notes, journal, reading plans — was unreachable at the only moment it exists for. The workaround was
// to create an identity and then replace it: precisely the mistake the welcome fork was built to prevent.
//
// The ORDER of the new screen is the other half, and it is not cosmetic:
//   * the file is recognised BEFORE a password is asked for, so a wrong file costs the member nothing. The old
//     paths asked first, in a `window.prompt` — a system dialog showing the password in clear.
//   * failures stay on screen beside the field that can be fixed, and say WHICH thing was wrong. The old paths
//     put both into one toast that vanished.
//   * the destructive warning appears only when there is genuinely something to lose. Measured: the app has
//     already minted an identity by the time the welcome fork is on screen, so a naive "is there a key here?"
//     test warns every brand-new member that their account is about to be replaced — and doing that through
//     window.confirm blocked the entire page in a WebView, with no way back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody, stripComments } from './test-slice.mjs';

const ID = readFileSync(new URL('../app/identity.jsx', import.meta.url), 'utf8');

test('the restore chooser offers the backup file, first', () => {
  const chooser = stripComments(ID.slice(ID.indexOf("if (restoring && rMode === 'choose')")));
  const pane = chooser.slice(0, chooser.indexOf('</div>\n    </div>\n  );'));
  assert.match(pane, /I have my backup file/, 'the route that brings back everything is missing again');
  assert.match(pane, /setRMode\('file'\)/, 'the button must actually open the file route');

  const order = ['I have my backup file', 'I have my 12 words', 'I still have my old phone']
    .map(label => pane.indexOf(label));
  assert.ok(order.every(i => i !== -1), 'one of the routes is gone — re-anchor this test');
  assert.deepEqual(order.slice().sort((a, b) => a - b), order,
    'ordered by the situation people are actually in: the file first (it brings back the most), the words ' +
    'second (most members have them), the old phone after — it is no use when the phone is lost, stolen or broken');
});

test('the way IN to restore mentions the file too', () => {
  // A simulated member found this: the chooser now leads with "I have my backup file", but the Settings row
  // that OPENS it still said "Restore with your 12 words" — so someone holding a backup file had no reason to
  // tap it, and someone who did was told, on the way in, that they needed a different thing entirely.
  // Adding a route without updating its entrance is how a good route stays unused.
  const row = stripComments(ID.slice(ID.indexOf('label="Bring an account back"'), ID.indexOf('label="Bring an account back"') + 300));
  assert.match(row, /backup file/i, 'the entrance must name the route that brings back the most');
});

test('the file is recognised before any password is asked for', () => {
  const pick = stripComments(fnBody(ID, 'const pickBackupFile = async (f) => {'));
  assert.match(pick, /readFile\(f\)/, 'the file must be read up front');
  assert.match(pick, /app !== 'trinityone-backup'/, 'and identified, so a wrong file is caught before anything is typed');
  assert.doesNotMatch(pick, /prompt\(/, 'never a system prompt — it shows the password in clear and blocks the page');
  assert.doesNotMatch(pick, /rFilePass/, 'the password must not be read at the file-choosing step');

  const pane = stripComments(ID.slice(ID.indexOf("if (restoring && rMode === 'file')")));
  assert.ok(pane.indexOf('1 · Choose your file') < pane.indexOf('2 · Your file password'),
    'the steps must be in that order on screen too');
  assert.match(pane, /\{rFile \? \(/, 'the password step only appears once a good file is chosen');
});

test('the password is taken in-app, masked, with a way to see it', () => {
  const pane = stripComments(ID.slice(ID.indexOf("if (restoring && rMode === 'file')")));
  assert.match(pane, /type=\{rShowPass \? 'text' : 'password'\}/, 'masked by default, revealable — this is a phone keyboard');
  assert.doesNotMatch(pane.slice(0, pane.indexOf('Bring everything back')), /window\.prompt/);
});

test('a wrong password and a wrong file are told apart, and the message stays on screen', () => {
  const body = stripComments(fnBody(ID, 'const doRestoreFile = async (consented) => {'));
  assert.match(body, /passphrase\|damaged/, 'decryptStr already distinguishes them — do not throw that away');
  assert.match(body, /didn’t open the file/, 'a wrong password must say so in words the member can act on');
  assert.match(body, /church backup, not a member backup/, 'restoring the console’s file here must be named, not "failed"');
  assert.match(body, /setRErr\(/, 'errors go to the persistent field, not a toast');
  assert.doesNotMatch(body, /ctx\.toast\(/, 'a toast on this screen vanishes while the member is still reading it');
});

test('the destructive warning is in-app, and only when something is really at stake', () => {
  const body = stripComments(fnBody(ID, 'const doRestoreFile = async (consented) => {'));
  assert.doesNotMatch(body, /window\.confirm/,
    'a system dialog here is unreadable on a phone and — measured — blocks the whole page in a WebView');
  assert.match(body, /trinityone\.onboarded/,
    'a freshly minted, never-adopted key is NOT something to lose: the app mints one before the welcome fork ' +
    'is even on screen, so warning on key-presence alone warns every new member');
  assert.match(body, /followedChurches/, 'a followed church also counts as an account in use');
  assert.match(body, /used && standing === 'different'/,
    'both halves are required — used, AND a different account. Either alone gets it wrong');
  // FAIL CLOSED. These used to default to "there is nothing here", so an unreadable localStorage silently
  // authorised replacing whatever key was on the device. Pre-merge review.
  assert.match(body, /let used = true;/, 'if we cannot tell whether there is something to lose, we must ask');
  assert.match(body, /catch \(e\) \{ used = true; \}/, 'and a read that throws must not read as "nothing here"');
  // …and the consent must be carried as an argument, not through state a queued closure cannot see.
  assert.match(body, /consented !== true/, 'the confirm must reach the retry, or the member has to press it twice');
  assert.match(body, /setRPending\(obj\)/, 'the confirmation is a step in this screen');

  const pane = stripComments(ID.slice(ID.indexOf("if (restoring && rMode === 'file')")));
  assert.match(pane, /There is already an account on this phone/, 'and it has to actually be rendered');
  assert.match(pane, /rPending \? 'Replace it and restore'/, 'the button must change to say what it will do');
});

test('the restore screen describes the password the member actually has', () => {
  // OVERCLAIM, caught by a simulated member on 2026-08-17. The screen said "the four words you wrote down
  // when you made the backup" — but the four-word generator is a PROPOSAL in the UX audit that has not been
  // built, and the export screen asks for "a passphrase — at least 12 characters". Anyone who typed their own
  // reads an instruction describing a different secret, at the moment they are least able to tell "wrong
  // password" from "wrong file". It only matched in the simulation because that password happened to be four
  // words. This project treats overclaiming as a defect, not a copy nitpick.
  //
  // If the generator is built later, this guard should be REPLACED, not deleted — at that point the app does
  // issue four words and may say so.
  const pane = stripComments(ID.slice(ID.indexOf("if (restoring && rMode === 'file')")));
  assert.doesNotMatch(pane, /four words/i,
    'the app does not issue four words, so the restore screen must not claim it did');
  const body = stripComments(fnBody(ID, 'const doRestoreFile = async (consented) => {'));
  assert.doesNotMatch(body, /four words/i, 'nor may the wrong-password message');
  assert.match(body, /if it was several words/i,
    'it should still HELP — a member who did write words down needs to know to type the spaces');
});

test('a restore lands the member in their church, not back in the wizard', () => {
  const body = stripComments(fnBody(ID, 'const doRestoreFile = async (consented) => {'));
  assert.match(body, /applyMember\(obj\)/, 'the backup must actually be applied');
  assert.match(body, /trinityone\.onboarded/, 'the wizard must not greet a member who has just restored');
  assert.match(body, /location\.reload\(\)/, 'the same landing every other restore route uses');
});
