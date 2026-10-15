// THE CONSOLE NOW SHOWS WHO IS READY TO HELP, AND WHO HAS SIGNED UP.
// Run: node --test scripts/care-ready-to-help.test.mjs
//
// Two things a steward could not see before (owner decision, 2026-10-15):
//   (A) members who tapped "I'm here to help" — a doc sealed under the church NAME key, d=careavail:<churchPub>,
//       read member-side only. Reader: StewardMeals.subscribeCareAvail (vendor/steward-meals.js). Surface: the
//       collapsed "Ready to help" section on the Care page (StewReadyToHelp in app/stew-meals.jsx).
//   (B) the NAMES of people who signed up to a need (careSignupSummary, drawn on the Overview).
//
// What drives what (CLAUDE.md rules 1 and 3): the READER is the shipped bundle (vendor/steward-meals.js). The
// screens are app/*.jsx, which ship unbundled, so they are COMPILED AND RUN here, never text-matched. The only
// stand-in is the Steward object: its openChurchDoc below is a faithful copy of _openChurchDoc (src/steward.src.js
// ~L240: plain JSON first, then every key in the ring, null when none opens) over REAL NIP-44.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { v2 as nip44 } from 'nostr-tools/nip44';
import { fnBody } from './test-slice.mjs';

const MEALS_JSX = readFileSync(new URL('../app/stew-meals.jsx', import.meta.url), 'utf8');
const DASH_JSX = readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8');
const MEALS_BUNDLE = readFileSync(new URL('../vendor/steward-meals.js', import.meta.url), 'utf8');
const STEWARD_BUNDLE = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');

const hex = (u8) => Array.from(u8).map(b => b.toString(16).padStart(2, '0')).join('');
const unhex = (h) => Uint8Array.from(h.match(/../g).map(b => parseInt(b, 16)));
const CP = 'c'.repeat(64);
const AVAIL_D = 'trinityone/careavail:' + CP;
const ADULT = 'a'.repeat(64), CHILD = 'b'.repeat(64), SECOND = 'd'.repeat(64);

