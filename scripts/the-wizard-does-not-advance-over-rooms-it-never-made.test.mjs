// A SETUP STEP MUST NOT REPORT SUCCESS OVER WORK THAT NEVER LEFT THE CONSOLE.
// Run: node --test scripts/the-wizard-does-not-advance-over-rooms-it-never-made.test.mjs
//
// Measured 2026-09-04 while staging a church on a self-hosted console. I clicked "Create 3 & continue"
// (Whole Church, Notices, Prayer); the wizard advanced with no error. Then, read off the relay's own sqlite
// rather than the screen: ZERO events by that church key. localStorage groups: []. Dashboard: "Groups 0".
// All three publishes had failed and nothing said so.
//
// publishGroup is explicitly written to report this — src/steward.src.js resolves an object on success and
// NULL on failure, under a comment reading "A partial write now reports FAILURE … An error is recoverable,
// false reassurance is not." saveGroups awaited it and discarded the answer, then called next() regardless.
//
// The step two below it, saveMeetings, already did this correctly — same wizard, same file, same shape,
// one honest and one not. That asymmetry is the finding.
//
// Point of use (rule 1): these EXECUTE the real saveGroups and saveTeam out of app/stew-dashboard.jsx,
// which the console ships unbundled, rather than matching text in them (rule 3 forbids that).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const STEW = readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8');

function arrowBody(src, anchor) {
  const at = src.indexOf(anchor);
  assert.notEqual(at, -1, anchor + ' is missing — re-anchor this test rather than widening a window');
  // KEEP `async`. Slicing from the parameter list drops it, and the body is full of `await` — which then
  // fails to parse as a plain arrow. The error reads like a broken test, not a broken slice.
  const eq = src.indexOf('=', at);
  const asyncAt = src.indexOf('async', eq);
  const paren = src.indexOf('(', eq);
  const arrow = (asyncAt !== -1 && asyncAt < paren) ? asyncAt : paren;
  const open = src.indexOf('{', src.indexOf('=>', paren));
  let d = 0, i = open;
  for (; i < src.length; i++) { const c = src[i]; if (c === '{') d++; else if (c === '}') { d--; if (!d) break; } }
  const body = src.slice(arrow, i + 1);
  assert.ok(body.length > 300, anchor + ' sliced to a stub — re-anchor rather than widening');
  return body;
}
function run(anchor, scope) {
  const proxy = new Proxy(scope, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k];
      const b = String(k).replace(/\d+$/, ''); if (b in t) return t[b];
      throw new ReferenceError('the lifted function needs `' + String(k) + '` — add a stub'); },
    set: (t, k, v) => { t[k] = v; return true; },
  });
  return new Function('scope', `with (scope) { return (${arrowBody(STEW, anchor)}); }`)(proxy);
}

const STARTERS = [{ id: 'a', name: 'Whole Church', kind: 'group', sub: '' },
                  { id: 'b', name: 'Notices', kind: 'broadcast', sub: '' },
                  { id: 'c', name: 'Prayer', kind: 'group', sub: '' }];

// `enc` — the church seals its rooms by default (encByDefaultWiz); `create` — Steward.createEncryptedGroup, the only
// door a room meant to be encrypted may come through; `picked` — which starter rows are ticked.
function groupsScope({ publish, enc = false, create = undefined, picked = ['a', 'b', 'c'] }) {
  const st = { advanced: 0, err: '', picks: new Set(picked), busy: [] };
  const scope = {
    STARTERS, picks: st.picks, encByDefaultWiz: enc,
    setBusy: (v) => st.busy.push(v),
    setGroupErr: (v) => { st.err = typeof v === 'function' ? v(st.err) : v; },
    setPicks: (f) => { st.picks = typeof f === 'function' ? f(st.picks) : f; },
    next: () => { st.advanced++; },
    window: { Steward: { publishGroup: publish, publishGroupKey: async () => ({ ok: 1 }), ...(create ? { createEncryptedGroup: create } : {}) } },
    Promise, React: { useState: () => [null, () => {}] },
  };
  return { st, fn: run('const saveGroups = async () => {', scope) };
}

