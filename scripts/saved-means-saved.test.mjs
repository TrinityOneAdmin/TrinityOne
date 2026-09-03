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

  const ok = run({ id: 'evt' });
  await new Promise(r => setTimeout(r, 5));
  assert.equal(ok.opt, true, 'CONTROL: a listing that DID save no longer shows as listed');
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
