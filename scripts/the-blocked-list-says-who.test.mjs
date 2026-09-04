// A STEWARD MUST BE ABLE TO SEE WHO THEY BLOCKED.
// Run: node --test scripts/the-blocked-list-says-who.test.mjs
//
// AUDIT 2026-09-02 #17. Every row of the blocked list read "Blocked member", with a truncated public key
// under it. Blocking is one of the few irreversible-feeling things a steward does, and the list is the only
// place to undo it — so a list that will not say who anyone is means a steward who blocked the wrong person
// cannot find them to put it right, and a steward who blocked the right one cannot confirm it. The names
// were already in scope; nothing had to be fetched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fnBody } from './test-slice.mjs';
import { miniReact, texts, find } from './render-jsx-screen.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const STEW = readFileSync(join(ROOT, 'app/stew-dashboard.jsx'), 'utf8');
const Stub = (n) => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };

const BLOCKED = 'bb'.repeat(32);
const NAMELESS = 'cc'.repeat(32);

async function membersTab({ names = true } = {}) {
  const { React, draw } = miniReact();
  const NOW = Math.floor(Date.now() / 1000);
  const src = fnBody(STEW, 'function DashMembers()', 'DashMembers');
  const tmp = join(tmpdir(), 'blk-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, src + '\nexport { DashMembers };\n');
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const g = {
    React, CustomEvent, setTimeout, clearTimeout, Promise, Date, Math, JSON, Set, Object, String, Array,
    Panel: (p) => (p && p.children) || null,
    SkPill: (p) => (p && p.children) || null,
    DismissibleNote: (p) => (p && p.children) || null,
    Icon: (p) => (p && p.children) || null,
    location: { search: '', hostname: 'x' },
    document: { addEventListener() {}, removeEventListener() {}, createElement: () => ({ style: {}, appendChild() {}, remove() {}, click() {} }), body: { appendChild() {}, removeChild() {} } },
    window: {
      Steward: { setBlocked: () => Promise.resolve(true), setMinors: () => Promise.resolve(true),
                 setApproved: () => Promise.resolve(true), setGuardians: () => Promise.resolve(true),
                 setAdmitted: () => Promise.resolve(true), setNoPhoto: () => Promise.resolve(true) },
      useStewardGroups: () => [], useStewardStewards: () => [], useStewardChurch: () => ({}),
      useStewardBlocked: () => [BLOCKED, NAMELESS],
      useStewardSafeguard: () => ({ loaded: true, minorsKnown: true, clearedKnown: true, cleared: {}, minors: [], approved: [], nophoto: [] }),
      useStewardGuardians: () => ({}), useStewardJoinPolicy: () => false, useStewardAdmitted: () => [],
      useStewardMembers: () => (names
        ? [{ pubkey: BLOCKED, npub: 'npub1bb', name: 'Bram Whitlock', count: 2, lastTs: NOW - 3600, joined: NOW - 86400 }]
        : []),
      addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true,
    },
  };
  const key = '__blk_' + Math.random().toString(36).slice(2);
  globalThis[key] = g;
  const preamble = Object.keys(g).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  const mod = await import('data:text/javascript;base64,' + Buffer.from(preamble + '\n' + js).toString('base64'));
  let tree = draw(mod.DashMembers, {});
  const open = find(tree, n => n.type === 'button' && /blocked/i.test(texts(n).join(' ')) && n.props && n.props.onClick);
  if (open.length) { open[0].props.onClick(); tree = draw(mod.DashMembers, {}); }
  return texts(tree).join(' ');
}

test('CONTROL: the blocked list is on the page and can be opened', async () => {
  const words = await membersTab();
  assert.match(words, /blocked/i, 'no blocked section rendered at all — re-anchor this test');
});

test('A BLOCKED MEMBER IS NAMED, NOT LABELLED "Blocked member"', async () => {
  const words = await membersTab();
  assert.match(words, /Bram Whitlock/,
    'the blocked list does not say who was blocked. A steward who blocked the wrong person cannot find them ' +
    'to undo it, and one who blocked the right person cannot confirm it — the name was already in scope');
  assert.doesNotMatch(words, /Blocked member/,
    'the row still reads "Blocked member" for everyone');
});

test('…and somebody who never set a name is called out as exactly that', async () => {
  const words = await membersTab();
  assert.match(words, /no name set/i,
    'a blocked account with no display name shows only a truncated key, which tells a steward nothing. ' +
    'Say that they never set a name — that is the fact, and it is also the row worth looking at twice');
});
