// A TEST OR A SIMULATION MUST NOT BE ABLE TO REACH THE LIVE RELAY.
// Run: node --test scripts/no-browser-reaches-production.test.mjs
//
// The app dials the canonical relays — app.trinityone.church and the Tailscale funnel — from
// CANONICAL_RELAYS, whatever origin served the page. That is correct for a member's phone and wrong for
// everything in this directory.
//
// app-boots.test.mjs has blocked it since it was written. THE SIMULATION LAUNCHERS NEVER DID, and nobody
// noticed for eight rounds. Round 8 found it by accident: a treasurer's console was writing to BOTH relays
// and reading back from both, so her books held ten entries while the local relay held two, and the screen
// showed a balance neither could justify alone. publish() resolves on Promise.any — "some relay took it" —
// so "did it save?" had two answers, which is the one question the finance phase exists to ask.
//
// Three test-church documents reached the live relay before it was caught. Harmless in that instance, and
// entirely luck: the same hole would have carried member documents, safeguarding lists and a church's books.
//
// Port 9 is the discard port: nothing listens, so a connection fails instantly rather than hanging. The relay
// on the page's OWN origin is untouched, which is where a round's data actually lives — verified by driving a
// guarded console: production blocked in 4 ms, local HTTP and the local relay websocket both fine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const DIR = fileURLToPath(new URL('.', import.meta.url));
const ROOT = fileURLToPath(new URL('..', import.meta.url));

// TRACKED FILES ONLY. A fresh checkout is what this has to be true of; somebody's untracked scratch on one
// machine is their business and cannot be enforced from here. (Four such scratch launchers were found on the
// dev box during round 8 and guarded by hand — they are five days old and belong to a superseded round.)
const LAUNCHERS = execFileSync('git', ['ls-files', 'scripts'], { cwd: ROOT, encoding: 'utf8' })
  .split('\n').filter(f => f.endsWith('.mjs')).map(f => f.replace(/^scripts\//, ''))
  .filter(f => f !== 'no-browser-reaches-production.test.mjs')   // this file names the hosts to assert on them
  .filter(f => { try { return /remote-debugging-port/.test(readFileSync(join(DIR, f), 'utf8')); } catch { return false; } });

test('there are browser launchers to check', () => {
  assert.ok(LAUNCHERS.length >= 8,
    `only ${LAUNCHERS.length} launchers found — re-anchor this test, it is probably looking in the wrong place`);
});

test('every one of them blackholes the production relays', () => {
  const unguarded = [];
  for (const f of LAUNCHERS) {
    const src = readFileSync(join(DIR, f), 'utf8');
    if (!/host-resolver-rules/.test(src)) { unguarded.push(f); continue; }
    // and the rule must actually name the hosts, not just mention the flag
    const rule = (src.match(/host-resolver-rules[^\n]*/) || [''])[0];   // the value may be quoted — do not stop at a quote
    if (!/app\.trinityone\.church/.test(rule)) unguarded.push(f + ' (rule does not name app.trinityone.church)');
    else if (!/\*\.ts\.net/.test(rule)) unguarded.push(f + ' (rule does not cover the Tailscale funnel)');
  }
  assert.deepEqual(unguarded, [],
    'these launch a browser that can reach the LIVE relay. The app dials the canonical relays from any ' +
    'origin, so a round, a probe or a smoke test can write a church, its members and its books to ' +
    'production — and read back from it, which is how round 8 ended up with a ledger split across two ' +
    'relays and a balance neither supported:\n  ' + unguarded.join('\n  '));
});

test('the rule points at a port nothing listens on', () => {
  // 127.0.0.1:9 is the discard port. Pointing these at a live local port would silently redirect a round's
  // writes into whatever happened to be running there, which is worse than the problem.
  for (const f of LAUNCHERS) {
    const src = readFileSync(join(DIR, f), 'utf8');
    const rule = (src.match(/host-resolver-rules[^\n]*/) || [''])[0];
    if (!rule) continue;
    assert.match(rule, /127\.0\.0\.1:9\b/,
      `${f} maps the production hosts somewhere other than the discard port — a round's writes would go there`);
  }
});
