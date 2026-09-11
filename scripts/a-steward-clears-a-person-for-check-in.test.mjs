// THE SCREEN A STEWARD CLEARS PEOPLE ON — driven, not described.
//   Run: node --test scripts/a-steward-clears-a-person-for-check-in.test.mjs
//
// Slice 2 of reference/SCOPE-CHECKIN-SURFACES-2026-09-09.md, and THE FIRST POINT-OF-USE TEST THE CHECK-IN
// PERMISSION BOUNDARY HAS EVER HAD. Three audits went over that boundary and found no way in; the reason is
// arithmetic rather than luck — before this screen, `grep -rl grantCheckinPermission app/` returned nothing,
// so no test could possibly have driven it from the place a person uses it. CLAUDE.md rule 1: "a well-tested
// engine nobody is required to consult is not a feature."
//
// WHAT IS REAL HERE AND WHAT IS NOT. The two components are the SHIPPED ones, sliced out of
// app/stew-dashboard.jsx by brace-match and compiled with the same esbuild the packaged build uses — rule 3
// forbids asserting any of this by matching text in an app/*.jsx file, because those ship unbundled and a
// `false && ` leaves every word in place. `Steward.checkinPermissionLifetimes`,
// `checkinPermissionSuggestions` and `checkinPermissionPreview` are the REAL functions, imported out of
// scripts/checkin-role-source.mjs — the module esbuild inlines into vendor/steward.js — because they are the
// decisions the tests are named after (which shapes exist, who a team suggests, whether a date is refused).
// What is stubbed is the world: the relay, the clock's church, and the publish.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fnBody } from './test-slice.mjs';
import { miniReact, texts, reads, glued } from './render-jsx-screen.mjs';
import { PERMISSION_LIFETIMES, DEFAULT_PERMISSION_LIFETIME, permissionPolicy, permissionWindow,
         permissionFault, eligibleHelpers, isPermissionSource, GRANT_SOURCE } from './checkin-role-source.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const SRC = readFileSync(join(ROOT, 'app/stew-dashboard.jsx'), 'utf8');

const ADA = 'a'.repeat(64);      // on the church's children's team
const BEN = 'b'.repeat(64);      // on the team too
const CARA = 'c'.repeat(64);     // an ordinary member, not on any team
const DAN = 'd'.repeat(64);      // already cleared
const TODAY = new Date().toISOString().slice(0, 10);
const NAMES = { [ADA]: 'Ada Fenn', [BEN]: 'Ben Roe', [CARA]: 'Cara Lyle', [DAN]: 'Dan Peart' };

const Stub = (n) => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };
// The RENDERED tree only — see the note in the-check-in-desk-names-its-session-and-guardians.test.mjs for
// why the shared find()/button() cannot be used for counting.
function shown(n, pred, out = []) {
  if (!n || typeof n !== 'object') return out;
  if (Array.isArray(n)) { n.forEach(c => shown(c, pred, out)); return out; }
  if (pred(n)) out.push(n);
  (n.kids || []).forEach(c => shown(c, pred, out));
  return out;
}
const btn = (tree, label) => shown(tree, n => n.type === 'button' && texts(n).join(' ').includes(label));
const said = (tree) => texts(tree).join(' ').replace(/\s+/g, ' ');

