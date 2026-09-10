// The pre-flight that stops a leftover process deciding a test result.
// Run: node --test scripts/test-ports.test.mjs
//
// AUDIT-2026-07-28 F14. Every relay and browser test here binds a hardcoded port and nothing checked
// whether it was free. The dangerous direction is not the one that fails: a stray relay from a FIXED tree
// answers on behalf of the gateway the test meant to start, so every assertion passes against code that is
// not under test. The direction that actually bit on this box was a stray headless BROWSER, 38 hours old,
// which took the suite from 115s to over 900s and a kill.
//
// This file binds no fixed port of its own — it asks the OS for a free one — so it cannot become the
// problem it exists to prevent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { requireFreePort } from './test-ports.mjs';

const SCRIPTS = new URL('.', import.meta.url).pathname;

const listenOnAnyFreePort = () => new Promise((res) => {
  const s = createServer();
  s.listen(0, '0.0.0.0', () => res({ port: s.address().port, close: () => new Promise(r => s.close(r)) }));
});

test('a free port passes', async () => {
  const { port, close } = await listenOnAnyFreePort();
  await close();                                   // the OS just told us this one is unused
  assert.equal(await requireFreePort(port, 'a test'), true);
});

test('an occupied port fails, and says so in a way you can act on', async () => {
  const squatter = await listenOnAnyFreePort();
  try {
    await assert.rejects(
      () => requireFreePort(squatter.port, 'the imaginary test'),
      (err) => {
        assert.match(err.message, new RegExp('port ' + squatter.port + ' is already in use'));
        assert.match(err.message, /the imaginary test/, 'the message must name what is blocked');
        assert.match(err.message, /BROKEN CODE CAN REPORT GREEN/,
          'the message must say why this matters, or the next person will just bump the port number');
        return true;
      });
  } finally { await squatter.close(); }
});

test('the guard sees a leftover bound only to loopback', async () => {
  // The gateway binds every interface; a hand-run probe usually binds 127.0.0.1. If the check looked at
  // 0.0.0.0 alone and missed loopback, the exact orphan that hung this suite would slip straight past it.
  const s = createServer();
  const port = await new Promise(r => s.listen(0, '127.0.0.1', () => r(s.address().port)));
  try {
    await assert.rejects(() => requireFreePort(port, 'a test'), /already in use/);
  } finally { await new Promise(r => s.close(r)); }
});

// ── WHICH FIXED PORTS DOES A FILE DECLARE? ────────────────────────────────────────────────────────────────
// AUDIT-2026-09-10. Both structural guards below used to read a declaration with their own ad-hoc pattern,
// and both patterns were blind to the form every BROWSER test in this suite uses. The clash detector matched
//
//     /^const (?:PORT|CDP)[A-Z_]*\s*=\s*(\d{2,5})\s*;/gm
//
// which requires the `;` immediately after the number — so `const PORT = 8893, CDP = 9350;` matched NOTHING
// and neither port was registered. Six files and twelve ports were exempt from the guard written after two
// abandoned suite runs: app-boots (8893/9350), restore-storm (8894/9351), restore-routes (8895/9352),
// a-join-while-locked-is-not-lost (8941/9381), a-cancelled-event-tells-the-people-it-was-for (9412/9413,
// PORT + PUSH_PORT) and a-tampered-module-is-refused (8807/9357). Every one of them holds TWO ports and
// spawns a browser, which is the exact failure this file's header describes.
//
// So both guards now read the same function, and it reads the whole declaration statement rather than a
// single `= digits ;`. One reader, one blind spot to close if it is ever wrong again — and it is falsifiable:
// the test below feeds it a two-declaration source and asserts it finds both ports.
//
// A port NAME is what makes something a port rather than any other numeric constant: PORT, CDP, or anything
// suffixed/prefixed with them (PUSH_PORT, PORT_B, CDP_2). Trailing comments are stripped first, because they
// routinely list other files' port numbers ("9350-9352 = app-boots ...") and a reader that took those as
// declarations would invent clashes that do not exist.
const PORT_NAME = /^(?:PORT|CDP)[A-Z0-9_]*$|^[A-Z][A-Z0-9]*_(?:PORT|CDP)$/;
export function declaredPorts(src) {
  const out = [];
  for (const line of src.split('\n')) {
    if (!/^const\s+(?:PORT|CDP)[A-Z0-9_]*\s*=/.test(line)) continue;
    const code = line.replace(/\/\/.*$/, '').replace(/\/\*[\s\S]*$/, '');
    for (const m of code.matchAll(/\b([A-Z][A-Z0-9_]*)\s*=\s*(\d{2,5})\b/g)) {
      if (PORT_NAME.test(m[1])) out.push({ name: m[1], port: m[2] });
    }
  }
  return out;
}

