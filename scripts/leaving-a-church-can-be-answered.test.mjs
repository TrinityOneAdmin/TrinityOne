// THE "LEAVE THIS CHURCH?" WARNING MUST HAVE ITS TWO BUTTONS ON THE SCREEN.
//   Run: node --test scripts/leaving-a-church-can-be-answered.test.mjs
//
// A member taps "Leave" beside a church in the church switcher and a warning opens — it names what goes with
// the church, including any children's accounts they look after there — with two answers, **Stay** and
// **Leave**. Measured by THIS FILE against the code as it shipped, with the real component laid out by a
// real browser, for a church called "St Bartholomew-the-Great":
//
//     screen      warning card   Stay / Leave   verdict                    dimmed backdrop covered
//     320 x 730   309 .. 813     744 .. 790     60px past the bottom       0..320  x 392..730
//     360 x 730   362 .. 780     711 .. 757     27px past the bottom       0..360  x 413..730
//     730 x 360    18 .. 415     346 .. 392     32px past the bottom     115..615 x  74..360
//
// and in every case asking the backdrop to scroll to the bottom moved it ZERO pixels, because it is not a
// scroll container. 730x360 is any phone held sideways. 320x730 is a small phone upright. The member is left
// looking at a warning they cannot answer, with no way out but to guess that tapping the dimmed area cancels
// — and the dimmed area is not where they would guess either, since it covers only the lower part of the
// screen and stops in a hard edge.
//
// ⚠ THE CHURCH'S NAME CHANGES THE NUMBERS, so do not treat any one of them as THE measurement. The heading
// reads "Leave <church name>?" at 18px with line-height 1.2, so a name long enough to wrap adds about 22px
// to the card. The fixture therefore uses a long real-world name ("St Bartholomew-the-Great") rather than a
// short one: a fix that only worked for short names would not be a fix. NOTHING HERE CLAIMS what a short
// name measures — that was not measured.
//
// ── THE CAUSE, and why the source looks innocent ──────────────────────────────────────────────────────────
// The warning is written `position: 'fixed', inset: 0` — "cover the whole screen" — and that is exactly what
// it does NOT do, because it is rendered INSIDE <BottomSheet> (app/ui.jsx), whose panel always carries
// `transform: translateY(0)`. A transformed ancestor becomes the containing block for every `position: fixed`
// descendant, so "the whole screen" silently means "the whole sheet". The same reason the dimming only ever
// covered the sheet and not the page behind it.
//
// It also centred with `align-items: center`, which puts a child TALLER than its container at a negative
// offset — and the part above the top cannot be scrolled to, because the scroll origin is already past it.
//
// ⚠ SO A TEST THAT READS THE STYLE OBJECT PASSES OVER THIS DEFECT. `position: fixed` is written down in the
// source, and always was. The only instrument that can see it is a browser laying the thing out. That is why
// this file boots Chromium rather than asserting on the style the component evaluated, which is what
// scripts/a-console-dialog-fits-the-phone.test.mjs does for the console's own pop-ups.
//
// ── HOW IT ASSERTS ────────────────────────────────────────────────────────────────────────────────────────
// CLAUDE.md rule 3: app/screens-church.jsx and app/ui.jsx ship UNBUNDLED, so `false && ` in front of a
// condition leaves every word of it in place and a text-matching assertion still passes. Nothing here matches
// text in app/*.jsx. The REAL ChurchSwitcher is compiled with the same esbuild the packaged build uses,
// rendered through the miniature React in scripts/render-jsx-screen.mjs with the REAL BottomSheet and the
// REAL Icon, and the warning is opened by CALLING THE REAL "Leave this church" BUTTON'S OWN onClick and
// drawing again — not by reaching into state. The tree is then serialised, dressed in index.html's own
// <style> block and the app's own Sora files, and laid out by a real browser inside a replica of the member
// app's phone shell (`.trinity` fixed inset 0 > PhoneFrame bare, absolute inset 0 — neither transformed,
// which is the honest chain: the ONLY transform above the warning is BottomSheet's own panel).
//
// Every assertion reads getBoundingClientRect(). Deleting the fix from the screen changes what the browser
// measures; commenting it out does too.
//
// MEASURED RED/GREEN, 2026-09-16, this file against app/screens-church.jsx. Every sabotage was SCOPED — the
// ChurchSwitcher function was sliced out first, the anchor asserted to occur exactly once inside that slice,
// then replaced there — because near-identical sibling sheets are this file's house style and a file-wide
// replace hits the wrong one. The BASELINE row is here on purpose: a broken harness fails every row, which
// looks identical to every sabotage biting.
//
//   sabotage                                                     pass  fail
//   BASELINE — nothing sabotaged                                   8     0
//   the whole of app/screens-church.jsx reverted to 9feffbb        1     7   <- the shipped screen
//   the warning put back INSIDE <BottomSheet> (styles kept)        5     3   <- all three backdrop cases
//   `overflowY: auto` removed                                      7     1   <- 730x360 only
//   `safe center` -> `center`                                      7     1   <- 730x360, card top = -18
//   the `open &&` guard removed from `leavingChurch`               7     1   <- the stranded-warning case
//   the whole warning deleted from the screen                      0     8
//
// ⚠ TWO ROWS NEED READING CAREFULLY.
//
// The "reverted to 9feffbb" row fails 7, and ONE of those 7 is not a defect in the shipped screen: the
// stranded-warning case. In the shipped screen the warning is a CHILD of the sheet, so during the sheet's
// exit animation it is still in the tree — and it slides off the screen with the panel, because a
// `position: fixed` child of a transformed ancestor moves with it. Nothing is stranded there. That case
// exists because the FIX removes that guarantee, and it is proved by its own scoped sabotage below.
//
// The "put back INSIDE <BottomSheet>" row is the interesting one. Nesting it again while KEEPING the three
// style properties leaves both answers reachable — the overlay is sheet-sized but it scrolls, so a member
// can still get to Stay and Leave. What breaks is the dimming, which then covers only the sheet. So the
// three style properties and the sibling move fix two different halves, and neither is redundant.
//
// Skips itself (rather than failing) when chromium is unavailable, so CI without a browser stays green —
// same contract as scripts/app-boots.test.mjs and scripts/todays-header-fits-the-phone.test.mjs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname, normalize } from 'node:path';
import { WebSocket } from 'ws';
import { loadScreen, miniReact, find, texts } from './render-jsx-screen.mjs';
import { requireFreePort } from './test-ports.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const CHROME = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => existsSync(p));
const CDP = 9363;   // taken in the 93xx band: 9350-9352, 9354-9358, 9360-9362, 9381, 9390, 9395, 9397, 9412-9413
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── the tree -> HTML, so a browser can lay out what the screen actually built ──────────────────────────────
// The same serialiser scripts/todays-header-fits-the-phone.test.mjs and
// scripts/the-check-in-page-fits-the-phone.test.mjs use, kept local for the same reason it is local in both
// of those: it is a test instrument, and a shared one would be a third thing to keep in step with three
// files' different needs. data-tid = the node's index in `nodes`, so a test can point at ONE node it found
// in the rendered tree rather than hunting for it by text in the DOM.
const UNITLESS = new Set(['opacity', 'zIndex', 'fontWeight', 'lineHeight', 'flex', 'flexGrow', 'flexShrink',
  'order', 'zoom', 'aspectRatio', 'strokeWidth', 'strokeDashoffset', 'strokeDasharray', 'fillOpacity', 'strokeOpacity']);
