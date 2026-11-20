// The network view's header "New post" must reach publishNetworkPost (sealed 30078 netann), never the
// church kind-1 publisher the relay refuses for a network key (sim 2026-11-20 D1; the relay's acceptance of
// what publishNetworkPost emits is pinned by a-sealed-network-posts-are-accepted-and-served-by-the-relay).
// Executes the REAL pieces: the render-site ternary compiled from the dashboard source, the real
// NetworkHeaderPostModal + NetworkAnnounceComposer driven to a post. Run:
// node --test scripts/network-view-new-post-routes-sealed.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { miniReact, find, texts } from './render-jsx-screen.mjs';
import { fnBody } from './test-slice.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DASH = readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8');

const SITE = '{posting ? (stewNetView(church) ? <NetworkHeaderPostModal onClose={() => setPosting(false)} /> : <NewPostModal onClose={() => setPosting(false)} />) : null}';

test('the render site routes by stewNetView: network view mounts the network composer, church view keeps NewPostModal', () => {
  const sites = DASH.split(SITE).length - 1;
  assert.equal(sites, 2, 'the routed render site must exist at BOTH header layouts (narrow + wide); found ' + sites);
  // compile and EXECUTE the real expression + the real stewNetView — a dead-switched ternary or gate fails here
  const expr = SITE.slice(1, -1);   // strip the JSX braces
  const sv = fnBody(DASH, 'function stewNetView(church) {', 'stewNetView');
  const tmp = join(tmpdir(), 'route-' + process.pid + '.jsx');
  let js;
  try {
    writeFileSync(tmp, sv + '\nexport const route = (posting, church, NetworkHeaderPostModal, NewPostModal, setPosting, React, window) => (' + expr + ');\n');
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=cjs', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const mod = { exports: {} };
  new Function('module', 'exports', 'window', js)(mod, mod.exports, { NETWORKS_ENABLED: true });
  const React = { createElement: (type, props) => ({ type, props }) };
  const NET = () => {}, CHURCH = () => {};
  const on = mod.exports.route(true, { isNetwork: true }, NET, CHURCH, () => {}, React, { NETWORKS_ENABLED: true });
  assert.equal(on && on.type, NET, 'network view did not mount the network post modal');
  const off = mod.exports.route(true, { isNetwork: false }, NET, CHURCH, () => {}, React, { NETWORKS_ENABLED: true });
  assert.equal(off && off.type, CHURCH, 'church view no longer mounts NewPostModal — the routing broke the church side');
  assert.equal(mod.exports.route(false, { isNetwork: true }, NET, CHURCH, () => {}, React, { NETWORKS_ENABLED: true }), null);
});

test('the real network post modal posts through publishNetworkPost — the sealed path, never publishPost', async () => {
  const { React, draw } = miniReact();
  const src = fnBody(DASH, 'function NetworkAnnounceComposer() {', 'NetworkAnnounceComposer')
    + '\n' + fnBody(DASH, 'function NetworkHeaderPostModal({ onClose }) {', 'NetworkHeaderPostModal');
  const tmp = join(tmpdir(), 'netpost-' + process.pid + '.jsx');
  let js;
  try {
    writeFileSync(tmp, src + '\nexport { NetworkHeaderPostModal };\n');
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const calls = [];
  const globals = {
    React,
    Icon: () => null,
    useStewDialog: () => ({ current: null }),
    useNetDisplayName: () => 'Thames Churches',
    window: {
      addEventListener: () => {}, removeEventListener: () => {},
      Steward: {
        ownedNetworks: () => [{ pub: 'n'.repeat(64), name: 'Thames Churches' }],
        publishNetworkPost: async (np, kind, body) => { calls.push(['publishNetworkPost', np, kind, body]); return { ok: true }; },
        publishPost: async () => { calls.push(['publishPost']); return true; },
        readNetworkPosts: async () => [],
        subscribeNetworkPosts: () => () => {},
      },
    },
  };
  const key = '__netpost_' + Math.random().toString(36).slice(2);
  globalThis[key] = globals;
  const preamble = Object.keys(globals).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  const { NetworkHeaderPostModal } = await import('data:text/javascript;base64,' + Buffer.from(preamble + '\n' + js).toString('base64'));
  const props = { onClose: () => {} };
  let tree = draw(NetworkHeaderPostModal, props);
  const ta = find(tree, n => n.type === 'textarea');
  assert.ok(ta.length, 'no composer textarea — the network composer did not mount in the modal');
  ta[0].props.onChange({ target: { value: 'Advent carol service — all welcome' } });
  tree = draw(NetworkHeaderPostModal, props);
  const post = find(tree, n => n.type === 'button' && /post/i.test(texts(n).join(' ')) && !/close/i.test(texts(n).join(' ')));
  assert.ok(post.length, 'no Post control in the modal');
  await post[0].props.onClick();
  const call = calls.find(c => c[0] === 'publishNetworkPost');
  assert.ok(call, 'posting from the network modal never reached publishNetworkPost');
  assert.equal(call[2], 'announcement');
  assert.equal(call[3].text, 'Advent carol service — all welcome');
  assert.ok(!calls.some(c => c[0] === 'publishPost'), 'the modal fell through to the church kind-1 publisher — the relay refuses that for a network key');
});
