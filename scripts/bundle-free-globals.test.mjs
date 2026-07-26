// No shipped bundle may reference a CONSTANT it never declares.
// Run: node --test scripts/bundle-free-globals.test.mjs
//
// THE BUG THIS EXISTS FOR (2026-07-26). `MEMBER_D` ('trinityone/member:') was declared as a LOCAL inside
// _memHubOpen(), while recoverIdentity() — the 12-word account restore — also referenced it. esbuild renamed
// the local and left the other reference dangling, so every church document the relay delivered during a
// restore threw `ReferenceError: MEMBER_D is not defined` INSIDE nostr-tools' event handler, which logs a
// warning and swallows it. The member got their name back (the kind-0 branch returns before that line) and
// ZERO churches — on a device that had the document in hand. It looked like a permissions/timing problem and
// three separate "fix" attempts were aimed at authentication timing; none of them could ever have worked.
//
// Confirmed on the OPPO test phone against the live relay: with MEMBER_D undefined, recoverIdentity returned
// {name:'Sir Lloyd', churches:[]}; defining it as a global made the SAME call return the real church.
//
// This is the silent-failure class that keeps recurring here (see also the duplicate top-level names that
// blanked the APK): a green test suite, no crash, a screen that just renders nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const BUNDLES = ['vendor/fellowship.js', 'vendor/identity.js', 'vendor/steward.js', 'vendor/mydata.js', 'vendor/wallet.js'];

// Real runtime globals that legitimately appear unqualified, plus names only ever used as properties.
const ALLOWED = new Set(['NaN', 'MAX_SAFE_INTEGER', 'MIN_SAFE_INTEGER', 'POSITIVE_INFINITY', 'NEGATIVE_INFINITY']);

const CONST_RE = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g;

// Remove comments and string/template literals so text INSIDE them can't look like an identifier
// (a vendored lib really does use the string "CAP_COOKIE" as a split delimiter).
function stripLiterals(src) {
  let out = '', i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const q = c; i++;
      while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++; }
      i++; out += '""'; continue;
    }
    out += c; i++;
  }
  return out;
}

export function freeConstants(src) {
  const code = stripLiterals(src);
  const declared = new Set();
  for (const m of code.matchAll(/(?:var|let|const|function|class)\s+([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\b/g)) declared.add(m[1]);
  for (const m of code.matchAll(/([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\s*(?:[:=](?!=))/g)) declared.add(m[1]);   // obj keys, assignments, params
  const free = new Set();
  for (const m of code.matchAll(CONST_RE)) {
    const name = m[0];
    if (declared.has(name) || ALLOWED.has(name)) continue;
    if (code[m.index - 1] === '.') continue;            // property access: Number.MAX_SAFE_INTEGER
    free.add(name);
  }
  return [...free];
}

for (const rel of BUNDLES) {
  test(`${rel} declares every constant it uses`, () => {
    if (!existsSync(new URL('../' + rel, import.meta.url))) return;
    const src = readFileSync(new URL('../' + rel, import.meta.url), 'utf8');
    const free = freeConstants(src);
    assert.deepEqual(free, [],
      `${rel} references ${free.join(', ')} but never declares it. At runtime that is a ReferenceError thrown ` +
      `wherever it is used — and inside a relay event handler nostr-tools swallows it, so the feature silently ` +
      `returns nothing instead of failing loudly.`);
  });
}

test('the scan actually bites (sabotage check)', () => {
  // exactly the shape of the real bug: used twice, declared nowhere
  const sabotaged = 'function f(d){ return d.startsWith(MEMBER_D) ? d.slice(MEMBER_D.length) : ""; }';
  assert.deepEqual(freeConstants(sabotaged), ['MEMBER_D'], 'the scan must catch an undeclared constant');
  // and does not fire on the same code once it IS declared
  assert.deepEqual(freeConstants('const MEMBER_D = "x";\n' + sabotaged), []);
  // and is not fooled by the name appearing only inside a string
  assert.deepEqual(freeConstants('const s = "MEMBER_D";'), []);
});
