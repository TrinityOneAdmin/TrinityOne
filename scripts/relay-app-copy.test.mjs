// A Copy button must never fail silently. Run: node --test scripts/relay-app-copy.test.mjs
//
// Reported by the operator, 2026-07-30: the relay control panel's church-list Copy button "doesn't work", and
// "it's truncated, so I can't copy it all". Those are one bug wearing two faces. The button copies the church's
// npub — the single string an operator MUST get out of that panel to give to members — and the row renders it
// with `text-overflow:ellipsis`, so when the copy failed there was no way to read the rest either. The operator
// was completely stuck on the one value they needed.
//
// DIAGNOSIS, measured rather than guessed. Driving the real page in headless Chrome with a STUBBED clipboard
// showed the handler was fine: bound, ran without error, copied all 63 characters. The fault was
// `navigator.clipboard` itself, and the old one-liner could not survive either way it fails:
//
//   const gpCopy = (t,b) => { navigator.clipboard.writeText(t).then(...).catch(()=>{}); };
//
//   1. Outside a SECURE CONTEXT `navigator.clipboard` is UNDEFINED — and this panel is routinely opened over
//      plain http:// on a LAN or Tailscale address. Then `.writeText` throws a SYNCHRONOUS TypeError, which a
//      `.catch()` never sees. Proved in the live page:
//        TypeError: Cannot read properties of undefined (reading 'writeText')   caughtByItsOwnCatch: false
//   2. In a webview the promise can simply REJECT (permission, or an unfocused document) — swallowed by the
//      empty `.catch(()=>{})`.
//
// Either way: click, nothing happens, nothing on screen, nothing in the log. That is the silent-failure class
// this codebase keeps being bitten by, so the rule this file pins is stronger than "copying works":
//
//        if copying is impossible, SAY SO and put the text where it can be copied by hand.
//
// The behavioural half was verified end-to-end against the real page (headless Chrome, real relay, real church
// list). With clipboard AND execCommand both denied — the worst case an operator can be in — the button throws
// nothing, flags itself failed, keeps its SVG icon, and opens a dialog holding all 63 characters, selected.
// What remains here is the part a unit test can hold onto permanently.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = new URL('../relay-app/', import.meta.url).pathname;
const SRC = readFileSync(join(DIR, 'copy.js'), 'utf8');        // the shared clipboard implementation
const CONTROL = readFileSync(join(DIR, 'control.js'), 'utf8');

test('no unguarded navigator.clipboard access anywhere in the relay app', () => {
  // The root cause in one line. `navigator.clipboard.writeText(...)` with no `navigator.clipboard &&` in front
  // of it is a synchronous throw on every http:// origin, which is where this panel actually lives.
  const offenders = [];
  for (const f of readdirSync(DIR).filter(f => f.endsWith('.js'))) {
    const src = readFileSync(join(DIR, f), 'utf8');
    src.split('\n').forEach((line, i) => {
      if (/^\s*(\/\/|\*)/.test(line)) return;                                  // comments describe the bug
      if (!/navigator\.clipboard\s*\.\s*writeText/.test(line)) return;
      if (/navigator\.clipboard\s*&&|navigator\.clipboard\?\./.test(line)) return;   // guarded
      offenders.push(f + ':' + (i + 1) + '  ' + line.trim().slice(0, 90));
    });
  }
  assert.deepEqual(offenders, [],
    'these lines reach into navigator.clipboard without checking it exists. Outside a secure context it is ' +
    'undefined, so this throws a SYNCHRONOUS TypeError that no .catch() will see — the exact reported bug.');
});

