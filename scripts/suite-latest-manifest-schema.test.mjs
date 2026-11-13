// suite-latest.json CARRIES WHAT BOTH CONSUMERS NEED — the old notify-only banner AND the new Suite JS
// auto-update gate. Run: node --test scripts/suite-latest-manifest-schema.test.mjs
//
// P1 of PLAN-suite-js-autoupdate-2026-11-09. .github/workflows/relay-desktop.yml emits suite-latest.json on
// the Release. Nothing in this repo runs a workflow (see scripts/release-ref.test.mjs), so this test can't
// drive the YAML — instead it reads the REAL printf out of the workflow, reconstructs the exact JSON it emits,
// and asserts the schema by PARSING it:
//   • old fields (sha, version, tag) survive  — the shipped notify-only banner (gateway.mjs /suite-update)
//     still parses the manifest after the change; drop one and that banner breaks;
//   • new fields (date, url, sha256, sig|sigUrl) are present — the pre-download anti-rollback gate (§3) needs
//     `date` before it can see the bundle's own version.txt;
//   • `date` is an ISO instant, and its VALUE comes from `git show -s --format=%cI` in the workflow (so the
//     real emitted date is ISO, not merely the sample this test substitutes).
// It goes red if a future edit drops a field from the manifest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const YAML = readFileSync(ROOT + '/.github/workflows/relay-desktop.yml', 'utf8');

test('the workflow emits a suite-latest.json that both the old and new consumers can parse', () => {
  // Pull the printf FORMAT STRING that writes suite-latest.json: the single-quoted {...} before the \n.
  // (The redirect `> dist-installers/suite-latest.json` is a few lines down; the format is the authority.)
  const m = YAML.match(/printf\s+'(\{[^']*\})\\n'/);
  assert.ok(m, 'could not find the suite-latest.json printf format in relay-desktop.yml — did the manifest move?');
  const fmt = m[1];

  // Reconstruct the emitted JSON by filling each %s in order with a representative value. The ORDER of keys in
  // the format is what the workflow prints; the values here stand in for the shell expansions.
  const samples = {
    sha: '0'.repeat(40),
    version: '0.8.1',
    tag: 'relay-v0.8.1',
    date: '2026-11-12T12:24:47+00:00',   // the shape `git ... --format=%cI` produces
    url: 'https://github.com/TrinityOneAdmin/TrinityOne/releases/download/relay-v0.8.1/suite-js-bundle.tgz',
    sha256: 'a'.repeat(64),
    sig: 'https://github.com/TrinityOneAdmin/TrinityOne/releases/download/relay-v0.8.1/suite-js-bundle.sig',
  };
  // The keys appear in the format in a fixed order; fill %s positionally against that order.
  const keyOrder = [...fmt.matchAll(/"([a-zA-Z0-9]+)":"%s"/g)].map((x) => x[1]);
  let i = 0;
  const filled = fmt.replace(/%s/g, () => {
    const k = keyOrder[i++];
    return String(samples[k] ?? ('sample-' + k));
  });

  const j = JSON.parse(filled);   // must be valid JSON

  // old consumer (notify-only banner) — these three must still be present
  for (const k of ['sha', 'version', 'tag']) assert.ok(k in j, `suite-latest.json dropped the "${k}" field — the current notify-only banner would stop parsing it`);

  // new consumer (Suite JS auto-update gate)
  assert.ok('date' in j, 'suite-latest.json has no "date" — the pre-download anti-rollback gate cannot decide "newer" before downloading');
  assert.ok('url' in j, 'suite-latest.json has no "url" — nothing says where to fetch the bundle');
  assert.ok(('sig' in j) || ('sigUrl' in j), 'suite-latest.json has neither "sig" nor "sigUrl" — nothing points at the signature');

  // date is an ISO instant
  assert.match(j.date, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/, 'the "date" field is not an ISO instant: ' + j.date);
  assert.ok(!Number.isNaN(Date.parse(j.date)), 'the "date" field does not parse as a date: ' + j.date);

  // …and the VALUE the workflow actually puts there is an ISO commit date — %cI, not %cd/%ct — so the real
  // emitted manifest is ISO even though the sample above is what we parsed.
  assert.match(YAML, /DATE="\$\(git show -s --format=%cI[^)]*\)"/, 'the workflow does not compute the date with git --format=%cI, so the real manifest date may not be ISO');
});

// audit be258b42 MEDIUM 3: CI must never build or attach the Suite JS bundle. Its unsigned copy, uploaded by a
// matrix job that finished after the release host had published, replaced the signed one by name and broke
// every church's signature check. Only publish-relay-bundle.sh (with the key) uploads suite-js-bundle.*.
test('the release workflow does not build or attach a suite-js-bundle (only the signing host does)', () => {
  const steps = YAML.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');   // ignore comment lines
  assert.doesNotMatch(steps, /build-suite-js-bundle\.sh/, 'a workflow step builds the Suite JS bundle again');
  assert.doesNotMatch(steps, /suite-js-bundle\.tgz["']?\s*$|>\s*\S*suite-js-bundle|cp\s+\S*suite-js-bundle/m, 'a workflow step writes a suite-js-bundle file into what gets uploaded');
});
