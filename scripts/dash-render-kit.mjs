// RENDER ONE COMPONENT OUT OF app/stew-dashboard.jsx AND PRESS ITS REAL CONTROLS.
//
// Not a test (importing it runs nothing). The pattern is the one a-refused-list-write-never-escapes-the-click.test.mjs
// proved: slice ONE component out of the unbundled .jsx, compile it with the same esbuild the packaged build uses,
// render it through the miniature React in render-jsx-screen.mjs, and hand it only the globals it takes from other
// files. CLAUDE.md rule 1 wants a test that fails if the feature is deleted FROM THE SCREEN, and rule 3 forbids
// getting there by matching text in app/*.jsx — this renders instead.
//
// `extra` names top-level functions in the same file that the component calls (rotateChurchKeys, …); they are
// compiled alongside it, from the SAME source, so a call into them is the shipped code and not a stub.
import { writeFileSync, rmSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { miniReact, texts, find } from './render-jsx-screen.mjs';
import { fnBody } from './test-slice.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
export const DASH = readFileSync(join(ROOT, 'app/stew-dashboard.jsx'), 'utf8');

export const reads = (t) => texts(t).join(' ').replace(/\s+/g, ' ').trim();
// what a control SAYS: the text of its children, not its class names and styles
export const said = (n) => {
  const out = [];
  const walk = (x) => {
    if (x == null || x === false) return;
    if (typeof x === 'string' || typeof x === 'number') { out.push(String(x)); return; }
    if (Array.isArray(x)) { x.forEach(walk); return; }
    (x.kids || []).forEach(walk);
  };
  walk(n);
  return out.join('').replace(/\s+/g, ' ').trim();
};

// `extra` names top-level functions the component calls: a string is read from the same file, `{ src, name }` from another
// (e.g. publishCareTeamFor from stew-schedule.jsx, which the dashboard reaches as a global).
export const SCH = readFileSync(join(ROOT, 'app/stew-schedule.jsx'), 'utf8');
export async function compiled(name, globals, extra = [], src0 = DASH) {
  const { React, draw } = miniReact();
  const pick = (e) => (typeof e === 'string' ? fnBody(src0, 'function ' + e + '(', e) : fnBody(e.src, 'function ' + e.name + '(', e.name));
  const src = [fnBody(src0, 'function ' + name + '(', name), ...extra.map(pick)].join('\n');
  const tmp = join(tmpdir(), 'dk-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, src + '\nexport { ' + name + ' };\n');
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const g = { React, ...globals };
  const key = '__dk_' + Math.random().toString(36).slice(2);
  globalThis[key] = g;
  const preamble = Object.keys(g).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  const mod = await import('data:text/javascript;base64,' + Buffer.from(preamble + '\n' + js).toString('base64'));
  delete globalThis[key];
  return { C: mod[name], draw };
}

export const common = () => ({
  CustomEvent: function (t, d) { this.type = t; this.detail = (d || {}).detail; },
  setTimeout: () => 0, clearTimeout: () => {}, Promise, Date, Math, JSON, Set, Map, Object, String, Array, Boolean, Number, RegExp,
  Panel: (p) => (p && p.children) || null, SkPill: (p) => (p && p.children) || null, SkBadge: () => null,
  SK_TINT: { clay: { bg: 'x', fg: 'x' }, gold: { bg: 'x', fg: 'x' }, sage: { bg: 'x', fg: 'x' }, ink: { bg: 'x', fg: 'x' } },
  DismissibleNote: (p) => (p && p.children) || null, StewHelpLink: (p) => (p && p.label) || null,
  useStewNarrow: () => false, Icon: () => null, copyText: () => {},
  location: { search: '', hostname: 'x' },
  document: { addEventListener() {}, removeEventListener() {}, createElement: () => ({ style: {}, appendChild() {}, remove() {}, click() {} }), body: { appendChild() {}, removeChild() {} } },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, console,
});

// press the first control whose visible text / title / aria-label matches, and let promises settle
export async function press(tree, matcher, { which = 0 } = {}) {
  const hits = find(tree, n => n && n.props && typeof n.props.onClick === 'function' && !n.props.disabled
    && matcher.test(String(n.props['aria-label'] || '') + '|' + String(n.props.title || '') + '|' + said(n)));
  if (!hits.length) throw new Error('no control matches ' + matcher + ' — re-anchor this test');
  // NOT awaited: a handler may return a promise that is meant to stay pending (a write that has not answered yet)
  const ret = hits[which].props.onClick({ stopPropagation() {}, preventDefault() {}, target: { value: '' } });
  if (ret && typeof ret.then === 'function') ret.then(() => {}, () => {});
  for (let i = 0; i < 6; i++) await new Promise(res => setImmediate(res));
}
export { find, texts };

// ── DashMembers' globals, shared by the Block tests ───────────────────────────────────────────────────────────
// Everything DashMembers takes from other files, with the people and lists the test wants. `steward` is the fake
// window.Steward (what the console would PUBLISH is recorded there; nothing here decides anything).
export function membersGlobals({ steward, members, blocked = [], groups = [], stewards = [], minors = [], approved = [], admitted = null, extraWindow = {} }) {
  return {
    ...common(),
    nameHandle: () => '', shortNpub: (np) => String(np || '').slice(0, 12), ago: () => '2 days ago',
    Avatar: () => null, StewMemberSheet: () => null, ReseatModal: () => null, GuardianLinkModal: () => null, BulkInviteModal: () => null,
    stewCapState: () => ({ allowed: true }),
    window: {
      Steward: steward,
      useStewardGroups: () => groups, useStewardStewards: () => stewards, useStewardChurch: () => ({ name: 'St Aidan', features: { childPhotos: false } }),
      useStewardBlocked: () => blocked,
      useStewardSafeguard: () => ({ loaded: true, minorsKnown: true, clearedKnown: true, cleared: {}, minors, approved, nophoto: [] }),
      useStewardGuardians: () => ({ links: {}, closed: {} }), useStewardJoinPolicy: () => false,
      useStewardAdmitted: () => admitted || members.map(m => m.pubkey),
      stewardStreamLoaded: () => true, useStewardIdv: () => 0,
      useStewardMembers: () => members,
      addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true,
      ...extraWindow,
    },
  };
}
