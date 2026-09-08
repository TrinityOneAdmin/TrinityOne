// THE STEWARD CONSOLE HAS IN-APP HELP, AND A STEWARD CAN REACH IT FROM THE SCREEN.
//   Run: node --test scripts/steward-help.test.mjs
//
// Until 2026-09-07 steward.html loaded none of the help files index.html loads, and the console's only
// guidance was two links out to GitHub. CLAUDE.md rule 1: the test has to fail if the feature is deleted
// FROM THE SCREEN, not only if the dialog behind it breaks. And rule 3: app/*.jsx ships unbundled, so nothing
// here matches text in a .jsx file — the console is COMPILED with the same esbuild the packaged build uses,
// the real StewDashboard is DRAWN through the miniature React in scripts/render-jsx-screen.mjs, the Help
// control is found by its accessible name, pressed, and what mounted is what is asserted.
//
// WHAT IS REAL HERE: stew-dashboard.jsx, stew-help.jsx, stew-modal.jsx (the real useStewDialog and its
// document-level Escape handler), screens-help.jsx (the real block renderer), help-data.jsx (the real
// articles) and help-illustrations.jsx — all six compiled into ONE function scope, exactly as the browser
// puts six classic scripts into one global scope. A duplicate top-level const/let/class between any two of
// them is therefore a SyntaxError in the CONTROL test. A duplicate top-level FUNCTION is not — the later one
// silently replaces the earlier, in here and in the browser, which is exactly how a blank console happens —
// so the last test scans every script steward.html loads for duplicate names of every kind. (Measured: a
// second `function Block` in stew-help.jsx passed the CONTROL and was caught by the scan and by the guide
// test, whose blocks were then rendered by the wrong Block.)
//
// MEASURED RED/GREEN, 2026-09-07 — see the commit message for the sabotage table.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileScreen, miniReact, find, texts } from './render-jsx-screen.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const SHELL = read('steward.html');

// The order steward.html loads them in — the same order the browser would evaluate them.
const FILES = ['app/help-illustrations.jsx', 'app/help-data.jsx', 'app/screens-help.jsx', 'app/stew-modal.jsx', 'app/stew-help.jsx', 'app/stew-dashboard.jsx'];
const JS = FILES.map(compileScreen).join('\n;\n');

// The names the six files take from OUTSIDE themselves (the a11y test's list for stew-dashboard.jsx, plus a
// document that records its listeners so the Escape path can be driven). A name a file needs and this list
// does not supply is a ReferenceError at the point of use — deliberately.
function consoleWith(React, over = {}) {
  const winListeners = {}, docListeners = {};
  const win = {
    useStewardChurch: () => ({ name: 'Grace Church', npub: 'npub1grace', features: {}, rules: {} }),
    useStewardIdv: () => 0,
    useStewardRelays: () => [], useStewardNetworks: () => [], useStewardRosters: () => [],
    useStewardMembers: () => [{ pubkey: 'm1' }], useStewardGroups: () => [],
    useStewardAdmitted: () => [], useStewardJoinPolicy: () => false,
    Steward: {
      isDelegated: () => false, hasKey: true, hasPinLock: () => false, whereChurchLives: () => 'community',
      relays: () => [], relayStatus: () => ({}), networks: () => [], publishProfile: () => {},
      npub: 'npub1grace', becomeStewardPayload: () => 'steward-invite-payload', qrSVG: () => '',
      joinUrl: () => 'https://app.example/join#x', inviteCode: () => 'ABC123', joinCode: () => 'ABC123',
    },
    useStewardStats: () => ({}), useStewardActivity: () => [], useStewardRequests: () => [],
    addEventListener(t, f) { (winListeners[t] = winListeners[t] || []).push(f); },
    removeEventListener(t, f) { winListeners[t] = (winListeners[t] || []).filter(x => x !== f); },
    innerWidth: 1200,
    localStorage: { getItem: () => null, setItem() {} },
    ...(over.window || {}),
  };
  const doc = {
    addEventListener(t, f) { (docListeners[t] = docListeners[t] || []).push(f); },
    removeEventListener(t, f) { docListeners[t] = (docListeners[t] || []).filter(x => x !== f); },
    activeElement: null,
  };
  const globals = {
    React, window: win, location: { hostname: 'app.example' }, navigator: { userAgent: '' },
    document: doc,
    localStorage: win.localStorage, setTimeout, clearTimeout, setInterval, clearInterval, console,
    fetch: async () => ({ ok: false, json: async () => ({}) }),
    // furniture that lives in other app files
    Icon: function Icon() { return null; },
    Halo: function Halo() { return null; },
    SkBadge: function SkBadge() { return null; },
    SkKey: function SkKey() { return null; },
    SkQR: function SkQR() { return null; },
    SK_TINT: { clay: { bg: 'var(--clay-soft)', fg: 'var(--clay-ink)' }, sage: { bg: 'var(--sage-soft)', fg: 'var(--sage-ink)' }, gold: { bg: 'var(--gold-tint)', fg: '#8a6717' }, ink: { bg: 'var(--surface-2)', fg: 'var(--ink-2)' } },
    DashMealsPanel: function DashMealsPanel() { return null; },
    DashMannaPanel: function DashMannaPanel() { return null; },
    StewVersion: function StewVersion() { return null; },
    NetworkAnnounceComposer: function NetworkAnnounceComposer() { return null; },
    ConsoleChrome: function ConsoleChrome(p) { return p.children; },   // a passthrough: the layout under test is INSIDE it
    useStewNarrow: () => false,
    churchHandle: () => 'grace',
    stewCapState: () => ({ allowed: false }),
    ...(over.globals || {}),
  };
  const names = Object.keys(globals);
  const want = ['StewDashboard', 'StewardHelp', 'StewHelpButton', 'useStewDialog'];
  const mod = new Function(...names, JS + '\nreturn { ' + want.join(', ') + ' };')(...names.map(k => globals[k]));
  for (const n of want) assert.equal(typeof mod[n], 'function', `${n} is not a function any more — re-anchor this test`);
  return { mod, win, winListeners, docListeners };
}

