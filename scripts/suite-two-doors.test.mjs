// TWO DOORS, NOT THREE — and the app works out where the church lives instead of being told.
// Run: node --test scripts/suite-two-doors.test.mjs
//
// The Suite offered three choices at launch. Two of them opened the SAME console screen and differed only in
// where the church's records were kept: this computer, or the shared community relays. Choosing "console
// only" wrote a hidden marker that STUCK for ever, so every later launch inherited it silently.
//
// The consequences, in a church's terms: the same key opened through different doors showed two different
// churches; invitations handed out under each door pointed members at different places, so one congregation
// became two halves that could not see each other; and because the "setup finished" marker was shared, the
// second door never offered to set anything up — it simply showed a normal-looking console over an empty
// church. That is the "it has lost my church" moment.
//
// A steward has two jobs: run the church, and mind the server. Where the records live is not a job — it is a
// fact about the church, and the app can find it out by asking this computer whether it holds them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripComments } from './test-slice.mjs';

const HOME  = readFileSync(new URL('../relay-app/home.html', import.meta.url), 'utf8');
const STEW  = stripComments(readFileSync(new URL('../src/steward.src.js', import.meta.url), 'utf8'));
const SHIP  = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const MAIN  = readFileSync(new URL('../relay-app/desktop/src-tauri/src/main.rs', import.meta.url), 'utf8');

test('the launcher offers two doors, and neither re-points the data', () => {
  const doors = [...HOME.matchAll(/href="(\/[^"]+)"/g)].map(m => m[1]).filter(h => /steward\.html|control\.html/.test(h));
  assert.deepEqual(doors.sort(), ['/relay-app/control.html', '/steward.html'],
    'the launcher still offers a third door, or still passes a mode in the address');
});

// THE DOORS EXISTED; NOTHING MADE THE APP WALK THROUGH THEM. The test above pins home.html's two doors, and
// passed for months while the desktop Suite opened steward.html directly on first launch and only ever showed
// the chooser on the SECOND one. So an operator installing the Suite to run a relay for their church — the
// person the "Manage a relay" door is FOR — was walked into church setup with no way past it, on the one
// launch where they had no church yet. Reported by the owner 2026-09-08.
//
// This is CLAUDE.md rule 1: a chooser nobody is routed to is not a chooser. Rule 3 does not apply — main.rs is
// compiled Rust, not an unbundled app/*.jsx, so dead code cannot leave a matching string behind for free.
test('the desktop Suite opens the chooser on FIRST launch, not the console', () => {
  const src = MAIN.replace(/(^|[^:])\/\/[^\n]*/gm, '$1');   // strip comments: this file explains the old behaviour above
  const at = src.indexOf('let url');
  assert.notEqual(at, -1, 'the launch URL is no longer built with `let url` — re-anchor this test');
  const decl = src.slice(at, src.indexOf(';', at));
  assert.match(decl, /home\.html/, 'first launch does not open the launcher');
  assert.equal(/steward\.html/.test(decl), false,
    'the desktop app opens the Steward console directly again. Somebody who installed the Suite only to run a ' +
    'relay is then inside church setup, and the "Manage a relay" door is unreachable until the second launch.');
  assert.equal(/if\s+first_run/.test(decl), false,
    'the launch URL branches on first_run again — both branches must be the chooser');
});

// The inert params are worth pinning: main.rs appended ?relayapp=1 for months believing it told the console it
// was self-hosting. Nothing read it. If one is ever read again it must be a deliberate decision, not a revival.
test('no launcher mode is passed in the address, or read from it', () => {
  for (const p of ['relayapp', 'host=on', 'host=off']) {
    assert.equal(MAIN.replace(/(^|[^:])\/\/[^\n]*/gm, '$1').includes(p), false, `the desktop app passes ?${p} again`);
    assert.equal(STEW.includes(p), false, `the console reads ?${p} again — the door must not declare where the church lives`);
  }
});

test('the sticky marker is gone from source and from the shipped bundle', () => {
  // It survived in localStorage for ever once written, which is why the choice was invisible afterwards.
  assert.equal(/hostoff/.test(STEW), false, 'the sticky host marker is still written or read');
  assert.equal(/hostoff/.test(SHIP), false, 'the shipped console still carries the sticky marker');
});

