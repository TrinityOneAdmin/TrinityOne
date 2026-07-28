// Pre-flight for every test that binds a FIXED port. Import it; don't reimplement it.
//
// AUDIT-2026-07-28 F14. Every relay and browser test in this repo binds a hardcoded port, and nothing
// checked whether that port was already taken. Two ways that decides a result, and the second is the one
// nobody saw:
//
//   • A stray relay from a FIXED tree makes BROKEN code report green. The test spawns its gateway, the
//     spawn dies with EADDRINUSE, the "wait for /status" loop then talks happily to the stray — which is
//     running somebody else's code — and every assertion passes against software that is not under test.
//   • A stray BROWSER hangs the suite. Measured on this box, 2026-07-28: an orphaned headless chromium,
//     38 hours old, left behind by a hand-run probe and still holding its debug port. With it alive the
//     full suite ran past 900s and was killed; with it gone the same suite finished in 115s. CI allows
//     the suite 15 minutes, so one of those turns the release gate red for a reason nobody can see.
//
// Ephemeral ports would be the stronger fix and a much larger change: 27 files build URLs from their port
// and pass it to `gateway.mjs` as argv. This closes the hole that actually bites — an occupied port now
// FAILS LOUDLY, naming what is holding it — and leaves the port map alone.
//
// Deliberately NOT a lock: we bind, release, and the caller binds a moment later. Something could race in
// between. This catches leftovers, which is the whole observed failure mode, not concurrent suites.
import { createServer } from 'node:net';
import { execFileSync } from 'node:child_process';

// Best effort, Linux-first: name the process squatting the port so the fix is obvious instead of a hunt.
function holder(port) {
  for (const [cmd, args] of [['ss', ['-ltnpH']], ['lsof', ['-nP', '-iTCP:' + port, '-sTCP:LISTEN']]]) {
    try {
      const out = String(execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'], timeout: 4000 }));
      const line = out.split('\n').find(l => new RegExp('[:.]' + port + '\\b').test(l));
      if (line) return line.trim().replace(/\s+/g, ' ').slice(0, 200);
    } catch {}
  }
  return '';
}

// Resolves if the port is free; throws with something you can act on if it is not.
// `what` describes the thing about to bind it, so the message says which test is blocked and why it matters.
export function requireFreePort(port, what = 'this test') {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', (err) => {
      if (err && err.code === 'EADDRINUSE') {
        const who = holder(port);
        reject(new Error(
          `port ${port} is already in use, so ${what} cannot run.\n` +
          (who ? `  held by: ${who}\n` : '') +
          '  This is NOT a code failure and must not be read as one. A leftover process on this port either\n' +
          '  hangs the suite or — worse — answers on behalf of the relay this test meant to start, so the\n' +
          '  assertions run against code that is not under test and BROKEN CODE CAN REPORT GREEN.\n' +
          '  Kill the leftover (a previous run, or a hand-run probe) and try again. AUDIT-2026-07-28 F14.'));
        return;
      }
      reject(err);
    });
    // 0.0.0.0: the gateway binds every interface, so a leftover on 127.0.0.1 must count as "taken" too.
    probe.listen(port, '0.0.0.0', () => probe.close(() => resolve(true)));
  });
}

// Convenience for the browser tests, which hold two fixed ports (the relay and Chrome's debug port).
export async function requireFreePorts(ports, what = 'this test') {
  for (const p of ports) await requireFreePort(p, what);
}
