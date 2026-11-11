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
//     more than the relay will hold for a slow reader is one a slow enough pipe WILL be cut on;
//   • THE CHURCH CORPUS CROSSES THE PIPE ONCE (the church feed, _corpusSub in src/steward.src.js): at most ONE
//     whole-corpus REQ (the church's two corpus filters, no '#d', no since) per socket per connect — measured 12
//     sockets' worth of them on this rig before the feed — and what the requests WITHOUT a `since` pulled is under
//     WHOLE_MAX x the corpus. Measured 2026-11-11 with the feed: ~1.3x (the feed's one corpus read + the narrow
//     reads); before it ~9-10x. Requests WITH a `since` (the website mirror's corpus stream and the helper's church
//     discovery, both resuming from "their last whole answer, less 900 s") are counted in the total but not here:
//     on this rig every document is minutes old, inside that 900 s window, so each of them re-reads the whole
//     corpus — ~3x between them, an artefact of a freshly seeded church that a real church (whose documents are
//     mostly older than 15 minutes) does not have. The TOTAL is bounded at TOTAL_MAX x (measured ~4.3x);
//   • no new trinityone/pubevent: writes after the corpus had settled. A connect cut short made the website mirror
//     decide on a half answer and rewrite public event copies on every reconnect.
// And at the point of use: the Overview Members tile shows the real member count once the last connect has settled,
// and once it has shown the count it NEVER goes back to "Checking…" across the forced drops (every value the tile
// shows is recorded in the page by a MutationObserver — scripts/slow-link-rig.mjs watchTile — not polled).
//
// TO SEE IT FAIL: TRINITY_SLOWLINK_GATEWAY=<another tree>/scripts/gateway.mjs runs that tree's gateway, which serves
// that tree's console bundle — e.g. a copy of this tree with vendor/steward.js from 9e88acec. Nothing tracked is edited.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { openSlowConsole, seedChurch, corpusSize, membersTile, watchTile, tileLog, isWholeCorpusReq, reqFilters, CHROME, H, sleep } from './slow-link-rig.mjs';

const MAX_WS_BUFFER = 16 * 1024 * 1024;   // scripts/gateway.mjs — the relay closes 1009 past this
const RATE = 400 * 1024;
const WHOLE_MAX = 2.0;   // x corpus, requests without `since` (measured ~1.3x with the feed, ~9-10x without)
const TOTAL_MAX = 5.0;   // x corpus, everything (measured ~4.3x; see the since-artefact note above)
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

  // the tile has its real count BEFORE the drops; from here on it must never say "Checking…" again
  const t0 = Date.now(); let tile0 = null;
  while (Date.now() - t0 < 90000 && (tile0 = await membersTile(s)) !== String(s.members.length)) await sleep(500);
  assert.equal(tile0, String(s.members.length), 'the Overview Members tile never showed the church\'s members before the drops');
  assert.equal(await watchTile(s), 'ok', 'the tile watcher did not install');

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
    // bytes per REQ, split by whether the REQ carried a `since` (see the header)
    let sinceBytes = 0;
    for (const k of socks) for (const [sid, b] of Object.entries(k.bySub)) { const r = k.reqs.find(x => x.sid === sid); if (r && reqFilters(r).some(f => f.since)) sinceBytes += b.bytes; }
    const bytes = socks.reduce((a, v) => a + v.bytes, 0);
    connects.push({ bytes, wholeBytes: bytes - sinceBytes, sinceBytes, events: socks.reduce((a, v) => a + v.events, 0), wire: wire.reduce((a, c) => a + c.down, 0), closes: wire.flatMap(c => c.closeCodes),
                    wholeCorpusReqs: socks.map(k => k.reqs.filter(r => isWholeCorpusReq(r, s.churchPub)).length) });
  }
  const report = JSON.stringify({ corpus: { docs: corpus.docs, bytes: corpus.bytes }, connects });
  console.log('# slow-link connects: ' + report);
  for (const [i, c] of connects.entries()) {
    assert.ok(c.events > 0, 'connect ' + (i + 1) + ' received nothing — the console did not reconnect through the pipe: ' + report);
    assert.ok(!c.closes.includes(1009), 'the relay closed connect ' + (i + 1) + ' with 1009 "too slow": ' + report);
    assert.ok(c.bytes < MAX_WS_BUFFER, 'connect ' + (i + 1) + ' pulled ' + c.bytes + ' B (' + (c.bytes / corpus.bytes).toFixed(1) + 'x the corpus), more than the relay buffers for a slow reader: ' + report);
    assert.ok(c.wholeCorpusReqs.every(n => n <= 1), 'connect ' + (i + 1) + ' asked a socket for the whole church corpus more than once (' + JSON.stringify(c.wholeCorpusReqs) + ' per socket): ' + report);
    assert.ok(c.wholeBytes <= WHOLE_MAX * corpus.bytes, 'connect ' + (i + 1) + ' pulled ' + c.wholeBytes + ' B (' + (c.wholeBytes / corpus.bytes).toFixed(2) + 'x the corpus) on requests with no `since` — the church corpus crossed the pipe more than once: ' + report);
    assert.ok(c.bytes <= TOTAL_MAX * corpus.bytes, 'connect ' + (i + 1) + ' pulled ' + (c.bytes / corpus.bytes).toFixed(2) + 'x the corpus in all: ' + report);
  }
  const log = await tileLog(s);
  const firstCount = log.findIndex(x => x.v === String(s.members.length));
  assert.ok(firstCount >= 0, 'the tile watcher never saw the member count: ' + JSON.stringify(log));
  assert.deepEqual(log.slice(firstCount).filter(x => x.v === 'Checking…'), [], 'the Overview Members tile went back to "Checking…" after it had shown the count, across the drops: ' + JSON.stringify(log));
  const pubevents = s.sent.slice(sentBefore).filter(x => x.d.startsWith('trinityone/pubevent:'));
  assert.equal(pubevents.length, 0, 'the console rewrote public event copies after the drops: ' + JSON.stringify(pubevents.map(x => x.d)));
  assert.equal(await membersTile(s), String(s.members.length), 'the Overview Members tile does not show the church\'s members after the last connect');
});
