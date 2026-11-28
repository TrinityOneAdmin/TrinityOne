// STEWARD DASHBOARD: noRsvp toggle + recurring selector in group event composer.
// Run: node --test scripts/stew-dashboard-event-rsvp-recur.test.mjs
//
// Point-of-use (CLAUDE.md rule 1): the REAL GroupChatModal is loaded from app/stew-dashboard.jsx via
// eval and DRAWN through a minimal React harness. Tests read the rendered tree — nothing matches text
// in app/*.jsx (rule 3).
//
// Users of what changed (rule 2): GroupChatModal's postEvent passes noRsvp/recur/day/nth to
// window.Steward.publishEvent. The subscriber side (subscribeChurchEvents in fellowship.src.js:7662)
// already reads these fields — no change needed there.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const DASH = read('../app/stew-dashboard.jsx');
const jsx = (src) => transformSync(src, { loader: 'jsx', jsx: 'transform', jsxFactory: 'h', jsxFragment: 'Frag' }).code;

const h = (type, p, ...kids) => ({ type, props: { ...(p || {}), children: kids.flat(Infinity) } });
const expand = (n) => {
  if (Array.isArray(n)) return n.map(expand);
  if (!n || typeof n !== 'object') return n;
  if (typeof n.type === 'function') try { return expand(n.type(n.props)); } catch { return n; }
  return { ...n, props: { ...n.props, children: expand(n.props.children) } };
};
const flat = (n, out = []) => {
  if (Array.isArray(n)) n.forEach(x => flat(x, out));
  else if (n && typeof n === 'object') { out.push(n); flat(n.props.children, out); }
  return out;
};
const text = (n) => (Array.isArray(n) ? n.map(text).join('') : (n && typeof n === 'object') ? text(n.props && n.props.children) : (n == null || n === false ? '' : String(n)));

function buildGroupChat(opts = {}) {
  const store = [];
  let idx = 0;
  const effects = [];
  const React = {
    Fragment: 'Frag',
    useState(init) {
      const i = idx++;
      if (i >= store.length) store.push({ v: typeof init === 'function' ? init() : init });
      const cell = store[i];
      return [cell.v, (nv) => { cell.v = typeof nv === 'function' ? nv(cell.v) : nv; }];
    },
    useEffect(fn) { effects.push(fn); },
    useRef: (v) => ({ current: v }),
    useMemo: (f) => f(),
    useCallback: (f) => f,
  };
  const published = [];
  const noop = () => {};
  const noopHook = () => [];
  const window = {
    useStewardRosters: () => [],
    useStewardMembers: () => [],
    useStewardChurch: () => ({ name: 'Test Church' }),
    useStewardStewards: () => [],
    useStewardGroups: () => [],
    useStewardEvents: () => [],
    useStewardServices: () => [],
    useStewardAdmitted: () => [],
    useStewardBlocked: () => [],
    useStewardJoinPolicy: () => false,
    useStewardIdv: () => 0,
    useStewardConn: () => 0,
    useStewardRelays: () => [],
    useStewardStats: () => ({}),
    useStewardRotas: () => [],
    useStewardRotaSettings: () => ({}),
    useStewardRosters: () => [],
    useStewardFunds: () => [],
    useStewardSafeguard: () => ({}),
    useStewardGuardians: () => [],
    useStewardGuardianRequests: () => [],
    useStewardReseats: () => [],
    useStewardDevotionals: () => [],
    useStewardPlans: () => [],
    useStewardCheckins: () => [],
    useStewardCheckinPermissions: () => ({}),
    useStewardCheckinSessionKeys: () => ({}),
    useStewardClockSkew: () => 0,
    useStewardDirectory: () => [],
    useStewardCategories: () => [],
    useStewardActivity: () => [],
    useStewardNetworks: () => [],
    useStewardPickableMembers: () => [],
    useStewardStewardedChurches: () => [],
    useStewardX: () => [],
    expandEvents: (evs) => evs,
    Steward: {
      publishEvent: async (ev) => { published.push(ev); return { id: 'evt1', ...ev }; },
      removeEvent: async () => {},
      subscribeMsgs: () => noop,
      subscribeGroupEvents: () => noop,
      pubkey: 'pk_church',
      stewardLabels: () => ({}),
      isDelegated: () => false,
      sendGroupMsg: async () => ({}),
      myStewardCaps: () => null,
      identities: () => [],
      setActiveIdentity: noop,
      keysSettingUp: () => false,
      nameKeyReady: () => true,
      churchPub: 'pk_church',
      signerPub: () => 'pk_signer',
      activePub: 'pk_church',
      isViewingNetwork: () => false,
      autoEnrolRelayNet: noop,
      autoSyncHeal: noop,
      retryOwedRelays: noop,
      autoJoinPublicRelaysAuto: noop,
      ...(opts.steward || {}),
    },
    NETWORKS_ENABLED: false,
    matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop }),
    innerWidth: 1200,
    localStorage: { getItem: () => null, setItem: noop },
    location: { href: '', search: '' },
    addEventListener: noop,
    removeEventListener: noop,
    setTimeout,
    clearTimeout,
    navigator: { onLine: true },
  };
  const scope = {
    React, h, Frag: 'Frag', window,
    Icon: () => null,
    SkBadge: () => null,
    SkConfirm: () => null,
    TrinityReplyKit: { tapOffHandler: () => noop },
    useStewDialog: () => ({ current: null }),
    useStewModalOpen: () => {},
    useStewNarrow: () => false,
    useStewKeyRecipients: () => ({ recipients: [], ready: true }),
    CustomEvent: class {},
    document: {
      createElement: () => ({ getContext: () => ({ drawImage() {} }), toDataURL: () => '' }),
      addEventListener: noop, removeEventListener: noop,
      querySelectorAll: () => [], querySelector: () => null,
    },
    localStorage: { getItem: () => null, setItem: noop },
    Image: class { set src(v) {} },
  };
  const names = Object.keys(scope);
  const mod = new Function(...names, jsx(DASH) + '\nreturn { GroupChatModal };')(...names.map(n => scope[n]));
  assert.equal(typeof mod.GroupChatModal, 'function', 'GroupChatModal not exported from stew-dashboard.jsx — re-anchor');

  const group = { id: 'grp1', kind: 'general', accent: '#5577aa', name: 'Test Group', ...(opts.group || {}) };
  const render = () => { idx = 0; return flat(expand(mod.GroupChatModal({ group, onClose: noop }))); };
  return { render, store, published, effects };
}

