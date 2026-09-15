// THREE CONTROLS THAT LIED, IN THREE DIFFERENT WAYS.
//   Run: node --test scripts/three-relay-and-privacy-controls-tell-the-truth.test.mjs
//
// All three were raised by an audit on 2026-09-14 and written into `3d8599b`'s message as "reported and not
// fixed". Two independent investigations then confirmed them, and each was reproduced a third time before a
// line was changed. The owner chose these three and held a fourth (the outbox cap) as too rare to be worth
// the risk of its fix. 2026-09-15.
//
// 1. A PRIVACY SWITCH THAT PROMISED A SAVE THAT NEVER CAME.
//    Turn off "list me in the member directory" with no signal and setProfile told the member: "you are still
//    listed in the directory for now. It will save when you're back online." Nothing retries — no queue entry,
//    no listener, and reconnecting changes nothing (measured: one publish attempt before, one after). The
//    change only ever reached the church BY ACCIDENT, when a later profile edit carried the unsent `hidden`
//    out with it. So a member who believed they had left the directory stayed in it, indefinitely, having
//    been told in the same breath that it was handled.
//
// 2. A DESTRUCTIVE BUTTON LEFT ARMED WHERE A HARMLESS ONE BELONGS.
//    `confirmDrop` in the member app's RelaysSheet holds a url and nothing cleared it. Tap "Stop using",
//    change your mind, close the sheet — and on reopening, "Confirm: stop using" occupies the exact slot the
//    "asks you to confirm" button normally does. Same row, same place, one tap, no second chance. The four
//    sibling sheets in that file already reset on `!open`; this one was missed.
//
// 3. A BIN ICON AGAINST RELAYS THAT CANNOT BE REMOVED.
//    `removeRelay` filters `extraRelays()` only, and the canonical addresses are appended unconditionally —
//    so on a canonical relay it removes nothing, returns true anyway, and still forgets any name→url binding.
//    The console offered that button on EVERY console, community and self-hosting. A steward could click it,
//    confirm, be told nothing, and watch the row stay.
//
// ── ON INSTRUMENTS ────────────────────────────────────────────────────────────────────────────────────────
// CLAUDE.md rule 3 forbids asserting behaviour by matching text in `app/*.jsx` — those ship UNBUNDLED, so
// `false && ` leaves every word in place. It does NOT apply to `vendor/*.js`: the bundler removes dead code,
// so a string that is gone from the shipped bundle is gone from the product. Test 1 reads the BUNDLE for
// that reason. Tests 2 and 3 render or run the real thing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadScreen, miniReact, find } from './render-jsx-screen.mjs';

const FELLOWSHIP = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
const STEWARD = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');

// ── 1 ────────────────────────────────────────────────────────────────────────────────────────────────────
test('the directory switch does not promise a save that never comes', () => {
  assert.ok(FELLOWSHIP.includes('you are still listed in the directory'),
    're-anchor: the failure sentence for a refused "hide me" no longer ships at all');
  assert.ok(FELLOWSHIP.includes('you are still hidden from the directory'),
    're-anchor: the failure sentence for a refused "show me" no longer ships at all');

  // THE CLAIM UNDER TEST. Nothing in the shipped member bundle may tell someone their profile will save
  // itself later, because nothing will.
  assert.equal(FELLOWSHIP.includes('It will save when you'), false,
    'the app still promises a profile will save when the member is back online. It will not: there is no ' +
    'retry, no queue entry and no listener — measured, one publish attempt before going offline and one ' +
    'after coming back. On the one PRIVACY control here, that reassurance is the opposite of the truth.');
});

test('…and it still tells them which way round they actually are', () => {
  // The state sentence is the half that must survive. A fix that deleted the whole message would pass the
  // test above and leave the member with nothing at all.
  for (const s of ['you are still listed in the directory', 'you are still hidden from the directory']) {
    assert.ok(FELLOWSHIP.includes(s), 'the true state is no longer named: ' + s);
  }
});

test('…and the advice matches WHICH failure it was', () => {
  // WHY THIS IS NOT ONE SENTENCE. `_publishAny` produces three outcomes and only one of them is fixed by a
  // signal. The first attempt at this fix said "Try again when you have a signal" for all three; the review
  // of that fix caught it. The behaviour is driven end-to-end in
  // scripts/controls-report-what-happened.test.mjs, which lifts the real setProfile and injects each error
  // shape — this only checks all three sentences still SHIP, which is the half a bundle can answer.
  // ⚠ NO CURLY APOSTROPHES IN A BUNDLE ASSERTION. esbuild writes U+2019 as the escape `\u2019`, so
  // `FELLOWSHIP.includes("didn’t")` is false for a string that ships perfectly well. It cost a red test that
  // looked exactly like a fix which had not landed — and the one sentence with no apostrophe passed, which
  // made it look like two branches were missing rather than one instrument being wrong. Match on the
  // apostrophe-free part.
  for (const s of ['leave this phone', 'refused it, so trying again', 'Try again when you have a signal', 'Ask a steward']) {
    assert.ok(FELLOWSHIP.includes(s), 'an outcome lost its own advice: ' + s);
  }
  assert.equal(FELLOWSHIP.includes('It will save when you'), false, 'the promise nothing keeps is back');
});