// ── (A1) the reader, from the shipped bundle ────────────────────────────────────────────────────────────────
function loadReader() {
  const nameKey = hex(generateSecretKey());
  const ring = []; const listeners = new Set();
  const handlers = []; let filters = null, closed = false;
  const Steward = {
    churchPub: CP,
    subscribeMany(f, h) { filters = f; handlers.push(h); return { close() { closed = true; } }; },
    openChurchDoc(content) {
      try { const o = JSON.parse(content); if (!o || typeof o.e !== 'string') return o; } catch (e) { return null; }
      const ct = JSON.parse(content).e;
      for (const k of ring) { try { return JSON.parse(nip44.decrypt(ct, unhex(k))); } catch (e) {} }
      return null;
    },
    onNameKeyRing(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
  const window = { Steward };
  new Function('window', 'localStorage', MEALS_BUNDLE)(window, { getItem: () => null, setItem() {}, removeItem() {} });
  const seal = (obj) => JSON.stringify({ e: nip44.encrypt(JSON.stringify(obj), unhex(nameKey)) });
  const ev = (pubkey, obj, at, extra = []) => ({ kind: 30078, pubkey, created_at: at, tags: [['d', AVAIL_D], ['church', CP], ...extra], content: obj === null ? '' : seal(obj) });
  const out = []; const stop = window.StewardMeals.subscribeCareAvail((l) => out.push(l));
  const last = () => out[out.length - 1];
  return {
    window, filters: () => filters, ev, out, last, stop, closed: () => closed,
    send: (e) => handlers[0].onevent(e), eose: () => handlers[0].oneose(),
    giveKey: () => { ring.push(nameKey); for (const fn of [...listeners]) fn(); },
  };
}

test('(A) the shipped reader is exposed, and Steward offers the name-key opener it needs', () => {
  const r = loadReader();
  assert.equal(typeof r.window.StewardMeals.subscribeCareAvail, 'function');
  assert.match(STEWARD_BUNDLE, /openChurchDoc\(content\)/, 'vendor/steward.js lost the openChurchDoc export — rebuild with scripts/build-steward.sh');
  assert.match(STEWARD_BUNDLE, /onNameKeyRing\(fn\)/);
});

test('(A) it asks the relay for careavail:<church> docs tagged for this church, and lists an offer once the key is held', () => {
  const r = loadReader(); r.giveKey();
  assert.deepEqual(r.filters(), [{ kinds: [30078], '#church': [CP], '#d': [AVAIL_D] }]);
  r.send(r.ev(ADULT, { available: true, tags: ['meals', 'rides'], note: ' happy to drive ' }, 100)); r.eose();
  assert.deepEqual(r.last(), [{ pubkey: ADULT, tags: ['meals', 'rides'], note: 'happy to drive', ts: 100 }]);
});

test('(A) a doc sealed with a key that has not arrived yields NOTHING — and appears once the key lands', () => {
  const r = loadReader();
  r.send(r.ev(ADULT, { available: true, tags: ['meals'], note: '' }, 100)); r.eose();
  assert.equal(r.out.length, 0, 'a still-sealed listing must not be emitted, not even as an empty "nobody is ready" list');
  r.giveKey();
  assert.equal(r.last().length, 1, 'the name-key replay did not re-open the sealed listing');
  assert.equal(r.last()[0].pubkey, ADULT);
});

test('(A) withdrawing (available:false), a tombstone, and a lagging older copy are all handled', () => {
  const r = loadReader(); r.giveKey();
  r.send(r.ev(ADULT, { available: true, tags: [], note: '' }, 100));
  r.send(r.ev(SECOND, { available: true, tags: [], note: '' }, 100)); r.eose();
  assert.equal(r.last().length, 2);
  r.send(r.ev(ADULT, { available: false }, 200));
  assert.deepEqual(r.last().map(x => x.pubkey), [SECOND], 'available:false left the person listed');
  r.send(r.ev(ADULT, { available: true, tags: [], note: '' }, 150));
  assert.deepEqual(r.last().map(x => x.pubkey), [SECOND], 'a lagging older copy resurrected a withdrawn offer');
  r.send(r.ev(SECOND, null, 300, [['deleted', '1']]));
  assert.deepEqual(r.last(), [], 'a tombstone left the person listed');
});

test('(A) a doc at somebody else\'s d-tag is ignored', () => {
  const r = loadReader(); r.giveKey();
  const e = r.ev(ADULT, { available: true, tags: [], note: '' }, 100); e.tags[0] = ['d', 'trinityone/careavail:' + 'e'.repeat(64)];
  r.send(e); r.eose();
  assert.equal(r.out.length, 0);
});

// ── (A2) the screen: StewReadyToHelp, compiled from app/stew-meals.jsx and RUN ───────────────────────────────
function permissive(scope) {
  return new Proxy(scope, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k]; throw new ReferenceError('needs a stub for ' + String(k)); },
  });
}
function compile(src, name) {
  return transformSync(src, { loader: 'jsx', jsx: 'transform', jsxFactory: 'h', jsxFragment: 'Frag' }).code + `\nreturn ${name};`;
}
function recorder() {
  const nodes = [];
  const h = (type, props, ...kids) => { const n = { type: typeof type === 'function' ? (type.name || 'fn') : type, props: props || {}, kids: kids.flat(Infinity).filter(x => x != null && x !== false) }; nodes.push(n); return n; };
  return { nodes, h };
}
// ONLY WHAT THE COMPONENT RETURNED. The recorder sees every element ever created, including one built into a
// variable and then left out of the returned tree — that is a banner nobody sees, and counting it would let a
// deleted `{careSignupBanner}` pass. Walk the returned tree instead.
const reach = (root) => { const out = []; const go = (n) => { if (n == null || typeof n !== 'object') return; if (Array.isArray(n)) return n.forEach(go); out.push(n); (n.kids || []).forEach(go); }; go(root); return out; };
const texts = (nodes) => nodes.flatMap(n => n.kids.filter(k => typeof k === 'string' || typeof k === 'number').map(String)).join(' | ');

