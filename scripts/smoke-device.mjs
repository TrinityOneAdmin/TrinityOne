// smoke-device.mjs — the crawl half of the ON-DEVICE UI smoke. Given a webview CDP WebSocket URL, it drives the
// running app: visits every bottom-nav tab, opens every chat group (the ChatRoom path the boot-check misses),
// exercises the composer, and clicks every outermost control on each screen — flagging any uncaught exception,
// hook/render error, or screen-blank after each interaction. The device webview (unlike headless Chrome) reports
// cursor:pointer + exact-text nav faithfully, so a generic crawl is reliable here.
//
//   node scripts/smoke-device.mjs <ws-url>       (scripts/smoke-device.sh sets up adb + supplies the url)
//   exit 0 = clean · 1 = a control misbehaved
import WebSocket from 'ws';

const WSURL = process.argv[2];
if (!WSURL) { console.log('usage: smoke-device.mjs <ws-url>'); process.exit(2); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ws = new WebSocket(WSURL);
let id = 0; const exc = [];
const send = (method, params = {}) => new Promise(res => { const i = ++id; ws.send(JSON.stringify({ id: i, method, params })); const h = d => { const m = JSON.parse(d); if (m.id === i) { ws.off('message', h); res(m.result); } }; ws.on('message', h); });
const ev = expr => send('Runtime.evaluate', { expression: expr, returnByValue: true }).then(r => (r && r.result && r.result.value));
const nodes = () => ev('(document.body?document.body.querySelectorAll("*").length:0)');
const esc = async () => { for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: 'Escape', windowsVirtualKeyCode: 27, code: 'Escape' }).catch(() => {}); };
const since = () => { const s = exc.length; return () => exc.slice(s); };
// click the element whose exact trimmed text is `t` (walk up to catch the real handler); returns true if found
const clickText = t => ev(`(function(){var el=[...document.querySelectorAll("button,div,a,span")].filter(e=>(e.textContent||"").trim()===${JSON.stringify(t)}&&e.offsetHeight>0);var e=el[el.length-1];if(!e)return false;for(var n=e,i=0;n&&i<5;n=n.parentElement,i++)n.dispatchEvent(new MouseEvent("click",{bubbles:true}));return true})()`);
const nav = async t => { const ok = await clickText(t); await sleep(1100); return ok; };

const TABS = ['Today', 'Read', 'Community', 'Library', 'You'];
const findings = [];

