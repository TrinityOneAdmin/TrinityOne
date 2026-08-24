// A CHURCH'S OWN DATA MUST BE FILED UNDER THAT CHURCH, AND FOUND AGAIN.
// Run: node --test scripts/church-scoped-streams.test.mjs
//
// The console keeps one copy of each list and hands it to every screen that asks. That copy is labelled with
// the church it came from, so one church's members can never be shown under another's name — added after an
// audit executed exactly that. But the label is worked out while the screen draws, and the SUBSCRIPTION was
// only restarted when someone switched church or the connection dropped. On a cold start the church key is
// not known for the first moment, so a list that begins loading in that moment is filed under a blank name
// and never re-filed.
//
// Measured on the live console before this was fixed: the app reported that the member list had NEVER loaded
// while twenty-five members were on the screen. That answer decides whether the "waiting to join" queue can
// be trusted, so a church's join requests would quietly show as none.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripComments } from './test-slice.mjs';

const ROOT = stripComments(readFileSync(new URL('../app/steward-root.jsx', import.meta.url), 'utf8'));

test('a list re-subscribes when the church becomes known, not only when it changes', () => {
  const i = ROOT.indexOf('function makeSub');
  const fn = ROOT.slice(i, ROOT.indexOf('\n}', i));
  assert.match(fn, /const key = method \+ '\|' \+ idv \+ '\|' \+ _who/, 'the copy is no longer labelled by church');
  // The label is part of the key, so it must also be part of what restarts the subscription. Without it the
  // first load is filed under a blank church and stays there.
  assert.match(fn, /\}, \[idv, conn, _who\]\)/,
    'the subscription does not restart when the church becomes known, so its data stays filed under a blank name');
  // The check that READS the key must build it the same way, or it silently answers "never loaded" for
  // everything — and its callers use that to decide whether a waiting-to-join list can be trusted.
  const i2 = ROOT.indexOf('window.stewardStreamLoaded =');
  assert.match(ROOT.slice(i2, i2 + 320), /actingChurch \|\| S0\.churchPub/,
    'the loaded-check no longer builds the same key as the cache it reads');
});
