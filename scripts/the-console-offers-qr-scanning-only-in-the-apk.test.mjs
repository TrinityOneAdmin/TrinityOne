// THE STEWARD CONSOLE OFFERS QR CAMERA SCANNING ONLY IN THE PHONE APP (APK).
// Run: node --test scripts/the-console-offers-qr-scanning-only-in-the-apk.test.mjs
//
// OWNER DECISION: scanning a QR with the camera is an APK/native capability only. The web console and the
// desktop Suite have no camera path we support, so the three "scan ..." trigger buttons must not appear
// there — they are gated on stewOnPhoneApp(), the file's own APK-only predicate
// (window.Capacitor.isNativePlatform()). The paste/type fallbacks beside each one stay everywhere, and the
// "Show handoff QR" button (which DISPLAYS a code and needs no camera) stays everywhere too.
//
// WHY THIS IS A RENDER TEST AND NOT A TEXT MATCH (CLAUDE.md rules 1 & 3). app/stew-dashboard.jsx ships
// UNBUNDLED, so `stewOnPhoneApp() ? <button/> : null` leaves every word of the button in the source whether
// the gate passes or not — a text-matching assertion would pass over a deleted gate. So each panel is LIFTED
// and RENDERED through the mini-React harness with the real stewOnPhoneApp() lifted alongside it, twice:
//   (a) window carries Capacitor.isNativePlatform() === true  -> the scan button IS on the screen (APK)
//   (b) window has no Capacitor (web console AND the Suite both lack it) -> the scan button is ABSENT
// Each assertion therefore fails if the gate is deleted (always-renders breaks (b)) AND if the button itself
// is deleted (breaks (a)).
//
// CALLERS OF stewOnPhoneApp() TOUCHED BY THE FIX (CLAUDE.md rule 2): the predicate had ONE caller before this
// change — the collapsed-groups default inside DashSettings (unchanged). The fix adds THREE new callers, each
// gating one scan trigger: ReseatModal ("Scan their code"), DashBecomeStewardPanel ("Scan a church's
// invite"), and DashSettings' Stewards-&-handoff page ("Scan a handoff QR"). A fourth scan button in the
// member-add row was already native-gated (via isNativePlatform() inline) and is left as-is.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fnBody } from './test-slice.mjs';
import { miniReact, button } from './render-jsx-screen.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DASH = readFileSync(join(ROOT, 'app/stew-dashboard.jsx'), 'utf8');

