// THE SERMON "FEATURE" CHOICE DOES NOT STRAND THE REMOVE BUTTON ON A PHONE, AND IS LABELLED.
// Run: node --test scripts/the-feature-choice-fits-a-phone-row.test.mjs
//
// Device finding 2026-10-12. A sermon row in the console is a wrapping flex row. The open Feature choice
// ("Feature and notify" / "Feature quietly") is 100% wide and sat BETWEEN the Feature and Remove buttons, so on
// a phone the Remove button was pushed onto a third line by itself; and the choice had no visible label (owner,
// 2026-10-11: controls need a visible short label).
//
// Two halves:
//  1. STRUCTURE, from the real DashSermons drawn through the miniature React (rules 1 and 3): the choice block
//     says "Tell members?" and is the LAST child of the row.
//  2. LAYOUT, in real chromium at 360px: the row is turned into HTML from that same drawn tree (inline styles
//     only, so nothing is invented) and measured. Skips itself when chromium is unavailable. This is a faithful
//     layout of the real row, NOT a screenshot of the running console: the surrounding panel is approximated by a
//     296px-wide box (360 minus a 16px page gutter and a 16px panel padding each side) and the .sk-btn rules are
//     copied from steward.html. It cannot see the console's real fonts.
//
// Callers of the shared code (rule 2): only the sermon row in DashSermons changed - the order of two children and
// a label span. The Feature / Featured toggle, doFeature and the two choice buttons are untouched, so
// scripts/a-sermon-can-be-featured-quietly.test.mjs (which presses them) is the guard for those.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { miniReact, find, reads, loadScreen } from './render-jsx-screen.mjs';

const CHROME = ['/snap/bin/chromium', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => existsSync(p));
const SERMONS = [{ id: 's2', title: 'Evening prayer with a rather long title that must not push the buttons about', sha256: 'bb', size: 20, mime: 'video/mp4' }];
const STUB = () => function Stub(p) { return { type: 'div', props: {}, kids: [p && p.children].flat().filter(Boolean) }; };
const IconBox = function Icon() { return { type: 'span', props: { style: { display: 'inline-block', width: 16, height: 16 } }, kids: [] }; };

function panel() {
  const { React, draw } = miniReact();
  const win = {
    Steward: {
      subscribeSermons: (cb) => { cb(SERMONS); return () => {}; },
      subscribePinnedSermon: (cb) => { cb(null); return () => {}; },
      subscribeMediaKey: () => () => {}, mediaHosts: () => [],
      removeSermon: async () => true, unpinSermon: async () => true, pinSermon: async () => true,
    },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    addEventListener() {}, removeEventListener() {},
  };
  const mod = loadScreen('app/stew-dashboard.jsx', ['DashSermons'], {
    React, window: win, Icon: IconBox, SkBadge: STUB(), SkPill: STUB(), SkToggle: STUB(),
    Panel: ({ children }) => children, DismissibleNote: ({ children }) => children,
    useStewDialog: () => ({ current: null }), useStewModalOpen: () => {}, location: { search: '' },
    setTimeout, clearTimeout, URL, URLSearchParams, Blob,
    Math, Date, JSON, String, Number, Boolean, Object, Array, Set, Map, console, Promise, RegExp,
  });
  let tree = draw(mod.DashSermons, {}); tree = draw(mod.DashSermons, {});
  const row = () => { const h = find(tree, n => n.props && n.props.key === 's2' && n.type === 'div'); assert.equal(h.length, 1, 're-anchor: the sermon row'); return h[0]; };
  const featureBtn = () => { const h = find(row(), n => n.type === 'button' && reads(n).trim() === 'Feature' && n.props.onClick); assert.equal(h.length, 1, 're-anchor: Feature button'); return h[0]; };
  const open = () => { featureBtn().props.onClick(); tree = draw(mod.DashSermons, {}); };
  return { row, open };
}

// ---- 1. structure ----
test('opening Feature shows a "Tell members?" label, and the choice block is the LAST child of the row', () => {
  const p = panel();
  assert.equal(find(p.row(), n => n.props && n.props['data-testid'] === 'feature-choice').length, 0, 'the choice was open before Feature was tapped');
  p.open();
  const choice = find(p.row(), n => n.props && n.props['data-testid'] === 'feature-choice');
  assert.equal(choice.length, 1, 'tapping Feature did not open the choice');
  assert.match(reads(choice[0]), /Tell members\?/, 'the choice has no visible label');
  const kids = p.row().kids.filter(k => k && typeof k === 'object');
  const last = kids[kids.length - 1];
  assert.ok(last && last.props && last.props['data-testid'] === 'feature-choice', 'something comes AFTER the 100%-wide choice block, so it forces a line break before it');
});