const fresh = (over) => { const { React, draw } = miniReact(); return { ...consoleWith(React, over), draw }; };
const helpButtons = (tree) => find(tree, n => n.type === 'button' && (n.props || {})['aria-label'] === 'Help');
const dialogs = (tree) => find(tree, n => n.props && n.props.role === 'dialog' && n.props['aria-label'] === 'Help');
const articleButtons = (tree) => find(tree, n => n.type === 'button' && (n.props || {})['data-help-id']);

// ── the premise ────────────────────────────────────────────────────────────────────────────────────────────
test('CONTROL: the six console files compile into one scope with no duplicate top-level name, and HelpData is real', () => {
  const { win, draw, mod } = fresh();
  assert.ok(Array.isArray(win.HelpData && win.HelpData.articles) && win.HelpData.articles.length > 10,
    'help-data.jsx did not put its articles on window — everything below would be asserting about nothing');
  assert.equal(typeof win.HelpBlock, 'function', 'screens-help.jsx no longer exports window.HelpBlock');
  const tree = draw(mod.StewDashboard, {});
  assert.ok(find(tree, n => n.type === 'nav').length === 1, 'the console did not draw its nav — re-anchor this test');
});

// ── the point of use ──────────────────────────────────────────────────────────────────────────────────────
for (const [what, innerWidth] of [['the desktop layout', 1200], ['the narrow (phone) layout', 500]]) {
  test(`${what} carries exactly one Help control, and pressing it mounts the guides`, () => {
    const { mod, draw, win } = fresh({ window: { innerWidth } });
    let tree = draw(mod.StewDashboard, {});
    const btns = helpButtons(tree);
    assert.equal(btns.length, 1, `${what} has ${btns.length} controls with the accessible name "Help" — it needs exactly one`);
    assert.equal(dialogs(tree).length, 0, 'the help dialog is open before anyone asked for it');
    btns[0].props.onClick();
    tree = draw(mod.StewDashboard, {});
    const dlg = dialogs(tree);
    assert.equal(dlg.length, 1, 'pressing Help mounted no dialog with role=dialog and the name "Help"');
    assert.equal(dlg[0].props['aria-modal'], 'true');
    // every guide listed is a real article from the shared data, and there are enough of them to be a help
    // page rather than a placeholder
    const ids = articleButtons(dlg[0]).map(b => b.props['data-help-id']);
    const known = new Set(win.HelpData.articles.map(a => a.id));
    assert.ok(ids.length >= 6, `only ${ids.length} guides listed: ${JSON.stringify(ids)}`);
    for (const id of ids) assert.ok(known.has(id), `the dialog lists "${id}", which is not an article in help-data.jsx`);
    for (const must of ['console', 'console-giving-records', 'console-family-safety']) assert.ok(ids.includes(must), `the "${must}" guide is missing from the console's help`);
  });
}

