// DRIVE ONE LIVE APP INSTANCE, ONE COMMAND AT A TIME — so an agent can behave as a person.
//
//   node scripts/sim-actor.mjs <port> see                 what is on screen right now
//   node scripts/sim-actor.mjs <port> tap "Community"     tap a control by its visible text (or aria-label)
//   node scripts/sim-actor.mjs <port> type "Message" "…"  type into the field with that placeholder
//   node scripts/sim-actor.mjs <port> send "hello"        put text in the composer and press Enter
//   node scripts/sim-actor.mjs <port> back                go back
//   node scripts/sim-actor.mjs <port> file /path/x.json   choose that file in a file picker
//   node scripts/sim-actor.mjs <port> shot <file>         screenshot
//   node scripts/sim-actor.mjs <port> eval "<js>"         read something out of the page
//
// WHY A CLI AND NOT A SCRIPT. A scripted simulation only ever does what its author thought to write, and its
// author is the same person who wrote the code — so it rehearses the paths already believed to work. Handing
// the controls to independent actors produces interleavings nobody scripted: two people writing at once, a
// steward acting while a member is mid-send, someone wandering into a screen at the wrong moment. That is
// exactly where this week's defects lived.
//
// The browser stays alive between commands; only this process is short-lived. State therefore lives where it
// does for a real person — in the app — rather than in a test harness's memory.
import { WebSocket } from 'ws';
import { writeFileSync } from 'node:fs';