// BOTH components, in one slice, because CheckinClearances renders ClearPersonModal as a real child — the
// modal IS the granting act, so stubbing it would leave this file asserting about a button that opens
// nothing.
async function screen({ perms = [], loaded = true, members = Object.keys(NAMES).map(p => ({ pubkey: p, name: NAMES[p] })),
                        rosters = [], groups = [], grantOk = true, revokeOk = true, minors = [] } = {}) {
  const src = fnBody(SRC, 'function CheckinClearances() {', 'CheckinClearances')
            + '\n' + fnBody(SRC, 'function ClearPersonModal({', 'ClearPersonModal');
  const tmp = join(tmpdir(), 'ckclear-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, src + '\nexport { CheckinClearances };\n');
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const { React, draw } = miniReact();
  const granted = [];
  const revoked = [];
  const banners = [];
  const globals = {
    React,
    Panel: function Panel(p) { return React.createElement('div', { 'data-panel': p.title }, p.action, p.children); },
    DismissibleNote: function DismissibleNote(p) { return React.createElement('div', { 'data-note': p.id }, p.children); },
    CkModal: function CkModal(p) { return React.createElement('div', { 'data-modal': p.title }, p.children); },
    Icon: Stub('Icon'),
    todayISO: () => TODAY,
    window: {
      useStewardCheckinPermissions: () => perms,
      useStewardMembers: () => members,
      useStewardSafeguard: () => ({ minors, approved: [], nophoto: [] }),
      useStewardRosters: () => rosters,
      useStewardGroups: () => groups,
      useStewardIdv: () => 1,
      useStewardConn: () => 1,
      stewardStreamLoaded: () => loaded,
      Steward: {
        // THE REAL TABLE, not a list this file typed. A test-local ['day','dated','open'] would keep passing
        // if the console started offering a fourth shape nothing enforces.
        checkinPermissionLifetimes: () => Object.keys(PERMISSION_LIFETIMES).map(k => ({ id: k,
          label: PERMISSION_LIFETIMES[k].label, describe: PERMISSION_LIFETIMES[k].describe,
          expires: PERMISSION_LIFETIMES[k].max != null })),
        // THE REAL SUGGESTION QUESTION — eligibleHelpers, the one swappable source in the product.
        checkinPermissionSuggestions: (o) => {
          const policy = permissionPolicy({ source: o.source, lifetime: o.lifetime });
          return { source: policy.source, lifetime: policy.lifetime,
            pubs: eligibleHelpers(policy.source, { rota: o.rota, childrenTeams: o.childrenTeams,
              rosters: o.rosters, teamId: o.teamId, people: o.people }) };
        },
        // AND THE REAL REFUSAL DIAGNOSIS. This is the function the audit's fifth item is about, so a stub of
        // it would be the test answering the question it is named after.
        checkinPermissionPreview: (o) => {
          const lifetime = permissionPolicy({ lifetime: o.lifetime }).lifetime;
          const win = permissionWindow(lifetime, { date: o.date, until: o.until, from: o.from, at: o.at });
          if (!win) {
            const raw = String((lifetime === 'dated' ? o.until : o.date) || '').trim();
            if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return { ok: false, from: 0, until: null, why: 'Pick a date first.' };
            const cap = Math.floor(PERMISSION_LIFETIMES[lifetime].max / 86400);
            return { ok: false, from: 0, until: null, why: lifetime === 'dated'
              ? ('That date is too far ahead. A clearance can run for at most ' + cap + ' days — about a year — so this one was not saved. Pick a nearer date, or choose “until a steward ends it”.')
              : 'That date is one this console cannot place, so nothing was saved.' };
          }
          const fault = permissionFault(win.from, win.until, lifetime);
          return { ok: !fault, from: win.from, until: win.until, why: fault ? ('That clearance would be refused: ' + fault + '.') : '' };
        },
        grantCheckinPermission: (o) => { granted.push(o); return Promise.resolve(grantOk ? { person: o.person } : null); },
        revokeCheckinPermission: (who) => { revoked.push(who); return Promise.resolve(revokeOk ? true : null); },
      },
      dispatchEvent: (e) => { banners.push((e && e.detail) || {}); return true; },
    },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = (init || {}).detail; } },
    setTimeout, clearTimeout, console, Math, Date, JSON, Set, Number, String, Array, Promise, Object,
  };
  const key = '__ckclear_' + Math.random().toString(36).slice(2);
  globalThis[key] = globals;
  const preamble = Object.keys(globals).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  const { CheckinClearances } = await import('data:text/javascript;base64,' + Buffer.from(preamble + '\n' + js).toString('base64'));
  let tree = draw(CheckinClearances, {});
  const redraw = () => { tree = draw(CheckinClearances, {}); return tree; };
  const press = (label, which = 0) => {
    const bs = btn(tree, label);
    assert.ok(bs.length > which, 'no button labelled ' + JSON.stringify(label) + ' on this screen — re-anchor');
    bs[which].props.onClick();
    return redraw();
  };
  return {
    granted, revoked, banners, redraw, press,
    tree: () => tree,
    open() { return press('Clear someone'); },
    input(id) {
      const f = shown(tree, n => n.props && n.props.id === id);
      assert.equal(f.length, 1, 'no field #' + id + ' on this screen — re-anchor');
      return f[0];
    },
    set(id, value) { this.input(id).props.onChange({ target: { value } }); return redraw(); },
  };
}

