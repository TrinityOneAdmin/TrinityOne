// `# TODO` AND `# SKIP` ROWS ARE NEVER COUNTED AS FAILURES — AND THE KNOWN OPEN FINDINGS ARE STILL LISTED.
//   Run: node --test scripts/tap-tally.test.mjs
//
// A "58 failing" baseline on main (2026-11-12, 120cc727) was a grep of the suite's TAP for `not ok`. Ten of those
// lines were `not ok … # TODO`: findings that are red on purpose, which node itself reports as todo and exits 0
// over. scripts/tap-tally.mjs is the one parser that splits them; scripts/run-tests.mjs prints its split.
//
// Rule 1 (point of USE): the second test drives the real scripts/run-tests.mjs over three throwaway test files
// and reads what it prints — it fails if run-tests stops printing the split, not only if the parser breaks. The
// first feeds the parser REAL `node --test` TAP (never hand-written TAP, which would only test what we think node
// writes), and checks it agrees with node's own `# fail` / `# todo` counts.
//
// Isolation: the fixtures live in a private temp dir, and run-tests is started with TMPDIR pointed at another
// private dir — so its suite lock, its TAP directory and its "keep the five newest TAPs" pruning all happen there
// and never touch the lock or the TAPs of a suite somebody else is running on this box.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tallyTap, formatTally } from './tap-tally.mjs';

const RUNNER = new URL('./run-tests.mjs', import.meta.url).pathname;
const dir = mkdtempSync(join(tmpdir(), 'trin-taptally-'));
after(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

const FIX = {
  // one real failure, beside a red-on-purpose finding, a todo that now passes, and a skip
  'mixed.test.mjs': `import { test } from 'node:test';
import assert from 'node:assert/strict';
test('passes', () => {});
test('a real failure', () => { assert.equal(1, 2); });
test('a finding red on purpose', { todo: 'parked: owner decision' }, () => { assert.equal(1, 2); });
test('a todo that now passes', { todo: true }, () => {});
test('skipped here', { skip: 'no chromium' }, () => {});
`,
  // ONLY findings (one nested) — this file must NOT be listed as failing
  'findings-only.test.mjs': `import { test } from 'node:test';
test('fine', () => {});
test('FINDING: an old relay mislabels', { todo: 'FINDING' }, () => { throw new Error('red on purpose'); });
test('outer', async (t) => { await t.test('RESIDUAL: nested finding', { todo: 'RESIDUAL' }, () => { throw new Error('x'); }); });
`,
  // a whole file that fails at load is a failure, reported under the file's own name
  'throws-at-load.test.mjs': `import { test } from 'node:test';
test('registered before the throw', () => {});
throw new Error('top-level throw');
`,
};
for (const [f, src] of Object.entries(FIX)) writeFileSync(join(dir, f), src);
const files = Object.keys(FIX).map(f => join(dir, f));
// node marks its test subprocesses with NODE_TEST_CONTEXT, and a `node --test` that inherits it reports to its
// parent over a private channel instead of writing TAP. These runs are top-level runs, so it is removed.
const cleanEnv = (extra = {}) => { const e = { ...process.env, ...extra }; delete e.NODE_TEST_CONTEXT; return e; };

test('the parser splits REAL node TAP: failures, known findings (todo), skips — and agrees with node\'s own counts', () => {
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...files], { cwd: dir, encoding: 'utf8', env: cleanEnv() });
  const tap = r.stdout;
  const t = tallyTap(tap);
  assert.deepEqual(t.failing.map(x => x.name).sort(), ['a real failure', 'throws-at-load.test.mjs'],
    'the failures are not exactly the real failure and the file that threw: ' + JSON.stringify(t.failing));
  assert.deepEqual(t.failingFiles, ['mixed.test.mjs', 'throws-at-load.test.mjs'],
    'a file holding only `# TODO` findings was listed as FAILING, or a failing file was missed');
  assert.deepEqual(t.todo.map(x => x.name).sort(), ['FINDING: an old relay mislabels', 'RESIDUAL: nested finding', 'a finding red on purpose'],
    'a known open finding (not ok … # TODO) was dropped from the todo list — it must stay visible');
  assert.deepEqual(t.todo.map(x => x.file).sort(), ['findings-only.test.mjs', 'findings-only.test.mjs', 'mixed.test.mjs']);
  assert.equal(t.skipped.length, 1, 'the # SKIP row was not recognised');
  assert.deepEqual(t.todoPassing.map(x => x.name), ['a todo that now passes']);
  // node's own summary is the authority on what is a failure; the parser must never count more than it
  const n = (k) => Number((tap.match(new RegExp('^# ' + k + '\\s+(\\d+)', 'm')) || [])[1]);
  assert.equal(t.failing.length, n('fail'), 'the tally disagrees with node\'s own `# fail` count');
  assert.equal(t.todo.length + t.todoPassing.length, n('todo'), 'the tally disagrees with node\'s own `# todo` count');
  // CONTROL: the naive tally this replaces really does over-count on this input
  const naive = (tap.match(/^\s*not ok /gm) || []).length;
  assert.ok(naive > t.failing.length, 'CONTROL: a plain `not ok` grep did not over-count here, so this proves nothing');
});

test('directive parsing: lower-case `# todo`, an escaped `\\#` in a name, and a `#` that is not a directive', () => {
  const t = tallyTap([
    'not ok 1 - issue \\#42 still open # todo tracked',
    'not ok 2 - real one # not a directive',
    'not ok 3 - skipped by name # SKIP',
  ].join('\n'));
  assert.deepEqual(t.todo.map(x => x.name), ['issue #42 still open']);
  assert.deepEqual(t.failing.map(x => x.name), ['real one # not a directive']);
  assert.equal(t.skipped.length, 1);
});

test('POINT OF USE: run-tests.mjs prints the failures and, separately, the known findings — a finding is never in the failure list', () => {
  const priv = join(dir, 'tmp'); mkdirSync(priv, { recursive: true });
  const r = spawnSync(process.execPath, [RUNNER, ...files], {
    cwd: dir, encoding: 'utf8', timeout: 180000,
    env: cleanEnv({ TMPDIR: priv, TRINITYONE_SUITE_LOCK: '' }),
  });
  const err = r.stderr || '';
  const failHead = err.indexOf('failing test(s) in');
  const todoHead = err.indexOf('known open finding(s)');
  assert.ok(failHead !== -1 && todoHead !== -1,
    'run-tests.mjs no longer prints the failure / known-finding split. Its stderr tail:\n' + err.slice(-1500));
  const failBlock = err.slice(failHead, todoHead), todoBlock = err.slice(todoHead);
  assert.match(err, /run-tests: 2 failing test\(s\) in 2 file\(s\)/, 'the failure count is wrong:\n' + err.slice(-1500));
  assert.match(failBlock, /mixed\.test\.mjs — a real failure/);
  assert.match(failBlock, /throws-at-load\.test\.mjs/);
  assert.doesNotMatch(failBlock, /red on purpose|FINDING|RESIDUAL|findings-only/,
    'A `# TODO` FINDING WAS PRINTED AS A FAILURE — the tally that produced "58 failing" is back');
  assert.match(err, /run-tests: 3 known open finding\(s\)/, 'the known findings were not counted:\n' + err.slice(-1500));
  assert.match(todoBlock, /findings-only\.test\.mjs — FINDING: an old relay mislabels/);
  assert.match(todoBlock, /mixed\.test\.mjs — a finding red on purpose/);
  assert.equal(r.status, 1, 'CONTROL: run-tests must still exit non-zero over the real failure');
});