const [port, cmd, a1, a2, a3] = process.argv.slice(2);   // a3 = which match (1-based): three-box checks
if (!port || !cmd) { console.error('usage: sim-actor.mjs <port> <see|tap|type|send|back|shot|eval> [args]'); process.exit(2); }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const t = list.find(x => x.type === 'page');
if (!t) { console.error('no page on port ' + port + ' — is that instance running?'); process.exit(1); }
const ws = new WebSocket(t.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
let id = 0;
const send = (m, p) => new Promise((res, rej) => {
  const n = ++id;
  const on = d => { const x = JSON.parse(d); if (x.id === n) { ws.off('message', on); x.error ? rej(new Error(JSON.stringify(x.error))) : res(x.result); } };
  ws.on('message', on); ws.send(JSON.stringify({ id: n, method: m, params: p }));
});
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result.value;
await new Promise(r => ws.on('open', r));

const out = (x) => { console.log(typeof x === 'string' ? x : JSON.stringify(x)); };

// AN UNANSWERED confirm() KILLS THE INSTANCE FOR EVER, and it killed three steward consoles on 2026-08-19.
//
// The chain, measured rather than reasoned: this CLI enables the Page domain, and once a DevTools client has
// done that, Chrome stops auto-dismissing the page's own dialogs and waits for that client to answer them.
// This process is one-shot — it taps, then exits at the bottom of the file — so a tap on any control guarded
// by window.confirm() opens a dialog and then abandons it. The renderer parks inside the dialog's nested run
// loop: alive, 0% CPU, no longer answering Runtime.evaluate, and — the detail that cost hours — Chrome has by
// then forgotten the dialog, so Page.handleJavaScriptDialog answers "No dialog is showing". The instance is
// unrecoverable except by navigating it, which the browser process can still do.
//
// The console guards its biggest actions this way: auto-fill ("Create weekly services for the next ~4
// weeks…"), "Remove series", "Rotate…", closing a care need, publishing drafts, restoring a church, leaving
// a network. So the harness reliably destroyed the console at exactly the moments a steward does real work,
// and the round then read as "the console freezes" — a product defect that does not exist. Worse, every one
// of those controls has therefore never once been exercised by a simulation.
//
// A person confronted with "Create weekly services…? OK / Cancel" who wanted that action presses OK, so we
// accept, and we PRINT what was agreed to — an actor must never silently consent to something it did not
// read. A prompt() needs words: pass them as the extra argument (`tap "New fund" "Missions"`), and when none
// were given, say so rather than creating something nameless.
const dialogs = [];
ws.on('message', (d) => {
  let x; try { x = JSON.parse(d); } catch { return; }
  if (x.method !== 'Page.javascriptDialogOpening') return;
  const p = x.params || {};
  const msg = String(p.message || '').replace(/\s+/g, ' ').trim();
  const wantsText = p.type === 'prompt';
  const answer = wantsText ? (a2 === undefined ? null : String(a2)) : null;
  const accept = !(wantsText && answer === null);
  dialogs.push(p.type + ': "' + msg.slice(0, 140) + '" -> ' +
    (!accept ? 'CANCELLED (a prompt needs an answer: pass it as the last argument)'
             : wantsText ? 'answered "' + answer + '"' : 'accepted (OK)'));
  ws.send(JSON.stringify({ id: ++id, method: 'Page.handleJavaScriptDialog',
    params: accept && wantsText ? { accept: true, promptText: answer } : { accept } }));
});

// A WEDGED INSTANCE MUST SAY SO INSTEAD OF HANGING. Enabling the domains is itself a renderer round-trip, so
// on an instance wedged by an older run this used to hang for ever with no output at all.
const withTimeout = (p, ms, label) => Promise.race([p, sleep(ms).then(() => { throw new Error('TIMEOUT ' + label); })]);
let wedged = false;
try {
  await withTimeout(Promise.all([send('Runtime.enable', {}), send('Page.enable', {})]), 8000, 'enable');
  await withTimeout(send('Runtime.evaluate', { expression: '1', returnByValue: true }), 8000, 'ping');
} catch { wedged = true; }
if (wedged) {
  // The browser process still answers even when the page's main thread does not, so it can navigate the tab
  // out of the stuck dialog loop. The app's own state lives in storage, so the church survives; whatever was
  // half-typed on screen does not.
  await send('Page.navigate', { url: t.url }).catch(() => {});
  await sleep(4000);
  try { await withTimeout(Promise.all([send('Runtime.enable', {}), send('Page.enable', {})]), 8000, 're-enable'); } catch {}
  out('NOTE: this instance was frozen by a dialog nobody answered, and has been reloaded. You are back at ' +
      'the app\'s opening screen; anything half-filled on the old screen is gone. Carry on, and say so in ' +
      'your report if you were mid-way through something.');
}

// TYPOGRAPHIC PUNCTUATION COST A WHOLE ROUND. The app's copy is written properly — "I’ll help", "what’s on",
// "don’t" — with U+2019, while anyone typing a target types an ASCII apostrophe. So `tap "I'll help"` found
// nothing, and on 2026-08-17 three actors independently reported the care sign-up button as BROKEN when it
// was simply unreachable to them; one of them was rightly suspicious and called it a harness limit. That was
// the single control the round existed to exercise. Normalise both sides — curly quotes, dashes, ellipsis —
// so a person's plain typing matches the product's proper typography.
const NORM = `(function(s){ return String(s||'')
  .replace(/[\u2018\u2019\u201B]/g, "'")
  .replace(/[\u201C\u201D]/g, '"')
  .replace(/[\u2013\u2014]/g, '-')
  .replace(/\u2026/g, '...')
  .replace(/\u00A0/g, ' '); })`;

try {
  if (cmd === 'see') {
    // THIS COMMAND MANUFACTURED A FINDING, so read the note before shortening it again.
    //
    // It used to be `innerText.slice(0, 1800)`. Two things are wrong with that on a busy screen, and together
    // they produced the 2026-08-16 report "a room shows old messages while its list shows new ones", which
    // survived into a written findings document and was independently "confirmed" by three agents:
    //
    //   1. innerText ignores scroll ENTIRELY. A room scrolled correctly to its newest message still returns
    //      its whole history, oldest first.
    //   2. Slicing the first 1800 characters therefore returns the OLDEST messages and drops the newest.
    //
    // So a chat room reads as frozen hours in the past, and a QUIET room — which fits inside 1800 characters
    // — reads as perfectly current. That is exactly the shape of "staleness scales with room busyness", and
    // it is entirely this function. (Measured: a room whose newest message was 7:46 PM reported 5:12 PM.)
    //
    // Now: head AND tail, and it SAYS when it cut. If what you are judging is recency or ordering, take a
    // screenshot — that is the only thing here that reflects what a person would actually see.
    const LIMIT = 3000, KEEP = 1200;
    const txt = await ev('document.body.innerText.replace(/\\n{2,}/g,"\\n")');
    if (!txt) { out('(blank screen)'); }
    else if (txt.length <= LIMIT) { out(txt); }
    else {
      out(txt.slice(0, KEEP)
        + `\n\n… [${txt.length - KEEP * 2} characters not shown — this screen is longer than one screenful. `
        + `What follows is the END of it. innerText ignores scroll, so NEITHER half tells you what is actually `
        + `visible; use \`shot\` if that matters.] …\n\n`
        + txt.slice(-KEEP));
    }
  } else if (cmd === 'tap') {
    // ICON-ONLY CONTROLS HAVE NO TEXT TO MATCH, and this cost a second round.
    //
    // A back chevron, an × close, an icon action — their innerText is EMPTY, and they carry their meaning in
    // `aria-label` or `title`. Matching visible text alone made every one of them unreachable, so an actor who
    // walked into a full-screen pane whose only exit was a chevron could not leave it. On 2026-08-17 three
    // actors independently reported the Currency screen as an "inescapable modal blocking the entire app";
    // one made forty attempts and lost her whole round to it. It is a screen with an `aria-label="Back"`
    // button that works perfectly — the harness simply could not see it.
    //
    // So: visible text first (that is what a person reads), then the accessible name. Same order a screen
    // reader would use, and it means anything a sighted person can tap, an actor can tap.
    const box = await ev(`(function(){
      var norm=${NORM}; var want=norm(${JSON.stringify(a1)});
      var vis=function(x){ var r=x.getBoundingClientRect(); return r.width>18 && r.height>10; };
      var all=[].slice.call(document.querySelectorAll('button,a,[role="button"],div,span,label')).filter(function(x){
        return norm((x.innerText||'').trim()).indexOf(want)===0 && vis(x);});
      if(!all.length){
        all=[].slice.call(document.querySelectorAll('button,a,[role="button"],input[type=button],input[type=submit]')).filter(function(x){
          var n=norm(((x.getAttribute('aria-label')||'')+' '+(x.title||'')).trim());
          return n && n.indexOf(want)===0 && vis(x);});
      }
      if(!all.length) return null;
      // A heading and its button often carry the SAME text ("Add relay" is a DIV label AND a BUTTON).
      // Sorting by text length alone left that tie to document order, which put the heading first — so the
      // harness tapped a label's coordinates, nothing happened, and it still printed "tapped Add relay".
      // Round 9's vicar reported "Add relay does nothing" five times over a button that works perfectly.
      // Real controls therefore win ties: anything a person could actually press beats a DIV/SPAN/LABEL.
      var live=function(x){ return /^(BUTTON|A)$/.test(x.tagName) || x.getAttribute('role')==='button'
        || (x.tagName==='INPUT' && /^(button|submit)$/i.test(x.type||'')); };
      all.sort(function(a,b){ var d=(live(a)?0:1)-(live(b)?0:1); if(d) return d;
        return (a.innerText||'').length-(b.innerText||'').length;});
      var e=all[0]; e.scrollIntoView({block:'center'}); var r=e.getBoundingClientRect();
      return JSON.stringify({x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)});})()`);
    if (!box) { out('NOT FOUND: ' + a1 + ' — run `see` to check what is on screen'); process.exit(0); }
    const { x, y } = JSON.parse(box);
    // touch, not mouse: the app treats this as a phone, and a mouse click reaches nothing
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await sleep(60);
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(1400);
    out('tapped ' + a1);
  } else if (cmd === 'type') {
    const r = await ev(`(function(){
      var norm=${NORM}; var want=norm(${JSON.stringify(a1)});
      var val=${JSON.stringify(a2 === undefined ? null : a2)};
      var nth=${JSON.stringify(a3 ? parseInt(a3, 10) : 0)};
      var vis=function(x){ var r=x.getBoundingClientRect(); return r.width>8 && r.height>6; };
      var all=[].slice.call(document.querySelectorAll('input,textarea')).filter(vis);
      var i;
      if (val === null) {
        val = ${JSON.stringify(a1)};
        // SKIP SEARCH BOXES. One-argument type() takes the first visible field, and on a chat screen that is
        // the search box, not the composer — so the text lands somewhere harmless and send then submits an
        // empty message. Nia (session 3) posted three times and a private message twice, watched the box
        // empty each time, and concluded nobody in her church wanted to talk to her. Every one of them was
        // this. Use the send command for chat; this only stops the silent mis-aim.
        // (No backticks anywhere in this comment: it lives INSIDE a template literal, and one ends it
        //  early. The file already warns about that further down, and I did it anyway.)
        var usable = all.filter(function(x){ return !/^(checkbox|radio|button|submit|file)$/i.test(x.type||'')
          && !/search|find/i.test(x.placeholder || '') && x.type !== 'search'; });
        i = usable[0];
      } else {
        var hits = all.filter(function(x){return norm(x.placeholder||'').indexOf(want)>=0;});
        i = hits[nth > 0 ? (nth - 1) : 0];
      }
      if(!i) return 'no field matching ' + ${JSON.stringify(a1)};
      i.focus();
      var proto = i.tagName==='TEXTAREA'?window.HTMLTextAreaElement.prototype:window.HTMLInputElement.prototype;
      var s=Object.getOwnPropertyDescriptor(proto,'value').set;
      s.call(i, String(val == null ? '' : val)); i.dispatchEvent(new Event('input',{bubbles:true})); return 'typed';})()`);
    out(r);
  } else if (cmd === 'send') {
    const ok = await ev(`(function(){
      var t=[].slice.call(document.querySelectorAll('textarea')).filter(function(x){return /Message|Share a/.test(x.placeholder||'');})[0];
      if(!t) return 'no composer on this screen';
      t.focus();
      var s=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set;
      s.call(t, ${JSON.stringify(a1 || '')}); t.dispatchEvent(new Event('input',{bubbles:true})); return 'ok';})()`);
    if (ok !== 'ok') { out(ok); process.exit(0); }
    await sleep(250);
    for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
    await sleep(1600);
    const cleared = await ev(`(function(){var t=[].slice.call(document.querySelectorAll('textarea')).filter(function(x){return /Message|Share a/.test(x.placeholder||'');})[0];
      return t && !t.value ? 'sent' : 'STILL IN COMPOSER — it did not send';})()`);
    out(cleared);
  } else if (cmd === 'reload') {
    // A REAL RELOAD, not location.reload(). The gateway serves app/*.jsx with a `?v=<sha>` cache-buster tied to
    // the RELEASE commit, so a working-tree edit keeps the same URL and the browser keeps serving the version it
    // already has. Clearing the service worker is not enough — that is a different cache from the HTTP one, and
    // on 2026-08-17 a fix verified as "still broken" purely because of this. So: disable the HTTP cache, drop
    // any service worker, then reload ignoring the cache.
    await send('Network.enable', {});
    await send('Network.setCacheDisabled', { cacheDisabled: true });
    await ev(`(async function(){
      try { if (navigator.serviceWorker) { var rs = await navigator.serviceWorker.getRegistrations(); for (var i=0;i<rs.length;i++) await rs[i].unregister(); } } catch (e) {}
      try { if (window.caches) { var ks = await caches.keys(); for (var j=0;j<ks.length;j++) await caches.delete(ks[j]); } } catch (e) {}
      return 'cleared';
    })()`);
    await send('Page.reload', { ignoreCache: true });
    await sleep(Number(a1) > 0 ? Number(a1) : 9000);
    out('reloaded (http cache + service worker bypassed)');
  } else if (cmd === 'back') {
    // DO NOT WALK OFF THE END OF THE APP. history.back() from the app's first screen leaves the page entirely
    // and lands on the blank tab the browser opened with — a white screen that no tap can recover. Two actors
    // spent the rest of their run reporting that as a crash in the product, and both cited the project's own
    // note about silent blank-app bugs to explain it. A phone's back button exits the app; it does not leave
    // you staring at nothing. So refuse to leave, and say so.
    const before = await ev('location.href');
    if (/about:blank/.test(String(before))) { out('the app is not open on this instance (blank tab) — nothing to go back to'); ws.close(); process.exit(0); }
    await ev('history.back()');
    await sleep(1200);
    const after = await ev('location.href');
    if (/about:blank/.test(String(after))) {
      await send('Page.navigate', { url: String(before) });
      await sleep(3000);
      out('already at the start of the app — stayed put (a real phone would exit here)');
    } else out('went back');
  } else if (cmd === 'file') {
    // HAND A FILE TO A FILE PICKER. A member restoring a backup has to choose a file, and a page cannot be
    // made to do that from script — the picker is the browser's, and its value is not settable. CDP's
    // DOM.setFileInputFiles is the only honest way to simulate "the member chose this file", so without this
    // command the entire restore-from-file flow is undrivable and therefore untestable by an actor.
    await send('DOM.enable', {});
    const doc = await send('DOM.getDocument', { depth: -1 });
    const node = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: 'input[type=file]' });
    if (!node.nodeId) { out('no file picker on this screen — open the restore screen first'); }
    else {
      await send('DOM.setFileInputFiles', { files: [a1], nodeId: node.nodeId });
      await sleep(1200);
      out('chose ' + a1);
    }
  } else if (cmd === 'shot') {
    const s = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(a1, Buffer.from(s.data, 'base64')); out('wrote ' + a1);
  } else if (cmd === 'eval') {
    out(await ev(a1));
  } else out('unknown command: ' + cmd);
} catch (e) { out('ERROR: ' + e.message); }
// Report anything the app asked and this actor answered on their behalf, so consent is visible in the log.
await sleep(150);
for (const d of dialogs) out('the app asked, and I answered — ' + d);
ws.close();
process.exit(0);
