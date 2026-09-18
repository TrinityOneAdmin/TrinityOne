// A STEWARD TYPES A NOTICE, IT REACHES NO RELAY, AND THE WORDS ARE DESTROYED.
// Run: node --test scripts/a-steward-post-that-failed-keeps-the-words.test.mjs
//
// Three console composers cleared what was typed and closed on success WITHOUT looking at the answer:
//
//     try { await window.Steward.publishPost(text.trim(), target); } catch {}
//     onClose();                                   // ← NewPostModal
//     window.Steward.publishPost(text.trim(), group.id); setText('');   // ← GroupChatModal
//     await window.Steward.publishNetworkAnnouncement(net.pub, text.trim()); setText(''); setSent(true);
//
// `publishPost` and `publishNetworkAnnouncement` RESOLVE `false` / `null` when the publish set was empty or
// every relay refused — they do not throw — so a bare try/catch never fires and the success arm is taken over
// a total failure. A steward posts "the service has moved to 9am", nobody receives it, and the sentence no
// longer exists to send again. In GroupChatModal it is usually a reply to somebody still waiting for it.
//
// POINT OF USE (CLAUDE.md rule 1): these tests RENDER the real components out of app/stew-dashboard.jsx,
// type into them, fail the publish, and then read what is on the drawn screen. They do not match text in
// app/*.jsx — rule 3: that file ships unbundled, so `false && ` in front of a condition would leave every
// word of it in place and a text-matching assertion would still pass.
//
// Every case has its CONTROL twin: the same component with a publish that is ACCEPTED. Without those,
// "never clear the box and never close" would pass all of the failure tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fnBody } from './test-slice.mjs';
import { miniReact, find, texts } from './render-jsx-screen.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const STEW = readFileSync(join(ROOT, 'app/stew-dashboard.jsx'), 'utf8');

// Slice ONE component out of the console and compile it the way the packaged build does. Same recipe as
// scripts/a-removed-message-can-still-be-put-back.test.mjs and a-dm-that-never-sent-is-not-sent.test.mjs.
async function loadConsoleComponent(name, anchor, globals) {
  const src = fnBody(STEW, anchor, name);
  const tmp = join(tmpdir(), 'keepwords-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, src + `\nexport { ${name} };\n`);
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const key = '__kw_' + Math.random().toString(36).slice(2);
  globalThis[key] = globals;
  const preamble = Object.keys(globals).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  return (await import('data:text/javascript;base64,' + Buffer.from(preamble + '\n' + js).toString('base64')))[name];
}
const Stub = (n) => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };
const settle = () => new Promise(r => setTimeout(r, 0));

// The words a steward would be most sorry to lose. Deliberately not a word that appears anywhere in the
// console's own copy, so a match can only have come from what was typed.
const TYPED = 'The service has moved to 9am this Sunday';

// ───────────────────────── NewPostModal — the announcement dialog ─────────────────────────

async function newPost({ accepted }) {
  const { React, draw } = miniReact();
  const posted = [];
  let closed = 0;
  const win = {
    Steward: { publishPost: (t, g) => { posted.push([t, g]); return Promise.resolve(accepted ? { id: 'evt' } : false); } },
    useStewardGroups: () => [{ id: 'g-broadcast', name: 'Announcements', kind: 'broadcast' }],
  };
  const Comp = await loadConsoleComponent('NewPostModal', 'function NewPostModal({ onClose }) {', {
    React, window: win, Icon: Stub('Icon'), useStewDialog: () => ({}),
  });
  const props = { onClose: () => { closed++; } };
  let tree = draw(Comp, props);
  const redraw = () => (tree = draw(Comp, props));
  const type = (v) => { find(tree, n => n.type === 'textarea')[0].props.onChange({ target: { value: v } }); redraw(); };
  const press = async (label) => {
    const b = find(tree, n => n.type === 'button' && texts(n).join(' ').includes(label));
    assert.ok(b.length, `no "${label}" button on the New post dialog — re-anchor this test`);
    await b[0].props.onClick();
    await settle(); redraw();
  };
  return {
    type, press, posted, closedCount: () => closed,
    screen: () => texts(tree).join(' | '),
    draftValue: () => (find(tree, n => n.type === 'textarea')[0] || { props: {} }).props.value,
  };
}

