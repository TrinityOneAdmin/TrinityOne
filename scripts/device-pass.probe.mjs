// PROBE (not a test): drive the REAL app on a REAL phone, end to end, and check the claims that only a
// device can settle. Run with the handset unlocked and USB-debugging on:
//
//   adb forward tcp:9222 localabstract:chrome_devtools_remote
//   node scripts/device-pass.probe.mjs <church-npub> [outDir]
//
// WHY A DEVICE AND NOT A HEADLESS BROWSER. Three of these checks cannot be made anywhere else:
//   · turning the radios OFF is the only honest test of "can I reach my church" — a desktop tab that has
//     never connected is a different state from a phone that had a connection and lost it;
//   · a real tap goes through touch handling and focus, which element.click() skips (that mistake once had
//     seven broken pills reported as working);
//   · the WebView/Chrome on the handset is the engine members actually run.
//
// WHAT IS PROVED, NOT ASSERTED. Where a claim is about what reached the relay, this reads the relay's own
// sqlite rather than asking the relay: church messages are NIP-42 gated, so an anonymous query returns
// nothing whether the data is there or not, and "the relay told me nothing" proves nothing at all.
//
// THE LIVE PILOT RELAY IS REFUSED IN-PAGE. Note for anyone reusing this: CDP's Network.setBlockedURLs does
// NOT cover WebSockets — verified on this device, a fetch was refused while a WebSocket to the same host
// opened normally — and the relay IS a WebSocket. The guard has to be the constructor, installed before any
// app code runs, and it must not THROW: throwing aborts the app's connect loop, so a blocked relay takes the
// good relay down with it. Point it at a dead port instead.
import { WebSocket } from 'ws';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const CHURCH = process.argv[2];
const OUT = process.argv[3] || '/tmp/device-pass';
const BASE = 'https://trinityone.tailbeaac0.ts.net';
const ENC_GID = 'enc-test-room';
const PIN = '314159';
if (!CHURCH) { console.error('usage: node scripts/device-pass.probe.mjs <church-npub> [outDir]'); process.exit(2); }
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const adb = (...a) => { try { return execFileSync('adb', a, { encoding: 'utf8', timeout: 30000 }); } catch (e) { return ''; } };
const relayDb = () => new DatabaseSync(new URL('../relay/relay.sqlite', import.meta.url).pathname, { readOnly: true });
const inRelay = (needle) => { const db = relayDb(); try { return db.prepare('SELECT COUNT(*) c FROM events WHERE raw LIKE ?').get('%' + needle + '%').c; } finally { db.close(); } };

let pass = 0, fail = 0;
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail });
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '   — ' + detail : ''));
  ok ? pass++ : fail++;
};

