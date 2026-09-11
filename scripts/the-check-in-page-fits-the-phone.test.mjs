// THE CHECK-IN PAGE DOES NOT PAINT ITS OWN TEXT ON TOP OF ITSELF.
//   Run: node --test scripts/the-check-in-page-fits-the-phone.test.mjs
//
// Found by the owner on the built APK, 2026-09-10: *"on the apk, and likely webapp, the check in layout is
// overlapping itself in various places"*. Measured on the handset (Oppo, 360x730 CSS, DPR 2) and reproduced
// here: 40 pairs of leaf elements — each painting its own text, neither an ancestor of the other — overlapped
// by more than 3px in BOTH axes.
//
// REPRODUCED HERE, at 95afe22, with the copy the phone was carrying: 40 pairs at 360px — the same number
// the handset reported — 41 at 320px, 59 with a long note added, and 1 at 900px, where the two-column layout
// hides most of it and all three cards are nonetheless shorter than their own contents. The three worst
// pairs are the ones the device named: the desk intro over «Cleared to help with children» (209x21px), over
// the «Clear someone» button (105x28px), and over the next card's explainer (211x67px).
//
// ONE OF THE DEVICE'S 40 IS NOT REPRODUCIBLE HERE and is probably not a real collision: the handset also
// reported the header's «Settings» control over the «Kids check-in» heading. Page content cannot paint into
// that header — it is `flex-shrink: 0` above a `min-height: 0` <main> that clips — but a scrolled <main>
// puts the heading's RECTANGLE behind it, and getBoundingClientRect() ignores clipping. This fixture stands
// the header in as a plain box, so it cannot tell the two apart either way.
//
// THE MECHANISM, and it is a layout bug and not a copy bug. The right-hand column of DashCheckin is
//
//     <div style="display:flex; flex-direction:column; gap:18; min-height:0">
//        <CheckinClearances />      // Panel style: height:100%  display:flex  min-height:0
//        <CheckinSessionKeys />     // Panel style:               display:flex  min-height:0
//
// and the register on the left is the same shape with `height:100%` on its one panel. `height: 100%` on a
// flex item is its FLEX BASE SIZE, not a floor: two items each asking for the whole column, plus an 18px gap,
// overflow by their own height again, so both are shrunk — and `min-height: 0` (written to let the inner
// scrollers work) removes the content-based floor that would otherwise stop it. The panel is then SHORTER
// THAN ITS OWN CHILDREN, which do not shrink with it, and the copy paints straight out of the bottom of the
// card and over whatever the grid put underneath. Measured on the phone: the desk intro paragraph at
// top=386 height=346 inside a `.sk-panel` at top=287 height=165 — a 346px child in a 165px parent, with the
// child's own scrollHeight (344) proving it was not overflowing itself.
//
// `.sk-panel` in steward.html sets padding and font-size and no height at all, which is why the CSS looks
// innocent. Note also that steward.html's `@container (min-width: 430px)` block has NO container to measure
// on this page — `container-type: inline-size` is on `.set-page`, a Settings-only wrapper — so every rule in
// it is inert here at every width. Nothing on this page may assume it applies.
//
// HOW THIS ASSERTS, and why nothing cheaper would do. CLAUDE.md rule 3: app/stew-dashboard.jsx ships
// UNBUNDLED, so `false && ` in front of a condition leaves every word of it in place and a text-matching
// assertion still passes. Nothing here matches text in app/*.jsx. The REAL DashCheckin — with the REAL
// Panel, the REAL DismissibleNote, the REAL Icon and its two REAL sibling panels — is compiled with the same
// esbuild the packaged build uses, rendered through the miniature React in scripts/render-jsx-screen.mjs,
// serialised to HTML, dressed in steward.html's OWN <style> block and brand.css, and laid out by a real
// browser at 360px inside a replica of the console's own narrow shell. Every assertion reads
// getBoundingClientRect().
//
// THE LONG-CONTENT CASE IS THE POINT. A fix that works only because the copy got shorter breaks the next
// time somebody adds a sentence, so one case feeds the register panel a deliberately long note and asserts
// the panel GROWS to hold it (scrollHeight ≈ clientHeight) with no collisions.
//
//
// MEASURED RED/GREEN, 2026-09-10, this file against the fixed page. Every sabotage was scoped to its
// enclosing function (sliced by brace-match, anchor asserted to occur exactly ONCE inside the slice, then
// replaced there) because near-identical sibling panels are this file's house style and a file-wide replace
// hits the wrong one. The BASELINE row is here on purpose: a broken harness fails every row, which looks
// identical to every sabotage biting.
//
//   sabotage                                                    pass  fail
//   BASELINE — nothing sabotaged                                  15     0
//   THE WHOLE LAYOUT FIX REVERTED (five constraints)              12     3   ← the owner's bug
//   narrow half: grid + left column + register panel              12     3
//   wide half:   grid + right column + both right panels          12     3
//   grid height:100% + minHeight:0 alone                          15     0   ← INERT, and that is the finding
//   register panel height:100% alone                              15     0   ← INERT
//   clearances panel height:100% + minHeight:0 alone              15     0   ← INERT
//   session-keys panel minHeight:0 alone                          15     0   ← INERT
//   right column minHeight:0 alone                                15     0   ← INERT
//   left column minHeight:0 alone                                 15     0   ← INERT
//   "parents see nothing of check-in" deleted                     14     1
//   "cleared helper" dropped from the register note               14     1
//   the JSX newline trap re-introduced in the keys note           13     2
//   "every request" dropped from the clearance note               14     1
//   the guide link removed from the register card                 13     2
//   the console-checkin article deleted from help-data.jsx        13     2
//   console-checkin dropped from STEW_HELP_IDS                    13     2
//   StewardHelp ignores initialId (deep link lands on the list)   14     1
//   the ciphertext claim removed from the guide                   14     1
//
// ⚠ WHY SIX ROWS ARE INERT, because it would otherwise read as six unmeasured lines in the fix. The bug
// needs TWO things at once: a container whose height is bounded, and a panel asking for 100% of it. Put back
// any ONE of the six and the other five still refuse to shrink anything — with the shortened copy the cards
// simply fit. That is also why the shortened copy is NOT the fix and is not allowed to be: the three
// composite rows are the ones that reproduce the owner's screen, and the long-note case is what keeps the
// guard honest when the copy grows again.
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
import { loadScreen, miniReact, reads, glued, texts, find } from './render-jsx-screen.mjs';
import { requireFreePort } from './test-ports.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const CHROME = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => existsSync(p));
const CDP = 9360;   // taken in the 93xx band: 9350-9352, 9354-9358, 9361, 9381, 9390, 9395, 9397 (scripts/test-ports.test.mjs checks this, probes included since 2026-09-11)
// ⚠ THIS WAS 9357 AND IT COLLIDED with a-tampered-module-is-refused.test.mjs, which claimed 9357 first.
// `node --test` runs files in parallel, so one bound the port and the other sat waiting for a port that
// could not free up until the first file finished — the suite looks like it hangs, with no stray process
// to blame. scripts/test-ports.test.mjs exists to catch exactly this and was red on the branch.
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── tree -> HTML ───────────────────────────────────────────────────────────────────────────────────────────
// The same serialiser scripts/todays-header-fits-the-phone.test.mjs uses, kept local for the same reason it
// is local there: it is a test instrument, and a shared one would be a third thing to keep in step with the
// two files' different needs. data-tid = the node's index in `nodes`, so a test can point at ONE node it
// found in the rendered tree rather than hunting for it by text in the DOM.
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

