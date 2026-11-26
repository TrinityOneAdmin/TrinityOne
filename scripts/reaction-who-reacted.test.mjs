// REACTION "WHO REACTED" POPOVER: long-press a reaction pill to see who reacted.
// Run: node --test scripts/reaction-who-reacted.test.mjs
//
// Point-of-use (CLAUDE.md rule 1): the REAL ReactionsRow and ReactionWho are loaded from
// app/screens-chat.jsx and DRAWN through a minimal React harness. Assertions read the rendered
// tree — no text-matching (rule 3).
//
// Users of changed code (rule 2):
//   - ReactionsRow: rendered inside Bubble (line ~1119). Bubble is used by ChatScreen (line ~2244).
//     The new `reactors` prop is passed from ChatScreen through Bubble to ReactionsRow.
//   - ReactionWho: new component, called only from ReactionsRow.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { fnBody } from './test-slice.mjs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const CHAT = read('../app/screens-chat.jsx');
const jsx = (src) => transformSync(src, { loader: 'jsx', jsx: 'transform', jsxFactory: 'h', jsxFragment: 'Frag' }).code;

const h = (type, p, ...kids) => ({ type, props: { ...(p || {}), children: kids.flat(Infinity) } });
const text = (n) => (Array.isArray(n) ? n.map(text).join('') : (n && typeof n === 'object') ? text(n.props && n.props.children) : (n == null || n === false ? '' : String(n)));
const expand = (n) => {
  if (Array.isArray(n)) return n.map(expand);
  if (!n || typeof n !== 'object') return n;
  if (typeof n.type === 'function') try { return expand(n.type(n.props)); } catch { return n; }
  return { ...n, props: { ...n.props, children: expand(n.props.children) } };
};
const flat = (n, out = []) => { if (Array.isArray(n)) n.forEach(x => flat(x, out)); else if (n && typeof n === 'object') { out.push(n); flat(n.props.children, out); } return out; };

// Build both ReactionWho and ReactionsRow from the REAL source.
function buildReactionsRow() {
  const states = []; let idx = 0;
  const React = {
    Fragment: 'Frag',
    useState(init) {
      const i = idx++;
      if (i >= states.length) states.push(typeof init === 'function' ? init() : init);
      return [states[i], (v) => { states[i] = typeof v === 'function' ? v(states[i]) : v; }];
    },
    useEffect() {}, useRef: (v) => ({ current: v }), useMemo: (f) => f(), useCallback: (f) => f,
  };
  const useC = React.useState;
  const useCR = React.useRef;
  // Provide window.Fellowship.displayFor for name resolution
  const profiles = {
    pk_alice: { handle: 'Alice' },
    pk_bob: { handle: 'Bob' },
    pk_carol: { handle: 'Carol' },
  };
  const window = {
    Fellowship: { displayFor: (pk) => profiles[pk] || { handle: '' } },
  };
  const scope = {
    React, h, Frag: 'Frag', useC, useCR,
    Icon: () => null, window,
  };

  // Extract both functions — ReactionWho is defined right before ReactionsRow
  const whoSrc = jsx(fnBody(CHAT, 'function ReactionWho(', 'ReactionWho'));
  const rowSrc = jsx(fnBody(CHAT, 'function ReactionsRow(', 'ReactionsRow'));
  const names = Object.keys(scope);
  const mod = new Function(...names,
    whoSrc + '\n' + rowSrc + '\nreturn { ReactionWho, ReactionsRow };'
  )(...names.map(n => scope[n]));

  const render = (props) => { idx = 0; return mod.ReactionsRow(props); };
  return { render, states, ReactionWho: mod.ReactionWho };
}

// ── 1. ReactionsRow renders reaction pills with counts ──────────────────────────────────────────
test('ReactionsRow: renders reaction pills with counts', () => {
  const { render } = buildReactionsRow();
  const summary = [
    { emoji: '👍', count: 3, mine: false },
    { emoji: '❤️', count: 1, mine: true },
  ];
  const tree = render({ summary, onReact: () => {}, pickerOpen: false, onOpenPicker: () => {}, live: true, me: false, reactors: {} });
  const allText = text(expand(tree));
  assert.ok(allText.includes('3'), 'Should show count 3');
  assert.ok(allText.includes('1'), 'Should show count 1');
});

