// THE DESKTOP FINANCE PROGRAM, AS SHIPPED, IS FOR HELPERS ONLY — AND ITS WINDOW GOES NOWHERE BUT ITS OWN ORIGIN.
// Run: node --test scripts/finance-desktop-is-helpers-only.test.mjs
//
// T1Finance desktop plan §5 test 6 (+ §8 MED: hide the 12-words Copy in the desktop build).
//
// PART 1 runs the BUNDLED, TRANSPILED files — what the program ships, built here by the real
// scripts/build-finance-desktop.sh — not app/*.jsx. Its page's own script list (app/*.js, in order) is loaded into one
// scope through console-screens.mjs with the bundle's own desktop-build.js and finance-mode.js run first, exactly as
// the page runs them, and the real screens are RENDERED (nothing is matched as text). window.Steward is the harness
// stand-in, with packagedOrigin answering as the real one does at each origin (the real one is proved at those
// origins by scripts/a-packaged-app-talks-only-to-the-shared-relays.test.mjs and, booted, by
// scripts/finance-desktop-boots-at-its-packaged-origin.test.mjs).
//   · a church key / an undelegated key → "Not linked to a church yet", never the books;
//   · ?adopt= (a church hand-over link) is ignored;
//   · the 12 words can be SHOWN but have NO Copy button in the desktop program (packaged origin, not Capacitor):
//     a desktop clipboard is kept in history and can sync to the cloud. CONTROLS: the web finance page and the
//     Android finance app (Capacitor) still offer Copy.
// PART 2 compiles src/nav.rs with plain rustc and runs its tests (the navigation / browser allow-list / download
// rules). Skips if no rustc. `cargo test` in the crate runs the same tests plus main.rs's url-parse cases.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConsole, fakeReact, fakeBrowser, fakeSteward, nodes, texts } from './console-screens.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const CHURCH = 'cc'.repeat(32);
const ME = 'dd'.repeat(32);
const WORDS = 'abandon ability able about above absent absorb abstract absurd abuse access accident';
const say = (tree) => texts(tree).join(' ').replace(/\s+/g, ' ');

const dirs = [];
after(() => dirs.forEach((d) => { try { rmSync(d, { recursive: true, force: true }); } catch {} }));
const T = mkdtempSync(join(tmpdir(), 'trin-fdhelp-')); dirs.push(T);
const OUT = join(T, 'dist');
const built = spawnSync('bash', ['scripts/build-finance-desktop.sh', OUT], { cwd: ROOT, encoding: 'utf8' });
const HTML = built.status === 0 ? readFileSync(join(OUT, 'index.html'), 'utf8') : '';
const scriptsOf = (re) => [...HTML.matchAll(re)].map((m) => pathToFileURL(join(OUT, m[1])).href);
const APP = scriptsOf(/<script src="(app\/[^"]+\.js)"><\/script>/g);
const PLAIN = scriptsOf(/<script src="((?:desktop-build|finance-mode)\.js)"><\/script>/g);

// origin = 'desktop' (Tauri: packaged, no Capacitor) | 'apk' (Capacitor native) | 'web' (finance.html in a browser)
function load({ origin = 'desktop', steward = {}, search = '', href, expr }) {
  const fr = fakeReact();
  const Steward = fakeSteward({ hasKey: true, locked: false, needsPin: false, pendingStewardRequest: () => null, removedNotices: () => [],
    selfRegister: () => Promise.resolve(true), packagedOrigin: () => origin !== 'web', ...steward });
  const { window } = fakeBrowser({ Steward });
  window.location.search = search;
  if (href) window.location.href = href;
  if (origin === 'apk') window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android', Plugins: {} };
  const mods = loadConsole({ React: fr.React, window, expr, files: APP, vendor: PLAIN });
  return { fr, window, mods, Steward };
}

test('the real build ran, and the bundle\'s script list is the transpiled one (no .jsx), stamped as the desktop program', () => {
  assert.equal(built.status, 0, (built.stderr || '').slice(-600));
  assert.ok(APP.length >= 15, 'only ' + APP.length + ' app scripts in the bundled page');
  assert.ok(APP.some((u) => u.endsWith('/app/finance-shell.js')) && APP.some((u) => u.endsWith('/app/steward-root.js')));
  assert.deepEqual(PLAIN.map((u) => u.split('/').pop()), ['desktop-build.js', 'finance-mode.js']);
  const { window } = load({ expr: '1' });
  assert.equal(window.TRINITY_APP, 'finance');
  assert.equal(window.TRINITY_BUILD.app, 'finance-desktop');
});