// A clearance row the way subscribeCheckinPermissions delivers one: parsed through the RELAY'S OWN parser,
// so the console and the box cannot disagree about what a permission means.
const row = (person, o = {}) => ({ id: person, person, source: o.source || 'steward',
  lifetime: o.lifetime || 'open', from: o.from != null ? o.from : Math.floor(Date.now() / 1000) - 86400,
  until: o.until !== undefined ? o.until : null, ts: 1789000000, _by: 'church' });

// ── WHO IS CLEARED, AND UNTIL WHEN ────────────────────────────────────────────────────────────────────────

test('a cleared person is named on the screen, with how long for', async () => {
  const s = await screen({ perms: [row(DAN, { lifetime: 'open' })] });
  const t = said(s.tree());
  assert.match(t, /Dan Peart/, 'the screen does not show who the church has cleared at all');
  assert.match(t, /Until someone here ends it/,
    'the screen shows no end for an open-ended clearance. A steward has to be able to read back the shape ' +
    'they chose — an invented date is how a church comes to believe a clearance lapses when nothing lapses it');
});

test('a DATED clearance shows the church\'s own date and not a shape it did not choose', async () => {
  const until = Math.floor(new Date(2027, 0, 31, 23, 59, 59).getTime() / 1000);
  const s = await screen({ perms: [row(DAN, { lifetime: 'dated', until })] });
  const t = said(s.tree());
  assert.match(t, /Until .*2027/, 'a dated clearance does not show its end date: ' + t);
  assert.doesNotMatch(t, /Until someone here ends it/, 'a dated clearance was described as open-ended');
});

test('A LAPSED CLEARANCE IS SHOWN AS ENDED, not hidden', async () => {
  // reference/DOMAIN.md: "say a key has expired; do not lock a helper out mid-session". The console half of
  // that is: it is the answer to "why can Margaret not open the register any more", and a church renewing
  // in January renews from last year's list.
  const t0 = Math.floor(Date.now() / 1000);
  const s = await screen({ perms: [row(DAN, { lifetime: 'dated', from: t0 - 200000, until: t0 - 100 })] });
  const t = said(s.tree());
  assert.match(t, /Dan Peart/, 'a lapsed clearance vanished from the screen entirely');
  assert.match(t, /Ended /, 'a lapsed clearance is not marked as ended: ' + t);
});

// ── A CLEARANCE THAT HAS NOT STARTED YET — THE THIRD STATE THIS ROW DID NOT HAVE ──────────────────────────
//
// S1 of the churchwarden sim round in reference/SCOPE-CHECKIN-SEALING-2026-09-10.md, and the most likely
// thing a warden ever does with this panel: "clear Maureen for next Sunday." The row was BINARY —
// `r.live ? runsTo(r) : 'Ended ' + fmtD(r.until)` — so a window entirely in the future is not live, falls to
// the else branch, and tells the church the clearance is over. Reproduced four times on the real screen
// (Sep 11, 13 and 20, with today being Sep 10); a clearance for TODAY rendered correctly, which is why the
// shipped tests above did not see it — every one of them uses a live or a lapsed window.
//
// ⚠ reads(), NOT said(). said() joins text nodes with a space and cannot see a JSX whitespace bug; that is
// how copy shipped to the Oppo reading "openthis page" under a green assertion. These labels are single
// computed strings, so there is nothing to glue — and glued() is asserted empty below so that stays true.
const IN_TWO_DAYS = Math.floor(Date.now() / 1000) + 2 * 86400;
const END_OF_THAT_DAY = IN_TWO_DAYS + 86399;

