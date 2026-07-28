// DIAGNOSTIC, not a test: find identifiers called in app/*.jsx that are not in scope there.
//   node scripts/scope-scan.mjs
//
// These are CLASSIC scripts sharing one global scope, so only TOP-LEVEL declarations are visible across
// files. A name declared inside a component in app.jsx is invisible to identity.jsx — and referencing it
// throws ReferenceError the moment that line runs, which the empty catches all over this codebase then
// swallow, leaving a feature that silently does nothing.
//
// That is not hypothetical. On 2026-07-28 a child's 12-word restore called saveIdentity(), which lives
// inside a component in app.jsx. It threw, the catch ate it, and the two lines after it — saving the church
// list and the onboarded flag — never ran. The member got a working identity, no church, and a bounce back
// to the welcome screen. Proven on the device: `typeof saveIdentity` was "undefined" in the live app.
//
// HONEST LIMITS: this is a regex heuristic and it is NOISY — roughly 130 candidates today, nearly all
// destructured props and callbacks it cannot see. Read it as "look at these", never as a pass/fail gate.
// Its first version was WORSE than useless: it collected declarations from every file at any depth, so it
// missed the very bug it was written for. If you change it, re-verify it still flags that saveIdentity call
// (git show 03e8253:app/identity.jsx) before trusting a clean run.
import { readdirSync, readFileSync } from 'node:fs';
const DIR = 'app';
const files = readdirSync(DIR).filter(f => f.endsWith('.jsx'));
const src = Object.fromEntries(files.map(f => [f, readFileSync(DIR + '/' + f, 'utf8')]));
// strip comments AND string/template literals — CSS inside strings ("linear-gradient(", "var(") was
// swamping the result with matches that are not code at all.
const strip = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n')
  .replace(/`(?:[^`\\]|\\.)*`/g, '``')
  .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
  .replace(/"(?:[^"\\\n]|\\.)*"/g, '""');

// These are CLASSIC scripts sharing one global scope, so only TOP-LEVEL declarations (column 0) are visible
// across files. Anything indented is local to its own file — and a name declared inside a component in
// app.jsx is invisible to identity.jsx, which is exactly the bug this exists to find. Collecting every
// declaration regardless of indentation made the scanner blind to it.
const globals = new Set(), locals = {};
const addDecls = (t, into) => {
  for (const m of t.matchAll(/(?:^|\n)(\s*)(?:export\s+)?(?:async\s+)?(?:function|class)\s+([A-Za-z_$][\w$]*)/g)) if (into !== globals || !m[1]) into.add(m[2]);
  for (const m of t.matchAll(/(?:^|\n)(\s*)(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) if (into !== globals || !m[1]) into.add(m[2]);
  for (const m of t.matchAll(/\bwindow\.([A-Za-z_$][\w$]*)\s*=/g)) into.add(m[1]);
};
for (const f of files) {
  const t = strip(src[f]);
  addDecls(t, globals);                                  // column-0 only
  const L = new Set(); locals[f] = L;
  for (const m of t.matchAll(/\b(?:function|class)\s+([A-Za-z_$][\w$]*)/g)) L.add(m[1]);
  for (const m of t.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) L.add(m[1]);
  for (const m of t.matchAll(/\b(?:const|let|var)\s*\{([^}]*)\}/g)) m[1].split(',').forEach(x => L.add(x.split(':').pop().trim()));
  for (const m of t.matchAll(/\b(?:const|let|var)\s*\[([^\]]*)\]/g)) m[1].split(',').forEach(x => L.add(x.trim()));
  for (const m of t.matchAll(/\(([^()]*)\)\s*=>/g)) m[1].split(',').forEach(x => L.add(x.trim().replace(/[={].*$/, '').trim()));
  for (const m of t.matchAll(/function\s*[\w$]*\s*\(([^)]*)\)/g)) m[1].split(',').forEach(x => L.add(x.trim().replace(/[={].*$/, '').trim()));
  for (const m of t.matchAll(/\{\s*([\w$,\s]+)\s*\}\s*\)/g)) m[1].split(',').forEach(x => L.add(x.trim()));
}
const BUILTIN = new Set(['if','for','while','switch','catch','return','typeof','new','function','await','super','this','void','delete','in','of','do','else','try','throw','case','yield','import','export','React','ReactDOM','window','document','localStorage','sessionStorage','console','Math','JSON','Object','Array','String','Number','Boolean','Date','Promise','Set','Map','WeakMap','RegExp','Error','TypeError','URL','URLSearchParams','TextEncoder','TextDecoder','Uint8Array','ArrayBuffer','Blob','File','FileReader','fetch','setTimeout','setInterval','clearTimeout','clearInterval','requestAnimationFrame','crypto','navigator','location','history','alert','confirm','prompt','parseInt','parseFloat','isNaN','encodeURIComponent','decodeURIComponent','btoa','atob','Intl','Symbol','BigInt','structuredClone','queueMicrotask','CustomEvent','Event','Image','AbortController','Notification','matchMedia','getComputedStyle','IntersectionObserver','MutationObserver','ResizeObserver']);

const found = [];
for (const f of files) {
  const t = strip(src[f]);
  for (const m of t.matchAll(/(^|[^\w$.?\]'"`])([a-z_$][\w$]*)\s*\(/g)) {
    const name = m[2];
    if (globals.has(name) || locals[f].has(name) || BUILTIN.has(name)) continue;
    const line = t.slice(0, m.index).split('\n').length;
    found.push(`${f}:${line}  ${name}(`);
  }
}
console.log(found.length ? found.join('\n') : 'no undeclared function calls found');