// ── THE CONSOLE READS ITS OWN ARTICLES, NOT THE MEMBERS' ──────────────────────────────────────────────────
// 2026-09-08. Six of the eight guides the console listed were addressed to a MEMBER; a steward read them as
// being about the CHURCH, which is a different object with different consequences. This is the point-of-use
// test for that fix: it drives the real dialog to the real list and asserts what a steward can actually
// press. Pointing STEW_HELP_IDS back at the member ids, or deleting the console articles from help-data.jsx,
// fails it — an unknown id is filtered out by stewHelpArticles(), so the guide simply vanishes from the
// screen, which is exactly the silent shape this asserts against.
//
// MEASURED RED, 2026-09-08. Three sabotages, each scoped to one anchor asserted unique before replacing:
//   1. STEW_HELP_IDS reverted to the member list ('words', 'restore', …) → 4 of 13 fail; this one reports
//      'the console does not list "console-words" — a steward cannot reach the console version of that guide'.
//   2. the whole console-words article cut out of help-data.jsx → 3 fail. The dialog still RENDERS (seven
//      guides is still >= 6), so the guide simply disappears — which is why the check is by id, not by count.
//   3. the old "same words your members can read" line put back → 1 fails, the top-line test below.
const MEMBER_ONLY = ['words', 'restore', 'steward', 'scams', 'family-safety', 'giving-records'];
const CONSOLE_OWN = ['console-words', 'console-restore', 'console-steward', 'console-scams', 'console-family-safety', 'console-giving-records'];

test('the guides a steward can press are the CONSOLE articles, and none of the member-addressed ones', () => {
  const { mod, draw, win } = fresh();
  let tree = draw(mod.StewDashboard, {});
  helpButtons(tree)[0].props.onClick();
  tree = draw(mod.StewDashboard, {});
  const ids = articleButtons(dialogs(tree)[0]).map(b => b.props['data-help-id']);
  for (const id of CONSOLE_OWN) assert.ok(ids.includes(id), `the console does not list "${id}" — a steward cannot reach the console version of that guide`);
  for (const id of MEMBER_ONLY) assert.ok(!ids.includes(id), `the console lists "${id}" — a member-addressed guide that reads as being about the church here`);
  // …and both halves of every pair really exist, so the member app kept its own copy.
  const known = new Set(win.HelpData.articles.filter(a => Array.isArray(a.blocks)).map(a => a.id));
  for (const id of MEMBER_ONLY.concat(CONSOLE_OWN)) assert.ok(known.has(id), `"${id}" is not an article with blocks in help-data.jsx`);
});

test('a console guide reaches the screen saying the church key is not a member account', () => {
  const { mod, draw, win } = fresh();
  let tree = draw(mod.StewDashboard, {});
  helpButtons(tree)[0].props.onClick();
  tree = draw(mod.StewDashboard, {});
  const btn = articleButtons(dialogs(tree)[0]).find(b => b.props['data-help-id'] === 'console-words');
  assert.ok(btn, 'the console has no "console-words" guide to open');
  btn.props.onClick();
  tree = draw(mod.StewDashboard, {});
  const said = texts(dialogs(tree)[0]).join(' ');
  const article = win.HelpData.articles.find(a => a.id === 'console-words');
  // the article's OWN words, read from the data at run time — not strings copied into this test
  for (const b of article.blocks) {
    if (b.type === 'p' || b.type === 'rule' || b.type === 'callout' || b.type === 'note') {
      assert.ok(said.includes(b.text), `a ${b.type} block of the church-key guide did not reach the dialog`);
    }
    if (b.type === 'steps') for (const it of b.items) assert.ok(said.includes(it), `step "${it}" did not reach the dialog`);
  }
});

// The top line sat above the list promising "the same words your members can read in their app". Six of the
// eight are no longer those words, and a reassurance that is false is worse than none.
test('the line above the list does not promise words the console no longer shows', () => {
  const { mod, draw } = fresh();
  let tree = draw(mod.StewDashboard, {});
  helpButtons(tree)[0].props.onClick();
  tree = draw(mod.StewDashboard, {});
  const said = texts(dialogs(tree)[0]).join(' ');
  assert.ok(!/same words your members can read/i.test(said),
    'the console still tells a steward these are the same words their members read — six of the eight are not');
  assert.ok(/Short guides to running your church/i.test(said), 'the list lost its introduction entirely');
});