test('A CLEARANCE FOR NEXT SUNDAY IS NOT OVER — the row that said "Ended" for a date still to come', async () => {
  // The exact shape the sim drove: "just that day", a Sunday two days out. This is what the warden picks.
  const s = await screen({ perms: [row(DAN, { lifetime: 'day', from: IN_TWO_DAYS, until: END_OF_THAT_DAY })] });
  const t = reads(s.tree());
  assert.match(t, /Dan Peart/, 'a future-dated clearance is not on the screen at all');
  assert.doesNotMatch(t, /Ended/,
    'A CLEARANCE FOR A DAY STILL TO COME WAS LABELLED "ENDED". That is the S1 defect: the row has two ' +
    'states and needs three, so the commonest act a churchwarden performs reads back as already over — and ' +
    'a warden who believes it will clear somebody again, or stop trusting the panel. As rendered: ' + t);
  assert.match(t, /not started yet/,
    'and it does not say that it has not begun. "For Sep 13, 2026 only" alone cannot be told apart from a ' +
    'clearance running today, which is the fact the row exists to carry. As rendered: ' + t);
  assert.deepEqual(glued(s.tree()), [],
    'two pieces of this row run together with no separator a reader can see — the JSX newline trap');
});

test('…and a future clearance with an END DATE says both ends, without inventing "Ended"', async () => {
  const s = await screen({ perms: [row(DAN, { lifetime: 'dated', from: IN_TWO_DAYS, until: IN_TWO_DAYS + 200 * 86400 })] });
  const t = reads(s.tree());
  assert.doesNotMatch(t, /Ended/, 'a dated clearance that has not opened yet was labelled as over: ' + t);
  assert.match(t, /From .* until /,
    'a clearance starting later and ending later does not say when it starts — so the church cannot tell ' +
    'it from one running now: ' + t);
});

test('…and an OPEN-ENDED clearance dated forward keeps the shape the church chose', async () => {
  // runsTo()'s own rule, extended to the third state: say the shape the steward picked, never a date they
  // did not type. An open-ended clearance starting in January must not acquire an expiry on screen.
  const s = await screen({ perms: [row(DAN, { lifetime: 'open', from: IN_TWO_DAYS, until: null })] });
  const t = reads(s.tree());
  assert.doesNotMatch(t, /Ended/, 'an open-ended clearance starting later was labelled as over: ' + t);
  assert.match(t, /From .*until someone here ends it/,
    'it lost the church\'s own "until someone here ends it" shape, or does not say when it starts: ' + t);
});

test('A CLEARANCE FOR TODAY STILL READS EXACTLY AS IT DID — the regression half', async () => {
  // The state that WAS correct, pinned, because the third state was added by rewriting the expression that
  // produced this one. reference/SCOPE-CHECKIN-SEALING-2026-09-10.md: "Clearing for today renders correctly."
  const t0 = Math.floor(Date.now() / 1000);
  const day = await screen({ perms: [row(DAN, { lifetime: 'day', from: t0 - 3600, until: t0 + 3600 })] });
  const dt = reads(day.tree());
  assert.match(dt, /^.*For .* only/, 'a clearance running TODAY no longer reads as the day it covers: ' + dt);
  assert.doesNotMatch(dt, /not started yet/, 'a clearance running today was described as not yet begun: ' + dt);
  assert.doesNotMatch(dt, /Ended/, 'a clearance running today was described as over: ' + dt);
  const open = await screen({ perms: [row(DAN, { lifetime: 'open' })] });
  assert.match(reads(open.tree()), /Until someone here ends it/,
    'a live open-ended clearance lost its own sentence: ' + reads(open.tree()));
  assert.doesNotMatch(reads(open.tree()), /From /, 'a live clearance acquired a start date it did not need');
});

