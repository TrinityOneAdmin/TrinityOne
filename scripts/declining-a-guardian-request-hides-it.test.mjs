// A DECLINED GUARDIAN REQUEST DOES NOT COME BACK.
//   Run: node --test scripts/declining-a-guardian-request-hides-it.test.mjs
//
// Phase 4 (C1): the steward console can Decline a parent-link request. The child|parent key goes into
// the `closed` map (a timestamp), and `pendingReqs` filters it out. If the closed map is dropped or the
// filter is removed, the request reappears — forever, since nothing else removes it.
//
// CLAUDE.md rule 1: the test fails if the feature is deleted from the screen — the pendingReqs filter
// is sliced from the shipped source and EXECUTED, and declineGuardian is compiled from the shipped code
// and called. Nothing here matches text in app/*.jsx.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fnBody, stripComments } from './test-slice.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const STEW = readFileSync(join(ROOT, 'app/stew-dashboard.jsx'), 'utf8');

const CHILD_PUB = 'cc'.padEnd(64, '0');
const PARENT_PUB = 'pp'.padEnd(64, '0');
const DECLINED_PARENT = 'dd'.padEnd(64, '0');

// Extract the pendingReqs filter from the SHIPPED source and compile it into a callable function.
// If the filter line is deleted or its shape changes, buildPendingFilter throws immediately.
function buildPendingFilter() {
  const src = stripComments(STEW);
  const at = src.indexOf('const pendingReqs = guardReqs.filter(');
  assert.notEqual(at, -1, 're-anchor: the pendingReqs filter is gone from stew-dashboard.jsx');
  const line = src.slice(at, src.indexOf(';', at) + 1);
  return new Function('guardReqs', 'guardians', 'guardiansClosed', line + '\nreturn pendingReqs;');
}

// Compile declineGuardian from the shipped source — same loadSlices pattern as
// console-safeguarding-controls-are-wired.test.mjs.
async function loadDecline(overrides = {}) {
  const src = fnBody(STEW, 'const declineGuardian = async (r) => {', 'declineGuardian');
  const tmp = join(tmpdir(), 'gdecl-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, src + '\nexport { declineGuardian };\n');
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const key = '__gdecl_' + Math.random().toString(36).slice(2);
  const globals = {
    Promise,
    window: {
      Steward: {
        setGuardians: (m, c) => { globals._calls.push([m, c]); return Promise.resolve(true); },
      },
    },
    guardians: {},
    guardiansClosed: overrides.closed || {},
    setMinorNotice: () => {},
    _calls: [],
    ...overrides,
  };
  globalThis[key] = globals;
  const preamble = Object.keys(globals).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  const mod = await import('data:text/javascript;base64,' + Buffer.from(preamble + '\n' + js).toString('base64'));
  return { declineGuardian: mod.declineGuardian, calls: globals._calls };
}

// ── the filter ───────────────────────────────────────────────────────────────────────────────────────

test('both guardian requests are pending when the closed map is empty', () => {
  const filter = buildPendingFilter();
  const reqs = [
    { child: CHILD_PUB, parent: PARENT_PUB },
    { child: CHILD_PUB, parent: DECLINED_PARENT },
  ];
  const pending = filter(reqs, {}, {});
  assert.equal(pending.length, 2, 'the shipped pendingReqs filter dropped a request it should keep');
});

test('a declined guardian request is filtered out by the shipped pendingReqs filter', () => {
  const filter = buildPendingFilter();
  const reqs = [
    { child: CHILD_PUB, parent: PARENT_PUB },
    { child: CHILD_PUB, parent: DECLINED_PARENT },
  ];
  const closed = { [CHILD_PUB + '|' + DECLINED_PARENT]: Math.floor(Date.now() / 1000) };
  const pending = filter(reqs, {}, closed);
  assert.equal(pending.length, 1, 'the shipped pendingReqs filter did not filter the declined request');
  assert.equal(pending[0].parent, PARENT_PUB, 'the wrong request survived the filter');
});

// ── declineGuardian ──────────────────────────────────────────────────────────────────────────────────

test('declineGuardian writes the child|parent key into the closed map via setGuardians', async () => {
  const { declineGuardian, calls } = await loadDecline();
  await declineGuardian({ child: CHILD_PUB, parent: PARENT_PUB });
  assert.equal(calls.length, 1, 'declineGuardian did not call setGuardians');
  const [links, closed] = calls[0];
  assert.deepEqual(links, {}, 'links should be unchanged');
  assert.ok(closed[CHILD_PUB + '|' + PARENT_PUB], 'the closed map should have the declined key');
});

// ── sabotage: the executable tests above already catch deletion (buildPendingFilter fails at indexOf,
// loadDecline fails at fnBody) — no text-matching sabotage needed (CLAUDE.md rule 3). ──
