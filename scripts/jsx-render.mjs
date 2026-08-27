// RENDER A SHIPPED .jsx COMPONENT IN NODE, WITHOUT A BROWSER.
//
// Why this exists: app/*.jsx are classic scripts, and the usual trick — lift a function out with fnBody() and
// run it — cannot be used on a component, because the brace matcher trips on the braces inside JSX and throws.
// String-matching the source instead is not good enough: a pre-push audit defeated exactly such a test by
// moving the wording into an unused variable and rendering the wrong branch, and all 18 assertions still passed.
//
// So: transpile the real file with esbuild, evaluate it in a vm whose global object hands back a stub component
// for any identifier defined in a sibling script (Icon, SectionLabel, …), and record the element tree. The test
// then drives the component the phone runs, not a paraphrase of it.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';

export function loadJsx(relPath, names, { win } = {}) {
  const src = readFileSync(new URL('../' + relPath, import.meta.url), 'utf8');
  const js = transformSync(src, { loader: 'jsx', jsxFactory: '__h', jsxFragment: '__F' }).code;

  const state = { hooks: {}, i: 0 };
  const React = {
    useState(init) {
      const i = state.i++;
      if (!(i in state.hooks)) state.hooks[i] = (typeof init === 'function' ? init() : init);
      return [state.hooks[i], (v) => { state.hooks[i] = (typeof v === 'function' ? v(state.hooks[i]) : v); }];
    },
    useEffect() {}, useMemo: (f) => f(), useRef: () => ({ current: null }), useCallback: (f) => f,
    Fragment: '#frag',
  };
  const __h = (type, props, ...kids) => ({ type, props: props || {}, kids: kids.flat(Infinity).filter(k => k != null) });
  const stub = function Stub() { return null; };

  const base = {
    React, __h, __F: '#frag', console, Date, Math, JSON, String, Number, Boolean, Array, Object, RegExp,
    setTimeout, clearTimeout, encodeURIComponent, decodeURIComponent,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    __win: win || {},
  };
  const sandbox = new Proxy(base, {
    has: () => true,
    get(t, k) {
      if (k in t) return t[k];
      if (k === Symbol.unscopables) return undefined;
      if (k === 'window') return t.__win;
      return stub;              // a component from another script — renders as nothing
    },
    set(t, k, v) { t[k] = v; return true; },
  });
  const ctx = vm.createContext(sandbox);
  vm.runInContext(js + '\n; __out = { ' + names.map(n => `${n}: ${n}`).join(', ') + ' };', ctx);

  const got = base.__out;
  for (const n of names) if (typeof got[n] !== 'function') throw new Error(`${relPath} does not export a function called ${n}`);

  // render(name, props, hookState) — hookState keys are useState call order, 0-based
  const render = (name, props, hooks = {}) => { state.hooks = { ...hooks }; state.i = 0; return got[name](props); };
  return { render, fns: got };
}

// every node in the tree, as {name, props}
export function flatten(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  const name = (node.type && node.type.name) ? node.type.name : String(node.type);
  out.push({ name, props: node.props || {} });
  for (const k of (node.kids || [])) flatten(k, out);
  return out;
}
export const names = (node) => flatten(node).map(n => n.name);
export const findByText = (node, text) =>
  flatten(node).find(n => JSON.stringify(n.props && n.props.children || '').includes(text));