test('LIVE, THEN NOT-YET, THEN ENDED — the order a warden reads the list in', async () => {
  // The sort was `Number(b.live) - Number(a.live)`, which files a clearance for next Sunday in with the
  // lapsed ones at the bottom. A church renewing in January needs last year's list at the BOTTOM and the
  // ones about to start near the top, or the row it most wants is the one it has to scroll for.
  const t0 = Math.floor(Date.now() / 1000);
  const s = await screen({ perms: [
    row(ADA, { lifetime: 'dated', from: t0 - 200000, until: t0 - 100 }),          // ended
    row(BEN, { lifetime: 'day', from: IN_TWO_DAYS, until: END_OF_THAT_DAY }),     // not started
    row(CARA, { lifetime: 'open', from: t0 - 86400, until: null }),               // live
  ] });
  const t = reads(s.tree());
  const at = (name) => { const i = t.indexOf(name); assert.ok(i >= 0, name + ' is not on the screen: ' + t); return i; };
  assert.ok(at('Cara Lyle') < at('Ben Roe'),
    'a live clearance sorted below one that has not started yet');
  assert.ok(at('Ben Roe') < at('Ada Fenn'),
    'A CLEARANCE FOR NEXT SUNDAY SORTED IN WITH THE LAPSED ONES. It is a decision the church has just ' +
    'taken, not a record of one that expired: ' + t);
});

test('"NOBODY IS CLEARED YET" IS ONLY SAID ONCE THE RELAY HAS ANSWERED', async () => {
  // The recurring safeguarding shape in this codebase (memory: cached-paints-before-authority-arrives, and
  // the register beside this panel carries the same comment). An empty list before the first delivery is
  // "not arrived", not "the church has cleared nobody", and a steward who reads the second goes and clears
  // people who are already cleared.
  const waiting = await screen({ perms: [], loaded: false });
  assert.match(said(waiting.tree()), /Loading who/, 'a screen with nothing delivered yet claimed the church has cleared nobody');
  assert.doesNotMatch(said(waiting.tree()), /Nobody is cleared yet/, 'same');
  const empty = await screen({ perms: [], loaded: true });
  assert.match(said(empty.tree()), /Nobody is cleared yet/, 'a church that really has cleared nobody is told nothing');
});

test('a document the relay\'s parser would not vouch for is not shown as a clearance', async () => {
  // subscribeCheckinPermissions delivers `{ _invalid: true }` for anything readCheckinPermission refuses.
  // Showing one would put a person on this list whom the relay REFUSES — the church believing somebody is
  // cleared while their key opens nothing, which is the worst direction for this screen to be wrong in.
  const s = await screen({ perms: [{ id: ADA, person: ADA, _invalid: true, ts: 1 }, { id: DAN, _locked: true, ts: 1 }], loaded: true });
  const t = said(s.tree());
  assert.doesNotMatch(t, /Ada Fenn/, 'an unparseable permission was displayed as a clearance');
  assert.match(t, /Nobody is cleared yet/, 'and the screen did not fall back to its honest empty state');
});

// ── CLEARING SOMEBODY ─────────────────────────────────────────────────────────────────────────────────────

test('THE STEWARD CLEARS A PERSON, AND THE SHIPPED SCREEN CALLS THE BOUNDARY', async () => {
  const s = await screen();
  s.open();
  s.press('Ada Fenn');
  s.press('Clear for check-in');
  await new Promise(r => setTimeout(r, 0));
  assert.equal(s.granted.length, 1,
    'THE SCREEN CLEARED NOBODY. grantCheckinPermission is the whole of this slice, and until this screen ' +
    'existed nothing in app/ called it at all.');
  assert.equal(s.granted[0].person, ADA, 'the wrong person was cleared: ' + JSON.stringify(s.granted[0]));
});

