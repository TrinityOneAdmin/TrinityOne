// A PRIVATE MESSAGE THE RELAY HAS REFUSED MUST NOT BE DRAWN AS "WAITING TO SEND".
//   Run: node --test scripts/a-refused-private-message-is-not-waiting-to-send.test.mjs
//
// Sim finding (block A2, item 12). sendDM queues a private message BEFORE attempting it. When the relay
// refuses it by policy (`blocked: not a member or not permitted for this group` — a child and an adult who is
// not cleared for youth work) sendDM already noticed (`evt._refused`) and the composer toasted once. But the
// item stayed in the queue, so outboxForPeer reported it `_pending` and the thread drew "Waiting to send" —
// a promise the app knew was false — until the 45-second flush tick finally moved it to the failed bin, where
// the bubble then showed the raw relay string beside a "Try again" that can never work.
//
// THIS DRIVES THE REAL PATH, end to end: the REAL DMThread (app/screens-chat.jsx, rendered through the
// miniature React), typing into its composer and pressing its Send button, which calls the SHIPPED sendDM
// lifted out of vendor/fellowship.js, whose queue the SHIPPED outboxForPeer and _outboxSave read and notify.
// Only the network is replaced: `_publishBounded` rejects the way nostr-tools settles a relay's OK:false.
// (The older fixtures in dm-survives-a-half-dead-socket.test.mjs read the DM path through a real socket.)
//
// CLAUDE.md rule 3: nothing here matches text in app/*.jsx — every claim is about the RENDERED tree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadScreen, miniReact, texts, find, button } from './render-jsx-screen.mjs';
import { fnBody, stmt } from './test-slice.mjs';

const BUNDLE = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
const PEER = 'b'.repeat(64);

function lift(src, name, scope) {
  const proxy = new Proxy(scope, {
    has: (t, k) => (k in t) || !(k in globalThis),
    get: (t, k) => { if (k in t) return t[k]; if (k === Symbol.unscopables) return undefined;
      throw new ReferenceError('needs a stub for ' + String(k)); },
    set: (t, k, v) => { t[k] = v; return true; },
  });
  return new Function('scope', `with (scope) { return ${src}; }`)(proxy);
}

