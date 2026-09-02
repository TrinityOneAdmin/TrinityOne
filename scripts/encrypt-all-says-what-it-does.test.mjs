// A PROTECTION MUST NOT PROMISE MORE THAN IT DELIVERS.
// Run: node --test scripts/encrypt-all-says-what-it-does.test.mjs
//
// "Encrypt all group chat" told the steward: "Every group's messages will be sealed end-to-end from now on."
// Measured on the live relay, 2026-08-28, with the switch ON: the church's serving-team room was still
// `encrypted: false` and a message posted there was stored in CLEAR.
//
// The sweep skips teams on purpose — they have no encryption control of their own, and the recipient rule
// would seal a team room to every member of the church rather than to its roster, which is the wrong audience
// for a serving team's private channel. So the behaviour is right and the SENTENCE was wrong.
//
// This file exists because the code immediately above that sweep already states the standard it broke:
// "a church shown a protection it does not have is the one failure this project cannot afford."
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const DASH = readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8');
// Slices END on an anchor, never on a character count: scripts/test-windows.test.mjs rejects a fixed window
// that no longer covers what it names, and it caught this file the moment the dialog copy grew.
const between = (from, to) => {
  const a = DASH.indexOf(from);
  assert.ok(a > 0, `re-anchor: could not find ${from}`);
  const b = DASH.indexOf(to, a + from.length);
  assert.ok(b > a, `re-anchor: could not find ${to} after it`);
  return DASH.slice(a, b);
};
const dialog = between('title="Encrypt all group chat?"', 'onCancel=');