test('THE TIGHTEST SHAPE IS THE DEFAULT — a steward who touches nothing clears somebody for ONE DAY', async () => {
  const s = await screen();
  s.open();
  s.press('Ada Fenn');
  s.press('Clear for check-in');
  await new Promise(r => setTimeout(r, 0));
  assert.equal(s.granted[0].lifetime, DEFAULT_PERMISSION_LIFETIME,
    'the screen\'s default clearance is ' + JSON.stringify(s.granted[0].lifetime) + ' and the product\'s is ' +
    JSON.stringify(DEFAULT_PERMISSION_LIFETIME) + '. A screen defaulting to the LOOSER shape hands a ' +
    'year-long clearance to a steward who thought they were clearing somebody for a morning.');
  assert.equal(s.granted[0].lifetime, 'day', 're-anchor: the tightest permission shape is no longer `day`');
  assert.equal(s.granted[0].date, TODAY, 'a `day` clearance was granted for a day that is not today');
});

test('a steward may pick "until a steward ends it", and it goes out as `open`', async () => {
  const s = await screen();
  s.open();
  s.press('Ada Fenn');
  s.press(PERMISSION_LIFETIMES.open.label);
  s.press('Clear for check-in');
  await new Promise(r => setTimeout(r, 0));
  assert.equal(s.granted[0].lifetime, 'open', 'choosing the open-ended shape did not reach the boundary');
});

test('THE PROVENANCE IS THE TRUE ONE — a steward naming somebody by hand is filed as `steward`, never `rota`', async () => {
  // The audit's fourth item: grantCheckinPermission defaults `source` to 'rota' however the person was
  // chosen, "against checkin-role-source.mjs's claim that naming somebody by hand IS a declared source and
  // says so in the enforced record. The screen knows which it was; pass it."
  const s = await screen();
  s.open();
  s.press('Cara Lyle');
  s.press('Clear for check-in');
  await new Promise(r => setTimeout(r, 0));
  assert.equal(s.granted[0].source, 'steward',
    'a person a steward picked by hand was filed as ' + JSON.stringify(s.granted[0].source) + '. This screen ' +
    'never asks a rota, so `rota` in an enforced safeguarding record would be a false statement about how ' +
    'the clearance was decided.');
  assert.ok(isPermissionSource(s.granted[0].source), 'the source is not one a permission may declare');
  assert.notEqual(s.granted[0].source, GRANT_SOURCE, 'a permission cited itself as its own provenance');
});

test('…AND A TEAM\'S ROSTER FILLS THE LIST AND IS FILED AS `team`', async () => {
  const s = await screen({
    groups: [{ id: 'team-kids', kind: 'team', name: 'Sunday Club' }, { id: 'g1', kind: 'group', name: 'Prayer' }],
    rosters: [{ id: 'team-kids', team: 'team-kids', people: [{ pub: ADA, name: 'Ada' }, { pub: BEN, name: 'Ben' }] }],
  });
  s.open();
  s.set('ck-clear-team', 'team-kids');
  const t = said(s.tree());
  assert.match(t, /Ada Fenn/, 'the team\'s roster did not fill the list');
  assert.doesNotMatch(t, /Cara Lyle/,
    'somebody who is NOT on the chosen team was still offered. The suggestion is meant to narrow the list, ' +
    'and a source that quietly falls back to everybody is not a suggestion');
  s.press('Ada Fenn');
  s.press('Clear for check-in');
  await new Promise(r => setTimeout(r, 0));
  assert.equal(s.granted[0].source, 'team', 'a name taken from a team roster was filed as ' + JSON.stringify(s.granted[0].source));
});

test('a team\'s roster only SUGGESTS — every row still has to be ticked', async () => {
  // "A DBS certificate and a lead's sign-off are facts this product does not hold and must not infer."
  const s = await screen({
    groups: [{ id: 'team-kids', kind: 'team', name: 'Sunday Club' }],
    rosters: [{ id: 'team-kids', team: 'team-kids', people: [{ pub: ADA }, { pub: BEN }] }],
  });
  s.open();
  s.set('ck-clear-team', 'team-kids');
  s.press('Clear for check-in');
  await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(s.granted, [],
    'choosing a team CLEARED ITS WHOLE ROSTER with nobody ticked. That is the relay deciding who is cleared ' +
    'from a rota, which is precisely the model the 2026-09-09 restructure removed.');
});

