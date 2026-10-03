// Render ONE component out of the shipped console or member-app .jsx and read what is on its screen. NOT a test.
//
// The recipe the console tests have each copied (a-steward-post-that-failed-keeps-the-words, …): slice the
// function out of the file, compile it with the build's own esbuild, evaluate it with its external names
// supplied. A name the component needs and the caller did not supply is a ReferenceError, never a silent
// undefined — that is the point.
//
// Nothing here matches text in app/*.jsx (CLAUDE.md rule 3): the component runs and the tree is read.
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fnBody } from './test-slice.mjs';

export const ROOT = new URL('../', import.meta.url).pathname;
export const Stub = (n) => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };
export const settle = () => new Promise(r => setTimeout(r, 0));

// `names` may be a string or an array: every named function is sliced out of the same file and compiled
// together, so a component can use its sibling helper functions.
export async function loadComponent(file, anchors, globals) {
  const SRC = readFileSync(join(ROOT, file), 'utf8');
  const list = Array.isArray(anchors) ? anchors : [anchors];
  const pieces = list.map(a => fnBody(SRC, a, a));
  const exportsList = list.map(a => (/function\s+([A-Za-z0-9_$]+)/.exec(a) || [])[1]);
  const tmp = join(tmpdir(), 'rig-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, pieces.join('\n') + `\nexport { ${exportsList.join(', ')} };\n`);
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const key = '__rig_' + Math.random().toString(36).slice(2);
  globalThis[key] = globals;
  const preamble = Object.keys(globals).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  return await import('data:text/javascript;base64,' + Buffer.from(preamble + '\n' + js).toString('base64'));
}
