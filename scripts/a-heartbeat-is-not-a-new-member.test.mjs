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
import { fnBody, liftKeyRead } from './test-slice.mjs';

// ── Fellowship: test that announceMembership writes hb:1 on a heartbeat ──

const FELLOWSHIP = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');

test('a first announce writes joined without hb', async () => {
  const events = [];
  const storage = {};
  const scope = {
    toPub: (x) => x,
    sk: 'deadbeef',
    finalizeEvent: (tmpl, _sk) => { events.push(tmpl); return { ...tmpl, id: 'e1', sig: 'sig', pubkey: 'pk' }; },
    // setEventRsvp / announceMembership / leaveMembership stamp through _monotonicF (sim item 19). These tests are about
    // something else, so the stamp is the identity here; its own behaviour is a-second-write-in-the-same-second-is-not-a-failure.test.mjs.
    _monotonicF: (t) => t,
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
    // setEventRsvp / announceMembership / leaveMembership stamp through _monotonicF (sim item 19). These tests are about
    // something else, so the stamp is the identity here; its own behaviour is a-second-write-in-the-same-second-is-not-a-failure.test.mjs.
    _monotonicF: (t) => t,
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

test('subscribeActivity skips a heartbeat (hb:1) member document', async () => {
  const actBody = fnBody(STEWARD, 'subscribeActivity(onActivity', 'subscribeActivity');
  let items = [], handler = null;
  const scope = {
    pool: { subscribeMany: (_u, _f, h) => { handler = h; return { close() {} }; } },
    relays: () => ['wss://r'],
    pub: 'churchpub',
    NET: 'trinityone',
    GROUP_D: 'trinityone/group:', FUND_D: 'trinityone/fund:',
    JSON, Math, Date, console, String, Number, Map, Set, setTimeout, clearTimeout,
  };
  const fn = new Function('scope', `with (scope) { return ({ ${actBody} }).subscribeActivity; }`)(
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
  fn((list) => { items = list.slice(); });
  assert.ok(handler, 'subscribeActivity did not open a subscription');

  handler.onevent({
    kind: 30078, id: 'hb-evt', pubkey: 'member1', created_at: 1700000000,
    tags: [['d', 'trinityone/member:churchpub'], ['t', 'trinityone'], ['p', 'churchpub']],
    content: JSON.stringify({ joined: 1690000000, seen: 1700000000, hb: 1 }),
  });
  await new Promise(r => setTimeout(r, 200));
  assert.ok(!items.some(i => i.text === 'A new member joined'),
    'A HEARTBEAT DOCUMENT PRODUCES "A new member joined" — the console activity panel is flooded ' +
    'with fake join events every morning');

  handler.onevent({
    kind: 30078, id: 'join-evt', pubkey: 'member2', created_at: 1700000001,
    tags: [['d', 'trinityone/member:churchpub'], ['t', 'trinityone'], ['p', 'churchpub']],
    content: JSON.stringify({ joined: 1700000001 }),
  });
  await new Promise(r => setTimeout(r, 200));
  assert.ok(items.some(i => i.text === 'A new member joined'),
    'CONTROL: a real join should produce a "new member joined" activity item');
});

test('subscribeMembers reads the seen field from a heartbeat document', async () => {
  const stBody = fnBody(STEWARD, 'subscribeMembers(onMembers', 'subscribeMembers');
  let members = [];
  const handlers = [];
  const storage = {};
  const scope = {
    pool: { subscribeMany: (_u, _f, h) => { handlers.push(h); return { close() {} }; } },
    relays: () => ['wss://r'],
    pub: 'churchpub',
    NET: 'trinityone',
    JSON, Math, Date, console, String, Number, Map, Set, Array, Infinity,
    setTimeout, clearTimeout,
    npubEncode: (x) => x,
    localStorage: {
      getItem: (k) => storage[k] || null,
      setItem: (k, v) => { storage[k] = v; },
    },
    window: { Steward: { openMemberName: () => '' } },
  };
  // the shipped list stamp (_listTag/_stampFor) — subscribeMembers stamps every list with the church it was opened for
  const fn = new Function('scope', `with (scope) { ${liftKeyRead(STEWARD)}\n return ({ ${stBody} }).subscribeMembers; }`)(
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
  fn((list) => { members = list.slice(); });
  assert.ok(handlers.length >= 1, 'subscribeMembers did not open a subscription');

  for (const h of handlers) h.onevent({
    kind: 30078, id: 'mem-evt', pubkey: 'member1', created_at: 1700000000,
    tags: [['d', 'trinityone/member:churchpub'], ['t', 'trinityone'], ['p', 'churchpub']],
    content: JSON.stringify({ joined: 1690000000, seen: 1700000000, hb: 1 }),
  });
  await new Promise(r => setTimeout(r, 250));
  const m = members.find(m => m.pubkey === 'member1');
  assert.ok(m, 'the member was not added');
  assert.equal(m.seen, 1700000000,
    'subscribeMembers does not read the seen field — the console has no way to know when a member ' +
    'was last active, because the heartbeat overwrites joined');
});
