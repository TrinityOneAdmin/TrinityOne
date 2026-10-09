#!/usr/bin/env node
// RECLAIM THE 171MB-PER-BROWSER-TEST THAT NOBODY CAN SEE.
//
// Measured 2026-10-09: 44GB in 2,394 directories, and root at 94% full. The owner reports
// clearing ~50GB of the same thing that morning. It comes back within a day.
//
// WHY THE TESTS' OWN CLEANUP DOES NOT WORK — and why "remember to clean up" is the wrong fix.
// 172 test files do `mkdtempSync(join(tmpdir(), 'trin-…'))` and `rmSync` it in after(). That code
// is correct and it runs. But chromium here is a SNAP, and a snap gets a PRIVATE /tmp bind-mounted
// over the real one. So:
//     the test writes /tmp/trin-x        -> real /tmp, ends up 4.0K
//     chromium writes its 171MB profile  -> /tmp/snap-private-tmp/snap.chromium/tmp/trin-x
// The test then deletes the 4.0K stub and the 171MB is orphaned. Measured, same profile name:
// snap-private 167M vs real /tmp 4.0K. Adding more rmSync calls cannot fix this.
//
// Moving the profiles off /tmp would fix it but snap's AppArmor confinement blocks chromium from
// writing a user-data-dir to an arbitrary path, so that is not available either.
//
// /tmp/snap-private-tmp is root-owned and unreadable from outside, so the ONLY route in is
// /proc/<pid>/root/tmp of a process already inside that namespace. If no chromium is running we
// start a throwaway one purely to borrow its namespace, then kill it.
import { readdirSync, statSync, rmSync, readFileSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';

const MIN_AGE_MIN = Number(process.env.SWEEP_MIN_AGE_MIN || 10);
const PATTERNS = [/^trin-.*chr-/, /^org\.chromium\.Chromium\./, /^\.org\.chromium\.Chromium\./];

const pids = () => { try { return execFileSync('pgrep', ['-f', 'chrome.*headless'], { encoding: 'utf8' }).split('\n').filter(Boolean); } catch { return []; } };
// Never delete a profile a live browser is using — a sweep that kills a running suite is worse
// than the disk it reclaims.
const inUse = () => {
  const out = new Set();
  for (const p of pids()) {
    try {
      for (const a of readFileSync(`/proc/${p}/cmdline`, 'utf8').split('\0'))
        if (a.startsWith('--user-data-dir=')) out.add(a.slice(16).replace(/.*\//, ''));
    } catch {}
  }
  return out;
};

let borrowed = null, pid = pids()[0];
if (!pid) {
  borrowed = spawn('chromium', ['--headless=new', '--no-sandbox', '--user-data-dir=/tmp/sweep-probe', 'about:blank'],
    { stdio: 'ignore', detached: true });
  await new Promise(r => setTimeout(r, 2500));
  pid = pids()[0];
}
if (!pid) { console.error('sweep: no chromium available; nothing done'); process.exit(0); }

const root = `/proc/${pid}/root/tmp`;
const live = inUse();
const cutoff = Date.now() - MIN_AGE_MIN * 60_000;
let n = 0, kept = 0;
for (const name of readdirSync(root)) {
  if (!PATTERNS.some(re => re.test(name))) continue;
  if (live.has(name)) { kept++; continue; }
  const full = `${root}/${name}`;
  try { if (statSync(full).mtimeMs > cutoff) { kept++; continue; } } catch { continue; }
  try { rmSync(full, { recursive: true, force: true }); n++; } catch {}
}
if (borrowed) { try { process.kill(-borrowed.pid, 'SIGKILL'); } catch { try { borrowed.kill('SIGKILL'); } catch {} }
  try { rmSync('/tmp/sweep-probe', { recursive: true, force: true }); } catch {} }
console.error(`sweep: removed ${n} stale chromium profile dirs (kept ${kept}: live or < ${MIN_AGE_MIN} min old)`);
