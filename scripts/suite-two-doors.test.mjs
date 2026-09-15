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

// ⚠ RECORDS BOTH `href` AND `replace`, and the difference is load-bearing twice over.
// The first version recorded only `replace`. When the code moved to `href` (so the panel's Back button has
// somewhere to return to), this harness silently recorded NOTHING — and `deepEqual(went, [])` in the
// negative tests below then passed for the wrong reason. A test that goes BLIND rather than red is worse
// than one that fails, so `navigated()` asserts the harness can see a navigation at all before any test
// claims one did not happen.
// `sessionStorage` must be injected too: without it the block ReferenceErrors into its own catch and every
// test reports "no redirect" — green, and measuring nothing.
function launch({ seen = null, hostname = '127.0.0.1', storageThrows = false, tried = null, session = null } = {}) {
  const went = [];
  const ls = {};
  const localStorage = storageThrows
    ? { getItem() { throw new Error('site data blocked'); }, setItem() {} }
    : { getItem: (k) => (k === 'to_relay_setup_seen' ? seen : (k in ls ? ls[k] : null)), setItem: (k, v) => { ls[k] = String(v); } };
  const ss = { ...(session || {}) };
  if (tried) ss['to_relay_setup_tried'] = tried;
  const sessionStorage = { getItem: (k) => (k in ss ? ss[k] : null), setItem: (k, v) => { ss[k] = String(v); } };
  const location = {
    hostname,
    replace: (u) => went.push({ how: 'replace', to: u }),
    set href(u) { went.push({ how: 'href', to: u }); },
    get href() { return 'http://127.0.0.1:8787/relay-app/home.html'; },
  };
  new Function('localStorage', 'sessionStorage', 'location', FIRSTRUN)(localStorage, sessionStorage, location);
  return { went, ss };
}
const navigated = (r) => r.went.map(w => w.to);

test('a FIRST launch is sent to relay setup — the wizard nobody could reach', () => {
  const r = launch();
  assert.deepEqual(navigated(r), ['/relay-app/control.html'],
    'THE FIRST LAUNCH DOES NOT REACH THE RELAY WIZARD. maybeFirstRun() lives in control.js, which only ' +
    'control.html loads, so a steward who picks "Run your church" never meets relay setup at all.');
});

test('…AND IT LEAVES A WAY BACK. `replace` consumes the entry the panel\u2019s exit depends on', () => {
  // The relay panel's only way out is `openConsole`: `history.length > 1 ? history.back() : go home`. With
  // home.html's entry CONSUMED by `replace`, Back landed on the bundled "Starting your relay…" splash —
  // no links, no address bar, nothing but quitting the app. This is the whole of audit finding A-F1.
  assert.deepEqual(launch().went, [{ how: 'href', to: '/relay-app/control.html' }],
    'THE LAUNCHER STILL REPLACES ITS OWN HISTORY ENTRY, so the relay panel is a one-way door.');
});

test('once per app RUN, even when the wizard never managed to mark itself seen', () => {
  // A stale admin token, a relay not yet serving /config, or quitting mid-wizard all leave the marker
  // unwritten — and without this the launcher would bounce to the panel on every single launch, for ever.
  const first = launch();
  assert.equal(navigated(first).length, 1, 're-anchor: the first call did not navigate at all');
  assert.equal(first.ss['to_relay_setup_tried'], '1', 'the run was not recorded, so nothing stops a loop');
  assert.deepEqual(navigated(launch({ tried: '1' })), [],
    'THE LAUNCHER REDIRECTED AGAIN IN THE SAME RUN. With the marker unwritten this is an infinite loop ' +
    'onto a panel the steward cannot use.');
});

test('…but a genuine NEW run still gets the wizard', () => {
  assert.deepEqual(navigated(launch({ session: {} })), ['/relay-app/control.html'],
    'a fresh app run was denied relay setup — the per-run guard has become permanent');
});

test('0.0.0.0 is refused, because the server refuses it too', () => {
  // The gateway's /local-token gate accepts only 127.0.0.1, localhost and ::1. A webview at 0.0.0.0 passed
  // the client check, was refused the token, and control.js returned BEFORE writing its marker — so that
  // box landed on the panel every launch with no way to reach the wizard. Admitting an address the server
  // refuses is strictly worse than not admitting it.
  assert.deepEqual(navigated(launch({ hostname: '0.0.0.0' })), [],
    'the launcher still sends 0.0.0.0 to a panel that cannot obtain an admin token');
});

test('…and NEVER to the console, which is the 2026-09-08 regression', () => {
  // 6966c4f: first run used to open steward.html, so somebody installing the Suite purely to run a relay
  // was walked into church setup with no way past it.
  assert.equal(navigated(launch()).some(u => /steward\.html/.test(u)), false,
    'FIRST RUN LANDS ON THE CONSOLE. A relay-only operator is walked into church setup with no way past.');
});

test('once the wizard has been seen — finished, skipped, or an established relay — it never fires again', () => {
  // control.js sets `to_relay_setup_seen` on EVERY exit from that wizard, including "do not nag an
  // established relay". Without this the launcher would bounce to the panel on every single launch.
  assert.deepEqual(navigated(launch({ seen: '1' })), [], 'the launcher re-ran relay setup after it had been seen');
});

test('OVER A TUNNEL IT DOES NOTHING, and that is what stops an infinite redirect', () => {
  // control.js's maybeFirstRun() returns early when it has no admin token, BEFORE it sets the marker, and
  // localAdminToken() is loopback-gated. So off loopback the marker is never set — and a redirect that did
  // not check this would bounce the launcher to a panel it cannot use, for ever.
  // ⚠ THE POSITIVE CONTROL FIRST. Until 2026-09-12 this harness recorded only `replace`, so when the code
  // moved to `href` every one of these negatives passed VACUOUSLY — the assertion was true because nothing
  // could be recorded at all, not because nothing happened.
  assert.equal(navigated(launch()).length, 1,
    'the harness cannot see a navigation, so every "it did nothing" assertion below is vacuous');
  for (const host of ['relay.example.ts.net', 'app.trinityone.church', '192.168.1.40']) {
    assert.deepEqual(navigated(launch({ hostname: host })), [],
      'the launcher redirected to relay setup from ' + host + ', where the wizard cannot set its own ' +
      'seen-marker — that is a redirect on every launch, for ever');
  }
  // …and the loopback spellings that MUST still work, so the line above is a condition and not a deletion.
  for (const host of ['localhost', '127.0.0.1', '::1']) {
    assert.deepEqual(navigated(launch({ hostname: host })), ['/relay-app/control.html'], host + ' did not reach relay setup');
  }
});

test('a browser with site data blocked is left alone rather than crashed', () => {
  assert.deepEqual(navigated(launch({ storageThrows: true })), [],
    'a launcher that cannot read localStorage threw instead of simply not redirecting');
});
