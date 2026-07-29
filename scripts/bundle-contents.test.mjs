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
// FILES only. tar lists directory entries too ('android/', and './' for the archive root, which the ./-strip
// below turns into ''), and they carry no content — an allowlist that had to enumerate every intermediate
// directory would be noise, and the empty string is not a path at all. AUDIT-2026-07-30 A5.
const lines = (buf) => String(buf).split('\n').map(s => s.trim()).filter(Boolean)
  .map(s => s.replace(/^\.\//, '')).filter(s => s && !s.endsWith('/'));

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
  'docs/design/TREASURY.md', 'reference/SPINE.md', 'reference/PILOT-CHECKLIST.md',
  // F3/F4: the relay refuses to SERVE these, but it was still copying them onto every church's box.
  // deploy/ is this box's own systemd units — the install path, the service account, the Node version.
  // A self-hoster never needs them: relay-app/install.sh writes its unit files inline.
  'deploy/systemd/trinity-gateway.service', 'deploy/systemd/trinity-relay.service',
  'ci/ios-simulator-smoke.job.yml'];

// ── ARCHITECTURE-AUDIT-2026-07-30 A5: an ALLOWLIST, because the denylist was the wrong polarity ───────────
// This used to assert "no *.md, nothing under four named directories, and none of these named files". That is
// a denylist, and it has the failure mode this repo has now hit three times: it can only ever catch the class
// somebody already thought of. Its own sibling, no-internal-docs.test.mjs, guards the SERVED route with a
// genuine allowlist (SERVE_OK) whose comment says "anything not covered here has to be justified before it
// gets added — which is the point". The bundle route has the LARGER blast radius — it is a world-downloadable
// tarball that every self-hoster and every relay self-update consumes — and it had the weaker rule.
//
// What the denylist missed, measured against the real 52 MB release bundle: 92 *.test.mjs files (52 of them
// narrating audit findings by ID and date — the very content F2 removed the documents for), .github/
// workflows, the Suite's Tauri build sources, and capacitor.config.json, which states in four lines that
// every shipped Android build has webContentsDebuggingEnabled: true.
//
// So: state what a relay needs in order to RUN, by category and with a reason, and make everything else a
// failure that someone has to justify. A new `notes/` directory, a stray key, an .env.example — none of them
// needs to have been predicted.
const BUNDLE_OK = (f) =>
  // the three programs and everything they load
  /^(app|src|vendor|assets|icons|modules)\//.test(f)
  // the relay itself: gateway, event store, the updater, the build scripts a release host runs
  || (/^scripts\//.test(f) && !/\.(test|probe)\.mjs$/.test(f))
  // the relay's own app: control UI, installer, launchers, trust anchor — but not its desktop BUILD tree
  || (/^relay-app\//.test(f) && !/^relay-app\/desktop\//.test(f))
  // the served web surface at the repo root, plus the manifests the app fetches by name
  || (!f.includes('/') && /\.(html|js|mjs|jsx|css|json|png|jpe?g|webp|avif|svg|ico|txt|webmanifest)$/i.test(f))
  // named, extensionless or odd, each deliberate
  || ['LICENSE', 'version.txt', '.gitignore', '.gitattributes', '.nojekyll'].includes(f)
  || /^decks\/.*\.pdf$/.test(f)         // about.html links these
  // The dev relay. Kept IN deliberately: package.json ships, and its "relay" and "dev" scripts point straight
  // at this file, so dropping it would ship a manifest with dangling scripts. It is a toy NIP-01 relay's
  // source, not a secret, and both extractors pass `--exclude='relay/*'` so it is never even unpacked.
  || f === 'relay/dev-relay.mjs'
  // Tracked despite android/ being gitignored, so it rides along in the archive. Nothing on the bundle path
  // reads it — only an APK build from a git checkout does. Not sensitive (app id, permissions, allowBackup),
  // so it is allowed rather than excluded; dropping it is a tidy-up, not a fix, and every exclusion is risk.
  || f === 'android/app/src/main/AndroidManifest.xml';

// Things that are never right ANYWHERE in the tarball, whatever else the rules say. Belt and braces: these
// are also covered above, and pinning them separately means a widened allowlist cannot silently readmit them.
const NEVER = [
  [/\.md$/i, 'internal documentation'],
  [/\.(test|probe)\.mjs$/, 'the test suite — 52 of these narrate audit findings by ID and date'],
  [/^(docs|reference|deploy|ci)\//, 'a tree that describes the box rather than running it'],
  [/^\.github\//, 'CI workflow definitions'],
  [/^relay-app\/desktop\//, 'the Suite Tauri build tree'],
  [/^capacitor\.config\.json$/, 'it states that shipped Android builds have remote WebView debugging on'],
  [/\.(pem|key|p12|keystore|jks)$/i, 'key material'],
  [/^\.env/, 'environment/secret files'],
];

function assertNoInternalDocs(listing, who) {
  for (const [re, why] of NEVER) {
    const hit = listing.filter(f => re.test(f) && f !== 'relay-app/release-pubkey.pem');   // the PUBLIC trust anchor ships on purpose
    assert.deepEqual(hit, [], who + ' ships ' + why);
  }
  const unexpected = listing.filter(f => !BUNDLE_OK(f)).sort();
  assert.deepEqual(unexpected, [],
    who + ' ships these, and nothing in BUNDLE_OK covers them. A relay needs the code that RUNS it; anything\n' +
    '    else has to be justified here with a reason, or stop shipping. (This is the check that was a\n' +
    '    denylist and therefore could not see the test suite, the CI workflows or capacitor.config.json.)');
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
  for (const pat of [/^docs\s+export-ignore/m, /^reference\s+export-ignore/m, /^\*\.md\s+export-ignore/m,
    /^deploy\s+export-ignore/m, /^ci\s+export-ignore/m,
    // A5
    /^\*\.test\.mjs\s+export-ignore/m, /^\*\.probe\.mjs\s+export-ignore/m,
    /^capacitor\.config\.json\s+export-ignore/m, /^\.github\s+export-ignore/m,
    /^relay-app\/desktop\s+export-ignore/m]) {
    assert.match(committed, pat, 'the export-ignore rules are not in the archived tree, so nothing is excluded');
  }
});
