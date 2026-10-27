// THE STEWARD CONSOLE'S CARE (MEALS) SCHEDULE DOES NOT SCROLL A PHONE SIDEWAYS, AND ITS DISH NOTE STAYS READABLE.
//   Run: node --test scripts/the-console-care-schedule-fits-the-phone.test.mjs
//
// Found by the owner on a real phone (Oppo CPH2477) and reproduced in headless chromium. MealsNeedDetail
// (app/stew-meals.jsx) laid each day out as a side-by-side [date column width:104 | meals column], and INSIDE
// the meals column each meal was a single row of FOUR columns: meal-label width:76 + status width:84 +
// helper-names width:120 + dish-note flex:1. The three fixed columns + 3x10px gaps are 310px minimum; the
// note then has nowhere to go. There were TWO defects, found on two passes:
//   1. the fixed date column pushed the whole page sideways (the detail card clipped off the LEFT); and
//   2. after the date was stacked above the meal row, the meal row ITSELF still carried four side-by-side
//      columns — at 360px (the device's real CSS width, 720 physical / DPR 2) the card content is only ~300px,
//      so the note was squeezed into an unreadable sliver at the right and clipped. A 411px-only test missed
//      this: at 411 the columns just fit.
//
// THE FIX, presentation only, in two parts:
//   · the day is a VERTICAL STACK — the date is its own header line (with Skip/Undo), the meal row(s) sit
//     full-width beneath it; the width:104 date column is gone.
//   · the meal row REFLOWS: it wraps (flexWrap), the helper-names span is no longer a rigid width:120 column
//     (flex:1 1 auto, so names still show but share the line), and the dish note drops onto its OWN full-width
//     line (flexBasis:100%) instead of fighting for a sliver. Nothing is clipped at 360px.
//   · the duplicate day-meals summary under the date is dropped on normal days and KEPT on a covered day
//     (which renders only "Covered ..." and no per-meal rows, so it is the only place the covered meals list).
//
// HOW THIS ASSERTS (CLAUDE.md rules 1/3). app/stew-meals.jsx ships UNBUNDLED, so `false && ` in front of a
// condition leaves every word in place and a text match still passes. Nothing here matches source text. The
// REAL MealsNeedDetail is compiled with the packaged esbuild (--jsx=transform), rendered through the miniature
// React in scripts/render-jsx-screen.mjs, serialised to HTML, dressed in a replica of the console's own narrow
// shell (<main> padding:14px 12px 24px, the narrow return of StewardDashboard), and laid out by a real browser
// at 360px (and 411px). Every claim is a rect.
//
// ⚠ TWO TRAPS, both measured here.
//   · THE VACUOUS-PASS TRAP: under setDeviceMetricsOverride(width:360), when the page overflows horizontally
//     `window.innerWidth` is INFLATED to the scroll width — so an assertion against window.innerWidth passes
//     vacuously over the exact bug. The page overflow is read as documentElement.scrollWidth <=
//     documentElement.clientWidth, with a clientWidth === W guard proving the viewport really is the phone.
//   · THE ANCESTOR-CLIP TRAP: a parent with overflow:hidden can hide a row's internal overflow from a
//     documentElement measurement. So the SHARPER assertion is per day-row: each schedule day card's own
//     scrollWidth <= its clientWidth. The earlier device audit measured a day row at scrollWidth 494 vs
//     clientWidth 379 — that is what this catches even when the page as a whole does not scroll.
//
// INSTRUMENT-VALIDATED, all directions, at 360px (CLAUDE.md sabotage rule / task correction C). The probe is
// pointed at THREE compiled sources: base (git 0b0a44a7, both defects), the partial first fix (git 3a6805bc,
// date stacked but meal row NOT reflowed), and the working tree (this fix). Base and partial BOTH overflow a
// day row at 360; only this fix is clean. If a commit is unreachable the row is skipped with a clear message.
//
// Skips itself when chromium is unavailable, so CI without a browser stays green.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname, normalize } from 'node:path';
import { WebSocket } from 'ws';
import { miniReact, loadScreen, compileScreen } from './render-jsx-screen.mjs';
import { requireFreePort } from './test-ports.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const CHROME = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => existsSync(p));
const CDP = 9353;   // a gap between 9352 and 9354 — neighbours 9360 (check-in page), 9368 (console phone batch-a)
const PHONE = 360;     // the Oppo's real CSS width (720 physical / DPR 2); a documented narrow target for this app
const PHONE_BIG = 411; // a larger phone — still narrow (< 760), still stacked
const DESKTOP = 1000;  // the desktop console: wide, single-row meal layout kept exactly as today
const sleep = ms => new Promise(r => setTimeout(r, ms));
const BASE_SHA = '0b0a44a7';     // both defects
const PARTIAL_SHA = '3a6805bc';  // date stacked, meal row NOT reflowed (the first pass that passed-then-failed on device)