// Compile one or more named constructs out of the real JSX with the real esbuild (same binary/flags as the
// packaged build) and hand back the named values, with `globals` in scope. The gate under test —
// stewOnPhoneApp — is ALWAYS lifted here, never stubbed, so the real condition executes against the injected
// window. Only inert plumbing (the settings page list, localStorage helpers) is stubbed through `globals`.
function liftFromJsx(anchors, exportNames, globals) {
  const body = anchors.map(([a, n]) => fnBody(DASH, a, n)).join('\n\n');
  const dir = mkdtempSync(join(tmpdir(), 'qrhide-'));
  const tmp = join(dir, 'lift.jsx');
  let js;
  try {
    writeFileSync(tmp, body);
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--log-level=error'], { encoding: 'utf8', maxBuffer: 1 << 26 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
  const names = Object.keys(globals);
  return new Function(...names, js + '\nreturn { ' + exportNames.join(', ') + ' };')(...names.map((k) => globals[k]));
}

// A window that is the phone app (APK) or not, depending on `native`, carrying whatever else a panel reads.
const win = (native, extra) => Object.assign(native ? { Capacitor: { isNativePlatform: () => true } } : {}, extra || {});

// Stubs shared by the panels. A container stub MUST return its children or the harness never expands them.
const passthrough = (p) => (p && p.children !== undefined ? p.children : null);
const nul = () => null;

test('ReseatModal offers "Scan their code" only in the APK', () => {
  const makeCard = (native) => {
    const { React, draw } = miniReact();
    const { ReseatModal } = liftFromJsx(
      [['function stewOnPhoneApp(', 'stewOnPhoneApp'], ['function ReseatModal(', 'ReseatModal']],
      ['ReseatModal'],
      { React, window: win(native), CkModal: passthrough },
    );
    return draw(ReseatModal, { member: 'npub1old', memberName: 'Sam', realName: '', isMinor: false, admittedList: [], onClose: () => {} });
  };
  assert.equal(button(makeCard(true), 'Scan their code').length, 1,
    'the phone app does not offer "Scan their code" — the one native scan path is gone');
  assert.equal(button(makeCard(false), 'Scan their code').length, 0,
    'the web/Suite console still shows "Scan their code" — the camera trigger leaked outside the APK');
});

test('DashBecomeStewardPanel offers "Scan a church’s invite" only in the APK', () => {
  const Steward = {
    becomeStewardPayload: () => 'BECOME-CODE',
    npub: 'npub1me',
    requestSteward: () => ({ ok: true }),
    qrSVG: () => '<svg/>',
    stewardName: () => 'Brave Lion',
  };
  const makePanel = (native) => {
    const { React, draw } = miniReact();
    const { DashBecomeStewardPanel } = liftFromJsx(
      [['function stewOnPhoneApp(', 'stewOnPhoneApp'], ['function DashBecomeStewardPanel(', 'DashBecomeStewardPanel']],
      ['DashBecomeStewardPanel'],
      { React, window: win(native, { Steward }), Panel: passthrough, Icon: nul, SkKey: nul, copyText: () => true },
    );
    return draw(DashBecomeStewardPanel, {});
  };
  assert.equal(button(makePanel(true), 'Scan a church').length, 1,
    'the phone app does not offer "Scan a church’s invite"');
  assert.equal(button(makePanel(false), 'Scan a church').length, 0,
    'the web/Suite console still shows "Scan a church’s invite" — the camera trigger leaked outside the APK');
});

test('DashSettings Stewards-&-handoff page offers "Scan a handoff QR" only in the APK (and keeps "Show handoff QR" everywhere)', () => {
  const church = { name: 'Grace Chapel', nip05: '', isNetwork: false };
  // A minimal, shape-correct settings list so the Stewards page is the open page. settingsPageFor /
  // settingsGroupOf are inert navigation plumbing — stubbed to open 'stewards' — NOT the gate under test.
  const SETTINGS_GROUPS = [['Security', [{ k: 'stewards', n: 'Stewards & handoff', d: 'Hand the church on' }]]];
  const makeSettings = (native) => {
    const { React, draw } = miniReact();
    const { DashSettings } = liftFromJsx(
      [['function stewOnPhoneApp(', 'stewOnPhoneApp'], ['function DashSettings(', 'DashSettings']],
      ['DashSettings'],
      {
        React,
        window: win(native, { useStewardChurch: () => church, Steward: { isDelegated: () => false } }),
        SETTINGS_GROUPS,
        settingsPageFor: () => 'stewards',
        settingsGroupOf: () => 'Security',
        readCollapsedGroups: () => null,
        writeCollapsedGroups: () => {},
        useStewNarrow: () => false,
        Panel: passthrough,
        Icon: nul,
        StewVersion: nul,
      },
    );
    return draw(DashSettings, { onTab: () => {}, initialSection: 'stewards', initialIntent: '', onSectionConsumed: () => {} });
  };
  const apk = makeSettings(true);
  const web = makeSettings(false);
  assert.equal(button(apk, 'Scan a handoff QR').length, 1,
    'the phone app does not offer "Scan a handoff QR" — the native scan path is gone');
  assert.equal(button(web, 'Scan a handoff QR').length, 0,
    'the web/Suite console still shows "Scan a handoff QR" — the camera trigger leaked outside the APK');
  // The DISPLAY button needs no camera and must stay on EVERY platform — proves the gate did not over-reach.
  assert.equal(button(apk, 'Show handoff QR').length, 1, 'the APK lost the "Show handoff QR" display button');
  assert.equal(button(web, 'Show handoff QR').length, 1,
    'the web/Suite console lost the "Show handoff QR" display button — the fix hid a button that needs no camera');
});
