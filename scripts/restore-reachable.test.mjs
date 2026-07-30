// A member must always be able to get back into an existing account. Run: node --test scripts/restore-reachable.test.mjs
//
// AUDIT-2026-07-30 U1. Typing 12 words to restore an account existed in exactly two places, and only one of
// them could ever be reached:
//
//   • IdentityOnboarding — the first-run wizard. app.jsx gates it on `trinityone.onboarded`, and
//     "Skip setup for now" WRITES that flag. So one tap on a grey link at the bottom of the first screen closed
//     the only door, permanently. The words "for now" were false.
//   • NostrSheet's restore pane — which has never had a caller. `setNostr(true)` appears NOWHERE in any of the
//     44 app/*.jsx files, and app.jsx does not render NostrSheet at all. The comment at the top of
//     app/identity.jsx records the same thing: it "only mounted from ?identity=restore, a URL the APK's WebView
//     can never carry".
//
// Meanwhile app/identity-extras.jsx and app/identity.jsx both instruct the member to "restore your 12-word
// phrase" — an action with no entry point. Recovery required uninstall/reinstall, which nothing said.
//
// The fix reuses the WIZARD's restore route rather than reviving NostrSheet, because the wizard's is the good
// one: it carries the "I've lost my 12 words → your church can vouch for you" fallback. It is opened from
// settings with its own handlers, so an already-set-up member does not get onboarding's side effects.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const APP = read('app/app.jsx');
const IDENTITY = read('app/identity.jsx');

test('restore is reachable from settings, not only from first-run onboarding', () => {
  assert.match(IDENTITY, /onClick=\{\(\) => ctx\.openRestore\(\)\}/,
    'no settings row opens a restore flow. Typing 12 words is then only reachable inside the first-run wizard, ' +
    'which "Skip setup for now" hides for ever.');
  assert.match(APP, /openRestore: \(\) => setIdSheet\('restore'\)/, 'ctx.openRestore is not wired in app.jsx');
  assert.match(APP, /idSheet === 'restore' \? <IdentityOnboarding[\s\S]{0,200}initialRestore/,
    'nothing renders the restore flow, so the settings row would open an empty sheet');
});

test('the restore route opens straight into restore, not into name-entry', () => {
  // Without this the settings row drops the member at "what shall we call you?", which is the wrong question
  // for someone bringing an existing account back.
  assert.match(IDENTITY, /function IdentityOnboarding\(\{[^}]*initialRestore/, 'the wizard cannot be told to start in restore mode');
  assert.match(IDENTITY, /useId\(!!initialRestore\)/, 'initialRestore is accepted but does not set the restore state');
});

test('opening it from settings does NOT re-run onboarding side effects', () => {
  // The member is already set up. Re-writing trinityone.onboarded is harmless-but-wrong; re-prompting them to
  // follow a church is a confusing dead end. The settings render must have its OWN handlers.
  const at = APP.indexOf("idSheet === 'restore' ? <IdentityOnboarding");
  assert.notEqual(at, -1, 'the settings-mode render is gone');
  const block = APP.slice(at, APP.indexOf('/> : null}', at));
  assert.doesNotMatch(block, /trinityone\.onboarded/, 'the settings restore re-writes the onboarding flag');
  assert.doesNotMatch(block, /promptFollowChurch|followChurch/, 'the settings restore re-prompts a church follow');
  assert.match(block, /setIdSheet\(null\)/, 'it never closes');
});

test('the first-run wizard still works — the fix must not have moved it', () => {
  // Over-tightening check: the wizard is the route a genuinely new member takes, and its restore branch is
  // still the one a returning member on a fresh install uses.
  assert.match(APP, /showOnboarding \? <IdentityOnboarding open=\{true\}/, 'the first-run wizard is no longer rendered');
  assert.match(IDENTITY, /I’ve used it before/, 'the wizard lost its restore fork');
  assert.match(IDENTITY, /I’ve lost my 12 words|lost my 12 words/, 'the church-can-vouch fallback is gone — that is the best part of this flow');
});

test('the dead pane is still dead, and nothing now depends on it', () => {
  // Not a regression guard so much as a record: if someone later gives NostrSheet a caller, they are exposing a
  // restore path with no confirmation step, which is a different decision that deserves its own review.
  const callers = (APP.match(/setNostr\(true\)/g) || []).length;
  assert.equal(callers, 0, 'NostrSheet now has a caller — its restore pane has no confirmation before it ' +
    'replaces the account on this phone. That needs deciding deliberately, not inheriting.');
});
