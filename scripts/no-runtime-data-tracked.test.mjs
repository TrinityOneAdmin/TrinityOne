// A relay's runtime data must never become source. Run: node --test scripts/no-runtime-data-tracked.test.mjs
//
// ARCHITECTURE-AUDIT-2026-07-30. On 2026-06-26, commit 084b2d4 — titled "Repo tidy (docs-only) … No runtime
// code touched" — swept 640 kB of LIVE RELAY DATABASE into the public GitHub repo via `git add -A`:
//
//     relay/relay.sqlite  relay/relay.sqlite-shm  relay/relay.sqlite-wal  relay/relay-db.json.migrated
//
// It was untracked two commits later, but git history is permanent and those blobs are still fetchable
// anonymously from raw.githubusercontent.com today.
//
// HOW IT HAPPENED, because the mechanism is the point: .gitignore listed ~24 relay files BY INDIVIDUAL NAME.
// Then the event store moved from a JSON file to SQLite and invented four filenames nobody had listed. They
// were untracked but not ignored, so a blanket `git add -A` took them. A denylist that only covers what
// someone already thought of — the same shape as the kind gate (S1), the d-tag gate, and the bundle rule (A5).
//
// gateway.mjs writes to `TRINITY_DATA_DIR || join(ROOT, 'relay')`, so on ANY git checkout the live database
// sits inside the working tree by design. That is not a mistake — it is what makes a checkout runnable — but
// it means the repo is permanently one careless `git add` away from publishing a congregation's data.
//
// .gitignore is now default-deny for relay/. This test is the part that does not rely on anyone remembering:
// it fails if runtime data is tracked ANYWHERE, if the polarity is reverted, or if `git add -f` is used to
// force something in past the ignore rules — which .gitignore cannot prevent by design.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const tracked = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);

// The only things under relay/ that are genuinely source. Anything else there is runtime state.
const RELAY_SOURCE_OK = new Set([
  'relay/dev-relay.mjs',            // the toy NIP-01 relay; package.json's "relay"/"dev" scripts point at it
  'relay/deploy/Caddyfile',         // self-host reference configs, documentation for operators
  'relay/deploy/DEPLOY.md',
  'relay/deploy/config.toml',
  'relay/deploy/docker-compose.yml',
]);

test('nothing under relay/ is tracked except the files that are genuinely source', () => {
  const unexpected = tracked.filter(f => f.startsWith('relay/') && !RELAY_SOURCE_OK.has(f)).sort();
  assert.deepEqual(unexpected, [],
    'these are tracked under relay/, which is where the live database, the admin token, the VAPID private key\n' +
    '    and the church key all live. If one of them is genuinely source, add it to RELAY_SOURCE_OK with a\n' +
    '    reason. If it is runtime state, it must never be committed — see commit 084b2d4 for what that costs');
});

// A CLASS rule, not a list of the four files that actually leaked. Runtime data is not confined to relay/ —
// a future feature could write a database, a key or a subscriber list anywhere in the tree.
const RUNTIME_SHAPED = [
  [/\.sqlite(-shm|-wal|-journal)?$/i, 'a database'],
  [/\.(db|sqlite3)$/i, 'a database'],
  [/(^|\/)(admin|vapid|church|relay-key|push-subs|push-prefs|subscribers|sync-cursors|catalog-key)\.json$/i, 'relay runtime state'],
  [/(^|\/)relay-db\.json/i, 'the legacy event store'],
  [/\.(pem|key|p12|keystore|jks)$/i, 'key material'],
  [/(^|\/)tunnel-url\.txt$/i, 'the live tunnel address'],
  [/\.bak(-\d+)?$/i, 'a backup of live state'],
];
// Justified exceptions, each one deliberate.
const NOT_RUNTIME = new Set([
  'relay-app/release-pubkey.pem',   // the PUBLIC trust anchor — it is meant to ship, and is useless to an attacker
]);

test('no tracked file anywhere in the tree looks like runtime data', () => {
  const hits = [];
  for (const f of tracked) {
    if (NOT_RUNTIME.has(f)) continue;
    for (const [re, what] of RUNTIME_SHAPED) if (re.test(f)) { hits.push(f + '  (' + what + ')'); break; }
  }
  assert.deepEqual(hits.sort(), [],
    'these tracked files match the shape of live runtime data. A relay writes into the working tree, so this\n' +
    '    is how a congregation\'s database, a private key or a member roster ends up in a public repo — and\n' +
    '    once committed it is permanent, even after deletion');
});

test('the relay ignore rule is default-DENY, not a list of names', () => {
  // The polarity IS the fix. A list of filenames passes every test above right up until the day a new
  // filename is invented, which is precisely what happened.
  const gi = readFileSync(join(ROOT, '.gitignore'), 'utf8');
  assert.match(gi, /^relay\/\s*$/m,
    'the whole relay/ directory is no longer ignored. It was reverted to naming individual files — which is\n' +
    '    the exact configuration that let the live database be committed in 084b2d4');
  // and the re-admissions must still be there, or a checkout loses its dev relay
  for (const f of RELAY_SOURCE_OK) {
    if (f === 'relay/dev-relay.mjs') assert.match(gi, /^!relay\/dev-relay\.mjs\s*$/m, 'the dev relay is now ignored — package.json points at it');
  }
  assert.match(gi, /^!relay\/deploy\//m, 'the operator-facing deploy reference configs are now ignored');
});

test('the ignore rule actually holds against a newly-invented filename', () => {
  // Behavioural, not textual: ask git itself, the way the next storage migration will.
  for (const probe of ['relay/relay.duckdb', 'relay/brand-new-store.dat', 'relay/secrets-v2.json', 'relay/nested/deep/thing.json']) {
    const out = execSync(`git check-ignore -v ${probe} || true`, { cwd: ROOT, encoding: 'utf8' });
    assert.match(out, /\.gitignore/, probe + ' is NOT ignored — a `git add -A` would commit it, which is how ' +
      'relay.sqlite reached the public repo');
  }
});

test('the four files that actually leaked are ignored today', () => {
  for (const f of ['relay/relay.sqlite', 'relay/relay.sqlite-shm', 'relay/relay.sqlite-wal', 'relay/relay-db.json.migrated']) {
    const out = execSync(`git check-ignore -v ${f} || true`, { cwd: ROOT, encoding: 'utf8' });
    assert.match(out, /\.gitignore/, f + ' — the file that leaked — is not ignored');
  }
});