test('somebody already cleared is not offered again', async () => {
  const s = await screen({ perms: [row(DAN)] });
  s.open();
  const t = said(s.tree());
  assert.match(t, /Ada Fenn/, 'fixture: Ada should be offerable');
  // Dan's name is on the clearance list behind the modal; what must not happen is a second grant row for him.
  assert.equal(btn(s.tree(), 'Dan Peart').filter(b => texts(b).join(' ').indexOf('Withdraw') < 0).length, 0,
    'a person the church has already cleared was offered for clearing again');
});

test('A MARKED CHILD IS NOT OFFERED FOR CLEARING — from "everyone" or from a team roster', async () => {
  // Device finding D4, 2026-09-11: Maureen, marked as a child a minute earlier, was listed under "Clear
  // someone for children's check-in" with the source on "Everyone in the church".
  const s = await screen({ minors: [ADA] });
  s.open();
  assert.match(said(s.tree()), /Dan Peart/, 'fixture: an adult should be offerable');
  assert.equal(btn(s.tree(), 'Ada Fenn').length, 0,
    'A CHILD IS OFFERED AS A CHILDREN\'S WORKER. Ada is on the church\'s minors list and the modal still lists ' +
    'her under WHO. As rendered: ' + said(s.tree()));
  // and the same through a team roster that still carries her
  const t = await screen({ minors: [ADA],
    groups: [{ id: 'team-kids', kind: 'team', name: 'Sunday Club' }],
    rosters: [{ id: 'team-kids', team: 'team-kids', people: [{ pub: ADA, name: 'Ada' }, { pub: BEN, name: 'Ben' }] }] });
  t.open();
  t.set('ck-clear-team', 'team-kids');
  assert.match(said(t.tree()), /Ben Roe/, 'fixture: the team roster did not fill the list at all');
  assert.equal(btn(t.tree(), 'Ada Fenn').length, 0, 'a team roster that still names a marked child offers her for clearing');
});

// ── THE REFUSAL THAT USED TO BE SILENT ────────────────────────────────────────────────────────────────────

test('A DATE PAST THE 400-DAY CAP IS REFUSED WITH A REASON ON SCREEN, not a bare nothing', async () => {
  // The audit's fifth item. permissionWindow refuses a 400-day-plus `dated` clearance rather than silently
  // shortening it — "a church that typed 2099 must see it" — and grantCheckinPermission returned a bare
  // null, so the church saw nothing at all.
  const s = await screen();
  s.open();
  s.press('Ada Fenn');
  s.press(PERMISSION_LIFETIMES.dated.label);
  s.set('ck-clear-date', '2099-12-31');
  const t = said(s.tree());
  assert.match(t, /too far ahead/,
    'the screen said nothing about a clearance the relay will refuse: ' + t);
  assert.match(t, /400 days/, 'the reason does not say what the limit actually is: ' + t);
  // AND THE BUTTON MUST NOT FIRE A WRITE THAT CANNOT SUCCEED — asserted twice on purpose. `disabled` is
  // what a person sees; the HANDLER refusing is what holds when anything reaches it another way. This test
  // found the second half missing: pressing through published a 2099 clearance the relay refuses.
  assert.equal(btn(s.tree(), 'Clear for check-in')[0].props.disabled, true, 'the button was not disabled');
  s.press('Clear for check-in');
  await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(s.granted, [], 'a clearance the relay would refuse was published anyway');
});

test('a valid dated clearance goes out with the church\'s own date', async () => {
  const s = await screen();
  s.open();
  s.press('Ada Fenn');
  s.press(PERMISSION_LIFETIMES.dated.label);
  s.set('ck-clear-date', '2027-01-31');
  assert.doesNotMatch(said(s.tree()), /too far ahead/, 'a date inside the cap was reported as too far ahead');
  s.press('Clear for check-in');
  await new Promise(r => setTimeout(r, 0));
  assert.equal(s.granted.length, 1, 'a clearance inside the cap was not published');
  assert.equal(s.granted[0].lifetime, 'dated');
  assert.equal(s.granted[0].until, '2027-01-31', 'the date the steward typed did not reach the boundary');
});

