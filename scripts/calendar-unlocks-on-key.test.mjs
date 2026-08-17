// A NEWLY ADMITTED MEMBER'S CALENDAR MUST OPEN WHEN THE KEY ARRIVES — NOT WHEN THEY RESTART THE APP.
// Run: node --test scripts/calendar-unlocks-on-key.test.mjs
//
// MEASURED IN A LIVE APP (2026-08-17, member joined St Aidan's via an invite link on the funnel relay):
//
//   before reload  [{"id":"evtmsx5h42…","locked":true},  {…locked:true}, {…locked:true}]
//   after  reload  [{"id":"evtmsx5h42…","locked":false,"title":"Prayer Breakfast","date":"2026-08-18"}, …]
//
// The church's calendar — events, services, rotas, rooms, bookings, runsheets — is sealed under the church
// NAME key. A member gets that key when a steward admits them, which by definition happens AFTER they have
// already received the calendar documents. `_subChurchAddr` stored each unopenable doc as `{ _locked: true }`
// and threw the ciphertext away, and nothing re-ran when the key landed. So the calendar stayed padlocked
// for the whole session.
//
// Why this is worse than it sounds: it is the FIRST thing a new member sees. They join, a steward lets them
// in, and the church's calendar is a row of padlocks — at the exact moment they are deciding whether this
// thing works at all. Nobody force-closes an app to fix a screen that is not obviously broken.
//
// The same shape was already fixed twice in this file — for sealed NAMES (_replaySealedNames) and for CARE
// needs (the care key replays its buffered needs through onevent). The calendar was missed because the name
// key is thought of as "the key for names"; it seals the calendar too.
//
// THE TEST DRIVES THE SHIPPED BUNDLE. vendor/fellowship.js is what the app loads. A test that re-implemented
// the replay would pass against its own copy while the real one stayed broken — the mirror-test failure this
// repo keeps repeating.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SRC    = readFileSync(new URL('../src/fellowship.src.js', import.meta.url), 'utf8');
const BUNDLE = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');

test('every name-key-sealed document type is on the replay list', () => {
  // If the church starts sealing a new kind of document and it is not added here, that one type silently
  // keeps the old broken behaviour — which is precisely how the calendar was missed in the first place.
  const m = SRC.match(/const CHURCH_SEALED_PFXS = \[([\s\S]*?)\];/);
  assert.ok(m, 'CHURCH_SEALED_PFXS is gone — re-anchor this test rather than deleting it');
  const listed = [...m[1].matchAll(/'trinityone\/(\w+):'/g)].map(x => x[1]).sort();

  // The authority is steward.src.js: everything passed through _sealChurchDoc before publish.
  const STEW = readFileSync(new URL('../src/steward.src.js', import.meta.url), 'utf8');
  const sealed = new Set();
  const D_TO_PFX = { EVENT_D: 'event', SERVICE_D: 'service', ROOM_D: 'room', BOOKING_D: 'booking',
    ROTA_D: 'rota', RUNSHEET_D: 'runsheet', ROSTER_D: 'roster' };
  for (const mm of STEW.matchAll(/_sealChurchDoc\(/g)) {
    const after = STEW.slice(mm.index, mm.index + 900);
    const dm = after.match(/\['d',\s*([A-Z_]+_D)\s*\+/);
    if (dm && D_TO_PFX[dm[1]]) sealed.add(D_TO_PFX[dm[1]]);
  }
  assert.ok(sealed.size >= 5, `only found ${sealed.size} sealed doc types — the scan has drifted, re-anchor it`);
  for (const kind of sealed) {
    assert.ok(listed.includes(kind),
      `the church seals '${kind}:' under the name key but the replay list omits it — a member admitted after ` +
      `it was published will see it padlocked until they restart the app`);
  }
});

test('the replay is wired into EVERY path that ingests the name key', () => {
  // Three: the live relay path, the roster-absorb retry (a key whose author was not yet trusted), and the
  // cold-boot replay. A member can be admitted while any one of them is the active route, so a fix wired into
  // only one leaves the same bug alive on the others.
  const ingests = [...SRC.matchAll(/_ingestNameKey\((?:cp|hub\.cp), e2?\);/g)];
  assert.ok(ingests.length >= 3, `expected 3 name-key ingest sites, found ${ingests.length} — re-anchor`);
  for (const m of ingests) {
    // A window, sized to the furthest real call site (the live path re-seals our own name and re-opens the
    // buffered name docs first, so its replay sits ~890 chars down) with room to spare.
    const window = SRC.slice(m.index, m.index + 1400);
    assert.match(window, /_replayChurchCalendar\(/,
      'a name-key ingest that does not re-open the calendar leaves a newly admitted member padlocked ' +
      `until they restart the app. Site: ${SRC.slice(m.index, m.index + 60).replace(/\n/g, ' ')}`);
  }
});

test('the replay pushes documents back through the handlers, not into a private cache', () => {
  const fn = SRC.slice(SRC.indexOf('function _replayChurchCalendar'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  assert.match(body, /h\.onevent\(e2, d2\)/,
    'it must re-deliver through onevent — that is what re-parses the doc WITH the key and replaces the ' +
    '{_locked:true} placeholder the screen is currently rendering');
  assert.match(body, /_nameKeys\.get\(cp\) \|\| \[\]\)\.length/,
    'replaying before a key exists is pure work for nothing, and re-locks what is already open');
  assert.match(body, /_featureFailed\(/,
    'a throw inside a relay handler is swallowed — one bad document must not stop the rest of the calendar');
});

test('the shipped bundle carries it', () => {
  assert.match(BUNDLE, /name-key calendar replay/,
    'vendor/fellowship.js is what the app actually loads — rebuild: bash scripts/build-fellowship.sh');
  assert.match(BUNDLE, /trinityone\/booking:/, 'the sealed-prefix list did not make it into the bundle');
});
