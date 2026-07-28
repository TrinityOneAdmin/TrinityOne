// A 12-word restore must save what it recovers. Run: node --test scripts/restore-scope.test.mjs
//
// Proven on a child's phone, 2026-07-28: `typeof saveIdentity` was "undefined" in the live app, and calling
// it threw ReferenceError. identity.jsx was calling it anyway — it is a local inside a component in app.jsx,
// and these are classic scripts, so only TOP-LEVEL declarations cross files. The surrounding empty catch ate
// the throw and the two lines after it never ran: the church list and the onboarded flag. The member got a
// working identity, no church, and a bounce back to "Welcome to TrinityOne" seconds after finding their
// church. It only bit when a NAME came back, which is why every earlier restore test passed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('../app/', import.meta.url);
const ID = readFileSync(new URL('identity.jsx', dir), 'utf8');
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/^\s*\/\/.*$/, '')).join('\n');

test('the restore does not call a function that lives in another file’s inner scope', () => {
  assert.doesNotMatch(code(ID), /(^|[^.\w])saveIdentity\s*\(/,
    'identity.jsx calls saveIdentity(), which is declared inside a component in app.jsx and is not in scope here');
});

test('it sets the profile through something that IS in scope', () => {
  const at = code(ID).indexOf('if (found.name)');
  assert.notEqual(at, -1, 'the recovered-name branch is gone');
  assert.match(code(ID).slice(at, at + 260), /window\.Fellowship|FS\.setProfile/,
    'the recovered name is saved through an unreachable symbol again');
});

test('each restore step stands alone, so one failure cannot take the others', () => {
  // The cascade is what turned a cosmetic name problem into "you are not a member of any church".
  const t = code(ID);
  const nameAt = t.indexOf('if (found.name)');
  const churchAt = t.indexOf('if (found.churches.length)');
  const flagAt = t.indexOf("localStorage.setItem('trinityone.onboarded'");
  assert.ok(nameAt !== -1 && churchAt !== -1 && flagAt !== -1, 'the restore block changed shape — re-read it');
  const between = (a, b) => t.slice(a, b);
  assert.match(between(nameAt, churchAt), /catch \(e\) \{\}\s*try \{/,
    'the church list shares a try with the name, so a throw on the name loses the church too');
  assert.match(between(churchAt, flagAt), /catch \(e\) \{\}\s*try \{/,
    'the onboarded flag shares a try with the church list');
});

test('no .jsx calls a bare saveIdentity anywhere it is not declared', () => {
  // The general form of the same mistake, across every classic script in the app.
  for (const f of readdirSync(dir).filter(n => n.endsWith('.jsx'))) {
    const t = code(readFileSync(new URL(f, dir), 'utf8'));
    if (!/(^|[^.\w])saveIdentity\s*\(/.test(t)) continue;
    assert.match(t, /(?:^|\n)\s*const saveIdentity\s*=|(?:^|\n)\s*function saveIdentity\b/,
      f + ' calls saveIdentity() without declaring it — it will throw ReferenceError when that line runs');
  }
});