// The shipped engine pieces, over one shared queue.
function engine({ publishError }) {
  const scope = {
    _outbox: [], _outboxFailed: [], _outboxSubs: new Set(), _dmPlain: new Map(),
    OUTBOX_KEY: 'k', OUTBOX_FAILED_KEY: 'kf', OUTBOX_MAX: 200,
    localStorage: { setItem() {}, getItem: () => null },
    sk: new Uint8Array(32), toPub: (x) => x,
    console: { warn() {} },
    _dmEncrypt: (_sk, _p, text) => 'ct:' + text,
    finalizeEvent: (t) => ({ ...t, id: 'ev' + Math.random().toString(36).slice(2), pubkey: 'a'.repeat(64) }),
    _publishBounded: async () => { throw publishError; },
  };
  // bind whatever name the bundle gave finalizeEvent inside sendDM, so a rename fails loudly
  const sendBody = fnBody(BUNDLE, 'async sendDM(peerPub, content, replyTo) {', 'sendDM');
  const fin = (sendBody.match(/\b(finalizeEvent\d*)\(/) || [])[1];
  assert.ok(fin, 're-anchor: sendDM no longer signs an event');
  scope[fin] = scope.finalizeEvent;
  scope._PERMANENT = new Function(stmt(BUNDLE, 'var _PERMANENT =', '_PERMANENT').replace(/^var /, 'return ').replace(/;\s*$/, ''))();
  scope.isPermanentRefusal = new Function('_PERMANENT', stmt(BUNDLE, 'var isPermanentRefusal =', 'isPermanentRefusal').replace(/^var /, 'return ').replace(/;\s*$/, ''))(scope._PERMANENT);
  scope._outboxSave = lift(fnBody(BUNDLE, 'function _outboxSave() {', '_outboxSave'), '_outboxSave', scope);
  const F = {
    relays: ['wss://x.invalid'], ready: Promise.resolve(), myPubkey: 'a'.repeat(64),
    _dmWrap: new Function(fnBody(BUNDLE, '_dmWrap(text, replyTo) {', '_dmWrap').replace(/^_dmWrap/, 'return function _dmWrap'))(),
  };
  scope.window = { Fellowship: F };
  F.sendDM = lift('(' + sendBody.replace(/^async sendDM/, 'async function sendDM') + ')', 'sendDM', scope);
  F.outboxForPeer = lift('(' + fnBody(BUNDLE, 'outboxForPeer(peerPub) {', 'outboxForPeer').replace(/^outboxForPeer/, 'function outboxForPeer') + ')', 'outboxForPeer', scope);
  F.dmPlaintextOf = (id) => scope._dmPlain.get(id) || '';
  F.onOutbox = (fn) => { scope._outboxSubs.add(fn); return () => scope._outboxSubs.delete(fn); };
  F.subscribeThread = () => () => {};
  F.displayFor = () => ({ handle: 'Sam', av: { kind: 'symbol', color: '#5E8C6A', symbol: 'halo' } });
  F.requestProfiles = () => {};
  F.requeue = () => true; F.dropQueued = () => {};
  return { F, scope };
}

// The REAL DMThread, with a composer we type into and a Send button we press.
async function thread({ publishError }) {
  const { F, scope } = engine({ publishError });
  const { React, draw } = miniReact();
  const mod = loadScreen('app/screens-chat.jsx', ['DMThread'], {
    React, window: { Fellowship: F, addEventListener() {}, removeEventListener() {} },
    document: { createElement: () => ({ style: {}, appendChild() {}, remove() {}, click() {} }), body: { appendChild() {}, removeChild() {} }, addEventListener() {}, removeEventListener() {} },
    location: { search: '', href: 'https://app.trinityone.church/' },
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {},
    lsGet: (_k, d) => d, lsSet: () => {}, todayISO: () => '2026-10-02',
    Icon: ({ name }) => React.createElement('i', { 'data-icon': name }),
    IconBtn: ({ name, title, onClick }) => React.createElement('button', { title: title || name, onClick }),
    Overlay: ({ children }) => children, ScreenScroll: ({ children }) => children,
    ChurchPill: () => null, UserAvatar: () => null, SectionLabel: ({ children }) => children,
    BottomSheet: ({ open, children }) => (open ? children : null),
    safeCssColor: (c) => c, relTime: () => 'now', D: { GROUPS: [], RELAYS: [] },
  });
  const ctx = { toast() {}, canDMPeer: () => true, connTick: 0 };
  const props = { peer: PEER, open: true, onClose() {}, ctx, docked: false };
  const redraw = () => draw(mod.DMThread, props);
  redraw();                          // subscriptions and the outbox read arrive through effects
  let tree = redraw();
  const box = find(tree, n => n.type === 'textarea')[0];
  assert.ok(box, 're-anchor: the DM composer is gone');
  box.props.onChange({ target: { value: 'Hello, can we talk?' } });
  tree = redraw();
  const send = find(tree, n => n.type === 'button' && n.props && n.props['aria-label'] === 'Send')[0];
  assert.ok(send, 're-anchor: the DM Send button is gone');
  send.props.onClick();
  await new Promise(r => setTimeout(r, 25));   // sendDM awaits the (rejected) publish
  tree = redraw();
  return { tree, words: texts(tree).join(' | '), F, scope };
}

test('control: a message sent while there is no signal is "Waiting to send" (a transient failure stays queued)', async () => {
  const t = await thread({ publishError: new Error('timeout') });
  assert.match(t.words, /Hello, can we talk\?/, 're-anchor: the sent words are not on the thread at all');
  assert.match(t.words, /Waiting to send/, 'an outage is no longer drawn as waiting');
  assert.doesNotMatch(t.words, /Not sent/);
  assert.equal(button(t.tree, 'Try again').length, 0, 'a waiting message offers Try again, which is for failures');
});

test('control: a relay that says "rate-limited" is a retry-later, still "Waiting to send"', async () => {
  const t = await thread({ publishError: new Error('rate-limited: slow down') });
  assert.match(t.words, /Waiting to send/, 'a rate limit was treated as a permanent refusal');
  assert.doesNotMatch(t.words, /Not sent/);
});

test('A MESSAGE THE RELAY REFUSED BY POLICY IS NOT "WAITING TO SEND" — it is not sent, and says why in safe words', async () => {
  const t = await thread({ publishError: new Error('blocked: not a member or not permitted for this group') });
  assert.match(t.words, /Hello, can we talk\?/, 're-anchor: the refused words are not on the thread, so the checks below are vacuous');
  assert.doesNotMatch(t.words, /Waiting to send/,
    'THE THREAD STILL PROMISES "WAITING TO SEND" FOR A MESSAGE THE RELAY HAS ALREADY REFUSED. Screen read: ' + t.words);
  assert.match(t.words, /Not sent — private messages with this person are limited for safeguarding/,
    'the refused message does not say it was not sent. Screen read: ' + t.words);
  assert.doesNotMatch(t.words, /not a member or not permitted/,
    'the raw relay string reached the screen — it must not say why the other person is restricted');
  assert.equal(button(t.tree, 'Try again').length, 0, '"Try again" is offered for a message that can never be accepted');
  assert.equal(button(t.tree, 'Discard').length, 1, 'the member can no longer discard it');
});

test('…and the ENGINE moved it at once: outboxForPeer has it failed and permanent, and nothing pending', async () => {
  const t = await thread({ publishError: new Error('blocked: not a member or not permitted for this group') });
  const q = t.F.outboxForPeer(PEER);
  assert.equal(q.length, 1, 'the refused message is gone from the queue entirely, so the member cannot discard or copy it');
  assert.equal(q[0]._failed, true);
  assert.equal(q[0]._permanent, true, '_permanent is not exposed, so the screen cannot tell a refusal from an outage');
  assert.equal(q.filter(e => e._pending).length, 0, 'the refused message is still reported pending');
  assert.equal(t.F.dmPlaintextOf(q[0].id), 'Hello, can we talk?', 'the member can no longer read their own words');
});
