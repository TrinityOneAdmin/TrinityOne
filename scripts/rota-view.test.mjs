// A CONGREGATION MAY SEE ITS ROTA — BUT NEVER A DRAFT OF IT.
// Run: node --test scripts/rota-view.test.mjs
//
// Until now a member could see who was serving BESIDE them on their own Sunday, and nothing else: no answer
// to "who is on next week", and no rota at all for anyone not already on it. Nine agents in the round of
// 2026-08-18 went looking for the church's rota and none found one.
//
// The risk the new view introduces is the opposite of the one it fixes. A rota is a DRAFT until a steward
// publishes it — half-filled, people penciled in, names that are still a question rather than a commitment.
// The member's own slots have always filtered on `published` (app/app.jsx builds myRotaSlots that way);
// svServiceRoster, whose only previous caller was the member's own confirmed slot, does NOT. So the church-
// wide view has to apply that filter itself, and this file exists to hold it to that.
//
// These tests drive the SHIPPED functions, lifted whole out of app/screens-serving.jsx — not a paraphrase of
// them, which would pass its own sabotage. The last test sabotages the real source and requires it to go red.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';

const SRC = readFileSync(new URL('../app/screens-serving.jsx', import.meta.url), 'utf8');
const PARTS = ['svIsoLocal', 'svTodayIso', 'svServiceRoster', 'svChurchRota'];

// Lift the shipped source into a live function. `src` may be a sabotaged variant — that is the point of the
// parameter, and how the final test proves the published check actually bites.
function lift(src = SRC) {
  const body = PARTS.map(n => fnBody(src, 'function ' + n, n)).join('\n');
  return new Function(body + '\nreturn { svChurchRota, svServiceRoster };')();
}

const iso = days => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + days); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const ME = 'aa'.repeat(32);

// One church: a service next Sunday with a PUBLISHED rota, one the week after still a DRAFT, and one that
// has already happened.
function church({ published = true } = {}) {
  return {
    myPubkey: ME,
    churchServices: [
      { id: 'svc-past',  date: iso(-7), time: '10:30', name: 'Last Sunday' },
      { id: 'svc-next',  date: iso(3),  time: '10:30', name: 'Morning Worship' },
      { id: 'svc-draft', date: iso(10), time: '10:30', name: 'Next Next Sunday' },
    ],
    churchRotas: [
      { service: 'svc-past',  published: true,      assign: { 'welcome::door': { name: 'Norman Cleary', pub: 'bb'.repeat(32) } } },
      { service: 'svc-next',  published,            assign: { 'welcome::door': { name: 'Ada Boateng', pub: 'cc'.repeat(32) }, 'welcome::tea': { name: 'Me Myself', pub: ME } } },
      { service: 'svc-draft', published: false,     assign: { 'welcome::door': { name: 'Penciled In', pub: 'dd'.repeat(32) } } },
    ],
    churchRosters: [
      { team: 'welcome', roles: [{ id: 'door', name: 'Door' }, { id: 'tea', name: 'Tea' }] },
    ],
  };
}

test('the congregation sees an upcoming service it is not itself on', () => {
  const { svChurchRota } = lift();
  const out = svChurchRota(church());
  const next = out.find(s => s.id === 'svc-next');
  assert.ok(next, 'a published upcoming rota is not shown at all — the church still cannot see its own rota');
  assert.deepEqual(next.people.map(p => p.name).sort(), ['Ada Boateng', 'Me Myself'],
    'the people on the service did not come through with the service');
  assert.equal(next.people.find(p => p.pub === ME).me, true, 'the member is not marked as being on this one');
  assert.equal(next.people.find(p => p.name === 'Ada Boateng').role, 'Door',
    'the role name is unresolved — the roster lookup is not reaching the role');
});

test('a DRAFT rota is not shown to the congregation', () => {
  const { svChurchRota } = lift();
  const out = svChurchRota(church());
  assert.equal(out.find(s => s.id === 'svc-draft'), undefined,
    'an unpublished rota is visible to the whole church. A draft has people penciled in who have not agreed ' +
    'and may be taken off again — publishing is the steward\'s act of saying it is settled, and the ' +
    'congregation must not see it before that.');
});

test('a service that has already happened is not listed as upcoming', () => {
  const { svChurchRota } = lift();
  assert.equal(lift().svChurchRota(church()).find(s => s.id === 'svc-past'), undefined,
    'last Sunday is still listed, so the rota fills with history and the next service is buried');
  const { svChurchRota: fn } = lift();
  assert.ok(fn(church()).every(s => s.date >= iso(0)), 'a past-dated service came through');
});

