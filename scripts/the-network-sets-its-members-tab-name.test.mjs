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

function consoleWith(React, { network, published, short_name = '', RegExpImpl }) {
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
  if (RegExpImpl) globals.RegExp = RegExpImpl;
  const names = Object.keys(globals);
  return new Function(...names, JS + '\nreturn { DashSettings };')(...names.map(k => globals[k]));
}
function identityPage({ network, short_name, RegExpImpl } = {}) {
  const { React, draw } = miniReact();
  const published = [];
  const mod = consoleWith(React, { network, published, short_name, RegExpImpl });
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

// ── audit of 590fa968 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('SHIPPED netShortName: drops zero-width / bidi characters, keeps emoji joiners, and caps by grapheme', () => {
  assert.equal(netShortName('‮BB​&⁦RB﻿‎'), 'BB&RB');
  const fam = '\u{1F468}‍\u{1F469}‍\u{1F467}';
  // CHANGED ON PURPOSE (audit of 131b7e4f): the 64-code-unit ceiling now applies as well; a family emoji is 8 units, so 8 whole families fit.
  assert.equal(netShortName(fam.repeat(20)), fam.repeat(8), 'a family emoji was split or the code-unit ceiling was ignored');
  assert.equal(netShortName('  Bed   Bath  '), 'Bed Bath');
});

test('SHIPPED netShortName: controls, soft hyphen, U+034F, fillers, variation selectors, tag characters out; U+FE0F kept; zalgo clipped at 64 code units', () => {
  assert.equal(netShortName('B\u00ADB\u034F\u061C&\u180ER\u115F\u1160\u3164\uFFA0B\u{E0041}\u0001\u0085\uFE00\uFE0E'), 'BB&RB');
  assert.equal(netShortName('\u2764\uFE0F'), '\u2764\uFE0F', 'the emoji selector was stripped');
  const g = 'Z' + '\u0301'.repeat(30);
  assert.equal(netShortName(g.repeat(5)), g.repeat(2), 'a zalgo name was not clipped at 64 code units');
});

test('the field keeps a space typed between two words (it is trimmed on Save, not per keystroke), and strips a bidi override as typed', async () => {
  const p = identityPage({ network: true });
  let t = p.render();
  field(t)[0].props.onChange({ target: { value: 'Bed ' } });
  t = p.render();
  assert.equal(field(t)[0].props.value, 'Bed ', 'the space after a word was eaten as it was typed');
  field(t)[0].props.onChange({ target: { value: '‮Bed Bath ' } });
  t = p.render();
  assert.equal(field(t)[0].props.value, 'Bed Bath ');
  await find(t, n => n.type === 'button' && (n.kids || []).some(k => k === 'Save'))[0].props.onClick();
  assert.deepEqual(p.published, [{ short_name: 'Bed Bath' }]);
});

// ── audit of 79bf25fe: round 2 of the character list, and the console field's own cleaning (`live`) ──────────────────────────────────────
const ENG = '\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}', SCT = '\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}', WLS = '\u{1F3F4}\u{E0067}\u{E0062}\u{E0077}\u{E006C}\u{E0073}\u{E007F}';
const KEEP = ['café é', 'שלום', 'مرحبا', '\u{1F44D}\u{1F3FD}', '\u{1F468}‍\u{1F469}‍\u{1F467}', '1️⃣', '❤️', ENG, SCT, WLS, 'a‌b'];
const STRIP = [['a⠀b', 'ab'], ['a⁪b⁯c', 'abc'], ['a᠋b᠍c', 'abc'], ['a឴b឵c', 'abc'], ['a￹b￻c', 'abc'], ['a\u{1D173}b\u{1D17A}c', 'abc'], ['a\u{13430}b\u{1343F}c', 'abc'],
  ['a\u{E0041}b', 'ab'], ['a\u{E007F}b', 'ab'], ['\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}', '\u{1F3F4}'], ['x\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}y', 'xy'], ['\u{1F3F4}\u{E0068}\u{E0065}\u{E006C}\u{E006C}\u{E006F}\u{E007F}', '\u{1F3F4}'], ['\u{1F3F4}\u{E0067}\u{E0062}\u{E0078}\u{E0079}\u{E007A}\u{E007F}', '\u{1F3F4}'], ['\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E0078}\u{E007F}', '\u{1F3F4}'], ['B\u00ADB\u034F\u061C&\u180ER\u115F\u1160\u3164\uFFA0B\u{E0041}\u0001\u0085\uFE00\uFE0E\u202E\u200B\uFEFF', 'BB&RB'], ['a\u{110BD}\u{110CD}b\u{1BCA0}c\u0600d\u2065e\uFFF0f', 'abcdef']];

