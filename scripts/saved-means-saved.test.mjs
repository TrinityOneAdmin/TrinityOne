// "SAVED" MUST FOLLOW THE SAVE.
// Run: node --test scripts/saved-means-saved.test.mjs
//
// AUDIT 2026-09-02 #17-publishProfile and #18. Three controls showed their confirmation before knowing:
//
//   · the church's video / audio feed rows — "✓ Saved" over a publish the relay may never have taken, so a
//     steward waits for videos that will never appear in members' Watch tab
//   · a member's own PROFILE — "Profile saved" over a swallowed result, so someone whose display name never
//     reached the relay goes on appearing as Anonymous to their whole church while their own screen shows
//     the name they typed
//   · "I'm here to help" — the card flipped to listed before knowing, so a member who volunteered and was
//     never recorded believes their church can call on them
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody, stripComments } from './test-slice.mjs';

const APP = readFileSync(new URL('../app/app.jsx', import.meta.url), 'utf8');
const TODAY = readFileSync(new URL('../app/screens-today.jsx', import.meta.url), 'utf8');
const STEW = readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8');

test('saveIdentity hands its caller the answer instead of swallowing it', async () => {
  const body = fnBody(APP, 'const saveIdentity = (patch) => {', 'saveIdentity');
  const mk = (result) => new Function('window', 'String',
    body + '\nreturn saveIdentity;')(
    { Fellowship: { ready: Promise.resolve(), setProfile: async () => result } }, String);
  assert.equal(await mk(null)({ name: 'Ada' }), null,
    'a profile publish that no relay accepted came back as success. The member is told "Profile saved" and ' +
    'goes on appearing as Anonymous to their whole church');
  assert.ok(await mk({ id: 'evt' })({ name: 'Ada' }),
    'CONTROL: a profile that DID save no longer reports it, so every member is told it failed');
});

test('the helper card does not list somebody the church was never told about', async () => {
  const body = fnBody(TODAY, 'const save = () => {', 'save');
  const run = (result) => {
    const state = { opt: 'untouched', toasts: [], editing: true };
    const fn = new Function('care', 'setOpt', 'setEditing', 'ctx', 'tags', 'note',
      body + '\nreturn save;')(
      { setAvail: async () => result },
      (v) => { state.opt = v; }, (v) => { state.editing = v; },
      { toast: (t) => state.toasts.push(String(t)) }, ['meal'], 'happy to help');
    fn();
    return state;
  };
  const failed = run(null);
  await new Promise(r => setTimeout(r, 5));
  assert.notEqual(failed.opt, true,
    'the card said the member is listed as a helper when the church was never told. They believe they can ' +
    'be called on');
  assert.ok(failed.toasts.some(t => /Couldn’t list you/.test(t)), 'and nothing told them it had not worked');

  // ⚠ `{ ok: true, evt }`, not a bare event: setCareAvail answers { ok, reason } since 2026-09-16, and the
  // card tests `r && r.ok` — a failure OBJECT is truthy, so `if (r)` would flip it to "listed" on every
  // failure, which is the bug this very test was written about.
  const ok = run({ ok: true, evt: { id: 'evt' } });
  await new Promise(r => setTimeout(r, 5));
  assert.equal(ok.opt, true, 'CONTROL: a listing that DID save no longer shows as listed');

  // …and the third outcome. "The church hasn't been told" over a listing that very probably landed makes a
  // member who has offered either give up or offer again to a church that already has them.
  const unsure = run({ ok: false, reason: 'unconfirmed' });
  await new Promise(r => setTimeout(r, 5));
  assert.notEqual(unsure.opt, true, 'the card claimed "you\'re listed" over an answer nobody gave');
  assert.ok(unsure.toasts.some(t => /couldn’t confirm/i.test(t)),
    'an unconfirmed listing is still reported as a settled failure');
  assert.ok(!unsure.toasts.some(t => /hasn’t been told/.test(t)),
    'it still asserts the church was never told, over a document the church very probably holds');
});

