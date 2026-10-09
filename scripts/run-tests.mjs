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
import { spawn, spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync, openSync, closeSync, unlinkSync, existsSync, readdirSync as readdirSync2 } from 'node:fs';
import { availableParallelism } from 'node:os';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
const shardArg = argv.find(a => /^--shard=\d+\/\d+$/.test(a));
const flags = argv.filter(a => a.startsWith('-') && a !== shardArg);
const named = argv.filter(a => !a.startsWith('-'));

// Explicit files win (`npm test -- scripts/one.test.mjs`); otherwise every *.test.mjs, resolved HERE rather
// than by a shell glob so the command behaves the same from any directory and under any shell.
const dir = fileURLToPath(new URL('.', import.meta.url));
let files = named.length ? named : readdirSync(dir).filter(f => f.endsWith('.test.mjs')).sort().map(f => dir + f);
const totalFiles = files.length;

// --shard=M/N: run only the Mth slice of N equal(ish) parts, sorted by filename for determinism.
// M is 1-based. Each shard gets ceil(total/N) or floor(total/N) files; the assignment is stable
// across runs as long as the file list doesn't change.
if (shardArg) {
  const [m, n] = shardArg.replace('--shard=', '').split('/').map(Number);
  if (m < 1 || m > n || n < 1) { console.error(`run-tests: invalid --shard=${m}/${n}`); process.exit(1); }
  files = files.filter((_, i) => i % n === m - 1);
  console.error(`run-tests: shard ${m}/${n} — ${files.length} of ${totalFiles} files`);
}

if (!files.length) { console.error('run-tests: no *.test.mjs found in ' + dir); process.exit(1); }
// A caller who names a concurrency means it — don't hand node two --test-concurrency flags and hope.
const ownFlags = flags.some(f => f.startsWith('--test-concurrency')) ? [] : [`--test-concurrency=${concurrency}`];
console.error(`run-tests: ${files.length} files, concurrency ${ownFlags.length ? concurrency : '(caller-set)'} of ${availableParallelism()} threads${flags.length ? ', flags: ' + flags.join(' ') : ''}`);

// ── ONE SUITE AT A TIME ──────────────────────────────────────────────────────────────────────────────────
// THE DEFECT THIS EXISTS FOR, measured 2026-10-09: a true baseline of 188 failures was reported, on the same
// commit, as 547, then 453, then 269 — every one of them a second suite running concurrently. 148 test files
// bind a UNIQUE FIXED PORT via scripts/test-ports.mjs, so two suites race for all 148 by construction. Five
// sessions in a row then reasoned on top of numbers that were never real, and a genuine regression sat
// unnoticed underneath them for two days.
//
// test-ports.mjs already says, in its own words, that it is "deliberately NOT a lock … this catches
// leftovers, which is the whole observed failure mode, not concurrent suites". This is the other half.
//
// Refuse rather than queue: a developer who is told "pid 1234 has been running the suite for 4 minutes"
// makes a better decision than one whose command silently blocks. A lock whose owner is DEAD is taken over,
// because a killed run (SIGKILL skips every cleanup path) must not wedge the repo for ever.
const LOCK = join(tmpdir(), 'trinityone-suite.lock');
let lockHeld = false;
const readLock = () => { try { return JSON.parse(readFileSync(LOCK, 'utf8')); } catch { return null; } };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const takeLock = () => {
  for (let attempt = 0; attempt < 2; attempt++) {
    try { closeSync(openSync(LOCK, 'wx')); } catch {
      const held = readLock();
      if (held && held.pid && alive(held.pid) && held.pid !== process.pid) {
        const mins = held.started ? Math.round((Date.now() - held.started) / 60000) : '?';
        console.error(`\n✗ another suite is already running — pid ${held.pid}, ${mins} min, in ${held.cwd || '?'}`);
        console.error(`  Two suites race for the 148 fixed ports and BOTH report false failures.`);
        console.error(`  Wait for it, or if it is wedged: kill ${held.pid} && rm ${LOCK}`);
        process.exit(1);
      }
      console.error(`run-tests: taking over a stale lock from pid ${held && held.pid} (not running)`);
      try { unlinkSync(LOCK); } catch {}
      continue;
    }
    writeFileSync(LOCK, JSON.stringify({ pid: process.pid, started: Date.now(), cwd: process.cwd() }));
    lockHeld = true; return;
  }
  console.error('run-tests: could not take the suite lock'); process.exit(1);
};
// Only ours to release — never delete a lock another pid has since taken.
const releaseLock = () => {
  if (!lockHeld) return;
  const held = readLock();
  if (held && held.pid === process.pid) { try { unlinkSync(LOCK); } catch {} }
  lockHeld = false;
};
takeLock();
process.on('exit', releaseLock);

// SWEEP THE INVISIBLE CHROMIUM LITTER BEFORE WE ADD MORE. 57 files here drive a headless snap
// chromium, and a snap gets a PRIVATE /tmp, so the profile the test deletes is a 4KB stub while
// its real 171MB sits in /tmp/snap-private-tmp/ where nothing can see it. Measured 2026-10-09:
// 44GB in 2,394 dirs, root at 94%. The owner had cleared ~50GB of the same thing that morning.
// Never fatal: a failed sweep must not stop a suite.
try {
  const sweep = fileURLToPath(new URL('./sweep-chromium-tmp.mjs', import.meta.url));
  spawnSync(process.execPath, [sweep], { stdio: 'inherit', timeout: 60000 });
} catch {}