const SVG_ATTR = { strokeWidth: 'stroke-width', strokeLinecap: 'stroke-linecap', strokeLinejoin: 'stroke-linejoin',
  strokeDasharray: 'stroke-dasharray', strokeDashoffset: 'stroke-dashoffset', strokeOpacity: 'stroke-opacity',
  fillOpacity: 'fill-opacity', clipPath: 'clip-path', viewBox: 'viewBox', className: 'class', htmlFor: 'for' };
const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'source', 'area', 'base', 'col', 'embed', 'track', 'wbr']);
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const kebab = k => (k.startsWith('Webkit') ? '-webkit-' + k.slice(6) : k).replace(/[A-Z]/g, c => '-' + c.toLowerCase()).replace(/^-webkit--/, '-webkit-');
const css = style => Object.entries(style || {})
  .filter(([, v]) => v != null && v !== false && v !== '')
  .map(([k, v]) => `${kebab(k)}:${typeof v === 'number' && !UNITLESS.has(k) ? v + 'px' : v}`).join(';');

function serialize(node) {
  const nodes = [], out = [];
  (function walk(n) {
    if (n == null || n === false || n === true) return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (typeof n === 'string' || typeof n === 'number') { out.push(esc(n)); return; }
    if (typeof n !== 'object') return;
    if (typeof n.type === 'function' || n.type === 'Fragment') { (n.kids || []).forEach(walk); return; }
    const tag = String(n.type), tid = nodes.length;
    nodes.push(n);
    const attrs = [`data-tid="${tid}"`];
    let inner = null;
    for (const [k, v] of Object.entries(n.props || {})) {
      if (k === 'children' || k === 'key' || k === 'ref' || v == null || v === false || typeof v === 'function') continue;
      if (k === 'style') { const s = css(v); if (s) attrs.push(`style="${esc(s)}"`); continue; }
      if (k === 'dangerouslySetInnerHTML') { inner = v.__html; continue; }
      attrs.push(`${SVG_ATTR[k] || (/^[a-z-]+$/.test(k) ? k : kebab(k))}="${esc(v === true ? '' : v)}"`);
    }
    out.push(`<${tag} ${attrs.join(' ')}>`);
    if (inner != null) out.push(inner); else (n.kids || []).forEach(walk);
    if (!VOID.has(tag)) out.push(`</${tag}>`);
  })(node);
  return { html: out.join(''), nodes };
}