function renderReady({ avail, minors = [], minorsKnown = true, blocked = [], open = false, allowed = true, needs = [], slots = [], skips = [], picking = null, status = {}, sendDM = async () => ({ id: 'evt' }) }) {
  const { nodes, h } = recorder();
  const events = []; const sent = []; const statusLog = [];
  const scope = {
    h, Frag: 'Frag',
    // state by the shape of its initial value: boolean = open, null = which person's picker, {} = per-person status
    React: { useState: (v) => [typeof v === 'boolean' ? open : v === null ? picking : (v && typeof v === 'object' && !Array.isArray(v)) ? status : v, (f) => { if (v && typeof v === 'object' && !Array.isArray(v)) statusLog.push(typeof f === 'function' ? f(status) : f); }] },
    mealsTypeLabel: () => 'Meals', todayISO: () => '2026-10-15',
    window: {
      useMealsNeeds: () => needs, useMealsSlots: () => slots, useMealsSkips: () => skips, todayISO: () => '2026-10-15', Steward: { sendDM: (...a) => { sent.push(a); return sendDM(...a); } },
      useMealsAvail: () => avail,
      useStewardDirectory: () => ({ [ADULT]: { pubkey: ADULT, name: 'Margaret', npub: 'npub1margaret' }, [SECOND]: { pubkey: SECOND, name: 'Tomas' }, [CHILD]: { pubkey: CHILD, name: 'Ellie' } }),
      useStewardSafeguard: () => ({ minors, approved: [], minorsKnown }),
      useStewardBlocked: () => blocked,
      dispatchEvent: (e) => events.push(e),
    },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
    stewCapState: () => ({ allowed }),
    Icon: function Icon() { return null; },
    CARE_AVAIL_LABEL: undefined,
  };
  // the component's module-level helper constants sit beside it in the file; compile them with it
  const helpers = ['const CARE_AVAIL_LABEL', 'const careAvailLabel'].map(a => { const i = MEALS_JSX.indexOf(a); return MEALS_JSX.slice(i, MEALS_JSX.indexOf('\n', i)); }).join('\n');
  delete scope.CARE_AVAIL_LABEL;
  const lift = (a) => fnBody(MEALS_JSX, a, a);
  const src = helpers + `\nconst needTitle = (need) => need._sealed ? 'Details hidden' : (need.displayLabel || 'A member in our church');\n` + lift('function mealsDateRange(') + '\n' + lift('function careOpenNeeds(') + '\n' + lift('async function careInvite(') + '\n' + fnBody(MEALS_JSX, 'function StewReadyToHelp()', 'StewReadyToHelp');
  const Comp = new Function('scope', `with (scope) { ${compile(src, 'StewReadyToHelp')} }`)(permissive(scope));
  const tree = Comp();
  const seen = reach(tree);
  const buttons = seen.filter(n => n.type === 'button');
  return { tree, nodes: seen, all: texts(seen), buttons, events, scope, sent, statusLog };
}
const offer = (pubkey, extra = {}) => ({ pubkey, tags: ['meals', 'prayer'], note: 'Free on weekday evenings', ts: 1, ...extra });

test('(A) Ready to help: collapsed shows only the count; opened shows name, tag chips, note and a Message button', () => {
  const closed = renderReady({ avail: [offer(ADULT), offer(SECOND)] });
  assert.match(closed.all, /Ready to help ·\s*\|\s*2/);
  assert.ok(!/Margaret/.test(closed.all), 'the list is meant to start collapsed');
  const r = renderReady({ avail: [offer(ADULT), offer(SECOND)], open: true });
  assert.match(r.all, /Margaret/); assert.match(r.all, /Tomas/);
  assert.match(r.all, /Meals/); assert.match(r.all, /Prayer/);
  assert.match(r.all, /Free on weekday evenings/);
  const msg = r.buttons.filter(b => /Message/.test(texts([b].concat(r.nodes.filter(n => b.kids.includes(n))))));
  assert.equal(msg.length, 2, 'each row needs a Message button');
  msg[0].props.onClick();
  assert.equal(r.events.length, 1);
  assert.equal(r.events[0].type, 'steward-open-dm', 'Message must use the console\'s existing DM entry');
  assert.equal(r.events[0].detail.pubkey, ADULT);
  assert.equal(r.events[0].detail.name, 'Margaret');
});

