// A release that REMOVES a file must remove it from every relay — without touching anything else.
// Run: node --test scripts/relay-update-reconcile.test.mjs
//
// AUDIT-2026-07-29 S2. relay-update.sh applied updates with `tar -xzf … -C "$DIR"`, which overlays and
// deletes NOTHING. So every relay served the union of every bundle it had ever installed. Verified on a8 the
// day this was written: /vendor/babel.min.js and /app/app.jsx both returned 200 although the release it had
// just installed removes both.
//
// Three consequences, and the first is the one that matters: a file withdrawn for a SECURITY reason stays
// reachable. That is why the internal documents kept being served after the 2026-07-28 fix — that fix stopped
// them SHIPPING, and only the static denylist stopped them being SERVED.
//
// This runs the real reconcile+sweep block out of scripts/relay-update.sh against a throwaway install tree.
// The half that matters most is not what it deletes — it is what it must NOT: this script runs as ROOT on
// boxes nobody can log into, so an over-eager rule is worse than the leak.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SCRIPT = readFileSync(join(ROOT, 'scripts/relay-update.sh'), 'utf8');

// Lift the block verbatim, so this tests the shipped script rather than a copy of its idea.
function reconcileBlock() {
  const from = SCRIPT.indexOf('# ── RECONCILE:');
  assert.notEqual(from, -1, 'the reconcile block is gone from relay-update.sh');
  // Anchor the END on an explicit marker. Slicing to the last line I happened to recognise cut the block one
  // line short — dropping the trailing `true` — so the extracted fragment ended on a FAILED test and the
  // harness reported a non-zero exit that the real script never produces. A window that stops early again.
  const to = SCRIPT.indexOf('# ── end reconcile+sweep ──', from);
  assert.notEqual(to, -1, 'the reconcile block end-marker is gone from relay-update.sh — re-anchor this test');
  return SCRIPT.slice(from, to);
}

const put = (root, rel, body = 'x') => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), body); };