// ── the real screen, with the warning opened the way a member opens it ─────────────────────────────────────
// Everything ChurchSwitcher takes from OUTSIDE its own file. A name it needs that is not here is a
// ReferenceError at the point of use — deliberately, because a silently-stubbed global is how a test ends up
// asserting about something that is not the code. BottomSheet and Icon are the REAL ones: BottomSheet's own
// `transform: translateY(0)` IS the mechanism under test, so stubbing it would measure a screen nobody has.
const Stub = n => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };

function leavePage({ churchName = 'St Bartholomew-the-Great' } = {}) {
  const { React, draw } = miniReact();
  const win = {
    addEventListener() {}, removeEventListener() {}, innerWidth: 360,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  };
  const base = {
    React, window: win, localStorage: win.localStorage,
    document: { addEventListener() {}, removeEventListener() {}, querySelector: () => null, activeElement: null },
    navigator: { userAgent: '' }, location: { search: '', hostname: 'x' },
    setTimeout, clearTimeout, setInterval, clearInterval, console,
    history: { back() {}, pushState() {}, replaceState() {}, state: null },
    fetch: async () => ({ ok: false, json: async () => ({}) }),
  };
  const { BottomSheet } = loadScreen('app/ui.jsx', ['BottomSheet'], base);
  const { Icon } = loadScreen('app/icons.jsx', ['Icon'], { React, window: {} });
  win.makeNameDisambiguator = (list, getName) => (c) => getName(c);
  const { ChurchSwitcher } = loadScreen('app/screens-church.jsx', ['ChurchSwitcher'], {
    ...base, BottomSheet, Icon,
    IconBtn: Stub('IconBtn'), Sheet: Stub('Sheet'), Halo: Stub('Halo'),
    safeCssColor: (c, d) => d, safeImgUrl: () => '',
    makeNameDisambiguator: win.makeNameDisambiguator,
    cx: (...a) => a.filter(Boolean).join(' '),
  });

  // A church with an npub is one a member can actually leave — a built-in/sample church shows no Leave
  // button at all, so a fixture without `npub` would render a switcher with nothing to tap and this file
  // would be measuring an empty screen.
  const churches = [{ id: 'c1', name: churchName, npub: 'npub1xxxx', members: 42 }];
  const props = {
    open: true, onClose() {}, ctx: { leaveChurch() {}, toast() {} },
    churches, activeId: 'c1', onPick() {}, onFollowed() {}, initialMode: 'list',
  };
  let tree = draw(ChurchSwitcher, props);

  // OPEN THE WARNING THE WAY A MEMBER DOES: press the screen's own Leave button. Found by the title the
  // screen put on it, never by text — and if that control is ever deleted this is undefined and every test
  // below says so rather than quietly measuring nothing.
  const leaveBtn = find(tree, n => n.type === 'button' && String((n.props || {}).title || '') === 'Leave this church')[0];
  const tapped = !!(leaveBtn && leaveBtn.props.onClick);
  if (tapped) { leaveBtn.props.onClick(); tree = draw(ChurchSwitcher, props); }

  // ⚠ WHAT HAPPENS IF THE SHEET IS CLOSED WHILE THE WARNING IS UP. Android's back button and the Escape key
  // both close the topmost back-stack layer, which is the SHEET — and the warning is now a SIBLING of it
  // rather than a child, so it no longer goes away by itself. Redraw with open=false and see what is left.
  const closedTree = draw(ChurchSwitcher, { ...props, open: false });
  const strandedWarning = find(closedTree, n => n.props && n.props.role === 'dialog'
    && /^Leave /.test(String(n.props['aria-label'] || ''))).length;

  // …AND THEN OPEN IT AGAIN. The `open &&` guard above only HIDES the warning while the sheet is shut; the
  // pending choice is still held in state. ChurchSwitcher is mounted for the life of the app (app/app.jsx
  // toggles `open`, it does not unmount it), so unless the effect CLEARS that choice, the next time the
  // member opens the church switcher — from the Today pill, minutes later, for something else entirely —
  // they are met with "Leave <church>?" they never asked for, with the Leave button live.
  // An independent review deleted `setConfirmLeave(null)` from that effect and ALL EIGHT tests here stayed
  // green. This is the row that closes that hole; `reopenedWarning` must be 0.
  const reopenedWarning = find(draw(ChurchSwitcher, props), n => n.props && n.props.role === 'dialog'
    && /^Leave /.test(String(n.props['aria-label'] || ''))).length;

  const { html, nodes } = serialize(tree);
  // The warning, found by the role and label the screen put on it.
  const dlgTid = nodes.findIndex(n => n.props && n.props.role === 'dialog' && /^Leave /.test(String(n.props['aria-label'] || '')));
  // Its backdrop = the node that has the dialog as a child. This is the element that claims `inset: 0`.
  const overTid = dlgTid < 0 ? -1 : nodes.findIndex(n => (n.kids || []).some(k => k && k.props && nodes[dlgTid] === k));
  // The two answers. Found INSIDE the warning, by walking the warning's own subtree — never by hunting the
  // page for text, which would happily pick up the switcher's own "Leave" button behind it.
  const answerTids = dlgTid < 0 ? []
    : find(nodes[dlgTid], n => n.type === 'button').map(b => nodes.indexOf(b)).filter(i => i >= 0);
  const answerLabels = answerTids.map(i => texts(nodes[i]).join('').trim());

  return { tapped, strandedWarning, reopenedWarning, dlgTid, overTid, answerTids, answerLabels, churchName, html:
`<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="stylesheet" href="/vendor/fonts/fonts.css">
<style>${[...readFileSync(join(ROOT, 'index.html'), 'utf8').matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n')}
html,body{margin:0;padding:0;height:100%;overflow:hidden}</style>
<!-- the member app's own phone shell: app/app.jsx renders .trinity {position:fixed;inset:0} around
     PhoneFrame bare {position:absolute;inset:0;overflow:hidden}. NEITHER is transformed — the only
     transform above the warning is BottomSheet's own panel, which is the whole of the bug. -->
<div class="trinity" style="position:fixed;inset:0">
  <div style="position:absolute;inset:0;overflow:hidden;background:var(--paper);color:var(--ink);font-family:var(--font-ui)">${html}</div>
</div>` };
}