test('every id the console asks for resolves to an article — a typo would otherwise be a silently shorter list', () => {
  const src = read('app/stew-help.jsx');
  // The list is read from the shipped file and checked against the shipped data. This is not a behaviour
  // claim about the jsx (rule 3); it is the data contract between two files, checked from the data side.
  const m = src.match(/STEW_HELP_IDS\s*=\s*\[([^\]]*)\]/);
  assert.ok(m, 'STEW_HELP_IDS is no longer a literal array in app/stew-help.jsx — re-anchor this test');
  const asked = [...m[1].matchAll(/'([a-z-]+)'/g)].map(x => x[1]);
  const { win } = fresh();
  const known = new Set(win.HelpData.articles.filter(a => Array.isArray(a.blocks)).map(a => a.id));
  for (const id of asked) assert.ok(known.has(id), `stew-help.jsx asks for "${id}", which has no article (with blocks) in help-data.jsx`);
  assert.ok(asked.length >= 6, `only ${asked.length} ids asked for`);
});

test('opening a guide renders its body through the shared block renderer', () => {
  const { mod, draw, win } = fresh();
  let tree = draw(mod.StewDashboard, {});
  helpButtons(tree)[0].props.onClick();
  tree = draw(mod.StewDashboard, {});
  const consoleBtn = articleButtons(dialogs(tree)[0]).find(b => b.props['data-help-id'] === 'console');
  consoleBtn.props.onClick();
  tree = draw(mod.StewDashboard, {});
  const dlg = dialogs(tree)[0];
  const article = win.HelpData.articles.find(a => a.id === 'console');
  const said = texts(dlg).join(' ');
  // the article's OWN words, read from the data at run time — not a string copied into this test
  for (const b of article.blocks) {
    if (b.type === 'p') assert.ok(said.includes(b.text), 'a paragraph of the console guide did not reach the dialog');
    if (b.type === 'list') for (const it of b.items) assert.ok(said.includes(it.lead) && said.includes(it.text), `list item "${it.lead}" did not reach the dialog`);
  }
  assert.equal(articleButtons(dlg).length, 0, 'the list of guides is still showing behind the open guide');
  // and Back returns to the list
  const back = find(dlg, n => n.type === 'button' && n.props['aria-label'] === 'Back to all guides');
  assert.equal(back.length, 1, 'an open guide has no "Back to all guides" control');
  back[0].props.onClick();
  tree = draw(mod.StewDashboard, {});
  assert.ok(articleButtons(dialogs(tree)[0]).length >= 6, 'Back did not return to the list of guides');
});

// ── ways out ──────────────────────────────────────────────────────────────────────────────────────────────
test('Escape closes it (the real useStewDialog, through the real document-level handler)', () => {
  const { mod, draw, docListeners } = fresh();
  let tree = draw(mod.StewDashboard, {});
  helpButtons(tree)[0].props.onClick();
  tree = draw(mod.StewDashboard, {});
  assert.equal(dialogs(tree).length, 1);
  const keydown = docListeners.keydown || [];
  assert.ok(keydown.length >= 1, 'stew-modal.jsx registered no document keydown handler');
  keydown.forEach(f => f({ key: 'Escape', isComposing: false, preventDefault() {} }));
  tree = draw(mod.StewDashboard, {});
  assert.equal(dialogs(tree).length, 0, 'Escape did not close the help dialog');
});

// (Whether the listener is REMOVED afterwards is not asserted: the miniature React has no unmount, so effect
// cleanups never run here. The real page is the only place that can be checked — app-boots.test.mjs.)
test('the phone back button (popstate) closes it', () => {
  const { mod, draw, winListeners } = fresh({ window: { innerWidth: 500 } });
  let tree = draw(mod.StewDashboard, {});
  const before = (winListeners.popstate || []).length;
  helpButtons(tree)[0].props.onClick();
  tree = draw(mod.StewDashboard, {});
  assert.equal(dialogs(tree).length, 1);
  const added = (winListeners.popstate || []).slice(before);
  assert.equal(added.length, 1, `opening help registered ${added.length} popstate listeners, expected 1`);
  added[0]();
  tree = draw(mod.StewDashboard, {});
  assert.equal(dialogs(tree).length, 0, 'popstate did not close the help dialog');
});

