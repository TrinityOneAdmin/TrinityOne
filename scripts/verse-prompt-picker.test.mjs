// THE CONSOLE'S "VERSE PROMPT" PICKS FROM A LIST OF VERSES, AND ITS CARDS ARE FULL WIDTH.
//   Run: node --test scripts/verse-prompt-picker.test.mjs
//
// DashVersePrompt (app/stew-dashboard.jsx) took From/To as typed digits (<input type=number>) from its first
// commit e9e1ba5; 1037f08 gave only the reading-plan dialog the list-of-real-verses dropdowns, so the owner saw
// the Verse prompt "revert" to a digit box. This renders the REAL DashVersePrompt through scripts/render-jsx-screen.mjs
// (CLAUDE.md rules 1 and 3) and reads what a steward is given. Width is layout and the harness has none: it can only
// read the style VALUE, so whether the card really fills the APK needs a device look.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { miniReact, find, texts } from './render-jsx-screen.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const SRC = readFileSync(join(ROOT, 'app/stew-dashboard.jsx'), 'utf8');

async function load(src = SRC) {
  const at = src.indexOf('var VP_BOOKS = [');
  const end = src.indexOf('\nwindow.DashVersePrompt =', at);
  assert.ok(at > 0 && end > at, 're-anchor: VP_BOOKS .. DashVersePrompt');
  const tmp = join(tmpdir(), 'vpick-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, src.slice(at, end) + '\nexport { DashVersePrompt };\n');
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const { React, draw } = miniReact();
  const Panel = ({ title, style, children }) => React.createElement('section', { 'data-panel': title, style }, children);
  const globals = {
    React, Panel, Icon: () => null,
    window: {
      Steward: { subscribeVersePrompt: () => () => {}, publishVersePrompt: async () => ({}), removeVersePrompt: async () => {} },
      Bible: undefined,
    },
  };
  const key = '__vpick_' + Math.random().toString(36).slice(2);
  globalThis[key] = globals;
  const pre = Object.keys(globals).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  const { DashVersePrompt } = await import('data:text/javascript;base64,' + Buffer.from(pre + '\n' + js).toString('base64'));
  let tree = draw(DashVersePrompt, {});
  const by = (l) => find(tree, n => n.props && n.props['aria-label'] === l)[0];
  const set = (l, v) => { by(l).props.onChange({ target: { value: v } }); tree = draw(DashVersePrompt, {}); };
  return { set, by, get tree() { return tree; }, find: (p) => find(tree, p) };
}

test('From / To verse are dropdowns listing only the verses that exist, not digit boxes', async () => {
  const s = await load();
  s.set('Book', 'John'); s.set('Chapter', '3');
  const from = s.by('From verse');
  assert.equal(from.type, 'select', 'From verse must be a list to choose from');
  assert.equal(s.find(n => n.type === 'input' && n.props.type === 'number').length, 0, 'no numeric digit input anywhere');
  const vals = (n) => find(n, o => o.type === 'option').map(o => o.props.value);
  const fromVals = vals(from);
  assert.deepEqual(fromVals.slice(0, 3), ['', '1', '2']);
  assert.equal(fromVals.at(-1), '36', 'John 3 has 36 verses');
  s.set('From verse', '16');
  const toVals = vals(s.by('To verse (optional)'));
  assert.equal(s.by('To verse (optional)').type, 'select');
  assert.deepEqual([toVals[1], toVals.at(-1)], ['16', '36'], 'To lists 16..36 only');
});

test('picking John 3:16 to 21 assembles the reference the church receives', async () => {
  const s = await load();
  s.set('Book', 'John'); s.set('Chapter', '3'); s.set('From verse', '16'); s.set('To verse (optional)', '21');
  assert.ok(s.find(n => texts(n).join('').trim() === 'John 3:16-21').length > 0, 'assembled passage shown');
  s.set('Chapter', '2');   // changing the chapter must clear the verses
  assert.equal(s.by('From verse').props.value, '');
});

test('the Add-a-passage card spans the full width of the page', async () => {
  const s = await load();
  const panel = s.find(n => n.props && n.props['data-panel'] === 'Add a passage')[0];
  assert.equal(panel.props.style.width, '100%');
  assert.equal(panel.props.style.maxWidth, undefined, 'no half-width cap');
});
