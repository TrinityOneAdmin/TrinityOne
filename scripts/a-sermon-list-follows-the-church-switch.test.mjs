// THE CONSOLE'S SERMON LIST FOLLOWS THE ACTIVE CHURCH.
//   Run: node --test scripts/a-sermon-list-follows-the-church-switch.test.mjs
//
// THE DEFECT (sim round 2, finding 32). An owner who stewards two churches switched the console from church 1
// to church 2 and still saw church 1's sermons. DashSermons subscribed on `[conn]` alone; subscribeSermons
// (src/steward.src.js) reads the active church's `pub` once, when it is CALLED, so a subscription made for
// church 1 keeps church 1's filter for as long as it lives, and nothing cleared the list that church 1 had
// filled. The featured-sermon and media-key subscriptions beside it had the same dependency list.
//
// THE FIX. The identity version (`useStewardIdv`, bumped by the console's `steward-identity` event) is a
// dependency of all three, and the list and its "loaded" flag are cleared first.
//
// HOW THIS REACHES IT. It loads the console's own scripts (loadConsole), draws the real DashSermons, delivers
// church 1's sermons through the subscription it opened, then fires the same `steward-identity` event
// setActiveIdentity fires and draws again. The fake Steward does what the engine does: a subscription made
// while church X is active only ever hears church X's sermons. Reverting any of the three dependency lists, or
// the reset, turns a test here red. No assertion reads app/*.jsx text.
//
// Callers of the code changed (CLAUDE.md rule 2): DashSermons is rendered in one place, the Sermons view of
// the dashboard (`view === ... : <DashSermons />`); `window.DashSermons` is not read anywhere else.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConsole, fakeReact, fakeBrowser, fakeSteward, nodes, texts } from './console-screens.mjs';

const LISTS = {
  one: [{ id: 'a', title: 'Church ONE sermon', sha256: 'aa', mime: 'audio/mpeg', size: 1000 }],
  two: [{ id: 'b', title: 'Church TWO sermon', sha256: 'bb', mime: 'audio/mpeg', size: 1000 }],
};
const PINS = { one: { id: 'a' }, two: { id: 'b' } };

function openSermons() {
  const { React, reset, flush, unmount } = fakeReact();
  const state = { church: 'one', sermonSubs: 0, pinSubs: 0, keySubs: 0, sermonCbs: [], pinCbs: [] };
  const Steward = fakeSteward({
    subscribeSermons: (cb) => { state.sermonSubs++; const who = state.church; state.sermonCbs.push(cb); if (LISTS[who]) cb(LISTS[who]); return () => {}; },
    subscribePinnedSermon: (cb) => { state.pinSubs++; const who = state.church; state.pinCbs.push(cb); if (PINS[who]) cb(PINS[who]); return () => {}; },
    subscribeMediaKey: () => { state.keySubs++; return () => {}; },
  });
  const { window } = fakeBrowser({ Steward });
  const { DashSermons } = loadConsole({ React, window, expr: '{ DashSermons }' });
  let tree;
  const draw = () => { reset(); tree = DashSermons(); flush(); return tree; };
  const shown = () => texts(tree).join('|');
  const switchTo = (church) => { state.church = church; window.dispatch('steward-identity', { detail: { pub: church } }); };
  return { state, draw, shown, switchTo, tree: () => tree, unmount };
}

test('CONTROL: the first church\'s sermons show, and the featured one is marked', () => {
  const h = openSermons();
  h.draw(); h.draw();
  assert.match(h.shown(), /Church ONE sermon/);
  const pin = nodes(h.tree()).find(n => n.type === 'button' && /Pinned to members/.test((n.props || {}).title || ''));
  assert.ok(pin, 'the featured sermon is not marked as pinned');
  h.unmount();
});

test('after switching church the list is the NEW church\'s, with none of the old one\'s', () => {
  const h = openSermons();
  h.draw(); h.draw();
  assert.equal(h.state.sermonSubs, 1, 'fixture: one subscription before the switch');
  h.switchTo('two');
  h.draw(); h.draw();
  assert.equal(h.state.sermonSubs, 2,
    'THE SERMON LIST DID NOT RE-SUBSCRIBE ON A CHURCH SWITCH — it is still reading the first church');
  assert.match(h.shown(), /Church TWO sermon/, 'the second church\'s sermons are not on screen');
  assert.doesNotMatch(h.shown(), /Church ONE sermon/,
    'CHURCH 1\'S SERMONS ARE STILL SHOWN IN CHURCH 2\'S CONSOLE');
  h.unmount();
});

test('the old church\'s list is cleared before the new one arrives, not left up meanwhile', () => {
  const h = openSermons();
  h.draw(); h.draw();
  // The new church's relay has not answered yet: the fake delivers no callback for a church it has no list for.
  h.switchTo('none');
  h.draw(); h.draw();
  assert.doesNotMatch(h.shown(), /Church ONE sermon/, 'the previous church\'s sermon list stayed on screen after the switch');
  h.unmount();
});

test('the featured sermon and the media key follow the switch too', () => {
  const h = openSermons();
  h.draw(); h.draw();
  assert.deepEqual([h.state.pinSubs, h.state.keySubs], [1, 1]);
  h.switchTo('two');
  h.draw(); h.draw();
  assert.equal(h.state.pinSubs, 2, 'the featured-sermon subscription still reads the first church');
  assert.equal(h.state.keySubs, 2, 'the media-key subscription still reads the first church');
  const pins = nodes(h.tree()).filter(n => n.type === 'button' && /Pinned to members/.test((n.props || {}).title || ''));
  assert.equal(pins.length, 1, 'exactly the second church\'s featured sermon should be marked');
  h.unmount();
});

test('CONTROL: a plain re-draw neither re-subscribes nor blanks the list', () => {
  const h = openSermons();
  h.draw(); h.draw();
  assert.match(h.shown(), /Church ONE sermon/);
  h.draw();
  assert.equal(h.state.sermonSubs, 1, 'an ordinary re-draw opened another subscription');
  assert.match(h.shown(), /Church ONE sermon/);
  h.unmount();
});