const PAGE = leavePage();

// ── lay it out in a real browser and read the rectangles ───────────────────────────────────────────────────
let chr = null, srv = null, ws = null, send = null, dir = null;

before(async () => {
  if (!CHROME) return;
  await requireFreePort(CDP, 'leaving-a-church-can-be-answered.test.mjs (Chrome debug port)');
  dir = mkdtempSync(join(tmpdir(), 'trin-leave-'));
  // The app's own font files are served alongside the page: Sora is what sets the text heights, and the
  // height of this warning is entirely the height of its three paragraphs.
  srv = createServer((req, res) => {
    const p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/page.html') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(PAGE.html); }
    const f = join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, ''));
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': { '.css': 'text/css', '.woff2': 'font/woff2' }[extname(f)] || 'application/octet-stream' });
    res.end(readFileSync(f));
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  chr = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`, '--no-sandbox', '--disable-gpu',
    // never let a test reach production, exactly as app-boots.test.mjs does
    '--host-resolver-rules=MAP app.trinityone.church 127.0.0.1:9, MAP *.ts.net 127.0.0.1:9, MAP trinityone.church 127.0.0.1:9',
    `--user-data-dir=${join(dir, 'prof')}`, 'about:blank'], { stdio: 'ignore' });
  let targets = null;
  for (let i = 0; i < 50 && !(targets && targets.length); i++) { await sleep(300); try { targets = await (await fetch(`http://127.0.0.1:${CDP}/json`)).json(); } catch {} }
  assert.ok(targets && targets.length, 'chromium never exposed a debug target');
  const page = targets.find(t => t.type === 'page') || targets[0];
  ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 5e8 });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  let id = 0; const pend = new Map();
  ws.on('message', d => { const m = JSON.parse(d); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Page.enable');
  await send('Runtime.enable');
});

