// THE CHURCH PROFILE KEEPS ITS MAIN COLOUR — on every console save, and on the way into members' church list.
//   Run: node --test scripts/the-profile-keeps-its-main-colour.test.mjs
//
// Two places allowlist the kind-0 fields, and a field missing from either is silently lost:
//
//   1. Steward.publishProfile (src/steward.src.js -> SHIPPED vendor/steward.js) rebuilds the kind-0 content
//      from a fixed field list on EVERY publish. Without mainColor in that list, editing the church NAME
//      would wipe the main colour for every member. Here the shipped method is lifted from the bundle by
//      brace-match (bundle names: finalizeEvent2 etc.) and run, and the content on the wire is read.
//   2. _mergeChurchProfile (app/app.jsx) copies the delivered profile into the member's church list. Without
//      the field, members never see it. The main-era copy (6b42955f, before mainColor) must DROP the field
//      without throwing — that is the old-member-app compatibility proof.
//
// KNOWN, OWNER-ACCEPTED LOSS (not engineered around): an OLD console's publishProfile has no mainColor in its
// list, so any save from an old console republishes kind-0 without it and the main colour reverts to unset.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fnBody } from './test-slice.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const BUNDLE = readFileSync(ROOT + 'vendor/steward.js', 'utf8');

function liftPublishProfile() {
  const at = BUNDLE.indexOf('    publishProfile(meta) {');
  assert.notEqual(at, -1, 'publishProfile is gone from vendor/steward.js — re-anchor this test');
  assert.equal(BUNDLE.indexOf('    publishProfile(meta) {', at + 1), -1, 're-anchor: two publishProfile methods in the bundle');
  const body = fnBody(BUNDLE.slice(at), 'publishProfile(meta) {', 'publishProfile');
  const fe = (body.match(/\bfinalizeEvent\d*\b/) || [])[0];
  assert.ok(fe, 'publishProfile no longer signs an event — re-anchor this test');
  return { body, fe };
}

function console_(lastProfile) {
  const { body, fe } = liftPublishProfile();
  const wire = [];
  const scope = {
    sk: new Uint8Array(32).fill(1), actingChurch: null, _profileLoaded: true,
    cleanNip05: (v) => v || '', CANONICAL_RELAY: 'wss://relay.example/relay',
    publish: (e) => { wire.push(e); return Promise.resolve(e); },
    [fe]: (e) => e, _monotonic: (e) => e, now: () => 1700000000,
    _profileSettle: () => Promise.resolve(), CustomEvent: class {}, window: { dispatchEvent() {} },
  };
  const names = Object.keys(scope);
  const make = new Function(...names, 'let lastProfile = arguments[arguments.length - 1];\nreturn { ' + body + ' };');
  const api = make(...names.map(k => scope[k]), { ...lastProfile });
  return { api, wire, content: () => JSON.parse(wire.at(-1).content) };
}

test('a NAME edit on the console keeps the main colour on the wire', async () => {
  const c = console_({ name: 'Grace', accent: '#C25A38', mainColor: '#1f4e79' });
  await c.api.publishProfile({ name: 'Grace Church' });
  assert.equal(c.wire.length, 1, 're-anchor: publishProfile put nothing on the wire');
  assert.equal(c.content().name, 'Grace Church');
  assert.equal(c.content().mainColor, '#1f4e79', 'editing the church name wiped the main colour');
  assert.equal(c.content().accent, '#C25A38');
});

test('setting the main colour publishes it; an unset or unsafe one publishes as ""', async () => {
  const c = console_({ name: 'Grace' });
  await c.api.publishProfile({ mainColor: '#3B6FB0' });
  assert.equal(c.content().mainColor, '#3B6FB0');
  await c.api.publishProfile({ mainColor: '' });
  assert.equal(c.content().mainColor, '');
  for (const bad of ['url(https://x.example/b)', 'var(--x)', '#abc', 'red']) {
    await c.api.publishProfile({ mainColor: bad });
    assert.equal(c.content().mainColor, '', 'publishProfile let ' + JSON.stringify(bad) + ' onto the wire');
  }
  const fresh = console_({ name: 'Grace', accent: '#C25A38' });
  await fresh.api.publishProfile({ name: 'Grace' });
  assert.equal(fresh.content().mainColor, '', 'a church that never set one did not publish an empty main colour');
});

