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

// The property that stops this rotting: the guard is worthless if the next test file forgets it, and
// forgetting is exactly what happened for all 27 of them.
test('every test that binds a fixed port checks it first', () => {
  const files = readdirSync(SCRIPTS).filter(f => f.endsWith('.test.mjs'));
  const missing = [];
  for (const f of files) {
    const src = readFileSync(join(SCRIPTS, f), 'utf8');
    if (!/^const PORT\s*=/m.test(src)) continue;             // binds no fixed port — nothing to check
    if (!/requireFreePort\(PORT/.test(src)) missing.push(f);
    if (/^const PORT[^\n]*\bCDP\s*=/m.test(src) && !/requireFreePort\(CDP/.test(src)) missing.push(f + ' (CDP)');
  }
  assert.deepEqual(missing, [],
    'these tests bind a fixed port without checking it is free — a leftover process can decide their result');
});