after(() => { try { ws && ws.close(); } catch {} try { chr && chr.kill('SIGKILL'); } catch {}
  try { srv && srv.close(); } catch {} try { dir && rmSync(dir, { recursive: true, force: true }); } catch {} });

// 320x730 = a small phone upright. 360x730 = the handset the owner runs. 730x360 = ANY of them held
// sideways, which is one rotation away at any moment and is where even the 360px case falls off.
const SIZES = [
  { w: 320, h: 730, name: '320x730, a small phone upright' },
  { w: 360, h: 730, name: '360x730, the Oppo handset upright' },
  // 328, NOT 360. MEASURED ON THE OPPO (CPH2477) ON 2026-09-16: held sideways the WebView reports
  // 730 x 328 — the navigation bar takes the rest. The 32px difference is not academic: at 360 the
  // RestrictedExplainer cap below measures as doing nothing, and at 328 removing it puts that sheet's
  // heading at y = -5 with nothing to scroll back up with. A test that is kinder than the handset
  // reports a screen no member has.
  { w: 730, h: 328, name: '730x328, the Oppo held sideways (measured, not assumed)' },
];

const MEASURED = new Map();

async function rects(i) {
  const S = SIZES[i];
  await send('Emulation.setDeviceMetricsOverride', { width: S.w, height: S.h, deviceScaleFactor: 1, mobile: true });
  await send('Page.navigate', { url: `http://127.0.0.1:${srv.address().port}/page.html` });
  await sleep(450);
  const expr = `(async () => { try { await document.fonts.ready; } catch (e) {}
    const el = t => document.querySelector('[data-tid="' + t + '"]');
    const box = e => { if (!e) return null; const b = e.getBoundingClientRect();
      return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height),
               right: Math.round(b.right), bottom: Math.round(b.bottom) }; };
    const OV = el(${PAGE.overTid}), DLG = el(${PAGE.dlgTid});
    const tids = ${JSON.stringify(PAGE.answerTids)};
    // AS THE SCREEN FIRST OPENS — nothing touched. This is where the negative-offset trap shows up: a child
    // taller than a container centred with plain 'center' reports a NEGATIVE top, and that part cannot be
    // scrolled to because the scroll origin is already past it.
    const atRest = { over: box(OV), dlg: box(DLG), answers: tids.map(t => box(el(t))) };
    // NOW SCROLL, as a member would try to. If the backdrop cannot scroll this changes nothing, which is
    // exactly the finding: the two answers stay where they are, off the bottom of the phone.
    const canScroll = OV ? Math.max(0, OV.scrollHeight - OV.clientHeight) : 0;
    if (OV) OV.scrollTop = OV.scrollHeight;
    const scrolledBy = OV ? Math.round(OV.scrollTop) : 0;
    const answers = tids.map(t => { const e = el(t);
      return { label: e ? (e.textContent || '').trim() : null, ...box(e) }; });
    const cs = OV ? getComputedStyle(OV) : null;
    return JSON.stringify({ vw: innerWidth, vh: innerHeight, atRest, answers, canScroll, scrolledBy,
      over: cs ? { position: cs.position, overflowY: cs.overflowY, alignItems: cs.alignItems } : null }); })()`;
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  const thrown = r.result && r.result.exceptionDetails;
  assert.ok(!thrown, 'the measuring probe threw: ' + JSON.stringify(thrown || {}).slice(0, 300));
  return JSON.parse(r.result.result.value);
}

