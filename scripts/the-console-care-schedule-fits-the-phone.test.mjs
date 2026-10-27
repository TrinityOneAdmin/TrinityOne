// THE STEWARD CONSOLE'S CARE (MEALS) SCHEDULE DOES NOT SCROLL A PHONE SIDEWAYS.
//   Run: node --test scripts/the-console-care-schedule-fits-the-phone.test.mjs
//
// Found by the owner on a real phone and reproduced in headless chromium at 411px: opening a meals need in
// the steward console Care page pushed the whole page ~100px off the right edge (documentElement.scrollWidth
// 511 vs clientWidth 411), and the detail card then clipped off the LEFT. The cause was in MealsNeedDetail
// (app/stew-meals.jsx): each day was a side-by-side [date column width:104 | meals column] row, and the meal
// row inside the meals column carried three NON-SHRINKING columns — meal-label width:76 + status width:84 +
// helper-names width:120 + 3x10px gaps = 310px minimum. At 411px the meals column is squeezed below 310 and
// its flexShrink:0 children spill right.
//
// THE FIX, presentation only: the day became a VERTICAL STACK — the date is its own header line, the meal
// row(s) sit full-width beneath it — so the fixed date column no longer steals ~130px from the meal row.
// The duplicate day-meals summary (it listed the meal names a second time, under the date) was dropped on
// normal days and KEPT on a covered day, where it is the only place the covered meals are listed.
//
// HOW THIS ASSERTS, and why nothing cheaper would do. CLAUDE.md rule 3: app/stew-meals.jsx ships UNBUNDLED,
// so `false && ` in front of a condition leaves every word in place and a text match still passes. Nothing
// here matches source text. The REAL MealsNeedDetail is compiled with the same esbuild the packaged build
// uses (--jsx=transform), rendered through the miniature React in scripts/render-jsx-screen.mjs, serialised
// to HTML, dressed in a replica of the console's own narrow shell (<main padding:14px 12px 24px>, the narrow
// return of StewardDashboard), and laid out by a real browser at 411px. Every claim is a rect.
//
// ⚠ THE HEADLESS VACUOUS-PASS TRAP (CLAUDE.md, the task brief, and measured here). Under
// Emulation.setDeviceMetricsOverride(width:411), when the page overflows horizontally `window.innerWidth` is
// INFLATED to the scroll width (measured 511) — so an assertion against window.innerWidth is a VACUOUS PASS
// against the exact bug this file exists to catch. So the overflow is read as
// document.documentElement.scrollWidth <= document.documentElement.clientWidth, and a guard asserts
// clientWidth === 411 to prove the viewport really is the phone. The probe returns innerWidth too, so the
// inflation is visible in the console output.
//
// INSTRUMENT-VALIDATED, both directions (CLAUDE.md sabotage rule / task correction C). The pre-fix component
// is compiled straight from git (0b0a44a7:app/stew-meals.jsx) and measured by the same probe: it overflows,
// so the measurement can tell the fix from the bug. If that commit is not reachable the row is skipped with a
// clear message rather than passing silently.
//
// Skips itself (rather than failing) when chromium is unavailable, so CI without a browser stays green —
// same contract as scripts/the-check-in-page-fits-the-phone.test.mjs.
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
const CDP = 9353;   // 93xx band; a gap between 9352 and 9354 — neighbours 9360 (check-in page), 9368 (console phone batch-a)
const VW = 411;     // the phone the owner measured on; the vacuous-pass guard pins clientWidth to this
const sleep = ms => new Promise(r => setTimeout(r, ms));
const BASE_SHA = '0b0a44a7';

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

// ── the fixture: a meals need that reproduces the 100px overflow ─────────────────────────────────────────────
// Multi-day (3), two meals a day (Lunch + Dinner), one FILLED slot carrying a LONG helper name and a LONG dish
// note (the widest per-meal row the page can paint), plus a SKIPPED day. The long helper name proves the
// width:120 names column still shows a name (owner constraint, 937bfd7c "Helper NAMES kept") while the row is
// now full-width.
const HELPER = 'f'.repeat(64);
const DIRECTORY = { [HELPER]: { name: 'Bartholomew Featherstonehaugh-Cholmondeley' } };
const NEED_MEALS = { id: 'n1', type: 'meals', displayLabel: 'The Abernathy-Fotheringay Family',
  dates: ['2026-11-02', '2026-11-03', '2026-11-04'], meals: ['lunch', 'dinner'], dayMeals: {} };
const SLOTS_MEALS = [
  { needId: 'n1', isoDate: '2026-11-02', pubkey: HELPER, meal: 'lunch', note: 'A big pot of stew for the whole family' },
];
const SKIPS_MEALS = [{ needId: 'n1', isoDate: '2026-11-04', reason: 'family away this week' }];