test('copyText survives having no clipboard at all, and reports failure', () => {
  // Lift the real helper and run it in the operator's worst case: no clipboard API, and execCommand refusing.
  const m = SRC.match(/async function copyText\(text\) \{[\s\S]*?\n  \}/);
  assert.ok(m, 'copyText is gone or reshaped — re-anchor this test');
  const els = [];
  const doc = {
    createElement: () => { const e = { style: {}, setAttribute() {}, select() {}, setSelectionRange() {}, remove() {} }; els.push(e); return e; },
    body: { appendChild() {} },
    execCommand: () => false,          // deny the fallback too
  };
  const fn = new Function('navigator', 'document', m[0] + '; return copyText;')({}, doc);
  return fn('npub1abc').then((ok) => {
    assert.equal(ok, false, 'copyText claimed success with no clipboard and no execCommand — a caller would ' +
      'then flash "Copied" having copied nothing, which is worse than the original bug');
    assert.ok(els.length >= 1, 'it never even tried the execCommand fallback, which is the only path that ' +
      'works on an http:// origin');
  });
});

test('…and reports SUCCESS when the fallback works', () => {
  // Control: if copyText always returned false the test above would pass for the wrong reason.
  const m = SRC.match(/async function copyText\(text\) \{[\s\S]*?\n  \}/);
  const doc = {
    createElement: () => ({ style: {}, setAttribute() {}, select() {}, setSelectionRange() {}, remove() {} }),
    body: { appendChild() {} },
    execCommand: () => true,
  };
  const fn = new Function('navigator', 'document', m[0] + '; return copyText;')({}, doc);
  return fn('npub1abc').then(ok => assert.equal(ok, true, 'the execCommand fallback path never reports success'));
});

test('a failed copy shows the value for manual copying', () => {
  // The half that unsticks the operator: the row clips the key, so "it failed" is not enough — the full string
  // has to appear somewhere selectable.
  assert.match(SRC, /async function copyWithFeedback\([\s\S]{0,400}?showCopyFallback\(/,
    'copyWithFeedback no longer opens the manual-copy fallback when copying fails. The church key is rendered ' +
    'with text-overflow:ellipsis, so a silent failure leaves the operator with no way to obtain it at all.');
  const fb = SRC.match(/function showCopyFallback\(text, label\) \{[\s\S]*?\n  \}/);
  assert.ok(fb, 'showCopyFallback is gone');
  assert.match(fb[0], /\.value = String\(text/, 'the fallback dialog does not contain the text');
  assert.match(fb[0], /\.select\(\)/, 'the fallback does not select the text, so Ctrl+C copies nothing');
});

test('every copy path in the panel goes through the one helper', () => {
  // There were TWO silent implementations (the reach-info buttons and gpCopy). Both are now aliases, so a fix
  // to one cannot leave the other quietly broken — the drift this codebase has been bitten by before.
  assert.doesNotMatch(CONTROL, /catch\(e\)\{\}\s*$/m, 'an empty catch block is back — that is how the bug hid');
  // and home.js must not claim success it cannot verify
  const HOME = readFileSync(join(DIR, 'home.js'), 'utf8');
  assert.match(HOME, /RelayCopy\.copyWithFeedback/,
    'home.js copies without the shared helper again. It used to print "✓ Link copied" whether or not anything ' +
    'was copied — telling the operator a thing happened when it did not.');
  const gp = CONTROL.match(/const gpCopy = [^;]*;/);
  assert.ok(gp, 're-anchor: gpCopy is gone');
  assert.match(gp[0], /copyWithFeedback/, 'gpCopy no longer delegates, so it can drift from copyText again');
});

test('the church key is selectable despite being visually clipped', () => {
  // "it's truncated, so I can't copy it all" — the full npub IS in the DOM; ellipsis only hides it visually, and
  // dragging a selection across a clipped element is hopeless. user-select:all makes one click take the lot.
  const css = readFileSync(join(DIR, 'control.html'), 'utf8');
  const rule = css.match(/\.cr-key \{[^}]*\}/);
  assert.ok(rule, 're-anchor: the .cr-key rule is gone');
  assert.match(rule[0], /user-select:\s*all/,
    'the church key is clipped with text-overflow:ellipsis and is no longer click-selectable, so an operator ' +
    'whose clipboard is unavailable cannot get the key by hand either');
});