test('THE FIX — a New post the relays refused keeps the steward’s words on the screen', async () => {
  const c = await newPost({ accepted: false });
  c.type(TYPED);
  await c.press('Post');
  assert.deepEqual(c.posted, [[TYPED, 'g-broadcast']], 'the dialog did not attempt the post at all — re-anchor this test');
  assert.equal(c.draftValue(), TYPED,
    'the composer was emptied over a post that reached no relay. "The service has moved to 9am" was ' +
    'received by nobody and no longer exists to send again.');
  assert.equal(c.closedCount(), 0, 'the dialog closed on a failure, exactly as it closes on a success');
});

test('and it SAYS so, in words on the screen, rather than failing in silence', async () => {
  const c = await newPost({ accepted: false });
  c.type(TYPED);
  await c.press('Post');
  assert.match(c.screen(), /didn’t post/,
    'nothing on the drawn screen says the post failed, so a steward who is still looking at their own ' +
    'words has no way to tell a stuck dialog from a sent notice');
  assert.match(c.screen(), /still here/, 'the steward is not told their words were kept');
});

test('CONTROL — an ACCEPTED New post still closes the dialog', async () => {
  // Without this row, "never close, never clear" passes every failure test above.
  const c = await newPost({ accepted: true });
  c.type(TYPED);
  await c.press('Post');
  assert.deepEqual(c.posted, [[TYPED, 'g-broadcast']], 'the accepted post never reached publishPost');
  assert.equal(c.closedCount(), 1, 'a post a relay accepted must still close the dialog');
  assert.doesNotMatch(c.screen(), /didn’t post/, 'a successful post is reporting a failure — the opposite lie');
});

// ───────────────────────── GroupChatModal — the console’s reply box ─────────────────────────

const GROUP = { id: 'g-1', name: 'Whole Church', kind: 'group' };

async function chat({ accepted }) {
  const { React, draw } = miniReact();
  const posted = [];
  const win = {
    Steward: {
      subscribeGroupChat: (id, cb) => { cb([]); return () => {}; },
      subscribeGroupPin: (id, cb) => { cb(null); return () => {}; },
      subscribeGroupEvents: (id, cb) => { cb([]); return () => {}; },
      publishPost: (t, g) => { posted.push([t, g]); return Promise.resolve(accepted ? { id: 'evt' } : false); },
      reactGroup: () => Promise.resolve({ ok: 1 }), pinPost: () => Promise.resolve({ ok: 1 }),
      unpin: () => Promise.resolve({ ok: 1 }), hideMessage: () => Promise.resolve({ ok: 1 }),
      unhideMessage: () => Promise.resolve({ ok: 1 }), publishEvent: () => Promise.resolve({ id: 'e' }),
    },
    useStewardMembers: () => [], dispatchEvent: () => true, addEventListener() {}, removeEventListener() {},
  };
  const Comp = await loadConsoleComponent('GroupChatModal', 'function GroupChatModal({ group, onClose }) {', {
    React, window: win, CustomEvent, setTimeout, clearTimeout,
    Icon: Stub('Icon'), SkBadge: Stub('SkBadge'), useStewDialog: () => ({}),
  });
  const props = { group: GROUP, onClose: () => {} };
  let tree = draw(Comp, props);
  const redraw = () => (tree = draw(Comp, props));
  redraw();   // effects run after the draw that queued them, so the second draw is the one that sees them
  const box = () => find(tree, n => n.type === 'input' && n.props.placeholder === 'Message your church…')[0];
  return {
    posted,
    type: (v) => { box().props.onChange({ target: { value: v } }); redraw(); },
    send: async () => {
      const b = find(tree, n => n.type === 'button' && (n.props.title || '') === 'Send this message');
      assert.ok(b.length, 'no send button in the console chat — re-anchor this test');
      await b[0].props.onClick();
      await settle(); redraw();
    },
    screen: () => texts(tree).join(' | '),
    draftValue: () => (box() || { props: {} }).props.value,
  };
}

