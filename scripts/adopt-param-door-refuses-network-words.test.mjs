// The HEADLESS ?adopt= door (sim 2026-11-21 RS-3): a network-words link must not adopt, publish, or mark
// the wizard done — and the refusal must land somewhere a screen can show. Drives the REAL door block
// sliced from app/steward-root.jsx; adoptChurch is the spy (its own refusal logic has its own file).
// Run: node --test scripts/adopt-param-door-refuses-network-words.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';

const ROOT_SRC = readFileSync(new URL('../app/steward-root.jsx', import.meta.url), 'utf8');
const BLOCK = fnBody(ROOT_SRC, 'if (adopt && !stewIsFinanceApp() && !window.Steward.hasKey) {', 'the ?adopt= door');

function door({ adoptImpl }) {
  const log = { ls: {}, ss: {}, events: [] };
  const win = {
    Steward: { hasKey: false, adoptChurch: adoptImpl },
    dispatchEvent: (e) => log.events.push(e && e.type),
  };
  const run = new Function('adopt', 'window', 'sessionStorage', 'localStorage', 'CustomEvent', 'stewIsFinanceApp',
    BLOCK)
    .bind(null, 'word '.repeat(11) + 'word',
      win,
      { setItem: (k, v) => { log.ss[k] = v; }, getItem: () => null, removeItem: () => {} },
      { setItem: (k, v) => { log.ls[k] = v; }, getItem: () => null, removeItem: () => {} },
      class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
      () => false);   // stewIsFinanceApp: this is the CONSOLE door; the finance app (true) is the one that must NOT adopt
  return { run, log };
}
const settle = () => new Promise(r => setTimeout(r, 0)).then(() => new Promise(r => setTimeout(r, 0)));

test('network words through ?adopt=: NO adoption marker, and the refusal lands for the landing screen', async () => {
  const err = Object.assign(new Error('These are a NETWORK’s recovery words…'), { networkKey: true });
  const { run, log } = door({ adoptImpl: async () => { throw err; } });
  run(); await settle();
  assert.equal(log.ls['trinityone.steward.wizard.done'], undefined,
    'the wizard-done marker was written for a REFUSED adoption — the door did not gate on the check (RS-3)');
  assert.ok(String(log.ss['trinityone.steward.adoptrefused'] || '').includes('NETWORK'),
    'the refusal never reached sessionStorage — the landing has nothing to show');
  assert.ok(log.events.includes('steward-adopt-refused'), 'the late-refusal event never fired');
});

test('church words through the same door still adopt (control)', async () => {
  const calls = [];
  const { run, log } = door({ adoptImpl: async (p) => { calls.push(p); return { npub: 'npub1x' }; } });
  run(); await settle();
  assert.equal(calls.length, 1, 'the door no longer adopts at all');
  assert.equal(log.ls['trinityone.steward.wizard.done'], '1', 'a restored church must skip the new-church wizard');
  assert.equal(log.ss['trinityone.steward.adoptrefused'], undefined);
});

test('an ordinary bad phrase stays silent, exactly as before (control)', async () => {
  const { run, log } = door({ adoptImpl: async () => { throw new Error('That phrase isn’t valid.'); } });
  run(); await settle();
  assert.equal(log.ls['trinityone.steward.wizard.done'], undefined);
  assert.equal(log.ss['trinityone.steward.adoptrefused'], undefined);
  assert.equal(log.events.length, 0);
});