test('SHIPPED netShortName: keeps accents, Hebrew, Arabic, skin tone, family, keycap, heart and the England/Scotland/Wales flags; drops the newly-found invisibles and stray tags', () => {
  for (const k of KEEP) assert.equal(netShortName(k), k, 'wrongly changed: ' + JSON.stringify(k));
  for (const [raw, want] of STRIP) assert.equal(netShortName(raw), want, 'not cleaned: ' + JSON.stringify(raw));
  assert.equal(netShortName('⠀⁪\u{E0041}'), '', 'a name that cleans to nothing is not empty (the caller falls back on empty)');
});

test('CONSOLE FIELD (point of use): typing keeps the flags and joiners, drops the invisibles, and caps at 16 characters AND 64 code units', () => {
  const p = identityPage({ network: true });
  const typed = (v) => { field(p.render())[0].props.onChange({ target: { value: v } }); return field(p.render())[0].props.value; };
  for (const k of KEEP) assert.equal(typed(k), k, 'the field changed: ' + JSON.stringify(k));
  for (const [raw, want] of STRIP) assert.equal(typed(raw), want, 'the field did not clean: ' + JSON.stringify(raw));
  const fam = '\u{1F468}‍\u{1F469}‍\u{1F467}';   // one grapheme, 8 code units
  assert.equal(typed(fam.repeat(20)), fam.repeat(8), 'the field did not apply the 64-code-unit ceiling (8 families), or split a family');
  const z = 'Z' + '́'.repeat(30);
  assert.equal(typed(z.repeat(5)), z.repeat(2), 'the field did not clip a zalgo name at 64 code units');
  assert.equal(typed('Bed Bath and Regions Beyond'), 'Bed Bath and Reg', 'the 16-grapheme cap is gone');
});

