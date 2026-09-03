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
  // Anchored FROM the church line, not from the top of the file. Other restore routes legitimately set this
  // same flag (the backup-file route added 2026-08-16 sets it before its reload), and a bare indexOf found
  // whichever appeared first in the file — which silently measured the gap between two unrelated blocks.
  const flagAt = t.indexOf("localStorage.setItem('trinityone.onboarded'", churchAt);
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

// ── THE RESTORE DESTINATION IS UNGATED, AND THAT RESTS ON A HUMAN TYPING IT ─────────────
//
// `restoreChurchData({relayUrl})` POSTs the entire church corpus to a caller-supplied address WITHOUT the
// membership check every other address path now gets. That is deliberate and it is right: this screen's job
// is seeding a box the church is MOVING TO, which by construction is not yet in its membership document, so
// requiring membership would invert time — you could not move onto a relay until you had already moved onto
// it. Same reasoning that keeps the clone SOURCE ungated.
//
// What makes it safe is not the code. It is that a steward TYPES the address on a screen that says what it
// is about to do, rather than it arriving in a link, a directory answer, or a restored backup — the paths
// C5 closed precisely because an address can be chosen FOR somebody there.
//
// SO THIS FILE ENFORCES THE ARGUMENT INSTEAD OF DESCRIBING IT. The moment something calls this in code, the
// "a human typed it" premise is false and the function has no guard at all. If this test fails, do not just
// update the count: either gate the new caller, or explain here why it is also a human typing.
import { test as _rsTest } from 'node:test';
import _rsAssert from 'node:assert/strict';
import { readFileSync as _rsRead, readdirSync as _rsDir } from 'node:fs';

_rsTest('restoreChurchData has exactly one caller, and it is the screen a steward types into', () => {
  const roots = ['app', 'src'];
  const hits = [];
  for (const r of roots) {
    for (const f of _rsDir(new URL('../' + r + '/', import.meta.url))) {
      if (!/\.(jsx|js|mjs)$/.test(f)) continue;
      const src = _rsRead(new URL('../' + r + '/' + f, import.meta.url), 'utf8');
      src.split('\n').forEach((line, i) => {
        if (!/restoreChurchData\s*\(/.test(line)) return;
        if (/async\s+restoreChurchData/.test(line)) return;          // the definition itself
        if (/^\s*(\/\/|\*)/.test(line)) return;                       // prose about it
        hits.push(`${r}/${f}:${i + 1}`);
      });
    }
  }
  // The pin is a LINE number, so any edit above this call moves it and this test goes red without anything
  // being wrong. That is the intended cost — the guard is worth a re-pin — but re-pin only after checking the
  // call itself is unchanged, never by pasting whatever the failure printed. 2026-09-03: moved 6515 -> 6547 by
  // batch 3's edits in DashGroups; the call is byte-identical to 50e196c's, verified with
  //   git show 50e196c:app/stew-dashboard.jsx | sed -n '6515p'
  _rsAssert.deepEqual(hits, ['app/stew-dashboard.jsx:6547'],
    'restoreChurchData is called from somewhere new: ' + JSON.stringify(hits) + '\n' +
    'Its destination is UNGATED, and the only reason that is safe is that a steward types the address on a ' +
    'screen that says what it does. A programmatic caller makes that false and the corpus goes wherever it ' +
    'is told. Gate the new caller, or justify it in the note above this test.');
});

_rsTest('a cleartext restore destination is refused', () => {
  const bundle = _rsRead(new URL('../vendor/steward.js', import.meta.url), 'utf8');
  const i = bundle.indexOf('async restoreChurchData');
  _rsAssert.ok(i > 0, 'restoreChurchData is not in the bundle — re-anchor this test');
  const body = bundle.slice(i, i + 1200);
  _rsAssert.match(body, /wss\|https/,
    'restoreChurchData no longer refuses a cleartext destination. A restore copies the WHOLE church, and ' +
    'ws:// hands it to anyone on the path.');
});
