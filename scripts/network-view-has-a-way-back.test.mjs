// NETWORK VIEW SHOWS A ONE-TAP "BACK TO <CHURCH>" — AND CHURCH VIEW SHOWS NOTHING.
// Run: node --test scripts/network-view-has-a-way-back.test.mjs
// Owner 2026-10-22: the only way back was the identity dropdown. NetworkBackBar (app/stew-dashboard.jsx) is lifted
// and RENDERED (rule 3: no text matching). Not covered: that StewDashboard mounts it (the file is too big to render);
// both mounts are one line each, <NetworkBackBar church={church} />, in the phone and desktop layouts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';
import { miniReact, find, button, texts } from './render-jsx-screen.mjs';
import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('../', import.meta.url).pathname;
const SRC = readFileSync(join(ROOT, 'app/stew-dashboard.jsx'), 'utf8');
// PORTED 2026-11-19 (B2a): the bar now asks stewNetView (network identity AND the Networks switch on), so that is lifted with it.
const body = fnBody(SRC, 'function stewNetView(', 'stewNetView') + '\n' + fnBody(SRC, 'function NetworkBackBar(', 'NetworkBackBar');
const dir = mkdtempSync(join(tmpdir(), 'trin-netback-'));
const f = join(dir, 'x.jsx'); writeFileSync(f, body);
const js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [f, '--jsx=transform', '--log-level=error'], { encoding: 'utf8' });
rmSync(dir, { recursive: true, force: true });

function render(church, { on = true } = {}) {
  const calls = [];
  const { React, draw } = miniReact();
  globalThis.window = { NETWORKS_ENABLED: on, Steward: { churchPub: 'CHURCHPUB', identities: () => [{ kind: 'church', pub: 'CHURCHPUB', name: "St Bede's" }, { kind: 'network', pub: 'NET', name: 'Region' }], setActiveIdentity: (p) => calls.push(p) } };
  const C = new Function('React', js + '\nreturn NetworkBackBar;')(React);
  return { tree: draw(C, { church }), calls };
}

test('network view: a visible "Back to <church>" button that returns to the church pubkey', () => {
  const { tree, calls } = render({ isNetwork: true, name: 'Region' });
  const b = button(tree, 'Back to St Bede');
  assert.equal(b.length, 1, 'no one-tap way back from network view');
  b[0].props.onClick();
  assert.deepEqual(calls, ['CHURCHPUB']);
});

test('church view: nothing is rendered', () => {
  for (const c of [{ isNetwork: false, name: 'X' }, {}, null]) {
    const { tree } = render(c);
    assert.equal(find(tree, n => n.type === 'button').length, 0, 'a back-to-church control appeared in church view');
    assert.equal(texts(tree).join('').includes('Back to'), false);
  }
});

test('B2a: with the Networks switch OFF the bar is not drawn even in a network identity', () => {
  const { tree } = render({ isNetwork: true, name: 'Region' }, { on: false });
  assert.equal(button(tree, 'Back to St Bede').length, 0, 'the network bar shows while Networks is switched off');
});
