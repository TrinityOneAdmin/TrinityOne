// AN APPROVED-THEN-REMOVED HELPER'S REQUEST DOES NOT COME BACK on the owner's console (durable dismiss).
// Run: node --test scripts/an-approved-then-removed-helper-does-not-come-back.test.mjs
//
// THE BUG (device-found 2026-11-05). A helper's STEWARDREQ lives on the relay until its author tombstones it.
// The owner-side "Requests to help" list hid an approved helper only via `!stewardSet.has(r.pubkey)`. When the
// owner later REMOVED that helper, stewardSet no longer held them and the stale request reappeared. The owner
// could X it, but `dismissed` was in-memory React state — a reload brought it straight back.
//
// THE FIX (Part 2, owner-side backstop). DashStewardsPanel keeps a DURABLE set of every pubkey the owner has
// APPROVED (add) or REMOVED (remove), persisted to localStorage, SCOPED PER CHURCH (ownerPub), and folds it
// into the `pending` filter. It survives a reload, so an approved-then-removed requester never re-surfaces.
//
// TIME-AWARE REFINEMENT (2026-11-05, helper-delegation). The durable set used to store `true`, which hid that
// person's requests FOR EVER — so if a removed helper GENUINELY asked to help again later, the owner never saw
// it. It now stores the handle MOMENT as a Unix-SECONDS timestamp (same unit as a STEWARDREQ's created_at,
// surfaced on the request row as `r.ts`). A request is hidden only if it is NOT newer than that handle time
// (`r.ts <= handled[pk]`); a request created AFTER the last handle is a genuine re-request and shows. An old
// boolean value written by the prior build is read as +Infinity (hide everything up to now) for migration.
//
// POINT OF USE (CLAUDE.md rules 1 & 3). This MOUNTS the real DashStewardsPanel out of app/stew-dashboard.jsx
// through console-screens.mjs — the real usePendingStewards hook over Steward.subscribeStewardRequests — and
// PRESSES the real Approve / Revoke controls. A simulated remount (the hook store is reset while the same
// window + localStorage persist) is the reload. No text is matched in the .jsx to prove behaviour: the
// assertions are on which request rows the real filter renders. Delete the markHandled() write in add()/
// remove(), weaken the `r.ts <= handledAt` comparison, or drop the handled term from the filter, and these go red.
//
// AUDIT OF eb5c10eb (M1, M2), 2026-11-12. add()/remove() now record the answer only once the roster write has LANDED
// (setStewards answers truthy / the removal outcome is 'landed'), so the record is written a tick after the click and
// these tests wait for it (`settle`). The time recorded is the request's own created_at (r.ts — the requester's clock),
// or for a removal the moment they were put on the roster (stewardSince), never the owner's wall clock; the request
// rows here therefore carry a ts, as every real one does. The last test proves a REFUSED approve/remove records nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConsole, fakeReact, fakeBrowser, fakeSteward, nodes, texts } from './console-screens.mjs';

const OWNER = 'aa'.repeat(32);
const HELPER = 'bb'.repeat(32);   // Ruth — approved, then removed
const NEWBIE = 'cc'.repeat(32);   // Sam — a genuinely new request that must still show
const HANDLED_KEY = 'trinityone.steward.handledreqs.' + OWNER;
const REQ_AT = 1_790_000_000;   // when Ruth's request was made (her clock)
const settle = () => new Promise(r => setTimeout(r, 20));   // the landed write answers a tick after the click

function setup({ reqList = [], roster = [], since = {}, setStewardsResult = true, outcome = 'unknown' } = {}) {
  const fr = fakeReact();
  const wrote = [];
  let reqCb = null;
  const state = { reqList: reqList.slice(), roster: roster.slice() };
  const Steward = fakeSteward({
    actingChurch: '', pubkey: OWNER,
    stewardPresets: () => [{ id: 'general', label: 'General helper', caps: ['care', 'content', 'members'], hint: '' }],
    presetCaps: () => ['care', 'content', 'members'],
    stewardCapNames: () => ['finance', 'care', 'safeguarding', 'members', 'content', 'sealedrooms'],
    hasPinLock: () => false,
    stewardLabels: () => ({}), stewardCaps: () => ({}), stewardSince: () => ({ ...since }),
    subscribeStewardRequests: (cb) => { reqCb = cb; cb(state.reqList); return () => {}; },
    setStewards: (pubkeys, caps, names) => { wrote.push({ pubkeys, caps, names }); return Promise.resolve(setStewardsResult); },
    stewardRemovalOutcome: () => outcome,
  });
  const { window, localStorage } = fakeBrowser({ Steward });
  const mods = loadConsole({ React: fr.React, window, expr: '{ DashStewardsPanel }' });
  // The roster the panel renders as current stewards — the hook the panel reads, overridden so we control it
  // directly (this is not the function under test; usePendingStewards stays the real subscription).
  window.useStewardStewards = () => state.roster.slice();
  let tree = null;
  const draw = () => { fr.reset(); tree = mods.DashStewardsPanel({ church: { name: 'St Aidan' } }); fr.flush(); return tree; };
  const all = () => nodes(tree);
  const press = (match) => {
    const b = all().find(n => n.type === 'button' && (typeof match === 'string' ? texts(n).join(' ').includes(match) : match(n)));
    assert.ok(b, 're-anchor: no button for ' + match);
    b.props.onClick({ stopPropagation() {}, preventDefault() {} }); draw();
  };
  const words = () => texts(tree).join(' ');
  // first draw queues the subscription effect; a second delivers the request list
  draw(); draw();
  // a fresh hook store, same window + localStorage: this is a reload of the console
  const remount = () => { fr.fresh(); draw(); draw(); };
  return { fr, draw, all, press, words, localStorage, state,
    deliver: (list) => { state.reqList = list.slice(); if (reqCb) reqCb(state.reqList); draw(); },
    remount, get wrote() { return wrote; }, get tree() { return tree; } };
}

