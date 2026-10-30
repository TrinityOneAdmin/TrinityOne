// publishPost's NEW `extraTags` param defaults to [] → every EXISTING caller gets byte-identical event tags,
// and a caller that DOES pass extraTags gets them spliced after the base tags. (Stream G back-compat, rule 2.)
//   Run: node --test scripts/publishpost-extratags-is-backward-compatible.test.mjs
//
// Lifts publishPost from the SHIPPED bundle (vendor/steward.js) and RUNS it — a text match is worthless for a
// bundle anyway (dead code is stripped), and this proves the real built function, which is what the console
// loads. Callers enumerated (grep `\.publishPost(`): stew-dashboard ×2, stew-schedule, stew-finance, stew-meals.
// Four pass 2 args, one (the dashboard reply path) passes 3; NONE passes extraTags before this change, so the
// default-[] cases below are those callers exactly.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';

const STEWARD = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const ANCHOR = 'publishPost(content, group, replyTo, extraTags = []) {';

function makeFn() {
  const body = fnBody(STEWARD, ANCHOR, 'publishPost');
  const scope = {
    sk: new Uint8Array(32).fill(1),
    _skeys: {}, _sealedGroupIds: new Set(),
    publish: (evt) => Promise.resolve(evt),
    feChurch: (e) => e, now: () => 1000, NET: 'test', pub: 'aabb',
    Promise, console, Array,
  };
  return new Function('scope', 'with (scope) { return ({ ' + body + ' }); }')(scope);
}

test('no extraTags (a 2-arg caller) → base tags are byte-identical', async () => {
  const evt = await makeFn().publishPost('Hello', 'announce');
  assert.deepEqual(evt.tags, [['t', 'test'], ['t', 'announce'], ['p', 'aabb']], 'the base tag set changed for a 2-arg caller — back-compat broken');
  assert.equal(evt.content, 'Hello');
});

test('a 3-arg reply caller is still byte-identical (extraTags default [])', async () => {
  const evt = await makeFn().publishPost('Hello', 'announce', { id: 'ev1', by: 'ccdd' });
  assert.deepEqual(evt.tags, [['t', 'test'], ['t', 'announce'], ['p', 'aabb'], ['e', 'ev1', '', 'reply'], ['p', 'ccdd']], 'the reply-caller tag set changed — back-compat broken');
});

test('extraTags are spliced AFTER the base tags, in order', async () => {
  const evt = await makeFn().publishPost('Hello', 'announce', null, [['card', '1', '{"type":"finance"}']]);
  assert.deepEqual(evt.tags, [['t', 'test'], ['t', 'announce'], ['p', 'aabb'], ['card', '1', '{"type":"finance"}']], 'the card tag did not attach at the end of the base tags');
});
