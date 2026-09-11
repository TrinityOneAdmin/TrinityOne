// PROBE (not a test): WHY DOESN'T A PARENT'S SCREEN UPDATE WHILE THE APP IS OPEN?
//   Usage: node scripts/checkin-live.probe.mjs [secondsToWatch]   (default 180)
//
// THE ONE MEASUREMENT THAT SPLITS THIS BUG, and the one the 2026-09-11 two-phone round never made. It is the
// recipe this repo already wrote down after the member-restore bug cost a day (memory: "swallowed errors in
// relay handlers"): *prove "empty vs broken" by dumping the frames the relay actually sent. If the document
// is on the wire and the app shows nothing, it is the app.*
//
// Everything about this bug so far has been inference. This is not. It records every websocket frame from a
// COLD BOOT, through the PIN unlock, while a worker on the other handset checks a child in, and then answers
// five questions in order. The first one that comes back wrong is the bug.
//
// ── HOW TO RUN IT ─────────────────────────────────────────────────────────────────────────────────────────
//   1. Pixel on USB, screen ON and staying on (`adb shell svc power stayon true`) — a sleeping screen
//      throttles the WebView's sockets and every reading comes back zero, which looks exactly like the bug.
//   2. adb forward tcp:9222 localabstract:webview_devtools_remote_$(adb shell pidof com.trinityone.app)
//   3. node scripts/checkin-live.probe.mjs 180
//   4. It RELOADS the app (it has to — the patch must be in place before the first socket opens). Unlock with
//      the PIN when the gate appears. Then have the worker check a child in and WAIT. Do not touch the phone.
//
// ⚠ THE RELOAD IS LOAD-BEARING AND IT IS ALSO A HAZARD: a reload is a cold boot, and a cold boot is the state
// where this bug does NOT reproduce. So the run only counts if you unlock with the PIN and then leave the app
// alone — no backgrounding, no navigating away. If the child appears immediately you have measured a cold
// start and learned nothing; say so and run it again.
import { WebSocket } from 'ws';

const WATCH = (Number(process.argv[2]) || 180) * 1000;
const CK = 'trinityone/checkin:';

const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const page = list.find(p => p.type === 'page' && p.webSocketDebuggerUrl);
if (!page) { console.error('no page — is the adb forward up, and the screen on?'); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
let id = 0; const pending = new Map();
const send = (method, params) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
ws.on('message', (d) => { const m = JSON.parse(d); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } });
await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });

// Patch BEFORE any app code runs. Frames AND uncaught errors AND the app's own failure channel — a throw
// inside a nostr-tools onevent handler is caught by the library, logged, and swallowed, so the feature
// returns empty rather than broken. That exact shape hid the member-restore bug for its whole life.
const patch = `
(() => {
  window.__frames = []; window.__errs = [];
  const t0 = Date.now();
  window.__t0 = t0;
  const Native = window.WebSocket;
  function Rec(url, protos) {
    const s = protos === undefined ? new Native(url) : new Native(url, protos);
    const tag = String(url);
    const push = (dir, data) => { try { window.__frames.push({ at: Date.now() - t0, dir, url: tag, data: String(data).slice(0, 40000) }); } catch (e) {} };
    const origSend = s.send.bind(s);
    s.send = (d) => { push('>', d); return origSend(d); };
    s.addEventListener('message', (e) => push('<', e.data));
    s.addEventListener('close', (e) => push('!', 'CLOSED code=' + (e && e.code)));
    return s;
  }
  Rec.prototype = Native.prototype;
  for (const k of ['CONNECTING','OPEN','CLOSING','CLOSED']) Rec[k] = Native[k];
  window.WebSocket = Rec;
  window.addEventListener('error', (e) => { try { window.__errs.push({ at: Date.now() - t0, kind: 'error', msg: String(e.message || e) }); } catch (x) {} });
  window.addEventListener('unhandledrejection', (e) => { try { window.__errs.push({ at: Date.now() - t0, kind: 'reject', msg: String((e.reason && e.reason.message) || e.reason) }); } catch (x) {} });
  window.addEventListener('trinity-feature-failed', (e) => { try { window.__errs.push({ at: Date.now() - t0, kind: 'feature', msg: JSON.stringify(e.detail) }); } catch (x) {} });
  const warn = console.warn.bind(console);
  console.warn = (...a) => { try { const s = a.map(String).join(' '); if (/nostr|error processing/i.test(s)) window.__errs.push({ at: Date.now() - t0, kind: 'nostr-warn', msg: s.slice(0, 500) }); } catch (x) {} return warn(...a); };
})();
`;
ws.on('message', (d) => { let x; try { x = JSON.parse(d); } catch { return; }
  if (x.method === 'Page.javascriptDialogOpening')
    ws.send(JSON.stringify({ id: ++id, method: 'Page.handleJavaScriptDialog', params: { accept: true, promptText: '' } })); });