// RECONNECT AFTER EVERY NAVIGATION, and pick the tab by URL each time.
//
// This cost an hour. Runtime.evaluate, issued without a context id, can stay bound to the execution context
// that existed when Runtime.enable was called — so after a cross-document navigation every evaluate was
// answering from the OLD document while Page.captureScreenshot rendered the new one. The symptom is
// perfectly misleading: the probe reports "control not found" for thirty seconds and the screenshot taken
// immediately afterwards shows that control plainly on screen. Reading the screenshot, you conclude the app
// is fine and the tap is broken; reading the poll, you conclude the app never rendered. Both are wrong.
//
// A fresh socket gets a fresh default context, which is the cheap and total fix.
let ws, id = 0, send;
async function connect(match = /tailbeaac0/) {
  const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
  const t = list.find(x => x.type === 'page' && match.test(x.url || '')) || list.find(x => x.type === 'page');
  if (!t) throw new Error('no page target — is Chrome open on the phone?');
  if (ws) { try { ws.close(); } catch (e) {} }
  ws = new WebSocket(t.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
  id = 0;
  send = (m, p) => new Promise((res, rej) => {
    const n = ++id;
    const on = d => { const x = JSON.parse(d); if (x.id === n) { ws.off('message', on); x.error ? rej(new Error(JSON.stringify(x.error))) : res(x.result); } };
    ws.on('message', on); ws.send(JSON.stringify({ id: n, method: m, params: p }));
  });
  await new Promise(r => ws.on('open', r));
  await send('Page.enable', {}); await send('Runtime.enable', {});
  await send('Network.enable', {}).catch(() => {});
  // SERVE THE BUILD ON DISK, NOT THE ONE IN THE CACHE. The app registers a service worker, and on this
  // handset it happily served a bundle from the previous day: every one of the eight checks that failed was
  // a change made that morning, and every one of them "failed" against code that no longer exists. A probe
  // that reports confident results about a build nobody is running is worse than no probe at all.
  await send('Network.setBypassServiceWorker', { bypass: true }).catch(() => {});
  // …AND THE HTTP CACHE, which is a separate cache with the same failure mode. Bypassing only the service
  // worker still served a day-old vendor bundle from disk, and the gate below caught it: the server was
  // returning the new file at every layer while the phone kept running the old one.
  await send('Network.setCacheDisabled', { cacheDisabled: true }).catch(() => {});
  await send('Page.bringToFront', {}).catch(() => {});
  // RE-INSTALLED ON EVERY SESSION. addScriptToEvaluateOnNewDocument is registered per debugger session, so a
  // reconnect silently drops it — and the thing it drops is the guard keeping this test off the live pilot
  // relay. Losing a safety net quietly, as a side effect of an unrelated fix, is exactly how test data ends
  // up on a real church's box.
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `(function(){
    var BAD=/app\\.trinityone\\.church|trinityone-master-01/, Real=window.WebSocket;
    function G(u,p){ var t=BAD.test(String(u))?'ws://127.0.0.1:1/blocked':u; return p===undefined?new Real(t):new Real(t,p); }
    G.prototype=Real.prototype; ['CONNECTING','OPEN','CLOSING','CLOSED'].forEach(function(k,i){G[k]=i;});
    window.WebSocket=G; })();` });
}
await connect(/./);
// navigate + settle + rebind, so nothing is ever read from a dead document
const goto = async (url, settleMs) => {
  await send('Page.navigate', { url });
  await sleep(settleMs);
  await connect();
  await sleep(1500);
};
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result.value;
const shot = async (n) => { const s = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${OUT}/${n}.png`, Buffer.from(s.data, 'base64')); };
// WAIT FOR THE CONTROL, DON'T RACE IT. The first run of this failed on "I'm new here" and the screenshot
// taken immediately afterwards showed the button plainly on screen: a cold load over the funnel, on a phone,
// simply took longer than the fixed sleep. A fixed wait tuned on a warm desktop turns into a flaky failure
// on the device — which is the one place the answer is supposed to be trustworthy.
// Optional taps get a short wait: they are the ones expected to be absent much of the time (a confirm
// step that may or may not appear), and a 30s poll on each would make the run crawl.
const tap = async (label, req = true, waitMs = req ? 30000 : 5000) => {
  const findBox = async () => ev(`(function(){
    var all=[].slice.call(document.querySelectorAll('button,a,[role="button"],div,span,label')).filter(function(x){
      var tx=(x.innerText||'').trim(); var r=x.getBoundingClientRect();
      return tx.indexOf(${JSON.stringify(label)})===0 && r.width>25 && r.height>10 && r.top>-1;});
    if(!all.length) return null;
    all.sort(function(a,b){return (a.innerText||'').length-(b.innerText||'').length;});
    var e=all[0]; e.scrollIntoView({block:'center'}); var r=e.getBoundingClientRect();
    return JSON.stringify({x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)});})()`);
  let box = null;
  const until = Date.now() + waitMs;
  while (!box && Date.now() < until) { box = await findBox(); if (!box) await sleep(1500); }
  if (!box) { if (req) throw new Error('control not found after ' + Math.round(waitMs / 1000) + 's: ' + label); return false; }
  const { x, y } = JSON.parse(box);
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await sleep(70);
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(1200);
  return true;
};
// TAP UNTIL IT ACTUALLY MOVES. A single dispatched tap is not the same as a member tapping: the button may
// still be disabled while React catches up with the input event a moment earlier, and the tap is then simply
// absorbed. Seen twice by hand on this handset — "Continue as <name>" and the 12-word quick check both
// needed a second tap. Retrying until the control is GONE is the honest version of "the member taps it",
// and it fails loudly rather than wandering on through a wizard that never advanced.
const tapAdvance = async (label, tries = 4) => {
  for (let i = 0; i < tries; i++) {
    await tap(label, i === 0);
    await sleep(1200);
    const still = await ev(`(function(){
      var all=[].slice.call(document.querySelectorAll('button,a,[role="button"],div,span,label'));
      return all.some(function(x){ var r=x.getBoundingClientRect();
        return (x.innerText||'').trim().indexOf(${JSON.stringify(label)})===0 && r.width>25 && r.height>10; });})()`);
    if (!still) return true;
  }
  throw new Error('tapped "' + label + '" ' + tries + ' times and the screen never moved on');
};
const typeInto = async (phPart, value) => ev(`(function(){
  var i=[].slice.call(document.querySelectorAll('input')).filter(function(x){return (x.placeholder||'').indexOf(${JSON.stringify(phPart)})>=0;})[0];
  if(!i) return 'no input'; var s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
  s.call(i, ${JSON.stringify(value)}); i.dispatchEvent(new Event('input',{bubbles:true})); return 'ok';})()`);
// the encryption pill only — matched on its exact wording so the room NAME ("Leaders (encrypted)") cannot
// be mistaken for it, which it was on the first attempt
const pillText = () => ev(`(function(){
  var want=['End-to-end encrypted','Encrypted · no key yet','Not encrypted'];
  var all=[].slice.call(document.querySelectorAll('span'));
  for (var i=0;i<all.length;i++){ var t=(all[i].innerText||'').trim(); if (want.indexOf(t)>=0) return t; }
  return '(no pill)';})()`);
const bodyHas = (s) => ev(`document.body.innerText.indexOf(${JSON.stringify(s)}) >= 0`);
const waitFor = async (fn, ms = 45000, every = 2500) => {
  const until = Date.now() + ms;
  while (Date.now() < until) { if (await fn()) return true; await sleep(every); }
  return false;
};

try {

  console.log('\n── a fresh member, on the phone ────────────────────────────────────────────');
  await goto(BASE + '/index.html', 8000);
  await ev('(function(){ try { localStorage.clear(); } catch(e){} return 1; })()');
  await goto(`${BASE}/index.html?follow=${CHURCH}`, 16000);

  // THE GATE. Refuse to report anything at all until the phone is demonstrably running the code under test.
  // The marker is a function this branch introduces; if it is missing, the device is on an older bundle and
  // every result below would be a lie told confidently.
  const fresh = await ev('typeof (window.Fellowship||{}).groupEncState === "function"');
  if (!fresh) {
    await ev(`(async function(){
      try { var rs = await navigator.serviceWorker.getRegistrations(); for (var i=0;i<rs.length;i++) await rs[i].unregister(); } catch(e){}
      try { var ks = await caches.keys(); for (var j=0;j<ks.length;j++) await caches.delete(ks[j]); } catch(e){}
      return 1; })()`);
    await send('Page.reload', { ignoreCache: true }).catch(() => {});
    await sleep(16000);
    await connect();
    await sleep(2000);
  }
  check('the phone is running the build under test',
    await ev('typeof (window.Fellowship||{}).groupEncState === "function"'),
    'service worker cleared and reloaded if it was not');
  if (!(await ev('typeof (window.Fellowship||{}).groupEncState === "function"'))) {
    throw new Error('the handset is still serving an older bundle — nothing below would mean anything');
  }

  await tapAdvance('I’m new here');
  await typeInto('Maria', 'Hannah');
  await sleep(500);
  await tapAdvance('Continue as Hannah');
  await sleep(1500);
  await tap('I’ll back these up later');
  await sleep(800);
  check('skipping the 12 words asks for confirmation first',
    await bodyHas('Skip') && !(await bodyHas('Enter your PIN')), 'the confirm step is reachable');
  await tap('Skip anyway', false); await tap('Skip', false);
  await sleep(1500);
  await typeInto('At least 6', PIN);
  await typeInto('again to confirm', PIN);
  await sleep(400);
  await tap('Set a PIN', false);
  await sleep(9000);
  const me = await ev('(window.Fellowship && window.Fellowship.myPubkey) || ""');
  check('onboarding completes and an identity exists', /^[0-9a-f]{64}$/.test(me || ''), (me || '').slice(0, 12) + '…');
  check('the app reaches the church', await waitFor(async () => await ev('window.Fellowship.relayReady()'), 40000));
  check('Today names the church', await bodyHas('St Mary the Virgin'));
  await shot('01-today');

  console.log('\n── the You screen ──────────────────────────────────────────────────────────');
  // ASSERT THE SCREEN OPENED BEFORE ASSERTING ANYTHING ABOUT IT. Both checks below used to pass whether or
  // not the tap landed: the result was discarded, and the Today screen already shows the church name, so
  // "the You screen names your church" really meant "some screen does". The absence check was worse — a
  // panel that was never on this screen is trivially absent from any other one.
  const openedYou = await tap('You', false);
  await sleep(3500);
  const onYou = await waitFor(async () => await bodyHas('MY CHURCH') && await bodyHas('Edit name & mark'), 20000, 2000);
  check('the You screen actually opens', openedYou && onYou, 'anchored on markings unique to that screen');
  if (onYou) {
    check('the You screen names the church you are in', await bodyHas('St Mary the Virgin'));
    check('the "No account, no tracking" panel is gone', !(await bodyHas('No account, no tracking')));
  } else {
    check('the You screen names the church you are in', false, 'skipped — the screen never opened');
    check('the "No account, no tracking" panel is gone', false, 'skipped — the screen never opened');
  }
  await shot('02-you');
  await ev('history.back()'); await sleep(2500);

  console.log('\n── an ordinary room ────────────────────────────────────────────────────────');
  await tap('Community', false); await sleep(4000);
  await tap('Readings', false); await sleep(4000);
  check('an empty room says so rather than going blank', await bodyHas('No messages yet'));
  check('a healthy connection does NOT claim the church is unreachable', !(await bodyHas('reach your church')));
  check('an ordinary room is labelled Not encrypted', (await pillText()) === 'Not encrypted', await pillText());
  await shot('03-room-clear');
  const canaryClear = 'DEVICE-CLEAR-' + process.pid;
  await ev(`(async function(){ await window.Fellowship.publishMessage('readings', ${JSON.stringify(canaryClear)}, []); return 1; })()`);
  await sleep(5000);
  check('a message in an ordinary room reaches the relay', inRelay(canaryClear) > 0,
    'stored in the clear, which is what "Not encrypted" means');

  console.log('\n── an encrypted room, with no key ──────────────────────────────────────────');
  await ev('history.back()'); await sleep(2500);
  const opened = await tap('Leaders (encrypted)', false);
  await sleep(4000);
  check('the encrypted room opens', opened);
  check('with no key it does NOT claim to be encrypted', (await pillText()) === 'Encrypted · no key yet', await pillText());
  await shot('04-room-nokey');
  const canaryNoKey = 'DEVICE-NOKEY-' + process.pid;
  const refused = await ev(`(async function(){ var r = await window.Fellowship.publishMessage('${ENC_GID}', ${JSON.stringify(canaryNoKey)}, []); return (r && r._refused) || 'sent'; })()`);
  check('the send is refused rather than going out unlocked', refused === 'nokey', 'publishMessage → ' + refused);
  await sleep(4000);
  check('nothing reached the relay in the clear', inRelay(canaryNoKey) === 0, 'searched the whole relay database');

  console.log('\n── …and once the key arrives ───────────────────────────────────────────────');
  execFileSync('node', [new URL('./seed-encrypted-group.mjs', import.meta.url).pathname, 'ws://127.0.0.1:8000/relay', me], { encoding: 'utf8', timeout: 30000 });
  const flipped = await waitFor(async () => (await pillText()) === 'End-to-end encrypted', 60000);
  check('the label follows the key, without reopening the room', flipped, await pillText());
  await shot('05-room-sealed');
  const canarySealed = 'DEVICE-SEALED-' + process.pid;
  const sent = await ev(`(async function(){ var r = await window.Fellowship.publishMessage('${ENC_GID}', ${JSON.stringify(canarySealed)}, []);
    await new Promise(function(r2){setTimeout(r2,4000);});
    return JSON.stringify({ refused: (r && r._refused) || null, enc: !!(r && r.tags && r.tags.some(function(t){return t[0]==='enc';})), delivered: r && r._delivered }); })()`);
  const s = JSON.parse(sent);
  check('with a key the send goes through, sealed', !s.refused && s.enc && s.delivered !== false, sent);
  await sleep(3000);
  check('the relay stores ciphertext, not the words', inRelay(canarySealed) === 0, 'the plaintext appears nowhere in the database');

  console.log('\n── radios off: can the app still tell the truth? ───────────────────────────');
  // IN AN EMPTY ROOM, DELIBERATELY. "Can't reach your church" is the empty-state message: a room with
  // messages in it shows the messages, offline or not, which is correct — the first version of this check
  // looked for the warning in the room we had just posted to and called the app wrong for behaving right.
  await ev('history.back()'); await sleep(2500);
  // A distinctive name, because the matcher matches by PREFIX: asking for "Music" opened "Musicians", a room
  // full of seeded conversation, and the run then measured the empty state in a room that was not empty.
  await tap('Zzz quiet test room', true);
  await sleep(4500);
  const inQuiet = await waitFor(async () => await bodyHas('Zzz quiet test room') && await bodyHas('No messages yet'), 20000, 2000);
  check('an empty room is where the offline message belongs', inQuiet, 'confirmed empty from inside the room, not from the list behind it');
  adb('shell', 'svc', 'wifi', 'disable');
  adb('shell', 'svc', 'data', 'disable');
  const wentOffline = await waitFor(async () => !(await ev('window.Fellowship.relayReady()')), 75000, 3000);
  check('losing signal is noticed at all', wentOffline, 'relayReady() went false');
  const saysOffline = await waitFor(async () => await bodyHas('reach your church'), 30000, 3000);
  check('an offline room SAYS it cannot reach the church', saysOffline);
  await shot('06-offline');
  adb('shell', 'svc', 'wifi', 'enable');
  adb('shell', 'svc', 'data', 'enable');
  check('it comes back when the signal does', await waitFor(async () => await ev('window.Fellowship.relayReady()'), 90000, 3000));

  await waitFor(async () => await ev('window.Fellowship.relayReady()'), 60000, 3000);
  console.log('\n── the lock ────────────────────────────────────────────────────────────────');
  await goto(BASE + '/index.html', 10000);
  // WAIT FOR THE BOOT, don't photograph the splash. With the HTTP cache disabled a cold start is slower than
  // it looks, and the first version of this asserted against the launch screen and reported a missing lock.
  check('a PIN-locked account asks for the PIN on a fresh start',
    await waitFor(async () => await bodyHas('Enter your PIN'), 45000, 2500));
  await shot('07-lock');
  check('a locked phone still offers a way back in', await bodyHas('Forgot your PIN?'));
  await typeInto('PIN', PIN);
  await sleep(400);
  await tap('Unlock', false);
  await sleep(7000);
  check('unlocking re-authenticates to the relay', await waitFor(async () => await ev('window.Fellowship.relayReady()'), 45000));
  await shot('08-unlocked');
} catch (e) {
  check('the run completed', false, e.message);
  try { await shot('zz-where-it-stopped'); } catch {}
} finally {
  adb('shell', 'svc', 'wifi', 'enable');
  adb('shell', 'svc', 'data', 'enable');
  console.log('\n──────────────────────────────────────────────────────────────────────────');
  console.log('  ' + pass + ' passed, ' + fail + ' failed        screenshots in ' + OUT);
  if (fail) console.log('  failed: ' + results.filter(r => !r.ok).map(r => r.name).join(' | '));
  try { ws.close(); } catch {}
  process.exit(fail ? 1 : 0);
}
