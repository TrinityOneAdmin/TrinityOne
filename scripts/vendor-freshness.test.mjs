// vendor/ must match src/ — SECURITY-AUDIT-2026-07-20 C1/H2 (build).
// Run: node --test scripts/vendor-freshness.test.mjs
//
// WHY. There is no bundler for the app, so `src/*.src.js` is compiled by hand into `vendor/*.js` via nine
// scripts/build-*.sh, and BOTH packaging paths consume vendor/ verbatim: sync-web.sh copies it into the APK,
// build-pages.sh and build-strict-tgz.sh `git archive` it. scripts/release.sh invokes NONE of those build
// scripts and runs no tests, so "did I rebuild the bundle?" was a purely human step with no checkpoint.
// It failed in practice: vendor/finance-ledger.js shipped 3 commits behind src/finance-statement.mjs, so
// every church sharing a financial statement got an unbranded document, live, for days. The existing suites
// could not catch it because they import src/ — they test code that is not the code that ships.
//
// This test runs the REAL build scripts (never a second copy of their esbuild flags — duplicating those is
// the very drift that caused the bug) and asserts each output is byte-identical to what is committed. The
// working tree is restored afterwards whether the test passes or fails.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// build script -> the vendor artifact it produces
const BUNDLES = [
  ['build-fellowship.sh',   'vendor/fellowship.js'],
  ['build-identity.sh',     'vendor/identity.js'],
  ['build-mydata.sh',       'vendor/mydata.js'],
  ['build-recovery.sh',     'vendor/recovery.js'],
  ['build-steward.sh',      'vendor/steward.js'],
  ['build-steward-meals.sh', 'vendor/steward-meals.js'],
  ['build-steward-manna.sh', 'vendor/steward-manna.js'],
  ['build-finance.sh',      'vendor/finance-ledger.js'],
  ['build-wallet.sh',       'vendor/wallet.js'],
];

// esbuild stamps each bundled module's path into the output as a `// <path>` comment. That path is relative
// to the build cwd, so a checkout where node_modules is NOT a real directory inside the tree (a git
// worktree sharing a parent's, a pnpm/hoisted layout, a symlink) emits `../../../mnt/.../node_modules/x`
// where the primary checkout emits `node_modules/x`. Comparing raw bytes therefore reported six bundles
// stale in any worktree — a FALSE positive that, because this same commit wires `npm test` into release.sh
// as a hard gate and into CI, would block every release. Normalise those prefixes before comparing; they
// are provenance comments, not semantics. (REVIEW-2026-07-20 B5.)
// NB: the path appears BOTH as a `// comment` and as a quoted key in esbuild's CommonJS module registry
// (`"node_modules/x/y.js"(exports, module) { … }`), so this must be a general rewrite, not a comment-only
// one. Anchoring on the `../` prefix means output from a normal checkout is left completely untouched.
const normalise = (buf) => Buffer.from(
  buf.toString('utf8').replace(/(?:\.\.\/)+[^\s"'`]*?node_modules\//g, 'node_modules/')
);

test('every vendor/ bundle is rebuildable and matches its source', { timeout: 180000 }, () => {
  const originals = new Map();
  for (const [, out] of BUNDLES) {
    const p = join(ROOT, out);
    if (existsSync(p)) originals.set(p, readFileSync(p));
  }
  const stale = [], broken = [];
  try {
    for (const [script, out] of BUNDLES) {
      const sp = join(ROOT, 'scripts', script);
      if (!existsSync(sp)) { broken.push(`${script}: missing`); continue; }
      try {
        execFileSync('bash', [sp], { cwd: ROOT, stdio: 'pipe' });
      } catch (e) {
        // A build script that cannot even RUN is worse than a stale bundle: every later edit to its source
        // silently ships the previous binary. build-steward.sh sat in exactly this state (undeclared fflate).
        broken.push(`${script}: ${String(e.stderr || e.message).trim().split('\n').slice(-3).join(' | ')}`);
        continue;
      }
      const p = join(ROOT, out);
      const before = originals.get(p), after = existsSync(p) ? readFileSync(p) : null;
      if (!after) { broken.push(`${script}: produced no ${out}`); continue; }
      if (!before || !normalise(before).equals(normalise(after))) stale.push(out);
    }
  } finally {
    for (const [p, buf] of originals) { try { writeFileSync(p, buf); } catch {} }   // never leave the tree dirty
  }

  assert.deepEqual(broken, [], 'build script(s) failed to run — the bundle cannot be reproduced from source:\n  ' + broken.join('\n  '));
  assert.deepEqual(stale, [], 'committed bundle(s) do not match src/ — run the matching scripts/build-*.sh and commit:\n  ' + stale.join('\n  '));
});
