// A BOX ADOPTED FROM THE CHURCH'S SIGNED LIST ARMS ITS NAME→ROW BINDING — SO IT FOLLOWS WHEN IT CHURNS.
// Run: node --test scripts/a-relay-adopted-from-the-net-doc-takes-its-name.test.mjs
//
// SPEC-relay-self-healing-2026-11-03 §1 (audit-corrected item 1 — the real root cause). Before this, the
// name→row binding refreshNamedRelays follows was created by connect-by-name ALONE. A box that entered the
// list by net-doc adoption recorded NO name, so when its Cloudflare tunnel address churned it rendered as a
// raw url and never followed — the measured defect (three boxes re-claimed their names; the console showed
// raw urls). This proves the two parts of the fix:
//   · the adoption path CALLS the arming helper with the proved key, on both the add and swap branches;
//   · the helper persists the entry's directory handle AND that proved key, and leaves a nameless entry raw.
//
// POINT OF USE (CLAUDE.md rule 1): the REAL adoptNetDocAddresses and the REAL _rememberAdoptedName are lifted
// out of src/steward.src.js and RUN. Delete the arming call and part 1 goes red; make the helper drop the
// name or the key and part 2 goes red. Binds no port, spawns nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseRelayNet } from '../src/relay-net.src.js';
import { fnBody } from './test-slice.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const SRC = readFileSync(join(ROOT, 'src/steward.src.js'), 'utf8');

const CHURCH = 'f'.repeat(64);
const KEY_A = 'a'.repeat(64);
const BOX_URL = 'wss://triangle-homeland-interests.trycloudflare.com/relay';
const HANDLE = 'true-reed-88';

// ── 1. THE ADOPTION PATH CALLS THE ARMING HELPER WITH THE PROVED KEY ─────────────────────────────────────

test('adopting a named box from the signed list calls _rememberAdoptedName(entry, url, provedKey)', async () => {
  const armed = [];
  const entry = { pubkey: KEY_A, alwaysOn: true, url: BOX_URL, name: HANDLE };
  const scope = {
    pub: CHURCH, churchPub: CHURCH,
    relayNetDoc: async () => ({ ev: { pubkey: CHURCH, content: JSON.stringify([entry]) }, askedUrls: [], answeredUrls: [] }),
    parseRelayNet,
    _readCovers: () => true,
    retireDeadAdoptedRows: async () => [],
    _netDocDialUrl: (u) => u,
    _isDeclined: () => false,
    _staleBoxSpelling: () => '',            // a fresh add, not a replacement
    extraRelays: () => [],
    NETDOC_ADOPT_MAX: 8,
    isOwnRelaySpelling: () => false,
    isSharedRelaySpelling: () => false,
    _alreadyACandidate: () => false,
    verifyRelayIdentity: async () => ({ relayPub: KEY_A }),   // the box proves the key the entry names
    admitRemoteRelay: async () => true,
    window: { Steward: { addRelay: () => true } },
    _tagAdopted: () => {},
    adoptedRelays: () => [],
    setAdoptedRelays: () => {},
    _writeExtraRelays: () => {},
    _rememberAdoptedName: (e, url, proved) => { armed.push({ name: e && e.name, url, proved }); },
  };
  const names = Object.keys(scope);
  const adopt = new Function(...names, fnBody(SRC, 'async function adoptNetDocAddresses(', 'adoptNetDocAddresses') + '\nreturn adoptNetDocAddresses;')(...names.map(n => scope[n]));

  const added = await adopt();
  assert.deepEqual(added, [BOX_URL], 'the box was not adopted — re-anchor this test');
  assert.equal(armed.length, 1, 'adoption did NOT arm the name binding — a churned box would never follow (the measured defect)');
  assert.deepEqual(armed[0], { name: HANDLE, url: BOX_URL, proved: KEY_A },
    'the binding was armed with the wrong name, address or key');
});

// ── 2. THE HELPER PERSISTS THE HANDLE AND THE PROVED KEY, AND SKIPS A NAMELESS ENTRY ─────────────────────

function liftHelper(remember) {
  const scope = {
    _RELAY_NAME_RE: /^[a-z0-9][a-z0-9-]{0,62}$/,
    window: { Steward: { rememberRelayName: remember } },
  };
  const names = Object.keys(scope);
  return new Function(...names, fnBody(SRC, 'function _rememberAdoptedName(', '_rememberAdoptedName') + '\nreturn _rememberAdoptedName;')(...names.map(n => scope[n]));
}

test('_rememberAdoptedName remembers a valid handle with the proved key (lower-cased)', () => {
  const calls = [];
  const h = liftHelper((...a) => calls.push(a));
  h({ pubkey: KEY_A, url: BOX_URL, name: 'True-Reed-88' }, BOX_URL, KEY_A);
  assert.deepEqual(calls, [['true-reed-88', BOX_URL, KEY_A]],
    'the adopted box was not pinned by name + key, so refreshNamedRelays cannot safely follow it');
});

test('_rememberAdoptedName leaves a nameless or malformed entry raw (no binding)', () => {
  const calls = [];
  const h = liftHelper((...a) => calls.push(a));
  h({ pubkey: KEY_A, url: BOX_URL }, BOX_URL, KEY_A);                 // no name
  h({ pubkey: KEY_A, url: BOX_URL, name: 'Not A Handle!' }, BOX_URL, KEY_A);   // not a handle slug
  assert.equal(calls.length, 0, 'a box with no valid handle was given a name binding it should not have');
});