// ── tree -> HTML (the same serialiser the check-in page test keeps local, for the same reason) ───────────────
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
  const out = [];
  (function walk(n) {
    if (n == null || n === false || n === true) return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (typeof n === 'string' || typeof n === 'number') { out.push(esc(n)); return; }
    if (typeof n !== 'object') return;
    if (typeof n.type === 'function' || n.type === 'Fragment') { (n.kids || []).forEach(walk); return; }
    const tag = String(n.type);
    const attrs = [];
    let inner = null;
    for (const [k, v] of Object.entries(n.props || {})) {
      if (k === 'children' || k === 'key' || k === 'ref' || v == null || v === false || typeof v === 'function') continue;
      if (k === 'style') { const s = css(v); if (s) attrs.push(`style="${esc(s)}"`); continue; }
      if (k === 'dangerouslySetInnerHTML') { inner = v.__html; continue; }
      attrs.push(`${SVG_ATTR[k] || (/^[a-z-]+$/.test(k) ? k : kebab(k))}="${esc(v === true ? '' : v)}"`);
    }
    out.push(`<${tag}${attrs.length ? ' ' + attrs.join(' ') : ''}>`);
    if (inner != null) out.push(inner); else (n.kids || []).forEach(walk);
    if (!VOID.has(tag)) out.push(`</${tag}>`);
  })(node);
  return out.join('');
}

// ── the fixture: a meals need that reproduces the overflow ───────────────────────────────────────────────────
// Multi-day (3), two meals a day (Lunch + Dinner), one FILLED slot carrying a LONG helper name and a LONG dish
// note (the widest per-meal row the page can paint), plus a SKIPPED day. The long helper name proves names
// still show (owner constraint, 937bfd7c "Helper NAMES kept") now that the rigid 120px column is gone.
const HELPER = 'f'.repeat(64);
const DIRECTORY = { [HELPER]: { name: 'Bartholomew Featherstonehaugh-Cholmondeley' } };
const NEED_MEALS = { id: 'n1', type: 'meals', displayLabel: 'The Okonkwo Family',
  dates: ['2026-11-02', '2026-11-03', '2026-11-04'], meals: ['lunch', 'dinner'], dayMeals: {} };
const SLOTS_MEALS = [
  { needId: 'n1', isoDate: '2026-11-02', pubkey: HELPER, meal: 'lunch', note: 'A big pot of stew for the family' },
];
const SKIPS_MEALS = [{ needId: 'n1', isoDate: '2026-11-04', reason: 'family away this week' }];

// A NON-MEALS need (rides): the other branch of the schedule render — fills / "Open", no per-meal rows.
const NEED_RIDES = { id: 'n2', type: 'rides', displayLabel: 'Lifts for Enid Pennyfeather',
  dates: ['2026-11-02', '2026-11-03'], dayMeals: {} };
const SLOTS_RIDES = [{ needId: 'n2', isoDate: '2026-11-02', pubkey: HELPER, note: 'collect at 9am, back by noon' }];