// ---- 2. layout in chromium ----
const KEBAB = (k) => k.replace(/[A-Z]/g, m => '-' + m.toLowerCase());
const UNITLESS = new Set(['flex', 'flexGrow', 'flexShrink', 'fontWeight', 'lineHeight', 'opacity', 'zIndex', 'order']);
const css = (st) => Object.entries(st || {}).filter(([, v]) => v != null && v !== false).map(([k, v]) => KEBAB(k) + ':' + (typeof v === 'number' && !UNITLESS.has(k) ? v + 'px' : v)).join(';');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
function html(n) {
  if (n == null || n === false || n === true) return '';
  if (typeof n !== 'object') return esc(n);
  if (Array.isArray(n)) return n.map(html).join('');
  if (typeof n.type === 'function') return (n.kids || []).map(html).join('');
  if (typeof n.type !== 'string') return (n.kids || []).map(html).join('');
  const p = n.props || {};
  const attrs = (p.className ? ' class="' + esc(p.className) + '"' : '') + (p['data-testid'] ? ' data-testid="' + p['data-testid'] + '"' : '') + (p['aria-label'] ? ' aria-label="' + esc(p['aria-label']) + '"' : '') + ' style="' + css(p.style) + '"';
  return '<' + n.type + attrs + '>' + (n.kids || []).map(html).join('') + '</' + n.type + '>';
}
const PAGE_CSS = `*{box-sizing:border-box} body{margin:0;font:14px sans-serif}
.sk-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;font-weight:700;font-size:14px;padding:11px 18px;border-radius:12px;border:none;line-height:1;background:#222;color:#fff}
.sk-btn--ghost{background:transparent;color:#222;box-shadow:inset 0 0 0 1.4px #ccc}
.sk-panel .sk-btn{font-size:12.5px !important;padding:8px 13px !important}`;
const MEASURE = `(function(){var w=document.getElementById('w'),row=w.firstElementChild,out={wRight:Math.round(w.getBoundingClientRect().right),rowW:row.getBoundingClientRect().width,scrollW:w.scrollWidth,clientW:w.clientWidth,kids:[]};
for(var i=0;i<row.children.length;i++){var c=row.children[i],r=c.getBoundingClientRect();out.kids.push({tag:c.tagName,id:c.getAttribute('data-testid')||'',label:(c.getAttribute('aria-label')||c.textContent||'').trim().slice(0,30),top:Math.round(r.top),right:Math.round(r.right),bottom:Math.round(r.bottom)});}
document.title='RESULT:'+JSON.stringify(out);})()`;

function measure(rowTree) {
  const page = '<!doctype html><meta charset=utf-8><meta name=viewport content="width=360"><style>' + PAGE_CSS + '</style>'
    + '<div class="sk-panel" style="padding:0 16px"><div id="w" style="width:296px">' + html(rowTree) + '</div></div><script>' + MEASURE + '</script>';
  const dir = mkdtempSync(join(tmpdir(), 'trin-featrow-'));
  try {
    const r = spawnSync(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--user-data-dir=' + dir, '--window-size=360,900', '--virtual-time-budget=2000',
      '--dump-dom', 'data:text/html;base64,' + Buffer.from(page).toString('base64')], { encoding: 'utf8', timeout: 90000 });
    const m = /<title>RESULT:(.*?)<\/title>/s.exec(r.stdout || '');
    assert.ok(m, 'chromium did not report a measurement: ' + String(r.stderr || '').slice(0, 300));
    return JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('at 360px the Edit, Feature and Remove buttons stay on ONE line with the choice open, and the choice sits below them', { skip: !CHROME ? 'no chromium' : false, timeout: 120000 }, () => {
  const p = panel();
  p.open();
  const m = measure(p.row());
  const by = (pred) => m.kids.find(pred);
  const edit = by(k => k.label === 'Edit sermon'), feature = by(k => k.label === 'Feature'), remove = by(k => k.label === 'Remove sermon'), choice = by(k => k.id === 'feature-choice');
  assert.ok(edit && feature && remove && choice, 'the measured row is missing a control: ' + JSON.stringify(m.kids));
  assert.equal(remove.top, feature.top, 'THE DEFECT: Remove is on a different line from Feature (' + remove.top + ' vs ' + feature.top + ')');
  assert.equal(edit.top, feature.top, 'Edit is on a different line from Feature');
  assert.ok(choice.top >= feature.bottom, 'the choice is not below the button line');
  assert.ok(m.scrollW <= m.clientW, 'the row overflows sideways: ' + m.scrollW + ' > ' + m.clientW);
});

test('at 360px the open choice fits: no sideways overflow', { skip: !CHROME ? 'no chromium' : false, timeout: 120000 }, () => {
  const p = panel();
  p.open();
  const m = measure(p.row());
  assert.ok(m.scrollW <= m.clientW, 'overflow: ' + m.scrollW + ' > ' + m.clientW);
  const choice = m.kids.find(k => k.id === 'feature-choice');
  assert.ok(choice && choice.right <= m.wRight, 'the choice block is wider than the row');
});