test('switching to "until a date" does not leave today\'s date behind as a closed window', async () => {
  const s = await screen();
  s.open();
  s.press('Ada Fenn');
  s.press(PERMISSION_LIFETIMES.dated.label);
  assert.equal(s.input('ck-clear-date').props.value, '',
    'the date field still holds today after switching to "until a date", which is a clearance that closes ' +
    'before it opens — offered to the steward as if it were fine');
  assert.match(said(s.tree()), /Pick a date first/, 'and nothing told them to pick one');
});

// ── WITHDRAWING ONE ───────────────────────────────────────────────────────────────────────────────────────

test('WITHDRAWING A CLEARANCE CALLS THE BOUNDARY, and takes two taps', async () => {
  const s = await screen({ perms: [row(DAN)] });
  s.press('Withdraw');
  assert.deepEqual(s.revoked, [],
    'one tap withdrew a clearance. This ends every session at once, so it is worth a confirmation — and a ' +
    'mis-tap at a busy door is exactly the case.');
  s.press('Withdraw');
  await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(s.revoked, [DAN], 'confirming did not reach revokeCheckinPermission: ' + JSON.stringify(s.revoked));
});

test('and "Keep" leaves it alone', async () => {
  const s = await screen({ perms: [row(DAN)] });
  s.press('Withdraw');
  s.press('Keep');
  assert.deepEqual(s.revoked, [], 'pressing Keep withdrew the clearance anyway');
  assert.match(said(s.tree()), /Dan Peart/, 'the row disappeared after Keep');
});

// ── AND NOTHING IS CLAIMED THAT DID NOT HAPPEN ────────────────────────────────────────────────────────────

test('A REFUSED GRANT IS REPORTED AND NAMES WHO WAS NOT SAVED', async () => {
  const s = await screen({ grantOk: false });
  s.open();
  s.press('Ada Fenn');
  s.press('Clear for check-in');
  await new Promise(r => setTimeout(r, 0));
  assert.equal(s.banners.length, 1,
    'grantCheckinPermission returned null and the screen said nothing. A steward then believes somebody is ' +
    'cleared who is not, and finds out when that person turns up to an empty room.');
  assert.match(s.banners[0].message, /Ada Fenn/, 'the warning does not name who was not cleared: ' + s.banners[0].message);
  assert.match(s.banners[0].message, /NOT cleared/, 're-anchor: the refusal wording changed');
});

test('A REFUSED WITHDRAWAL IS REPORTED — the person is still cleared', async () => {
  const s = await screen({ perms: [row(DAN)], revokeOk: false });
  s.press('Withdraw');
  s.press('Withdraw');
  await new Promise(r => setTimeout(r, 0));
  assert.equal(s.banners.length, 1,
    'a withdrawal that reached no relay was reported as done. The row leaves the screen and every relay goes ' +
    'on admitting them, which is the fire-and-forget shape this console has already been bitten by twice.');
  assert.match(s.banners[0].message, /NOT withdrawn/, 're-anchor: the refusal wording changed');
});

test('the panel says ONCE that a clearance is not a key, and does not claim wiring that does not exist', async () => {
  // reference/DOMAIN.md: "say the thing once, plainly, where it is useful". And CLAUDE.md rule 4 applied to
  // copy: nothing calls issueCheckinSessionKeys yet, so the note must not tell a steward that clearing
  // somebody puts this Sunday's key on their phone.
  const s = await screen({ perms: [row(DAN)] });
  const note = shown(s.tree(), n => n.props && n.props['data-note'] === 'checkin-clearance-intro');
  assert.equal(note.length, 1, 'the honesty note is not on the panel — a steward is owed this once');
  const t = texts(note[0]).join(' ').replace(/\s+/g, ' ');
  assert.match(t, /every/, 'the note does not say the relay re-checks the clearance on every request: ' + t);
  assert.match(t, /not/, 'the note does not distinguish a clearance from a key: ' + t);
  assert.equal(shown(s.tree(), n => n.props && n.props['data-note']).length, 1,
    'more than one note on one panel is the nag reference/DOMAIN.md rules out');
});