// ── the real screen ────────────────────────────────────────────────────────────────────────────────────────
// A church in the state that fills this page: children marked, somebody cleared, a service today and more
// inside the issuer's 14-day horizon, and the register's key present so the desk is live. That is the state
// the owner was looking at, and an empty church would have nothing to collide.
const TODAY = '2026-09-13';                       // a Sunday, fixed so the page never depends on the clock
const CHILD_A = 'a'.repeat(64), CHILD_B = 'b'.repeat(64);
const MUM = 'c'.repeat(64), DAD = 'd'.repeat(64), HELPER = 'e'.repeat(64), STEWARD = 'f'.repeat(64);
const NAMES = { [CHILD_A]: 'Amelia Fenn', [CHILD_B]: 'Noah Kettleborough-Reid',
  [MUM]: 'Ruth Fenn', [DAD]: 'Sam Fenn', [HELPER]: 'Margaret Ashby', [STEWARD]: 'Tom Vane' };
const iso = (d) => new Date(Date.parse(TODAY + 'T10:00:00Z') + d * 86400000).toISOString().slice(0, 10);
const secs = (d) => Math.floor(Date.parse(iso(d) + 'T10:00:00Z') / 1000);

const Stub = n => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };

function checkinPage({ width = 360, longNote = false } = {}) {
  const { React, draw } = miniReact();
  // The REAL Icon and the REAL DismissibleNote: both set boxes this test measures, and the note is the very
  // element that overflowed.
  const { Icon } = loadScreen('app/icons.jsx', ['Icon'], { React, window: {} });
  const store = new Map();
  const localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
  const doc = { addEventListener() {}, removeEventListener() {}, querySelector: () => null, activeElement: null };
  const { DismissibleNote, useStewDialog } = loadScreen('app/stew-modal.jsx', ['DismissibleNote', 'useStewDialog'],
    { React, window: { localStorage }, localStorage, Icon, document: doc });
  // THE REAL HELP DATA, loaded the way steward.html loads it — help-data.jsx is one assignment to
  // window.HelpData — so the guide the link opens is the shipped article and not a fixture.
  const helpWin = { addEventListener() {}, removeEventListener() {}, localStorage,
    HelpBlock: function HelpBlock(p) { return React.createElement('div', null, p.b && p.b.text ? p.b.text : ''); } };
  loadScreen('app/help-data.jsx', [], { window: helpWin });
  const { StewHelpLink } = loadScreen('app/stew-help.jsx', ['StewHelpLink'],
    { React, window: helpWin, Icon, useStewDialog, document: doc, history: { pushState() {} } });
  const win = {
    innerWidth: width, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true, localStorage,
    useStewardCheckins: () => [
      { id: 'r1', child: CHILD_A, childName: NAMES[CHILD_A], date: TODAY, in: secs(0), code: '4182' },
      { id: 'r2', child: CHILD_B, childName: NAMES[CHILD_B], date: TODAY, in: secs(0) - 3600, out: secs(0) - 600, code: '9079' },
    ],
    useStewardSafeguard: () => ({ minors: [CHILD_A, CHILD_B], minorsKnown: true }),
    useStewardGuardians: () => ({ [CHILD_A]: [MUM, DAD], [CHILD_B]: [MUM] }),
    useStewardMembers: () => Object.keys(NAMES).map(p => ({ pubkey: p, name: NAMES[p] })),
    useStewardServices: () => [
      { id: 'svc-a', name: 'Sunday Morning', date: iso(0), time: '10:30' },
      { id: 'svc-b', name: 'Sunday Evening', date: iso(0), time: '18:30' },
      { id: 'svc-c', name: 'Midweek', date: iso(3), time: '19:30' },
    ],
    useStewardCheckinPermissions: () => [{ person: HELPER, from: secs(-7), until: secs(21), lifetime: 'dated' }],
    useStewardCheckinSessionKeys: () => [{ session: 'svc-a', pubs: [HELPER] }],
    useStewardStewards: () => [STEWARD],
    useStewardChurch: () => ({ name: 'St Bartholomew-the-Great' }),
    useStewardRosters: () => [], useStewardGroups: () => [],
    useStewardIdv: () => 1, useStewardConn: () => 1,
    stewardStreamLoaded: () => true,
    Steward: {
      capKeyRing: () => ['k'],
      subscribeCapKey: () => () => {},
      checkinSessionKeysSettled: () => true,
      checkinIssuerHeld: () => true,
      stewardCaps: () => ({ safeguarding: true }),
      issueCheckinSessionKeys: async () => ({ issued: [], skipped: [], failed: [], rotated: [], settled: true }),
      publishCheckin: async () => true,
      revokeCheckinPermission: async () => true,
      checkinPermissionLifetimes: () => [],
      checkinPermissionSuggestions: () => ({ pubs: [] }),
      checkinPermissionPreview: () => ({ ok: true, from: 0, until: null, why: '' }),
    },
  };
  const globals = {
    React, window: win, localStorage,
    document: { addEventListener() {}, removeEventListener() {}, querySelector: () => null,
      createElement: () => ({ style: {}, appendChild() {}, remove() {}, click() {} }), body: { appendChild() {}, removeChild() {} } },
    location: { search: '', hostname: 'console.test' }, navigator: { userAgent: '', clipboard: { writeText: async () => {} } },
    setTimeout, clearTimeout, setInterval, clearInterval, console, fetch: async () => ({ ok: false, json: async () => ({}) }),
    Icon, DismissibleNote,
    todayISO: () => TODAY,
    // THE REAL StewHelpLink, out of app/stew-help.jsx: it is the control that replaced the copy this page
    // used to carry, so it has to be on the screen this measures and not a stub of nothing.
    StewHelpLink,
    CkModal: Stub('CkModal'), SkBadge: Stub('SkBadge'), Halo: Stub('Halo'),
    TEAM_PRESETS: [], WizMeetings: Stub('WizMeetings'), _wizMeetingId: () => 'wm1',
    cx: (...a) => a.filter(Boolean).join(' '),
  };
  const { DashCheckin } = loadScreen('app/stew-dashboard.jsx', ['DashCheckin'], globals);
  const tree = draw(DashCheckin, {});
  const redraw = () => draw(DashCheckin, {});
  const { html, nodes } = serialize(tree);
  // Found in the RENDERED TREE by what the screen put on it, never by matching source text. The register
  // panel is the `.sk-panel` whose head holds the "Kids check-in" heading.
  const panelTids = nodes.map((n, i) => [n, i]).filter(([n]) => String((n.props || {}).className || '').includes('sk-panel')
    && !String((n.props || {}).className || '').includes('sk-panel-head')).map(([, i]) => i);
  // A deliberately long note, injected into the DOM rather than the source, so the "does the panel grow"
  // case measures THIS layout with more text in it and not a different screen.
  const LONG = 'A deliberately long standing note. '.repeat(24);
  const styles = [...readFileSync(join(ROOT, 'steward.html'), 'utf8').matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n');
  return { nodes, panelTids, tree, redraw, help: helpWin.HelpData, html:
`<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="stylesheet" href="/vendor/fonts/fonts.css">
<link rel="stylesheet" href="/brand.css">
<style>${styles}
html,body{margin:0;padding:0;background:var(--paper)} #root{position:relative;width:100%;height:100vh;overflow:hidden}</style>
<div id="root" class="stew-root">
  <!-- THE CONSOLE'S OWN NARROW SHELL, replicated from the \`if (narrow)\` return of StewardDashboard in
       app/stew-dashboard.jsx: an absolutely-positioned flex column, a flex-shrink:0 header, and the tab
       content in a <main> that is \`flex:1; min-height:0; overflow-y:auto\`. That <main> is what makes the
       page's own \`height:100%\` definite, so it is the part of the shell this measurement needs; the header
       is stood in for by a box of the height the real one measures on a phone (three rows of wrapped tabs). -->
  <div style="position:absolute;inset:0;display:flex;flex-direction:column;background:var(--paper)">
    <div style="flex-shrink:0;height:196px;background:var(--surface);border-bottom:1px solid var(--line)"></div>
    <main class="no-scrollbar" style="flex:1;min-height:0;overflow-y:auto;padding:14px 12px 24px;background:var(--paper)">${html}</main>
  </div>
</div>` , long: LONG, longNote };
}

// ── lay it out in a real browser and read the rectangles ───────────────────────────────────────────────────
let chr = null, srv = null, ws = null, send = null, dir = null;

before(async () => {
  if (!CHROME) return;
  await requireFreePort(CDP, 'the-check-in-page-fits-the-phone.test.mjs (Chrome debug port)');
  dir = mkdtempSync(join(tmpdir(), 'trin-ckpage-'));
  srv = createServer((req, res) => {
    const p = decodeURIComponent(req.url.split('?')[0]);
    const m = /^\/page(\d+)\.html$/.exec(p);
    if (m) { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(PAGES[+m[1]].html); }
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

after(() => { try { ws && ws.close(); } catch {} try { chr && chr.kill('SIGKILL'); } catch {} try { srv && srv.close(); } catch {}
  try { dir && rmSync(dir, { recursive: true, force: true }); } catch {} });

const CASES = [
  { width: 360, longNote: false, name: 'a phone at 360px' },
  { width: 320, longNote: false, name: 'a narrow phone at 320px' },
  { width: 360, longNote: true, name: 'a phone at 360px with a note four times as long' },
  { width: 900, longNote: false, name: 'a tablet at 900px, where the page is two columns' },
];
const PAGES = CASES.map(c => checkinPage(c));
const MEASURED = new Map();

// THE DETECTOR. Leaf elements that paint their OWN text (a text child with something in it), big enough to
// see, visible — and then every pair where neither contains the other and the boxes overlap by more than 3px
// in BOTH axes. 3px, not 0: adjacent inline boxes and a rounded border legitimately share a hairline, and a
// 0px threshold reports those as collisions.
const PROBE = (tids) => `(async () => { try { await document.fonts.ready; } catch (e) {}
  const leaves = [...document.querySelectorAll('#root *')].filter(e => {
    const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
    if (r.width < 6 || r.height < 6 || cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) return false;
    return [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
  });
  const label = e => (e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\\s+/).join('.') : '')
    + ' «' + (e.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 46) + '»');
  // ⚠ LINE BOXES, NOT THE UNION BOX. getBoundingClientRect() on an INLINE element that wraps returns the
  // union of its line boxes — a rectangle spanning from where it starts on one line to where it ends on the
  // next, most of which the element does not paint in. Two wrapped <b>s in the same paragraph then "overlap"
  // by their whole width. That is exactly what this reported at 900px after the fix ("14 days" over "this
  // page", both inside the session-keys note, 58x15px), and believing it would have sent me looking for a
  // second bug that is not there. getClientRects() is one rect per line box, so the comparison below is
  // between rectangles the browser actually painted text into.
  const boxes = e => { const rs = [...e.getClientRects()]; return rs.length ? rs : [e.getBoundingClientRect()]; };
  const hits = [];
  for (let i = 0; i < leaves.length; i++) for (let j = i + 1; j < leaves.length; j++) {
    const a = leaves[i], b = leaves[j];
    if (a.contains(b) || b.contains(a)) continue;
    let ox = 0, oy = 0;
    for (const ra of boxes(a)) for (const rb of boxes(b)) {
      const x = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
      const y = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (x > 3 && y > 3 && x * y > ox * oy) { ox = x; oy = y; }
    }
    if (ox > 3 && oy > 3) hits.push({ a: label(a), b: label(b), ox: Math.round(ox), oy: Math.round(oy) });
  }
  // AND THE MECHANISM, in one number per card: is the panel shorter than what it holds? scrollHeight against
  // clientHeight is the right instrument and a walk over the descendants' rectangles is NOT — a child inside
  // one of the panel's own inner scrollers is geometrically below the card whether it is clipped or not, and
  // that walk reported all three cards as spilling at 900px when only two were. scrollHeight counts only the
  // overflow that actually paints outside the box.
  const box = e => { if (!e) return null; const r = e.getBoundingClientRect();
    return { name: (e.querySelector('h2') ? e.querySelector('h2').textContent : label(e)).slice(0, 34),
             x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
             sh: e.scrollHeight, ch: e.clientHeight, ov: getComputedStyle(e).overflowY }; };
  const panels = ${JSON.stringify(tids)}.map(t => box(document.querySelector('[data-tid="' + t + '"]')));
  return JSON.stringify({ vw: document.documentElement.clientWidth, leaves: leaves.length, hits, panels,
    docScrollW: document.documentElement.scrollWidth });
})()`;


// ONE LAYOUT PER CASE, read once and shared by every assertion about it.
async function measure(i) {
  if (MEASURED.has(i)) return MEASURED.get(i);
  const c = CASES[i], P = PAGES[i];
  await send('Emulation.setDeviceMetricsOverride', { width: c.width, height: 730, deviceScaleFactor: 1, mobile: c.width < 760 });
  await send('Page.navigate', { url: `http://127.0.0.1:${srv.address().port}/page${i}.html` });
  await sleep(450);
  // THE LONG-CONTENT CASE, added to the LAID-OUT page rather than to the source, so what is measured is
  // THIS screen with more words in it and not a different screen. It goes in as one more child of the
  // register panel — exactly the shape of "somebody added a sentence" — and if the panel cannot grow with
  // its children, this is what proves it.
  if (P.longNote) {
    const t = P.panelTids[0];
    const rr = await send('Runtime.evaluate', { returnByValue: true, expression:
      `(() => { const p = document.querySelector('[data-tid="${t}"]');
        if (!p) return 'no panel';
        const d = document.createElement('div');
        d.setAttribute('data-longnote', '1');
        d.style.cssText = 'font-size:12px;line-height:1.5;color:var(--ink-2)';
        d.textContent = ${JSON.stringify(P.long)};
        p.appendChild(d); return 'ok'; })()` });
    assert.equal(rr.result.result.value, 'ok', 'the long note could not be added — re-anchor the panel lookup');
  }
  const r = await send('Runtime.evaluate', { expression: PROBE(P.panelTids), returnByValue: true, awaitPromise: true });
  assert.ok(!(r.result && r.result.exceptionDetails),
    'the measuring probe threw: ' + JSON.stringify((r.result || {}).exceptionDetails || {}).slice(0, 400));
  const m = JSON.parse(r.result.result.value);
  MEASURED.set(i, m);
  return m;
}

// THE BASELINE ROW. A harness that renders nothing fails every case below, which looks exactly like every
// case biting — and that has already cost a discarded matrix on this box. So: the page really did render, at
// the width under test, with the panels this file measures on it.
test('the check-in page renders, at the width under test, with its three panels', () => {
  for (const [i, c] of CASES.entries()) {
    assert.ok(PAGES[i].panelTids.length >= 3,
      `the check-in page rendered ${PAGES[i].panelTids.length} .sk-panel cards at ${c.width}px, not the register + ` +
      'clearances + session keys this file measures — re-anchor it');
    assert.ok(PAGES[i].html.includes('Kids check-in'),
      `the register panel is gone from the check-in page at ${c.width}px — nothing below can measure a card that is not rendered`);
  }
});

for (const [i, c] of CASES.entries()) {
  test(`no text is painted on top of other text on the check-in page — ${c.name}`,
    { skip: !CHROME ? 'no chromium' : false, timeout: 60000 }, async () => {
    const m = await measure(i);
    assert.equal(m.vw, c.width, 'the page did not lay out at the width under test');
    assert.ok(m.leaves >= 12, `only ${m.leaves} text-bearing elements laid out — the page did not really render`);

    // THE DEFECT. 40 pairs on the handset before the fix, and 40 at this width here.
    assert.equal(m.hits.length, 0,
      `${m.hits.length} pairs of text overlap on the check-in page at ${c.width}px:\n` +
      m.hits.slice(0, 8).map(h => `  ${h.a}\n    over ${h.b}  (${h.ox}x${h.oy}px)`).join('\n'));

    // AND THE MECHANISM, asserted separately, because it is the thing that must not come back: no panel may
    // be shorter than what it holds. A pair of collisions can be tuned away by moving something; a panel that
    // cannot grow with its content will simply collide with the next thing added to the page.
    const short = m.panels.filter(p => p && p.ov === 'visible' && p.sh > p.ch + 1);
    assert.deepEqual(short, [],
      `a .sk-panel on the check-in page at ${c.width}px is shorter than its own content, and does not clip or ` +
      'scroll, so that content paints outside the card and over whatever is under it:\n' +
      short.map(p => `  «${p.name}» holds ${p.sh}px of content in a ${p.ch}px box (h=${p.h})`).join('\n'));

    // Nothing may push the page sideways: the console's <main> scrolls vertically only.
    assert.ok(m.docScrollW <= c.width + 1,
      `the check-in page scrolls sideways at ${c.width}px (scrollWidth ${m.docScrollW})`);
  });
}

// ══ THE COPY, AND WHAT MAY NOT GO WITH IT ══════════════════════════════════════════════════════════════════
//
// Three standing explainers came off this page on 2026-09-10 — the desk intro (~90 rendered words), the
// clearance explainer (~71) and the session-keys explainer (~60) — on the owner's standing direction: *"we
// need to cut down on the instructional copy in the ui itself. Use tool tips and help docs for this kind of
// information imo."* The full text of all three is in the 'console-checkin' guide, reachable from the link on
// the register card and from the console's Help button.
//
// EVERY ASSERTION BELOW USES reads(), NEVER texts().join(' '). A space-join cannot see the JSX newline trap:
// the session-keys panel shipped to the phone reading "whenever you openthis page" with an assertion pinning
// that very sentence GREEN, because the join put the missing space back in. reads() concatenates inline
// pieces with nothing, the way the DOM does.
const CK = () => PAGES[0];   // the 360px case: the same rendered tree the layout tests measure
// ONE CARD'S OWN COPY, not the whole page's. Asserting a phrase against the page as a whole is how a claim
// survives being deleted from the card that owes it: /cleared\s*helper/ over the whole tree stayed GREEN with
// "and a cleared helper holding that session's key" cut out of the register note, because reads() fences
// blocks with a newline and some other pair of lines on the page happened to end and begin on those words.
// Measured 2026-09-10, in the sabotage matrix for this file. So every wording claim below names its card.
function note(id) {
  const found = find(CK().tree, n => typeof n.type === 'function' && n.type.name === 'DismissibleNote'
    && n.props && n.props.id === id);
  assert.equal(found.length, 1, `no standing note "${id}" on the check-in page — re-anchor this test`);
  return reads(found[0]);
}

test('COPY: the register says what a parent DOES see — and it is their own children, not nothing', () => {
  // ⚠ THIS IS NOT INSTRUCTIONAL COPY AND MUST NOT BE MOVED TO HELP. It is the sentence a leader says out
  // loud at the announcement, and it has to be the TRUE one.
  //
  // IT SAID THE OPPOSITE UNTIL 2026-09-11, on evidence measured the day before: "parents see nothing of
  // check-in in their own app", because `grep -c checkin src/fellowship.src.js src/mydata.src.js` was 1 and 1
  // and neither was a read of the register. STEP 2 of the parent surface ended that — a parent now opens
  // their OWN children and their pickup codes, sealed to their own key in a ['gk'] tag — and this test moved
  // with the code rather than pinning a sentence that had become false. A disclosure a church reads out is
  // the one piece of copy in this product that must never lag the code (CLAUDE.md rule 4 applied to copy).
  const said = note('kids-checkin-intro');
  assert.match(said, /their own children/i,
    'THE CONSOLE NO LONGER TELLS A STEWARD WHAT A PARENT SEES. Announcing the wrong one of these sends a ' +
    'church either hunting for a button that does not exist or believing a code is on a phone that has never ' +
    'been given one. As rendered: ' + said.slice(0, 300));
  assert.match(said, /pickup code/i, 'the note no longer says a parent can see the pickup code, which is the whole parent surface');
  assert.match(said, /and nothing else/i,
    'the note no longer says a parent sees NOTHING BEYOND their own children. Without that half a steward ' +
    'reads "parents can see check-in" as "parents can see the register".');
  assert.doesNotMatch(said, /parents see nothing of check-in/i,
    'THE CONSOLE IS BACK TO TELLING A STEWARD THAT PARENTS SEE NOTHING. That was true until 2026-09-11 and ' +
    'is now false; a church that announces it leaves every family with the app hunting for a code the app ' +
    'is already showing them.');
});

test('COPY: the register still names all FOUR people who can open a record, and no fewer', () => {
  // The audit finding of 2026-09-09 was the note saying "you and anyone you have given Safeguarding to" —
  // true until a helper could be cleared, false from the day clearing shipped. Understating the audience of
  // a child's record is the worst direction for this screen to be wrong in.
  const said = note('kids-checkin-intro');
  // The three audiences the relay's own CHECKIN_D read gate admits, each asserted by the words the card uses
  // for it. "Anyone you have given Safeguarding to" rather than "safeguarding stewards": naming the GRANT is
  // what scripts/encryption-claims-honest.test.mjs exists to require, because the grant is the thing an owner
  // ticks and therefore the thing they have to connect to this consequence.
  // ⚠ FOUR SINCE 2026-09-11, NOT THREE. STEP 2 sealed a third copy of every record to each guardian the
  // record names, so a child's own parents open it too. Understating the audience of a child's record is the
  // worst direction for this screen to be wrong in, and it had understated it for the whole of that day.
  for (const [who, re] of [['you', /\byou\b/], ['anyone granted Safeguarding', /given Safeguarding to/i],
                           ['a cleared helper', /cleared helper/i],
                           ["the child's own guardians", /guardians/i]]) {
    assert.match(said, re, `the register card no longer says ${who} can open a check-in record: ` + said.slice(0, 300));
  }
  assert.match(said, /safeguarding key/i,
    'the register card no longer names WHICH key seals the register, so a steward cannot tell who can read ' +
    'a child\'s name, room and pickup code. It is not the church key, and saying so is what ' +
    'scripts/encryption-claims-honest.test.mjs was written for: ' + said.slice(0, 300));
  assert.doesNotMatch(said, /the only people who can open them are you and anyone/i,
    'the console is back to telling a steward that nobody but they and their safeguarding stewards can open ' +
    'the register, which stopped being true the moment a helper could be cleared');
});

test('COPY: the session-keys card still says WHEN a key is issued', () => {
  // The one wrong conclusion this panel can produce. CheckinSessionKeys mounts only on the Check-in tab, so a
  // steward who believes keys are minted on a schedule finds a month of Sundays with no helper key on them.
  const said = note('checkin-keys-intro');
  assert.match(said, /whenever you open this page/,
    'the session-keys card no longer says that keys are issued only while this page is open — or says it in ' +
    'words that do not render (the JSX newline trap). As rendered: ' + said.slice(0, 400));
});

test('COPY: the clearance card still separates a clearance from a key, and says the check is per request', () => {
  const said = note('checkin-clearance-intro');
  assert.match(said, /every request/i,
    'the clearance card no longer says the relay re-checks on every request, which is why a withdrawal ' +
    'takes effect at once: ' + said.slice(0, 400));
  assert.match(said, /not by itself a key/i,
    'the clearance card no longer distinguishes a clearance from a key on somebody\'s phone — the whole ' +
    'distinction between that card and the one under it: ' + said.slice(0, 400));
});

test('COPY: nothing on this page runs two pieces of copy together — the JSX newline trap', () => {
  const g = glued(CK().tree);
  assert.deepEqual(g, [],
    'two pieces of copy run together with no space, so the phone shows them as one word. JSX drops ' +
    "whitespace containing a newline between a text node and an element — put an explicit {' '} at the end " +
    'of the line, or keep the space inside the text node: ' + JSON.stringify(g));
  // AND THE CONTROLS, so this cannot pass by glued() being blind — the junction it exists to find, and a
  // correct one, both built by hand out of the node shape compiled JSX produces.
  const bad = { type: 'div', props: {}, kids: ['whenever you open', { type: 'b', props: {}, kids: ['this page'] }] };
  assert.equal(glued(bad).length, 1, 're-anchor: glued() cannot see the very junction it exists to find');
  const good = { type: 'div', props: {}, kids: ['whenever you open ', { type: 'b', props: {}, kids: ['this page'] }] };
  assert.deepEqual(glued(good), [], 're-anchor: glued() reports correct copy as broken, so it will be ignored');
});

// ── AND A BUDGET, because "cut the copy" is a decision that decays one sentence at a time ─────────────────
// Measured on this tree by this instrument, the day of the cut: the three notes rendered 1,276 characters
// before and 603 after (the 603 includes the 18-character guide link that replaced them).
// The cap is deliberately loose — it is not a style rule about any one sentence, it is the thing that makes
// the next person adding a paragraph to a standing note notice they are doing it.
test('COPY: the standing notes on this page stay short', () => {
  const notes = find(CK().tree, n => n.props && typeof n.props.id === 'string' && /^(kids-checkin|checkin-)/.test(n.props.id)
    && n.type && typeof n.type === 'function' && n.type.name === 'DismissibleNote');
  assert.ok(notes.length >= 3, `only ${notes.length} standing notes found on the page — re-anchor this test`);
  const len = notes.map(n => reads(n).length).reduce((a, b) => a + b, 0);
  assert.ok(len <= 700,
    `the standing explainers on the check-in page are back up to ${len} characters (they were 1,276 before ` +
    'the 2026-09-10 cut and 603 after). Long-form guidance belongs in the console-checkin guide, which is ' +
    'one tap from the register card.');
});

// ── WHERE THE REMOVED WORDS WENT ──────────────────────────────────────────────────────────────────────────
test('HELP: the register card carries a link to the check-in guide', () => {
  const links = find(CK().tree, n => n.type === 'button' && /How check-in works/.test(texts(n).join(' ')));
  assert.equal(links.length, 1,
    `the check-in page has ${links.length} links to its guide — it needs exactly one, on the register card, ` +
    'or the explanation that came off this page is reachable only by a steward who thinks to press Help');
});

test('HELP: pressing that link opens the console-checkin guide, and the guide holds what came off the page', () => {
  const p = CK();
  const link = find(p.tree, n => n.type === 'button' && /How check-in works/.test(texts(n).join(' ')))[0];
  assert.ok(link, 'no guide link on the register card — the test above says so too');
  link.props.onClick();
  const tree = p.redraw();
  const dlg = find(tree, n => n.props && n.props.role === 'dialog' && n.props['aria-label'] === 'Help');
  assert.equal(dlg.length, 1, 'pressing the guide link mounted no help dialog');
  const shown = reads(dlg[0]);
  const article = CK().help.articles.find(a => a.id === 'console-checkin');
  assert.ok(article, "help-data.jsx has no 'console-checkin' article, so the link opens a blank dialog");
  // ⚠ ON THE GUIDE, NOT ON THE LIST OF GUIDES — and that has to be asserted by what is ABSENT. The list
  // renders every article's title and summary on its row buttons, so `shown.includes(article.title)` alone is
  // satisfied by a dialog that ignored the deep link entirely: measured GREEN on 2026-09-10 with
  // `useState(initialId || null)` sabotaged back to `useState(null)`. A dialog showing one guide has NO
  // article rows and DOES have the back control.
  assert.equal(find(dlg[0], n => n.props && n.props['data-help-id']).length, 0,
    'the guide link opened the LIST of guides rather than the check-in guide itself, leaving a steward to ' +
    'find it among nine — which is the whole thing the link exists to save them');
  assert.equal(find(dlg[0], n => n.props && n.props['aria-label'] === 'Back to all guides').length, 1,
    're-anchor: an open guide is what carries the back control, and this dialog has none');
  assert.ok(shown.includes(article.title),
    'the dialog did not show the check-in guide\'s title: ' + shown.slice(0, 200));
  assert.ok(shown.includes(article.summary), 'the guide opened without its own summary — re-anchor');
});

test('HELP: the guide really does carry the three explanations that were taken off the page', () => {
  const article = CK().help.articles.find(a => a.id === 'console-checkin');
  assert.ok(article && Array.isArray(article.blocks), "no 'console-checkin' article with blocks in help-data.jsx");
  // Its OWN text, read out of the data at run time, so this is a claim about where the content IS and not a
  // copy of it typed into a test file.
  const words = article.blocks.map(b => [b.text || '', b.label || '', ...(b.items || []).map(i => typeof i === 'string' ? i : (i.lead || '') + ' ' + (i.text || ''))].join(' ')).join(' ');
  for (const [what, re] of [
    ['the desk routine, and the pickup code', /pickup code/i],
    ['matching the code at collection', /collection/i],
    ['who can open a record', /Safeguarding to/],
    ['that the relay only holds ciphertext', /ciphertext/i],
    ['what a clearance is made of', /DBS/],
    ['that a clearance is not a key', /not by itself a key/i],
    ['what a session key is wrapped to', /wrapped to the people you have cleared/i],
    ['what a month of nobody opening the page costs', /no helper keys/i],
  ]) {
    assert.match(words, re, `the check-in guide does not carry ${what} — it came off the page on the ` +
      'promise that it would be here');
  }
});

test('HELP: the console lists the check-in guide, so Help reaches it too', () => {
  // The data contract between app/stew-help.jsx and app/help-data.jsx, checked from the data side — the same
  // way scripts/steward-help.test.mjs checks it. An id that resolves to nothing is silently dropped from the
  // list by stewHelpArticles(), so a typo here is a guide that simply is not there.
  const src = readFileSync(join(ROOT, 'app/stew-help.jsx'), 'utf8');
  const m = src.match(/STEW_HELP_IDS\s*=\s*\[([^\]]*)\]/);
  assert.ok(m, 'STEW_HELP_IDS is no longer a literal array in app/stew-help.jsx — re-anchor this test');
  const ids = m[1].split(',').map(x => x.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  assert.ok(ids.includes('console-checkin'),
    'the console does not list the check-in guide, so a steward who presses Help cannot find the words that ' +
    'came off the Check-in page: ' + JSON.stringify(ids));
});
