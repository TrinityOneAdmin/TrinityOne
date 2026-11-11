// THE CONSOLE FITS A REAL CHURCH ON A SLOW LINK.
//
// WHAT HAPPENED. 2026-11-11, Living Word (~258 documents, ~1.0 MB): the owner's console received 4,291 messages /
// 17 MB on ONE socket in 15.85 s, and the relay then closed it "1009 too slow" — its MAX_WS_BUFFER (16 MiB,
// scripts/gateway.mjs) — every ~16 s, for ever. The console asked for the same church corpus about seventeen times
// on every connect. Churches run on small pipes (reference/DOMAIN.md, 2026-11-11), so on a real link the relay's
// buffer fills; on localhost it never does, and a throwaway church is a few KB, which is why every earlier attempt
// to reproduce this on this machine came up clean.
//
// WHAT THIS DOES. The real console (steward.html + vendor/steward.js, served by a real gateway) makes a church the
// real way, then a Living-Word-SHAPED corpus is written into it by the console's own API and the members' own keys
// (scripts/slow-link-rig.mjs: ~245 documents, ~0.97 MB, a 376 KB devotional, a ~262 KB sealed event, 30 members).
// Then the relay socket is put through a 400 KB/s pipe (scripts/slow-link-proxy.mjs) and dropped twice; each time the
// console reconnects over the slow pipe and we read, off the wire, what it pulled.
//
// WHAT IT ASSERTS, per slow connect:
//   • no 1009 from the relay — the observed failure itself, read off the wire by the proxy (the relay's own close
//     frame), not inferred by the browser;
//   • the console received less than 16 MiB on the connect. That is the relay's MAX_WS_BUFFER: a connect that pulls
//     more than the relay will hold for a slow reader is one a slow enough pipe WILL be cut on. It is a ceiling,
//     not a target — measured 2026-11-11 on this branch, ~12.9 MB per connect, which is still ~13x the corpus (see
//     the measurement note in the commit); a later step that shares one corpus download should tighten it;
//   • no new trinityone/pubevent: writes after the corpus had settled. A connect cut short made the website mirror
//     decide on a half answer and rewrite public event copies on every reconnect.
// And at the point of use: the Overview Members tile shows the real member count once the last connect has settled.
//
// TO SEE IT FAIL: TRINITY_SLOWLINK_GATEWAY=<another tree>/scripts/gateway.mjs runs that tree's gateway, which serves
// that tree's console bundle — e.g. a copy of this tree with vendor/steward.js from 9e88acec. Nothing tracked is edited.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { openSlowConsole, seedChurch, corpusSize, membersTile, CHROME, H, sleep } from './slow-link-rig.mjs';

const MAX_WS_BUFFER = 16 * 1024 * 1024;   // scripts/gateway.mjs — the relay closes 1009 past this
const RATE = 400 * 1024;
const ENTRY = process.env.TRINITY_SLOWLINK_GATEWAY || undefined;
let s = null;
after(async () => { if (s) await s.close(); H.stopAll(); });

test('the console reconnects to a ~1 MB church over a 400 KB/s pipe without being cut off', { skip: !CHROME && 'no chromium' }, async () => {
  s = await openSlowConsole({ entry: ENTRY, name: 'slowlink' });
  const seeded = await seedChurch(s, { journal: 90, accounts: 25 });
  assert.deepEqual(seeded.fail, [], 'the console refused part of the seed: ' + JSON.stringify(seeded));
  assert.ok(seeded.share, 'the website calendar switch never turned on, so the pubevent assertion would be vacuous');
  assert.ok(await s.quiet(6000, 60000), 'the console never went quiet after seeding');
  const corpus = await corpusSize(s);
  assert.ok(corpus.bytes > 900 * 1024 && corpus.docs >= 230, 'the seeded church is not Living-Word sized: ' + corpus.docs + ' docs, ' + corpus.bytes + ' B');
  const pubeventsSeeded = s.sent.filter(x => x.d.startsWith('trinityone/pubevent:')).length;
  assert.ok(pubeventsSeeded >= 20, 'the website mirror wrote no public copies while seeding (' + pubeventsSeeded + '): the pubevent check below would prove nothing');

  const sentBefore = s.sent.length;
  s.link.setRate(RATE);
  const connects = [];
  for (let i = 0; i < 2; i++) {
    const conns0 = s.link.conns.length, socks0 = new Set(s.sockets.keys());
    s.link.dropAll();
    const tt = Date.now();   // the console reconnecting through the pipe, then the connect running to quiet
    while (Date.now() - tt < 30000 && !s.link.conns.slice(conns0).some(c => c.ws && c.msgs > 0)) await sleep(250);
    await s.quiet(8000, 75000);
    const wire = s.link.conns.slice(conns0).filter(c => c.ws);
    const socks = [...s.sockets.entries()].filter(([k]) => !socks0.has(k)).map(([, v]) => v);
    connects.push({ bytes: socks.reduce((a, v) => a + v.bytes, 0), events: socks.reduce((a, v) => a + v.events, 0), wire: wire.reduce((a, c) => a + c.down, 0), closes: wire.flatMap(c => c.closeCodes) });
  }
  const report = JSON.stringify({ corpus: { docs: corpus.docs, bytes: corpus.bytes }, connects });
  console.log('# slow-link connects: ' + report);
  for (const [i, c] of connects.entries()) {
    assert.ok(c.events > 0, 'connect ' + (i + 1) + ' received nothing — the console did not reconnect through the pipe: ' + report);
    assert.ok(!c.closes.includes(1009), 'the relay closed connect ' + (i + 1) + ' with 1009 "too slow": ' + report);
    assert.ok(c.bytes < MAX_WS_BUFFER, 'connect ' + (i + 1) + ' pulled ' + c.bytes + ' B (' + (c.bytes / corpus.bytes).toFixed(1) + 'x the corpus), more than the relay buffers for a slow reader: ' + report);
  }
  const pubevents = s.sent.slice(sentBefore).filter(x => x.d.startsWith('trinityone/pubevent:'));
  assert.equal(pubevents.length, 0, 'the console rewrote public event copies after the drops: ' + JSON.stringify(pubevents.map(x => x.d)));
  assert.equal(await membersTile(s), String(s.members.length), 'the Overview Members tile does not show the church\'s members after the last connect');
});