test('the feed rows only tick when the publish landed', () => {
  const src = stripComments(STEW);
  for (const fn of ['saveVid', 'saveAud']) {
    const i = src.indexOf('const ' + fn + ' = ');
    assert.ok(i > 0, `${fn} has moved — re-anchor this test`);
    const body = src.slice(i, i + 520);
    assert.match(body, /\.then\(/, `${fn} still shows "Saved" without waiting for the publish`);
    assert.match(body, /Couldn’t save/, `${fn} still gives the steward nothing when the relay refuses`);
  }
});

// ── THE STUB ANSWERED THE QUESTION, and the pre-merge audit caught it ──────────────────────────────────────
// The helper-card test above stubs `care.setAvail`, so it proves the SCREEN reads a falsy answer. It cannot
// prove the ENGINE ever gives one — and it did not: `setCareAvail` swallowed a failed publish and returned
// the event regardless, exactly like the three functions batch 7 fixed. The screen fix was therefore inert
// and both its test and its device check were stubbed the same way. Drive the shipped engine instead.
test('the ENGINE reports a care listing that reached no relay', async () => {
  const bundle = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
  for (const name of ['setCareAvail', 'clearCareAvail']) {
    const i = bundle.indexOf('async ' + name + '(');
    assert.ok(i > 0, name + ' is not in the shipped bundle — re-anchor this test');
    let d = 0, end = -1;
    for (let k = bundle.indexOf('{', i); k < bundle.length; k++) {
      if (bundle[k] === '{') d++;
      else if (bundle[k] === '}') { d--; if (!d) { end = k + 1; break; } }
    }
    const body = bundle.slice(i, end);
    // ⚠ THE SECOND CALLER LIST. This hand-written name list IS a caller of the lifted function: both grew a
    // `_pubReason(e)` on 2026-09-16 and went red here with "_pubReason is not defined" until it was added.
    // The classifier is lifted from the SHIPPED bundle, never stubbed — an injected outcome cannot catch a
    // dead classifier, and this one is one character from always answering the same word.
    const _pubReason = new Function(fnBody(bundle, 'function _pubReason(e)', '_pubReason') + '\nreturn _pubReason;')();
    const mk = (fails) => new Function('window', 'sk', 'finalizeEvent2', '_publishAny', 'churchRelays',
      'CAREAVAIL_D', 'NET', '_sealChurchDocMember', '_pubReason', 'JSON', 'Date', 'Math', 'Array', 'String', 'console',
      'return ({ ' + body + ' })')(
      { Fellowship: { churchPub: 'cc', ready: Promise.resolve() } }, 'sk',
      (e) => ({ ...e, id: 'x' }),
      async () => { if (fails) { const e = new Error('NO_NETWORK_RELAY'); e.unsent = true; throw e; } return true; },
      () => ['wss://r/relay'], 'trinityone/careavail:', 'trinityone',
      () => 'sealed', _pubReason, JSON, Date, Math, Array, String, { warn() {} })[name];
    // 2026-09-16: these answer `{ ok, reason }` now rather than `evt | null`, so that the card can tell
    // "the church was never told" from "nobody answered, and it may well have landed" — two sentences that
    // send a member in opposite directions. The invariant this test exists for is unchanged: a send that
    // landed nowhere must not come back looking like one that did.
    const failed = await mk(true)(['meal'], 'n');
    assert.equal(failed && failed.ok, false,
      name + ' reported a send after every relay refused it, so the screen above can never see a ' +
      'failure and a member who was never listed is told they are');
    assert.equal(failed.evt, undefined,
      name + ' still hands the event back on a failure — a caller that reaches for it reads a send that never happened');
    assert.equal(failed.reason, 'not-sent',
      name + ' lost the reason, so the card can only ever say the settled sentence');
    const landed = await mk(false)(['meal'], 'n');
    assert.equal(landed && landed.ok, true,
      'CONTROL: ' + name + ' no longer reports success on the happy path');
    assert.ok(landed.evt && landed.evt.id, 'CONTROL: ' + name + ' no longer returns its event on the happy path');
  }
});