test('approving a request, then a reload with the request still live, does NOT bring it back', async () => {
  const h = setup({ reqList: [{ pubkey: HELPER, npub: 'npub_ruth', name: 'Ruth Bexley', ts: REQ_AT }] });
  assert.ok(h.words().includes('Requests to help'), 'staging: the pending request did not render');
  assert.ok(h.words().includes('Ruth Bexley'), 'staging: the requester Ruth is not shown before approval');

  h.press('Approve');             // open the approve sheet
  h.press('Approve as helper');   // confirm with the default preset -> add(HELPER) -> landed -> markHandled + persist
  assert.equal(h.wrote.length, 1, 'staging: approving did not publish a roster');
  await settle(); h.draw();
  // durable set was written, scoped to THIS church (ownerPub), with the time of the request answered (M2)
  const saved = JSON.parse(h.localStorage.getItem(HANDLED_KEY) || '{}');
  assert.equal(saved[HELPER], REQ_AT, 'the approved helper was not recorded with the time of the request answered');
  assert.ok(!h.words().includes('Ruth Bexley'), 'Ruth is still listed as a pending request right after approval');

  // THE RELOAD. The stale STEWARDREQ is still on the relay, and the owner has since REMOVED Ruth, so the
  // roster no longer protects her. Only the durable set can keep her out — and it is read fresh on remount.
  h.state.roster = [];                 // Ruth is not (or no longer) a current steward
  h.state.reqList = [{ pubkey: HELPER, npub: 'npub_ruth', name: 'Ruth Bexley', ts: REQ_AT }];   // her request is still live
  h.remount();
  assert.ok(h.words().includes('Requests to help') === false || !h.words().includes('Ruth Bexley'),
    'after a reload the removed helper\'s stale request came back — the durable dismiss did not survive the remount');
  assert.ok(!h.words().includes('Ruth Bexley'),
    'THE BUG: the approved-then-removed helper reappeared under "Requests to help" after a reload');
});

test('a genuinely new request still shows after the reload — the durable set hides only the handled one', async () => {
  const h = setup({ reqList: [{ pubkey: HELPER, npub: 'npub_ruth', name: 'Ruth Bexley', ts: REQ_AT }] });
  h.press('Approve');
  h.press('Approve as helper');       // Ruth handled + persisted, once the roster write landed
  await settle();

  h.state.roster = [];
  h.state.reqList = [
    { pubkey: HELPER, npub: 'npub_ruth', name: 'Ruth Bexley', ts: REQ_AT },   // stale, must stay hidden
    { pubkey: NEWBIE, npub: 'npub_sam', name: 'Sam Newcomer' },   // new, must show
  ];
  h.remount();
  assert.ok(!h.words().includes('Ruth Bexley'), 'the handled (approved-then-removed) request leaked back');
  assert.ok(h.words().includes('Sam Newcomer'),
    'a genuinely new request was hidden — the durable set must suppress ONLY the pubkeys the owner handled');
  assert.ok(h.words().includes('Requests to help'), 'the new request did not render the Requests-to-help section');
});

test('REMOVING a steward also writes the durable set, so their old request cannot resurface', async () => {
  // Ruth is a CURRENT steward (approved on an earlier run, put on the roster at REQ_AT + 3600), no request showing.
  const h = setup({ reqList: [], roster: [HELPER], since: { [HELPER]: REQ_AT + 3600 } });
  assert.ok(!JSON.parse(h.localStorage.getItem(HANDLED_KEY) || '{}')[HELPER], 'staging: handled set should start empty for Ruth');
  // arm, then confirm the revoke on Ruth's steward row
  h.press((n) => n.props && n.props.title === 'Revoke this helper');
  h.press('Revoke');   // the confirm control -> remove(HELPER) -> landed -> markHandled
  await settle(); h.draw();
  const saved = JSON.parse(h.localStorage.getItem(HANDLED_KEY) || '{}');
  assert.equal(saved[HELPER], REQ_AT + 3600, 'removing a steward did not record them, as of when they joined the roster');

  // the relay still holds Ruth's old STEWARDREQ; a reload that delivers it must not surface it
  h.state.roster = [];
  h.deliver([{ pubkey: HELPER, npub: 'npub_ruth', name: 'Ruth Bexley', ts: REQ_AT }]);
  h.remount();
  assert.ok(!h.words().includes('Ruth Bexley'),
    'a removed steward\'s old request resurfaced after a reload — remove() must write the durable set too');
});