test('THE FIX — a console chat reply the relays refused stays in the box', async () => {
  const c = await chat({ accepted: false });
  c.type(TYPED);
  await c.send();
  assert.deepEqual(c.posted, [[TYPED, 'g-1']], 'the chat did not attempt the send at all — re-anchor this test');
  assert.equal(c.draftValue(), TYPED,
    'the box was cleared over a reply that reached no relay. This is usually an answer to a person who is ' +
    'still waiting for it, and the steward watched it vanish into a room it never entered.');
});

test('and the console chat SAYS the reply did not send', async () => {
  const c = await chat({ accepted: false });
  c.type(TYPED);
  await c.send();
  assert.match(c.screen(), /didn’t send/,
    'the reply failed and the screen said nothing — identical to a reply that went');
});

test('CONTROL — an ACCEPTED console chat reply still empties the box', async () => {
  const c = await chat({ accepted: true });
  c.type(TYPED);
  await c.send();
  assert.equal(c.draftValue(), '',
    'a reply a relay accepted is still sitting in the box, so the steward sends it twice');
  assert.doesNotMatch(c.screen(), /didn’t send/, 'a successful reply is being reported as a failure');
});

// ───────────────────── NetworkAnnounceComposer — a broadcast to every church ─────────────────────

async function netAnnounce({ accepted }) {
  const { React, draw } = miniReact();
  const posted = [];
  const win = {
    Steward: {
      ownedNetworks: () => [{ pub: 'net-pub', npub: 'npub1net', name: 'Regions Beyond' }],
      publishNetworkAnnouncement: (p, t) => { posted.push([p, t]); return Promise.resolve(accepted ? { id: 'evt' } : null); },
      subscribeNetworkAnnouncements: (p, cb) => { cb([]); return () => {}; },
      subscribeNetworkProfile: (p, cb) => { cb(null); return () => {}; },
    },
    addEventListener() {}, removeEventListener() {},
  };
  const Comp = await loadConsoleComponent('NetworkAnnounceComposer', 'function NetworkAnnounceComposer() {', {
    React, window: win, Icon: Stub('Icon'), setTimeout,
  });
  let tree = draw(Comp, {});
  const redraw = () => (tree = draw(Comp, {}));
  redraw();
  return {
    posted,
    type: (v) => { find(tree, n => n.type === 'textarea')[0].props.onChange({ target: { value: v } }); redraw(); },
    post: async () => {
      const b = find(tree, n => n.type === 'button' && /Post announcement|Posting/.test(texts(n).join(' ')));
      assert.ok(b.length, 'no "Post announcement" button — re-anchor this test');
      await b[0].props.onClick();
      await settle(); redraw();
    },
    screen: () => texts(tree).join(' | '),
    draftValue: () => (find(tree, n => n.type === 'textarea')[0] || { props: {} }).props.value,
  };
}

test('THE FIX — a network announcement that reached nowhere keeps its words', async () => {
  const c = await netAnnounce({ accepted: false });
  c.type(TYPED);
  await c.post();
  assert.deepEqual(c.posted, [['net-pub', TYPED]], 'the composer did not attempt the announcement — re-anchor this test');
  assert.equal(c.draftValue(), TYPED,
    'the box was emptied over a broadcast that reached not one church in the network');
  assert.doesNotMatch(c.screen(), /Sent/,
    'a green "Sent" tick was lit over a network announcement nobody received');
  assert.match(c.screen(), /didn’t post/, 'nothing on screen says the announcement failed');
});

test('CONTROL — an ACCEPTED network announcement still clears the box and says Sent', async () => {
  const c = await netAnnounce({ accepted: true });
  c.type(TYPED);
  await c.post();
  assert.equal(c.draftValue(), '', 'an accepted announcement is still sitting in the box');
  assert.match(c.screen(), /Sent/, 'an accepted announcement no longer confirms itself');
});
