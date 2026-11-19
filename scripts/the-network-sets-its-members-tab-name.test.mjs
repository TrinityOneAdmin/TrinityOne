// THE NETWORK STEWARD SETS THE SHORT NAME ITS MEMBERS SEE AS THE TAB TITLE (Networks member step 1; owner 2026-11-19).
//   Run: node --test scripts/the-network-sets-its-members-tab-name.test.mjs
//
// Two halves, both run, neither reads source text (rule 3):
//   1. POINT OF USE, console: the REAL DashSettings (app/stew-dashboard.jsx, compiled with esbuild, drawn through render-jsx-screen.mjs's
//      miniature React) on its identity page. In the NETWORK view it has a "Short name" field; typing caps at 16 characters; Save hands
//      Steward.publishProfile exactly { short_name }. In the CHURCH view the field is absent.
//   2. The SHIPPED publishProfile, lifted out of vendor/steward.js and run: the kind-0 it signs carries short_name, capped at 16, and a
//      church that never set one gets no short_name key at all (its kind-0 is byte-for-byte the shape it was).
// The member app's reading of it (signed by the network key only, capped again) is proved in
// a-network-reaches-members-only-through-whats-happening.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileScreen, miniReact, find } from './render-jsx-screen.mjs';

const JS = compileScreen('app/stew-dashboard.jsx');
const STEWARD = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');

// the shipped cap, lifted (so the console field and the kind-0 are proved against the real rule)
function topFn(bundle, name) {
  const m = new RegExp('\\n  function ' + name + '\\([\\s\\S]*?\\n  \\}\\n').exec(bundle);
  assert.ok(m, `could not lift ${name} from vendor/steward.js -- re-anchor this test, do not delete it`);
  return m[0];
}
const netShortName = new Function(topFn(STEWARD, 'netShortName') + '\nreturn netShortName;')();

function consoleWith(React, { network, published, short_name = '' }) {
  const win = {
    NETWORKS_ENABLED: true,
    useStewardChurch: () => ({ name: network ? 'Bed, Bath & Regions Beyond' : 'Grace Church', npub: network ? 'npub1net' : 'npub1grace', isNetwork: network, features: {}, rules: {}, short_name }),
    useStewardIdv: () => 0,
    useStewardRelays: () => [], useStewardNetworks: () => [], useStewardRosters: () => [], useStewardStewardedChurches: () => [],
    useStewardMembers: () => [], useStewardGroups: () => [], useStewardAdmitted: () => [], useStewardJoinPolicy: () => false,
    useStewardStats: () => ({}), useStewardActivity: () => [], useStewardRequests: () => [], usePendingStewards: () => [],
    Steward: {
      isDelegated: () => false, hasKey: true, hasPinLock: () => false, whereChurchLives: () => 'community',
      relays: () => [], relayStatus: () => ({}), networks: () => [], netShortName,
      publishProfile: (meta) => { published.push(meta); return Promise.resolve({ id: 'x' }); },
      npub: 'npub1grace', becomeStewardPayload: () => 'x', qrSVG: () => '', joinUrl: () => 'https://app.example/join#x', inviteCode: () => 'ABC123', joinCode: () => 'ABC123',
      ownRelay: () => '', backupState: async () => ({ boxes: 1, online: 1, syncOn: false }),
      addRelay: () => '', removeRelay: () => {}, rememberRelayName: () => {}, selfRegister: async () => ({}),
      ownedNetworks: () => [], subscribeNetworkPosts: () => () => {}, networkStatus: () => ({}), syncNetworkKeys: () => {},
    },
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; }, innerWidth: 1200, isSecureContext: true,
  };
  const store = new Map();
  const localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : (/\.setgroups\./.test(k) ? '[]' : null)), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  win.localStorage = localStorage;
  const Stub = (n) => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };
  const globals = {
    React, window: win, location: { host: 'relay.example', hostname: 'relay.example' },
    navigator: { userAgent: '', clipboard: { writeText: () => Promise.resolve() } },
    document: { addEventListener() {}, removeEventListener() {} }, localStorage, setTimeout, clearTimeout, setInterval, clearInterval, console,
    fetch: async () => ({ ok: false, json: async () => ({}) }),
    CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
    Icon: Stub('Icon'), Halo: Stub('Halo'), SkBadge: Stub('SkBadge'), SkKey: Stub('SkKey'), SkQR: Stub('SkQR'), SkPill: Stub('SkPill'),
    SK_TINT: { clay: { bg: 'a', fg: 'b' }, sage: { bg: 'a', fg: 'b' }, gold: { bg: 'a', fg: 'b' }, ink: { bg: 'a', fg: 'b' } },
    DashMealsPanel: Stub('DashMealsPanel'), DashMannaPanel: Stub('DashMannaPanel'), StewVersion: Stub('StewVersion'),
    DismissibleNote: function DismissibleNote(p) { return p.children; }, ConsoleChrome: function ConsoleChrome(p) { return p.children; },
    StewHelpButton: Stub('StewHelpButton'), StewHelpLink: Stub('StewHelpLink'),
    WizMeetings: Stub('WizMeetings'), _wizMeetingId: () => 'evt1', useStewDialog: () => ({ current: null }), churchHandle: () => 'grace',
    stewCapState: () => ({ allowed: false }),
  };
  const names = Object.keys(globals);
  return new Function(...names, JS + '\nreturn { DashSettings };')(...names.map(k => globals[k]));
}
function identityPage({ network, short_name } = {}) {
  const { React, draw } = miniReact();
  const published = [];
  const mod = consoleWith(React, { network, published, short_name });
  const render = () => draw(mod.DashSettings, { initialSection: 'identity', onSectionConsumed() {} });
  render();
  return { render, published };
}
const field = (t) => find(t, n => n.type === 'input' && n.props['data-testid'] === 'net-short-name');

