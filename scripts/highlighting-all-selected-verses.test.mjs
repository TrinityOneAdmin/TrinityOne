// HIGHLIGHTING A MULTI-VERSE SELECTION MUST COLOUR EVERY VERSE, NOT JUST THE FIRST.
//   Run: node --test scripts/highlighting-all-selected-verses.test.mjs
//
// Phase 5 (F1): before this fix, the Highlight row in the ActionSheet was gated behind `!isMulti`, so a
// reader who selected three verses and tapped a colour got nothing — and then lost the selection. The fix
// removes the gate, builds `passageKeys` from all selected verses via Bible.refKey, and applies the colour
// to every key.
//
// CLAUDE.md rule 1: these tests fail if the passageKeys computation is deleted or the onColor handler stops
// iterating over it — the code is EXTRACTED AND EXECUTED, not text-matched. CLAUDE.md rule 3: nothing here
// matches text in app/*.jsx — we compile the functions and run them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fnBody, stripComments } from './test-slice.mjs';
import { miniReact, find } from './render-jsx-screen.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const SRC = readFileSync(join(ROOT, 'app/screens-read.jsx'), 'utf8');
const clean = stripComments(SRC);

// Build a callable function from the shipped passageKeys line.
function buildPassageKeys() {
  const at = clean.indexOf('const passageKeys =');
  assert.notEqual(at, -1, 're-anchor: passageKeys is gone from screens-read.jsx');
  const line = clean.slice(at, clean.indexOf(';', at) + 1);
  return new Function('passage', 'Bible', line + '\nreturn passageKeys;');
}

// Build a callable function from the shipped onColor handler.
function buildOnColor() {
  const at = clean.indexOf('onColor={(c) =>');
  assert.notEqual(at, -1, 're-anchor: onColor handler is gone from the ActionSheet call');
  const end = clean.indexOf('}}', at);
  assert.notEqual(end, -1, 're-anchor: onColor handler is malformed');
  const arrow = clean.slice(at + 'onColor={'.length, end + 1);
  return new Function('passageKeys', 'ctx', 'setSel', 'setCarry', 'setSheet', 'setArrived', 'return (' + arrow + ');');
}

test('passageKeys is built from ALL selected verses across multiple chapters', () => {
  const fn = buildPassageKeys();
  const Bible = { refKey: ({ book, chap }, v) => `${book}.${chap}.${v}` };
  const passage = [
    { book: 'GEN', chap: 1, verses: [1, 2, 3] },
    { book: 'GEN', chap: 2, verses: [1] },
  ];
  const keys = fn(passage, Bible);
  assert.deepEqual(keys, ['GEN.1.1', 'GEN.1.2', 'GEN.1.3', 'GEN.2.1'],
    'passageKeys must include every verse from every passage segment — without this, a cross-chapter ' +
    'selection highlights only the first chapter');
});

test('onColor calls setHighlight for EVERY passageKey and clears the selection', () => {
  const makeFn = buildOnColor();
  const highlighted = {};
  const ctx = { setHighlight: (k, c) => { highlighted[k] = c; } };
  const calls = { sel: [], carry: [], sheet: [], arrived: [] };
  const handler = makeFn(
    ['GEN.1.1', 'GEN.1.2', 'GEN.1.3'],
    ctx,
    (v) => calls.sel.push(v),
    (v) => calls.carry.push(v),
    (v) => calls.sheet.push(v),
    (v) => calls.arrived.push(v),   // item 37 (2026-10-03): onColor also forgets the arrival marker
  );
  handler('yellow');
  assert.deepEqual(highlighted, { 'GEN.1.1': 'yellow', 'GEN.1.2': 'yellow', 'GEN.1.3': 'yellow' },
    'onColor did not call setHighlight for every passageKey — only some verses would be highlighted, ' +
    'and the rest of the selection would be silently dropped');
  assert.deepEqual(calls.sel, [[]], 'onColor did not clear the selection');
  assert.deepEqual(calls.sheet, [null], 'onColor did not close the action sheet');
  assert.deepEqual(calls.arrived, [null], 'onColor did not clear the arrival marker');
});