// ── 2 ────────────────────────────────────────────────────────────────────────────────────────────────────
const relaysSheet = (startVerified) => {
  const { React, draw } = miniReact();
  // ⚠ A REAL LISTENER REGISTRY, not a no-op. The sheet re-seeds its list from `trinity-relays-verified`, and
  // a stub that swallows the listener cannot show a relay CONNECTING — which is the half of this bug that a
  // no-op harness missed the first time round and an adversarial review then found by hand.
  const listeners = {};
  const state = { verified: startVerified };
  const mod = loadScreen('app/identity-extras.jsx', ['RelaysSheet'], {
    React,
    Icon: () => null,
    IconBtn: () => null,
    BareUrl: ({ url }) => url,
    BottomSheet: ({ children }) => React.createElement('div', null, children),
    window: {
      Fellowship: { relays: ['wss://church.example/relay'], relayVerified: () => state.verified, removeRelay: () => true },
      TrinityData: { RELAYS: [] },
      addEventListener(n, fn) { (listeners[n] = listeners[n] || []).push(fn); },
      removeEventListener(n, fn) { listeners[n] = (listeners[n] || []).filter(f => f !== fn); },
      localStorage: { getItem: () => null, setItem() {} },
    },
  });
  const setVerified = (v) => { state.verified = v; for (const fn of listeners['trinity-relays-verified'] || []) fn(); };
  const render = (open) => { let t; for (let i = 0; i < 3; i++) t = draw(mod.RelaysSheet, { open, onClose() {}, ctx: {} }); return t; };
  const labels = (t) => find(t, n => n.type === 'button').map(b => (b.props && b.props['aria-label']) || '').filter(Boolean);
  return { render, labels, setVerified, armed: (t) => labels(t).some(l => /^Confirm: stop using/.test(l)) };
};

test('an abandoned "stop using" does not leave the destructive button armed', () => {
  const { render, labels, armed } = relaysSheet(false);
  let t = render(true);
  assert.equal(armed(t), false, 'fixture: the sheet opened already armed');
  const ask = find(t, n => n.type === 'button' && /asks you to confirm/.test((n.props && n.props['aria-label']) || ''))[0];
  assert.ok(ask, 'fixture: no "stop using" button to press — re-anchor this test');
  ask.props.onClick();
  assert.equal(armed(render(true)), true, 'fixture: pressing "stop using" did not arm the confirmation');

  render(false);                       // the member closes the sheet without deciding
  const back = render(true);           // …and opens it again later
  assert.equal(armed(back), false,
    'the sheet reopened with "Confirm: stop using" already armed, sitting in the slot the harmless "asks ' +
    'you to confirm" button normally occupies — same row, same place, one tap and the relay is gone with no ' +
    'confirmation. Clear confirmDrop when `open` goes false, as the four sibling sheets in that file do. ' +
    'Buttons on reopen: ' + JSON.stringify(labels(back)));
});

test('…and it does not survive the relay connecting and lapsing again', () => {
  // ⚠ THE HALF THE FIRST FIX MISSED, and it needs NO mistake by the member: relays connect and drop all day.
  // While a relay is connected `canRemove` is false and the whole control disappears; when it lapses the row
  // comes back — and with `confirmDrop` still holding that url, it came back ARMED, in the slot the harmless
  // button normally occupies. Found by an adversarial review of the sheet-close fix, 2026-09-15.
  const { render, setVerified, armed, labels } = relaysSheet(false);
  let t = render(true);
  const ask = find(t, n => n.type === 'button' && /asks you to confirm/.test((n.props && n.props['aria-label']) || ''))[0];
  assert.ok(ask, 'fixture: no "stop using" button to press');
  ask.props.onClick();
  assert.equal(armed(render(true)), true, 'fixture: the confirmation did not arm');

  setVerified(true);  render(true);      // the relay proves itself — the control vanishes
  setVerified(false);                    // …and lapses again
  const back = render(true);
  assert.equal(armed(back), false,
    'the relay reconnected and lapsed, and the DESTRUCTIVE button came back already armed with the member ' +
    'having done nothing at all. Clearing on sheet-close is not enough; clear it when the row stops being ' +
    'removable. Buttons now: ' + JSON.stringify(labels(back)));
});

