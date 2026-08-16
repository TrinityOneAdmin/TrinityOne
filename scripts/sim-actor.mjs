// DRIVE ONE LIVE APP INSTANCE, ONE COMMAND AT A TIME — so an agent can behave as a person.
//
//   node scripts/sim-actor.mjs <port> see                 what is on screen right now
//   node scripts/sim-actor.mjs <port> tap "Community"     tap a control by its visible text
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

const [port, cmd, a1, a2] = process.argv.slice(2);
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
await send('Runtime.enable', {}); await send('Page.enable', {});

const out = (x) => { console.log(typeof x === 'string' ? x : JSON.stringify(x)); };

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
    const box = await ev(`(function(){
      var norm=${NORM}; var want=norm(${JSON.stringify(a1)});
      var all=[].slice.call(document.querySelectorAll('button,a,[role="button"],div,span,label')).filter(function(x){
        var tx=norm((x.innerText||'').trim()); var r=x.getBoundingClientRect();
        return tx.indexOf(want)===0 && r.width>25 && r.height>10;});
      if(!all.length) return null;
      all.sort(function(a,b){return (a.innerText||'').length-(b.innerText||'').length;});
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
      var i=[].slice.call(document.querySelectorAll('input,textarea')).filter(function(x){return norm(x.placeholder||'').indexOf(want)>=0;})[0];
      if(!i) return 'no field matching ' + ${JSON.stringify(a1)};
      i.focus();
      var proto = i.tagName==='TEXTAREA'?window.HTMLTextAreaElement.prototype:window.HTMLInputElement.prototype;
      var s=Object.getOwnPropertyDescriptor(proto,'value').set;
      s.call(i, ${JSON.stringify(a2 || '')}); i.dispatchEvent(new Event('input',{bubbles:true})); return 'typed';})()`);
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
ws.close();
process.exit(0);
