// POD-FILTERED CHAT: SELECTING A POD HIDES OTHER PODS' MESSAGES, KEEPS UNTAGGED WHOLE-TEAM ONES.
// Run: node --test scripts/pod-filtered-chat-views.test.mjs
//
// Point of use (CLAUDE.md rules 1 and 3): the REAL ChatRoom from app/screens-chat.jsx is compiled
// with the build's own esbuild and rendered through the miniature React.  The test feeds it a team
// group whose roster carries two pods, injects messages with different pod tags (and some untagged),
// then verifies:
//
//   · pod filter chips render when the team has pods
//   · no chips when the team has no pods
//   · no filter active (null): every message visible
//   · pod-1 selected: pod-1 + untagged visible, pod-2 hidden
//   · a pod chip toggles itself off when tapped again
//   · the outgoing-message path tags with the active pod
//
// Nothing matches text in app/*.jsx — all assertions read the rendered tree or the compiled code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScreen, miniReact, find, texts } from './render-jsx-screen.mjs';

const ME = 'mehex', THEM = 'themhex';

const PODS = [
  { id: 'pod-alpha', name: 'Alpha' },
  { id: 'pod-beta', name: 'Beta' },
];

// Five messages: two pod-alpha, one pod-beta, two untagged (whole-team).
function makeEvents() {
  return [
    { id: 'm1', pubkey: THEM, kind: 1, created_at: 100, tags: [['pod', 'pod-alpha']], content: 'alpha-msg-1' },
    { id: 'm2', pubkey: THEM, kind: 1, created_at: 200, tags: [['pod', 'pod-alpha']], content: 'alpha-msg-2' },
    { id: 'm3', pubkey: THEM, kind: 1, created_at: 300, tags: [['pod', 'pod-beta']],  content: 'beta-msg-1' },
    { id: 'm4', pubkey: THEM, kind: 1, created_at: 400, tags: [],                     content: 'team-wide-1' },
    { id: 'm5', pubkey: ME,   kind: 1, created_at: 500, tags: [],                     content: 'team-wide-2' },
  ];
}

// A recording document stub (same pattern as member-chat-popovers-close-on-tap-off.test.mjs).
function recDoc() {
  const listeners = [];
  return {
    listeners,
    doc: {
      createElement: () => ({ style: {}, appendChild() {}, remove() {}, click() {} }),
      body: { appendChild() {}, removeChild() {} },
      addEventListener: (t, f, c) => listeners.push({ t, f, c }),
      removeEventListener: (t, f) => { const n = listeners.findIndex(l => l.t === t && l.f === f); if (n >= 0) listeners.splice(n, 1); },
    },
  };
}