// The reader is the load-bearing part of both guards below, so it is tested against a source it does not
// own. Without this the widening would be unfalsifiable: a reader that found nothing would make both guards
// pass over everything, exactly as the old pattern silently did.
test('the port reader sees every form a file in this repo actually uses', () => {
  const found = (src) => declaredPorts(src).map(p => p.name + ':' + p.port);
  assert.deepEqual(found('const PORT = 8893, CDP = 9350;'), ['PORT:8893', 'CDP:9350'],
    'TWO PORTS IN ONE DECLARATION is the form every browser test here uses, and the form the old pattern could not see');
  assert.deepEqual(found('const PORT = 9412, PUSH_PORT = 9413;'), ['PORT:9412', 'PUSH_PORT:9413']);
  assert.deepEqual(found('const PORT = 8803;'), ['PORT:8803']);
  assert.deepEqual(found('const CDP = 9355;   // 9350-9352 = app-boots, 9354 = todays-header'), ['CDP:9355'],
    'a trailing comment listing OTHER files\' ports must not read as a declaration');
  assert.deepEqual(found('const PORT = 8884;   /* unique across scripts/*.test.mjs */'), ['PORT:8884']);
  assert.deepEqual(found('const RELAY_MAX_EVENTS = 5000;\nconst TIMEOUT = 120;'), [],
    'a numeric constant that is not a port must not be claimed as one');
  assert.deepEqual(found('  const PORT = 8899;'), [],
    'only a TOP-LEVEL declaration is a file-wide fixed port');
});

// The property that stops this rotting: the guard is worthless if the next test file forgets it, and
// forgetting is exactly what happened for all 27 of them.
test('every test that binds a fixed port checks it first', () => {
  // EVERY port a file declares needs its own pre-flight, by name. The old version asked only about PORT,
  // and about CDP only when CDP appeared on the same LINE as PORT — so a file declaring CDP on its own
  // (todays-header-fits-the-phone, verse-of-the-day-starts-minimised, serving-card-says-whats-new) was
  // skipped entirely, and PUSH_PORT was never asked about at all. All of them happen to check their ports;
  // nothing required it.
  const missing = [];
  for (const f of readdirSync(SCRIPTS).filter(f => f.endsWith('.test.mjs'))) {
    const src = readFileSync(join(SCRIPTS, f), 'utf8');
    for (const { name } of declaredPorts(src)) {
      if (!new RegExp('requireFreePort\\(' + name + '\\b').test(src)) missing.push(f + ' (' + name + ')');
    }
  }
  assert.deepEqual(missing, [],
    'these tests bind a fixed port without checking it is free — a leftover process can decide their result');
});

// AUDIT-2026-07-30. requireFreePort() catches a STRAY process. It cannot catch two test FILES that both claim the
// same port, because `node --test` runs files in parallel: one binds it legitimately, the other's pre-flight then
// blocks on a port that is in use and will never be released until the first file finishes. The symptom is the one
// this file already documents at the top — the suite goes from ~115s to many minutes — except there is no stray
// process to find and kill, so it looks like an infinite hang with no cause.
//
// Written after adding relay-careid-rehydrate.test.mjs on port 8859, which relay-childsafe.test.mjs already owned.
// Two full suite runs were abandoned at 400s and 600s before the clash was spotted. The convention in this repo is
// one port per file, and it was being held by hand.
test('no two test files claim the same fixed port', () => {
  const byPort = new Map();
  for (const f of readdirSync(SCRIPTS).filter(f => f.endsWith('.test.mjs'))) {
    const src = readFileSync(join(SCRIPTS, f), 'utf8');
    for (const { port } of declaredPorts(src)) {
      if (!byPort.has(port)) byPort.set(port, []);
      if (!byPort.get(port).includes(f)) byPort.get(port).push(f);
    }
  }
  const clashes = [...byPort.entries()].filter(([, files]) => files.length > 1)
    .map(([port, files]) => port + ' → ' + files.join(', '));
  assert.deepEqual(clashes, [],
    'these files share a fixed port. `node --test` runs files in PARALLEL, so one binds it and the other waits ' +
    'for a port that cannot free up until the first file is done — the suite appears to hang with no stray ' +
    'process to blame. Give each file its own port.');
});
