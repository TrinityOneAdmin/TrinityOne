// HELPER PERMISSION PRESETS GRANT EXACTLY THEIR CAPABILITIES — and the DEFAULT under-grants.
// Run: node --test scripts/helper-presets-grant-their-caps.test.mjs
//
// Delegation redesign (2026-11-05). When the owner approves a "helper" (the renamed delegated steward) they
// pick ONE permission PRESET instead of ticking six boxes. presetCaps(id) is the pure mapping from a preset
// id to its capability list; STEWARD_PRESETS is the list the owner chooses from. Both live in the BUNDLE
// (src/steward.src.js -> vendor/steward.js) and are exposed on window.Steward.
//
// HOW IT ASSERTS (CLAUDE.md rules 1 & 3). The real _presetCaps and STEWARD_PRESETS are LIFTED out of the
// SHIPPED bundle (vendor/steward.js) and RUN — no text is matched in app/*.jsx, and nothing is stubbed. If
// _presetCaps is changed to return [] by default, or 'general' is widened to include finance/safeguarding,
// these go red.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody, deps } from './test-slice.mjs';

const VENDOR = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');

// Lift _presetCaps and the STEWARD_PRESETS list it reads, as real code, from the shipped bundle.
const body = fnBody(VENDOR, 'function _presetCaps(id) {', '_presetCaps');
const presetCaps = new Function(deps(VENDOR, body, []) + '\nreturn ' + body)();
const PRESETS = new Function(deps(VENDOR, 'STEWARD_PRESETS', []) + '\nreturn STEWARD_PRESETS;')();

const EXPECT = {
  general: ['care', 'content', 'members'],
  finance: ['finance'],
  safeguarding: ['safeguarding'],
  all: ['finance', 'care', 'safeguarding', 'members', 'content', 'sealedrooms'],
};

test('each preset grants exactly its documented capabilities', () => {
  for (const [id, caps] of Object.entries(EXPECT)) {
    assert.deepEqual(presetCaps(id).slice().sort(), caps.slice().sort(),
      `preset "${id}" no longer grants exactly ${JSON.stringify(caps)}`);
  }
});

test('the DEFAULT preset (general) under-grants — no finance, no safeguarding, no sealed rooms', () => {
  const g = presetCaps('general');
  for (const dangerous of ['finance', 'safeguarding', 'sealedrooms']) {
    assert.ok(!g.includes(dangerous),
      `the default helper preset now grants "${dangerous}" — the default must be conservative`);
  }
});

test('custom returns null so the caller opens the granular editor (never a fixed list)', () => {
  assert.equal(presetCaps('custom'), null);
});

test('an UNKNOWN id falls back to the conservative general bundle, never [] and never everything', () => {
  const r = presetCaps('nonsense-id');
  assert.deepEqual(r.slice().sort(), EXPECT.general.slice().sort(),
    'an unknown preset id must fall back to general — not to an empty grant and not to everything');
  assert.notEqual(r.length, 0, 'an unknown id produced an EMPTY grant — the exact regression this guards');
  assert.notEqual(r.length, 6, 'an unknown id produced EVERYTHING — over-granting by accident');
});

test('STEWARD_PRESETS lists the five presets, general first, and only known capabilities', () => {
  const ids = PRESETS.map((p) => p.id);
  assert.deepEqual(ids, ['general', 'finance', 'safeguarding', 'all', 'custom']);
  const known = new Set(['finance', 'care', 'safeguarding', 'members', 'content', 'sealedrooms']);
  for (const p of PRESETS) {
    if (p.id === 'custom') { assert.equal(p.caps, null); continue; }
    for (const c of p.caps) assert.ok(known.has(c), `preset "${p.id}" names an unknown capability "${c}"`);
  }
});
