// SABOTAGE RUNNER — proves a test can actually SEE the bug it claims to guard.
//
//   node scripts/sabotage.mjs                 # every case
//   node scripts/sabotage.mjs remember        # cases whose name matches
//
// WHY THIS EXISTS. The 2026-08-07 pre-merge audit found ten defects on a branch whose suite was green over
// all ten. The mechanism was not carelessness — it was that the tests were written by whoever wrote the code,
// so they assert the properties their author had already thought of. Two examples from that branch:
//
//   * a test named "locking clears the remembered seed" whose whole assertion was
//     `assert.match(body, /rememberClear\(\)/)`. The defect was that the call is not AWAITED. The test asserts
//     the call exists. It can never see the bug.
//   * a test named "removing the PIN and regenerating both clear it" that enumerated two call sites. The
//     defect was that the OTHER two call sites were missed — it enumerated the same list the code got wrong.
//
// So "the test passes" is not evidence. The question a test must answer is "does it go RED when the fix is
// removed?" This runner asks that question mechanically: it breaks the fix on purpose and requires the test
// to fail. A case that still passes under sabotage is reported as a FAILING GUARD — the code may well be
// correct, but nothing is watching it, which is the state that shipped all ten.
//
// It never touches the real tree: everything happens in a throwaway copy, so a case can mutate freely and an
// interrupted run cannot leave a sabotaged file behind.
import { execFileSync, execSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CASES } from './sabotage-cases.mjs';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const filter = process.argv[2] || '';
const cases = CASES.filter(c => !filter || c.name.includes(filter));
if (!cases.length) { console.error('no cases match ' + JSON.stringify(filter)); process.exit(2); }

// A copy of the WORKING TREE, not of HEAD — the fix under test is usually uncommitted at this point.
const SANDBOX = mkdtempSync(join(tmpdir(), 'sabotage-'));
console.log('sandbox: ' + SANDBOX + '\n');
for (const d of ['src', 'app', 'scripts', 'vendor']) cpSync(join(ROOT, d), join(SANDBOX, d), { recursive: true });
for (const f of ['package.json', 'index.html', 'steward.html', 'engine.js']) {
  if (existsSync(join(ROOT, f))) cpSync(join(ROOT, f), join(SANDBOX, f));
}
try { symlinkSync(join(ROOT, 'node_modules'), join(SANDBOX, 'node_modules')); } catch (e) {}

// REBUILD THE BUNDLE THE TEST ACTUALLY READS. Mutating src/ proves nothing about a test that lifts from
// vendor/ — and several do, because vendor/ is what the APK and the console load. Without this the runner
// reports a confident "ok" for a guard that never saw the mutation at all; it scored two that way the first
// time this was tried. esbuild is reached through the symlinked node_modules, so the sandbox rebuilds the
// same way the repo does.
const BUILD_FOR = {
  'src/steward.src.js': 'scripts/build-steward.sh',
  'src/identity.src.js': 'scripts/build-identity.sh',
  'src/fellowship.src.js': 'scripts/build-fellowship.sh',
};
const rebuild = (file) => {
  const script = BUILD_FOR[file];
  if (!script) return true;
  try { execSync('bash ' + script, { cwd: SANDBOX, stdio: 'pipe', timeout: 120000 }); return true; }
  catch (e) { return false; }
};

const runTest = (testFile) => {
  try {
    execFileSync(process.execPath, ['--test', testFile], { cwd: SANDBOX, stdio: 'pipe', timeout: 240000 });
    return { passed: true };
  } catch (e) {
    const out = String((e.stdout || '') + (e.stderr || ''));
    return { passed: false, out };
  }
};

let bad = 0;
const rows = [];
for (const c of cases) {
  const target = join(SANDBOX, c.file);
  const original = readFileSync(target, 'utf8');

  // 1. HEALTHY: the guard must pass before we break anything. If it does not, the case is mis-specified and
  //    a later red tells us nothing.
  if (!rebuild(c.file)) {
    rows.push([c.name, 'BUILD-FAILED', 'could not rebuild the bundle in the sandbox before the baseline run']);
    bad++;
    continue;
  }
  const healthy = runTest(c.test);
  if (!healthy.passed) {
    rows.push([c.name, 'BROKEN-BASELINE', 'the test fails BEFORE sabotage — fix the test or the code first']);
    bad++;
    continue;
  }

  // 2. SABOTAGED: undo the fix and require the guard to notice.
  const n = original.split(c.find).length - 1;
  if (n !== (c.count || 1)) {
    rows.push([c.name, 'NO-ANCHOR', `expected ${c.count || 1} occurrence(s) of the anchor, found ${n}`]);
    bad++;
    continue;
  }
  writeFileSync(target, original.split(c.find).join(c.replace));
  const built = rebuild(c.file);
  const broken = built ? runTest(c.test) : { passed: false };
  writeFileSync(target, original);
  rebuild(c.file);   // leave the sandbox consistent for the next case

  if (broken.passed) {
    rows.push([c.name, 'BLIND GUARD', 'the fix was removed and the test still passed — nothing is watching this']);
    bad++;
  } else {
    rows.push([c.name, 'ok', 'went red when the fix was removed']);
  }
}

const w = Math.max(...rows.map(r => r[0].length));
console.log('SABOTAGE RESULTS\n');
for (const [name, verdict, why] of rows) {
  console.log(`  ${verdict === 'ok' ? '✓' : '✗'} ${name.padEnd(w)}  ${verdict.padEnd(15)} ${why}`);
}
console.log(`\n  ${rows.length - bad}/${rows.length} guards proved they can see their own bug`);
try { rmSync(SANDBOX, { recursive: true, force: true }); } catch (e) {}
process.exit(bad ? 1 : 0);