await send('Page.enable', {});
await send('Page.addScriptToEvaluateOnNewDocument', { source: patch });
await send('Page.reload', { ignoreCache: false });
console.error(`reloaded — UNLOCK WITH THE PIN, then have the worker check a child in. Watching ${WATCH / 1000}s…`);
await new Promise(r => setTimeout(r, WATCH));

const r = await send('Runtime.evaluate', {
  expression: `JSON.stringify({
    pub: (window.Fellowship||{}).myPubkey || null,
    now: Math.floor(Date.now()/1000),
    auth: (function(){ try { return window.Fellowship.authState(); } catch(e){ return String(e); } })(),
    failures: (function(){ try { return window.Fellowship.recentFailures(); } catch(e){ return []; } })(),
    frames: window.__frames || [], errs: window.__errs || [],
  })`,
  returnByValue: true, allowUnsafeEvalBlockedByCSP: true,
});
ws.close();
const { pub, now, auth, failures, frames, errs } = JSON.parse(r.result.value);
const ms = (n) => String(n).padStart(7) + 'ms';

console.log('=== THE PHONE ===');
console.log('my pubkey :', pub || '(NONE — the key never arrived; every reader below is a dead no-op)');
console.log('auth state:', JSON.stringify(auth));
console.log('frames    :', frames.length, ' errors:', errs.length);

// ── Q1. Did we ever subscribe with a filter that could match a check-in at all? ───────────────────────────
// The check-in record is authored by a WORKER, so only the '#church' filter can match it. If the REQ that
// carries it was never sent, nothing downstream matters.
console.log('\n=== Q1. THE SUBSCRIPTION WE OPENED (what the app asked for) ===');
const reqs = [];
for (const f of frames) {
  if (f.dir !== '>' || !f.data.startsWith('["REQ"')) continue;
  try {
    const m = JSON.parse(f.data);
    const filters = m.slice(2).flat();
    if (!filters.some(x => x && x['#church'])) continue;         // the docs hub's member-authored half
    reqs.push({ at: f.at, sub: m[1], filters });
  } catch {}
}
if (!reqs.length) console.log('⚠ NO church-docs REQ was ever sent. The hub never opened — look at the app, not the relay.');
for (const q of reqs) {
  const since = (q.filters.find(x => x.since) || {}).since;
  console.log(`${ms(q.at)}  sub=${q.sub}  since=${since ? since + ' (' + Math.round((now - since) / 3600) / 1 + 'h ago)' : 'NONE (full re-sync)'}`);
}

// ── Q2. Did the relay ever refuse one of our subscriptions? ───────────────────────────────────────────────
// The client handles no CLOSED frame anywhere in src/. A refused REQ is therefore silent and permanent.
console.log('\n=== Q2. DID THE RELAY CLOSE ANY SUBSCRIPTION? (the client ignores these entirely) ===');
const closed = frames.filter(f => f.dir === '<' && f.data.startsWith('["CLOSED"'));
if (!closed.length) console.log('no — nothing was refused.');
for (const f of closed) console.log(`${ms(f.at)}  ${f.data.slice(0, 300)}   ⚠ nothing in the app reacts to this`);
const socketDrops = frames.filter(f => f.dir === '!');
for (const f of socketDrops) console.log(`${ms(f.at)}  SOCKET ${f.data}  (${f.url})`);

