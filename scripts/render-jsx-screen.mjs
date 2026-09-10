// RENDER A MEMBER-APP SCREEN AND READ WHAT IS ACTUALLY ON IT.
//
// CLAUDE.md rule 1 wants a test that fails when a feature is deleted FROM THE SCREEN, and rule 3 forbids
// getting there by matching text in `app/*.jsx` — those files ship unbundled, so `false && ` in front of a
// condition leaves every word of it in place and a text match still passes.
//
// scripts/a-dm-that-never-sent-is-not-sent.test.mjs solved that for the steward console by slicing ONE
// component out of stew-dashboard.jsx and rendering it through a miniature React. The member screens are
// harder: ChatScreen and ChatRoom lean on siblings all over their own file (Bubble, Row, evtToMsg, the tag
// helpers…), so a single-function slice does not compile. This compiles the WHOLE file instead and hands it
// the handful of names it takes from other app files, so the component under test is the real one, in one
// piece, with its real neighbours.
//
// The React here is deliberately tiny and deliberately NOT React:
//   · useState is keyed by call order, exactly as React does it, so a setter fired from a handler is visible
//     on the next draw;
//   · useEffect really runs (after the draw, deps-compared), because the group list, the pinned message and
//     the removed-message set all arrive through effects — a harness that skipped them would be asserting
//     about a screen no member ever sees;
//   · useMemo and useCallback HONOUR THEIR DEPENDENCY ARRAYS, per call site, compared with Object.is. A
//     harness that recomputed every draw would return the right value from a memo whose deps list is missing
//     one of the values its body reads — and that stale-memo bug is invisible in output terms until a draw
//     happens with a changed input, so a test only catches it if it re-renders after something changes;
//   · everything is synchronous, so a "render" is a plain function call and the tree is a plain object.
// It cannot reconcile, cannot render children of a stubbed component, and has no lifecycle. It is enough to
// answer one question: what does this screen put in front of someone, in this state?
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = new URL('../', import.meta.url).pathname;

// Compile app/<x>.jsx the way scripts/sync-web.sh compiles it for the packaged build — same binary, same
// --jsx=transform. If the screen does not compile, this throws, which is the correct outcome.
export function compileScreen(relPath) {
  return execFileSync(join(ROOT, 'node_modules/.bin/esbuild'),
    [join(ROOT, relPath), '--jsx=transform', '--log-level=error'],
    { encoding: 'utf8', maxBuffer: 1 << 26 });
}

// Evaluate the compiled file with `globals` in scope and hand back the named components.
//
// The file is a CLASSIC SCRIPT — top-level `function Foo()` declarations, no exports — so a `new Function`
// wrapper with one parameter per external name is the honest way to load it. A name the screen needs and the
// caller did not supply is a ReferenceError at the point of use, which is what we want: a silently-stubbed
// global is how a test ends up asserting about something that is not the code.
export function loadScreen(relPath, exportNames, globals) {
  const names = Object.keys(globals);
  const js = compileScreen(relPath);
  const mod = new Function(...names, js + '\nreturn { ' + exportNames.join(', ') + ' };')(...names.map(k => globals[k]));
  for (const n of exportNames) {
    assert.equal(typeof mod[n], 'function', `${n} is not a component in ${relPath} — re-anchor this test`);
  }
  return mod;
}

const sameDeps = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));