test('(A) a CHILD is never listed, even with a stale availability doc; nor is a blocked member', () => {
  const r = renderReady({ avail: [offer(CHILD), offer(ADULT), offer(SECOND)], minors: [CHILD], blocked: [SECOND], open: true });
  assert.match(r.all, /Ready to help ·\s*\|\s*1/);
  assert.ok(!/Ellie/.test(r.all), 'a child is advertised as a helper');
  assert.ok(!/Tomas/.test(r.all), 'a blocked member is listed');
  assert.match(r.all, /Margaret/);
  const onlyChild = renderReady({ avail: [offer(CHILD)], minors: [CHILD], open: true });
  assert.equal(onlyChild.tree, null, 'with only a child on the list the section must not draw at all');
});

test('(A) while the children list has not arrived NOTHING is listed (an empty set answers "no" as confidently as a loaded one)', () => {
  const r = renderReady({ avail: [offer(CHILD), offer(ADULT)], minors: [], minorsKnown: false, open: true });
  assert.equal(r.tree, null);
});

test('(A) no key / nothing offered -> no section; a delegate without the care capability sees none', () => {
  assert.equal(renderReady({ avail: [] }).tree, null, 'an empty or still-sealed list drew a section');
  assert.equal(renderReady({ avail: [offer(ADULT)], allowed: false }).tree, null);
});

// ── (A3) point of use: the Care page actually draws it ───────────────────────────────────────────────────────
test('(A) DashMeals — the Care page — draws StewReadyToHelp', () => {
  const { nodes, h } = recorder();
  const scope = {
    h, Frag: 'Frag', React: { useState: (v) => [v, () => {}] },
    window: { useMealsNeeds: () => [], useMealsSlots: () => [], useMealsSkips: () => [] },
    todayISO: () => '2026-10-15', mealsLbl: {}, Icon: function Icon() { return null; },
    SafetyCheckPanel: function SafetyCheckPanel() { return null; },
    StewCareRequests: function StewCareRequests() { return null; },
    StewReadyToHelp: function StewReadyToHelp() { return null; },
    MealsEmpty: function MealsEmpty() { return null; }, MealsNeedCard: function MealsNeedCard() { return null; },
    MealsNeedDetail: function MealsNeedDetail() { return null; }, MealsNeedModal: function MealsNeedModal() { return null; },
  };
  const Comp = new Function('scope', `with (scope) { ${compile(fnBody(MEALS_JSX, 'function DashMeals()', 'DashMeals'), 'DashMeals')} }`)(permissive(scope));
  assert.ok(reach(Comp()).some(n => n.type === 'StewReadyToHelp'), 'the Care page no longer draws the "Ready to help" section');
});

// ── (B) sign-up NAMES ────────────────────────────────────────────────────────────────────────────────────────
function loadSummary() {
  const window = {};
  const src = `const needTitle = (need) => need._sealed ? 'Details hidden' : (need.displayLabel || 'A member in our church');\n` + fnBody(MEALS_JSX, 'function careSignupSummary(', 'careSignupSummary');
  new Function('window', src + '\nwindow.careSignupSummary = careSignupSummary;')(window);
  return window.careSignupSummary;
}
test('(B) careSignupSummary names the distinct people on each still-running need, and skips closed / unanswered ones', () => {
  const f = loadSummary();
  const needs = [{ id: 'n1', displayLabel: 'Verity — a lift', endDate: '2026-11-01' }, { id: 'n2', displayLabel: 'Open one', endDate: '2026-11-01' }, { id: 'n3', displayLabel: 'Old', endDate: '2026-09-01' }];
  const slots = [{ needId: 'n1', pubkey: ADULT }, { needId: 'n1', pubkey: SECOND }, { needId: 'n1', pubkey: ADULT }, { needId: 'n3', pubkey: ADULT }];
  const nameOf = (p) => ({ [ADULT]: 'Callum', [SECOND]: 'Desmond' }[p]);
  assert.deepEqual(f(needs, slots, nameOf, '2026-10-15'), [{ needId: 'n1', title: 'Verity — a lift', names: ['Callum', 'Desmond'] }]);
});

