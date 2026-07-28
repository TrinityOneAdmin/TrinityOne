// The PUBLIC self-host bundle must not carry TrinityOne's internal documentation.
// Run: node --test scripts/bundle-contents.test.mjs
//
// AUDIT-2026-07-28 F2. `/relay-app/bundle.tgz` is public on purpose — the self-host installer curls it and
// every relay's self-update pulls it — and it is a `git archive` of the release ref, so it shipped every
// tracked file regardless of the static handler's denylist. Measured on the release funnel before this fix:
// 200, 54,055,346 bytes, no auth, 61 markdown files including HANDOFF.md, AUDIT-BACKLOG.md,
// AUDIT-2026-07-26-RECOVERY.md and DEVICE-TEST-CHECKLIST.md — documents that name live vulnerabilities and
// the dates they were introduced.
//
// scripts/no-internal-docs.test.mjs asks whether the STATIC HANDLER serves a document. That is a different
// route, and it was green while this was wide open. This file asks what is INSIDE the tarball, by building
// it with the real producers rather than by reasoning about the denylist:
//
//   • scripts/build-strict-tgz.sh   — what the release host actually serves (ensureSignedBundle's strict path)
//   • git archive <ref>             — ensureSignedBundle's fallback AND the un-cached streaming route at
//                                     gateway.mjs:2397, which never consults the cache at all
//
// Both are asserted, because the previous fix covered one route and left the other standing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
// HEAD, not `main`: this must go red on the branch that introduces a leak, not only after it lands. The
// relay resolves RELEASE_REF (default `main`) — on main they are the same commit, which is where releases
// are cut from. `git archive` reads .gitattributes from the TREE it is archiving, so an uncommitted
// exclusion proves nothing and this test will say so.
const REF = 'HEAD';

const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: ROOT, maxBuffer: 512 * 1024 * 1024, ...opts });
const lines = (buf) => String(buf).split('\n').map(s => s.trim()).filter(Boolean).map(s => s.replace(/^\.\//, ''));

// ── the two producers ────────────────────────────────────────────────────────────────────────────────────
function rawArchiveListing() {
  const tar = sh('git', ['archive', '--format=tar', REF]);
  return lines(sh('tar', ['t'], { input: tar }));
}

function strictBundleListing() {
  // The release host's actual output. NOT skipped when esbuild is missing: a silent skip here is how the
  // release gate came to pass with zero coverage of the thing it gates (app-boots, CI with no browser).
  assert.ok(existsSync(join(ROOT, 'node_modules', '.bin', 'esbuild')),
    'esbuild is missing, so the bundle the release host actually serves cannot be built or checked — run npm ci');
  const out = join(tmpdir(), 'trinityone-bundle-test-' + process.pid + '.tgz');
  try {
    sh('bash', [join(ROOT, 'scripts', 'build-strict-tgz.sh'), out, REF], { stdio: ['ignore', 'ignore', 'inherit'] });
    return lines(sh('tar', ['tzf', out]));
  } finally { try { rmSync(out, { force: true }); } catch {} }
}

// Files whose presence is the finding, named explicitly so a failure reads as what it is.
const NAMED = ['HANDOFF.md', 'AUDIT-BACKLOG.md', 'AUDIT-2026-07-26-RECOVERY.md', 'DEVICE-TEST-CHECKLIST.md',
  'docs/design/TREASURY.md', 'reference/SPINE.md', 'reference/PILOT-CHECKLIST.md'];

// The property, not the list. A document added tomorrow is covered without anyone remembering to edit this.
function assertNoInternalDocs(listing, who) {
  const md = listing.filter(f => f.toLowerCase().endsWith('.md'));
  assert.deepEqual(md, [], who + ' ships internal markdown to anyone who curls it');
  const dirs = listing.filter(f => /^(docs|reference)\//.test(f));
  assert.deepEqual(dirs, [], who + ' ships the docs/ or reference/ trees');
  for (const f of NAMED) assert.ok(!listing.includes(f), who + ' still contains ' + f);
}

// Over-tightening is the other way to get this wrong: a bundle that hides a document by failing to install
// a relay is not a fix. These are the files the self-update and the served app genuinely need.
const MUST_SHIP = ['scripts/gateway.mjs', 'scripts/event-store.mjs', 'scripts/relay-update.sh',
  'relay-app/release-pubkey.pem', 'relay-app/control.html', 'version.txt', 'package.json',
  'index.html', 'steward.html', 'vendor/fellowship.js', 'vendor/steward.js', 'engine.js', 'LICENSE'];

function assertStillInstallable(listing, who) {
  for (const f of MUST_SHIP) assert.ok(listing.includes(f), who + ' no longer ships ' + f + ' — the relay cannot run');
}

test('the raw git-archive bundle carries no internal documentation', () => {
  const l = rawArchiveListing();
  assert.ok(l.length > 200, 'the archive listing looks empty (' + l.length + ' entries) — the check is not running');
  assertNoInternalDocs(l, 'the git-archive bundle');
  assertStillInstallable(l, 'the git-archive bundle');
  assert.ok(l.includes('app/app.jsx'), 'the raw bundle must still carry the JSX the lax-CSP fallback serves');
});

test('the strict bundle the release host serves carries no internal documentation', () => {
  const l = strictBundleListing();
  assert.ok(l.length > 200, 'the strict listing looks empty (' + l.length + ' entries) — the check is not running');
  assertNoInternalDocs(l, 'the strict release bundle');
  assertStillInstallable(l, 'the strict release bundle');
  assert.ok(l.includes('app/app.js'), 'the strict bundle must carry the pre-transpiled app, or the strict CSP breaks the app');
  assert.ok(!l.includes('app/app.jsx'), 'the strict bundle still carries untranspiled JSX');
});

// The exclusion has to live somewhere `git archive` honours, in the COMMITTED tree. A working-tree edit
// changes nothing about what ships — which is the trap this fix could quietly fall into.
test('the exclusion is committed, not just present on disk', () => {
  const committed = String(sh('git', ['show', REF + ':.gitattributes']));
  for (const pat of [/^docs\s+export-ignore/m, /^reference\s+export-ignore/m, /^\*\.md\s+export-ignore/m]) {
    assert.match(committed, pat, 'the export-ignore rules are not in the archived tree, so nothing is excluded');
  }
});
