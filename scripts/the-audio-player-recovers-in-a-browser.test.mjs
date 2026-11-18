// THE AUDIO PLAYER RECOVERS — IN A REAL BROWSER, OVER A REAL NETWORK THAT GOES AWAY.
// Run (alone; it drives headless Chromium for about two minutes):
//   node --test scripts/the-audio-player-recovers-in-a-browser.test.mjs
//
// scripts/the-audio-player-recovers.test.mjs proves the engine's rules against a fake <audio>. This proves the
// fake was right about the one thing that matters: in Chromium, after a cut mid-chapter and a cut at a chapter
// boundary, the SHIPPED app/screens-audio.jsx (compiled exactly as sync-web.sh compiles it, the whole file)
// gets the sound back by itself, at its place, with nobody pressing anything. Before Fix 1 neither recovered:
// the investigation (TrinityOne-internal/INVESTIGATION-audio-playback-2026-11-18.md, T2-T4) measured both.
//
// The retry schedule is shortened through the engine's documented test hook, window.__TRINITY_AUDIO_TEST__
// (the shipped 2/5/15/30 s + 45 s are asserted by the fast test). MP3s are generated with ffmpeg at test time.
// Ports come from listen(0); the profile from mkdtempSync(join(tmpdir(), 'trin-…')) so
// scripts/sweep-chromium-tmp.mjs sees it; Chromium is killed by PID in after().
// Desktop Chromium is NOT the phone's WebView: the phone check is on the device list in the plan.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { compileScreen } from './render-jsx-screen.mjs';

const CHROME = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => existsSync(p));
const FFMPEG = ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg'].find(p => existsSync(p));
const SKIP = !CHROME ? 'no chromium' : (!FFMPEG ? 'no ffmpeg' : false);
const sleep = ms => new Promise(r => setTimeout(r, ms));
// 40 s of cut outlasts Chromium's OWN re-requesting (~30 s, investigation T4), so only the engine can bring it back;
// the last retry (30 s) lands after the network returns.
const HOOK = { retryMs: [2000, 4000, 8000, 30000], stallMs: 6000 };
const CUT_MS = 40000;
const RATE = 12 * 1024;                  // bytes/s served: ~1.5x real time for 64 kbps, so the chapter STREAMS

let chr = null, srv = null, ws = null, send = null, dir = null, down = false;
const socks = new Set(), reqlog = [];

const freePort = () => new Promise((res, rej) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); s.on('error', rej); });

before(async () => {
  if (SKIP) return;
  dir = mkdtempSync(join(tmpdir(), 'trin-audiorecover-'));
  // a = 40 s, b = 6 s, c = 20 s: 64 kbps CBR mono tones
  for (const [n, sec, hz] of [['a', 40, 440], ['b', 6, 550], ['c', 20, 660]]) {
    execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `sine=frequency=${hz}:duration=${sec}`, '-ac', '1', '-b:a', '64k', join(dir, n + '.mp3')]);
  }
  const engine = compileScreen('app/screens-audio.jsx');
  srv = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/page.html') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(`<!doctype html><body><script>window.__TRINITY_AUDIO_TEST__ = ${JSON.stringify(HOOK)};</script><script src="/engine.js"></script></body>`);
    }
    if (u.pathname === '/engine.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(engine); }
    const m = /^\/([abc])\.mp3$/.exec(u.pathname);
    if (!m) { res.writeHead(404); return res.end(); }
    reqlog.push({ at: Date.now(), f: m[1], range: req.headers.range || '', down });
    if (down) { req.socket.destroy(); return; }
    const buf = readFileSync(join(dir, m[1] + '.mp3'));
    let start = 0, end = buf.length - 1;
    const r = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
    const head = { 'cache-control': 'no-store', 'content-type': 'audio/mpeg', 'accept-ranges': 'bytes' };
    if (r) { start = +r[1]; if (r[2]) end = +r[2]; res.writeHead(206, { ...head, 'content-range': `bytes ${start}-${end}/${buf.length}`, 'content-length': end - start + 1 }); }
    else res.writeHead(200, { ...head, 'content-length': buf.length });
    // b is served whole at once (so it is fully buffered before the boundary cut); a and c are throttled
    if (m[1] === 'b') return res.end(buf.subarray(start, end + 1));
    let pos = start; socks.add(req.socket); req.socket.on('close', () => socks.delete(req.socket));
    const tick = setInterval(() => {
      if (down) { clearInterval(tick); req.socket.destroy(); return; }
      const n = Math.min(RATE / 10, end + 1 - pos); if (n <= 0) { clearInterval(tick); res.end(); return; }
      res.write(buf.subarray(pos, pos + n)); pos += n;
    }, 100);
    res.on('close', () => clearInterval(tick));
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const CDP = await freePort();
  chr = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`, '--no-sandbox', '--disable-gpu', '--no-first-run', '--mute-audio',
    '--autoplay-policy=no-user-gesture-required', `--user-data-dir=${join(dir, 'prof')}`, 'about:blank'], { stdio: 'ignore' });
  let targets = null;
  for (let i = 0; i < 60 && !(targets && targets.length); i++) { await sleep(300); try { targets = await (await fetch(`http://127.0.0.1:${CDP}/json`)).json(); } catch {} }
  assert.ok(targets && targets.length, 'chromium never exposed a debug target');
  const page = targets.find(t => t.type === 'page') || targets[0];
  ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  let id = 0; const pend = new Map();
  ws.on('message', d => { const m = JSON.parse(d); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Page.enable');
  await send('Page.navigate', { url: `http://127.0.0.1:${srv.address().port}/page.html` });
  for (let i = 0; i < 40; i++) { await sleep(150); if (await ev('!!window.TrinityAudio')) break; }
  assert.equal(await ev('!!window.TrinityAudio'), true, 'the shipped engine did not start in the page');
  await ev(`(() => { window.EL = document.querySelector('audio'); window.LOG = [];
    ['playing','error'].forEach(n => EL.addEventListener(n, () => LOG.push({ n, ct: EL.currentTime, src: EL.src.split('/').pop(), code: EL.error && EL.error.code })));
    window.trk = (n) => ({ id: n, title: n, src: location.origin + '/' + n + '.mp3' }); return 1; })()`);
});

after(() => {
  try { ws && ws.close(); } catch {}
  try { if (chr && chr.pid) process.kill(chr.pid, 'SIGKILL'); } catch {}
  try { srv && srv.close(); } catch {}
  try { dir && rmSync(dir, { recursive: true, force: true }); } catch {}
});

async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result && r.result.exceptionDetails) throw new Error('page threw: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 300));
  return r.result && r.result.result ? r.result.result.value : undefined;
}
const snap = () => ev(`(() => { let o; const u = TrinityAudio.subscribe(s => { o = s; }); u();
  return { paused: EL.paused, ct: EL.currentTime, err: EL.error && EL.error.code, src: EL.src.split('/').pop(),
    playing: o.playing, retrying: o.retrying, failed: o.failed, id: o.track && o.track.id }; })()`);