// the Overview itself: compile DashOverview from the shipped source and run it with the hooks answering
function renderOverview({ needs, slots, careOn = true, allowed = true }) {
  const { nodes, h } = recorder();
  const noop = () => {};
  const scope = {
    h, Frag: 'Frag',
    React: { useState: (v) => [typeof v === 'function' ? v() : v, noop], useEffect: noop, useMemo: (f) => f(), useRef: () => ({ current: null }), useCallback: (f) => f, useLayoutEffect: noop },
    window: {
      useStewardGroups: () => [], useStewardMembers: () => [], useStewardRosters: () => [], useStewardRelays: () => [], useStewardStats: () => ({}),
      useStewardActivity: () => [], useStewardJoinPolicy: () => false, useStewardIdv: () => 0, useStewardConn: () => 0, useStewardBlocked: () => [],
      useStewardAdmitted: () => [], usePendingStewards: () => [],
      useMealsSettings: () => ({ enabled: careOn }), useMealsNeeds: () => needs, useMealsSlots: () => slots,
      useStewardDirectory: () => ({ [ADULT]: { name: 'Callum' }, [SECOND]: { name: 'Desmond' } }),
      useRealMemberCount: () => 0, StewardMeals: { subscribeCareRequests: () => noop }, todayISO: () => '2026-10-15', stewardStreamLoaded: () => true,
    },
    careSignupSummary: undefined,
  };
  // the real summary, from the same file, published where DashOverview looks for it
  const summarySrc = `const needTitle = (need) => need._sealed ? 'Details hidden' : (need.displayLabel || 'A member in our church');\n` + fnBody(MEALS_JSX, 'function careSignupSummary(', 'careSignupSummary');
  new Function('window', summarySrc + '\nwindow.careSignupSummary = careSignupSummary;')(scope.window);
  delete scope.careSignupSummary;
  // anything else the screen reaches for that does not matter here answers harmlessly
  const loose = new Proxy(scope, {
    has: (t, k) => (k in t) || !(String(k) in globalThis),
    get: (t, k) => {
      if (k === Symbol.unscopables) return undefined; if (k in t) return t[k];
      const s = String(k);
      if (s === 'stewCapState') return () => ({ allowed });
      if (s === 'useStewNarrow') return () => true;
      if (s === 'useRealMemberCount') return () => 0;
      if (s === 'Icon' || /^[A-Z]/.test(s)) return function Stub() { return null; };
      if (/^use[A-Z]/.test(s)) return () => [];
      throw new ReferenceError('needs a stub for ' + s);
    },
  });
  const Comp = new Function('scope', `with (scope) { ${compile(fnBody(DASH_JSX, 'function DashOverview(', 'DashOverview'), 'DashOverview')} }`)(loose);
  return texts(reach(Comp({ onTab: noop, onNewPost: noop, onSettings: noop })));
}
test('(B) the Overview names the people who signed up to a need', () => {
  const t = renderOverview({ needs: [{ id: 'n1', displayLabel: 'Verity — a lift', endDate: '2026-11-01' }], slots: [{ needId: 'n1', pubkey: ADULT, isoDate: '2026-10-20' }, { needId: 'n1', pubkey: SECOND, isoDate: '2026-10-21' }] });
  assert.match(t, /Callum, Desmond/, 'the Overview does not say WHO signed up');
  assert.match(t, /Verity — a lift/);
});
test('(B) ...and says nothing when nobody has signed up, or when this steward lacks the care capability', () => {
  const needs = [{ id: 'n1', displayLabel: 'Verity — a lift', endDate: '2026-11-01' }];
  assert.ok(!/signed up/.test(renderOverview({ needs, slots: [] })));
  assert.ok(!/Callum/.test(renderOverview({ needs, slots: [{ needId: 'n1', pubkey: ADULT }], allowed: false })));
});