test('services come out in date order, soonest first', () => {
  const { svChurchRota } = lift();
  const dates = svChurchRota({ ...church(), churchRotas: church().churchRotas.map(r => ({ ...r, published: true })) }).map(s => s.date);
  assert.deepEqual(dates, [...dates].sort(), 'the rota is not in date order, so "what is next" is not at the top');
});

// ── the tab is offered only when the relay would actually fill it ─────────────────────────────────────────
// Pull the app's own expression out and RUN it rather than matching its text: a source-text assertion here
// would be satisfied by the comment that explains the rule, which this repo has shipped before.
const canSeeExpr = (SRC.match(/const canSeeRota = ([^;]+);/) || [])[1];
const canSee = (visibility, onRoster) =>
  new Function('rotaVisibility', 'onAServingRoster', 'return (' + canSeeExpr + ');')(visibility, onRoster);

test('re-anchor: the tab gate is still an expression we can run', () => {
  assert.ok(canSeeExpr, 'could not find canSeeRota in app/screens-serving.jsx');
});

test('canSeeRota is DECLARED before the effect that depends on it', () => {
  // These files are classic scripts transpiled by Babel's `env` preset, which lowers `const` to `var` with NO
  // temporal-dead-zone check. So using `canSeeRota` above its declaration does not throw — it silently reads
  // `undefined`, the dependency array records `undefined` for ever, and the effect NEVER FIRES. That is
  // exactly what shipped in the first draft: the "snap back to Serving when the rota is no longer visible"
  // guard was dead code, proven by transpiling the real file with the vendored Babel and running it.
  //
  // The expression test above cannot see this — it extracts the text of the expression and runs it in
  // isolation, which says nothing about where the binding lives relative to its uses. Hence a position check.
  const decl = SRC.indexOf('const canSeeRota =');
  assert.notEqual(decl, -1, 're-anchor: canSeeRota is gone');
  // Nothing may mention it before its declaration. (Comparing indexOf('canSeeRota') to indexOf('const
  // canSeeRota =') directly is always off by the width of "const " — the first draft of this test did exactly
  // that and failed against correct code.)
  assert.equal(SRC.slice(0, decl).includes('canSeeRota'), false,
    'canSeeRota is USED before it is declared. Babel lowers const to var, so this does not throw — the ' +
    'reader silently gets undefined, and any effect depending on it never runs again. Move the declaration ' +
    'above its first use.');
});

test('the rota tab FAILS OPEN — unknown or missing settings show the rota', () => {
  // Every church that predates this setting has no document, and a relay that never answers must not be able
  // to hide a rota nobody chose to hide. This has to agree with the relay, which falls back the same way; if
  // the app hid the tab on a value the relay still serves, the rota would vanish for a reason no one could
  // see from either side.
  assert.equal(canSee('church', false), true, 'the open default hides the rota — every existing church loses it');
  assert.equal(canSee('', false), true, 'an absent setting hides the rota, so a silent relay blanks the tab');
  assert.equal(canSee('something-new', false), true,
    'an unrecognised value hides the rota; the relay falls back to OPEN for the same value, so the two ' +
    'surfaces would disagree and the screen would be empty for no visible reason');
});

test('"team" shows the tab to the people on a roster and to nobody else', () => {
  assert.equal(canSee('team', true), true, 'a member on a serving roster is denied their own team\'s rota');
  assert.equal(canSee('team', false), false,
    'a member on no roster is still offered the tab. The relay will refuse to fill it, so they get an empty ' +
    'screen with no explanation — which reads as a broken app or a dead church, and was the most common ' +
    'report of the round of 2026-08-18.');
});

test('"stewards" shows the tab to no ordinary member at all', () => {
  assert.equal(canSee('stewards', true), false, 'stewards-only still offers the tab to a roster member');
  assert.equal(canSee('stewards', false), false, 'stewards-only still offers the tab to an ordinary member');
});

// SABOTAGE. Everything above passes against a function that never checks `published` at all, unless this
// check is real — so break the shipped source and require the draft test to notice. Without this, the whole
// file is a description of what I hoped I wrote.
test('the draft check is load-bearing (sabotage)', () => {
  const sabotaged = SRC.replace('(rota && rota.published)', '(rota && true)');
  assert.notEqual(sabotaged, SRC, 're-anchor: the published check has been reworded, so this sabotage is a no-op');
  const { svChurchRota } = lift(sabotaged);
  const out = svChurchRota(church());
  assert.ok(out.find(s => s.id === 'svc-draft'),
    'removing the published check did NOT expose the draft — so the test above proves nothing about it');
});
