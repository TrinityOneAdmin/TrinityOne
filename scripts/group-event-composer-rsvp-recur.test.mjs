// GROUP EVENT COMPOSER: noRsvp toggle, recurring event selector, aria-labels.
// Run: node --test scripts/group-event-composer-rsvp-recur.test.mjs
//
// Point-of-use (CLAUDE.md rule 1): the REAL GroupEventComposer is loaded from app/screens-chat.jsx
// and DRAWN through a minimal React harness. Assertions read the rendered tree — no text-matching
// (rule 3).
//
// Users of changed code (rule 2):
//   - GroupEventComposer: called from ChatScreen (line ~1882, composeEvt state). One call site.
//   - publishGroupEvent in fellowship.src.js: called via ctx.publishGroupEvent. The content JSON
//     is read by subscribeChurchEvents (line 7662) which already parses noRsvp, recur, day, nth.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { fnBody } from './test-slice.mjs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const CHAT = read('../app/screens-chat.jsx');
const jsx = (src) => transformSync(src, { loader: 'jsx', jsx: 'transform', jsxFactory: 'h', jsxFragment: 'Frag' }).code;

const h = (type, p, ...kids) => ({ type, props: { ...(p || {}), children: kids.flat(Infinity) } });
const walk = (n, out = []) => {
  if (!n || typeof n !== 'object') return out;
  if (Array.isArray(n)) { n.forEach(x => walk(x, out)); return out; }
  out.push(n); walk(n.props && n.props.children, out); return out;
};
const text = (n) => (Array.isArray(n) ? n.map(text).join('') : (n && typeof n === 'object') ? text(n.props && n.props.children) : (n == null || n === false ? '' : String(n)));
const expand = (n) => {
  if (Array.isArray(n)) return n.map(expand);
  if (!n || typeof n !== 'object') return n;
  if (typeof n.type === 'function') try { return expand(n.type(n.props)); } catch { return n; }
  return { ...n, props: { ...n.props, children: expand(n.props.children) } };
};
const flat = (n, out = []) => { if (Array.isArray(n)) n.forEach(x => flat(x, out)); else if (n && typeof n === 'object') { out.push(n); flat(n.props.children, out); } return out; };

function mountComposer(opts = {}) {
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
  const published = [];
  const ctx = {
    publishGroupEvent: async (gid, ev) => { published.push({ gid, ...ev }); return { id: 'evt1', ...ev }; },
    toast: () => {},
    ...(opts.ctx || {}),
  };
  const group = { id: 'g1', name: 'Prayer', accent: '#c25a38', ...(opts.group || {}) };
  const useC = React.useState;
  const useCE = React.useEffect;
  const useCR = React.useRef;
  const scope = {
    React, h, Frag: 'Frag', useC, useCE, useCR,
    Icon: () => null,
    safeCssColor: (c) => c || 'var(--clay)',
  };
  const src = jsx(fnBody(CHAT, 'function GroupEventComposer(', 'GroupEventComposer'));
  const names = Object.keys(scope);
  const GEC = new Function(...names, src + '\nreturn GroupEventComposer;')(...names.map(n => scope[n]));
  let closed = false;
  const render = () => { idx = 0; return GEC({ group, ctx, onClose: () => { closed = true; } }); };
  return { render, states, published, get closed() { return closed; } };
}

// ── 1. No RSVP checkbox exists and defaults unchecked ───────────────────────────────────────────
test('GroupEventComposer: No RSVP checkbox exists and defaults unchecked', () => {
  const { render } = mountComposer();
  const tree = render();
  const nodes = flat(expand(tree));
  const cb = nodes.find(n => n.type === 'input' && n.props['aria-label'] === 'No RSVP');
  assert.ok(cb, 'No RSVP checkbox not found');
  assert.equal(cb.props.checked, false, 'No RSVP should default unchecked');
});

