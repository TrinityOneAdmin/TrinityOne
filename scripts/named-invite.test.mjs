// A NAMED INVITE MUST ARRIVE NAMED. Run: node --test scripts/named-invite.test.mjs
//
// THE DEFECT (user-flow audit, confirmed by driving it). Bulk invite slips carry the person's name
// (`?name=Deborah`), and migrate.html tells the pastor their directory "fills itself in, because everyone
// arrives already named". It did not. Driven end to end before the fix:
//
//     the name box when they arrive: {"present":true,"value":""}
//     what the button offers:        "Continue without a name"
//
// A church printing 200 named slips got 200 members the steward sees as Anonymous, and someone repairs it by
// hand. Two things caused it, and only fixing both works:
//
//   1. The wizard's name box started empty and finish() writes `name: name.trim()`, so it was written OVER
//      anything the arriving link had managed to set.
//   2. The name was captured in an effect. The wizard mounts BEFORE that effect runs, and a ref written
//      afterwards never re-renders — so the box stayed empty however correctly the name was captured. That
//      second one is why an obvious-looking fix reported success and changed nothing; see the probe.
//
// scripts/named-invite.probe.mjs drives the real first-run wizard and prints what the box actually holds.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const APP = readFileSync(new URL('../app/app.jsx', import.meta.url), 'utf8');
const ID = readFileSync(new URL('../app/identity.jsx', import.meta.url), 'utf8');

test('the wizard offers the name the invite carried', () => {
  assert.match(ID, /function IdentityOnboarding\(\{[^}]*suggestedName/,
    'the wizard cannot receive the invited name at all');
  assert.match(ID, /useId\(suggestedName \|\| ''\)/,
    'the name box still starts empty, so finish() writes that empty value over the invited name');
});

test('re-opening the wizard does not wipe the invited name', () => {
  const at = ID.indexOf('useIdE(() => { if (open) {');
  const line = ID.slice(at, ID.indexOf('\n', at));
  assert.match(line, /setName\(suggestedName \|\| ''\)/,
    'opening the wizard resets the box to empty, undoing the prefill for anyone who backs out and returns');
});

test('the name is read early enough to be rendered', () => {
  assert.match(APP, /if \(pendingNameRef\.current === null\) \{/,
    'the invited name is captured in an effect. The wizard mounts first and a ref set afterwards never ' +
    're-renders, so the box stays empty and the fix silently does nothing');
  assert.match(APP, /suggestedName=\{pendingNameRef\.current\}/, 'the wizard is never handed the name');
});

test('an existing member is not renamed by a link', () => {
  assert.match(APP, /if \(!lsGet\('trinityone\.onboarded', false\)\) n = /,
    'the prefill is not limited to first run — a follow link with ?name= would offer to rename someone who ' +
    'already has an account');
});