test('THE REGRESSION: every room failing does NOT advance the wizard, and says so', async () => {
  const g = groupsScope({ publish: async () => null });   // publishGroup: no relay accepted
  await g.fn();
  assert.equal(g.st.advanced, 0,
    'the wizard moved on after creating nothing. The steward is taken to the next step believing their ' +
    'church has three rooms; the relay has nothing, localStorage has nothing, and the dashboard reads ' +
    '"Groups 0". This is the shape the branch already repaired for meetings, two steps further down.');
  assert.match(g.st.err, /Couldn’t create your rooms/, 'it failed silently — nothing on screen said so');
  assert.equal(g.st.busy[g.st.busy.length - 1], false, 'busy was left set, which disables Continue AND Back');
});

test('a PARTIAL failure keeps only the rooms that did not land, so a retry cannot duplicate', async () => {
  let n = 0;
  const g = groupsScope({ publish: async (spec) => (++n === 1 ? { id: 'g1', ...spec, ts: 1 } : null) });
  await g.fn();
  assert.equal(g.st.advanced, 0, 'a partial failure advanced as though it were a success');
  assert.match(g.st.err, /Created 1 of 3/, 'it did not say how much got through');
  assert.deepEqual([...g.st.picks].sort(), ['b', 'c'],
    'the room that WAS created is still selected, so pressing the button again mints a SECOND copy of it — ' +
    'publishGroup generates a fresh id every call');
});

test('CONTROL: when everything lands, it advances and says nothing', async () => {
  const g = groupsScope({ publish: async (spec) => ({ id: 'g' + Math.random(), ...spec, ts: 1 }) });
  await g.fn();
  assert.equal(g.st.advanced, 1, 'a wholly successful step must still move on');
  assert.equal(g.st.err, '', 'it cried wolf over rooms that were created');
});

test('CONTROL: choosing no rooms skips the step, as it always did', async () => {
  const g = groupsScope({ publish: async () => { throw new Error('must not be called'); } });
  g.st.picks.clear();
  const scope2 = groupsScope({ publish: async () => null });
  scope2.st.picks.clear();
  // rebuild with an empty pick set
  const empty = run('const saveGroups = async () => {', {
    STARTERS, picks: new Set(), encByDefaultWiz: false, setBusy: () => {}, setGroupErr: () => {},
    setPicks: () => {}, next: () => { scope2.st.advanced++; },
    window: { Steward: { publishGroup: async () => { throw new Error('must not publish'); } } }, Promise,
  });
  await empty();
  assert.equal(scope2.st.advanced, 1, '"Skip for now" must still skip');
});

test('the team step behaves the same way', async () => {
  const st = { advanced: 0, err: '' };
  const fn = run('const saveTeam = async () => {', {
    teamName: 'Welcome Team', seedRolesFor: () => ['Lead'],
    setBusy: () => {}, setTeamErr: (v) => { st.err = v; }, next: () => { st.advanced++; },
    window: { Steward: { publishGroup: async () => null, publishRoster: async () => ({ ok: 1 }) } }, Promise,
  });
  await fn();
  assert.equal(st.advanced, 0, 'a team the relay refused advanced the wizard anyway');
  assert.match(st.err, /Couldn’t create that team/);
});

test('a team whose ROLES failed says so — a team with no roles cannot hold a rota', async () => {
  const st = { advanced: 0, err: '' };
  const fn = run('const saveTeam = async () => {', {
    teamName: 'Welcome Team', seedRolesFor: () => ['Lead'],
    setBusy: () => {}, setTeamErr: (v) => { st.err = v; }, next: () => { st.advanced++; },
    window: { Steward: { publishGroup: async () => ({ id: 't1' }), publishRoster: async () => null } }, Promise,
  });
  await fn();
  assert.equal(st.advanced, 0);
  assert.match(st.err, /roles didn’t save/,
    'the team was created with no roles and the wizard moved on — the steward reaches the Rota page and ' +
    'cannot put anybody on a Sunday, which is the 2026-08-19 finding this step already had a fix for');
});

