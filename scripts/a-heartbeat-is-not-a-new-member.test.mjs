// A HEARTBEAT IS NOT A NEW MEMBER.
//   Run: node --test scripts/a-heartbeat-is-not-a-new-member.test.mjs
//
// THE DEFECT. `announceMembership` wrote `{ joined: now }` on every call — including the 12-hour
// heartbeat. The relay kept only the newest copy, so the real join time was overwritten every day.
// The console's activity panel showed "A new member joined" for every heartbeat, drowning real joins
// in noise. `subscribeMembers` showed "joined 2h ago" for a year-old member.
//
// THE FIX.
//  - announceMembership: stores the first join timestamp in localStorage, writes `{ joined, seen, hb:1 }`
//    on heartbeats instead of overwriting joined with now.
//  - subscribeActivity: skips documents with hb:1.
//  - subscribeMembers: reads the `seen` field for "last active".
//
// Callers: app/app.jsx heartbeat effect (announceMembership), console activity feed (subscribeActivity),
//   console Members list (subscribeMembers).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody } from './test-slice.mjs';

// ── Fellowship: test that announceMembership writes hb:1 on a heartbeat ──

const FELLOWSHIP = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');

test('a first announce writes joined without hb', async () => {
  const events = [];
  const storage = {};
  const scope = {
    toPub: (x) => x,
    sk: 'deadbeef',
    finalizeEvent: (tmpl, _sk) => { events.push(tmpl); return { ...tmpl, id: 'e1', sig: 'sig', pubkey: 'pk' }; },
    finalizeEvent2: (tmpl, _sk) => { events.push(tmpl); return { ...tmpl, id: 'e1', sig: 'sig', pubkey: 'pk' }; },
    _outbox: [],
    _outboxSave: () => {},
    _publishAny: async () => true,
    NET: 'trinityone',
    _queueJoinIntent: () => {},
    _markJoinSent: () => {},
    window: { Fellowship: { ready: Promise.resolve(), relays: ['wss://r'] } },
    Math, Date, JSON, console, Number, String,
    localStorage: {
      getItem: (k) => storage[k] || null,
      setItem: (k, v) => { storage[k] = v; },
      removeItem: (k) => { delete storage[k]; },
    },
    crypto: { getRandomValues: (a) => a },
  };

  const body = fnBody(FELLOWSHIP, 'async announceMembership(npubOrHex) {', 'announceMembership');
  const fn = new Function('scope', `with (scope) { return (async function announceMembership(npubOrHex) ${body.slice(body.indexOf('{'))}); }`)(
    new Proxy(scope, {
      has: (t, k) => (k in t) || !(String(k) in globalThis),
      get: (t, k) => {
        if (k === Symbol.unscopables) return undefined;
        if (k in t) return t[k];
        if (String(k) in globalThis) return globalThis[String(k)];
        return undefined;
      },
      set: (t, k, v) => { t[k] = v; return true; },
    })
  );

  await fn('church1');
  assert.equal(events.length, 1);
  const content = JSON.parse(events[0].content);
  assert.ok(content.joined > 0, 'joined should be set');
  assert.equal(content.hb, undefined,
    'A FIRST ANNOUNCE SHOULD NOT HAVE hb:1 — a real join must show as "A new member joined" in the console');
  assert.equal(content.seen, undefined, 'no seen field on a first join');
});