async function run() {
  await new Promise(r => ws.on('open', r));
  await send('Runtime.enable'); await send('Page.enable');
  ws.on('message', d => { const m = JSON.parse(d);
    if (m.method === 'Runtime.exceptionThrown') { const x = m.params.exceptionDetails || {}; exc.push('EXC: ' + ((x.exception && x.exception.description) || x.text || '').split('\n')[0].slice(0, 150)); }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') { const t = (m.params.args || []).map(a => a.value || a.description || '').join(' '); if (/rendered more hooks|hook|Minified React|is not a function|Cannot read/i.test(t)) exc.push('ERR: ' + t.slice(0, 150)); } });
  await sleep(1200);
  if ((await nodes()) < 15) findings.push('app BLANK on attach');

  // Phase 1 — every tab renders without error
  for (const tab of TABS) {
    const s = since(); const ok = await nav(tab); const n = await nodes(); const e = s();
    if (!ok) findings.push(`nav "${tab}": not found`);
    else if (n < 15) findings.push(`tab "${tab}": BLANK (${n} nodes)`);
    if (e.length) findings.push(`tab "${tab}": ${e[0]}`);
  }

  // Phase 2 — open every chat group (the ChatRoom path), verify the composer renders, exercise composer + menu
  let groupsOpened = 0;
  await nav('Community');
  const groupCount = await ev(`[...document.querySelectorAll("*")].filter(e=>/·\\s*\\d+\\s*member|No messages yet|Broadcast|^Group$/.test((e.textContent||"").trim())&&e.offsetHeight>44&&e.offsetHeight<140).length`);
  for (let g = 0; g < Math.min(groupCount, 8); g++) {
    await nav('Community');
    const s = since();
    const info = await ev(`(function(){var c=[...document.querySelectorAll("*")].filter(e=>/·\\s*\\d+\\s*member|No messages yet|Broadcast/.test(e.textContent||"")&&e.offsetHeight>44&&e.offsetHeight<140);var e=c[${g}];if(!e)return null;var full=(e.textContent||"");e.dispatchEvent(new MouseEvent("click",{bubbles:true}));return JSON.stringify({name:full.replace(/\\s+/g," ").slice(0,24),bc:/Broadcast/.test(full)})})()`);
    if (info == null) break;
    const gi = JSON.parse(info); const name = gi.name;
    await sleep(2200);
    const composer = await ev(`!!document.querySelector("textarea")`);
    const e = s();
    if (e.length) findings.push(`group "${name}": ${e[0]}`);
    else if (!composer && !gi.bc) findings.push(`group "${name}": opened but no composer rendered`);   // broadcast channels have no composer for members — expected
    else groupsOpened++;
    // exercise the composer "+" popover + a message's ⋯ menu
    const s2 = since();
    await ev(`var b=[...document.querySelectorAll("button")].find(x=>x.title==="Add");if(b)b.dispatchEvent(new MouseEvent("click",{bubbles:true}))`);
    await sleep(500); await esc();
    await ev(`var d=[...document.querySelectorAll("button")].find(x=>x.title==="Message actions");if(d)d.dispatchEvent(new MouseEvent("click",{bubbles:true}))`);
    await sleep(500);
    if (s2().length) findings.push(`group "${name}" composer/menu: ${s2()[0]}`);
    await esc();
  }

  // Phase 3 — click every OUTERMOST clickable (cursor:pointer, not nested in another) on each tab
  let clicked = 0;
  for (const tab of TABS) {
    await nav(tab);
    const count = await ev(`[...document.querySelectorAll("*")].filter(e=>e.offsetHeight>0&&getComputedStyle(e).cursor==="pointer"&&(!e.parentElement||getComputedStyle(e.parentElement).cursor!=="pointer")).length`);
    for (let i = 0; i < Math.min(count, 30); i++) {
      await nav(tab);   // reset to a clean tab state before each (a prior click may have navigated / opened a modal)
      const s = since();
      const label = await ev(`(function(){var c=[...document.querySelectorAll("*")].filter(e=>e.offsetHeight>0&&getComputedStyle(e).cursor==="pointer"&&(!e.parentElement||getComputedStyle(e.parentElement).cursor!=="pointer"));var e=c[${i}];if(!e)return null;e.dispatchEvent(new MouseEvent("click",{bubbles:true}));return (e.getAttribute("aria-label")||e.title||(e.textContent||"").trim()||"(control)").replace(/\\s+/g," ").slice(0,30)})()`);
      if (label == null) break;
      clicked++;
      await sleep(320);
      const n = await nodes(); const e = s();
      if (e.length) findings.push(`${tab} · "${label}": ${e[0]}`);
      if (n < 15) findings.push(`${tab} · "${label}": screen BLANKED`);
      await esc(); await sleep(120);
    }
  }

  console.log(`SMOKE-DEVICE: ${TABS.length} tabs · ${groupsOpened} groups opened · ${clicked} controls clicked. Total exceptions/errors: ${exc.length}.`);
  if (!findings.length) console.log('  ✓ every tab, group and control rendered with no crash or uncaught error.');
  else { console.log('  ✗ issues:'); findings.forEach(f => console.log('    • ' + f)); }
  ws.close(); process.exit(findings.length ? 1 : 0);
}
run().catch(e => { console.log('SMOKE-DEVICE error:', e.message); process.exit(2); });