// Write a TAP stream to a temp file so the count floor can read it after the run, without piping
// stdout through this process (which deadlocks under the suite's output volume).
const tapDir = mkdtempSync(join(tmpdir(), 'trinityone-test-'));
const tapFile = join(tapDir, 'tap.txt');
const reporterFlags = flags.some(f => f.startsWith('--test-reporter'))
  ? [] // caller controls reporters — don't add ours
  : ['--test-reporter=spec', '--test-reporter-destination=stdout',
     '--test-reporter=tap', `--test-reporter-destination=${tapFile}`];

// `detached` + a process-GROUP kill, because a plain SIGTERM to this process left the whole tree alive:
// measured, the `--test` child and its workers survived, and up to 24 file processes plus their gateways go
// on squatting FIXED ports — the exact wedge scripts/test-ports.mjs exists to diagnose, and which once cost a
// 900s suite timeout. Ctrl-C at a terminal was never affected (the tty signals the group); this is for
// `timeout(1)`, a cancelled CI step, and any programmatic kill.
const child = spawn(process.execPath, ['--test', ...ownFlags, ...reporterFlags, ...flags, ...files], { stdio: 'inherit', detached: true });
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
// TEST COUNT FLOOR. The TAP reporter counts subtests (~4800 across 514 files, Sept 2026).
// A silent deletion (scripted edit overshooting, a rebase that drops a file) must go red, not green.
// Set below the real count to absorb concurrency failures (~150 browser-collision flakes on the
// dev box) while still catching a bulk deletion. Only checked on full-suite runs, not targeted ones.
const FLOOR_TOTAL = 4000;
const SKIP_BUDGET = 15;

child.on('exit', (code, signal) => {
  if (stopping) signalGroup('SIGKILL');
  let exitCode = signal ? 1 : (code ?? 1);
  // Parse the TAP summary from the temp file (lines like "# pass 512", "# skipped 2").
  try {
    const tapTail = readFileSync(tapFile, 'utf8').slice(-512);
    const passMatch = tapTail.match(/^# pass\s+(\d+)/m);
    const skipMatch = tapTail.match(/^# skipped\s+(\d+)/m);
    const pass = passMatch ? Number(passMatch[1]) : null;
    const skip = skipMatch ? Number(skipMatch[1]) : 0;
    if (pass !== null && !named.length) {
      const shardN = shardArg ? Number(shardArg.split('/')[1]) : 1;
      const floor = Math.floor(FLOOR_TOTAL / shardN);
      if (pass < floor) {
        console.error(`\n✗ test count floor: ${pass} passed, need at least ${floor} (${FLOOR_TOTAL} total ÷ ${shardN} shards)`);
        exitCode = 1;
      }
      if (skip > SKIP_BUDGET) {
        console.error(`\n✗ skip budget: ${skip} skipped, budget is ${SKIP_BUDGET}`);
        exitCode = 1;
      }
      // COMPARE AGAINST A MEASURED, DATED BASELINE — not against anybody's memory. Informational, never
      // fatal: a drifting number is a prompt to look, and a gate that cried wolf would just get raised.
      try {
        const b = JSON.parse(readFileSync(new URL('./test-baseline.json', import.meta.url), 'utf8'));
        const failMatch = tapTail.match(/^# fail\s+(\d+)/m);
        const testMatch = tapTail.match(/^# tests\s+(\d+)/m);
        const fail = failMatch ? Number(failMatch[1]) : null;
        const total = testMatch ? Number(testMatch[1]) : null;
        if (fail !== null && shardN === 1) {
          const df = fail - b.fail, dt = total === null ? 0 : total - b.tests;
          const sign = (n) => (n > 0 ? '+' : '') + n;
          console.error(`\nbaseline ${b.recorded} (${b.commit}): ${b.tests} tests, ${b.fail} fail` +
            `  →  now ${total} tests, ${fail} fail   [${sign(dt)} tests, ${sign(df)} fail]`);
          if (df > 0) console.error(`  ${df} MORE failing than the baseline. Something regressed, or the baseline is stale.`);
          if (dt < 0) console.error(`  ${-dt} FEWER tests than the baseline. Account for every one (CLAUDE.md rule 8).`);
        }
      } catch {}
    }
  } catch {}
  // KEEP THE TAP. It used to be deleted here, so the only durable record of what failed died with the run —
  // and a failure list you cannot diff against the previous one is a list you can only guess at. Prune to the
  // five most recent instead; each is ~3MB.
  console.error(`run-tests: TAP kept at ${tapFile}`);
  try {
    const runs = readdirSync2(tmpdir()).filter(d => d.startsWith('trinityone-test-')).sort();
    for (const d of runs.slice(0, Math.max(0, runs.length - 5))) rmSync(join(tmpdir(), d), { recursive: true, force: true });
  } catch {}
  releaseLock();
  process.exit(exitCode);
});
