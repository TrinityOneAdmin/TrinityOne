// A DELEGATE'S CONSOLE SHOWS THE CHURCH'S CARE SETTING, NOT ITS OWN EMPTY ONE.
//   Run: node --test scripts/a-delegates-console-shows-the-churchs-care-setting.test.mjs
//
// THE DEFECT (sim round 2, finding 35). A delegated steward's console showed practical care as Off while the
// church had it On. src/steward-meals.src.js read the care settings (and the needs, slots and skips beside
// them) through `Steward.churchPub` — the DEVICE's own church key. A delegate keeps their own key there and runs
// the other church as `Steward.actingChurch` (setActiveIdentity: `pub = tp; actingChurch = tp`, churchPub
// untouched), so the subscription asked the relay for the delegate's own, empty church and fell back to the
// default, Off.
//
// THE FIX. The module reads `actingChurch || churchPub`. Owners and network views have no actingChurch and
// are unchanged. publishCareTeam stays owner-only: it names `churchPub` as the care team's church, and is not
// run by a delegate (see its comment).
//
// HOW THIS REACHES IT. The console's own scripts are loaded (loadConsole) together with the SHIPPED
// vendor/steward-meals.js, and the real DashMealsPanel is drawn on a fake Steward that behaves like a relay:
// a subscription hears only the documents its filters name. The assertion is on what the panel prints
// ("On — a Care tab is in your sidebar…" vs "Off — …"), so deleting the fix from the engine, or the
// panel's use of it, turns it red. No assertion reads app/*.jsx or src text.
//
// Callers of the code changed (CLAUDE.md rule 2): subscribeSettings is read by window.useMealsSettings
// (app/steward-root.jsx), whose readers are DashMealsPanel (the toggle), the sidebar's Care entry and the
// Overview's care-request banner (app/stew-dashboard.jsx), the rota's care-team lookup (stew-schedule.jsx) and
// the needs form (stew-meals.jsx). subscribeNeeds / subscribeSlots / subscribeSkips feed useMealsNeeds /
// useMealsSlots / useMealsSkips, read by stew-meals.jsx's Care page. For an owner every one is unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConsole, fakeReact, fakeBrowser, fakeSteward, nodes, texts } from './console-screens.mjs';

const OWN = 'a'.repeat(64);        // the delegate's own key — a "church" with nothing in it
const CHURCH = 'c'.repeat(64);     // the church they are running
const NET = 'trinityone';
const settingsDoc = (pubkey, enabled, extra = {}) => ({
  kind: 30078, pubkey, created_at: 1760000000, tags: [['d', 'trinityone/meals-settings'], ['t', NET]],
  content: JSON.stringify({ enabled, visibility: 'all', openedBy: 'steward', adminGroupId: '', ...extra }),
});
const needDoc = (church, id, startDate) => ({
  kind: 30078, pubkey: church, created_at: 1760000100, tags: [['d', 'trinityone/care:' + id], ['t', NET]],
  content: JSON.stringify({ type: 'meals', dates: [startDate], startDate, endDate: startDate, meals: ['dinner'] }),
});

// A fake Steward that is a relay: subscribeMany delivers the stored events that match each filter (authors / #church / #t).
function relayed({ churchPub, actingChurch, docs }) {
  const subs = [], published = [];
  const matches = (f, e) => (!f.authors || f.authors.includes(e.pubkey))
    && (!f['#church'] || e.tags.some(t => t[0] === 'church' && f['#church'].includes(t[1])))
    && (!f['#t'] || e.tags.some(t => t[0] === 't' && f['#t'].includes(t[1])));
  const Steward = fakeSteward({
    churchPub, actingChurch, pub: actingChurch || churchPub, activePub: actingChurch || churchPub,
    subscribeMany: (filters, h) => {
      subs.push(filters);
      for (const e of docs) if (filters.some(f => matches(f, e))) h.onevent(e);
      h.oneose && h.oneose();
      return { close() {} };
    },
    publishSigned: async (tmpl) => { published.push(tmpl); return true; },
    isDelegated: () => !!actingChurch,
  });
  return { Steward, subs, published };
}

function drawPanel(env) {
  const { React, reset, flush, unmount } = fakeReact();
  const { window } = fakeBrowser({ Steward: env.Steward });
  const mods = loadConsole({ React, window, vendor: ['vendor/steward-meals.js'], expr: '{ DashMealsPanel }' });
  let tree;
  const draw = () => { reset(); tree = mods.DashMealsPanel({ church: {} }); flush(); return tree; };
  draw(); draw();
  return { shown: () => texts(tree).join(' | '), draw, unmount, window };
}

