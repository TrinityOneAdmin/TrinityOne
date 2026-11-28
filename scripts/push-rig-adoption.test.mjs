// VALIDATES scripts/push-rig-up.mjs's two correctness-critical pieces, in-process, with NO real Apple and NO
// public tunnel. Run: node --test scripts/push-rig-adoption.test.mjs
//
// The launcher itself cannot be unit-tested without spawning cloudflared and pointing a real iOS sim at it, so
// this proves the two things the launcher gets RIGHT or the sim silently never pushes:
//
//   1. THE ROOT-3 VOUCH. The church-signed relay-net document the launcher publishes (d=trinityone/relay-net,
//      content [{pubkey:<rig relay identity pub>, url, alwaysOn}]) is one proveRelay admits as root 'church'
//      for the rig relay's PROVEN identity key — i.e. adoptInviteRelays would admit the rig under the church's
//      own signature. Driven against a REAL harness gateway's /relay-identity possession proof (not a stub).
//      Sabotage: a doc naming the WRONG pubkey does NOT yield root 'church'.
//
//   2. THE END-TO-END PUSH WIRING. A member who is admitted to the rig's church can register an iOS push token,
//      and a DM to that member fires the push SEAM — observed via TRINITY_PUSH_SPY_FILE (the gateway's
//      test-only observability hook), which the real launcher deliberately does NOT set so the REAL APNs sender
//      is wired instead. Asserts the spy records the DM's RECIPIENT, carries the right sender, and never pushes
//      the sender to themselves.
//
// node_modules is hard-linked into this worktree, so this runs here as in the main tree.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { finalizeEvent } from 'nostr-tools/pure';
import * as H from './relay-network-harness.mjs';
import { proveRelay, parseRelayNet, CANONICAL_RELAY_PUBS } from '../src/relay-net.src.js';
import { verifyRelayIdentity } from '../src/relay-identity.src.js';

const now = () => Math.floor(Date.now() / 1000);
const church = H.key();
let rig, spyFile, spyDir;

before(async () => {
  spyDir = mkdtempSync(join(tmpdir(), 'trin-pushrig-spy-'));
  spyFile = join(spyDir, 'push-spy.ndjson');
  rig = await H.startRelay({ name: 'pushrig', churches: [church.pub], env: { TRINITY_PUSH_SPY_FILE: spyFile } });
});
after(() => {
  try { H.stopAll(); } catch {}
  try { rmSync(spyDir, { recursive: true, force: true }); } catch {}
});

// ── 1. THE ROOT-3 VOUCH ─────────────────────────────────────────────────────────────────────────────────
test('the launcher\'s relay-net doc admits the rig relay as root "church" (real possession proof)', async () => {
  // The exact document the launcher builds, via the shared harness helper the launcher mirrors.
  const doc = H.relayNetDoc(church, [rig]);
  const entries = parseRelayNet(doc.content);
  assert.equal(entries.length, 1, 'the relay-net doc parses to one entry');
  assert.equal(entries[0].pubkey, String(rig.relayPub).toLowerCase(), 'and it names the rig relay identity pubkey');

  // Real C2 possession proof against the running gateway + the church's signed entries.
  const res = await proveRelay(church.pub, rig.wsUrl, {
    verify: verifyRelayIdentity,
    netEntries: async () => entries,
    origin: '',
    pins: CANONICAL_RELAY_PUBS,
  });
  assert.equal(res.pub, String(rig.relayPub).toLowerCase(), 'proveRelay reports the proven identity key');
  assert.equal(res.root, 'church', 'and admits it under the CHURCH\'s own signature (root 3)');
});

test('SABOTAGE: a relay-net doc naming the WRONG pubkey does NOT give root "church"', async () => {
  const wrong = 'a'.repeat(64);   // not the rig's identity key
  const res = await proveRelay(church.pub, rig.wsUrl, {
    verify: verifyRelayIdentity,
    netEntries: async () => parseRelayNet([{ pubkey: wrong, url: rig.base, alwaysOn: true }]),
    origin: '',
    pins: CANONICAL_RELAY_PUBS,
  });
  assert.equal(res.pub, String(rig.relayPub).toLowerCase(), 'the proof still succeeds (it is a real box)…');
  assert.notEqual(res.root, 'church', '…but the church root does NOT fire without its key in the doc');
  // It is still admitted as "runs our software" (the post-2026-09-02 rule) — which is correct, and is why the
  // church root, not mere admission, is what this asserts. A trycloudflare/loopback address is not shipped, so
  // the one-refusal does not apply and the fall-through is 'software'.
  assert.equal(res.root, 'software', 'it falls through to the software root, proving the doc is what grants "church"');
});

// ── 2. THE END-TO-END PUSH WIRING ───────────────────────────────────────────────────────────────────────
// member/pushtoken/DM events, each authored the way the shipped app authors them.
const memberDoc = (member) => finalizeEvent(
  { kind: 30078, created_at: now(), tags: [['d', 'trinityone/member:' + church.pub], ['t', 'trinityone']], content: '{"joined":true}' }, member.sk);
const pushtokenDoc = (member, token) => finalizeEvent(
  { kind: 30078, created_at: now(), tags: [['d', 'trinityone/pushtoken:' + member.pub], ['t', 'trinityone']],
    content: JSON.stringify({ token, platform: 'ios', env: 'sandbox', ts: now() }) }, member.sk);
const dm = (from, toPub) => finalizeEvent(
  { kind: 4, created_at: now(), tags: [['p', toPub]], content: 'ciphertext' }, from.sk);

test('a member adopted by the rig registers a push token and a DM to them fires the push seam', async () => {
  const recipient = H.key();   // the sim's member
  const sender = H.key();      // another member DMing them
  const TOKEN = 'simtoken-' + 'f'.repeat(50);

  // Both join the (open) church; the recipient registers an iOS token. Order matters: the relay must hold the
  // membership + token BEFORE the DM arrives, which is how the live app does it too.
  await H.publishAll(rig, [memberDoc(recipient), memberDoc(sender), pushtokenDoc(recipient, TOKEN)]);

  // The one live push hook (gateway store path) fires on this publish.
  await H.publishAll(rig, [dm(sender, recipient.pub)]);

  const lines = await H.waitFor(() => {
    if (!existsSync(spyFile)) return null;
    const rows = readFileSync(spyFile, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    return rows.length ? rows : null;
  }, { timeout: 8000, label: 'the push spy to record a recipient' });

  const toRecipient = lines.filter(r => r.to === recipient.pub);
  assert.equal(toRecipient.length, 1, 'the rig pushed exactly once, to the DM\'s recipient');
  assert.equal(toRecipient[0].kind, 4, 'for the kind-4 DM');
  assert.equal(toRecipient[0].from, sender.pub, 'naming the sender as the author');
  assert.equal(lines.filter(r => r.to === sender.pub).length, 0, 'and never pushed the sender to their own phone');
});

test('leftovers: the harness left no relay process or temp dir behind', () => {
  try { H.stopAll(); } catch {}
  const left = H.leftovers();
  assert.equal(left.processes.length, 0, 'no relay process still alive');
  assert.equal(left.dirs.length, 0, 'no temp dir left on disk');
});