// ── (C) "Invite to a need" ───────────────────────────────────────────────────────────────────────────────────
const NEED1 = { id: 'n1', displayLabel: 'Verity — a lift', type: 'rides', startDate: '2026-10-20', endDate: '2026-10-22' };
const NEED2 = { id: 'n2', displayLabel: 'The Okafors — meals', type: 'meals', dates: ['2026-10-25'], endDate: '2026-10-25' };
const btnText = (b) => reach(b).map(n => n.kids.filter(k => typeof k === 'string').join('')).join('');
const inviteBtn = (r, i = 0) => r.buttons.filter(b => /Invite to a need/.test(btnText(b)))[i];

test('(C) ZERO open needs: the button is disabled and says why', () => {
  const none = renderReady({ avail: [offer(ADULT)], open: true, needs: [] });
  assert.equal(inviteBtn(none).props.disabled, true);
  assert.match(none.all, /No open needs/);
  // a fully-covered need and a closed one are not open either
  const covered = renderReady({ avail: [offer(ADULT)], open: true, needs: [{ ...NEED1 }, { ...NEED2, endDate: '2026-09-01', dates: ['2026-09-01'] }],
    slots: [{ needId: 'n1', isoDate: '2026-10-20' }, { needId: 'n1', isoDate: '2026-10-21' }], skips: [{ needId: 'n1', isoDate: '2026-10-22' }] });
  assert.equal(inviteBtn(covered).props.disabled, true, 'covered / past needs were offered as open');
});

test('(C) ONE open need: one tap sends a private message that NAMES the need, to that person, and writes no sign-up', async () => {
  const r = renderReady({ avail: [offer(ADULT)], open: true, needs: [NEED1] });
  assert.ok(!inviteBtn(r).props.disabled);
  await inviteBtn(r).props.onClick();
  assert.equal(r.sent.length, 1, 'one tap must send exactly one message');
  assert.equal(r.sent[0][0], ADULT);
  assert.match(r.sent[0][1], /Margaret/); assert.match(r.sent[0][1], /Verity — a lift/); assert.match(r.sent[0][1], /3 days still open/);
  assert.match(r.sent[0][1], /sign up for a day that suits you/, 'the message must leave the sign-up to them');
  // the ONLY thing the screen may call is sendDM: no slot writer, no rota/need publisher is even in scope
  assert.deepEqual(Object.keys(r.scope.window.Steward), ['sendDM']);
});

test('(C) MULTIPLE open needs: a tap shows a picker (no send yet); choosing a need sends that one', async () => {
  const two = renderReady({ avail: [offer(ADULT)], open: true, needs: [NEED1, NEED2] });
  await inviteBtn(two).props.onClick();
  assert.equal(two.sent.length, 0, 'with several needs the steward must choose — nothing may be sent on the first tap');
  const picker = renderReady({ avail: [offer(ADULT)], open: true, needs: [NEED1, NEED2], picking: ADULT });
  assert.match(picker.all, /Which need\?/);
  const choice = picker.buttons.filter(b => /The Okafors/.test(btnText(b)));
  assert.equal(choice.length, 1); assert.equal(picker.buttons.filter(b => /Verity/.test(btnText(b))).length, 1);
  await choice[0].props.onClick();
  assert.equal(picker.sent.length, 1); assert.match(picker.sent[0][1], /The Okafors — meals/); assert.ok(!/Verity/.test(picker.sent[0][1]));
});

test('(C) a sealed need is never offered (its name is hidden)', () => {
  const r = renderReady({ avail: [offer(ADULT)], open: true, needs: [{ ...NEED1, _sealed: true }] });
  assert.equal(inviteBtn(r).props.disabled, true);
});

test('(C) the Invite button is only on listed rows — a child never gets a row, so never an invite', () => {
  const r = renderReady({ avail: [offer(CHILD)], minors: [CHILD], open: true, needs: [NEED1] });
  assert.equal(r.tree, null);
});