function merge(src) {
  const body = fnBody(src, 'function _mergeChurchProfile(', '_mergeChurchProfile');
  return new Function(body + '\nreturn _mergeChurchProfile;')();
}
const APP_NOW = readFileSync(ROOT + 'app/app.jsx', 'utf8');
const BEFORE = '6b42955f';   // local main before mainColor existed (2026-11-12)

test('the members’ church list takes mainColor from the profile, and keeps it over a profile without one', () => {
  const m = merge(APP_NOW);
  const cs = [{ id: 'c1', name: 'Grace', accent: '#C25A38' }];
  const out = m(cs, 'c1', { name: 'Grace', mainColor: '#1f4e79' });
  assert.equal(out[0].mainColor, '#1f4e79', 'the member app dropped the church main colour');
  const again = m(out, 'c1', { name: 'Grace' });
  assert.equal(again[0].mainColor, '#1f4e79');
  assert.equal(m(again, 'c1', { name: 'Grace', mainColor: '#1f4e79' }), again, 'a re-delivery of the same colour built a new array (perf #10)');
});

test('an OLD member app (main-era _mergeChurchProfile) ignores mainColor without throwing', () => {
  let old;
  try { old = execFileSync('git', ['show', BEFORE + ':app/app.jsx'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 }); }
  catch (e) { assert.fail('could not read app/app.jsx at ' + BEFORE + ' — this clone lacks that commit'); }
  const m = merge(old);
  const out = m([{ id: 'c1', name: 'Grace', accent: '#C25A38' }], 'c1', { name: 'Grace', accent: '#C25A38', mainColor: '#1f4e79' });
  assert.equal(out[0].mainColor, undefined, 're-anchor: the main-era merge already copied mainColor');
  assert.equal(out[0].accent, '#C25A38');
});

// 3. THE CONSOLE READS IT BACK. useStewardChurch (app/steward-root.jsx) allowlists the profile for its 15
//    callers; DashBrandingPanel's picker is seeded from it. Run through the miniature React with the profile
//    delivered by subscribeProfile, the way the console receives it.
test('the console’s church hook carries mainColor to the branding panel (and "" when unset)', async () => {
  const { miniReact } = await import('./render-jsx-screen.mjs');
  const src = readFileSync(ROOT + 'app/steward-root.jsx', 'utf8');
  const body = fnBody(src, 'function useStewardChurch(', 'useStewardChurch');
  const read = (profile) => {
    const { React, draw } = miniReact();
    const win = { Steward: { subscribeProfile: (cb) => { cb(profile); return () => {}; }, npub: 'npub1x' },
      addEventListener() {}, removeEventListener() {} };
    const hook = new Function('React', 'window', 'useSt', 'useStE', 'useStewardIdv', 'useStewardConn',
      body + '\nreturn useStewardChurch;')(React, win, React.useState, React.useEffect, () => 0, () => 0);
    let got;
    const Probe = () => { got = hook(); return null; };
    draw(Probe, {}); draw(Probe, {}); draw(Probe, {});
    return got;
  };
  assert.equal(read({ name: 'Grace', mainColor: '#1f4e79' }).mainColor, '#1f4e79', 'the console hook dropped mainColor');
  assert.equal(read({ name: 'Grace', accent: '#C25A38' }).mainColor, '');
  assert.equal(read({ name: 'Grace', accent: '#C25A38' }).accent, '#C25A38', 're-anchor: the hook did not deliver the profile at all');
});