// ── audit of a21dad23: parse safety, the fallback path, and flag smuggling ──────────────────────────────────────────────────────────────────
// A RegExp that REFUSES a Unicode property escape, as a WebView older than Chrome 64 does when the source is handed to it at run time. Every
// construction is recorded so a test can prove the fallback (no u flag) is the regex that actually ran.
function noPropertyEscapes() {
  const calls = [];
  const impl = new Proxy(RegExp, { construct(t, args, nt) {
    const src = String(args[0]), flags = String(args[1] || '');
    calls.push({ flags, hasP: /\\[pP]\{/.test(src) });
    if (/\\[pP]\{/.test(src)) throw new SyntaxError('Invalid regular expression: invalid property name');
    return Reflect.construct(t, args, nt);
  } });
  return { impl, calls };
}
const liftWith = (RegExpImpl) => new Function('RegExp', topFn(STEWARD, 'netShortName') + '\nreturn netShortName;')(RegExpImpl);

test('SHIPPED netShortName, FALLBACK (property escapes refused): the same keep list is kept, the same attack list is stripped, and the regex built has no u flag', () => {
  const { impl, calls } = noPropertyEscapes();
  const fb = liftWith(impl);
  for (const k of KEEP) assert.equal(fb(k), k, 'fallback wrongly changed: ' + JSON.stringify(k));
  for (const [raw, want] of STRIP) assert.equal(fb(raw), want, 'fallback did not clean: ' + JSON.stringify(raw));
  assert.equal(fb('B\u00ADB\u034F\u061C&\u180ER\u115F\u1160\u3164\uFFA0B\u{E0041}\u0001\u0085\uFE00\uFE0E\u202E\u200B\uFEFF'), 'BB&RB');
  assert.equal(fb('\u2764\uFE0F'), '\u2764\uFE0F');
  assert.deepEqual(calls.map(c => c.flags), ['gu', 'g'], 'expected exactly one refused "gu" attempt then one "g" fallback, built once (memoised): ' + JSON.stringify(calls));
  assert.ok(calls[0].hasP && !calls[1].hasP, 'the fallback source still contains a property escape');
});

test('CONSOLE FIELD (point of use), FALLBACK: with property escapes refused, typing still keeps the flags/joiners and drops the invisibles', () => {
  const { impl, calls } = noPropertyEscapes();
  const p = identityPage({ network: true, RegExpImpl: impl });
  const typed = (v) => { field(p.render())[0].props.onChange({ target: { value: v } }); return field(p.render())[0].props.value; };
  for (const k of KEEP) assert.equal(typed(k), k, 'the field (fallback) changed: ' + JSON.stringify(k));
  for (const [raw, want] of STRIP) assert.equal(typed(raw), want, 'the field (fallback) did not clean: ' + JSON.stringify(raw));
  assert.ok(calls.some(c => c.flags === 'gu' && c.hasP) && calls.some(c => c.flags === 'g' && !c.hasP), 'the console field never went through the refused-then-fallback construction: ' + JSON.stringify(calls));
});

test('FLAG SMUGGLING: only England, Scotland and Wales survive as flags; a flag-shaped run carrying any other letters loses its tag characters (the black flag stays)', () => {
  const tags = (str) => Array.from(str, ch => String.fromCodePoint(0xE0000 + ch.charCodeAt(0))).join('') + '\u{E007F}';
  const flag = (str) => '\u{1F3F4}' + tags(str);
  for (const ok of ['gbeng', 'gbsct', 'gbwls']) assert.equal(netShortName(flag(ok)), flag(ok), ok + ' was stripped');
  for (const bad of ['hello', 'gbxyz', 'gbengx', 'gbe', 'us', 'gbengland', 'ignore all prior'.replace(/ /g, '')]) assert.equal(netShortName('A' + flag(bad) + 'B'), 'A\u{1F3F4}B', 'a flag-shaped run carrying "' + bad + '" kept its payload');
});

// ── the shipped BUILT output must not hold a regex LITERAL with a Unicode property escape ─────────────────────────────────────────────────
// The packaged builds run app/*.jsx through esbuild with no target, which leaves a regex literal as it is; one the engine cannot parse is a
// SyntaxError that blanks the whole file. So scan the COMPILED text (not the .jsx): esbuild drops comments, and a property escape that is
// legitimately inside a string passed to new RegExp has its backslash doubled in the source, which a literal does not. A single backslash
// before p{ / P{ is therefore a literal (or a lone escape in a string we did not write). vendor/steward.js is already a bundle: scanned as is.
const propertyEscapeLiteral = (js) => { const m = /(^|[^\\])\\[pP]\{[A-Za-z_=]+}/.exec(js); return m ? m[0] : null; };
test('the scanner itself flags a literal and passes a string (positive and negative control)', () => {
  assert.ok(propertyEscapeLiteral('x.replace(/[\\p{Cf}]/gu, "")'), 'the scanner missed a regex literal with a property escape');
  assert.ok(propertyEscapeLiteral('x = /\\P{L}/u'));
  assert.equal(propertyEscapeLiteral('new RegExp("\\\\p{Cf}", "gu")'), null, 'the scanner flagged a doubled backslash inside a string');
});
test('BUILT output has no regex literal with a Unicode property escape: esbuild(app/app.jsx), esbuild(app/stew-dashboard.jsx), vendor/steward.js', () => {
  for (const jsx of ['app/app.jsx', 'app/stew-dashboard.jsx']) {
    const out = compileScreen(jsx);
    assert.ok(out.length > 10000, 're-anchor: ' + jsx + ' did not compile to a real bundle');
    assert.equal(propertyEscapeLiteral(out), null, jsx + ' still ships a regex literal with a property escape: a WebView older than Chrome 64 would fail to parse the whole file');
  }
  assert.equal(propertyEscapeLiteral(STEWARD), null, 'vendor/steward.js still ships a regex literal with a property escape');
});

test('SHIPPED netShortName: the fallback (no property escapes) and the primary regex agree on EVERY code point, alone and inside text', () => {
  const primary = liftWith(RegExp), { impl } = noPropertyEscapes(), fb = liftWith(impl);
  const diffs = [];
  for (let cp = 0; cp <= 0x10FFFF; cp++) {
    if (cp >= 0xD800 && cp <= 0xDFFF) continue;
    const s = 'a' + String.fromCodePoint(cp) + 'b';
    if (primary(s) !== fb(s)) diffs.push(cp.toString(16));
  }
  assert.deepEqual(diffs.slice(0, 20), [], 'the fallback differs from the primary regex at code points ' + diffs.slice(0, 20).join(' '));
});

// ── the name-cleaning regex exists in THREE shipped copies; all three must build the same two regexes ───────────────────────────────────────
// app/app.jsx netClipRe, app/stew-dashboard.jsx netFieldRe, vendor/steward.js netShortName (inside it). Only the steward copy's fallback is swept
// over every code point above, so an edit to another copy's fallback went unnoticed. Each copy is LIFTED from its shipped text (the .jsx through
// esbuild, the bundle as is) and RUN against a RegExp that records every source it is handed and refuses property escapes, so both the primary and
// the fallback source are captured. Nothing here matches text in app/*.jsx.
function regexSourcesBuiltBy(code, fnName, call) {
  const seen = [];
  const impl = new Proxy(RegExp, { construct(t, args, nt) {
    const src = String(args[0]), flags = String(args[1] || '');
    // only the name-cleaning regexes (they hold the flag alternation); other RegExps the function may build are none today
    seen.push({ src, flags });
    if (/\\[pP]\{/.test(src)) throw new SyntaxError('Invalid regular expression: invalid property name');
    return Reflect.construct(t, args, nt);
  } });
  // first run with property escapes ALLOWED to capture the primary, then refused to capture the fallback
  const run = (RegExpImpl) => new Function('RegExp', code + '\n' + call)(RegExpImpl);
  const primary = []; const allow = new Proxy(RegExp, { construct(t, args, nt) { primary.push({ src: String(args[0]), flags: String(args[1] || '') }); return Reflect.construct(t, args, nt); } });
  run(allow); run(impl);
  return { primary: primary[0], fallback: seen[1], nPrimary: primary.length, nSeen: seen.length };
}
const liftCompiled = (jsx, name) => {
  const out = compileScreen(jsx);
  const m = new RegExp('\\nfunction ' + name + '\\(\\) \\{[\\s\\S]*?\\n\\}\\n').exec(out);
  assert.ok(m, 'could not lift ' + name + ' from ' + jsx + ' -- re-anchor this test, do not delete it');
  return m[0];
};
test('the three shipped copies of the name-cleaning regex (app.jsx, stew-dashboard.jsx, vendor/steward.js) build IDENTICAL primary and fallback regexes', () => {
  const copies = {
    'app/app.jsx netClipRe': regexSourcesBuiltBy(liftCompiled('app/app.jsx', 'netClipRe'), 'netClipRe', 'return netClipRe();'),
    'app/stew-dashboard.jsx netFieldRe': regexSourcesBuiltBy(liftCompiled('app/stew-dashboard.jsx', 'netFieldRe'), 'netFieldRe', 'return netFieldRe();'),
    'vendor/steward.js netShortName': regexSourcesBuiltBy(topFn(STEWARD, 'netShortName'), 'netShortName', 'return netShortName("x");'),
  };
  const names = Object.keys(copies);
  for (const n of names) {
    const c = copies[n];
    assert.ok(c.primary && c.fallback, n + ': did not capture both a primary and a fallback construction');
    assert.equal(c.primary.flags, 'gu', n + ' primary flags'); assert.equal(c.fallback.flags, 'g', n + ' fallback flags');
    assert.ok(/\\\\p\{|\\p\{/.test(c.primary.src) && !/\\[pP]\{/.test(c.fallback.src), n + ': primary must use property escapes, fallback must not');
  }
  for (const n of names.slice(1)) {
    assert.equal(copies[n].primary.src, copies[names[0]].primary.src, n + ' PRIMARY regex differs from ' + names[0]);
    assert.equal(copies[n].fallback.src, copies[names[0]].fallback.src, n + ' FALLBACK regex differs from ' + names[0]);
  }
});
