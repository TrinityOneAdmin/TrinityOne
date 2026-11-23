// Bundles js/bg-entry.js (+ the app's real src/fellowship.src.js and nostr-tools) into
// android/src/main/assets/directpush/bg-bundle.js. Run from the repo root:  node plugins/trinity-directpush/build-bg.mjs
//
// One build-only tweak, and it is NOT a change to shipped source: relaysForChurch() is module-private in
// fellowship.src.js, and the plan wants the EXISTING function, never a copy. This esbuild plugin appends one line to
// the bundler's in-memory copy of fellowship.src.js so the background bundle can reach it as window.__dpRelaysForChurch.
// src/fellowship.src.js and vendor/fellowship.js (what the app runs) are untouched.
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const fellowship = resolve(repo, 'src/fellowship.src.js');

await build({
  entryPoints: [resolve(here, 'js/bg-entry.js')],
  bundle: true, format: 'iife', target: 'es2020', legalComments: 'none',
  outfile: resolve(here, 'android/src/main/assets/directpush/bg-bundle.js'),
  nodePaths: [resolve(repo, 'node_modules')],
  plugins: [{
    name: 'expose-relaysForChurch',
    setup(b) {
      b.onLoad({ filter: /fellowship\.src\.js$/ }, (args) => {
        if (args.path !== fellowship) return null;
        const src = readFileSync(args.path, 'utf8');
        if ((src.match(/\nfunction relaysForChurch\(cp\) \{/g) || []).length !== 1) throw new Error('relaysForChurch anchor not found exactly once');
        return { contents: src + '\n;window.__dpRelaysForChurch = relaysForChurch;\n', loader: 'js', resolveDir: dirname(args.path) };
      });
    },
  }],
  logLevel: 'info',
});
