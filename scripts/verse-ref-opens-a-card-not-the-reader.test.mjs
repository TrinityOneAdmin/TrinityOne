// A DEVOTIONAL SCRIPTURE REFERENCE OPENS A CARD — AND A READING-PLAN DAY STILL OPENS THE FULL READER.
// Run: node --test scripts/verse-ref-opens-a-card-not-the-reader.test.mjs
//
// Owner 2026-10-18 (revised after review): the verse card is for DEVOTIONALS only and is CARD-ONLY ("never
// leave the devotional"). A reading-plan day is "go read the whole chapter", so a plan day row KEEPS opening
// the full Bible reader via ctx.openPlanDay — no card there. CLAUDE.md rules 1 and 3: this draws the REAL
// DevoRefChip and the REAL PlanDetail (app/screens-plans.jsx, compiled with esbuild) through the REAL
// BottomSheet (app/ui.jsx) in scripts/render-jsx-screen.mjs, and fires the real onClick handlers. Nothing
// asserts by matching source text. The card resolves the reference from the (stubbed) window.Bible exactly as
// the shipped DevoVerseSheet does.
//
// Users of the shared code (rule 2): DevoRefChip (two call sites — DevoDayReader and the plain ChurchDevoView)
// now opens the file-local DevoVerseSheet card instead of navigating. The card's navigation-free promise is
// pinned by asserting ctx.gotoRef / ctx.openChurchDevo are NOT called. PlanDetail is UNCHANGED (reverted): its
// day rows still call ctx.openPlanDay to open the reader — pinned here so the revert cannot silently regress.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScreen, miniReact, find, texts } from './render-jsx-screen.mjs';

const Passthrough = function Overlay({ children }) { return children === undefined ? null : children; };

// A Bible stub: "John 3:16-17" is a range, "John 3" is a whole chapter, anything without a chapter is unreadable.
function bibleStub() {
  return {
    activeVersion: 'WEB',
    books: () => [43],
    parseRef: (r) => {
      const m = /^([\dA-Za-z ]+?)\s+(\d+)(?::(\d+)(?:-(\d+))?)?$/.exec(String(r).trim());
      if (!m) return null;
      return { book: 43, chap: +m[2], verse: m[3] ? +m[3] : undefined, verseEnd: m[4] ? +m[4] : undefined };
    },
    getVerses: () => [
      { v: 16, text: 'For God so loved the world' },
      { v: 17, text: 'that he gave his only Son' },
      { v: 18, text: 'He is not condemned' },
    ],
  };
}

function world() {
  const { React, draw } = miniReact();
  const win = { Bible: bibleStub(), innerWidth: 360, addEventListener() {}, removeEventListener() {},
    getSelection: () => ({ toString: () => '' }), localStorage: { getItem: () => null, setItem() {} },
    TrinityData: { PLANS: [], CROSSREFS: {} }, sanitizeHtml: h => h };
  const base = { React, window: win, localStorage: win.localStorage,
    document: { addEventListener() {}, removeEventListener() {}, querySelector: () => null, activeElement: null },
    navigator: { userAgent: '' }, location: { search: '', hostname: 'x' }, setTimeout, clearTimeout, setInterval, clearInterval, console,
    history: { back() {}, pushState() {}, replaceState() {}, state: null }, fetch: async () => ({ ok: false, json: async () => ({}) }) };
  const { Icon } = loadScreen('app/icons.jsx', ['Icon'], { React, window: {} });
  const { BottomSheet, IconBtn } = loadScreen('app/ui.jsx', ['BottomSheet', 'IconBtn'], { ...base, Icon, PhoneFrame() { return null; } });
  const plans = loadScreen('app/screens-plans.jsx', ['DevoRefChip', 'PlanDetail'],
    { React, window: win, Icon, IconBtn, BottomSheet, Overlay: Passthrough });
  return { React, draw, win, ...plans };
}

const panel = (tree) => find(tree, n => n.type === 'div' && n.props.onTouchStart)[0];