// The responsive split is decided at RENDER time by the component's `useStewNarrow()` call, not by the
// browser viewport — this harness renders once in Node, then lays the HTML out in the browser. So `narrow` is
// controlled here, deterministically, exactly as the real hook would answer at the width each page is laid out
// at: true for the phone pages (innerWidth < 760), false for the desktop page. The hook itself is shared and
// tested elsewhere; here we drive BOTH of MealsNeedDetail's real layout branches by controlling its input.
function loadMealsFrom(jsSource, narrow) {
  const { React, draw } = miniReact();
  const { Icon } = loadScreen('app/icons.jsx', ['Icon'], { React, window: {} });
  const window = { useStewardDirectory: () => DIRECTORY, Steward: {}, StewardMeals: null,
    addEventListener() {}, removeEventListener() {} };
  const globals = { React, Icon, window, useStewNarrow: () => !!narrow };
  const names = Object.keys(globals);
  const mod = new Function(...names, jsSource + '\nreturn { MealsNeedDetail };')(...names.map(k => globals[k]));
  assert.equal(typeof mod.MealsNeedDetail, 'function', 'MealsNeedDetail is not a component — re-anchor this test');
  return { React, draw, MealsNeedDetail: mod.MealsNeedDetail };
}

const styles = [...readFileSync(join(ROOT, 'steward.html'), 'utf8').matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n');
function page(jsSource, need, slots, skips, narrow) {
  const { draw, MealsNeedDetail } = loadMealsFrom(jsSource, narrow);
  const tree = draw(MealsNeedDetail, { need, slots, skips, onClose() {}, onEdit() {} });
  const html = serialize(tree);
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="stylesheet" href="/vendor/fonts/fonts.css"><link rel="stylesheet" href="/brand.css">
<style>${styles}
html,body{margin:0;padding:0;background:var(--paper)}</style>
<!-- The console's narrow tab content gets the same horizontal gutter the real <main> gives it
     (padding:14px 12px 24px — the narrow return of StewardDashboard, app/stew-dashboard.jsx), so the content
     box is the phone width minus 24px, exactly as on the device. Deliberately NO overflow-y:auto scroll
     container wraps it: in the real app that container forces overflow-x to auto and swallows the sideways
     scroll into itself, which would hide the page-level defect from a documentElement measurement. The
     per-day-row assertion below does not depend on that — it reads each day card's own scrollWidth, which an
     ancestor's clip cannot hide. -->
<div class="stew-tab" style="padding:14px 12px 24px">${html}</div>`;
}

// base (pre-fix) and partial (first-pass) sources, compiled straight from git.
function compileFromGit(sha) {
  try {
    const src = execFileSync('git', ['show', `${sha}:app/stew-meals.jsx`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 });
    const tmp = join(tmpdir(), `stew-meals-${sha}-${process.pid}.jsx`); writeFileSync(tmp, src);
    const js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--log-level=error'], { encoding: 'utf8', maxBuffer: 1 << 26 });
    rmSync(tmp, { force: true });
    return { js, why: '' };
  } catch (e) { return { js: null, why: String((e && e.message) || e).slice(0, 160) }; }
}
const FIXED_JS = compileScreen('app/stew-meals.jsx');
const BASE = compileFromGit(BASE_SHA);
const PARTIAL = compileFromGit(PARTIAL_SHA);

const PAGES = {
  meals:       page(FIXED_JS, NEED_MEALS, SLOTS_MEALS, SKIPS_MEALS, true),   // phone: stacked
  meals_wide:  page(FIXED_JS, NEED_MEALS, SLOTS_MEALS, SKIPS_MEALS, false),  // desktop: original single row
  rides:       page(FIXED_JS, NEED_RIDES, SLOTS_RIDES, [], true),
  base:        BASE.js ? page(BASE.js, NEED_MEALS, SLOTS_MEALS, SKIPS_MEALS, true) : '',       // pre-fix: ignores narrow
  partial:     PARTIAL.js ? page(PARTIAL.js, NEED_MEALS, SLOTS_MEALS, SKIPS_MEALS, true) : '', // first pass: ignores narrow
};

// ── lay it out in a real browser and read the rectangles ─────────────────────────────────────────────────────
let chr = null, srv = null, ws = null, send = null, dir = null;
before(async () => {
  if (!CHROME) return;
  await requireFreePort(CDP, 'the-console-care-schedule-fits-the-phone.test.mjs (Chrome debug port)');
  dir = mkdtempSync(join(tmpdir(), 'trin-caresched-'));
  srv = createServer((req, res) => {
    const p = decodeURIComponent(req.url.split('?')[0]);
    const m = /^\/page\/([a-z_]+)\.html$/.exec(p);
    if (m) { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(PAGES[m[1]] || '<!doctype html><title>none</title>'); }
    const f = join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, ''));
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': { '.css': 'text/css', '.woff2': 'font/woff2' }[extname(f)] || 'application/octet-stream' });
    res.end(readFileSync(f));
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  chr = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`, '--no-sandbox', '--disable-gpu',
    '--host-resolver-rules=MAP app.trinityone.church 127.0.0.1:9, MAP *.ts.net 127.0.0.1:9, MAP trinityone.church 127.0.0.1:9',
    `--user-data-dir=${join(dir, 'prof')}`, 'about:blank'], { stdio: 'ignore' });
  let targets = null;
  for (let i = 0; i < 50 && !(targets && targets.length); i++) { await sleep(300); try { targets = await (await fetch(`http://127.0.0.1:${CDP}/json`)).json(); } catch {} }
  assert.ok(targets && targets.length, 'chromium never exposed a debug target');
  const pg = targets.find(t => t.type === 'page') || targets[0];
  ws = new WebSocket(pg.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 5e8 });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  let id = 0; const pend = new Map();
  ws.on('message', d => { const m = JSON.parse(d); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Page.enable');
  await send('Runtime.enable');
});
after(() => { try { ws && ws.close(); } catch {} try { chr && chr.kill('SIGKILL'); } catch {} try { srv && srv.close(); } catch {}
  try { dir && rmSync(dir, { recursive: true, force: true }); } catch {} });