async function measure(i) {
  if (!MEASURED.has(i)) MEASURED.set(i, await rects(i));
  return MEASURED.get(i);
}

// ⚠ THE HARNESS CHECK COMES FIRST. Every measurement below is of a warning this fixture had to open by
// pressing the screen's own button; if that stopped working, every pixel assertion would be measuring an
// empty page and passing.
test('the fixture really opened the warning, with its two answers on it',
  { timeout: 120000 }, () => {
    assert.equal(PAGE.tapped, true,
      'no control titled "Leave this church" was found beside a followed church in ChurchSwitcher — ' +
      're-anchor this test, because without it nothing below is measuring anything.');
    assert.ok(PAGE.dlgTid >= 0,
      'pressing Leave did not put a role="dialog" labelled "Leave <church>" on the screen. Either the ' +
      'warning was removed (in which case a careless double-tap leaves a church outright again — see the ' +
      'comment beside that button) or it moved.');
    assert.ok(PAGE.overTid >= 0, 'the warning has no backdrop element around it');
    assert.deepEqual(PAGE.answerLabels, ['Stay', 'Leave'],
      'the warning should offer exactly two answers, Stay and Leave; found: ' + JSON.stringify(PAGE.answerLabels));
  });

test('closing the church switcher takes the leave warning with it', { timeout: 120000 }, () => {
    // THE DEFECT THIS GUARDS IS ONE THE FIX ITSELF COULD CREATE. While the warning lived INSIDE
    // <BottomSheet> it could not outlive it: the sheet returns null when it is closed and unmounted, and the
    // warning went with it. Lifting the warning out to be a sibling — which is what makes it cover the
    // screen at all — removes that guarantee. Android's back button and the Escape key both close the
    // topmost back-stack layer, and that layer is the SHEET, not the warning. So without the `open &&`
    // guard, pressing back while the warning is up closes the switcher and leaves the warning stranded over
    // the Today page, still offering to leave a church, with nothing behind it that explains where it came
    // from.
    assert.equal(PAGE.strandedWarning, 0,
      'the "Leave this church?" warning is still on screen after the switcher closed. It is a sibling of ' +
      'the sheet now, so it has to be gated on `open` and `confirmLeave` has to be cleared when the sheet ' +
      'closes — see the note above useChE in ChurchSwitcher.');
  });

  test('…and it does not come BACK the next time the member opens the switcher', () => {
    // THE OTHER HALF OF THAT GUARD, AND IT WAS UNTESTED UNTIL A REVIEW FOUND IT. The `open &&` gate only
    // hides the warning while the sheet is shut — the pending choice is still sitting in state. The
    // switcher is mounted for the life of the app (app/app.jsx toggles `open`, it never unmounts it), so
    // without `setConfirmLeave(null)` in that effect the member opens the church switcher later, for
    // something else entirely, and is met with "Leave <church>?" they never asked for — with the Leave
    // button live and nothing explaining where it came from.
    //
    // Measured: an independent reviewer deleted that one line and all eight tests in this file stayed
    // green. Delete it now and this row goes red.
    assert.equal(PAGE.reopenedWarning, 0,
      'reopening the church switcher shows a "Leave this church?" warning the member never asked for. ' +
      'The pending choice from a previous visit was never cleared — see `setConfirmLeave(null)` in the ' +
      'effect above, and do not remove it as tidying.');
  });