// ── 1. No RSVP checkbox exists and defaults unchecked ───────────────────────────────────────────
test('GroupChatModal event composer: No RSVP checkbox defaults unchecked', () => {
  const { render, store } = buildGroupChat();
  let nodes = render();
  // composeEvt state must be toggled on to show the form
  // Find the "New event" button and click it
  const newEvtBtn = nodes.find(n => n.type === 'button' && /^\s*Event\s*$/i.test(text(n)));
  assert.ok(newEvtBtn, '"Event" button not found — the group chat event composer is missing');
  newEvtBtn.props.onClick();
  nodes = render();
  const cb = nodes.find(n => n.type === 'input' && n.props.type === 'checkbox' && n.props['aria-label'] === 'No RSVP');
  assert.ok(cb, 'No RSVP checkbox not found in event compose form');
  assert.equal(cb.props.checked, false, 'No RSVP should default unchecked');
});

// ── 2. Toggling noRsvp on and saving passes it to publishEvent ──────────────────────────────────
test('GroupChatModal event composer: toggling noRsvp passes it to publishEvent', async () => {
  const { render, published } = buildGroupChat();
  let nodes = render();
  const newEvtBtn = nodes.find(n => n.type === 'button' && /^\s*Event\s*$/i.test(text(n)));
  assert.ok(newEvtBtn, '"Event" button not found');
  newEvtBtn.props.onClick();
  nodes = render();

  // Fill required fields
  const titleInput = nodes.find(n => n.type === 'input' && n.props.placeholder && /title|name/i.test(n.props.placeholder));
  assert.ok(titleInput, 'Title input not found');
  titleInput.props.onChange({ target: { value: 'Test Event' } });
  nodes = render();
  const dateInput = nodes.find(n => n.type === 'input' && n.props.type === 'date');
  assert.ok(dateInput, 'Date input not found');
  dateInput.props.onChange({ target: { value: '2026-12-15' } });
  nodes = render();

  // Toggle noRsvp on
  const cb = nodes.find(n => n.type === 'input' && n.props.type === 'checkbox' && n.props['aria-label'] === 'No RSVP');
  assert.ok(cb, 'No RSVP checkbox not found');
  cb.props.onChange({ target: { checked: true } });
  nodes = render();

  // Post the event
  const postBtn = nodes.find(n => n.type === 'button' && /post.*event|posting/i.test(text(n)));
  assert.ok(postBtn, 'Post event button not found');
  await postBtn.props.onClick();

  assert.ok(published.length > 0, 'publishEvent was not called');
  assert.equal(published[0].noRsvp, true, 'noRsvp should be true after toggling on');
});

// ── 3. Recurring checkbox exists and defaults unchecked ─────────────────────────────────────────
test('GroupChatModal event composer: Recurring checkbox defaults unchecked', () => {
  const { render } = buildGroupChat();
  let nodes = render();
  const newEvtBtn = nodes.find(n => n.type === 'button' && /^\s*Event\s*$/i.test(text(n)));
  assert.ok(newEvtBtn, '"Event" button not found');
  newEvtBtn.props.onClick();
  nodes = render();
  const cb = nodes.find(n => n.type === 'input' && n.props.type === 'checkbox' && n.props['aria-label'] === 'Recurring');
  assert.ok(cb, 'Recurring checkbox not found in event compose form');
  assert.equal(cb.props.checked, false, 'Recurring should default unchecked');
});