// ── A ROOM MEANT TO BE ENCRYPTED IS NEVER CREATED WITHOUT ITS KEY (new church, 2026-10-02) ─────────────────────
// The wizard used to publish each sealed room flagged `encrypted`, try its key, and on failure publish it AGAIN with
// `encrypted: false` and say nothing — and a new church's console has not signed in during the wizard, so the church's
// first rooms came out unencrypted, silently, every time (measured: Whole Church and Prayer, no flag, no key, no word on
// screen). These execute the real saveGroups with the church's default on (encByDefaultWiz) against a Steward whose
// createEncryptedGroup succeeds or refuses, and a publishGroup that is a SPY: the claim is about what is published.
test('a sealed room is made through createEncryptedGroup and never through publishGroup; a broadcast channel is not sealed; nothing is ever unflagged', async () => {
  const published = [], created = [];
  const g = groupsScope({ enc: true,
    publish: async (spec) => { published.push(spec); return { id: 'p' + published.length, ...spec, ts: 1 }; },
    create: async (spec, recips) => { created.push({ spec, recips }); return { ok: true, group: { id: 'k' + created.length, ...spec, encrypted: true, ts: 1 }, skipped: [] }; } });
  await g.fn();
  assert.deepEqual(created.map(c => c.spec.name), ['Whole Church', 'Prayer'], 'the two group rooms were not made through createEncryptedGroup');
  assert.ok(created.every(c => Array.isArray(c.recips) && c.recips.length === 0), 'a new church has no members yet: the key seals to nobody but the church');
  assert.deepEqual(published.map(p => p.name), ['Notices'], 'a sealed room went through publishGroup, or the broadcast channel did not');
  assert.ok(published.every(p => p.encrypted === undefined), 'a room was published carrying an `encrypted` flag outside createEncryptedGroup — or UNflagged: ' + JSON.stringify(published));
  assert.equal(g.st.advanced, 1, 'a wholly successful step must move on');
  assert.equal(g.st.err, '');
});

test('THE REGRESSION: the key cannot be made — no sealed room is created in the clear, the rows stay picked, and the step says why', async () => {
  const published = [];
  const g = groupsScope({ enc: true,
    publish: async (spec) => { published.push(spec); return { id: 'p' + published.length, ...spec, ts: 1 }; },
    create: async () => ({ ok: false, reason: 'not-signed-in' }) });
  await g.fn();
  assert.deepEqual(published.map(p => p.name), ['Notices'],
    'THE DEFECT: with the church\'s key unavailable a room the steward chose to encrypt was published anyway: ' + JSON.stringify(published));
  assert.equal(g.st.advanced, 0, 'the wizard moved on over two rooms that were never made');
  assert.deepEqual([...g.st.picks].sort(), ['a', 'c'], 'the rooms that were not made are no longer ticked, so the steward cannot simply try again');
  assert.match(g.st.err, /keys aren’t ready/, 'it said nothing about the keys');
  assert.match(g.st.err, /nothing was made unencrypted/, 'it did not say what did NOT happen');
  assert.equal(g.st.busy[g.st.busy.length - 1], false, 'busy was left set, which disables Continue AND Back');
});

test('a key made but a room the relay refused says the relay refused it — not the keys', async () => {
  const g = groupsScope({ enc: true, picked: ['a', 'c'], publish: async () => null,
    create: async () => ({ ok: false, reason: 'group-not-saved' }) });
  await g.fn();
  assert.equal(g.st.advanced, 0);
  assert.match(g.st.err, /Couldn’t create your rooms — the relay didn’t accept them/, 'a refused room was blamed on the keys');
  assert.doesNotMatch(g.st.err, /keys aren’t ready/);
});
