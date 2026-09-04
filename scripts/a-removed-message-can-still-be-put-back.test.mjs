// REMOVING A MESSAGE MUST STAY REVERSIBLE FOR LONGER THAN NINE SECONDS.
// Run: node --test scripts/a-removed-message-can-still-be-put-back.test.mjs
//
// Measured 2026-09-04. Removal is reversible by design — it publishes `trinityone/hidden:<msgId>` and
// unhideMessage republishes that d-tag with empty content; the kind-1 is never deleted (the relay's
// `deletions` table stayed empty and no kind-5 was ever written). But the ONLY route to unhideMessage was
// an Undo on a banner that clears itself after nine seconds:
//
//     modTimer.current = setTimeout(() => setModMsg(null), 9000);
//
// I detected the Undo, and my next command four seconds later got "NOT FOUND: Undo". A steward who removes
// a message and then pauses — reads it again, checks with someone — could not put it back at all, and
// unhideMessage had no other caller on either surface. The audit that added it (2026-09-02 #16) recorded
// that it "has been built on both surfaces since the feature landed and was called by nothing"; it was
// then called from one control that disappears.
//
// The fix surfaces removed messages to the CONSOLE as a row carrying "Put back". The member app is
// untouched and still drops them entirely — this is a moderator seeing their own decision, never a way
// for a congregation to read what was removed, which is why the text is NOT reprinted in the row.
//
// Point of use (rule 1): this drives the real GroupChatModal out of app/stew-dashboard.jsx.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fnBody } from './test-slice.mjs';
const VENDOR = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
import { miniReact, find, texts } from './render-jsx-screen.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const STEW = readFileSync(join(ROOT, 'app/stew-dashboard.jsx'), 'utf8');

async function loadConsoleComponent(name, anchor, globals) {
  const src = fnBody(STEW, anchor, name);
  const tmp = join(tmpdir(), 'putback-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, src + `\nexport { ${name} };\n`);
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const key = '__pb_' + Math.random().toString(36).slice(2);
  globalThis[key] = globals;
  const preamble = Object.keys(globals).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  return (await import('data:text/javascript;base64,' + Buffer.from(preamble + '\n' + js).toString('base64')))[name];
}
const Stub = (n) => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };

const GROUP = { id: 'g-1', name: 'Whole Church', kind: 'group' };
const REMOVED = { id: 'm-removed', by: 'aa11', mine: false, text: '', ts: 100, removed: true, reactions: [], name: 'Ruth' };
const NORMAL  = { id: 'm-normal',  by: 'bb22', mine: false, text: 'still here', ts: 101, reactions: [], name: 'Ada' };

async function chat({ msgs = [REMOVED, NORMAL], unhide = () => Promise.resolve({ ok: 1 }) } = {}) {
  const { React, draw } = miniReact();
  const unhidden = [];
  const win = {
    Steward: {
      subscribeGroupChat: (id, cb) => { cb(msgs); return () => {}; },
      subscribeGroupPin: (id, cb) => { cb(null); return () => {}; },
      subscribeGroupEvents: (id, cb) => { cb([]); return () => {}; },
      unhideMessage: (gid, mid) => { unhidden.push([gid, mid]); return unhide(gid, mid); },
      hideMessage: () => Promise.resolve({ ok: 1 }),
      publishPost: () => Promise.resolve({ ok: 1 }),
      reactGroup: () => Promise.resolve({ ok: 1 }),
      pinPost: () => Promise.resolve({ ok: 1 }), unpin: () => Promise.resolve({ ok: 1 }),
    },
    useStewardMembers: () => [], dispatchEvent: () => true,
    addEventListener() {}, removeEventListener() {},
  };
  const Comp = await loadConsoleComponent('GroupChatModal', 'function GroupChatModal({ group, onClose }) {', {
    React, window: win, CustomEvent, setTimeout, clearTimeout,
    Icon: Stub('Icon'), SkBadge: Stub('SkBadge'), SkConfirm: Stub('SkConfirm'),
    EventComposer: Stub('EventComposer'), useStewDialog: () => ({}),
    initialsFor: () => 'XX', avFor: () => '', nameFor: (pk) => (pk === 'aa11' ? 'Ruth' : 'Ada'),
    GROUP_EMOJI: ['❤️'],
  });
  // miniReact runs effects AFTER the render that queued them, exactly as React does — so the first draw
  // still has msgs = []. Draw twice: the second is the render that sees what subscribeGroupChat delivered.
  let tree = draw(Comp, { group: GROUP, onClose: () => {} });
  const redraw = () => { tree = draw(Comp, { group: GROUP, onClose: () => {} }); return tree; };
  redraw();
  return { tree: () => tree, redraw, unhidden, all: () => texts(tree).join(' | ') };
}