test('a devotional ref chip: tapping opens the card with the range joined, and never navigates to the reader', () => {
  const w = world();
  const ctx = { _goto: 0, _odevo: 0, gotoRef() { ctx._goto++; }, openChurchDevo() { ctx._odevo++; }, toast() {} };
  const render = () => w.draw(w.DevoRefChip, { refText: 'John 3:16-17', ctx });

  let t = render();
  assert.ok(!texts(t).join(' ').includes('For God so loved'), 'the card is showing before the chip was tapped');

  const chip = find(t, n => n.type === 'button' && texts(n).join(' ').includes('John 3:16-17'));
  assert.equal(chip.length, 1, 'no single scripture chip');
  chip[0].props.onClick();

  const words = texts(render()).join(' ');
  assert.ok(words.includes('For God so loved the world'), 'verse 16 missing from the card');
  assert.ok(words.includes('that he gave his only Son'), 'verse 17 missing — a RANGE did not join both verses');
  assert.equal(ctx._goto, 0, 'the chip navigated to the reader (ctx.gotoRef)');
  assert.equal(ctx._odevo, 0, 'the chip closed the devotional index (ctx.openChurchDevo)');
});

test('a whole-chapter reference shows the whole chapter in the card', () => {
  const w = world();
  const ctx = { gotoRef() { assert.fail('navigated'); }, toast() {} };
  const render = () => w.draw(w.DevoRefChip, { refText: 'John 3', ctx });
  find(render(), n => n.type === 'button')[0].props.onClick();
  const words = texts(render()).join(' ');
  assert.ok(words.includes('For God so loved the world') && words.includes('He is not condemned'),
    'a whole-chapter reading did not show all its verses');
});

test('an unreadable reference says so and shows no verse text', () => {
  const w = world();
  const render = () => w.draw(w.DevoRefChip, { refText: 'not a reference', ctx: { toast() {} } });
  find(render(), n => n.type === 'button')[0].props.onClick();
  const words = texts(render()).join(' ');
  assert.ok(words.includes("Couldn't read that reference"), 'no graceful error for an unreadable reference');
});

test('the explicit X closes the card', () => {
  const w = world();
  const render = () => w.draw(w.DevoRefChip, { refText: 'John 3:16-17', ctx: { toast() {} } });
  find(render(), n => n.type === 'button' && texts(n).join(' ').includes('John 3:16-17'))[0].props.onClick();
  assert.equal(panel(render()).props.style.transform, 'translateY(0)', 'card did not open');
  const x = find(render(), n => n.type === 'button' && n.props['aria-label'] === 'Close');
  assert.equal(x.length, 1, 'no explicit close (X) button on the card');
  x[0].props.onClick();
  assert.equal(panel(render()).props.style.transform, 'translateY(102%)', 'the X did not close the card');
});

const PLAN = { id: 'p1', title: 'John', sub: '3 days', len: 3,
  days: [{ d: 1, label: 'Day 1', ref: 'John 3:16-17' }, { d: 2, label: 'Day 2', ref: 'John 2' }, { d: 3, label: 'Day 3', ref: 'John 3' }] };

test('a reading-plan day row opens the FULL READER (ctx.openPlanDay) — not a card (revert pinned)', () => {
  const w = world();
  let closed = 0;
  const ctx = { planProgress: {}, _opd: 0, _day: null, openPlanDay(p, d) { ctx._opd++; ctx._day = d; }, togglePlanDay() {}, toast() {} };
  const render = () => w.draw(w.PlanDetail, { plan: PLAN, open: true, onClose() { closed++; }, ctx });

  const row = find(render(), n => n.type === 'div' && n.props.onClick && texts(n).join(' ').includes('John 3:16-17'));
  assert.equal(row.length, 1, 'no single Day 1 row');
  row[0].props.onClick();

  assert.equal(ctx._opd, 1, 'a plan day did NOT open the reader via ctx.openPlanDay');
  assert.equal(ctx._day && ctx._day.d, 1, 'the reader opened the wrong plan day');
  assert.ok(!texts(render()).join(' ').includes('For God so loved the world'), 'a plan day opened a verse card instead of the reader');
});