test('NETWORK VIEW: Network identity has a "Short name" field; the CHURCH view does not', () => {
  const net = identityPage({ network: true });
  assert.equal(field(net.render()).length, 1, 'the network identity page has no short-name field');
  const ch = identityPage({ network: false });
  assert.equal(field(ch.render()).length, 0, 'a church\'s identity page offers a network short name');
});

test('typing caps at 16 characters, and Save publishes exactly { short_name } in the network\'s profile', async () => {
  const p = identityPage({ network: true });
  let t = p.render();
  field(t)[0].props.onChange({ target: { value: 'Bed Bath and Regions Beyond' } });
  t = p.render();
  assert.equal(field(t)[0].props.value, 'Bed Bath and Reg', 'the field did not cap at 16 characters');
  const b = find(t, n => n.type === 'button' && (n.kids || []).some(k => k === 'Save'));
  assert.equal(b.length, 1, 're-anchor: no Save button beside the short-name field');
  assert.ok(!b[0].props.disabled, 'Save is disabled after a change');
  await b[0].props.onClick();
  assert.deepEqual(p.published, [{ short_name: 'Bed Bath and Reg' }], 'Save did not publish the capped short name');
});

test('the saved short name is shown, and Save stays off until it is changed', () => {
  const p = identityPage({ network: true, short_name: 'BB&RB' });
  const t = p.render();
  assert.equal(field(t)[0].props.value, 'BB&RB');
  const b = find(t, n => n.type === 'button' && (n.kids || []).some(k => k === 'Save'));
  assert.ok(b[0].props.disabled, 'Save is enabled with nothing changed');
});

// ── the SHIPPED publishProfile ──────────────────────────────────────────────────────────────────────────────────────────────────────────
function grabMethod(src, sig) {
  const at = src.indexOf(sig);
  assert.notEqual(at, -1, sig + ' is gone from vendor/steward.js -- re-anchor this test');
  let depth = 0, q = '';
  for (let i = src.indexOf('{', at); i < src.length; i++) {
    const c = src[i], prev = src[i - 1];
    if (q) { if (c === q && prev !== '\\') q = ''; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i === -1) break; continue; }
    if (c === '/' && src[i + 1] !== '/' && src[i + 1] !== '*' && /[(,=:!&|?{};]\s*$/.test(src.slice(Math.max(0, i - 3), i))) {   // a regex literal
      for (i++; i < src.length && src[i] !== '/'; i++) if (src[i] === '\\') i++;
      continue;
    }
    if (c === '{') depth++; else if (c === '}' && --depth === 0) return src.slice(at, i + 1);
  }
  assert.fail('could not find the end of ' + sig);
}
function shippedPublishProfile(lastProfile) {
  const body = grabMethod(STEWARD, '    publishProfile(meta) {');
  const FE = (body.match(/\bfinalizeEvent\d*\b/) || [])[0];
  assert.ok(FE, 'publishProfile no longer signs an event -- re-anchor this test');
  const out = [];
  const f = new Function('sk', 'actingChurch', '_profileLoaded', 'lastProfileIn', '_profileSettle', 'cleanNip05', 'CANONICAL_RELAY', 'publish', FE, '_monotonic', 'now', 'netShortName', 'window', 'CustomEvent',
    'let lastProfile = lastProfileIn;\nconst api = {\n' + body + '\n};\nreturn api.publishProfile.bind(api);');
  const run = f(new Uint8Array(32), '', true, lastProfile, () => Promise.resolve(), (n) => n || '', '', (e) => { out.push(e); return Promise.resolve(e); }, (t) => t, (t) => t, () => 1700000000, netShortName, { dispatchEvent() {} }, class {});
  return { run, out };
}

test('SHIPPED publishProfile: the kind-0 carries short_name, capped at 16; a profile with none gets no short_name key', async () => {
  const net = shippedPublishProfile({ name: 'Bed, Bath & Regions Beyond' });
  await net.run({ short_name: '  Bed Bath and Regions Beyond  ' });
  assert.equal(net.out.length, 1, 'publishProfile published nothing');
  assert.equal(net.out[0].kind, 0);
  const c = JSON.parse(net.out[0].content);
  assert.equal(c.short_name, 'Bed Bath and Reg', 'the kind-0 does not carry the capped short_name');
  assert.equal(c.name, 'Bed, Bath & Regions Beyond', 'setting the short name lost the network\'s name');
  const ch = shippedPublishProfile({ name: 'Grace Church' });
  await ch.run({ name: 'Grace Church' });
  assert.ok(!('short_name' in JSON.parse(ch.out[0].content)), 'a church that never set a short name now publishes a short_name key');
});
