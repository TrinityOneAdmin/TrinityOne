// The desktop relay must not be reachable from the network unless the operator says so.
// Run: node --test scripts/relay-bind-setting.test.mjs
//
// AUDIT-2026-07-27. The Tauri launcher set no RELAY_HOST at all, so the gateway took its server default of
// 0.0.0.0 and the "church in a box" listened on every interface — a church hall's guest wifi, a coffee shop.
// Two comments claimed it bound loopback: the launcher's own header, and the one on BIND_HOST in gateway.mjs.
// Both were false. It is now loopback unless the `lan-access` marker exists, written by the control panel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const MAIN = readFileSync(new URL('../relay-app/desktop/src-tauri/src/main.rs', import.meta.url), 'utf8');
const GW = readFileSync(new URL('./gateway.mjs', import.meta.url), 'utf8');
const CJS = readFileSync(new URL('../relay-app/control.js', import.meta.url), 'utf8');
const CHTML = readFileSync(new URL('../relay-app/control.html', import.meta.url), 'utf8');

test('the desktop launcher sets RELAY_HOST explicitly', () => {
  assert.match(MAIN, /\.env\("RELAY_HOST"/,
    'the launcher leaves RELAY_HOST unset again — the gateway will fall back to 0.0.0.0 and the comments will be lying');
});

test('it is loopback by default and 0.0.0.0 only with the marker', () => {
  // NB the marker expression contains parentheses — `join("lan-access")` — so this must not exclude them.
  const m = MAIN.match(/\.env\("RELAY_HOST",\s*if\s+([\s\S]*?)\.exists\(\)\s*\{\s*"([^"]+)"\s*\}\s*else\s*\{\s*"([^"]+)"\s*\}/);
  assert.ok(m, 'RELAY_HOST is no longer a marker-conditional');
  assert.match(m[1], /lan-access/, 'the opt-in marker must be the lan-access file');
  assert.equal(m[2], '0.0.0.0', 'with the marker present, LAN access is allowed');
  assert.equal(m[3], '127.0.0.1', 'WITHOUT the marker it must be loopback — that is the whole point');
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
