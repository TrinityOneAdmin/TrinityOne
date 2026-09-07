// A HEALTHY RELAY MUST NOT TELL ITS OPERATOR IT IS DOWN — AND CHURCH COUNTS STAY OFF THE PUBLIC ENDPOINT.
// Run: node --test scripts/the-relay-panel-does-not-cry-wolf.test.mjs
//
// Measured 2026-09-07 on the running control panel. The first line of every tab read:
//
//     Relay not reachable — Is the relay running? Restart the app.
//
// while the same page showed 294 events, two churches and "✓ Reachable from anywhere", and /status
// answered ok:true. Four of the six headline cards were dashes at the same moment, sitting beside the
// very numbers they claimed not to know.
//
// ONE DEFECT, TWO FINDINGS. poll() wrapped the fetch AND every DOM update in one try. /status stopped
// carrying `counts` (it is still in the open-source snapshot fcbf20a: "carries only non-sensitive
// counts"), so `s.counts.churches` threw on a SUCCESSFUL fetch, the catch relabelled the relay as
// unreachable, and the four assignments after the throw never ran. Every five seconds, for ever.
//
// The audience is a volunteer who lent a laptop. The only instruction on screen was to restart the one
// thing that was working, and nothing on the page let them tell that the banner was wrong.
//
// This file pins the two properties that matter and cannot be checked by reading:
//   1. the operator's numbers are available from the ADMIN-GATED endpoint, so the panel never needs
//      church-identifying counts back on the public one;
//   2. /status does NOT carry them — the standard that handler holds itself to (its own clock note says
//      "says nothing about the church"). Restoring counts there would be the tempting wrong fix.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = 8931;                      // own port: a shared one collides with a concurrent suite
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let relay = null, dataDir = null, token = '';

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'trin-panel-'));
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], {
    cwd: ROOT, stdio: 'ignore', env: { ...process.env, TRINITY_DATA_DIR: dataDir },
  });
  for (let i = 0; i < 60; i++) {
    await sleep(250);
    try { const r = await fetch(`http://127.0.0.1:${PORT}/status`); if (r.ok) break; } catch {}
  }
  try { token = JSON.parse(readFileSync(join(dataDir, 'admin.json'), 'utf8')).token || ''; } catch {}
});
after(() => { try { relay && relay.kill('SIGKILL'); } catch {} try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

test('the operator’s four numbers are all answerable from the admin-gated endpoint', async () => {
  assert.ok(token, 'no admin token — the panel could not read its own stats');
  const r = await fetch(`http://127.0.0.1:${PORT}/stats?days=1`, { headers: { Authorization: 'Bearer ' + token } });
  assert.equal(r.status, 200, '/stats refused the admin token');
  const s = await r.json();
  // churches, events and profiles come from the stored-event stats; connections is live and cannot.
  assert.ok(Array.isArray(s.churches), '/stats lost `churches` — the Churches card goes back to a dash');
  assert.ok(Array.isArray(s.kinds), '/stats lost `kinds` — the Events and Members cards go back to dashes');
  assert.equal(typeof s.connections, 'number',
    '/stats lost `connections`. That is the one figure stored events cannot answer, so the "Connected now" ' +
    'card becomes a dash — and the tempting fix is to read it from the PUBLIC /status again, which is how ' +
    'church-identifying counts got onto an unauthenticated endpoint in the first place.');
});

test('/status still carries NO church-identifying counts', async () => {
  const s = await (await fetch(`http://127.0.0.1:${PORT}/status`)).json();
  assert.equal(s.ok, true, 'a freshly started relay did not report ok');
  assert.equal(s.counts, undefined,
    'church/member counts are back on the PUBLIC, unauthenticated /status. That endpoint holds itself to ' +
    '"says nothing about the church" — its own clock note says so. Read them from /stats with the admin ' +
    'token instead; the panel already sends one.');
  for (const k of ['churches', 'members']) {
    assert.equal(s[k], undefined, `/status now exposes \`${k}\` to anyone who asks`);
  }
});

// Not a behaviour assertion on app/*.jsx (rule 3 does not apply — control.js is the shipped file itself and
// is not JSX), but a structural one: the reachability verdict must be decided by the fetch alone. If the
// DOM work is ever pulled back inside that try, one renaming field again tells a volunteer to restart a
// healthy server.
test('the panel decides reachability from the fetch, not from rendering', () => {
  const src = readFileSync(join(ROOT, 'relay-app/control.js'), 'utf8');
  const at = src.indexOf('async function poll()');
  assert.notEqual(at, -1, 'poll() is gone — re-anchor this test');
  // STRIP COMMENTS FIRST. This project has been bitten the other way — an ordering assertion satisfied by
  // the comment explaining the rule, 935 tests green over a reintroduced safeguarding bug. Here it bit in
  // reverse: the comments below explain WHY `s.counts` was wrong, and quoting it made the check that it is
  // gone from the CODE fail. Padding with spaces keeps every offset, so the ordering assertions still hold.
  const body = src.slice(at, src.indexOf('\n  }\n', at))
    .replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
  const firstCatch = body.indexOf('catch');
  const notReachable = body.indexOf('Relay not reachable');
  assert.ok(notReachable !== -1, 'the down message vanished — a real outage must still say so');
  // EXACTLY ONE. Checking only the FIRST occurrence let a sabotage through: adding a second
  // "Relay not reachable" after the stats fetch left the first one in place, so an ordering check on
  // indexOf still passed while the panel had regained the power to call a healthy relay dead.
  const downCount = body.split('Relay not reachable').length - 1;
  assert.equal(downCount, 1,
    `"Relay not reachable" is set in ${downCount} places inside poll(). Exactly one may exist, and only ` +
    'where the fetch itself failed — every other path has already had a successful answer from the relay.');
  assert.ok(notReachable < body.indexOf('/stats'),
    'the "not reachable" verdict is set after the stats fetch, so a stats failure can report the relay down');
  assert.ok(firstCatch !== -1 && notReachable > firstCatch,
    'the down message is no longer inside the fetch catch');
  assert.doesNotMatch(body, /s\.counts/,
    'poll() reads s.counts from /status again — that field does not exist and the throw is reported as ' +
    'the relay being unreachable');
});