// A NON-MEALS need (rides): the other branch of the schedule render — fills / "Open", no per-meal rows.
const NEED_RIDES = { id: 'n2', type: 'rides', displayLabel: 'Lifts for Enid Pennyfeather',
  dates: ['2026-11-02', '2026-11-03'], dayMeals: {} };
const SLOTS_RIDES = [{ needId: 'n2', isoDate: '2026-11-02', pubkey: HELPER, note: 'collect at 9am, back by noon' }];

// Compile a given stew-meals.jsx source and hand back MealsNeedDetail. `relPath` is relative to ROOT (the
// working tree) unless `absJs` is passed (already-compiled JS, used for the git base). loadScreen handles the
// working-tree path; the base path is compiled by hand because it lives outside the tree.
function loadMealsFrom(jsSource) {
  const { React, draw } = miniReact();
  const { Icon } = loadScreen('app/icons.jsx', ['Icon'], { React, window: {} });
  const window = { useStewardDirectory: () => DIRECTORY, Steward: {}, StewardMeals: null,
    addEventListener() {}, removeEventListener() {} };
  const globals = { React, Icon, window };
  const names = Object.keys(globals);
  const mod = new Function(...names, jsSource + '\nreturn { MealsNeedDetail };')(...names.map(k => globals[k]));
  assert.equal(typeof mod.MealsNeedDetail, 'function', 'MealsNeedDetail is not a component — re-anchor this test');
  return { React, draw, MealsNeedDetail: mod.MealsNeedDetail };
}

