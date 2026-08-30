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
    // No memoization: recomputing every draw is always CORRECT, and a memo that went stale because this
    // harness compared deps differently from React would be a defect this file invented.
    useMemo: (f) => f(),
    useCallback: (f) => f,
    createElement: (type, props, ...kids) => ({ type, props: props || {}, kids: kids.flat(Infinity) }),
    Fragment: 'Fragment',
  };
  const storeFor = (key) => {
    let s = stores.get(key);
    if (!s) { s = { states: [], refs: [], deps: [] }; stores.set(key, s); }
    s.si = 0; s.ri = 0; s.ei = 0;
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