test('a delegate running a church that has care ON sees it On', () => {
  // The relay holds the church's settings; the delegate's own key holds nothing.
  const env = relayed({ churchPub: OWN, actingChurch: CHURCH, docs: [settingsDoc(CHURCH, true)] });
  const p = drawPanel(env);
  assert.match(p.shown(), /On — a “Care” tab is in your sidebar/,
    'THE DELEGATE\'S CONSOLE SHOWS CARE AS OFF while the church has it on. It is reading its own key\'s settings. Shown: ' + p.shown().slice(0, 160));
  assert.doesNotMatch(p.shown(), /Off — meals, rides/);
  p.unmount();
});

test('the delegate\'s settings subscription names the church being run, never its own key', () => {
  const env = relayed({ churchPub: OWN, actingChurch: CHURCH, docs: [settingsDoc(CHURCH, true)] });
  const p = drawPanel(env);
  const asked = JSON.stringify(env.subs);
  assert.ok(asked.includes(CHURCH), 'no care subscription asked for the church the console is running');
  assert.ok(!asked.includes(OWN), 'a care subscription still asked for the delegate\'s own key: ' + asked.slice(0, 200));
  p.unmount();
});

test('CONTROL: a church that has care OFF still reads Off for its delegate', () => {
  const env = relayed({ churchPub: OWN, actingChurch: CHURCH, docs: [settingsDoc(CHURCH, false)] });
  const p = drawPanel(env);
  assert.match(p.shown(), /Off — meals, rides/);
  p.unmount();
});

test('CONTROL: an owner (no actingChurch) reads their own church exactly as before', () => {
  const env = relayed({ churchPub: CHURCH, actingChurch: '', docs: [settingsDoc(CHURCH, true), settingsDoc(OWN, false)] });
  const p = drawPanel(env);
  assert.match(p.shown(), /On — a “Care” tab is in your sidebar/);
  assert.ok(!JSON.stringify(env.subs).includes(OWN), 'an owner\'s console asked for somebody else\'s church');
  p.unmount();
});

test('a delegate\'s needs subscription reads the church\'s needs, not the delegate\'s own (engine level: the Care page\'s source)', async () => {
  const env = relayed({ churchPub: OWN, actingChurch: CHURCH, docs: [settingsDoc(CHURCH, true), needDoc(CHURCH, 'n1', '2026-11-05'), needDoc(OWN, 'mine', '2026-11-06')] });
  const { React } = fakeReact();
  const { window } = fakeBrowser({ Steward: env.Steward });
  loadConsole({ React, window, vendor: ['vendor/steward-meals.js'], expr: '0' });
  let heard = null;
  window.StewardMeals.subscribeNeeds((l) => { heard = l; });
  assert.equal(JSON.stringify((heard || []).map(n => n.id)), '["n1"]',
    'the Care page is not given the church\'s needs (or is given another key\'s). Heard: ' + JSON.stringify(heard));
});

test('a delegate\'s console does not publish the care-team roster (it names churchPub, which is not their church)', async () => {
  // A team on the roster, so the panel's effect has something to publish — as an owner it does.
  const team = { team: 'g1', people: [{ id: 'p1', name: 'Ann', pub: 'b'.repeat(64) }] };
  for (const [acting, expectPublished] of [[CHURCH, false], ['', true]]) {
    const own = acting ? OWN : CHURCH;
    const env = relayed({ churchPub: own, actingChurch: acting, docs: [settingsDoc(CHURCH, true, { adminGroupId: 'g1' })] });
    env.Steward.subscribeRosters = (cb) => { cb([team]); return () => {}; };
    const p = drawPanel(env);
    p.draw();
    const careteam = env.published.filter(t => (t.tags || []).some(x => x[0] === 'd' && String(x[1]).startsWith('trinityone/careteam:')));
    assert.equal(careteam.length > 0, expectPublished,
      acting ? 'a delegate published careteam:<own key> — a document for a church that is nobody\'s'
             : 'CONTROL: the owner\'s console no longer publishes the care-team roster');
    p.unmount();
  }
});

test('a delegate\'s slots and skips subscriptions name the church being run too (engine level)', () => {
  const env = relayed({ churchPub: OWN, actingChurch: CHURCH, docs: [] });
  const { React } = fakeReact();
  const { window } = fakeBrowser({ Steward: env.Steward });
  loadConsole({ React, window, vendor: ['vendor/steward-meals.js'], expr: '0' });
  window.StewardMeals.subscribeSlots(() => {});
  window.StewardMeals.subscribeSkips(() => {});
  assert.equal(env.subs.length, 2, 'fixture: each of slots and skips opens one subscription');
  const asked = JSON.stringify(env.subs);
  assert.ok(asked.includes(CHURCH) && !asked.includes(OWN), 'slots/skips asked for the delegate\'s own key, not the church: ' + asked.slice(0, 200));
});
