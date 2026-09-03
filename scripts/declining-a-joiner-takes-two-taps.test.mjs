// DECLINING SOMEONE AT THE DOOR MUST TAKE TWO TAPS.
// Run: node --test scripts/declining-a-joiner-takes-two-taps.test.mjs
//
// AUDIT 2026-09-02 #5. On the join queue the ✕ sat a few pixels from Approve, and one tap on it blocked the
// person PERMANENTLY and rotated every one of the church's keys. No confirm, no undo, on the screen a
// steward moves fastest on — a mis-tap while admitting a new member did something irreversible to a
// stranger who had done nothing but ask to join.
//
// The members list has required two taps for this same action all along (`confirmBlock === m.pubkey ? …`).
// The safer version was twelve lines away in the same file. This test holds the two screens to one standard.
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
const WAITING = 'dd'.repeat(32);

async function joinQueue() {
  const { React, draw } = miniReact();
  const NOW = Math.floor(Date.now() / 1000);
  const blocked = [];
  const src = fnBody(STEW, 'function DashMembers()', 'DashMembers');
  const tmp = join(tmpdir(), 'decl-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, src + '\nexport { DashMembers };\n');
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const g = {
    React, CustomEvent, setTimeout, clearTimeout, Promise, Date, Math, JSON, Set, Object, String, Array,
    location: { search: '', hostname: 'x' },
    document: { addEventListener() {}, removeEventListener() {}, createElement: () => ({ style: {}, appendChild() {}, remove() {}, click() {} }), body: { appendChild() {}, removeChild() {} } },
    SK_TINT: { gold: { fg: '#000' }, sage: { fg: '#000' }, clay: { fg: '#000' }, ink: { fg: '#000' } },
    nameHandle: (m) => (m && m.name ? m.name.toLowerCase().replace(/\s+/g, '') : ''),
    shortNpub: (n) => String(n || '').slice(0, 12) + '…',
    Panel: (p) => (p && p.children) || null, Icon: (p) => null, SkPill: (p) => (p && p.children) || null,
    SkBadge: () => null, SkConfirm: () => null, DismissibleNote: (p) => (p && p.children) || null,
    window: {
      Steward: {
        setBlocked: (l) => { blocked.push(l); return Promise.resolve(true); },
        setAdmitted: () => Promise.resolve(true), setMinors: () => Promise.resolve(true),
        setApproved: () => Promise.resolve(true), setGuardians: () => Promise.resolve(true),
        setNoPhoto: () => Promise.resolve(true),
      },
      useStewardGroups: () => [], useStewardStewards: () => [], useStewardChurch: () => ({}),
      useStewardBlocked: () => [],
      useStewardSafeguard: () => ({ loaded: true, minorsKnown: true, clearedKnown: true, cleared: {}, minors: [], approved: [], nophoto: [] }),
      useStewardGuardians: () => ({}),
      // approval ON and this person NOT admitted = they are sitting in the join queue
      useStewardJoinPolicy: () => true, useStewardAdmitted: () => [],
      useStewardMembers: () => [{ pubkey: WAITING, npub: 'npub1dd', name: 'Nia Okafor', count: 0, lastTs: NOW - 600, joined: NOW - 600 }],
      addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true,
    },
  };
  const key = '__decl_' + Math.random().toString(36).slice(2);
  globalThis[key] = g;
  const preamble = Object.keys(g).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  const mod = await import('data:text/javascript;base64,' + Buffer.from(preamble + '\n' + js).toString('base64'));
  let tree = draw(mod.DashMembers, {});
  const redraw = () => { tree = draw(mod.DashMembers, {}); return tree; };
  const btn = (re) => find(tree, n => n.type === 'button' && n.props
    && re.test(String(n.props['aria-label'] || '') + ' ' + texts(n).join(' ')));
  return { blocked, redraw, btn, words: () => texts(tree).join(' ') };
}

test('CONTROL: someone waiting to join is shown with both an Approve and a Decline', async () => {
  const q = await joinQueue();
  assert.ok(q.btn(/Approve|Let .* in|check/i).length || /Nia Okafor/.test(q.words()),
    'the join queue did not render the waiting person at all — re-anchor this test');
  assert.equal(q.btn(/Decline/i).length, 1,
    `expected exactly one Decline control on a waiting row, found ${q.btn(/Decline/i).length}`);
});

test('ONE TAP ON DECLINE BLOCKS NOBODY — it asks first', async () => {
  const q = await joinQueue();
  q.btn(/Decline/i)[0].props.onClick();
  assert.deepEqual(q.blocked, [],
    'one tap on the ✕ beside Approve blocked this person permanently and rotated every church key. It sits ' +
    'a few pixels from Approve, on the screen a steward moves fastest on, and it cannot be undone');
  q.redraw();
  assert.ok(q.btn(/Confirm: block/i).length,
    'nothing asked the steward to confirm, so the press did nothing at all — worse than the bug');
});

test('…and the second tap is what actually blocks them, naming who', async () => {
  const q = await joinQueue();
  q.btn(/Decline/i)[0].props.onClick();
  q.redraw();
  const confirm = q.btn(/Confirm: block/i);
  assert.match(String(confirm[0].props['aria-label']), /Nia Okafor/,
    'the confirm does not name the person being refused entry');
  confirm[0].props.onClick();
  await new Promise(r => setTimeout(r, 5));
  assert.equal(q.blocked.length, 1, 'confirming did not block them, so the control no longer works at all');
  assert.ok(q.blocked[0].includes(WAITING), 'the wrong person was blocked');
});

test('CANCEL LEAVES THEM WAITING', async () => {
  const q = await joinQueue();
  q.btn(/Decline/i)[0].props.onClick();
  q.redraw();
  q.btn(/Cancel/i)[0].props.onClick();
  q.redraw();
  assert.deepEqual(q.blocked, [], 'cancelling the confirm still blocked them');
  assert.equal(q.btn(/Decline/i).length, 1, 'the row did not return to its resting state after Cancel');
});