// ── 3 ────────────────────────────────────────────────────────────────────────────────────────────────────
const shippedCanRemove = () => {
  const i = STEWARD.indexOf('canRemoveRelay(url) {');
  assert.ok(i > 0, 're-anchor: canRemoveRelay is not in vendor/steward.js');
  let d = 0, end = i;
  for (let j = STEWARD.indexOf('{', i); j < STEWARD.length; j++) {
    const c = STEWARD[j];
    if (c === '{') d++;
    else if (c === '}') { d--; if (!d) { end = j + 1; break; } }
  }
  const CANONICAL_RELAYS = ['wss://app.trinityone.church/relay', 'wss://trinityone-master-01.tailbeaac0.ts.net/relay'];
  // eslint-disable-next-line no-new-func
  return new Function('CANONICAL_RELAYS', 'ownRelay', 'return ({ ' + STEWARD.slice(i, end) + ' }).canRemoveRelay;')(
    CANONICAL_RELAYS, () => 'wss://ourbox.ts.net/relay');
};

test('a relay that cannot be removed is not offered a bin', () => {
  const can = shippedCanRemove();
  for (const url of ['wss://app.trinityone.church/relay', 'wss://trinityone-master-01.tailbeaac0.ts.net/relay']) {
    assert.equal(can(url), false,
      url + ' is offered for removal. removeRelay only filters extraRelays(), and the canonical addresses ' +
      'are appended unconditionally — so the click removes nothing, returns true, and still forgets any ' +
      'name→url binding, while the row stays put and nothing explains why.');
  }
  assert.equal(can('wss://ourbox.ts.net/relay'), false,
    "the church's own relay is offered for removal");
});

test('CONTROL: a relay the church added itself is still removable', () => {
  // The cheap way to pass the test above is to refuse everything, which would leave a church unable to stop
  // using a relay it chose — worse than the bug.
  assert.equal(shippedCanRemove()('wss://a-friend-church.ts.net/relay'), true,
    'a relay the church added itself can no longer be removed — the control has been disabled rather than ' +
    'corrected, and a church cannot take its data off a box it no longer trusts.');
});

// ⚠ THE POINT-OF-USE HALF (CLAUDE.md rule 1). The test above proves `canRemoveRelay` ANSWERS correctly; it
// says nothing about whether the console ASKS. An adversarial review measured that: delete the guard from
// the relay row and all five tests in this file, plus all seventeen across the three related relay files,
// stayed green — a well-tested engine nobody is required to consult. So render the real card and count bins.
const CANON = 'wss://app.trinityone.church/relay';
const OWN = 'wss://ourbox.ts.net/relay';
const renderRelayCard = (rows) => {
  const { React, draw } = miniReact();
  const mod = loadScreen('app/stew-dashboard.jsx', ['DashRelaysCard'], {
    React,
    Icon: () => null, SkPill: ({ children }) => children, SkToggle: () => null,
    useRelayBackupState: () => ({ status: rows, backup: null }),
    location: { host: 'localhost' },
    window: {
      useStewardRelays: () => rows,
      Steward: {
        ownRelay: () => OWN,
        // the REAL predicate, lifted from the shipped bundle — not a second opinion written here
        canRemoveRelay: shippedCanRemove(),
        removeRelay: () => true, relayNameFor: () => '',
      },
      addEventListener() {}, removeEventListener() {},
      localStorage: { getItem: () => null, setItem() {} },
    },
  });
  let t; for (let i = 0; i < 3; i++) t = draw(mod.DashRelaysCard, {});
  return find(t, n => n.type === 'button' && /Remove relay/.test((n.props && n.props['aria-label']) || ''));
};

test('the console does not PUT a bin on a relay it cannot remove', () => {
  const bins = renderRelayCard([
    { url: CANON, status: 'on' },
    { url: OWN, status: 'on' },
    { url: 'wss://friend.ts.net/relay', status: 'on' },
  ]);
  assert.equal(bins.length, 1,
    'expected exactly one bin — on the relay the church added itself. Got ' + bins.length + '. A bin against ' +
    'a canonical relay or the church\'s own box does nothing when clicked: removeRelay filters extraRelays() ' +
    'and those are appended unconditionally, so it returns true, the row stays, and nothing says why.');
});

test('CONTROL: the console still offers a bin on a relay the church added', () => {
  const bins = renderRelayCard([{ url: 'wss://friend.ts.net/relay', status: 'on' }]);
  assert.equal(bins.length, 1,
    'the bin has gone from a relay the church chose and can remove — the control has been disabled rather ' +
    'than corrected, and a church cannot take its data off a box it no longer trusts.');
});