const PROBE = `(async () => { try { await document.fonts.ready; } catch (e) {}
  const de = document.documentElement;
  const text = (document.body.innerText || '').replace(/\\u00a0/g, ' ');
  const hasSchedule = /SCHEDULE/.test(text);
  const hasCovered  = /Covered/.test(text);
  // the day-meals summary line "Lunch \\u00b7 Dinner" (exact joined string — the per-meal labels read
  // "Lunch:" / "Dinner:"). Must appear exactly once post-fix (covered day only).
  const summaryCount = (document.body.innerHTML.match(/Lunch \\u00b7 Dinner/g) || []).length;
  // THE DAY CARDS: the direct children of the container that follows the SCHEDULE label. Each card has
  // overflow:visible, so its scrollWidth reflects any overflow of the meal row inside it — the sharp signal an
  // ancestor's clip cannot hide. The note span's text, when the note is squeezed to a sliver, overflows here.
  const lbl = [...document.querySelectorAll('div')].find(d => (d.textContent || '').trim() === 'SCHEDULE');
  const container = lbl ? lbl.nextElementSibling : null;
  const cards = container ? [...container.children] : [];
  const rows = cards.map(c => ({ sw: c.scrollWidth, cw: c.clientWidth, over: c.scrollWidth - c.clientWidth }));
  const maxRowOver = rows.reduce((m, r) => Math.max(m, r.over), 0);
  // The widest helper name's rendered box, to prove names did not vanish when the fixed column was dropped.
  const spans = [...document.querySelectorAll('span')];
  const nameEl = spans.find(s => (s.textContent || '').includes('Bartholomew'));
  const nameW = nameEl ? Math.round(nameEl.getBoundingClientRect().width) : 0;
  // WHERE THE DISH NOTE SITS relative to its meal label: on the SAME line (wide/desktop) or BELOW it
  // (narrow/phone). Found by the unique note text and the "Lunch:"/"Dinner:" label in the same meal row.
  const noteEl = spans.find(s => (s.textContent || '').includes('big pot of stew'));
  const labelEl = spans.find(s => /^(Lunch|Dinner):$/.test((s.textContent || '').trim()));
  const noteTop = noteEl ? Math.round(noteEl.getBoundingClientRect().top) : null;
  const noteW = noteEl ? Math.round(noteEl.getBoundingClientRect().width) : 0;
  const labelTop = labelEl ? Math.round(labelEl.getBoundingClientRect().top) : null;
  const noteBelowLabel = (noteTop != null && labelTop != null) ? (noteTop - labelTop) : null;
  return JSON.stringify({ innerWidth: window.innerWidth, clientWidth: de.clientWidth, scrollWidth: de.scrollWidth,
    over: de.scrollWidth - de.clientWidth, rows, maxRowOver, nCards: cards.length, nameW, noteW, noteBelowLabel,
    hasSchedule, hasCovered, summaryCount }); })()`;