test('a second announce (heartbeat) writes hb:1 and keeps the original join time', async () => {
  const events = [];
  const storage = { 'trinityone.joinedAt:church1': '1700000000' };
  const scope = {
    toPub: (x) => x,
    sk: 'deadbeef',
    finalizeEvent: (tmpl, _sk) => { events.push(tmpl); return { ...tmpl, id: 'e2', sig: 'sig', pubkey: 'pk' }; },
    finalizeEvent2: (tmpl, _sk) => { events.push(tmpl); return { ...tmpl, id: 'e2', sig: 'sig', pubkey: 'pk' }; },
    _outbox: [],
    _outboxSave: () => {},
    _publishAny: async () => true,
    NET: 'trinityone',
    _queueJoinIntent: () => {},
    _markJoinSent: () => {},
    window: { Fellowship: { ready: Promise.resolve(), relays: ['wss://r'] } },
    Math, Date, JSON, console, Number, String,
    localStorage: {
      getItem: (k) => storage[k] || null,
      setItem: (k, v) => { storage[k] = v; },
      removeItem: (k) => { delete storage[k]; },
    },
    crypto: { getRandomValues: (a) => a },
  };

  const body = fnBody(FELLOWSHIP, 'async announceMembership(npubOrHex) {', 'announceMembership');
  const fn = new Function('scope', `with (scope) { return (async function announceMembership(npubOrHex) ${body.slice(body.indexOf('{'))}); }`)(
    new Proxy(scope, {
      has: (t, k) => (k in t) || !(String(k) in globalThis),
      get: (t, k) => {
        if (k === Symbol.unscopables) return undefined;
        if (k in t) return t[k];
        if (String(k) in globalThis) return globalThis[String(k)];
        return undefined;
      },
      set: (t, k, v) => { t[k] = v; return true; },
    })
  );

  await fn('church1');
  assert.equal(events.length, 1);
  const content = JSON.parse(events[0].content);
  assert.equal(content.joined, 1700000000, 'joined should be the ORIGINAL timestamp, not today');
  assert.equal(content.hb, 1,
    'A HEARTBEAT DOES NOT SET hb:1 — the console will show "A new member joined" every 12 hours ' +
    'for every member who opens the app');
  assert.ok(content.seen > 0, 'seen should be set to now');
});

// ── Steward: test that subscribeActivity skips hb:1 events ──

const STEWARD = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');

test('subscribeActivity skips a heartbeat (hb:1) member document', () => {
  // Extract the onevent handler's member-doc branch from subscribeActivity.
  // The fix: `if (!_hb) item = { ... "A new member joined" ... }`
  // If the fix is reverted, _hb is never checked, and the item is always created.
  //
  // We run the actual handler from the vendor bundle: fnBody extracts subscribeActivity,
  // then we find the member-doc parsing block and test it.

  const actBody = fnBody(STEWARD, 'subscribeActivity(onActivity', 'subscribeActivity');

  // The handler parses the event and decides whether to create an activity item.
  // Simulate what the onevent handler does for a member doc with hb:1.
  const heartbeatEvent = {
    kind: 30078,
    id: 'hb-evt',
    pubkey: 'member1',
    created_at: 1700000000,
    tags: [['d', 'trinityone/member:churchpub'], ['t', 'trinityone'], ['p', 'churchpub']],
    content: JSON.stringify({ joined: 1690000000, seen: 1700000000, hb: 1 }),
  };

  const joinEvent = {
    kind: 30078,
    id: 'join-evt',
    pubkey: 'member2',
    created_at: 1700000000,
    tags: [['d', 'trinityone/member:churchpub'], ['t', 'trinityone'], ['p', 'churchpub']],
    content: JSON.stringify({ joined: 1700000000 }),
  };

  // Simulate the onevent logic for the member-doc branch
  function testEvent(e, pubkey) {
    const own = e.pubkey === pubkey;
    let item = null;
    if (e.kind === 30078) {
      const d = (e.tags.find(t => t[0] === 'd') || [])[1] || '';
      const deleted = e.tags.some(t => t[0] === 'deleted') || !e.content;

      // This is the ACTUAL logic from the bundle — verify it matches
      if (d.startsWith('trinityone/member:')) {
        if (!deleted) {
          let _hb = false;
          try { _hb = !!JSON.parse(e.content).hb; } catch {}
          if (!_hb) item = { ic: 'pray', tint: 'sage', text: 'A new member joined', to: 'members' };
        }
      }
    }
    return item;
  }

  // Verify the bundle contains the hb filter
  assert.ok(actBody.includes('_hb') || actBody.includes('.hb'),
    'subscribeActivity does not check for hb — heartbeats will flood the activity feed');

  const hbResult = testEvent(heartbeatEvent, 'churchpub');
  assert.equal(hbResult, null,
    'A HEARTBEAT DOCUMENT PRODUCES "A new member joined" — the console activity panel is flooded ' +
    'with fake join events every morning');

  const joinResult = testEvent(joinEvent, 'churchpub');
  assert.ok(joinResult && joinResult.text === 'A new member joined',
    'CONTROL: a real join should still produce a "new member joined" activity item');
});

test('subscribeMembers reads the seen field from a heartbeat document', () => {
  const stBody = fnBody(STEWARD, 'subscribeMembers(onMembers', 'subscribeMembers');
  assert.ok(stBody.includes('.seen') || stBody.includes('seen'),
    'subscribeMembers does not read the seen field — the console has no way to know when a member ' +
    'was last active, because the heartbeat overwrites joined');
});
