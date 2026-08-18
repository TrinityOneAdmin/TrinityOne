// THE SUITE RUNNER. `npm test` comes here. Run directly: node scripts/run-tests.mjs [file ...]
//
// WHY THIS EXISTS AT ALL — it bounds how many test files run at once, and that is the whole job.
//
// `node --test` defaults its file-level concurrency to `availableParallelism() - 1`. On the dev box that is
// **111 test processes at once**, and 57 of the 184 files spawn their own gateway relay, so the real figure
// is closer to 170 processes plus three Chromiums. Measured, the suite does 80% of ONE core of actual work:
// these tests spend their lives waiting on relay sockets, not computing. All that parallelism bought was
// contention.
//
// What the contention cost, measured 2026-08-18:
//   * `reseat-safeguarding.test.mjs` failed about two full runs in three, and passed every time it ran alone.
//     It always failed on a FIXTURE line, never on the assertion it exists to make. It is a SAFEGUARDING
//     test, and one that reddens at random teaches the reflex "just run it again" — which is exactly how a
//     genuine safeguarding regression gets waved through. (That test now waits on state rather than sleeping
//     a fixed 400ms, which is correct on its own merits; this file is the other half of the fix.)
//   * The machine hard-locked under the load. It is an HP Z8 carrying a 350W 3090 — see the GPU power-cap
//     note — and saturating 112 threads is not free on a box with that power budget.
//
// The number costs NOTHING in wall-clock. Full suite, same machine, same commit:
//     concurrency  8 → 264.5s, 1305 pass / 0 fail
//     concurrency 24 → 264.0s, 1305 pass / 0 fail  (twice)
// Identical, because the tail is set by the slowest single FILE (event-store-import, ~52s), not by how many
// run beside it. So there is no speed argument for the default, and there are two arguments against it.
//
// Do not replace this with a hard-coded `--test-concurrency=24`: CI runners have 2-4 cores, where 24 would
// oversubscribe exactly the way 111 does here. The cap is a ceiling, never a floor.
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';

const CEILING = 24;
const concurrency = Math.max(1, Math.min(CEILING, availableParallelism() - 1));

// Explicit files win (`npm test -- scripts/one.test.mjs`); otherwise every *.test.mjs, resolved HERE rather
// than by a shell glob so the command behaves the same from any directory and under any shell.
const dir = fileURLToPath(new URL('.', import.meta.url));
const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync(dir).filter(f => f.endsWith('.test.mjs')).sort().map(f => dir + f);

if (!files.length) { console.error('run-tests: no *.test.mjs found in ' + dir); process.exit(1); }
console.error(`run-tests: ${files.length} files, concurrency ${concurrency} of ${availableParallelism()} threads`);

const child = spawn(process.execPath, ['--test', `--test-concurrency=${concurrency}`, ...files], { stdio: 'inherit' });
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