test('a genuinely NEWER request from a handled pubkey REAPPEARS — the dismiss is time-aware, not permanent', () => {
  // T is the seconds-timestamp the owner last handled (approved-then-removed) Ruth on an earlier run. We seed
  // the durable set with it directly so the assertion does not depend on the wall clock at approve time.
  const T = 1_700_000_000;
  const h = setup({ reqList: [] });
  h.localStorage.setItem(HANDLED_KEY, JSON.stringify({ [HELPER]: T }));
  h.state.roster = [];

  // (a) her OLD request (created at or before the handle) stays hidden
  h.state.reqList = [{ pubkey: HELPER, npub: 'npub_ruth', name: 'Ruth Bexley', ts: T - 5 }];
  h.remount();
  assert.ok(!h.words().includes('Ruth Bexley'),
    'the stale pre-handle request leaked back — a request not newer than the handle must stay hidden');

  // (b) a genuinely NEWER request from the SAME pubkey (created AFTER the handle) must appear
  h.state.reqList = [{ pubkey: HELPER, npub: 'npub_ruth', name: 'Ruth Bexley', ts: T + 60 }];
  h.remount();
  assert.ok(h.words().includes('Requests to help'), 'the newer re-request did not render the Requests-to-help section');
  assert.ok(h.words().includes('Ruth Bexley'),
    'a genuinely newer re-request was hidden — a request created AFTER the handle moment must show through the durable dismiss');
});

test('backward-compat: an OLD boolean handled marker still hides a stale request (upgrade migration safety)', () => {
  // A console upgraded from the prior build carries the bare-`true` shape. With no time in it, the stale
  // request it recorded must stay hidden — the upgrade must not suddenly resurface old handled requests.
  const h = setup({ reqList: [] });
  h.localStorage.setItem(HANDLED_KEY, JSON.stringify({ [HELPER]: true }));
  h.state.roster = [];
  h.state.reqList = [{ pubkey: HELPER, npub: 'npub_ruth', name: 'Ruth Bexley', ts: 1_700_000_000 }];
  h.remount();
  assert.ok(!h.words().includes('Ruth Bexley'),
    'an old boolean handled marker resurfaced a previously-handled request after the upgrade');
});

test('CONTROL: an unhandled request is NOT hidden — the filter suppresses only handled pubkeys', () => {
  const h = setup({ reqList: [{ pubkey: NEWBIE, npub: 'npub_sam', name: 'Sam Newcomer' }] });
  assert.ok(h.words().includes('Sam Newcomer'), 'a fresh, unhandled request was hidden by the durable filter');
  h.remount();
  assert.ok(h.words().includes('Sam Newcomer'), 'a fresh request vanished across a reload though it was never handled');
});

test('M1: an Approve or a Remove whose roster write did NOT land records nothing — the request keeps showing', async () => {
  // Approve, but no relay accepted the roster (setStewards answers false): Ruth is not a helper, so her request stays.
  { const h = setup({ reqList: [{ pubkey: HELPER, npub: 'npub_ruth', name: 'Ruth Bexley', ts: REQ_AT }], setStewardsResult: false });
    h.press('Approve');
    h.press('Approve as helper');
    assert.equal(h.wrote.length, 1, 'staging: approving did not try to write the roster');
    await settle(); h.draw();
    assert.equal(JSON.parse(h.localStorage.getItem(HANDLED_KEY) || '{}')[HELPER], undefined,
      'THE BUG (M1): a refused Approve was recorded as answered, which hides the request on every device');
    h.remount();
    assert.ok(h.words().includes('Ruth Bexley'), 'after a refused Approve and a reload, Ruth\'s request is gone'); }
  // Remove, but every relay still lists her (setStewards false, outcome 'not-landed'): nothing recorded.
  { const h = setup({ reqList: [], roster: [HELPER], since: { [HELPER]: REQ_AT + 3600 }, setStewardsResult: false, outcome: 'not-landed' });
    h.press((n) => n.props && n.props.title === 'Revoke this helper');
    h.press('Revoke');
    await settle(); h.draw();
    assert.equal(JSON.parse(h.localStorage.getItem(HANDLED_KEY) || '{}')[HELPER], undefined,
      'a Remove that did not land was recorded as answered'); }
});
