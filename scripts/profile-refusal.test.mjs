// A refused church-profile edit must reach a screen, and a brand-new church must be able to set its name.
// Run: node --test scripts/profile-refusal.test.mjs
//
// publishProfile grew two guards that returned Promise.resolve(null). Every one of the 20+ callers treats a
// resolved promise as success: NameEditModal closes the dialog, feature toggles keep their new position, the
// giving-address field renders "Saved ✓". So a delegated steward's every settings change was silently
// discarded — and worse, the second guard refused the FIRST name a church ever sets, because at wizard step 0
// the relay has not answered about a profile that does not exist yet. The church was created nameless and
// nothing retried it. AUDIT-2026-07-27.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const S = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const D = readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8');
const body = (() => {
  const at = S.indexOf('publishProfile(meta)');
  assert.notEqual(at, -1, 'publishProfile is gone from the shipped console bundle');
  return S.slice(at, at + 3000);
})();

test('a refusal tells the steward, instead of returning a promise that looks like success', () => {
  assert.match(body, /steward-write-blocked/,
    'publishProfile still refuses silently — the dialog closes and the steward believes it saved');
  const warnOnly = /console\.warn\([^)]*\);\s*return Promise\.resolve\(null\)/.test(body);
  assert.equal(warnOnly, false, 'a console.warn is not a user-visible consequence');
});

test('something actually renders that event', () => {
  // It was fired by _requireTrustedView and by Finance for a long time and listened to NOWHERE, so the
  // refusals the code called "visible and retryable" reached no screen at all.
  assert.match(D, /addEventListener\('steward-write-blocked'/,
    'nothing in the console listens for steward-write-blocked — every refusal is still invisible');
  const at = D.indexOf("addEventListener('steward-write-blocked'");
  const near = D.slice(Math.max(0, at - 2000), at);
  assert.match(near, /function PublishErrorBanner/,
    'the listener must live in a component that is actually mounted');
  assert.match(D, /<PublishErrorBanner \/>/, 'the banner is not mounted');
});

test('a brand-new church can set its name before the relay has answered', () => {
  assert.match(body, /_profileSettle\(/,
    'publishProfile refuses a partial edit outright instead of waiting — the first name a church ever sets is discarded and the wizard advances anyway');
  const at = body.indexOf('_profileSettle(');
  const after = body.slice(at, at + 500);
  assert.match(after, /publishProfile\(meta\)/, 'after the relay answers, the edit must be retried, not dropped');
});

test('the wait is bounded, so a dead relay refuses rather than hanging the save', () => {
  const at = S.indexOf('function _profileSettle');
  assert.notEqual(at, -1, '_profileSettle is gone');
  const f = S.slice(at, at + 600);
  assert.match(f, /Date\.now\(\) - t0 > ms/, 'the settle has no timeout — a console with no relay would hang the save forever');
  assert.match(f, /ms = (?:6000|6e3)/, 'the settle bound should stay short enough that a steward does not think the app froze');
});

test('a delegated steward is refused by name, not by silence', () => {
  assert.match(body, /Only the church that owns this profile/,
    'the delegated refusal must say who CAN make the change, or the steward just retries it');
});
