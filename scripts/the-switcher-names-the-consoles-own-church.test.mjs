// THE IDENTITY SWITCHER'S "YOUR CHURCH" ROW NAMES THE CONSOLE'S OWN CHURCH — NOT THE ONE IT IS ACTING FOR.
//   Run: node --test scripts/the-switcher-names-the-consoles-own-church.test.mjs
//
// Device round 2026-10-01 (Oppo). While the console was acting as a steward for church B, the header switcher's
// row for the console's OWN church read B's name: the label came from `church`, the profile of whatever the
// console is running now. The engine now remembers the own church's name whenever it reads its own kind-0
// (identities(), _ownChurchName) and the row shows that — or "Your church", never another church's name.
//
// The real IdentitySwitcher, compiled out of app/stew-dashboard.jsx and rendered (rule 3); and the engine side
// out of the shipped bundle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { miniReact, texts, find } from './render-jsx-screen.mjs';
import { fnBody } from './test-slice.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const DASH = readFileSync(join(ROOT, 'app/stew-dashboard.jsx'), 'utf8');
const BUNDLE = readFileSync(join(ROOT, 'vendor/steward.js'), 'utf8');
const A = 'a'.repeat(64), B = 'b'.repeat(64);
const reads = (t) => texts(t).join(' ').replace(/\s+/g, ' ').trim();
// what a row SAYS: the text of its children, not its icons' names and colours
const said = (n) => { const out = []; const walk = (x) => { if (x == null || x === false) return; if (typeof x === 'string' || typeof x === 'number') { out.push(String(x)); return; } if (Array.isArray(x)) { x.forEach(walk); return; } (x.kids || []).forEach(walk); }; walk(n); return out.join(' ').replace(/\s+/g, ' ').trim(); };

async function switcher({ ids, activePub, delegated, church }) {
  const { React, draw } = miniReact();
  const src = fnBody(DASH, 'function IdentitySwitcher(', 'IdentitySwitcher');
  const tmp = join(tmpdir(), 'idsw-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, src + '\nexport { IdentitySwitcher };\n');
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const g = {
    React, Icon: () => null, SkBadge: () => null, useStewNarrow: () => false, churchHandle: () => '',
    window: {
      useStewardIdv: () => 0, useStewardStewardedChurches: () => [B],
      Steward: { identities: () => ids, activePub, isViewingNetwork: () => false, isDelegated: () => delegated, setActiveIdentity() {} },
      addEventListener() {}, removeEventListener() {},
    },
  };
  const key = '__idsw_' + Math.random().toString(36).slice(2);
  globalThis[key] = g;
  const preamble = Object.keys(g).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  const mod = await import('data:text/javascript;base64,' + Buffer.from(preamble + '\n' + js).toString('base64'));
  delete globalThis[key];
  const props = { church, churchName: church.name || 'Your church', initials: 'XX', onEditName() {} };
  let tree = draw(mod.IdentitySwitcher, props);
  const toggle = find(tree, n => n && n.type === 'button' && /Switch between your church/.test(String((n.props || {}).title || '')));
  assert.equal(toggle.length, 1, 're-anchor: the switcher has no single toggle');
  toggle[0].props.onClick();
  tree = draw(mod.IdentitySwitcher, props);
  // the rows of the open list: one per identity, each a button whose second line says what it is
  const rowFor = (sub) => find(tree, n => n && n.type === 'button' && said(n).endsWith(sub)).map(said);
  return { own: rowFor('Your church'), stewarded: rowFor('You steward this church') };
}

test('THE CALL SITE: acting for church B, the "Your church" row names the console\'s OWN church', async () => {
  const s = await switcher({
    ids: [{ kind: 'church', pub: A, name: 'St Aidan' }, { kind: 'steward', pub: B, name: 'St Bede' }],
    activePub: B, delegated: true, church: { name: 'St Bede' },   // the profile on screen is B's
  });
  assert.equal(s.own.length, 1, 're-anchor: no "Your church" row in the open switcher');
  assert.doesNotMatch(s.own[0], /St Bede/, 'THE OWN CHURCH\'S ROW SAYS THE STEWARDED CHURCH\'S NAME: ' + s.own[0]);
  assert.match(s.own[0], /St Aidan/, 'the own church\'s row does not name it: ' + s.own[0]);
});
test('…and with no name known for the own church, it says "Your church" — never another church\'s name', async () => {
  const s = await switcher({ ids: [{ kind: 'church', pub: A, name: '' }, { kind: 'steward', pub: B, name: 'St Bede' }], activePub: B, delegated: true, church: { name: 'St Bede' } });
  assert.doesNotMatch(s.own[0], /St Bede/, 'the own church\'s row borrowed the stewarded church\'s name: ' + s.own[0]);
});
test('CONTROL: on its own church the row shows the live profile name', async () => {
  const s = await switcher({ ids: [{ kind: 'church', pub: A, name: 'Old Name' }, { kind: 'steward', pub: B, name: 'St Bede' }], activePub: A, delegated: false, church: { name: 'St Aidan' } });
  assert.match(s.own[0], /St Aidan/, 'on its own church the row no longer follows the profile on screen (a rename would not show): ' + s.own[0]);
});

test('THE ENGINE: identities() names the own church from what its own kind-0 said, and only its own', () => {
  const store = new Map();
  const ls = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
  const helpers = ['function lsGet(k) {', 'function lsSet(k, v) {', 'function _rememberOwnName(n) {', 'function _ownChurchName() {'].map(a => fnBody(BUNDLE, a, a)).join('\n');
  const constAt = BUNDLE.indexOf('var OWN_NAME_LS = ');
  assert.ok(constAt > 0, 're-anchor: OWN_NAME_LS is not in the shipped bundle');
  const constLine = BUNDLE.slice(constAt, BUNDLE.indexOf(';', constAt) + 1);
  const scope = { churchPub: A, localStorage: ls };
  const api = new Function(...Object.keys(scope), constLine + '\n' + helpers + '\nreturn { _rememberOwnName, _ownChurchName };')(...Object.values(scope));
  assert.equal(api._ownChurchName(), '', 'CONTROL: a name before anything was read');
  api._rememberOwnName('St Aidan');
  assert.equal(api._ownChurchName(), 'St Aidan', 'the own church\'s name was not remembered');
  // subscribeProfile remembers only the OWN church's kind-0 — the call is gated on the author in the shipped reader
  const reader = fnBody(BUNDLE, '  subscribeProfile(onProfile) {', 'subscribeProfile');
  assert.match(reader, /e\.pubkey === churchPub\) _rememberOwnName\(/, 'subscribeProfile remembers a name without checking it is the own church\'s kind-0');
  const ids = fnBody(BUNDLE, '  identities() {', 'identities');
  assert.match(ids, /kind: "church"[^}]*name: _ownChurchName\(\)/, 'identities() no longer hands the switcher the own church\'s name');
});