test('THE FIX: a removed message still offers a way back, with no time limit', async () => {
  const c = await chat();
  const putBack = find(c.tree(), n => n.type === 'button' && /Put back/.test(texts(n).join(' ')));
  assert.ok(putBack.length,
    'a removed message left no way to restore it. unhideMessage exists and works, but its only caller was ' +
    'an Undo banner that clears after 9 seconds — so a steward who paused lost the message for good.');
});

test('the row says a message was removed, and does NOT reprint what it said', async () => {
  const c = await chat({ msgs: [{ ...REMOVED, text: 'the words that were removed' }, NORMAL] });
  const screen = c.all();
  assert.match(screen, /removed/i, 'nothing on screen says a message was removed');
  assert.doesNotMatch(screen, /the words that were removed/,
    'the removed text is reprinted in the console. Removal is a moderation decision, not a reading list — ' +
    'and a row that shows the words is a reason not to use Remove at all.');
  assert.match(screen, /still here/, 'the surviving message vanished — the fix must not hide live messages');
});

test('pressing it calls unhideMessage for THAT message in THAT group', async () => {
  const c = await chat();
  const btn = find(c.tree(), n => n.type === 'button' && /Put back/.test(texts(n).join(' ')))[0];
  await btn.props.onClick();
  assert.deepEqual(c.unhidden, [['g-1', 'm-removed']],
    'Put back restored the wrong message, or none — it must name the group and the message it belongs to');
});

test('a refusal says it is STILL removed rather than painting it restored', async () => {
  const c = await chat({ unhide: () => Promise.resolve(null) });   // no relay accepted
  const btn = find(c.tree(), n => n.type === 'button' && /Put back/.test(texts(n).join(' ')))[0];
  await btn.props.onClick();
  await new Promise(r => setTimeout(r, 0));
  const screen = c.redraw() && texts(c.tree()).join(' | ');
  assert.match(screen, /Couldn.t put it back/,
    'the relay refused the restore and the console said nothing. A message still hidden on the relay that ' +
    'polices this church is still hidden for every member, so silence here is a false all-clear.');
});


// THE OTHER HALF. The tests above hand the component a message already marked `removed: true`, so they
// cannot see a regression in the ENGINE that decides which messages get marked. If subscribeGroupChat goes
// back to dropping hidden ids, a removed message never reaches the component at all and every test above
// still passes — the row is simply never asked for.
//
// Asserted against the SHIPPED bundle, where esbuild strips dead code, so a match means reachable rather
// than merely present (rule 3: this is vendor/, not app/).
test('the console engine MARKS a removed message instead of dropping it', () => {
  const body = fnBody(VENDOR, 'subscribeGroupChat(groupId, onMsgs) {', 'subscribeGroupChat');
  assert.ok(body.length > 800, 'subscribeGroupChat sliced to a stub — re-anchor rather than widening');
  assert.doesNotMatch(body, /\.filter\(\s*\w+\s*=>\s*!\s*hidden\.has\(/,
    'the console is dropping removed messages again, so nothing can offer to put one back — the "Put back" ' +
    'row is never rendered because the message never arrives');
  assert.match(body, /hidden\.has\([^)]*\)\)\s*return\s*\{[^}]*removed:\s*true/,
    'removed messages are no longer marked, so the console cannot tell one from a live message');
  // esbuild normalises string quotes, so accept either — matching only one is how a test starts failing
  // on a rebuild that changed nothing.
  assert.match(body, /removed:\s*true,\s*text:\s*(''|"")/,
    'a removed message is being handed to the console WITH its text. The console must be able to say a ' +
    'message was removed without reprinting what it said.');
});

// And the member app must NOT have gained the same behaviour: this is a moderator view, not a way for a
// congregation to read what a steward removed.
test('the MEMBER app still drops removed messages entirely', () => {
  const FELLOW = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
  assert.doesNotMatch(FELLOW, /removed:\s*true/,
    'the member bundle now carries the console\'s removed-message marking. A member must never be shown ' +
    'that a message was removed, let alone offered anything about it.');
});
