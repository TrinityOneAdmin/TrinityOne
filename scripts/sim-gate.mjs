// REFUSE TO START A SIMULATION ROUND ON GROUND THAT IS NOT READY.
//
//   node scripts/sim-gate.mjs <church-npub> [--cast sim-cast.json] [--relay ./relay/relay.sqlite]
//
// WHY THIS EXISTS. The round of 2026-08-17 produced fifteen agents' worth of findings, and a large share of
// them were about MY SETUP rather than the product:
//
//   · 24 of 30 members never published a `member:` document, so the relay did not consider them members.
//     They spent their runs looking at an empty church and reporting "0 people" as a defect.
//   · The Care feature was never switched on, so the round's headline focus was unreachable and three agents
//     independently reported "there is no way to ask for help".
//   · The console auto-locked and silently stopped enrolling anyone, so the whole congregation displayed as
//     "Member" — the owner found that on his own phone before any test did.
//   · The whole care team was put on the cleared-for-youth list, which the console explicitly warns against,
//     which then made a genuine safeguarding probe look like a hole when it was a misconfiguration.
//
// Every one of those was visible in the store BEFORE the agents started. Nobody looked, because checking was
// a human step with no checkpoint — the same shape of failure as the release gate this repo already fixed.
//
// So: this runs against the store and EXITS NON-ZERO if the ground is not ready. It is not advisory. Wire it
// ahead of the agent launch so a bad round cannot begin, rather than being diagnosed afterwards.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const npub = process.argv[2];
const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d);
const CAST = arg('--cast', '/mnt/storage/tmp/trinity-scratch/sim-cast.json');
const DB = arg('--relay', './relay/relay.sqlite');
if (!npub) { console.error('usage: sim-gate.mjs <church-npub> [--cast f.json] [--relay db]'); process.exit(2); }

const q = (sql) => execFileSync('sqlite3', [DB, sql], { encoding: 'utf8' }).trim();
const rows = (sql) => q(sql).split('\n').filter(Boolean);

let cast = [];
try { cast = JSON.parse(readFileSync(CAST, 'utf8')); } catch (e) { console.error('cannot read cast:', e.message); process.exit(2); }

// the church's hex pubkey, taken from the store rather than decoded here — if the store does not know this
// church, that is itself the first thing worth failing on
const cps = rows(`SELECT DISTINCT pubkey FROM events WHERE dtag LIKE 'trinityone/namekey:%';`);
const cp = cps[0] || '';

const checks = [];
const check = (name, ok, detail) => { checks.push({ name, ok: !!ok, detail: detail || '' }); };

// ── 1. the church exists and can be read ────────────────────────────────────────────────────────────────
check('the church has published a profile', rows(`SELECT 1 FROM events WHERE kind=0 LIMIT 1;`).length > 0,
  'no kind-0 — members will see an unnamed church');
check('the church has a name key', !!cp, 'without it every sealed document is unreadable and everyone shows as "Member"');

// ── 2. EVERY member is a member, as the RELAY sees it ───────────────────────────────────────────────────
// The single biggest source of noise last round. A member without this document is not a member to accept(),
// so their writes are refused and their church looks empty — and the app says so confidently.
const memberPubs = new Set(rows(`SELECT DISTINCT pubkey FROM events WHERE dtag LIKE 'trinityone/member:%';`));
const missingMember = cast.filter(c => !memberPubs.has(c.pubkey));
check('every cast member has published a member: document', missingMember.length === 0,
  missingMember.map(m => m.name).join(', '));

// ── 3. EVERY member can read the church's sealed documents ──────────────────────────────────────────────
// The name-key envelope is what makes names resolve and the calendar open. The console only re-issues it
// while it is open and unlocked, so this silently under-covers exactly when nobody is watching.
let keyed = new Set();
try {
  const raw = q(`SELECT raw FROM events WHERE dtag='trinityone/namekey:${cp}';`);
  keyed = new Set(Object.keys(JSON.parse(JSON.parse(raw).content).keys || {}));
} catch (e) {}
const unkeyed = cast.filter(c => !keyed.has(c.pubkey));
check('every cast member is in the name-key envelope', unkeyed.length === 0,
  unkeyed.length + ' not enrolled (' + unkeyed.slice(0, 6).map(m => m.name).join(', ') + ') — they will see "Member" everywhere and a locked calendar');