// ── 4. Toggling Recurring shows frequency dropdown with weekly/fortnightly/monthly ──────────────
test('GroupChatModal event composer: toggling Recurring on shows frequency dropdown', () => {
  const { render } = buildGroupChat();
  let nodes = render();
  const newEvtBtn = nodes.find(n => n.type === 'button' && /^\s*Event\s*$/i.test(text(n)));
  assert.ok(newEvtBtn, '"Event" button not found');
  newEvtBtn.props.onClick();
  nodes = render();

  // Before toggling: no select
  let sel = nodes.find(n => n.type === 'select' && n.props['aria-label'] === 'Repeat frequency');
  assert.equal(sel, undefined, 'Frequency dropdown should not be visible when Recurring is off');

  // Toggle Recurring on
  const cb = nodes.find(n => n.type === 'input' && n.props.type === 'checkbox' && n.props['aria-label'] === 'Recurring');
  cb.props.onChange({ target: { checked: true } });
  nodes = render();

  sel = nodes.find(n => n.type === 'select' && n.props['aria-label'] === 'Repeat frequency');
  assert.ok(sel, 'Frequency dropdown should appear when Recurring is toggled on');
  const options = flat(sel).filter(n => n.type === 'option').map(n => n.props.value);
  assert.deepEqual(options, ['weekly', 'fortnightly', 'monthly'], 'dropdown should offer weekly, fortnightly, monthly');
});

// ── 5. Monthly recurring on day 30 passes nth: -1 (not 5) ──────────────────────────────────────
test('GroupChatModal event composer: monthly recurrence on day 30 passes nth -1', async () => {
  const { render, published } = buildGroupChat();
  let nodes = render();
  const newEvtBtn = nodes.find(n => n.type === 'button' && /^\s*Event\s*$/i.test(text(n)));
  assert.ok(newEvtBtn, '"Event" button not found');
  newEvtBtn.props.onClick();
  nodes = render();

  // Fill title + date on day 30
  const titleInput = nodes.find(n => n.type === 'input' && n.props.placeholder && /title|name/i.test(n.props.placeholder));
  titleInput.props.onChange({ target: { value: 'Month-end Event' } });
  nodes = render();
  const dateInput = nodes.find(n => n.type === 'input' && n.props.type === 'date');
  dateInput.props.onChange({ target: { value: '2026-11-30' } });
  nodes = render();

  // Toggle Recurring on and pick Monthly
  const recurCb = nodes.find(n => n.type === 'input' && n.props.type === 'checkbox' && n.props['aria-label'] === 'Recurring');
  recurCb.props.onChange({ target: { checked: true } });
  nodes = render();
  const sel = nodes.find(n => n.type === 'select' && n.props['aria-label'] === 'Repeat frequency');
  sel.props.onChange({ target: { value: 'monthly' } });
  nodes = render();

  // Post
  const postBtn = nodes.find(n => n.type === 'button' && /post event/i.test(text(n)));
  await postBtn.props.onClick();

  assert.ok(published.length > 0, 'publishEvent was not called');
  assert.equal(published[0].recur, 'monthly', 'recur should be "monthly"');
  assert.equal(published[0].nth, -1, 'nth should be -1 for day 30 (last such weekday), not ' + published[0].nth);
  assert.equal(typeof published[0].day, 'number', 'day should be a number');
});

// ── 6. Weekly recurring passes day but no nth ───────────────────────────────────────────────────
test('GroupChatModal event composer: weekly recurrence passes day but no nth', async () => {
  const { render, published } = buildGroupChat();
  let nodes = render();
  const newEvtBtn = nodes.find(n => n.type === 'button' && /^\s*Event\s*$/i.test(text(n)));
  assert.ok(newEvtBtn, '"Event" button not found');
  newEvtBtn.props.onClick();
  nodes = render();

  const titleInput = nodes.find(n => n.type === 'input' && n.props.placeholder && /title|name/i.test(n.props.placeholder));
  titleInput.props.onChange({ target: { value: 'Weekly Event' } });
  nodes = render();
  const dateInput = nodes.find(n => n.type === 'input' && n.props.type === 'date');
  dateInput.props.onChange({ target: { value: '2026-12-10' } });
  nodes = render();

  // Toggle Recurring on (defaults to weekly)
  const recurCb = nodes.find(n => n.type === 'input' && n.props.type === 'checkbox' && n.props['aria-label'] === 'Recurring');
  recurCb.props.onChange({ target: { checked: true } });
  nodes = render();

  const postBtn = nodes.find(n => n.type === 'button' && /post event/i.test(text(n)));
  await postBtn.props.onClick();

  assert.ok(published.length > 0, 'publishEvent was not called');
  assert.equal(published[0].recur, 'weekly', 'recur should be "weekly"');
  assert.equal(typeof published[0].day, 'number', 'day should be a number');
  assert.equal(published[0].nth, undefined, 'nth should be undefined for weekly recurrence');
});
