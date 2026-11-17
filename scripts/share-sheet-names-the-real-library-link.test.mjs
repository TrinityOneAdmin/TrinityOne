// THE SHARE-THE-APP SHEET MUST NAME THE LABEL THAT REALLY EXISTS IN THE LIBRARY.
// Run: node --test scripts/share-sheet-names-the-real-library-link.test.mjs
//
// The sheet tells the sender what their recipient will do with a Bible sent separately ("goes in with Library -> ..."). When the Library's
// big card became a quiet line (owner option A, 2026-11-17) the sheet kept naming the old card: a recipient looked for a button that was
// gone. This renders BOTH real screens (ShareAppSheet and ModuleStore, CLAUDE.md rule 3: nothing is text-matched in app/*.jsx) and pins
// the words the sheet names to the words the Library draws.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadScreen, miniReact, find, texts } from './render-jsx-screen.mjs';

const CATALOG = JSON.parse(readFileSync(new URL('../catalog.json', import.meta.url), 'utf8'));
const Stub = (n) => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };
const tick = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

function libraryLinkWords() {
  const { React, draw } = miniReact();
  const { Icon } = loadScreen('app/icons.jsx', ['Icon'], { React, window: {} });
  const win = { Bible: { subscribe: () => () => {}, getCatalog: async () => CATALOG, getMirror: async () => null, pickFile() {}, isInstalling: () => false, isInstalled: () => false,
    isLoaded: () => false, installedMap: () => ({}), versions: () => [], installModule: async () => ({}) }, TrinityData: {}, addEventListener() {}, removeEventListener() {} };
  const S = loadScreen('app/screens-library.jsx', ['ModuleStore'], { React, window: win, Icon, document: { addEventListener() {}, removeEventListener() {} },
    Overlay: ({ open, children }) => (open ? children : null), IconBtn: Stub('IconBtn'), SectionLabel: ({ children }) => React.createElement('h3', {}, children),
    Chip: Stub('Chip'), ScreenScroll: (p) => p.children, safeCssColor: (c) => c || 'var(--clay)' });
  const props = { open: true, onClose() {}, ctx: { toast() {} }, category: 'bibles', initialView: 'featured' };
  return (async () => {
    draw(S.ModuleStore, props); await tick();
    const tree = draw(S.ModuleStore, props);
    const btn = find(tree, n => n.type === 'button' && n.props && n.props['data-install-from-file'] !== undefined);
    assert.equal(btn.length, 1, 're-anchor: the Library has no install-from-file link');
    return find(btn[0], n => n.type === 'span').map(n => texts(n).join('')).join('').trim();
  })();
}

function shareSheetBold() {
  const { React, draw } = miniReact();
  const win = { Bible: { installedMap: () => ({}), subscribe: () => () => {}, versions: () => [] }, TrinityData: {}, addEventListener() {}, removeEventListener() {},
    Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android', Plugins: {} } };
  const S = loadScreen('app/share-app.jsx', ['ShareAppSheet'], { React, window: win, Icon: Stub('Icon'), btoa, fetch: async () => { throw new Error('no'); }, File, Blob,
    setTimeout: () => 0, navigator: { userAgent: 'Android' }, document: { createElement: () => ({ click() {}, remove() {} }), body: { appendChild() {} }, addEventListener() {}, removeEventListener() {} },
    BottomSheet: ({ open, children }) => (open ? children : null), IconBtn: Stub('IconBtn') });
  const tree = draw(S.ShareAppSheet, { open: true, onClose() {}, ctx: { toast() {}, openStore() {} } });
  const para = find(tree, n => n.type === 'div' && texts(n).join(' ').includes('goes in with'));
  assert.ok(para.length >= 1, 're-anchor: the share sheet no longer tells the sender where a Bible goes in');
  const bold = find(para[para.length - 1], n => n.type === 'b');
  assert.equal(bold.length, 1, 'expected exactly one bold path in the sentence');
  return texts(bold[0]).join('').trim();
}

test('SHARE — the share sheet names the Library line by the very words the Library draws, and not the old card', async () => {
  const link = await libraryLinkWords();
  const named = shareSheetBold();
  assert.ok(named.startsWith('Library'), 'the sheet names a path that does not start in the Library: ' + named);
  assert.ok(named.endsWith(link), `the sheet says "${named}" but the Library line reads "${link}"`);
  assert.doesNotMatch(named, /Install a Bible from a file/, 'the share sheet still names the old card');
});