// ── 2. Long-press triggers who-reacted popover ──────────────────────────────────────────────────
test('ReactionsRow: long-press shows who-reacted popover with correct names', () => {
  const { render, states } = buildReactionsRow();
  const reactors = {
    pk_alice: { content: '👍', ts: 1 },
    pk_bob: { content: '👍', ts: 2 },
    pk_carol: { content: '❤️', ts: 3 },
  };
  const summary = [
    { emoji: '👍', count: 2, mine: false },
    { emoji: '❤️', count: 1, mine: false },
  ];
  const props = { summary, onReact: () => {}, pickerOpen: false, onOpenPicker: () => {}, live: true, me: false, reactors };

  // Initial render — no popover
  let tree = render(props);
  let expanded = expand(tree);
  let allText = text(expanded);
  assert.ok(!allText.includes('Alice'), 'Alice should not appear before long-press');

  // Find the first pill's onPointerDown to simulate long-press start
  let nodes = flat(expanded);
  const pill = nodes.find(n => n.type === 'button' && text(n).includes('👍'));
  assert.ok(pill, 'Thumbs-up pill button not found');
  assert.ok(pill.props.onPointerDown, 'Pill should have onPointerDown handler');

  // Fire onPointerDown (starts the 300ms timer)
  pill.props.onPointerDown();

  // Directly set the whoEmoji state to simulate the timer firing (state index 0 = whoEmoji)
  states[0] = '👍';

  // Re-render — popover should now show
  tree = render(props);
  expanded = expand(tree);
  allText = text(expanded);

  assert.ok(allText.includes('Alice'), 'Alice should appear in who-reacted popover');
  assert.ok(allText.includes('Bob'), 'Bob should appear in who-reacted popover');
  assert.ok(!allText.includes('Carol'), 'Carol (heart reactor) should NOT appear in thumbs-up popover');
});

// ── 3. ReactionWho shows truncated pubkey when profile is unknown ────────────────────────────────
test('ReactionWho: unknown pubkey shows truncated key', () => {
  const { ReactionWho } = buildReactionsRow();
  const reactors = {
    unknown_pubkey_abc123: { content: '😂', ts: 1 },
  };
  const tree = ReactionWho({ emoji: '😂', reactors, onClose: () => {}, me: false });
  const allText = text(expand(tree));
  // Should show first 8 chars + ellipsis
  assert.ok(allText.includes('unknown_'), 'Should show truncated pubkey for unknown profile');
});

// ── 4. ReactionsRow returns null when not live ──────────────────────────────────────────────────
test('ReactionsRow: returns null when not live', () => {
  const { render } = buildReactionsRow();
  const tree = render({ summary: [{ emoji: '👍', count: 1, mine: false }], onReact: () => {}, pickerOpen: false, onOpenPicker: () => {}, live: false, me: false, reactors: {} });
  assert.equal(tree, null, 'Should return null when live is false');
});

// ── 5. Closing the popover clears whoEmoji ──────────────────────────────────────────────────────
test('ReactionsRow: closing popover clears who-reacted state', () => {
  const { render, states } = buildReactionsRow();
  const reactors = { pk_alice: { content: '👍', ts: 1 } };
  const summary = [{ emoji: '👍', count: 1, mine: false }];
  const props = { summary, onReact: () => {}, pickerOpen: false, onOpenPicker: () => {}, live: true, me: false, reactors };

  // Set whoEmoji to show the popover
  states[0] = '👍';
  let tree = render(props);
  let expanded = expand(tree);
  let nodes = flat(expanded);

  // Find the dismiss overlay (the fixed-inset div that closes on click)
  const overlay = nodes.find(n => n.type === 'div' && n.props.style && n.props.style.position === 'fixed' && n.props.style.inset === 0);
  assert.ok(overlay, 'Dismiss overlay should exist');
  overlay.props.onClick({ stopPropagation: () => {} });

  // After clicking the overlay, whoEmoji should be cleared
  assert.equal(states[0], null, 'whoEmoji state should be cleared after dismiss');
});
