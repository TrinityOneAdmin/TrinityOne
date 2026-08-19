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
// The number costs NOTHING in wall-clock ON THIS BOX. Full suite, same machine, same commit:
//     concurrency  8 → 264.5s, 1305 pass / 0 fail
//     concurrency 24 → 264.0s, 1305 pass / 0 fail  (twice)
//
// An earlier version of this comment explained that as "the tail is set by the slowest single FILE
// (event-store-import, ~52s)". That is NOT a sound reading and an audit knocked it down: if one 52s file set
// the makespan the suite would take ~52s, not 264s. Two points that both sit above the throughput knee
// cannot tell "tail-bound" from "the knee is at or below 8", and nothing below 8 was ever measured. A cap
// absolutely DOES cost wall-clock once it drops below the knee — demonstrated with 30 sleeping files:
// cap 24 → 3.4s, cap 3 → 16.1s. "Costs nothing" is a fact about 8-to-24 on a 112-thread box, not a property
// of capping.
//
// What makes the cap safe elsewhere is arithmetic, not that claim: node's own default already IS
// `availableParallelism() - 1`, so `min(24, cores - 1)` changes NOTHING on any machine with 25 cores or
// fewer — every CI runner included (measured under taskset: 4 CPUs → 3, 2 → 1, 1 → 1). It is a no-op there
// and a brake here, which is exactly the intent.
//
// Do not replace this with a hard-coded `--test-concurrency=24`: CI runners have 2-4 cores, where 24 would
// oversubscribe exactly the way 111 does here. The cap is a ceiling, never a floor. Note also that
// availableParallelism() follows an affinity mask but NOT a cgroup CPU quota, so a container limited with
// `--cpus=2` still reports the host's core count and would take the 24.
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';

const CEILING = 24;
const concurrency = Math.max(1, Math.min(CEILING, availableParallelism() - 1));

// SEPARATE FLAGS FROM FILES — the first version of this did not, and the failure mode was the worst kind.
// `node scripts/run-tests.mjs --test-name-pattern=x` treated the flag as a FILENAME, so node received no file
// operands, fell back to walking the tree itself, and printed `1..0` — a green, all-pass run that executed
// ZERO tests, under a banner claiming "1 files". scripts/release.sh gates the release on `npm test`, so
// "green having run nothing" is precisely the shape that must not exist here. Found by an adversarial audit
// of this file, using the very command someone would type to reproduce this file's own measurements
// (`--test-concurrency=8`).
const argv = process.argv.slice(2);
const flags = argv.filter(a => a.startsWith('-'));
const named = argv.filter(a => !a.startsWith('-'));

// Explicit files win (`npm test -- scripts/one.test.mjs`); otherwise every *.test.mjs, resolved HERE rather
// than by a shell glob so the command behaves the same from any directory and under any shell.
const dir = fileURLToPath(new URL('.', import.meta.url));
const files = named.length ? named : readdirSync(dir).filter(f => f.endsWith('.test.mjs')).sort().map(f => dir + f);

if (!files.length) { console.error('run-tests: no *.test.mjs found in ' + dir); process.exit(1); }
// A caller who names a concurrency means it — don't hand node two --test-concurrency flags and hope.
const ownFlags = flags.some(f => f.startsWith('--test-concurrency')) ? [] : [`--test-concurrency=${concurrency}`];
console.error(`run-tests: ${files.length} files, concurrency ${ownFlags.length ? concurrency : '(caller-set)'} of ${availableParallelism()} threads${flags.length ? ', flags: ' + flags.join(' ') : ''}`);

// `detached` + a process-GROUP kill, because a plain SIGTERM to this process left the whole tree alive:
// measured, the `--test` child and its workers survived, and up to 24 file processes plus their gateways go
// on squatting FIXED ports — the exact wedge scripts/test-ports.mjs exists to diagnose, and which once cost a
// 900s suite timeout. Ctrl-C at a terminal was never affected (the tty signals the group); this is for
// `timeout(1)`, a cancelled CI step, and any programmatic kill.
const child = spawn(process.execPath, ['--test', ...ownFlags, ...flags, ...files], { stdio: 'inherit', detached: true });
const signalGroup = (sig) => { try { process.kill(-child.pid, sig); } catch { try { child.kill(sig); } catch {} } };
// …THEN ESCALATE. Measured: a plain group SIGTERM left 2 test processes and 3 gateways alive, because the
// relay fixtures install their own handlers and node's test workers do not die on request. Survivors hold
// FIXED ports, which is the wedge that once cost a 900s suite timeout — so a grace period, then SIGKILL, and
// exit either way. unref() so this timer alone never keeps the runner alive.
let stopping = false;
const stop = (sig) => {
  stopping = true;
  signalGroup(sig);
  setTimeout(() => { signalGroup('SIGKILL'); process.exit(1); }, 3000).unref();
};
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => stop(sig));
child.on('exit', (code, signal) => {
  // ORDER MATTERS. The escalation timer above is useless on its own: the direct child dies first, this
  // handler fires, and process.exit() cancels the pending SIGKILL — measured, leaving 2 test processes and
  // 3 gateways alive on fixed ports. So sweep the group HERE, once the runner is already on its way out.
  // With the sweep, measured end to end: 3 processes running → SIGTERM → 0 left, no stray gateways.
  if (stopping) signalGroup('SIGKILL');
  process.exit(signal ? 1 : (code ?? 1));
});