// ── 2. Toggling noRsvp on and saving passes noRsvp to publishGroupEvent ─────────────────────────
test('GroupEventComposer: toggling noRsvp on passes it through to publishGroupEvent', async () => {
  const { render, states, published } = mountComposer();
  let nodes = flat(expand(render()));

  // Toggle noRsvp on
  const cb = nodes.find(n => n.type === 'input' && n.props['aria-label'] === 'No RSVP');
  assert.ok(cb, 'No RSVP checkbox not found');
  cb.props.onChange({ target: { checked: true } });

  // Fill title + date so save proceeds
  nodes = flat(expand(render()));
  const titleInput = nodes.find(n => n.type === 'input' && n.props.placeholder && n.props.placeholder.includes('Prayer'));
  assert.ok(titleInput, 'Title input not found');
  titleInput.props.onChange({ target: { value: 'Test Event' } });

  nodes = flat(expand(render()));
  const dateInput = nodes.find(n => n.type === 'input' && n.props.type === 'date');
  assert.ok(dateInput, 'Date input not found');
  dateInput.props.onChange({ target: { value: '2099-01-15' } });

  // Click Post
  nodes = flat(expand(render()));
  const postBtn = nodes.find(n => n.type === 'button' && text(n).includes('Post'));
  assert.ok(postBtn, 'Post button not found');
  await postBtn.props.onClick();

  assert.equal(published.length, 1, 'Should have published one event');
  assert.equal(published[0].noRsvp, true, 'noRsvp should be true');
});

// ── 3. Repeats checkbox exists and defaults unchecked ───────────────────────────────────────────
test('GroupEventComposer: Repeats checkbox exists and defaults unchecked', () => {
  const { render } = mountComposer();
  const nodes = flat(expand(render()));
  const cb = nodes.find(n => n.type === 'input' && n.props['aria-label'] === 'Recurring');
  assert.ok(cb, 'Recurring checkbox not found');
  assert.equal(cb.props.checked, false, 'Recurring should default unchecked');
});

// ── 4. Toggling Repeats shows frequency dropdown ────────────────────────────────────────────────
test('GroupEventComposer: toggling Repeats shows frequency dropdown', () => {
  const { render } = mountComposer();
  let nodes = flat(expand(render()));

  // No select initially
  const selBefore = nodes.find(n => n.type === 'select' && n.props['aria-label'] === 'Repeat frequency');
  assert.equal(selBefore, undefined, 'Frequency dropdown should not appear initially');

  // Toggle recurring on
  const cb = nodes.find(n => n.type === 'input' && n.props['aria-label'] === 'Recurring');
  cb.props.onChange({ target: { checked: true } });

  nodes = flat(expand(render()));
  const selAfter = nodes.find(n => n.type === 'select' && n.props['aria-label'] === 'Repeat frequency');
  assert.ok(selAfter, 'Frequency dropdown should appear after toggling Repeats on');
  assert.equal(selAfter.props.value, 'weekly', 'Default frequency should be weekly');
});

// ── 5. Recurring event passes recur to publishGroupEvent ────────────────────────────────────────
test('GroupEventComposer: recurring event passes recur through to publishGroupEvent', async () => {
  const { render, published } = mountComposer();
  let nodes = flat(expand(render()));

  // Toggle recurring on
  const cb = nodes.find(n => n.type === 'input' && n.props['aria-label'] === 'Recurring');
  cb.props.onChange({ target: { checked: true } });

  // Set frequency to fortnightly
  nodes = flat(expand(render()));
  const sel = nodes.find(n => n.type === 'select' && n.props['aria-label'] === 'Repeat frequency');
  sel.props.onChange({ target: { value: 'fortnightly' } });

  // Fill title + date
  nodes = flat(expand(render()));
  const titleInput = nodes.find(n => n.type === 'input' && n.props.placeholder && n.props.placeholder.includes('Prayer'));
  titleInput.props.onChange({ target: { value: 'Bi-weekly Prayer' } });
  nodes = flat(expand(render()));
  const dateInput = nodes.find(n => n.type === 'input' && n.props.type === 'date');
  dateInput.props.onChange({ target: { value: '2099-03-10' } });

  // Post
  nodes = flat(expand(render()));
  const postBtn = nodes.find(n => n.type === 'button' && text(n).includes('Post'));
  await postBtn.props.onClick();

  assert.equal(published.length, 1, 'Should have published one event');
  assert.equal(published[0].recur, 'fortnightly', 'recur should be fortnightly');
});

// ── 6. Aria labels on date, time, where, note ──────────────────────────────────────────────────
test('GroupEventComposer: date, time, where, note inputs have aria-labels', () => {
  const { render } = mountComposer();
  const nodes = flat(expand(render()));
  const labels = ['Date', 'Time', 'Where', 'Note'];
  for (const lbl of labels) {
    const el = nodes.find(n => (n.type === 'input' || n.type === 'textarea') && n.props['aria-label'] === lbl);
    assert.ok(el, `Input with aria-label="${lbl}" not found`);
  }
});