test('the confirmation does not claim EVERY group is sealed', () => {
  assert.doesNotMatch(dialog, /every group['\u2019]s messages will be sealed/i,
    'the dialog promises every group is sealed while the sweep deliberately skips serving teams — a church ' +
    'is told it has a protection it does not have, on the one screen where that matters most');
});

test('…and says plainly that team rooms are left alone', () => {
  assert.match(dialog, /team rooms are not included|Serving team rooms are not included/i,
    'nothing tells the steward which rooms this misses, so they cannot know to check');
});

// ── RUN the sweep rather than read it. A previous version of this file asserted that the string
// `g.kind === 'team' || g.encrypted` appeared in the function, which an added second loop, an `if (false &&`,
// or the same words in a COMMENT all satisfy while teams get swept in anyway. So lift the real arrow function
// out of the screen and execute it against stub groups. ──
// `seal` decides what the relay does with each room's key envelope. Hardcoding `{ sealed: true }` — which is
// what this did — meant the test named "the switch only claims ON once every sweepable room really sealed"
// never produced a room that failed to seal. The case it exists for was unreachable, and an auditor changed
// `if (!r || !r.sealed)` to `if (!r)` with the whole suite green: encryptComms would flip ON, the settings
// row would read "On", and the rooms would be in clear. That is a church shown a protection it does not have.
function runSweep(groups, seal) {
  const body = between('const doEncryptAll = async () =>', '\n  const toggleEncryptAll');
  const sealed = [], published = [];
  const ctx = {
    allGroups: groups,
    f: {},
    setConfirmEnc() {},
    encRecips: (g) => g.visibility === 'invite' ? (g.members || []) : ['m1', 'm2'],
    window: {
      dispatchEvent() {},
      Steward: {
        sealGroup: async (g) => { sealed.push(g.name); return (seal ? seal(g) : { sealed: true, skipped: [] }); },
        publishProfile: (x) => published.push(x),
      },
    },
    CustomEvent: class { constructor(t, i) { this.type = t; this.detail = i && i.detail; } },
  };
  vm.createContext(ctx);
  vm.runInContext(body + '\nthis.run = doEncryptAll;', ctx);
  return ctx.run().then(() => ({ sealed, published }));
}

test('the sweep seals groups and broadcasts and leaves serving teams alone', async () => {
  // encRecips() seals a non-invite room to EVERY member of the church. For a serving team that is the wrong
  // audience: its private channel would be handed to people who are not on it.
  const { sealed } = await runSweep([
    { name: 'Prayer',      kind: 'group' },
    { name: 'Notices',     kind: 'broadcast' },
    { name: 'Safeguarding', kind: 'team' },
    { name: 'Youth',       kind: 'group', encrypted: true },
  ]);
  assert.deepEqual(sealed.sort(), ['Notices', 'Prayer'],
    'the sweep sealed the wrong set — a serving team swept in hands its private room to the whole church, ' +
    'and a room already sealed being re-sealed rotates a key for no reason');
});

test('the switch only claims ON once every sweepable room really sealed', async () => {
  const ok = await runSweep([{ name: 'Prayer', kind: 'group' }]);
  assert.equal(ok.published.length, 1, 'a clean sweep did not flip the flag, so the switch stays off for ever');
  assert.equal(ok.published[0].features.encryptComms, true);
});

// ── and the switch's own reading, executed too: a hollowed-out filter (`.filter(g => false)`) still matches
// the pinned formula, so match the formula AND run it. ──
function readsOn(groups, features) {
  const line = between('const encUnsealed', 'const [confirmEnc');
  const ctx = { allGroups: groups, f: features, React: { useState: () => [] } };
  vm.createContext(ctx);
  vm.runInContext(line.replace(/const \[confirmEnc[\s\S]*$/, '') + '\nthis.on = encOn;', ctx);
  return ctx.on;
}

test('the switch refuses to read ON while any room is unsealed', () => {
  assert.equal(readsOn([{ name: 'Prayer', kind: 'group' }], {}), false,
    'the switch reads ON over an unsealed room — a church shown a protection it does not have');
  assert.equal(readsOn([{ name: 'Prayer', kind: 'group', encrypted: true }], {}), true,
    'everything is sealed and the switch still reads OFF, which is the other way to lose a steward\'s trust');
  assert.equal(readsOn([], { encryptComms: false }), false,
    'a steward deliberately turned it off and it still reads ON');
  assert.equal(readsOn([{ name: 'Safeguarding', kind: 'team' }], {}), true,
    'a serving team — which has no encryption control at all — holds the switch OFF for ever');
});

// ── THE ROW ABOVE THE DIALOG. The confirmation was corrected and the always-visible settings row was not:
// it still read "every group sealed end-to-end", which is the claim a steward actually lives with — the
// dialog is seen once, this line every time they open Settings. The first version of this file could not see
// these two lines at all, because its only window started at the dialog title. ──
const row = between('const encUnsealed', 'title="Encrypt all group chat?"');

test('the settings row does not claim more than the sweep does', () => {
  assert.doesNotMatch(row, /On — every group sealed end-to-end/,
    'the row claims every group is sealed while serving teams are deliberately skipped');
  assert.doesNotMatch(row, /Seal every group['\u2019]s messages end-to-end so not even the relay can read them"/,
    'the toggle\'s hover text still makes the old promise');
});

// Reading the row is not enough: `const encTeams = []` leaves every string in place and kills the caveat
// stone dead. So BUILD the sentence the steward reads, from the real expressions, against real groups.
function subtitle(groups) {
  const teams = between('const encTeams', '\n  const encOn');
  const m = /\{encOn \? ([\s\S]*?) : ('Off[^']*')\}/.exec(row);
  assert.ok(m, 're-anchor: the encrypt-all subtitle is no longer a ternary on encOn');
  const ctx = { allGroups: groups };
  vm.createContext(ctx);
  vm.runInContext(teams + '\nthis.text = (' + m[1] + ');', ctx);
  return ctx.text;
}

test('the row names the exclusion, and only to a church that has one', () => {
  const withTeam = subtitle([{ name: 'Prayer', kind: 'group' }, { name: 'Safeguarding', kind: 'team' }]);
  assert.match(withTeam, /Serving team rooms are not included/,
    'a church WITH a serving team is told its switch covers everything — the one case where it does not');
  const without = subtitle([{ name: 'Prayer', kind: 'group' }]);
  assert.doesNotMatch(without, /Serving team rooms are not included/,
    'a church with no serving team is warned about a room it does not have, which is how a real warning ' +
    'gets tuned out');
});

// ── AUDIT 2026-08-29 (test-integrity round) ─────────────────────────────────────────────────────────────
test('a room the relay refused to seal is NOT counted as sealed', async () => {
  // sealGroup answers { sealed: false } when the relay refuses the key envelope — the case the code writes an
  // operator alert for. Before this, nothing produced that answer.
  const r = await runSweep(
    [{ name: 'Prayer', kind: 'group' }, { name: 'Youth', kind: 'group' }],
    (g) => (g.name === 'Youth' ? { sealed: false, skipped: [] } : { sealed: true, skipped: [] }));
  assert.deepEqual(r.published, [],
    'the switch flipped ON while a room the relay refused to seal is still in clear — the church is shown a ' +
    'protection it does not have');
});

test('…and when every room really seals, it does flip on', async () => {
  const r = await runSweep([{ name: 'Prayer', kind: 'group' }], () => ({ sealed: true, skipped: [] }));
  assert.equal(r.published.length, 1, 'a clean sweep no longer turns the setting on');
});