const cut = () => { down = true; socks.forEach(s => s.destroy()); };
async function until(pred, ms, what) {
  const t0 = Date.now(); let s;
  while (Date.now() - t0 < ms) { s = await snap(); if (pred(s)) return s; await sleep(250); }
  assert.fail(what + ' — last state ' + JSON.stringify(s));
}

test('a cut MID-CHAPTER: the player says it is reconnecting, then plays on BY ITSELF from where it was', { skip: SKIP, timeout: 180000 }, async () => {
  await ev(`TrinityAudio.play(trk('a'), [trk('a'), trk('c')]); 1`);
  await until(s => !s.paused && s.ct > 4, 20000, 'chapter a never started playing');
  const at = (await snap()).ct;
  cut();
  const t0 = Date.now();
  await until(s => s.retrying || s.failed, 30000, 'the cut was never noticed (no retrying state)');
  await sleep(Math.max(0, CUT_MS - (Date.now() - t0)));
  const n = reqlog.length;
  down = false;
  const s = await until(s => !s.paused && s.playing && !s.retrying && s.ct > at, 60000, 'IT NEVER PLAYED AGAIN BY ITSELF after the network came back');
  assert.equal(s.id, 'a', 'it recovered onto a different chapter');
  assert.equal(s.failed, false);
  const back = reqlog.slice(n).filter(r => r.f === 'a' && !r.down);
  assert.ok(back.length >= 1, 'no request for the chapter after the network returned');
  const resumed = (await ev('LOG')).filter(e => e.n === 'playing').pop();
  assert.ok(resumed.ct >= at - 2, `it restarted near 0:00 (${resumed.ct.toFixed(1)} s) instead of at its place (${at.toFixed(1)} s)`);
  await ev('TrinityAudio.stop(); LOG.length = 0; 1');
});

test('a cut at the CHAPTER BOUNDARY: the next chapter\'s first load fails, and it plays THAT chapter from 0:00 by itself', { skip: SKIP, timeout: 120000 }, async () => {
  await ev(`TrinityAudio.play(trk('b'), [trk('b'), trk('c')]); 1`);
  await until(s => !s.paused && s.ct > 1 && s.id === 'b', 20000, 'chapter b never started');
  await sleep(500);
  cut();                                  // b is fully buffered; c's first request will be refused
  await until(s => s.id === 'c' && (s.retrying || s.failed), 20000, 'the failed first load of the next chapter was not noticed');
  await sleep(2000);
  down = false;
  const s = await until(s => s.id === 'c' && !s.paused && s.playing && !s.retrying, 40000, 'THE NEXT CHAPTER NEVER LOADED by itself after the network came back');
  assert.equal(s.src, 'c.mp3', 'it skipped the failed chapter');
  const firstPlay = (await ev('LOG')).filter(e => e.n === 'playing' && e.src === 'c.mp3')[0];
  assert.ok(firstPlay && firstPlay.ct < 3, 'the next chapter did not start from 0:00 (P2): ' + JSON.stringify(firstPlay));
  assert.ok((await ev('LOG')).some(e => e.n === 'error' && e.src === 'c.mp3'), 'no load error was seen for c — the cut did not bite, re-anchor this test');
  await ev('TrinityAudio.stop(); 1');
});
