// THE CONSOLE'S VERSE PROMPT PAGE OPENS WHEN MORE THAN ONE BIBLE IS INSTALLED, AND ITS TRANSLATION PICKER WORKS.
// Run: node --test scripts/the-verse-prompt-translation-picker-opens.test.mjs
//
// Owner-reported crash (2026-11-18): Overview -> Verse prompt -> the whole screen died with "Minified React error #31:
// object with keys {abbr, name, kind}" (component stack option -> select -> ... -> DashVersePrompt). window.Bible.versions()
// (engine.js) returns [{abbr,name,kind}], and the TRANSLATION <select> rendered each entry as if it were a string:
// <option key={v} value={v}>{v}</option>. The select only appears when 2+ Bibles are installed, so a console on a
// browser with one Bible never saw it.
//
// POINT OF USE (rule 1): the real DashVersePrompt is compiled out of app/stew-dashboard.jsx and rendered with two Bibles
// loaded. The miniature React in render-jsx-screen.mjs does not itself refuse an object child the way react-dom does, so
// `reactWouldRefuse` below applies react-dom's rule (#31: a child must be a string, number, boolean, null or an element)
// to the rendered tree. Rule 3: nothing here matches text in app/*.jsx.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compiled, common, find, reads, said } from './dash-render-kit.mjs';

// react-dom's child rule: anything that is an object but not an element (and not an array) is error #31.
function reactWouldRefuse(n, path = 'root') {
  if (n == null || typeof n === 'boolean' || typeof n === 'string' || typeof n === 'number') return null;
  if (Array.isArray(n)) { for (let i = 0; i < n.length; i++) { const r = reactWouldRefuse(n[i], path + '[' + i + ']'); if (r) return r; } return null; }
  if (typeof n === 'object' && 'type' in n) {
    for (let i = 0; i < (n.kids || []).length; i++) { const r = reactWouldRefuse(n.kids[i], path + '>' + (typeof n.type === 'function' ? (n.type.name || 'C') : n.type) + '[' + i + ']'); if (r) return r; }
    return null;
  }
  return 'Objects are not valid as a React child (#31) at ' + path + ': keys {' + Object.keys(n).join(', ') + '}';
}

const VERSIONS = [
  { abbr: 'BSB', name: 'Berean Standard Bible', kind: 'usfm' },
  { abbr: 'KJV', name: 'King James Version', kind: 'mysword' },
  { abbr: 'WEB', name: 'World English Bible', kind: 'usfm' },
];

async function rig(versions) {
  const asked = [];
  const bible = {
    loaded: true, activeVersion: 'BSB',
    subscribe: () => () => {},
    versions: () => versions.map(v => ({ ...v })),
    parseRef: (ref) => { const m = String(ref).match(/^(.+?) (\d+)(?::(\d+))?/); return m ? { book: m[1], chap: Number(m[2]), verse: m[3] || null } : null; },
    books: () => ['John'],
    getVerses: (b, c, ver) => { asked.push(ver); return [{ v: 16, text: 'For God so loved the world (' + ver + ')' }]; },
  };
  const steward = {
    publishVersePrompt: () => Promise.resolve({}), removeVersePrompt: () => Promise.resolve(),
    subscribeVersePrompt: (cb) => { cb({ ref: 'John 3:16', note: '', schedule: [], ts: 1 }); return () => {}; },
  };
  const g = { ...common(), VP_BOOKS: [['John', 21]], window: { Steward: steward, Bible: bible } };
  const { C, draw } = await compiled('DashVersePrompt', g);
  return { C, draw, asked };
}
const picker = (tree) => find(tree, n => n.type === 'select' && n.props && n.props['aria-label'] === 'Translation')[0];

test('with three Bibles installed the Verse prompt page renders, and its translation picker lists each one by abbreviation', async () => {
  const r = await rig(VERSIONS);
  r.draw(r.C, {});
  const tree = r.draw(r.C, {});
  assert.equal(reactWouldRefuse(tree), null, 'THE CRASH: react-dom would refuse this screen');
  const sel = picker(tree);
  assert.ok(sel, 'no Translation picker with three Bibles installed');
  const opts = find(sel, n => n.type === 'option');
  assert.deepEqual(opts.map(o => o.props.value), ['BSB', 'KJV', 'WEB'], 'option values must be the version abbreviations');
  assert.deepEqual(opts.map(o => said(o)), ['BSB', 'KJV', 'WEB'], 'option labels');
  assert.equal(sel.props.value, 'BSB', 'the picker starts on the active Bible, and that value is one of its options');
});

test('choosing another translation in the picker changes the preview to that Bible', async () => {
  const r = await rig(VERSIONS);
  r.draw(r.C, {});
  let tree = r.draw(r.C, {});
  assert.match(reads(tree), /John 3:16 · BSB/);
  picker(tree).props.onChange({ target: { value: 'KJV' } });
  r.asked.length = 0;
  tree = r.draw(r.C, {});
  assert.equal(reactWouldRefuse(tree), null);
  assert.equal(picker(tree).props.value, 'KJV');
  assert.match(reads(tree), /John 3:16 · KJV/, 'preview label did not follow the picker');
  assert.match(reads(tree), /For God so loved the world \(KJV\)/, 'preview text was not read from the chosen Bible');
  assert.ok(r.asked.length && r.asked.every(v => v === 'KJV'), 'getVerses asked for ' + JSON.stringify(r.asked));
});

test('with one Bible installed there is no picker and the page still renders', async () => {
  const r = await rig(VERSIONS.slice(0, 1));
  r.draw(r.C, {});
  const tree = r.draw(r.C, {});
  assert.equal(reactWouldRefuse(tree), null);
  assert.equal(picker(tree), undefined);
  assert.match(reads(tree), /John 3:16 · BSB/);
});
