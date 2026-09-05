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

function groupsScope({ publish }) {
  const st = { advanced: 0, err: '', picks: new Set(['a', 'b', 'c']), busy: [] };
  const scope = {
    STARTERS, picks: st.picks, encByDefaultWiz: false,
    setBusy: (v) => st.busy.push(v),
    setGroupErr: (v) => { st.err = typeof v === 'function' ? v(st.err) : v; },
    setPicks: (f) => { st.picks = typeof f === 'function' ? f(st.picks) : f; },
    next: () => { st.advanced++; },
    window: { Steward: { publishGroup: publish, publishGroupKey: async () => ({ ok: 1 }) } },
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