// Build a ChatRoom with a team group and pods, seeded with the five messages above.
function room({ withPods = true } = {}) {
  const { React, draw } = miniReact();
  const { doc } = recDoc();
  const teamGroup = { id: 'g1', name: 'Serving Team', kind: 'Team', team: true, accent: '#888' };
  const events = makeEvents();
  const published = [];
  const Fellowship = {
    myPubkey: ME, relays: ['wss://relay.example'], relayReady: () => true,
    groupEncState: () => 'clear',
    subscribeGroup: (_g, add) => { events.forEach(add); return () => {}; },
    subscribeReactions: () => () => {},
    subscribeGroupPin: (_g, cb) => { cb(null); return () => {}; },
    subscribeHidden: (_g, cb) => { cb(new Set()); return () => {}; },
    subscribeMessageTags: () => () => {},
    displayFor: () => ({ handle: 'sam', color: '#888' }),
    requestProfiles: () => {}, outboxFor: () => [], onOutbox: () => () => {},
    canAddGroupEvent: () => false, react: () => {},
    publishMessage: (_gid, _content, tags) => { published.push(tags); return Promise.resolve({ id: 'out1' }); },
  };
  const roster = withPods ? [{ team: 'g1', pods: PODS, members: [] }] : [];
  const mod = loadScreen('app/screens-chat.jsx', ['ChatRoom'], {
    React,
    window: {
      matchMedia: () => ({ matches: true }), Fellowship,
      TrinityData: { CHAT_IDENTITY: { handle: 'me', color: '#123456' }, GROUPS: [], RELAYS: [] },
      TrinityIdentity: { current: { handle: 'me', color: '#123456' } },
      addEventListener: () => {}, removeEventListener: () => {},
      localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
      confirm: () => true,
    },
    document: doc.doc ? doc.doc : doc,
    location: { search: '', href: 'https://app.trinityone.church/' },
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    lsGet: (_k, d) => d, lsSet: () => {}, todayISO: () => '2026-11-03',
    Icon: () => null, IconBtn: ({ name }) => React.createElement('button', { title: name }),
    Overlay: ({ open, children }) => (open ? children : null), UserAvatar: () => null,
    SectionLabel: ({ children }) => children, BottomSheet: ({ children }) => children,
    safeCssColor: (c) => c, D: { GROUPS: [], RELAYS: [] },
  });
  const ctx = {
    toast: () => {}, church: { npub: 'npub1church', name: 'Grace', id: 'c1' },
    myLeaderGroups: [], churchEvents: [], safeguard: {}, myPubkey: ME,
    openDM: () => {}, canDMPeer: () => true, connTick: 0,
    joinState: { loaded: true, isPending: false, removed: false, offline: false },
    churchRosters: roster,
  };
  let tree;
  const render = () => { tree = draw(mod.ChatRoom, { group: teamGroup, open: true, onClose: () => {}, ctx, docked: true }); return tree; };
  render();
  return { render, tree: () => tree, published };
}

// Read the message-content text from visible bubbles. Each message's content string becomes a text
// node somewhere under a div; we find them by the known content strings we seeded.
const ALL_CONTENTS = ['alpha-msg-1', 'alpha-msg-2', 'beta-msg-1', 'team-wide-1', 'team-wide-2'];
function visibleContents(tree) {
  const all = texts(tree).join('\n');
  return ALL_CONTENTS.filter(c => all.includes(c));
}

// Find buttons whose CHILDREN text matches a label. `texts()` walks all props including `key`, so a
// button with key="pod-alpha" shows as "pod-alphaAlpha" — match on the kids only.
function btnKidsText(node) {
  const out = [];
  (node.kids || []).forEach(c => texts(c, out));
  return out.join('').trim();
}
const btnNamed = (tree, label) => find(tree, n => n.type === 'button' && btnKidsText(n) === label);

// ── CHIPS ──────────────────────────────────────────────────────────────────────

test('pod filter chips render when the team has pods', () => {
  const r = room({ withPods: true });
  const t = r.render();
  const allBtn = btnNamed(t, 'All');
  assert.ok(allBtn.length >= 1, 'no "All" chip rendered for a team room with pods');
  const alphaBtn = btnNamed(t, 'Alpha');
  assert.ok(alphaBtn.length >= 1, 'no "Alpha" pod chip rendered');
  const betaBtn = btnNamed(t, 'Beta');
  assert.ok(betaBtn.length >= 1, 'no "Beta" pod chip rendered');
});

test('pod filter chips do NOT render when the team has no pods', () => {
  const r = room({ withPods: false });
  const t = r.render();
  const alphaBtn = btnNamed(t, 'Alpha');
  assert.equal(alphaBtn.length, 0, 'an "Alpha" chip appeared for a team with no pods');
});

// ── FILTERING ──────────────────────────────────────────────────────────────────

test('no filter active: all five messages are visible', () => {
  const r = room();
  const vis = visibleContents(r.render());
  assert.equal(vis.length, 5, `expected 5 visible messages, got ${vis.length}: ${vis.join(', ')}`);
});