// Build an install tree + a new bundle, run the block, return which paths survived.
function runUpdate({ manifest, bundleFiles, installed }) {
  const w = mkdtempSync(join(tmpdir(), 'trin-reconcile-'));
  const dir = join(w, 'install'), bun = join(w, 'bundle');
  mkdirSync(join(dir, 'relay'), { recursive: true });
  for (const f of installed) put(dir, f);
  for (const f of bundleFiles) put(bun, f);
  if (manifest) writeFileSync(join(dir, 'relay/installed-files.txt'), [...manifest].sort().join('\n') + '\n');
  writeFileSync(join(w, 'sig'), '');
  const tarball = join(w, 'b.tgz');
  execFileSync('tar', ['-czf', tarball, '-C', bun, '.']);
  const script = `#!/usr/bin/env bash
set -uo pipefail
DIR=${JSON.stringify(dir)}
TARBALL=${JSON.stringify(tarball)}
SIGFILE=${JSON.stringify(join(w, 'sig'))}
log() { echo "LOG $*"; }
${reconcileBlock()}
`;
  const runner = join(w, 'run.sh');
  writeFileSync(runner, script);
  const out = execFileSync('bash', [runner], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const alive = (rel) => existsSync(join(dir, rel));
  const mf = existsSync(join(dir, 'relay/installed-files.txt')) ? readFileSync(join(dir, 'relay/installed-files.txt'), 'utf8').split('\n').filter(Boolean) : [];
  return { alive, log: out, manifest: mf, cleanup: () => rmSync(w, { recursive: true, force: true }) };
}

const INSTALLED = [
  'app/app.jsx', 'vendor/babel.min.js',          // withdrawn by the strict build
  'app/app.js', 'scripts/gateway.mjs',           // still shipped
  'HANDOFF.md', 'docs/design/TREASURY.md', 'reference/SPINE.md',
  'deploy/systemd/trinity-gateway.service', 'ci/job.yml',
  'docker-compose.yml', 'my-notes.txt',          // the OPERATOR's own files
  'relay/admin.json', 'relay/deploy-notes.md',   // operator data, under relay/
  'node_modules/dep.js',                          // not ours to prune
];
const BUNDLE = ['app/app.js', 'scripts/gateway.mjs'];
const OLD_MANIFEST = ['app/app.jsx', 'app/app.js', 'scripts/gateway.mjs', 'vendor/babel.min.js'];

test('a file the release withdrew is removed from the relay', () => {
  const r = runUpdate({ manifest: OLD_MANIFEST, bundleFiles: BUNDLE, installed: INSTALLED });
  try {
    assert.equal(r.alive('app/app.jsx'), false, 'a file this release no longer ships is still on the relay');
    assert.equal(r.alive('vendor/babel.min.js'), false, 'the withdrawn Babel runtime is still on the relay');
  } finally { r.cleanup(); }
});

test('internal documents are swept even without a manifest', () => {
  // The leftovers that predate manifests — every relay updated before 2026-07-28 still holds these, and the
  // reconcile alone would never touch them because it has no record of installing them.
  const r = runUpdate({ manifest: null, bundleFiles: BUNDLE, installed: INSTALLED });
  try {
    for (const f of ['HANDOFF.md', 'docs/design/TREASURY.md', 'reference/SPINE.md',
      'deploy/systemd/trinity-gateway.service', 'ci/job.yml']) {
      assert.equal(r.alive(f), false, f + ' is still on the relay, where only the static denylist stands between it and the world');
    }
  } finally { r.cleanup(); }
});

test('THE IMPORTANT HALF: it does not touch anything that is not ours', () => {
  // This runs as root on boxes nobody can log into. An over-eager rule here is worse than the leak it fixes.
  const r = runUpdate({ manifest: OLD_MANIFEST, bundleFiles: BUNDLE, installed: INSTALLED });
  try {
    assert.equal(r.alive('docker-compose.yml'), true, 'deleted a self-hoster’s own compose file');
    assert.equal(r.alive('my-notes.txt'), true, 'deleted an operator’s own file');
    assert.equal(r.alive('relay/admin.json'), true, 'deleted the relay’s admin token — the operator is locked out');
    assert.equal(r.alive('relay/deploy-notes.md'), true, 'the .md sweep reached inside relay/, which is the operator’s data');
    assert.equal(r.alive('node_modules/dep.js'), true, 'pruned node_modules, which is not ours to prune');
  } finally { r.cleanup(); }
});

test('and the code the relay needs to run survives', () => {
  const r = runUpdate({ manifest: OLD_MANIFEST, bundleFiles: BUNDLE, installed: INSTALLED });
  try {
    assert.equal(r.alive('scripts/gateway.mjs'), true, 'the relay itself was deleted');
    assert.equal(r.alive('app/app.js'), true, 'the served app was deleted');
  } finally { r.cleanup(); }
});

test('the FIRST run deletes nothing by reconcile, and says so', () => {
  // Self-limiting: with no previous manifest it has no record of having installed anything, so it removes
  // nothing on that basis. Only the explicit doc sweep runs. This is what makes shipping it safe.
  const r = runUpdate({ manifest: null, bundleFiles: BUNDLE, installed: ['app/app.jsx', 'app/app.js'] });
  try {
    assert.equal(r.alive('app/app.jsx'), true,
      'with no manifest it deleted a file it had never recorded installing — that is a blanket rule, not a reconcile');
    assert.match(r.log, /no previous manifest/, 'it should say why it removed nothing');
  } finally { r.cleanup(); }
});

test('it records a manifest for next time', () => {
  const r = runUpdate({ manifest: OLD_MANIFEST, bundleFiles: BUNDLE, installed: INSTALLED });
  try {
    assert.deepEqual(r.manifest.sort(), ['app/app.js', 'scripts/gateway.mjs'],
      'the manifest must record exactly what this bundle installed, or the next reconcile is wrong');
  } finally { r.cleanup(); }
});

// ── ARCHITECTURE-AUDIT-2026-07-30 A1: leftovers from BEFORE manifests existed ────────────────────────────
// The reconcile above can only remove what a previous manifest recorded, and the manifest is seeded from the
// current bundle — so a file installed before manifests existed and absent from the bundle now can never
// appear in any manifest. Measured on a8 across a real update on 2026-07-30: eight files deleted from the
// repo, still served, unchanged by the update. The *.md sweep cannot see them (they are .jsx/.html/.js/.png).
//
// The sweep that fixes it is scoped to directories the project owns and carries a sanity floor on the bundle
// listing, so these tests need a REALISTIC bundle — under the floor the sweep is deliberately inert, which is
// why every test above still behaves exactly as it did.
const bigBundle = (extra = []) => [...Array.from({ length: 120 }, (_, i) => `vendor/lib-${i}.js`), 'app/app.js', 'scripts/gateway.mjs', ...extra];

test('A1: a pre-manifest leftover is removed even with NO manifest', () => {
  const installed = ['app/app.js', 'scripts/gateway.mjs',
    'app/screens-onboarding.jsx', 'vendor/react.development.js', 'vendor/steward-finance.js',   // the real a8 leftovers
    'landing-app-today.html', 'welcome-simple.html'];                                            // …and two at the ROOT
  const r = runUpdate({ manifest: null, bundleFiles: bigBundle(), installed });
  try {
    for (const f of ['app/screens-onboarding.jsx', 'vendor/react.development.js', 'vendor/steward-finance.js']) {
      assert.equal(r.alive(f), false, f + ' survived — this is the file class that is permanent on every relay today');
    }
    assert.match(r.log, /pre-manifest leftovers/, 'it removed them without saying so');
    // The root is deliberately NOT swept: an operator's own files live there. These two stay, and the static
    // denylist is what must cover them. Recorded so the limit is visible rather than assumed.
    assert.equal(r.alive('landing-app-today.html'), true, 'the sweep reached the install ROOT — an operator’s own files live there');
  } finally { r.cleanup(); }
});

test('A1: it still does not touch anything that is not ours', () => {
  // Same guarantee as the reconcile, re-asserted for the wider sweep — this is the half that must hold.
  const installed = ['app/app.js', 'scripts/gateway.mjs', 'docker-compose.yml', 'my-notes.txt',
    'relay/admin.json', 'relay/custom.js', 'node_modules/dep.js'];
  const r = runUpdate({ manifest: null, bundleFiles: bigBundle(), installed });
  try {
    assert.equal(r.alive('docker-compose.yml'), true, 'deleted a self-hoster’s own compose file');
    assert.equal(r.alive('my-notes.txt'), true, 'deleted an operator’s own file');
    assert.equal(r.alive('relay/admin.json'), true, 'deleted the admin token — the operator is locked out of their own relay');
    assert.equal(r.alive('relay/custom.js'), true, 'the sweep reached inside relay/, which is the operator’s data');
    assert.equal(r.alive('node_modules/dep.js'), true, 'pruned node_modules, which is not ours to prune');
    assert.equal(r.alive('scripts/gateway.mjs'), true, 'deleted the relay itself');
    assert.equal(r.alive('app/app.js'), true, 'deleted the served app');
  } finally { r.cleanup(); }
});

test('A1: a church’s DOWNLOADED Bible packs are never swept', () => {
  // modules/ is filled on demand at runtime, so a relay legitimately holds packs that were in no bundle.
  // Sweeping there would delete a congregation's own downloads — the single most damaging thing this could do.
  const installed = ['app/app.js', 'scripts/gateway.mjs', 'modules/kjv.mybible', 'modules/strongs-greek.json'];
  const r = runUpdate({ manifest: null, bundleFiles: bigBundle(), installed });
  try {
    assert.equal(r.alive('modules/kjv.mybible'), true, 'deleted a Bible pack the church had downloaded');
    assert.equal(r.alive('modules/strongs-greek.json'), true, 'deleted a downloaded lexicon');
  } finally { r.cleanup(); }
});

test('A1: an implausibly short bundle listing sweeps NOTHING', () => {
  // The failure that would matter: a partial read of the tarball concluding "the release ships almost
  // nothing" and clearing app/ and vendor/ on every relay at once.
  const installed = ['app/app.js', 'app/screens-onboarding.jsx', 'vendor/react.development.js', 'scripts/gateway.mjs'];
  const r = runUpdate({ manifest: null, bundleFiles: ['app/app.js', 'scripts/gateway.mjs'], installed });
  try {
    assert.equal(r.alive('app/screens-onboarding.jsx'), true, 'swept on the strength of a two-file listing');
    assert.equal(r.alive('vendor/react.development.js'), true, 'swept on the strength of a two-file listing');
    assert.match(r.log, /too short to trust/, 'it skipped the sweep without saying why');
  } finally { r.cleanup(); }
});

test('a corrupt bundle listing removes nothing', () => {
  // Fail safe: if the tarball cannot be listed we must not conclude "the release ships nothing" and delete
  // the entire install.
  const w = mkdtempSync(join(tmpdir(), 'trin-corrupt-'));
  const dir = join(w, 'install');
  mkdirSync(join(dir, 'relay'), { recursive: true });
  put(dir, 'app/app.js'); put(dir, 'scripts/gateway.mjs');
  writeFileSync(join(dir, 'relay/installed-files.txt'), 'app/app.js\nscripts/gateway.mjs\n');
  const tarball = join(w, 'not-a-tarball.tgz');
  writeFileSync(tarball, 'this is not a gzip stream');
  const runner = join(w, 'run.sh');
  writeFileSync(join(w, 'sig'), '');
  writeFileSync(runner, `#!/usr/bin/env bash\nset -uo pipefail\nDIR=${JSON.stringify(dir)}\nTARBALL=${JSON.stringify(tarball)}\nSIGFILE=${JSON.stringify(join(w, 'sig'))}\nlog(){ echo "LOG $*"; }\n${reconcileBlock()}\n`);
  try {
    execFileSync('bash', [runner], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    assert.equal(existsSync(join(dir, 'app/app.js')), true, 'an unreadable bundle wiped the install');
    assert.equal(existsSync(join(dir, 'scripts/gateway.mjs')), true, 'an unreadable bundle deleted the relay');
  } finally { rmSync(w, { recursive: true, force: true }); }
});
