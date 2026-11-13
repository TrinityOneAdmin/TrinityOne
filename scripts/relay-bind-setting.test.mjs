// The desktop relay must not be reachable from the network unless the operator says so.
// Run: node --test scripts/relay-bind-setting.test.mjs
//
// AUDIT-2026-07-27. The Tauri launcher set no RELAY_HOST at all, so the gateway took its server default of
// 0.0.0.0 and the "church in a box" listened on every interface — a church hall's guest wifi, a coffee shop.
// Two comments claimed it bound loopback: the launcher's own header, and the one on BIND_HOST in gateway.mjs.
// Both were false. It is now loopback unless the `lan-access` marker exists, written by the control panel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAIN = readFileSync(new URL('../relay-app/desktop/src-tauri/src/main.rs', import.meta.url), 'utf8');
const GW = readFileSync(new URL('./gateway.mjs', import.meta.url), 'utf8');
const CJS = readFileSync(new URL('../relay-app/control.js', import.meta.url), 'utf8');
const CHTML = readFileSync(new URL('../relay-app/control.html', import.meta.url), 'utf8');

// THE DECISION, RUN. The loopback-vs-network choice is relay_bind_host() in its own dependency-free Rust file,
// which main.rs includes as `mod bind_host`. We compile THAT file's own tests with plain rustc and run them: a
// real data dir, a real marker file. Flip the check, delete it, or point it at the wrong directory and they fail.
// (Until 2026-11-13 this test matched the text of a one-line `.env("RELAY_HOST", if … lan-access …)`; the
// suite-autoupdate branch moved that into spawn_relay/relay_env and the match went stale — audit
// AUDIT-integration-all-1aa19150 MEDIUM 1.) Skips only where no Rust compiler is installed.
const TAURI_SRC = new URL('../relay-app/desktop/src-tauri/src/', import.meta.url);
const BIND = fileURLToPath(new URL('bind_host.rs', TAURI_SRC));
const RUSTC = [process.env.RUSTC, join(homedir(), '.cargo', 'bin', 'rustc'), 'rustc']
  .filter(Boolean).find((c) => { try { return spawnSync(c, ['--version']).status === 0; } catch { return false; } });

test('the Suite listens on loopback unless the lan-access marker exists (the real Rust decision, compiled and run)',
  { skip: RUSTC ? false : 'no rustc on this machine — the wiring test below still runs', timeout: 120000 }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'trin-bind-rs-'));
  try {
    const bin = join(dir, 'bind_host_tests');
    const c = spawnSync(RUSTC, ['--edition', '2021', '--test', BIND, '-o', bin], { encoding: 'utf8' });
    assert.equal(c.status, 0, 'bind_host.rs did not compile on its own:\n' + c.stderr);
    const r = spawnSync(bin, [], { encoding: 'utf8' });
    assert.equal(r.status, 0, 'the bind-host tests FAILED — the Suite would be reachable from the network without the operator asking:\n' + r.stdout + r.stderr);
    for (const name of ['no_marker_listens_on_this_computer_only', 'the_marker_opens_it_to_the_network',
      'removing_the_marker_closes_it_again', 'a_first_run_with_no_data_dir_is_loopback', 'only_the_exact_marker_in_the_data_dir_counts']) {
      assert.match(r.stdout, new RegExp('test tests::' + name + ' \\.\\.\\. ok'), name + ' did not run and pass — a deleted test never fails');
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// THE WIRING. The test above proves the decision; this proves every relay launch uses it. Rust has no
// unbundled-dead-code trap like app/*.jsx, but these are still text reads, so they claim only "the call is
// there" — the executed proof is the cargo test relay_env_binds_loopback_unless_the_lan_access_marker_exists
// (not in this suite: cargo/Tauri are not installed on every box that runs it).
const fnBody = (src, name) => {
  const at = src.indexOf('\nfn ' + name + '(');
  assert.ok(at >= 0 && src.indexOf('\nfn ' + name + '(', at + 1) < 0, 'fn ' + name + ' is missing or defined twice in main.rs — re-anchor');
  const end = src.indexOf('\n}\n', at);
  return src.slice(at, end + 2);
};
test('every relay launch takes RELAY_HOST from that decision', () => {
  assert.match(MAIN, /^mod bind_host;$/m, 'main.rs no longer includes bind_host.rs — the tested decision is not the one the Suite runs');
  const env = fnBody(MAIN, 'relay_env');
  assert.equal(env.split('bind_host::relay_bind_host(data_dir)').length - 1, 1, 'relay_env does not take the bind host from bind_host::relay_bind_host(data_dir)');
  assert.match(env, /\("RELAY_HOST"\.into\(\), relay_host\.to_string\(\)\)/, 'relay_env no longer sets RELAY_HOST from that decision — the gateway would fall back to 0.0.0.0');
  const spawn = fnBody(MAIN, 'spawn_relay');
  assert.match(spawn, /for \(k, v\) in relay_env\(/, 'spawn_relay no longer takes its environment from relay_env');
  assert.doesNotMatch(spawn, /RELAY_HOST|lan-access/, 'spawn_relay decides the bind address itself again, bypassing the tested decision');
});

test('the gateway persists the choice and writes the marker', () => {
  assert.match(GW, /lanAccess: false/, 'lanAccess must default to OFF in SETTINGS');
  assert.match(GW, /SETTINGS\.lanAccess = s\.lanAccess === true/, 'the setting must load from disk');
  assert.match(GW, /join\(DATA_DIR, 'lan-access'\)/, 'saving must write/remove the marker the launcher reads');
});

test('the operator can actually reach the toggle, and it is honest about the risk', () => {
  assert.match(CHTML, /id="t-lan"/, 'no control in the panel means the setting does not exist for a real person');
  assert.match(CJS, /lanAccess: _lan\.checked/, 'the toggle must be sent on save');
  assert.match(CJS, /lan\.checked = s\.lanAccess === true/, 'the toggle must reflect the saved state');
  const row = CHTML.slice(CHTML.indexOf('id="t-lan"') - 700, CHTML.indexOf('id="t-lan"'));
  assert.match(row, /anyone on the same network/i, 'the copy must say who else can reach it');
  assert.match(row, /next time you open the app/i, 'the copy must say a restart is needed, or it looks broken');
});

test('the old false comments are gone', () => {
  assert.doesNotMatch(GW, /desktop app sets 127\.0\.0\.1 \(loopback/,
    'gateway.mjs still claims the desktop app sets loopback as an unconditional fact');
  assert.match(MAIN, /unless the operator opts into LAN access/,
    'the launcher header must describe what the code actually does');
});