test('the Close control and the backdrop both close it', () => {
  for (const pick of ['close', 'backdrop']) {
    const { mod, draw } = fresh();
    let tree = draw(mod.StewDashboard, {});
    helpButtons(tree)[0].props.onClick();
    tree = draw(mod.StewDashboard, {});
    const dlg = dialogs(tree)[0];
    if (pick === 'close') {
      const x = find(dlg, n => n.type === 'button' && n.props['aria-label'] === 'Close help');
      assert.equal(x.length, 1, 'no "Close help" control');
      x[0].props.onClick();
    } else {
      // the dialog's parent is the dimmed backdrop; clicking it closes, clicking the panel does not bubble
      const backdrop = find(tree, n => n.type === 'div' && (n.kids || []).some(k => k && k.props && k.props.role === 'dialog'));
      assert.equal(backdrop.length, 1, 'the dialog has no backdrop');
      let stopped = false;
      dlg.props.onClick({ stopPropagation() { stopped = true; } });
      assert.ok(stopped, 'a click inside the panel bubbles to the backdrop and would close the dialog');
      backdrop[0].props.onClick();
    }
    tree = draw(mod.StewDashboard, {});
    assert.equal(dialogs(tree).length, 0, `${pick} did not close the help dialog`);
  }
});

// ── the shell, and the global scope ───────────────────────────────────────────────────────────────────────
// A text match on steward.html is allowed (rule 3 is about app/*.jsx). The packaged steward APK derives its
// file list from these tags (scripts/build-steward-apk.sh), so the tags ARE the deployment.
test('steward.html loads the shared help data + renderer and the console help, in dependency order, and NOT screens-help-main', () => {
  const tags = [...SHELL.matchAll(/<script[^>]*src="([^"]+)"/g)].map(m => m[1]);
  const at = (f) => tags.indexOf(f);
  for (const f of ['app/icons.jsx', 'app/help-illustrations.jsx', 'app/help-data.jsx', 'app/screens-help.jsx', 'app/stew-modal.jsx', 'app/stew-help.jsx', 'app/stew-dashboard.jsx']) {
    assert.ok(at(f) >= 0, `steward.html does not load ${f}`);
  }
  assert.ok(at('app/icons.jsx') < at('app/screens-help.jsx'), 'screens-help.jsx uses Icon/Halo: icons.jsx must load first');
  assert.ok(at('app/help-data.jsx') < at('app/stew-help.jsx') && at('app/screens-help.jsx') < at('app/stew-help.jsx') && at('app/help-illustrations.jsx') < at('app/stew-help.jsx'),
    'stew-help.jsx must load after the three shared help files');
  assert.ok(at('app/stew-modal.jsx') < at('app/stew-help.jsx'), 'stew-help.jsx uses useStewDialog: stew-modal.jsx must load first');
  assert.equal(at('app/screens-help-main.jsx'), -1,
    'screens-help-main.jsx must NOT load in the console: its BackupWalkthrough reads window.TrinityIdentity, which the console does not have');
  assert.ok(/^app\/stew-[a-z-]+\.jsx$/.test('app/stew-help.jsx'), 'the console help file must be named stew-*.jsx (sync-web.sh strips stew-* from the member build)');
});

// The console is classic scripts in ONE global scope: a duplicate top-level name in any two of them is a
// SyntaxError that blanks the whole app. Every app/*.jsx steward.html loads, scanned for its top-level
// declarations. (The CONTROL test above proves it for six of them by actually evaluating them together;
// this covers the rest by inspection.)
test('no two scripts steward.html loads declare the same top-level name', () => {
  const files = [...SHELL.matchAll(/<script[^>]*src="(app\/[^"]+\.jsx)"/g)].map(m => m[1]);
  assert.ok(files.length >= 15, `only ${files.length} app scripts found in steward.html — re-anchor this test`);
  const owner = new Map(); const dups = [];
  for (const f of files) {
    const src = read(f);
    const names = new Set();
    for (const m of src.matchAll(/^(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
    for (const m of src.matchAll(/^(?:const|let|var)\s*\{([^}]*)\}\s*=/gm)) {
      for (const part of m[1].split(',')) { const n = part.split(':').pop().trim().split('=')[0].trim(); if (n) names.add(n); }
    }
    for (const n of names) { if (owner.has(n)) dups.push(`${n}: ${owner.get(n)} and ${f}`); else owner.set(n, f); }
  }
  assert.deepEqual(dups, [], 'duplicate top-level names across the console’s scripts:\n  ' + dups.join('\n  '));
});