test('where the church lives is DETECTED, and fails safe', () => {
  // It asks this computer whether it holds this church. If it cannot tell, it must keep the computer in the
  // list: an extra relay that has nothing costs a dead connection, whereas dropping the one that holds the
  // church loses the church.
  assert.match(STEW, /_boxHostsUs/, 'nothing works out whether this computer holds the church');
  const i = STEW.indexOf('function ownRelay');
  const fn = STEW.slice(i, STEW.indexOf('\nfunction ', i + 10));
  assert.match(fn, /_boxHostsUs === false/,
    'the computer is dropped on anything other than a positive "it does not hold this church"');
});

test('the console says where the church lives, so drift is never silent', () => {
  const D = stripComments(readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8'));
  assert.match(D, /Your church lives on|lives on:/i, 'nothing on screen names where the records are kept');
});

// ── FIRST LAUNCH WALKS THROUGH RELAY SETUP ────────────────────────────────────────────────────────────────
// Owner, 2026-09-12. The wizard existed in control.js and control.js is loaded by control.html ALONE, so it
// only ever fired for someone who picked "Manage a relay" — a steward picking "Run your church" never met
// it. home.js now sends a first launch to the relay panel so the wizard runs.
//
// ⚠ RUN, NEVER MATCHED. relay-app/*.js ships unbundled exactly like app/*.jsx, so `false && ` in front of
// this would leave every word of it in place and a text-matching assertion would still pass — CLAUDE.md
// rule 3, same hazard, different directory. The block is lifted out of the shipped file and EXECUTED
// against a stubbed window.
const HOMEJS = readFileSync(new URL('../relay-app/home.js', import.meta.url), 'utf8');
const FIRSTRUN = (() => {
  const i = HOMEJS.indexOf('// ── FIRST LAUNCH GOES THROUGH RELAY SETUP');
  assert.notEqual(i, -1, 'the first-launch block is gone from relay-app/home.js');
  return HOMEJS.slice(i);
})();

function launch({ seen = null, hostname = '127.0.0.1', storageThrows = false } = {}) {
  const went = [];
  const localStorage = storageThrows
    ? { getItem() { throw new Error('site data blocked'); }, setItem() {} }
    : { getItem: (k) => (k === 'to_relay_setup_seen' ? seen : null), setItem() {} };
  const location = { hostname, replace: (u) => went.push(u) };
  new Function('localStorage', 'location', FIRSTRUN)(localStorage, location);
  return went;
}

test('a FIRST launch is sent to relay setup — the wizard nobody could reach', () => {
  assert.deepEqual(launch(), ['/relay-app/control.html'],
    'THE FIRST LAUNCH DOES NOT REACH THE RELAY WIZARD. maybeFirstRun() lives in control.js, which only ' +
    'control.html loads, so a steward who picks "Run your church" never meets relay setup at all.');
});

test('…and NEVER to the console, which is the 2026-09-08 regression', () => {
  // 6966c4f: first run used to open steward.html, so somebody installing the Suite purely to run a relay
  // was walked into church setup with no way past it.
  assert.equal(launch().some(u => /steward\.html/.test(u)), false,
    'FIRST RUN LANDS ON THE CONSOLE. A relay-only operator is walked into church setup with no way past.');
});

test('once the wizard has been seen — finished, skipped, or an established relay — it never fires again', () => {
  // control.js sets `to_relay_setup_seen` on EVERY exit from that wizard, including "do not nag an
  // established relay". Without this the launcher would bounce to the panel on every single launch.
  assert.deepEqual(launch({ seen: '1' }), [], 'the launcher re-ran relay setup after it had been seen');
});

test('OVER A TUNNEL IT DOES NOTHING, and that is what stops an infinite redirect', () => {
  // control.js's maybeFirstRun() returns early when it has no admin token, BEFORE it sets the marker, and
  // localAdminToken() is loopback-gated. So off loopback the marker is never set — and a redirect that did
  // not check this would bounce the launcher to a panel it cannot use, for ever.
  for (const host of ['relay.example.ts.net', 'app.trinityone.church', '192.168.1.40']) {
    assert.deepEqual(launch({ hostname: host }), [],
      'the launcher redirected to relay setup from ' + host + ', where the wizard cannot set its own ' +
      'seen-marker — that is a redirect on every launch, for ever');
  }
  // …and the loopback spellings that MUST still work, so the line above is a condition and not a deletion.
  for (const host of ['localhost', '127.0.0.1', '::1']) {
    assert.deepEqual(launch({ hostname: host }), ['/relay-app/control.html'], host + ' did not reach relay setup');
  }
});

test('a browser with site data blocked is left alone rather than crashed', () => {
  assert.deepEqual(launch({ storageThrows: true }), [],
    'a launcher that cannot read localStorage threw instead of simply not redirecting');
});