async function measure(name, w) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: 760, deviceScaleFactor: 2, mobile: true });
  await send('Page.navigate', { url: `http://127.0.0.1:${srv.address().port}/page/${name}.html` });
  await sleep(450);
  const r = await send('Runtime.evaluate', { expression: PROBE, returnByValue: true, awaitPromise: true });
  assert.ok(!(r.result && r.result.exceptionDetails),
    'the measuring probe threw: ' + JSON.stringify((r.result || {}).exceptionDetails || {}).slice(0, 400));
  return JSON.parse(r.result.result.value);
}

const SKIP = { skip: !CHROME ? 'no chromium' : false, timeout: 60000 };

// ── CONTROL ──────────────────────────────────────────────────────────────────────────────────────────────────
test(`CONTROL: the meals schedule laid out at ${PHONE}px with its SCHEDULE heading, a covered day, and ${NEED_MEALS.dates.length} day cards`, SKIP, async () => {
  const m = await measure('meals', PHONE);
  assert.equal(m.clientWidth, PHONE, `the viewport is not the ${PHONE}px phone (clientWidth ${m.clientWidth})`);
  assert.ok(m.hasSchedule, 'the SCHEDULE section did not render — nothing below measures the real page');
  assert.ok(m.hasCovered, 'the covered (skipped) day did not render its "Covered" line — the fixture lost its skip');
  assert.equal(m.nCards, NEED_MEALS.dates.length, `the schedule rendered ${m.nCards} day cards, not ${NEED_MEALS.dates.length} — re-anchor the day-card lookup`);
  assert.ok(m.nameW > 0, 'the long helper name did not render at all — dropping the fixed column must not drop the NAME (owner: Helper NAMES kept)');
  console.log(`    meals@${PHONE}: clientWidth ${m.clientWidth}, innerWidth ${m.innerWidth}, scrollWidth ${m.scrollWidth} (over ${m.over}), maxRowOver ${m.maxRowOver}, name box ${m.nameW}px, summaries ${m.summaryCount}`);
});

// ── THE DEFECT, at the device width and a larger phone (both narrow → stacked) ───────────────────────────────
for (const W of [PHONE, PHONE_BIG]) {
  test(`the (narrow) meals schedule does not scroll sideways and no day row overflows its own box at ${W}px`, SKIP, async () => {
    const m = await measure('meals', W);
    assert.equal(m.clientWidth, W, `viewport guard: clientWidth ${m.clientWidth}, not ${W} — the device metrics did not take`);
    // the page level (read on documentElement, never window.innerWidth — which inflates to the scroll width)
    assert.ok(m.scrollWidth <= m.clientWidth,
      `the Care meals schedule scrolls sideways at ${W}px: documentElement scrollWidth ${m.scrollWidth} vs clientWidth ${m.clientWidth} ` +
      `(over ${m.over}). innerWidth read ${m.innerWidth} — the inflated value that would have passed this vacuously.`);
    // the sharper, ancestor-clip-proof level: each day card's OWN scrollWidth
    assert.ok(m.maxRowOver <= 1,
      `a Care schedule day row overflows its own box at ${W}px by ${m.maxRowOver}px (per-card: ${JSON.stringify(m.rows)}). ` +
      'That is the dish note squeezed to a sliver and spilling right — readable text has nowhere to go.');
    // the dish note is on its OWN line below the meal label (the owner's stacked mobile layout), not a sliver
    assert.ok(m.noteBelowLabel != null && m.noteBelowLabel > 5,
      `the dish note is not stacked below its meal label at ${W}px (note top - label top = ${m.noteBelowLabel}). ` +
      'The narrow layout must drop the description onto its own full-width line.');
    assert.ok(m.noteW >= 120,
      `the dish note rendered only ${m.noteW}px wide at ${W}px — it is still a sliver, not a readable full-width line`);
    console.log(`    meals@${W}: page over ${m.over}, maxRowOver ${m.maxRowOver}, note ${m.noteW}px ${m.noteBelowLabel}px below label, rows ${JSON.stringify(m.rows)}`);
  });
}