test('selecting Alpha shows Alpha + untagged, hides Beta', () => {
  const r = room();
  const alphaBtn = btnNamed(r.render(), 'Alpha');
  assert.ok(alphaBtn.length, 're-anchor: no Alpha chip to tap');
  alphaBtn[0].props.onClick();
  const vis = visibleContents(r.render());
  assert.ok(vis.includes('alpha-msg-1'), 'alpha-msg-1 was hidden by its own pod filter');
  assert.ok(vis.includes('alpha-msg-2'), 'alpha-msg-2 was hidden by its own pod filter');
  assert.ok(vis.includes('team-wide-1'), 'untagged team-wide-1 was hidden — whole-team messages must pass');
  assert.ok(vis.includes('team-wide-2'), 'untagged team-wide-2 was hidden — whole-team messages must pass');
  assert.ok(!vis.includes('beta-msg-1'), 'beta-msg-1 was still visible under the Alpha filter');
  assert.equal(vis.length, 4, `expected 4 visible messages, got ${vis.length}: ${vis.join(', ')}`);
});

test('selecting Beta shows Beta + untagged, hides Alpha', () => {
  const r = room();
  const betaBtn = btnNamed(r.render(), 'Beta');
  assert.ok(betaBtn.length, 're-anchor: no Beta chip to tap');
  betaBtn[0].props.onClick();
  const vis = visibleContents(r.render());
  assert.ok(vis.includes('beta-msg-1'), 'beta-msg-1 was hidden by its own pod filter');
  assert.ok(vis.includes('team-wide-1'), 'untagged team-wide-1 was hidden');
  assert.ok(vis.includes('team-wide-2'), 'untagged team-wide-2 was hidden');
  assert.ok(!vis.includes('alpha-msg-1'), 'alpha-msg-1 was still visible under the Beta filter');
  assert.ok(!vis.includes('alpha-msg-2'), 'alpha-msg-2 was still visible under the Beta filter');
  assert.equal(vis.length, 3, `expected 3 visible messages, got ${vis.length}: ${vis.join(', ')}`);
});

test('tapping the same pod chip again deselects it — all messages return', () => {
  const r = room();
  const alphaBtn = () => btnNamed(r.render(), 'Alpha')[0];
  alphaBtn().props.onClick();                 // select Alpha
  assert.equal(visibleContents(r.render()).length, 4, 'precondition: Alpha filter did not take effect');
  alphaBtn().props.onClick();                 // deselect Alpha
  assert.equal(visibleContents(r.render()).length, 5, 'tapping the same chip again did not restore all messages');
});

test('"All" chip clears the filter', () => {
  const r = room();
  btnNamed(r.render(), 'Alpha')[0].props.onClick();  // select Alpha
  assert.equal(visibleContents(r.render()).length, 4, 'precondition');
  btnNamed(r.render(), 'All')[0].props.onClick();    // tap All
  assert.equal(visibleContents(r.render()).length, 5, '"All" did not clear the pod filter');
});

// ── SEND TAGGING ───────────────────────────────────────────────────────────────

test('sending a message with a pod filter tags the outgoing event with that pod', () => {
  const r = room();
  btnNamed(r.render(), 'Alpha')[0].props.onClick();  // select Alpha
  r.render();
  // Type into the composer textarea
  const ta = find(r.render(), n => n.type === 'textarea' && typeof n.props.onChange === 'function');
  assert.ok(ta.length > 0, 're-anchor: no <textarea> with onChange found — the composer may have changed');
  ta[0].props.onChange({ target: { value: 'hello pod' } });
  r.render();
  // Tap the Send button (aria-label="Send")
  const sendBtn = find(r.render(), n => n.type === 'button' && n.props['aria-label'] === 'Send');
  assert.ok(sendBtn.length > 0, 're-anchor: no Send button found');
  sendBtn[0].props.onClick();
  r.render();
  assert.ok(r.published.length > 0, 'no message was published through Fellowship.publishMessage');
  const tags = r.published[r.published.length - 1];
  const podTag = tags.find(t => t[0] === 'pod');
  assert.ok(podTag, 'the outgoing message was not tagged with a pod');
  assert.equal(podTag[1], 'pod-alpha', `the pod tag was ${podTag[1]}, not pod-alpha`);
});