// ── Q3. Did a check-in record reach this phone ON THE WIRE? ───────────────────────────────────────────────
// THE SPLIT. On the wire + not on screen = the app. Not on the wire = the relay, the filters, or the clock.
console.log('\n=== Q3. CHECK-IN RECORDS THE RELAY ACTUALLY SENT US ===');
const seen = [];
for (const f of frames) {
  if (f.dir !== '<' || !f.data.startsWith('["EVENT"')) continue;
  try {
    const m = JSON.parse(f.data), e = m[2];
    const d = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
    if (!d.startsWith(CK)) continue;
    const ps = e.tags.filter(t => t[0] === 'p').map(t => String(t[1] || '').toLowerCase());
    seen.push({ at: f.at, sub: m[1], d, created: e.created_at, by: e.pubkey, ps, gks: e.tags.filter(t => t[0] === 'gk').length });
  } catch {}
}
if (!seen.length) {
  console.log('⚠ NONE. No check-in record was pushed to this phone at all.');
  console.log('  → the fault is at or below the socket: the filters we sent, the relay\'s read gate, or the');
  console.log('    WRITER\'s clock. Compare each REQ\'s `since` above against the record\'s created_at on the');
  console.log('    worker\'s phone — a writer more than 3 days slow is filtered out and never pushed.');
} else {
  for (const s of seen) {
    const mine = pub && s.ps.includes(String(pub).toLowerCase());
    const age = now - s.created;
    console.log(`${ms(s.at)}  sub=${s.sub}  ${s.d}`);
    console.log(`           created_at=${s.created} (${age}s old${age < 0 ? ' — IN THE FUTURE' : ''})  by=${s.by.slice(0, 12)}…  gk-copies=${s.gks}`);
    console.log(`           p-tags: ${s.ps.map(p => p.slice(0, 12) + '…').join(', ') || '(none)'}   ${mine ? '✅ ONE OF THEM IS ME' : '❌ NONE OF THEM IS ME — this reader will drop it as not-mine'}`);
  }
  const late = seen.filter(s => reqs.length && s.at > Math.max(...reqs.map(q => q.at)) + 3000);
  console.log(late.length
    ? `\n✅ ${late.length} record(s) arrived LIVE, well after the last REQ. The relay is doing its job.`
    : '\n⚠ every record arrived in the initial replay; none arrived LIVE. That is the bug, at the socket.');
}

// ── Q4. What does the app itself think it has? ────────────────────────────────────────────────────────────
console.log('\n=== Q4. WHAT THE READERS ANSWER RIGHT NOW ===');
const r2 = await (async () => {
  const w2 = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
  await new Promise((res, rej) => { w2.on('open', res); w2.on('error', rej); });
  let i2 = 0; const p2 = new Map();
  w2.on('message', (d) => { const m = JSON.parse(d); if (m.id && p2.has(m.id)) { const { res } = p2.get(m.id); p2.delete(m.id); res(m.result); } });
  const ev = (expr) => new Promise((res) => { const i = ++i2; p2.set(i, { res }); w2.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true, awaitPromise: true, allowUnsafeEvalBlockedByCSP: true } })); });
  // A FRESH subscription, made NOW. If this one sees the child and the screen does not, the record is on the
  // phone and in the hub — and what failed is the subscription the app made EARLIER, not the data.
  const out = await ev(`new Promise(res => {
    const np = (JSON.parse(localStorage.getItem('trinityone.followedChurches')||'[]')[0]||{}).npub;
    if (!np) return res(JSON.stringify({ error: 'no church on this phone' }));
    let last = null;
    const off = window.Fellowship.subscribeMyChildrenCheckins(np, s => { last = s; });
    setTimeout(() => { try { off(); } catch(e){} res(JSON.stringify({ np, last })); }, 4000);
  })`);
  w2.close();
  return out && out.result ? out.result.value : null;
})();
console.log('a FRESH subscribeMyChildrenCheckins, right now:', r2);
console.log('\n→ If this fresh one lists the child while the screen does not, the data is here and the');
console.log('  SUBSCRIPTION THE APP MADE is what is broken (it registered no handler, or captured a stale key).');
console.log('  If this one is empty too, the record never reached the reader — go back to Q3.');

// ── Q5. Anything thrown and swallowed? ────────────────────────────────────────────────────────────────────
console.log('\n=== Q5. ERRORS (a throw inside a relay handler is logged and swallowed — feature goes empty, not broken) ===');
if (!errs.length && !(failures || []).length) console.log('none.');
for (const e of errs) console.log(`${ms(e.at)}  [${e.kind}] ${e.msg}`);
for (const f of (failures || [])) console.log(`  [feature-failed] ${JSON.stringify(f)}`);