// ── THE DESKTOP LAYOUT IS PRESERVED: single row, note on the SAME line as the columns ────────────────────────
test(`the (wide) meals schedule keeps its single-row layout on the desktop console at ${DESKTOP}px — note on the same line`, SKIP, async () => {
  const m = await measure('meals_wide', DESKTOP);
  assert.equal(m.clientWidth, DESKTOP, `viewport guard: clientWidth ${m.clientWidth}`);
  assert.ok(m.scrollWidth <= m.clientWidth, `the desktop meals schedule scrolls sideways at ${DESKTOP}px (over ${m.over})`);
  assert.ok(m.maxRowOver <= 1, `a desktop day row overflows its own box at ${DESKTOP}px (${JSON.stringify(m.rows)})`);
  // the whole point of the responsive split: on the desktop the note stays BESIDE the columns (same line),
  // not stacked below — so this proves the wide branch is the original single-row layout, not the stacked one.
  assert.ok(m.noteBelowLabel != null && m.noteBelowLabel <= 2,
    `the dish note dropped onto its own line on the DESKTOP (note top - label top = ${m.noteBelowLabel}) — the wide ` +
    'layout must keep label · status · name · note all on one row, as the console has always had it.');
  console.log(`    meals_wide@${DESKTOP}: page over ${m.over}, maxRowOver ${m.maxRowOver}, note ${m.noteW}px ${m.noteBelowLabel}px below label (same line)`);
});

test(`the duplicate day-meals summary is gone on normal days and kept on the covered day (appears exactly once)`, SKIP, async () => {
  const m = await measure('meals', PHONE);
  assert.equal(m.summaryCount, 1,
    `the "Lunch · Dinner" day summary appears ${m.summaryCount} times — expected exactly once (covered day only). ` +
    'More than one means the duplicate under the date is back; zero means it was dropped from the covered day too, ' +
    'where it is the ONLY place the covered meals are listed.');
});

test(`the non-meals (rides) schedule renders and does not overflow at ${PHONE}px`, SKIP, async () => {
  const m = await measure('rides', PHONE);
  assert.equal(m.clientWidth, PHONE, `viewport guard: clientWidth ${m.clientWidth}`);
  assert.ok(m.hasSchedule, 'the rides schedule did not render its SCHEDULE section');
  assert.ok(m.scrollWidth <= m.clientWidth, `the rides schedule scrolls sideways at ${PHONE}px (over ${m.over})`);
  assert.ok(m.maxRowOver <= 1, `a rides day row overflows its own box at ${PHONE}px (${JSON.stringify(m.rows)})`);
  console.log(`    rides@${PHONE}: page over ${m.over}, maxRowOver ${m.maxRowOver}`);
});

// ── INSTRUMENT VALIDATION at 360: base AND the partial first fix BOTH overflow a day row ─────────────────────
// This is what stops a 411-only pass from shipping a 360 bug again. The partial fix (3a6805bc) stacked the
// date — so the PAGE no longer scrolls — but left the meal row unreflowed, so the sharp per-row assertion is
// the one that catches it. Both pre-fix states must trip it, and only this second pass must be clean.
for (const [name, info, sha] of [['base', BASE, BASE_SHA], ['partial', PARTIAL, PARTIAL_SHA]]) {
  test(`INSTRUMENT: the ${name} component (git ${sha}) overflows a day row at ${PHONE}px`,
    { skip: !CHROME ? 'no chromium' : (info.js ? false : `could not read ${sha}:app/stew-meals.jsx (${info.why})`), timeout: 60000 },
    async () => {
      const m = await measure(name, PHONE);
      assert.equal(m.clientWidth, PHONE, `viewport guard: clientWidth ${m.clientWidth}`);
      assert.ok(m.maxRowOver > 1,
        `the ${name} meals schedule did NOT overflow a day row at ${PHONE}px (maxRowOver ${m.maxRowOver}, rows ${JSON.stringify(m.rows)}). ` +
        'If the bug no longer reproduces on this commit, the per-row measurement proves nothing about the fix — re-anchor the fixture.');
      console.log(`    ${name.toUpperCase()} ${sha}@${PHONE}: page over ${m.over} (innerWidth ${m.innerWidth}), maxRowOver ${m.maxRowOver}, rows ${JSON.stringify(m.rows)}, summaries ${m.summaryCount}`);
    });
}
