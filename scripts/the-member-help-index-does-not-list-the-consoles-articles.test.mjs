// A PARENT'S HELP TAB DOES NOT OFFER THE STEWARD'S DOOR PROCEDURE.
//   Run: node --test scripts/the-member-help-index-does-not-list-the-consoles-articles.test.mjs
//
// Persona sim, 2026-09-11: Dele (a parent) and Tomi (his 9-year-old, on his own account) both found
// "Children's check-in at the door" in their Help & Guides — an article written for the leader at the door,
// which tells the parent reading it that nothing about check-in appears in their app, and goes on to the
// relay's ['ck'] tag and the capability ring. The member index listed every article in help-data.jsx.
//
// Rule 1: this renders the REAL HelpIndex from app/screens-help-main.jsx (compiled, drawn through the
// miniature React) over the REAL article list, and reads what is on the screen. Rule 3: nothing here matches
// text in a .jsx file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileScreen, miniReact, find } from './render-jsx-screen.mjs';

const JS = ['app/help-illustrations.jsx', 'app/help-data.jsx', 'app/screens-help-main.jsx'].map(compileScreen).join('\n;\n');

function index() {
  const { React, draw } = miniReact();
  const win = { HelpData: null, addEventListener() {}, removeEventListener() {}, localStorage: { getItem: () => null, setItem() {} } };
  const globals = {
    React, window: win, document: { addEventListener() {}, removeEventListener() {} }, navigator: { userAgent: '' },
    localStorage: win.localStorage, setTimeout, clearTimeout, console,
    Icon: function Icon() { return null; },
    // the real HelpIllo compiles from help-illustrations.jsx; everything else HelpIndex draws is its own
  };
  const names = Object.keys(globals);
  const mod = new Function(...names, JS + '\nreturn { HelpIndex };')(...names.map(k => globals[k]));
  assert.equal(typeof mod.HelpIndex, 'function', 're-anchor: HelpIndex is not exported from screens-help-main.jsx');
  const D = win.HelpData;
  assert.ok(D && Array.isArray(D.articles) && D.articles.length > 5, 'help-data.jsx did not put its articles on window');
  const opened = [];
  const tree = draw(mod.HelpIndex, { D, fs: 1, onOpen: (id) => opened.push(id), onBackup() {}, ctx: { toast() {}, openHelp() {} } });
  // WHAT EACH BUTTON OPENS, by pressing it — not by matching titles, which put "console-scams" and the member
  // "scams" article on top of each other in this test's first draft.
  for (const b of find(tree, n => n.type === 'button' && n.props && typeof n.props.onClick === 'function')) b.props.onClick();
  const listed = [...new Set(opened)];
  return { D, listed };
}

test('the member Help index lists the member articles and NOT the console\'s own', () => {
  const { D, listed } = index();
  const consoleOnly = D.articles.filter(a => /^console-/.test(a.id)).map(a => a.id);
  assert.ok(consoleOnly.length >= 6, 're-anchor: help-data.jsx no longer has the six console-* articles: ' + consoleOnly.join(','));
  assert.ok(listed.includes('checkin-register'), 'the member article about the register is missing from the index — the filter took too much: ' + listed.join(','));
  assert.ok(listed.includes('console'), '"console" (no dash) is a shared article and must stay listed');
  const leaked = consoleOnly.filter(id => listed.includes(id));
  assert.deepEqual(leaked, [],
    'THE STEWARD\'S OWN ARTICLES ARE IN A MEMBER\'S HELP INDEX — a parent and a child can open the door procedure ' +
    'from their own Help tab: ' + leaked.join(', '));
});
