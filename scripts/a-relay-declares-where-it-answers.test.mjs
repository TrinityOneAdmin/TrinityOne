// A RELAY MUST KNOW ITS OWN ADDRESS WITHOUT BEING TOLD, AND THE UPDATE MUST NOTICE WHEN IT DOES NOT.
//
// This file exists because of a defect that shipped in the commit before it and was caught by audit rather
// than by anything here. §1 made a relay refuse to sign an address it does not declare — correct — and
// NOTHING ANYWHERE CREATED THE FILE THAT DECLARES ONE. Every relay in the fleet would have refused every
// member at its public address, while `/status` on loopback stayed green, the update script reported
// "relay healthy", and the automatic rollback never fired. A correct relay, silently refused, with every
// check passing: the exact shape CLAUDE.md exists to stop.
//
// Two properties, and the second is the one that was missing:
//   1. a box declares the addresses it genuinely answers at, derived from what it already knows
//   2. asking it on loopback CANNOT tell you whether it will answer where members actually reach it
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as H from './relay-network-harness.mjs';

let R;
before(async () => { R = await H.startRelay({ name: 'declares' }); });
after(() => H.stopAll());

const nonce = () => [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
const ask = async (base, want) => {
  const u = base + '/relay-identity?nonce=' + nonce() + (want ? '&for=' + encodeURIComponent(want) : '');
  const r = await fetch(u);
  return { status: r.status, body: await r.json().catch(() => null) };
};

test('a box declares its loopback address with no configuration at all', async () => {
  // The Suite's first run and every test in this repo depend on this: the console dials the box that served
  // it before anything has been configured, and a relay that refused there would be bricked on first launch.
  for (const form of [R.wsUrl, R.base, R.base + '/relay']) {
    const got = await ask(R.base, form);
    assert.equal(got.status, 200, `a box refused its own loopback address in the form ${form}`);
  }
});

test('an address it does not answer at is refused, and says so in a way an operator can act on', async () => {
  const got = await ask(R.base, 'wss://not-this-box.example/relay');
  assert.equal(got.status, 421, 'the box signed an address it does not answer at');
  assert.equal(got.body && got.body.code, 'undeclared-address',
    'the refusal is not machine-readable, so nothing can tell an operator what to fix');
  assert.ok(got.body && got.body.file, 'the refusal does not name where the operator should declare it');
});

test('RELAY_PUBLIC_URL is declared without any file being written', async () => {
  // THE FIX FOR THE DEFECT THIS FILE IS NAMED AFTER. A relay takes its public address from what it already
  // knows — the tunnel it spawned, the funnel it runs behind, or this variable — so an operator configures
  // nothing in the deployments we actually ship. If this regresses, the fleet goes dark silently.
  const pub = 'wss://declared.example/relay';
  const box = await H.startRelay({ name: 'withpublic', env: { RELAY_PUBLIC_URL: pub } });
  try {
    assert.equal((await ask(box.base, pub)).status, 200,
      'a relay did not declare the public address it was given, so it will refuse every member who reaches ' +
      'it there while answering perfectly on loopback');
    assert.equal((await ask(box.base, 'wss://declared.example')).status, 200,
      'the bare origin of its own public address was refused');
    assert.equal((await ask(box.base, 'wss://somebody-else.example/relay')).status, 421,
      'declaring one public address made it sign any address at all');
  } finally { box.stop(); }
});

test('loopback health cannot see a box that will refuse its public address', async () => {
  // The property the update script's old check did not have. Both of these are true of the SAME box at the
  // SAME moment, which is why "/status answered on localhost" was never evidence of anything.
  const r = await fetch(R.base + '/status');
  assert.equal(r.ok, true, 'precondition: the box is up and healthy on loopback');
  assert.equal((await ask(R.base, R.wsUrl)).status, 200, 'precondition: it proves itself on loopback');
  assert.equal((await ask(R.base, 'wss://public.example/relay')).status, 421,
    'a box with no public address declared still signed one — the staging below is meaningless');
});

test('the update script asks the public question, not the loopback one', async () => {
  // Read the shipped script rather than trusting it: this is the guard that would have caught the defect.
  const sh = readFileSync(new URL('../scripts/relay-update.sh', import.meta.url), 'utf8');
  assert.match(sh, /relay-identity/,
    'relay-update.sh never asks the relay to prove its identity, so a box that refuses every member still ' +
    'reports "healthy" and the rollback never fires. That is how this defect shipped.');
  assert.match(sh, /relay-names\/mine/,
    'the update does not look up the relay\'s own public address, so it can only ever check loopback');
  const idx = sh.indexOf('relay-identity');
  assert.ok(idx > sh.indexOf('systemctl restart'),
    'the identity probe runs before the restart, so it proves nothing about the new build');
});

test('teardown leaves nothing behind', () => {
  H.stopAll();
  assert.deepEqual(H.leftovers().processes, [], 'a relay process survived');
});