// ── 4. the features the round is about are actually switched ON ─────────────────────────────────────────
check('Care is switched on', rows(`SELECT 1 FROM events WHERE dtag LIKE '%meals%' OR dtag LIKE '%carecfg%' LIMIT 1;`).length > 0,
  'no care settings document — "Ask for help" will not appear for anyone, and a care round tests nothing');
check('the care team is staffed', (() => {
  try { const raw = q(`SELECT raw FROM events WHERE dtag LIKE 'trinityone/roster:%careteam%' LIMIT 1;`);
    return (JSON.parse(JSON.parse(raw).content).people || []).length > 0; } catch (e) { return false; }
})(), 'roster:<team> has no people — the relay reads THIS, not the group member list');

// ── 5. safeguarding is configured, and configured SANELY ────────────────────────────────────────────────
const listOf = (pfx) => { try { return JSON.parse(JSON.parse(q(`SELECT raw FROM events WHERE dtag LIKE 'trinityone/${pfx}:%' LIMIT 1;`)).content).pubkeys || []; } catch (e) { return []; } };
const minors = listOf('minors'), cleared = listOf('approved');
check('some members are marked as children', minors.length > 0, 'a safeguarding round with no children tests nothing');
check('the cleared-for-youth list is not the whole church', cleared.length > 0 && cleared.length <= Math.max(3, minors.length),
  `${cleared.length} adults cleared for youth. The console's own guidance is "clear only adults on your ` +
  `church's cleared-worker list" — putting a whole team on it makes a real probe look like a hole.`);
check('no child is on the cleared-for-youth list', !minors.some(m => cleared.includes(m)),
  'a member is marked BOTH a child and cleared to contact children');

// ── 6. there is something to look at ────────────────────────────────────────────────────────────────────
// Actors spent last round reporting empty states. A church with no content tests empty states, not the product.
check('the church has groups', rows(`SELECT 1 FROM events WHERE dtag LIKE 'trinityone/group:%' LIMIT 1;`).length > 0, '');
check('the church has events', rows(`SELECT 1 FROM events WHERE dtag LIKE 'trinityone/event:%' LIMIT 1;`).length > 0,
  'no events — the calendar, the group strips and RSVP are all untestable');
check('somebody has said something', rows(`SELECT 1 FROM events WHERE kind=1 LIMIT 1;`).length > 0,
  'no chat at all — every room will read "No messages yet"');

// ── 7. nothing is being refused right now ───────────────────────────────────────────────────────────────
let recentRefusals = 0;
try {
  const log = readFileSync('./relay/rejected.log', 'utf8').trim().split('\n').filter(Boolean);
  const cutoff = Date.now() - 10 * 60 * 1000;
  // EXPECTED refusals are excluded, and named so the exclusion can be argued with. Members' personal study
  // documents (highlights / bookmarks / notes / journal / prayer) are refused before authentication by design;
  // the owner has decided personal files should not depend on a relay at all (ROADMAP-NOTES §1). Counting them
  // would make this gate cry wolf on every run, and a gate that always fails is a gate nobody reads.
  const EXPECTED = /trinityone\/(highlights|bookmarks|notes|journal|prayer|chatseen)$/;
  recentRefusals = log.filter(l => {
    try { const j = JSON.parse(l); return new Date(j.at).getTime() > cutoff && !EXPECTED.test(j.d || ''); }
    catch (e) { return false; }
  }).length;
} catch (e) {}
check('the relay is not refusing writes', recentRefusals === 0,
  recentRefusals + ' refusals in the last 10 minutes — read relay/rejected.log before starting, or the round ' +
  'will report their consequences as product defects');

// ── report ──────────────────────────────────────────────────────────────────────────────────────────────
const failed = checks.filter(c => !c.ok);
for (const c of checks) console.log(`${c.ok ? '  ok  ' : '  FAIL'}  ${c.name}${c.detail && !c.ok ? '\n          ' + c.detail : ''}`);
console.log('');
if (failed.length) {
  console.log(`GROUND NOT READY — ${failed.length} of ${checks.length} checks failed. The round must not start.`);
  console.log('Every one of these was visible in the store before any agent ran. Fix them, then re-run this.');
  process.exit(1);
}
console.log(`ground ready — ${checks.length}/${checks.length} checks passed, ${cast.length} in the cast.`);