const styles = [...readFileSync(join(ROOT, 'steward.html'), 'utf8').matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n');
function page(jsSource, need, slots, skips) {
  const { draw, MealsNeedDetail } = loadMealsFrom(jsSource);
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
     scroll into itself, which would hide the defect from a documentElement measurement. The owner measured
     (and the task fixes the test at) the DOCUMENT level — documentElement.scrollWidth vs clientWidth — so the
     content is left free to push the document itself sideways, which is exactly what a too-narrow meals
     column does when its non-shrinking children spill past the right edge. -->
<div class="stew-tab" style="padding:14px 12px 24px">${html}</div>`;
}

// The working-tree (fixed) sources and the git base (pre-fix) source.
const FIXED_JS = compileScreen('app/stew-meals.jsx');
let BASE_JS = null, baseWhy = '';
try { const src = execFileSync('git', ['show', `${BASE_SHA}:app/stew-meals.jsx`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 });
  const tmp = join(tmpdir(), `base-stew-meals-${process.pid}.jsx`); writeFileSync(tmp, src);
  BASE_JS = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--log-level=error'], { encoding: 'utf8', maxBuffer: 1 << 26 });
  rmSync(tmp, { force: true });
} catch (e) { baseWhy = String((e && e.message) || e).slice(0, 160); }

const PAGES = {
  meals: page(FIXED_JS, NEED_MEALS, SLOTS_MEALS, SKIPS_MEALS),
  rides: page(FIXED_JS, NEED_RIDES, SLOTS_RIDES, []),
  base:  BASE_JS ? page(BASE_JS, NEED_MEALS, SLOTS_MEALS, SKIPS_MEALS) : '',
};

// ── lay it out in a real browser and read the rectangles ─────────────────────────────────────────────────────
let chr = null, srv = null, ws = null, send = null, dir = null;
before(async () => {
  if (!CHROME) return;
  await requireFreePort(CDP, 'the-console-care-schedule-fits-the-phone.test.mjs (Chrome debug port)');
  dir = mkdtempSync(join(tmpdir(), 'trin-caresched-'));
  srv = createServer((req, res) => {
    const p = decodeURIComponent(req.url.split('?')[0]);
    const m = /^\/page\/([a-z]+)\.html$/.exec(p);
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
  // the LANDMARKS this page must have, read from what the browser actually laid out
  const hasSchedule = /SCHEDULE/.test(text);
  const hasCovered  = /Covered/.test(text);
  // the day-meals summary line "Lunch · Dinner" — it is the duplicate that must now appear ONCE (covered day
  // only), not once per day. Matched on the exact joined string, which only the summary produces (the per-meal
  // labels read "Lunch:" / "Dinner:").
  const summaryCount = (text.match(/Lunch \\u00b7 Dinner/g) || (document.body.innerHTML.match(/Lunch \\u00b7 Dinner/g)) || []).length;
  return JSON.stringify({ innerWidth: window.innerWidth, clientWidth: de.clientWidth, scrollWidth: de.scrollWidth,
    over: de.scrollWidth - de.clientWidth, hasSchedule, hasCovered, summaryCount, textLen: text.length }); })()`;

async function measure(name) {
  await send('Emulation.setDeviceMetricsOverride', { width: VW, height: 760, deviceScaleFactor: 2, mobile: true });
  await send('Page.navigate', { url: `http://127.0.0.1:${srv.address().port}/page/${name}.html` });
  await sleep(450);
  const r = await send('Runtime.evaluate', { expression: PROBE, returnByValue: true, awaitPromise: true });
  assert.ok(!(r.result && r.result.exceptionDetails),
    'the measuring probe threw: ' + JSON.stringify((r.result || {}).exceptionDetails || {}).slice(0, 400));
  return JSON.parse(r.result.result.value);
}

const SKIP = { skip: !CHROME ? 'no chromium' : false, timeout: 60000 };

// ── CONTROL ──────────────────────────────────────────────────────────────────────────────────────────────────
// A harness that renders nothing scrolls nowhere and would pass the overflow rows for the wrong reason. So:
// the schedule really did render, at the phone width, with the covered day on it.
test('CONTROL: the meals schedule laid out at 411px with its SCHEDULE heading and a covered day', SKIP, async () => {
  const m = await measure('meals');
  assert.equal(m.clientWidth, VW, `the viewport is not the ${VW}px phone we claim to measure (clientWidth ${m.clientWidth})`);
  assert.ok(m.hasSchedule, 'the SCHEDULE section did not render — nothing below measures the real page');
  assert.ok(m.hasCovered, 'the covered (skipped) day did not render its "Covered" line — the fixture lost its skip');
  console.log(`    meals page: clientWidth ${m.clientWidth}, innerWidth ${m.innerWidth}, scrollWidth ${m.scrollWidth} (over ${m.over}), summaries ${m.summaryCount}`);
});

// ── THE DEFECT ───────────────────────────────────────────────────────────────────────────────────────────────
test(`the meals schedule does not scroll a ${VW}px phone sideways (scrollWidth <= clientWidth, not innerWidth)`, SKIP, async () => {
  const m = await measure('meals');
  assert.equal(m.clientWidth, VW, `viewport guard: clientWidth is ${m.clientWidth}, not ${VW} — the device metrics did not take`);
  assert.ok(m.scrollWidth <= m.clientWidth,
    `the Care meals schedule scrolls sideways at ${VW}px: scrollWidth ${m.scrollWidth} vs clientWidth ${m.clientWidth} ` +
    `(over by ${m.over}px). innerWidth read ${m.innerWidth} — the inflated value that would have passed this vacuously.`);
});

test('the duplicate day-meals summary is gone on normal days and kept on the covered day (appears exactly once)', SKIP, async () => {
  const m = await measure('meals');
  // 3 days in the fixture: two normal (Mon/Tue) + one covered (Wed). Pre-fix the summary rendered on all three;
  // post-fix only the covered day, which has no per-meal rows, keeps it.
  assert.equal(m.summaryCount, 1,
    `the "Lunch · Dinner" day summary appears ${m.summaryCount} times — expected exactly once (covered day only). ` +
    'More than one means the duplicate under the date is back; zero means it was dropped from the covered day too, ' +
    'where it is the ONLY place the covered meals are listed.');
});

test('the non-meals (rides) schedule renders without crashing and does not scroll sideways at 411px', SKIP, async () => {
  const m = await measure('rides');
  assert.equal(m.clientWidth, VW, `viewport guard: clientWidth ${m.clientWidth}`);
  assert.ok(m.hasSchedule, 'the rides schedule did not render its SCHEDULE section');
  assert.ok(m.scrollWidth <= m.clientWidth,
    `the rides schedule scrolls sideways at ${VW}px: scrollWidth ${m.scrollWidth} vs clientWidth ${m.clientWidth} (over ${m.over})`);
  console.log(`    rides page: scrollWidth ${m.scrollWidth} vs clientWidth ${m.clientWidth} (over ${m.over})`);
});

// ── INSTRUMENT VALIDATION: the pre-fix component DOES overflow, so the probe can tell the fix from the bug ────
test(`INSTRUMENT: the pre-fix component (git ${BASE_SHA}) overflows at ${VW}px`,
  { skip: !CHROME ? 'no chromium' : (BASE_JS ? false : `could not read ${BASE_SHA}:app/stew-meals.jsx (${baseWhy})`), timeout: 60000 },
  async () => {
    const m = await measure('base');
    assert.equal(m.clientWidth, VW, `viewport guard: clientWidth ${m.clientWidth}`);
    assert.ok(m.scrollWidth > m.clientWidth,
      `the PRE-FIX meals schedule did NOT overflow at ${VW}px (scrollWidth ${m.scrollWidth} vs clientWidth ${m.clientWidth}). ` +
      'If the bug no longer reproduces on the base commit, this measurement proves nothing about the fix — re-anchor the fixture.');
    console.log(`    PRE-FIX base page: scrollWidth ${m.scrollWidth} vs clientWidth ${m.clientWidth} (over ${m.over}px), innerWidth ${m.innerWidth}, summaries ${m.summaryCount}`);
  });