test('ActionSheet renders highlight buttons when multi > 1', async () => {
  const { React, draw } = miniReact();
  const Stub = (n) => { const f = function ({ children }) { return children || null; }; Object.defineProperty(f, 'name', { value: n }); return f; };
  const src = fnBody(SRC, 'function ActionSheet(', 'ActionSheet');
  const tmp = join(tmpdir(), 'hltest-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, src + '\nexport { ActionSheet };\n');
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const key = '__hltest_' + Math.random().toString(36).slice(2);
  const colorCalls = [];
  globalThis[key] = {
    React,
    HL_COLORS: [{ id: 'yellow', v: '#fef3c7' }, { id: 'green', v: '#d1fae5' }],
    BottomSheet: Stub('BottomSheet'),
    IconBtn: Stub('IconBtn'),
    Icon: Stub('Icon'),
  };
  const preamble = Object.keys(globalThis[key]).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  const mod = await import('data:text/javascript;base64,' + Buffer.from(preamble + '\n' + js).toString('base64'));
  const tree = draw(mod.ActionSheet, {
    label: 'Gen 1:1-3', multi: 3, open: true,
    ctx: { _copy: () => {}, _share: () => {}, _shrink: () => {}, _extend: () => {}, highlights: {} },
    onClose: () => {}, onColor: (c) => colorCalls.push(c), curColor: null,
    onNote: () => {}, onCross: () => {}, onCommentary: () => {}, bookmarked: false, hasNote: false,
  });
  const hlButtons = find(tree, n => n.type === 'button' && n.props && /Highlight/.test(String(n.props['aria-label'] || '')));
  assert.ok(hlButtons.length >= 2,
    'no highlight buttons found when multi > 1 — the colour palette is gated behind !isMulti and a ' +
    'reader who selects more than one verse cannot highlight them');
  hlButtons[0].props.onClick();
  assert.equal(colorCalls.length, 1, 'the highlight button did not call onColor');
});

// 2026-10-14 (owner): the − and + live in the TOP ROW beside the verse name (not a separate centred row), and
// the Highlight swatches are 75% of their old size (44 -> 33). The real ActionSheet is compiled and drawn.
// Real spacing/geometry is not seeable here — this pins WHICH CONTAINER holds the controls and the size VALUES.
test('ActionSheet: -/+ share the top row with the verse name and the close X; swatches are 33px', async () => {
  const { React, draw } = miniReact();
  const Stub = (n) => { const f = function ({ children }) { return children || null; }; Object.defineProperty(f, 'name', { value: n }); return f; };
  const src = fnBody(SRC, 'function ActionSheet(', 'ActionSheet');
  const tmp = join(tmpdir(), 'hltest2-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, src + '\nexport { ActionSheet };\n');
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const key = '__hltest2_' + Math.random().toString(36).slice(2);
  globalThis[key] = {
    React,
    HL_COLORS: [{ id: 'yellow', v: '#fef3c7' }, { id: 'green', v: '#d1fae5' }],
    BottomSheet: Stub('BottomSheet'), IconBtn: Stub('IconBtn'), Icon: Stub('Icon'),
  };
  const preamble = Object.keys(globalThis[key]).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  const mod = await import('data:text/javascript;base64,' + Buffer.from(preamble + '\n' + js).toString('base64'));
  const tree = draw(mod.ActionSheet, {
    label: 'Gen 1:1-3', multi: 3, open: true,
    ctx: { _copy: () => {}, _share: () => {}, _shrink: () => {}, _extend: () => {}, highlights: {} },
    onClose: () => {}, onColor: () => {}, curColor: null,
    onNote: () => {}, onCross: () => {}, onCommentary: () => {}, bookmarked: false, hasNote: false,
  });
  const size = (n) => find(n, () => true).length;
  const hasLabel = (n) => find(n, x => (x.kids || []).some(k => k === 'Gen 1:1-3')).length > 0;
  const hasTitled = (n, t) => find(n, x => x.type === 'button' && x.props && x.props.title === t).length > 0;
  const hasClose = (n) => find(n, x => x.type && x.type.name === 'IconBtn').length > 0;
  // the SMALLEST container that holds the verse name is the top row
  const rows = find(tree, n => n.type === 'div' && hasLabel(n)).sort((a, b) => size(a) - size(b));
  const topRow = rows.find(r => hasClose(r));
  assert.ok(topRow, 'no container holds both the verse name and the close X');
  assert.ok(hasTitled(topRow, 'Remove the last verse') && hasTitled(topRow, 'Add the next verse'),
    'the - and + are not in the same row as the verse name and the close X (they have drifted back into a separate row)');
  // and nothing else holds them: the buttons sit in exactly one place
  const strip = find(tree, n => n.type === 'div' && hasTitled(n, 'Add the next verse') && !hasLabel(n) && !hasClose(n))
    .sort((a, b) => size(a) - size(b))[0];
  assert.ok(strip && find(strip, x => x.type === 'button').length === 2, 'the -/+ pair is not a two-button group');
  const swatches = find(tree, n => n.type === 'button' && n.props && n.props.style && /ighlight/.test(String(n.props['aria-label'] || '')));
  assert.equal(swatches.length, 2);
  for (const b of swatches) assert.deepEqual([b.props.style.width, b.props.style.height], [33, 33], 'highlight swatch is not 33x33');
  const clear = find(tree, n => n.type === 'button' && n.props && n.props.style && n.props.style.background === 'var(--surface-2)' && n.props.style.borderRadius === 999 && n.props.style.width === 33);
  assert.equal(clear.length, 1, 'the clear-X swatch is not 33x33');
});

// Sabotage: deletion of passageKeys is already caught — buildPassageKeys() fails at indexOf.
// No text-matching sabotage needed (CLAUDE.md rule 3).