// honest feedback: the engine answers three ways, and only one of them is "invited"
function loadInvite() {
  const src = fnBody(MEALS_JSX, 'async function careInvite(', 'careInvite');
  return new Function('window', src + '\nreturn careInvite;')({});
}
const NEED = { title: 'Verity — a lift', type: 'Rides', openCount: 1 };
test('(C) careInvite is honest: sent / queued / not sent are three different answers', async () => {
  const f = loadInvite(); const P = { pubkey: ADULT, name: 'Margaret' };
  assert.deepEqual(await f(async () => ({ id: 'e' }), P, NEED), { ok: true });
  assert.deepEqual(await f(async () => ({ id: 'e', _queued: true }), P, NEED), { ok: true, queued: true });
  assert.deepEqual(await f(async () => null, P, NEED), { ok: false }, 'a null from sendDM (nothing sent) was reported as success');
  assert.deepEqual(await f(async () => { throw new Error('x'); }, P, NEED), { ok: false });
  let body = ''; await f(async (pk, b) => { body = b; return { id: 'e' }; }, P, NEED);
  assert.match(body, /1 day still open/);
});
test('(C) the row shows the honest line: success only for a sent message', () => {
  const ok = renderReady({ avail: [offer(ADULT)], open: true, needs: [NEED1], status: { [ADULT]: { kind: 'ok', text: 'Invited — they were sent a message and can sign up themselves' } } });
  assert.match(ok.all, /Invited — /);
  const none = renderReady({ avail: [offer(ADULT)], open: true, needs: [NEED1] });
  assert.ok(!/Invited — /.test(none.all), 'a success line is drawn before anything was sent');
});

// spacing: the Care page's "Start care" row must not touch the card above it
test('(D) the Care page puts space above "Start care"', () => {
  const { h } = recorder();
  const scope = {
    h, Frag: 'Frag', React: { useState: (v) => [v, () => {}] },
    window: { useMealsNeeds: () => [], useMealsSlots: () => [], useMealsSkips: () => [] },
    todayISO: () => '2026-10-15', mealsLbl: {}, Icon: function Icon() { return null; },
    SafetyCheckPanel: function SafetyCheckPanel() { return null; }, StewCareRequests: function StewCareRequests() { return null; }, StewReadyToHelp: function StewReadyToHelp() { return null; },
    MealsEmpty: function MealsEmpty() { return null; }, MealsNeedCard: function MealsNeedCard() { return null; }, MealsNeedDetail: function MealsNeedDetail() { return null; }, MealsNeedModal: function MealsNeedModal() { return null; },
  };
  const Comp = new Function('scope', `with (scope) { ${compile(fnBody(MEALS_JSX, 'function DashMeals()', 'DashMeals'), 'DashMeals')} }`)(permissive(scope));
  const row = reach(Comp()).find(n => n.type === 'div' && n.kids.some(k => k && k.type === 'button' && /Start care/.test(btnText(k))));
  assert.ok(row, 'no "Start care" row on the Care page');
  assert.ok(row.props.style.marginTop >= 8, 'the Start care row has no gap above it, so it butts against the Ready to help card');
});

test('(C) the status the row records matches what happened: sent -> ok, waiting -> queued, nothing sent -> err (never ok)', async () => {
  const kinds = async (sendDM) => { const r = renderReady({ avail: [offer(ADULT)], open: true, needs: [NEED1], sendDM }); await inviteBtn(r).props.onClick(); return r.statusLog.map(l => l[ADULT].kind); };
  assert.deepEqual(await kinds(async () => ({ id: 'e' })), ['busy', 'ok']);
  assert.deepEqual(await kinds(async () => ({ id: 'e', _queued: true })), ['busy', 'queued']);
  assert.deepEqual(await kinds(async () => null), ['busy', 'err'], 'a send that did not happen was confirmed');
  assert.deepEqual(await kinds(async () => { throw new Error('x'); }), ['busy', 'err']);
});
