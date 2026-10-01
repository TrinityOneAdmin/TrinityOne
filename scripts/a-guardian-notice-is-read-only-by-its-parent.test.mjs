// A GUARDIAN NOTICE IS SERVED TO THE PARENT IT IS ADDRESSED TO — AND NOT TO THE REST OF THE CONGREGATION.
// Run: node --test scripts/a-guardian-notice-is-read-only-by-its-parent.test.mjs
//
// Audit of 4d7ca23 (2026-10-01), E6, reproduced: scripts/trinity-doc-types.mjs declares guardnotice:
// `read: 'subject'`, but scripts/gateway.mjs canRead() had no branch for it, so it fell to the member rule and
// ANY authenticated member was served every parent's notices — by author, by d-tag, by p-tag. The content is
// sealed to the parent; the envelope is not: who in the church is a guardian, and when each link changed.
// Owner, 2026-10-01: fix now, with tests.
//
// Every reader of guardnotice:, enumerated (CLAUDE.md rule 2): the member app's subscribeGuardianNotices,
// as the parent (`#d: [guardnotice:<own key>]`). The console only writes them (src/steward.src.js
// _sendGuardNotice) and the relay reads none. So the rule is: the parent, the church, and a steward the church
// gave the safeguarding job — and this file proves each reader still receives what it needs, on a FRESH relay
// and again after that relay restarts (its maps rebuilt from disk; a read rule must not depend on a map only a
// live ingest filled).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { finalizeEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { requireFreePort } from './test-ports.mjs';
import { ROOT, K, now, sleep, until, dOf, publishTo, ask, memStorage, memberBoot, noticeEvt, memberEvt, decryptNotice } from './family-harness.mjs';

const PORT = 8942;   // unique across scripts/*.test.mjs AND scripts/*.probe.mjs
const URL_ = `ws://127.0.0.1:${PORT}/relay`;
const church = K(), parent = K(), bystander = K(), sgSteward = K(), finSteward = K(), C = K();
let proc = null, dataDir;

async function boot() {
  proc = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: ROOT, stdio: 'ignore', env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(church.pub) },
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) return; } catch {} await sleep(150); }
  throw new Error('the relay did not come up');
}
async function stop() { if (proc) { proc.kill('SIGKILL'); await new Promise(r => proc.once('exit', r)); proc = null; } }

before(async () => {
  await requireFreePort(PORT, 'a-guardian-notice-is-read-only-by-its-parent.test.mjs');
  dataDir = mkdtempSync(join(tmpdir(), 'trin-guardnotice-'));
  await boot();
  for (const w of [parent, bystander, sgSteward, finSteward]) assert.equal((await publishTo(URL_, memberEvt(church, w)))[0], true, 'fixture: join');
  const roster = finalizeEvent({ kind: 30078, created_at: now() - 5, tags: [['d', 'trinityone/stewards:' + church.pub], ['t', 'trinityone']],
    content: JSON.stringify({ pubkeys: [sgSteward.pub, finSteward.pub], caps: { [sgSteward.pub]: ['safeguarding'], [finSteward.pub]: ['finance'] } }) }, church.sk);
  assert.equal((await publishTo(URL_, roster))[0], true, 'fixture: the steward roster');
  assert.equal((await publishTo(URL_, noticeEvt(church, parent, { child: C.pub, name: 'Cleo', church: church.pub, children: [C.pub] }, now())))[0], true, 'fixture: the notice');
});
after(async () => { await stop(); try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

const notices = (evs) => evs.filter(e => dOf(e).startsWith('trinityone/guardnotice:'));

async function checkAll(when) {
  // a bystander member, authenticated as themselves, by every route a REQ can name the notice
  const byAuthor = notices(await ask(URL_, bystander, { kinds: [30078], authors: [church.pub] }));
  const byD = notices(await ask(URL_, bystander, { kinds: [30078], '#d': ['trinityone/guardnotice:' + parent.pub] }));
  const byP = notices(await ask(URL_, bystander, { kinds: [30078], '#p': [parent.pub] }));
  assert.deepEqual([byAuthor.length, byD.length, byP.length], [0, 0, 0],
    `${when}: A BYSTANDER MEMBER WAS SERVED ANOTHER PARENT’S GUARDIAN NOTICE (by authors / #d / #p)`);
  const anon = notices(await ask(URL_, null, { kinds: [30078], '#d': ['trinityone/guardnotice:' + parent.pub] }, 3000));
  assert.equal(anon.length, 0, `${when}: an anonymous reader was served a guardian notice`);
  const fin = notices(await ask(URL_, finSteward, { kinds: [30078], '#d': ['trinityone/guardnotice:' + parent.pub] }));
  assert.equal(fin.length, 0, `${when}: a steward with no safeguarding job was served a guardian notice`);
  // …and every reader that needs it still gets it
  const own = notices(await ask(URL_, parent, { kinds: [30078], '#d': ['trinityone/guardnotice:' + parent.pub] }));
  assert.equal(own.length, 1, `${when}: THE PARENT WAS NOT SERVED THEIR OWN NOTICE — their children vanish from their phone`);
  assert.deepEqual(decryptNotice(parent, own[0]).children, [C.pub], `${when}: the parent cannot open their notice`);
  const sg = notices(await ask(URL_, sgSteward, { kinds: [30078], '#d': ['trinityone/guardnotice:' + parent.pub] }));
  assert.equal(sg.length, 1, `${when}: a steward with the safeguarding job was not served the church’s notice`);
  const ch = notices(await ask(URL_, church, { kinds: [30078], authors: [church.pub] }));
  assert.equal(ch.length, 1, `${when}: the church was not served its own notice`);
  // the point of use: the parent's SHIPPED subscribeGuardianNotices, over this relay, shows the child
  const b = memberBoot(parent, memStorage(), { relays: [URL_] });
  const unsub = b.api.subscribeGuardianNotices();
  const ok = await until(() => b.shown(church.pub).includes(C.pub), 6000);
  unsub(); b.close();
  assert.ok(ok, `${when}: the parent’s app no longer shows the child the church linked`);
}

test('on a fresh relay: the parent, the church and a safeguarding steward are served it; nobody else is', async () => {
  await checkAll('fresh relay');
});

test('…and the same after the relay restarts and rebuilds its maps from disk', async () => {
  await stop();
  await boot();
  await checkAll('after a restart');
});