test('a church key, or any key not acting for a church → "Not linked to a church yet", never the books', () => {
  for (const steward of [{ actingChurch: '', pubkey: ME, isDelegated: () => false, myStewardCaps: () => null }, { actingChurch: '', isDelegated: () => false }]) {
    const { fr, mods } = load({ steward, expr: '{ FinanceShell: window.FinanceShell, DashFinance, FinanceUnlinked }' });
    fr.reset(); const tree = mods.FinanceShell(); fr.flush();
    const all = nodes(tree);
    assert.ok(!all.some((n) => n.type === mods.DashFinance), 'the bundled program opened the books for a key not acting for a church');
    assert.ok(all.some((n) => n.type === mods.FinanceUnlinked), 'no "not linked" screen in the bundled program');
    fr.fresh(); assert.match(say(mods.FinanceUnlinked()), /Not linked to a church yet/);
  }
  // CONTROL: a delegated finance helper does get the books, so the refusal above is the gate
  const { fr, mods } = load({ steward: { actingChurch: CHURCH, pubkey: CHURCH, isDelegated: () => true, myStewardCaps: () => ['finance'] }, expr: '{ FinanceShell: window.FinanceShell, DashFinance }' });
  fr.reset(); const tree = mods.FinanceShell(); fr.flush();
  assert.ok(nodes(tree).some((n) => n.type === mods.DashFinance), 'CONTROL: a delegated finance helper did not get the books');
});

test('?adopt= (a church hand-over link) is ignored by the bundled program', () => {
  const adopted = [];
  load({ search: '?adopt=word%20word', href: 'tauri://localhost/index.html?adopt=word%20word',
    steward: { hasKey: false, adoptChurch: (p) => { adopted.push(p); }, init() {} }, expr: '1' });
  assert.deepEqual(adopted, [], 'the desktop program adopted a CHURCH key from a link');
});

// FinanceSettings with the words revealed: render, press "Show my 12 words", render again
function settings(origin) {
  const { fr, mods } = load({ origin, steward: { isDelegated: () => true, ownKeyBlank: () => true, exportMnemonic: () => WORDS, hasPinLock: () => true },
    expr: '{ FinanceSettings: (typeof FinanceSettings === "function" ? FinanceSettings : null) }' });
  assert.equal(typeof mods.FinanceSettings, 'function', 're-anchor: FinanceSettings is not a top-level function in the bundled finance-shell.js');
  const props = { onClose() {} };
  fr.reset(); let tree = mods.FinanceSettings(props); fr.flush();
  const show = nodes(tree).find((n) => n.type === 'button' && /Show my 12 words/.test(texts(n).join(' ')));
  assert.ok(show, origin + ': no "Show my 12 words" for a delegated helper with a blank own key — the reveal path is gone, so nothing below is tested');
  show.props.onClick();
  fr.reset(); tree = mods.FinanceSettings(props); fr.flush();
  assert.match(say(tree), new RegExp(WORDS.split(' ').slice(0, 3).join(' ')), origin + ': the words were not shown after "Show my 12 words"');
  return nodes(tree).filter((n) => n.type === 'button').map((n) => texts(n).join(' ').trim());
}

test('the 12 words have NO Copy button in the desktop program — shown, never put on the clipboard', () => {
  const b = settings('desktop');
  assert.ok(b.some((x) => /^Hide$/.test(x)), 're-anchor: the revealed words have no "Hide" button: ' + JSON.stringify(b));
  assert.ok(!b.some((x) => /Copy|Copied/.test(x)), 'the desktop program offers Copy for the 12 words (desktop clipboards keep history and sync): ' + JSON.stringify(b));
});

test('CONTROL: the web finance page and the Android finance app still offer Copy', () => {
  for (const origin of ['web', 'apk']) {
    const b = settings(origin);
    assert.ok(b.some((x) => /^Copy$/.test(x)), origin + ': Copy is gone — the desktop gate is too broad: ' + JSON.stringify(b));
  }
});

const RUSTC = (() => { try { execFileSync('rustc', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
test('nav.rs: own origin only; file:/data:/foreign blob: blocked; exactly two addresses to the system browser; safe downloads', { skip: RUSTC ? false : 'no rustc' }, () => {
  const bin = join(T, 'navtest');
  execFileSync('rustc', ['--edition', '2021', '--test', join(ROOT, 'finance-app/desktop/src-tauri/src/nav.rs'), '-o', bin], { cwd: T, stdio: 'pipe' });
  const r = spawnSync(bin, [], { encoding: 'utf8' });
  assert.equal(r.status, 0, 'nav.rs tests FAILED:\n' + r.stdout.slice(-1500));
  const m = /test result: ok\. (\d+) passed; 0 failed/.exec(r.stdout);
  assert.ok(m, r.stdout.slice(-400));
  assert.ok(Number(m[1]) >= 8, 'only ' + m[1] + ' nav.rs tests ran');
  assert.ok(existsSync(bin));
});
