// THE "CREATE A READING PLAN" DIALOG HAS A BOOK / CHAPTER / VERSE PICKER.
//   Run: node --test scripts/reading-plan-picker.test.mjs
//
// e9e1ba5 (2026-10-07 10:45) added the picker; de4b9a7 (11:57, "recover stashed work") replaced the whole
// NewPlanModal with an older stash copy and silently deleted it, and no test noticed because none rendered
// the dialog. This renders the REAL NewPlanModal (sliced out of app/stew-dashboard.jsx, compiled by esbuild,
// drawn through scripts/render-jsx-screen.mjs) and drives it the way a steward does: choose Book, Chapter,
// verses, press Add, press Publish, and read what was handed to Steward.publishPlan. CLAUDE.md rules 1 and 3.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { miniReact, find, texts } from './render-jsx-screen.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const SRC = readFileSync(join(ROOT, 'app/stew-dashboard.jsx'), 'utf8');

async function load() {
  const m0 = SRC.indexOf('\nfunction NewPlanModal(');
  assert.ok(m0 > 0 && SRC.indexOf('\nfunction NewPlanModal(', m0 + 1) < 0, 're-anchor: NewPlanModal');
  // up to the next top-level declaration (fnBody's brace matcher trips on the regex literals in the JSX)
  const modal = SRC.slice(m0, SRC.indexOf('\nvar VP_BOOKS', m0));
  const at = SRC.indexOf('var VP_BOOKS = [');
  assert.ok(at > 0, 're-anchor: VP_BOOKS');
  const books = SRC.slice(at, SRC.indexOf('\nfunction DashVersePrompt', at));   // VP_BOOKS + its VP_BOOKS.verses table
  const tmp = join(tmpdir(), 'planpick-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, books + '\n' + modal + '\nexport { NewPlanModal };\n');
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const { React, draw } = miniReact();
  const published = [];
  class FR { readAsText(f) { this.result = f.text; this.onload(); } }
  const globals = {
    React, Icon: function Icon() { return null; }, useStewDialog: () => ({ current: null }), FileReader: FR,
    window: { Steward: { publishPlan: (p) => published.push(p) } },
  };
  const key = '__planpick_' + Math.random().toString(36).slice(2);
  globalThis[key] = globals;
  const pre = Object.keys(globals).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  const { NewPlanModal } = await import('data:text/javascript;base64,' + Buffer.from(pre + '\n' + js).toString('base64'));
  let closed = 0;
  const props = { onClose() { closed++; } };
  let tree = draw(NewPlanModal, props);
  const redraw = () => { tree = draw(NewPlanModal, props); };
  const byLabel = (l) => find(tree, n => n.props && n.props['aria-label'] === l)[0];
  const btn = (label) => find(tree, n => n.type === 'button' && texts(n).join(' ').includes(label) || (n.type === 'button' && n.props['aria-label'] === label))[0];
  const act = (fn) => { fn(); redraw(); };
  const set = (l, v) => act(() => byLabel(l).props.onChange({ target: { value: v } }));
  const click = (label) => act(() => btn(label).props.onClick());
  const options = (l) => find(byLabel(l), n => n.type === 'option').map(o => o.props.value);
  const nameIt = (v) => act(() => find(tree, n => n.type === 'input' && n.props.placeholder && n.props.placeholder.includes('Advent'))[0].props.onChange({ target: { value: v } }));
  return { published, set, click, byLabel, options, btn, act, nameIt, find: (p) => find(tree, p), get closed() { return closed; } };
}

test('picking John 3:16-21 and pressing Add then Publish hands that reading to publishPlan', async () => {
  const s = await load();
  s.click('Pick verses');
  assert.ok(s.options('Book').includes('John') && s.options('Book').length === 67, 'Book offers all 66 books (+ the empty prompt)');
  s.set('Book', 'John');
  assert.equal(s.options('Chapter').length, 22, 'John has 21 chapters (+ the empty prompt)');
  s.set('Chapter', '3');
  s.set('From verse', '16');
  s.set('To verse', '21');
  s.click('Add');
  s.set('Book', 'Psalms'); s.set('Chapter', '23'); s.click('Add');
  s.nameIt('Easter');
  s.click('Publish now');
  assert.equal(s.published.length, 1);
  assert.deepEqual(s.published[0].days.map(d => d.ref), ['John 3:16-21', 'Psalms 23']);
  assert.deepEqual(s.published[0].days.map(d => d.d), [1, 2]);
  assert.equal(s.published[0].sub, '2 days');
  assert.equal(s.closed, 1);
});

test('x removes a picked reading, and nothing is published while none are picked', async () => {
  const s = await load();
  s.click('Pick verses');
  for (const [b, c] of [['John', '1'], ['Mark', '2']]) { s.set('Book', b); s.set('Chapter', c); s.click('Add'); }
  s.set('Book', 'Luke'); s.set('Chapter', '4'); s.set('From verse', '1'); s.click('Add');
  s.click('Remove John 1');
  s.nameIt('P');
  s.click('Publish now');
  assert.deepEqual(s.published[0].days.map(d => d.ref), ['Mark 2', 'Luke 4:1']);
  const e = await load();
  e.click('Pick verses');
  e.nameIt('P');
  e.click('Publish now');
  assert.equal(e.published.length, 0, 'nothing picked: nothing published');
});

test('"Type it" still turns one line per day into readings', async () => {
  const s = await load();
  s.act(() => s.find(n => n.type === 'textarea')[0].props.onChange({ target: { value: 'John 1\n\nIsaiah 53' } }));
  s.nameIt('T');
  s.click('Publish now');
  assert.deepEqual(s.published[0].days.map(d => d.ref), ['John 1', 'Isaiah 53']);
});

test('"Upload file" still reads a file into readings', async () => {
  const s = await load();
  s.click('Upload file');
  const inp = s.find(n => n.type === 'input' && n.props.type === 'file')[0];
  s.act(() => inp.props.onChange({ target: { files: [{ name: 'plan.txt', text: 'Genesis 1\nGenesis 2' }], value: 'x' } }));
  s.click('Publish now');
  assert.deepEqual(s.published[0].days.map(d => d.ref), ['Genesis 1', 'Genesis 2']);
});

// ---- the verse dropdowns (owner feedback 2026-10-11: "a list, not an input for the verse numbers") ----
test('From/To verse are dropdowns listing only verses that exist; John 3, 16 to 21 publishes "John 3:16-21"', async () => {
  const s = await load();
  s.click('Pick verses');
  s.set('Book', 'John'); s.set('Chapter', '3');
  assert.equal(s.byLabel('From verse').type, 'select', 'From verse is a <select>, not a typed input');
  assert.deepEqual(s.options('From verse'), ['', ...Array.from({ length: 36 }, (_, i) => String(i + 1))], 'Whole chapter + exactly 1..36');
  assert.equal(s.find(n => n.type === 'input' && n.props['aria-label'] === 'From verse').length, 0);
  s.set('From verse', '16');
  assert.equal(s.byLabel('To verse').type, 'select');
  assert.deepEqual(s.options('To verse'), ['', ...Array.from({ length: 21 }, (_, i) => String(i + 16))], 'dash + 16..36 only');
  s.set('To verse', '21');
  s.click('Add'); s.nameIt('X'); s.click('Publish now');
  assert.deepEqual(s.published[0].days.map(d => d.ref), ['John 3:16-21']);
});

test('changing Book or Chapter resets From and To', async () => {
  const s = await load();
  s.click('Pick verses');
  s.set('Book', 'John'); s.set('Chapter', '3'); s.set('From verse', '16'); s.set('To verse', '21');
  s.set('Chapter', '1');
  assert.equal(s.find(n => n.type === 'select' && n.props['aria-label'] === 'From verse')[0].props.value, '');
  assert.equal(s.find(n => n.props && n.props['aria-label'] === 'To verse').length, 0, 'To hides until a From is chosen');
  s.set('From verse', '5'); s.set('Book', 'Psalms'); s.set('Chapter', '117');
  assert.equal(s.byLabel('From verse').props.value, '');
  assert.deepEqual(s.options('From verse'), ['', '1', '2'], 'Psalm 117 has two verses');
});

test('VP_BOOKS.verses is the KJV table: 66 books, VP_BOOKS chapter counts, 1189 chapters, 31102 verses', () => {
  const at = SRC.indexOf('var VP_BOOKS = [');
  const code = SRC.slice(at, SRC.indexOf('\nfunction DashVersePrompt', at));
  const VP = new Function(code + '\nreturn VP_BOOKS;')();
  assert.equal(VP.length, 66);
  assert.equal(VP.verses.length, 66);
  const t = VP.verses.map(x => x.split(',').map(Number));
  VP.forEach((b, i) => assert.equal(t[i].length, b[1], b[0] + ' chapter count'));
  assert.equal(t.reduce((a, c) => a + c.length, 0), 1189);
  assert.equal(t.flat().reduce((a, c) => a + c, 0), 31102);
  assert.ok(t.flat().every(n => n >= 1));
  const v = (book, ch) => t[VP.findIndex(b => b[0] === book)][ch - 1];
  for (const [b, c, n] of [['Genesis', 1, 31], ['Psalms', 119, 176], ['Psalms', 117, 2], ['John', 3, 36], ['3 John', 1, 14], ['Malachi', 4, 6], ['Revelation', 22, 21]])
    assert.equal(v(b, c), n, b + ' ' + c);
});

// ---- each Add makes ONE day, and the dialog says which (owner 2026-10-12: "not clear that selecting the book again will create another listing") ----
test('the picker row names the day the next Add creates, and the button says "Add day N"', async () => {
  const s = await load();
  s.click('Pick verses');
  const dayLabel = () => s.find(n => n.props && n.props['data-testid'] === 'rp-day-label').map(n => n.kids.join('')).join('');
  assert.equal(dayLabel(), 'Day 1');
  s.set('Book', 'John'); s.set('Chapter', '1');
  assert.ok(s.btn('Add day 1'), 'button reads "Add day 1" before the first Add');
  assert.match(s.btn('Add day 1').props['aria-label'], /Add John 1 as day 1/);
  s.click('Add day 1');
  assert.equal(dayLabel(), 'Day 2', 'the picker row still says Day 1 after an Add');
  assert.equal(s.find(n => n.type === 'span' && n.kids.join('') === 'John 1').length, 1, 'the day added is listed');
  s.set('Book', 'Mark'); s.set('Chapter', '2');
  assert.ok(s.btn('Add day 2'), 'button reads "Add day 2" after one Add');
  s.click('Add day 2');
  assert.equal(dayLabel(), 'Day 3');
  s.nameIt('X'); s.click('Publish now');
  assert.deepEqual(s.published[0].days.map(d => [d.d, d.ref]), [[1, 'John 1'], [2, 'Mark 2']], 'what is published is unchanged');
});
