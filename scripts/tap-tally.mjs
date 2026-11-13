// THE FAILURE TALLY, READ FROM node's TAP — with `# TODO` and `# SKIP` rows kept OUT of it.
//
// Why this exists (2026-11-13): a "58 failing" baseline on main was counted by grepping TAP for `not ok`. Ten
// of those were `not ok … # TODO` rows: findings that are red ON PURPOSE (stress4-clocks B1-B5, the three-churches
// FINDING/RESIDUAL rows x3, todays-header-fits-the-phone x2). node itself reports them as `todo`, not `fail`, and
// exits 0 over them — but a hand grep cannot tell, and diagnosis time went on failures that were not failures. So the runner now prints the split itself, from one parser:
//   · failing  — `not ok` with no directive. These are the failures. Parent rows that are `not ok` only because a
//                subtest failed (failureType 'subtestsFailed') are not counted twice.
//   · todo     — `not ok … # TODO`: known open findings. NEVER failures, but listed every run so they stay visible.
//   · skipped  — `… # SKIP`: never failures.
// An `ok … # TODO` (a todo that now passes) is none of the three; it is reported as `todoPassing` so somebody can
// notice the finding may be fixed.
//
// Callers: scripts/run-tests.mjs (the summary it prints after every run). Tested by scripts/tap-tally.test.mjs,
// which runs real `node --test` output through this AND drives run-tests.mjs end to end.
import { basename } from 'node:path';

// TAP 13: the description ends at the first UNESCAPED '#'; node escapes a literal '#' in a test name as '\#'.
function splitDirective(rest) {
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '\\') { i++; continue; }
    if (rest[i] === '#') {
      const name = rest.slice(0, i).trim().replace(/\\#/g, '#');
      const m = rest.slice(i + 1).trim().match(/^(TODO|SKIP)\b\s*(.*)$/i);
      return m ? { name, directive: m[1].toUpperCase(), reason: m[2] } : { name: rest.trim().replace(/\\#/g, '#'), directive: '', reason: '' };
    }
  }
  return { name: rest.trim().replace(/\\#/g, '#'), directive: '', reason: '' };
}

const fileOf = (location) => {
  const m = String(location || '').match(/^(.*?\.m?[jt]s)(?::\d+:\d+)?$/);
  return m ? basename(m[1]) : '';
};

export function tallyTap(tap) {
  const lines = String(tap || '').split('\n');
  const failing = [], todo = [], skipped = [], todoPassing = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)(not ok|ok) \d+ - (.*)$/);
    if (!m) continue;
    const status = m[2];
    const { name, directive, reason } = splitDirective(m[3]);
    // the YAML diagnostics block that follows a result line: `---` … `...`, indented under it
    let location = '', failureType = '';
    if (lines[i + 1] && lines[i + 1].trim() === '---') {
      for (let j = i + 2; j < lines.length && lines[j].trim() !== '...'; j++) {
        const l = lines[j].trim();
        let mm;
        if ((mm = l.match(/^location:\s*'(.*)'$/))) location = mm[1];
        else if ((mm = l.match(/^failureType:\s*'(.*)'$/))) failureType = mm[1];
      }
    }
    // a whole FILE that failed (it threw at load, or left work running) is reported under its own path
    const wholeFile = /\.test\.mjs$/.test(name);
    const file = fileOf(location) || (wholeFile ? basename(name) : '');
    const row = { file, name: wholeFile ? basename(name) : name, reason };
    if (directive === 'TODO') { (status === 'not ok' ? todo : todoPassing).push(row); continue; }
    if (directive === 'SKIP') { skipped.push(row); continue; }
    if (status === 'not ok' && failureType !== 'subtestsFailed') failing.push(row);
  }
  const files = (rows) => [...new Set(rows.map(r => r.file || '(unknown file)'))].sort();
  return { failing, todo, skipped, todoPassing, failingFiles: files(failing), todoFiles: files(todo) };
}

// The block run-tests.mjs prints. Kept here so the wording is tested with the parser.
export function formatTally(t) {
  const out = [];
  const row = (r) => `  ${r.file || '(unknown file)'} — ${r.name}${r.reason ? '  [' + r.reason.slice(0, 120) + ']' : ''}`;
  out.push(`run-tests: ${t.failing.length} failing test(s) in ${t.failingFiles.length} file(s) — # TODO and # SKIP rows are NOT counted as failures`);
  for (const r of t.failing) out.push(row(r));
  out.push(`run-tests: ${t.todo.length} known open finding(s) (todo — red on purpose, not failures) in ${t.todoFiles.length} file(s)`);
  for (const r of t.todo) out.push(row(r));
  if (t.todoPassing.length) {
    out.push(`run-tests: ${t.todoPassing.length} todo row(s) now PASS — the finding may be fixed; look, then drop the todo`);
    for (const r of t.todoPassing) out.push(row(r));
  }
  return out.join('\n');
}