// A DRAW RENDERS THE WHOLE TREE, not just the top component. The control a leader taps is inside `Bubble`,
// which the screen renders as a child element — a harness that stopped at the first component would have
// found nothing and would have said the screen was fine no matter what was on it. So function components are
// expanded recursively, each with its OWN hook store keyed by its position (and its React `key` where it has
// one), because hook state belongs to an instance and a single flat array would hand one component's state
// to another the moment the tree changed shape.
export function miniReact() {
  const stores = new Map();
  let cur = null, queued = [];
  const React = {
    useState(init) {
      const s = cur, k = s.si++;
      if (!(k in s.states)) s.states[k] = typeof init === 'function' ? init() : init;
      return [s.states[k], (v) => { s.states[k] = typeof v === 'function' ? v(s.states[k]) : v; }];
    },
    useRef(init) {
      const s = cur, k = s.ri++;
      if (!(k in s.refs)) s.refs[k] = { current: init === undefined ? null : init };
      return s.refs[k];
    },
    useEffect(fn, deps) {
      const s = cur, k = s.ei++;
      if (!(k in s.deps) || !sameDeps(s.deps[k], deps)) { s.deps[k] = deps; queued.push(fn); }
    },
    // MEMOIZE THE WAY REACT DOES — one slot per call site, recompute only when the dependency array changes
    // (different length, or any element different by Object.is). It used to recompute on every draw, on the
    // reasoning that "recomputing is always correct". The OUTPUT was indeed always right, and that was the
    // problem: a memo whose deps list is MISSING one of the values its body reads is then indistinguishable
    // from a correct one, so this harness structurally could not see the commonest React defect there is.
    // Measured 2026-08-30: deleting `iAmMinor, assumeMinor` from the room-list memo in app/screens-chat.jsx —
    // which is the whole of what keeps adults-only room names off a young person's screen — left every test
    // that renders that screen green, while in real React the list would be computed once, while the app
    // still believed the reader was an adult, and never computed again.
    useMemo(f, deps) {
      const s = cur, k = s.mi++;
      const slot = s.memos[k];
      // No deps array at all means "no memo" in React, and sameDeps() is false for undefined, so this
      // recomputes every draw — same as React.
      if (!slot || !sameDeps(slot.deps, deps)) s.memos[k] = { deps, v: f() };
      return s.memos[k].v;
    },
    // useCallback(f, deps) IS useMemo(() => f, deps): it must hand back the SAME function identity until the
    // deps change, or anything downstream that compares callback identity (a memo listing a handler in its
    // own deps, a React.memo child) is being tested against a harness that can never reproduce the bug.
    useCallback(f, deps) { return React.useMemo(() => f, deps); },
    createElement: (type, props, ...kids) => ({ type, props: props || {}, kids: kids.flat(Infinity) }),
    Fragment: 'Fragment',
  };
  const storeFor = (key) => {
    let s = stores.get(key);
    if (!s) { s = { states: [], refs: [], deps: [], memos: [] }; stores.set(key, s); }
    s.si = 0; s.ri = 0; s.ei = 0; s.mi = 0;
    return s;
  };
  function expand(node, key) {
    if (node == null || node === false || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map((c, i) => expand(c, key + '.' + i));
    if (typeof node.type !== 'function') return { ...node, kids: (node.kids || []).map((c, i) => expand(c, key + '.' + i)) };
    const k = key + '#' + (node.type.name || 'C') + (node.props && node.props.key != null ? ':' + node.props.key : '');
    const kids = node.kids || [];
    const prev = cur;
    cur = storeFor(k);
    let out;
    try { out = node.type({ ...node.props, children: kids.length > 1 ? kids : (kids.length ? kids[0] : undefined) }); }
    finally { cur = prev; }
    return { type: node.type, props: node.props, kids: [expand(out, k)] };
  }
  // One draw: render the tree, then run whatever effects it queued (deps-compared, as React does).
  const draw = (Comp, props) => {
    queued = [];
    const tree = expand({ type: Comp, props, kids: [] }, 'root');
    const run = queued; queued = [];
    run.forEach(fn => { try { fn(); } catch (e) { throw new Error('an effect threw during render: ' + e.message); } });
    return tree;
  };
  return { React, draw };
}

// ── reading the tree ──────────────────────────────────────────────────────────────────────────────────────
// Every string in a node and its children, including string props (titles, aria-labels, placeholders).
export function texts(n, out = []) {
  if (n == null || n === false) return out;
  if (typeof n === 'string' || typeof n === 'number') { out.push(String(n)); return out; }
  if (Array.isArray(n)) { n.forEach(c => texts(c, out)); return out; }
  if (n.props) Object.values(n.props).forEach(v => { if (typeof v === 'string') out.push(v); else if (v && (v.kids || Array.isArray(v))) texts(v, out); });
  (n.kids || []).forEach(c => texts(c, out));
  return out;
}

export function find(n, pred, out = []) {
  if (!n || typeof n !== 'object') return out;
  if (Array.isArray(n)) { n.forEach(c => find(c, pred, out)); return out; }
  if (pred(n)) out.push(n);
  Object.values(n.props || {}).forEach(v => { if (v && typeof v === 'object' && (v.kids || Array.isArray(v))) find(v, pred, out); });
  (n.kids || []).forEach(c => find(c, pred, out));
  return out;
}

// A button whose visible text (or title/aria-label) contains `label`.
export function button(tree, label) {
  return find(tree, n => n.type === 'button' && texts(n).join(' ').includes(label));
}

// ── THE TEXT AS A BROWSER WOULD LAY IT OUT ─────────────────────────────────────────────────────────────────
//
// Written for scripts/checkin-session-keys-are-not-issued-early.test.mjs on 2026-09-10 and lifted here on the
// same day, when a second screen needed the same instrument. There is one copy on purpose: two would drift,
// and the whole point of these three is that they are faithful.
//
// WHY `texts(...).join(' ')` IS NOT ENOUGH FOR A WORDING CLAIM. Joining text nodes with a SPACE is right for
// "does this screen mention X anywhere" — the phrase may legitimately span a <b> or a sibling node. It is
// WRONG for any claim about exact wording, and the device run of 2026-09-10 is why: the session-keys panel
// shipped reading "whenever you openthis page" on the phone, because JSX strips whitespace containing a
// newline between a text node and an element — and the assertion pinning that sentence PASSED, because the
// space-join had put the missing space back in. A test that certifies copy it cannot see is worse than no
// test (CLAUDE.md rule 4).
//
// So: children only, in order. INLINE pieces are joined with NOTHING — which is what the DOM does with
// adjacent inline nodes, the visible spacing coming from whitespace that is actually inside the text nodes —
// and a BLOCK element is fenced with newlines, because a <div> starts a new line on screen whatever its
// neighbour ends with. One rule, and it is what makes all three faithful at once.
//
// Deliberately NOT texts(): that also collects string PROPS (title, aria-label), and gluing a tooltip onto
// the copy beside it would invent adjacencies no reader ever sees.
//
// The inline list is the tags these panels use for emphasis. A COMPONENT (a function type — Panel,
// DismissibleNote, Icon) counts as a block: it is a box of its own, and treating it as inline is how the
// first version of this reported four junctions that are perfectly fine on screen.
export const INLINE = new Set(['b', 'i', 'em', 'strong', 'span', 'code', 'a', 'small', 'Fragment']);
export const isInline = (n) => n == null || typeof n !== 'object' || Array.isArray(n)
  || (typeof n.type === 'string' && INLINE.has(n.type)) || n.type === 'Fragment';
export function flow(n) {
  if (n == null || n === false) return '';
  if (typeof n === 'string' || typeof n === 'number') return String(n);
  if (Array.isArray(n)) return n.map(flow).join('');
  const inner = (n.kids || []).map(flow).join('');
  return isInline(n) ? inner : '\n' + inner + '\n';
}
// What a reader reads, whitespace-collapsed: use this for every claim about wording.
export const reads = (tree) => flow(tree).replace(/\s+/g, ' ').trim();

// ── AND THE GENERAL GUARD FOR THE WHOLE BUG CLASS ──────────────────────────────────────────────────────────
// Fixing the one sentence the device caught would leave every other line on a panel one reflow away from the
// same defect, and most lines carry no exact-wording assertion at all. So this checks the JUNCTIONS rather
// than the sentences: every place one inline piece of copy ends on a word character and the next begins on
// one, i.e. where the two run together with no separator a reader can see.
//
// It is quiet on correct markup for two reasons, both load-bearing: `{HORIZON_DAYS}` followed by ' days…' is
// fine because the next node starts with a space, and a <div> beside a <button> is fine because flow() fences
// blocks with a newline, so neither side ends or starts on a word character.
export function glued(n, out = []) {
  if (!n || typeof n !== 'object') return out;
  if (Array.isArray(n)) { n.forEach(c => glued(c, out)); return out; }
  const kids = (n.kids || []).filter(k => k != null && k !== false && k !== '');
  for (let i = 0; i < kids.length - 1; i++) {
    const a = flow(kids[i]), b = flow(kids[i + 1]);
    if (a && b && /\w$/.test(a) && /^\w/.test(b)) out.push('…' + a.slice(-28) + '][' + b.slice(0, 28) + '…');
  }
  kids.forEach(k => glued(k, out));
  return out;
}