for (let i = 0; i < SIZES.length; i++) {
  const S = SIZES[i];

  test(`both answers to "Leave this church?" are on the screen at ${S.name}`,
    { skip: !CHROME ? 'no chromium' : false, timeout: 120000 }, async () => {
      const m = await measure(i);
      assert.deepEqual({ vw: m.vw, vh: m.vh }, { vw: S.w, vh: S.h },
        'the viewport is not the phone this case claims to be measuring');

      // AT REST, NOTHING MAY BE ABOVE THE TOP. `align-items: center` puts a child taller than its container
      // at a negative offset that no amount of scrolling reaches — measured in Chrome 152: top = -200 for a
      // child 400px too tall. `safe center` reports 0 instead.
      assert.ok(m.atRest.dlg.y >= 0,
        `the warning card starts at y=${m.atRest.dlg.y}, above the top of the phone, and the scroll origin ` +
        'is already past it so nothing can reach it. This is `align-items: center`; it needs `safe center`.');

      // AND AFTER SCROLLING — which is all a member can do — both answers must be fully on the phone.
      const off = m.answers.filter(a => a.y < 0 || a.bottom > m.vh);
      assert.deepEqual(off.map(a => `${a.label} (${a.y}..${a.bottom} of ${m.vh})`), [],
        `a member cannot reach these answers on a ${S.w}x${S.h} screen. The warning is ` +
        `${m.atRest.dlg.h}px tall, the card sits ${m.atRest.dlg.y}..${m.atRest.dlg.bottom}, its backdrop's ` +
        `content overflows by ${m.canScroll}px, and asking that backdrop to scroll to the bottom moved it ` +
        `${m.scrolledBy}px. They are the only two ways out of ` +
        'this warning, and one of them takes the church and any children\'s accounts in it.');
    });

  test(`the dimmed backdrop behind "Leave this church?" covers the whole phone at ${S.name}`,
    { skip: !CHROME ? 'no chromium' : false, timeout: 120000 }, async () => {
      const m = await measure(i);
      // THIS IS THE SAME DEFECT SEEN FROM THE OTHER SIDE, and it is the half a member actually notices: the
      // warning is written `position: fixed; inset: 0`, and inside BottomSheet's transformed panel that
      // resolves to the SHEET's box, not the screen's. So the dimming stops in a hard edge partway up the
      // page — and the tap-to-dismiss area stops with it.
      const covers = m.atRest.over.x <= 0 && m.atRest.over.y <= 0
        && m.atRest.over.right >= m.vw && m.atRest.over.bottom >= m.vh;
      assert.ok(covers,
        `the backdrop covers ${m.atRest.over.x}..${m.atRest.over.right} x ${m.atRest.over.y}..${m.atRest.over.bottom} ` +
        `of a ${m.vw}x${m.vh} screen. It says \`position: fixed; inset: 0\` and is not honoured, because a ` +
        'transformed ancestor (BottomSheet\'s panel) is its containing block. Its computed style here: ' +
        JSON.stringify(m.over));
    });
}
