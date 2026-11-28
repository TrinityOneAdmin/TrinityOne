// THE DESKTOP FINANCE PROGRAM CARRIES NO RELAY CODE, GRANTS THE PAGE NO NATIVE POWERS, AND ITS IDENTITY CANNOT DRIFT.
// Run: node --test scripts/finance-desktop-program-carries-no-relay-code.test.mjs
//
// T1Finance desktop plan §5 test 5 (+ §8 LOW items). The Suite (relay-app/desktop) is the PATTERN only: it ships a
// relay sidecar, the launcher crate and tauri-plugin-shell, and csp: null. None of that may arrive here, because a
// finance helper's program must not be able to run, start or reach a relay of its own (CLAUDE.md rule 10).
//
// AND TWO THINGS THAT MAY NEVER CHANGE AFTER RELEASE (plan §1 "NEVER change after release"): the identifier
// (com.trinityone.finance — where every OS keeps the webview store, i.e. the helper's PIN-encrypted key) and
// useHttpsScheme: true (Windows: https://tauri.localhost vs http:// — a different origin is an empty store). Both are
// pinned here, and Cargo.lock is committed so a floating `tauri = "2"` cannot move either underneath.
//
// These are structural pins over Rust/JSON/TOML (CLAUDE.md rule 3 is about app/*.jsx). What the window DOES with
// navigation is tested by running nav.rs (scripts/finance-desktop-is-helpers-only.test.mjs, and `cargo test`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = new URL('../', import.meta.url).pathname;
const D = join(ROOT, 'finance-app/desktop/src-tauri');
const read = (rel) => readFileSync(join(D, rel), 'utf8');
const CONF = JSON.parse(read('tauri.conf.json'));
// Cargo.toml with # comments removed (its header comment names what is deliberately absent)
const CARGO = read('Cargo.toml').split('\n').map((l) => l.replace(/#.*$/, '')).join('\n');
const LOCK = read('Cargo.lock');
const RS = readdirSync(join(D, 'src')).filter((f) => f.endsWith('.rs')).map((f) => [f, read('src/' + f)]);
// Rust with comments removed, so a comment naming a forbidden thing (to explain its absence) cannot fail — or pass — it
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
// TOML sections -> { name: body }
const sections = (t) => Object.fromEntries(t.split(/\n(?=\[)/).map((b) => { const m = /^\[([^\]]+)\]/.exec(b.trim()); return [m ? m[1] : '', b]; }));

test('identity pins: identifier com.trinityone.finance, useHttpsScheme true, the one "main" window built from config', () => {
  assert.equal(CONF.identifier, 'com.trinityone.finance');
  assert.equal(CONF.productName, 'TrinityOne Finance');
  assert.equal(CONF.app.windows.length, 1, 'one window only');
  const w = CONF.app.windows[0];
  assert.equal(w.label, 'main');
  assert.equal(w.useHttpsScheme, true, 'useHttpsScheme must be EXPLICITLY true — flipping it moves the Windows origin and orphans every stored key');
  assert.equal(w.url, 'index.html');
  assert.equal(w.create, false, 'the window must be created in Rust (src/main.rs) so the navigation/new-window/download handlers are attached');
  assert.notEqual(w.devtools, true, 'devtools switched on in the window config');
  assert.match(code(RS.find(([f]) => f === 'main.rs')[1]), /WebviewWindowBuilder::from_config\(/, 'main.rs no longer builds the window from tauri.conf.json, so the pinned useHttpsScheme is not what it uses');
  assert.equal(CONF.build.frontendDist, 'dist');
  assert.ok(!('devUrl' in CONF.build), 'a devUrl would load a remote page');
});

test('no relay code: no shell plugin, no launcher, no sidecar, no bundled resources, no node, no gateway', () => {
  const s = sections(CARGO);
  const deps = (s.dependencies || '').split('\n').slice(1).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => l.split(/\s*=/)[0]);
  assert.deepEqual(deps.sort(), ['tauri', 'tauri-plugin-opener'], 'the crate\'s dependencies changed: ' + deps.join(', '));
  for (const bad of ['tauri-plugin-shell', 'trinityone-launcher', 'trinityone_launcher']) {
    assert.ok(!CARGO.includes(bad), 'Cargo.toml names ' + bad);
    assert.ok(!new RegExp('name = "' + bad + '"').test(LOCK), 'Cargo.lock pulls in ' + bad);
  }
  assert.ok(!/path\s*=\s*"\.\.\//.test(CARGO), 'a path dependency (the Suite\'s launcher crate is one)');
  assert.ok(!('externalBin' in CONF.bundle) && !('resources' in CONF.bundle), 'a sidecar or bundled payload');
  assert.ok(!CONF.plugins || Object.keys(CONF.plugins).length === 0, 'plugin config present: ' + JSON.stringify(CONF.plugins));
  for (const [f, src] of RS) {
    const c = code(src);
    assert.doesNotMatch(c, /std::process::Command|Command::new|\.sidecar\(|ShellExt|tauri_plugin_shell/, f + ' can start a process');
    assert.doesNotMatch(c, /gateway|\bnode\b|8787|relay-node|cloudflared/i, f + ' mentions relay machinery');
    assert.doesNotMatch(c, /TcpListener|TcpStream|UdpSocket/, f + ' opens a socket of its own');
  }
  for (const d of ['binaries', 'payload']) assert.ok(!existsSync(join(D, d)), d + '/ exists in the finance crate');
});

test('the page gets NO native powers: every capability grants nothing, no global Tauri object, no command, no plugin registered', () => {
  assert.equal(CONF.app.withGlobalTauri, false);
  const caps = readdirSync(join(D, 'capabilities'));
  assert.deepEqual(caps, ['finance-main.json'], 'capability files changed: ' + caps.join(', '));
  const cap = JSON.parse(read('capabilities/finance-main.json'));
  assert.deepEqual(cap.permissions, [], 'the finance window was granted IPC permissions: ' + JSON.stringify(cap.permissions));
  assert.deepEqual(cap.windows, ['main']);
  assert.ok(!cap.remote, 'a remote-URL capability');
  assert.deepEqual(CONF.app.security.capabilities, ['finance-main'], 'tauri.conf.json enables capabilities other than finance-main');
  const main = code(RS.find(([f]) => f === 'main.rs')[1]);
  assert.doesNotMatch(main, /invoke_handler|generate_handler!|#\[tauri::command\]/, 'main.rs exposes a command to the page');
  assert.doesNotMatch(main, /\.plugin\(/, 'main.rs registers a plugin (each one adds commands to the IPC surface)');
  assert.match(main, /tauri_plugin_opener::open_url\(/, 're-anchor: external links no longer go through the opener\'s free function');
});

test('no devtools in a release build: the `devtools` feature is not enabled, and nothing opens them', () => {
  const s = sections(CARGO);
  assert.doesNotMatch(s.dependencies || '', /devtools/, 'a dependency enables the devtools feature');
  assert.ok(!('features' in s), 'the crate declares [features] (one could switch tauri/devtools on)');
  // the lockfile's tauri package must not have been built with devtools either — cargo records features nowhere in
  // the lock, so the check is the manifest plus the code:
  for (const [f, src] of RS) assert.doesNotMatch(code(src), /open_devtools|\.devtools\(\s*true/, f + ' opens devtools');
});

test('Cargo.lock is committed, and locks tauri to one version', () => {
  const tracked = execFileSync('git', ['ls-files', 'finance-app/desktop/src-tauri/Cargo.lock'], { cwd: ROOT, encoding: 'utf8' }).trim();
  assert.equal(tracked, 'finance-app/desktop/src-tauri/Cargo.lock', 'Cargo.lock is not tracked — the origin/storage path could shift with a floating tauri version');
  const tauri = [...LOCK.matchAll(/\[\[package\]\]\nname = "tauri"\nversion = "([^"]+)"/g)].map((m) => m[1]);
  assert.equal(tauri.length, 1, 'the lock has ' + tauri.length + ' tauri packages');
  assert.match(tauri[0], /^2\./);
});

test('the window\'s three handlers are ATTACHED, and each one asks nav.rs — delete one and this fails', () => {
  // `cargo test` runs navigation_policy / new_window_policy / download_target with a recording opener (src/main.rs
  // tests). What it cannot see is whether main() attaches them to the window at all: without .on_new_window, a
  // window.open makes a NEW WINDOW on any address; without .on_navigation the window goes anywhere; without
  // .on_download a CSV goes wherever the webview likes. So the builder chain itself is pinned here (Rust, not app/*.jsx).
  const main = code(RS.find(([f]) => f === 'main.rs')[1]);
  const start = main.indexOf('WebviewWindowBuilder::from_config(');
  const end = main.indexOf('.build()?', start);
  assert.ok(start > 0 && end > start, 're-anchor: the window is no longer built as from_config(...)...build()?');
  const chain = main.slice(start, end);
  assert.match(chain, /\.on_navigation\(\s*\|u\|\s*navigation_policy\(\s*u\s*,\s*&open_in_browser\s*\)\s*\)/, 'on_navigation is not attached to navigation_policy');
  assert.match(chain, /\.on_new_window\(\s*\|u,\s*_features\|\s*new_window_policy\(\s*&u\s*,\s*&open_in_browser\s*\)\s*\)/, 'on_new_window is not attached to new_window_policy');
  assert.match(chain, /\.on_download\(\s*\|webview,\s*event\|\s*match event\s*\{\s*DownloadEvent::Requested\s*\{\s*url,\s*destination\s*\}\s*=>\s*\{[\s\S]*?download_target\(\s*&url\s*,[\s\S]*?Some\(to\)\s*=>\s*\{\s*\*destination\s*=\s*to;\s*true\s*\}\s*None\s*=>\s*false/, 'on_download is not attached to download_target (or no longer refuses what it returns None for)');
  // and each policy asks nav.rs — the decision is the tested pure code, not something re-derived in main.rs
  const fnBody = (name) => { const i = main.indexOf('fn ' + name); assert.ok(i >= 0, 're-anchor: fn ' + name); const j = main.indexOf('\n}', i); return main.slice(i, j); };
  assert.match(fnBody('navigation_policy'), /decide\(\s*u\s*,\s*nav::nav_decision\s*\)/);
  assert.match(fnBody('new_window_policy'), /decide\(\s*u\s*,\s*nav::nav_decision\s*\)\s*==\s*Nav::External/);
  assert.match(fnBody('new_window_policy'), /NewWindowResponse::Deny\s*$/, 'new_window_policy does not end by denying');
  assert.doesNotMatch(main, /NewWindowResponse::(Allow|Create)/, 'main.rs can let a new window be created');
  assert.match(fnBody('download_target'), /decide\(\s*url\s*,\s*nav::download_allowed\s*\)/);
  assert.match(fnBody('download_target'), /nav::unique_in\([\s\S]*nav::safe_file_name\(/);
  assert.match(fnBody('open_in_browser'), /if decide\(\s*u\s*,\s*nav::nav_decision\s*\)\s*==\s*Nav::External\s*\{\s*let _ = tauri_plugin_opener::open_url\(/, 'open_in_browser no longer re-checks the allow-list itself');
});

test('Mac: minimumSystemVersion is 11.3 — the first macOS whose WKWebView has the download API the CSV/PDF export uses', () => {
  assert.equal(CONF.bundle.macOS.minimumSystemVersion, '11.3');
});

test('the build output folder is gitignored, and the generated icons are too', () => {
  for (const p of ['finance-app/desktop/src-tauri/dist/index.html', 'finance-app/desktop/src-tauri/target/x', 'finance-app/desktop/src-tauri/icons/icon.png']) {
    const r = execFileSync('bash', ['-c', `git check-ignore -q "${p}" && echo yes || echo no`], { cwd: ROOT, encoding: 'utf8' }).trim();
    assert.equal(r, 'yes', p + ' is not ignored');
  }
});
