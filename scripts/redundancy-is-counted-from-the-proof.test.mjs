// "IF ONE GOES DOWN, NOTHING IS LOST" MUST BE COUNTED FROM SOMETHING A RELAY CANNOT SIMPLY CLAIM.
// Run: node --test scripts/redundancy-is-counted-from-the-proof.test.mjs
//
// AUDIT 2026-09-02 #11. `relayIdentities` read each relay's IDENTITY from `/status`.`relayPub` — a bare
// unauthenticated string, which CLAUDE.md rule 10 says in as many words "is never proof". Two things count
// DISTINCT identities from it:
//
//   · `syncEnable` — which boxes may exchange a church's WHOLE CORPUS with each other, and
//   · `backupState` — which prints "Backup on. Your 2 relays mirror each other — if one goes down,
//     nothing is lost", and suppresses the single-point-of-failure warning.
//
// So a church's durability promise, and its sync set, were both counted from a string any host can type.
// Two routes to ONE box that both claim the same key were already deduped correctly; the hole is the other
// way — one box claiming to be two, or a host claiming a key it does not hold.
//
// The proof (`verifyRelayIdentity`) is nonce-bound and address-bound. A relay too old to answer it now has
// an empty pubkey and drops out of both sets, which is the fleet-order rule RELAY-ADMISSION already states:
// relays before apps, and an old relay is not a second copy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const BUNDLE = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');

function lift(name) {
  const i = BUNDLE.indexOf('async ' + name + '(');
  assert.ok(i > 0, `${name} is not in the shipped bundle — re-anchor this test`);
  let d = 0;
  for (let k = BUNDLE.indexOf('{', i); k < BUNDLE.length; k++) {
    if (BUNDLE[k] === '{') d++;
    else if (BUNDLE[k] === '}') { d--; if (!d) return BUNDLE.slice(i, k + 1); }
  }
  throw new Error('unbalanced braces slicing ' + name);
}

// A relay that ANSWERS /status with a key it does not hold, and cannot produce the proof.
function runIdentities({ proves }) {
  const body = lift('relayIdentities');
  const obj = new Function('relays', 'fetch', 'verifyRelayIdentity', 'window',
    'return ({ ' + body + ' })')(
    () => ['wss://liar.example/relay'],
    async () => ({ ok: true, json: async () => ({ relayPub: 'ffff'.repeat(16) }) }),
    async () => (proves ? { relayPub: 'aaaa'.repeat(16) } : null),
    { Steward: {} },
  );
  return obj.relayIdentities();
}

test('a key a relay merely CLAIMS is not its identity', async () => {
  const out = await runIdentities({ proves: false });
  assert.equal(out.length, 1);
  assert.equal(out[0].pubkey, '',
    'the relay\'s identity was taken from /status.relayPub, which any host can type. That value decides ' +
    'which boxes may exchange the church\'s whole corpus, and whether the console tells a church its data ' +
    'is mirrored');
  assert.equal(out[0].online, true,
    '"reachable but cannot prove itself" must stay visible as online — otherwise an old relay looks dead ' +
    'rather than old');
});

test('CONTROL: a relay that DOES prove itself keeps its identity', async () => {
  const out = await runIdentities({ proves: true });
  assert.equal(out[0].pubkey, 'aaaa'.repeat(16),
    'a proved relay lost its identity, which would empty the sync set and the redundancy count for every ' +
    'church — the opposite mistake');
});

test('switching sync ON over a document nobody accepted throws', async () => {
  const body = lift('syncEnable');
  // esbuild renames the import to finalizeEvent2 in the bundle — inject both names.
  const mk = (accepted) => new Function('sk', 'pub', 'window', 'publish', 'finalizeEvent2', 'now', 'JSON',
    'return ({ ' + body + ' })')(
    'sk', 'pub',
    { Steward: { relayIdentities: async () => ([
        { url: 'wss://a/relay', pubkey: 'a'.repeat(64), online: true },
        { url: 'wss://b/relay', pubkey: 'b'.repeat(64), online: true },
      ]) } },
    async () => (accepted ? { id: 'evt' } : null),
    (e) => e, () => 1, JSON,
  ).syncEnable;
  await assert.rejects(() => mk(false)(),
    /no relay accepted/i,
    '"Sync on" was reported over a setting no relay took — the church believes its boxes are mirroring each ' +
    'other when nothing has been told to');
  const ok = await mk(true)();
  assert.equal(ok.relays, 2, 'CONTROL: the happy path no longer reports how many relays are syncing');
});
