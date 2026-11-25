// A camera-scanned church QR must open the INSTALLED app (owner decision 2026-11-24). That only happens
// when THREE things agree, and this file runs all three against each other instead of trusting any one:
//
//   1. what the QR actually encodes  — the REAL URL builders, lifted and RUN (never copied):
//        joinLinkFor / inviteUrlFor            app/identity-extras.jsx   (member QRs: friend invite, handoff)
//        Steward.joinUrl / memberInviteUrl     vendor/steward.js         (the SHIPPED console bundle)
//        JoinCard's /join rewrite              app/stew-dashboard.jsx    (the printed JoinCard QR + slips)
//   2. what the manifest claims      — android/app/src/main/AndroidManifest.xml autoVerify filters,
//        parsed and matched with Android's own semantics (hosts × paths union WITHIN a filter);
//   3. what the app then does        — safeQuery, lifted out of app/app.jsx and RUN (a claimed link the
//        handler refuses opens the app and silently throws the invite away — the worst outcome there is).
//
// Run:  node --test scripts/qr-links-open-the-app.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const MANIFEST = readFileSync(new URL('../android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8');
const EXTRAS = readFileSync(new URL('../app/identity-extras.jsx', import.meta.url), 'utf8');
const VENDOR = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const STEW = readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8');
const APP = readFileSync(new URL('../app/app.jsx', import.meta.url), 'utf8');

// ── lift helpers ────────────────────────────────────────────────────────────────────────────────────────
function slice(src, anchor, what) {
  const at = src.indexOf(anchor);
  assert.notEqual(at, -1, what + ' is gone or renamed (anchor: ' + anchor + ')');
  assert.equal(src.indexOf(anchor, at + 1), -1, what + ': anchor is not unique — scope the slice before trusting it');
  let depth = 0, end = -1;
  for (let i = src.indexOf('{', at); i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) { end = i + 1; break; }
  }
  assert.notEqual(end, -1, what + ': unbalanced braces in slice');
  return src.slice(at, end);
}
function sliceLine(src, anchor, what) {
  const at = src.indexOf(anchor);
  assert.notEqual(at, -1, what + ' is gone or renamed (anchor: ' + anchor + ')');
  assert.equal(src.indexOf(anchor, at + 1), -1, what + ': anchor is not unique');
  return src.slice(at, src.indexOf('\n', at));
}

// 1a. member-side builders (app/identity-extras.jsx) — lifted and run; `location` is a parameter so the
// same code runs as the APK (no location → canonical base) and as a self-hosted web app (public origin).
function memberBuilders(location) {
  const src = ['function _inviteBase() {', 'function _inviteRelay() {', 'function _inviteChurchNp(ctx) {',
               'function joinLinkFor(ctx) {', 'function inviteUrlFor(mnemonic, ctx) {']
    .map(a => slice(EXTRAS, a, a)).join('\n');
  return new Function('window', 'location', src + '\nreturn { joinLinkFor, inviteUrlFor };')({}, location);
}

// 1b. console builders — from the SHIPPED bundle (vendor/steward.js), not the source, so a build that
// drops or mangles them fails here (tests must drive shipped code).
function consoleBuilders(location) {
  const src = 'const S = {\n' + slice(VENDOR, 'joinUrl() {', 'Steward.joinUrl')
            + ',\n' + slice(VENDOR, 'memberInviteUrl(mnemonic) {', 'Steward.memberInviteUrl') + '\n};';
  const win = { Steward: { npub: 'npub1testchurch' } };
  const made = new Function('window', 'location', 'ownRelay', 'ownIsLoopback', 'selfPublicRelay', 'selfRelayName',
    src + '\nObject.assign(window.Steward, S); return S;')(
    win, location, () => 'wss://relay.example.org', () => false, () => '', () => '');
  return { joinUrl: () => made.joinUrl.call(win.Steward), memberInviteUrl: (m) => made.memberInviteUrl.call(win.Steward, m), win };
}

// 1c. the JoinCard rewrite (app/stew-dashboard.jsx) — the one line that turns the direct link into the
// printed /join QR; extracted and RUN so `false &&` sabotage changes the result, not just the text.
function joinCardUrl(direct, church) {
  const line = sliceLine(STEW, 'const url = direct ?', 'JoinCard /join rewrite');
  return new Function('direct', 'church', line + '\nreturn url;')(direct, church);
}

// 2. the manifest's claims, matched the way Android matches them: within ONE intent-filter the hosts and
// paths each union; a URL is claimed when some autoVerify filter matches host AND one of its path specs.
function manifestFilters() {
  const filters = [...MANIFEST.matchAll(/<intent-filter android:autoVerify="true">([\s\S]*?)<\/intent-filter>/g)]
    .map(m => [...m[1].matchAll(/<data\s+([^>]*?)\/>/g)].map(d => {
      const attr = n => { const r = d[1].match(new RegExp('android:' + n + '="([^"]*)"')); return r ? r[1] : null; };
      return { scheme: attr('scheme'), host: attr('host'), pathPrefix: attr('pathPrefix'), path: attr('path') };
    }).filter(d => d.scheme === 'https'))
    .filter(d => d.length);
  assert.ok(filters.length >= 1, 'no https autoVerify intent-filter in the manifest — App Links are gone');
  return filters;
}
function claimed(urlStr) {
  let u; try { u = new URL(urlStr); } catch (e) { return false; }
  if (u.protocol !== 'https:') return false;
  return manifestFilters().some(datas => {
    if (!datas.some(d => d.host === u.hostname)) return false;
    const specs = datas.filter(d => d.path != null || d.pathPrefix != null);
    if (!specs.length) return true;
    return specs.some(d => d.path != null ? u.pathname === d.path : u.pathname.startsWith(d.pathPrefix));
  });
}

// 3. the REAL in-app handler, same lift as scripts/applink-guard.test.mjs.
function realSafeQuery() {
  const keysAt = APP.indexOf("const JOIN_KEYS = [");
  assert.notEqual(keysAt, -1, 'JOIN_KEYS missing — the app-link handler is gone');
  const start = APP.indexOf('const safeQuery = (url) => {', keysAt);
  assert.notEqual(start, -1, 'safeQuery missing');
  let depth = 0, end = -1;
  for (let i = APP.indexOf('{', start); i < APP.length; i++) {
    const c = APP[i];
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) { end = i + 1; break; }
  }
  const hostsAt = APP.indexOf('const APP_HOSTS', keysAt);
  assert.notEqual(hostsAt, -1, 'APP_HOSTS missing');
  return new Function(APP.slice(keysAt, APP.indexOf('\n', keysAt)) + '\n'
    + APP.slice(hostsAt, APP.indexOf('\n', hostsAt)) + '\n'
    + APP.slice(start, end) + '; return safeQuery;')();
}

const safeQuery = realSafeQuery();
const CTX = { church: { npub: 'npub1testchurch' } };
const SEED = 'alpha beta gamma delta echo foxtrot golf hotel india juliet kilo lima';

function opensInApp(url, what) {
  assert.ok(claimed(url), what + ': the manifest does not claim ' + url + ' — this QR keeps opening the browser');
  const r = safeQuery(url);
  assert.ok(r, what + ': the manifest claims ' + url + ' but safeQuery refuses it — the app would open and silently drop the invite');
  return r;
}

test('every QR the product prints opens the installed app with the invite intact', () => {
  // member: invite a friend (app/screens-chat.jsx QR)
  const friend = memberBuilders(undefined).joinLinkFor(CTX);
  const rf = opensInApp(friend, 'friend invite');
  assert.equal(new URLSearchParams(rf.q).get('follow'), 'npub1testchurch', 'the church must survive the trip');

  // member: guardian→child handoff (app/identity.jsx QR) — seed in the fragment
  const handoff = memberBuilders(undefined).inviteUrlFor(SEED, CTX);
  const rh = opensInApp(handoff, 'guardian handoff');
  assert.equal(rh.frag, '#invite=' + encodeURIComponent(SEED), 'the handed account must survive the trip');

  // console: direct join link, and the printed JoinCard QR (/join rewrite + &c=)
  const con = consoleBuilders(undefined);
  const direct = con.joinUrl();
  opensInApp(direct, 'console direct link');
  const card = joinCardUrl(direct, { name: 'St Marys' });
  const rc = opensInApp(card, 'JoinCard QR');
  assert.ok(card.includes('/join?follow='), 'the JoinCard QR is the smart /join landing');
  assert.equal(new URLSearchParams(rc.q).get('c'), 'St Marys', 'the church name must survive the trip');

  // console: Set up accounts member slip — seed in the fragment on the root path
  const slip = con.memberInviteUrl(SEED);
  const rs = opensInApp(slip, 'member slip');
  assert.equal(rs.frag, '#invite=' + encodeURIComponent(SEED), 'the slip’s handed account must survive the trip');

  // console: the plain "get the app" QR (app/stew-dashboard.jsx dlQr). A camera normalises the bare origin
  // to its root path before firing the VIEW intent; the raw no-path form is scanner-dependent, so the claim
  // is asserted on the normalised form.
  const dl = sliceLine(STEW, "const dlQr = window.Steward.qrSVG ? window.Steward.qrSVG('https://", 'download-the-app QR')
    .match(/'(https:\/\/[^']+)'/)[1];
  assert.ok(claimed(new URL(dl).href), 'download QR: the manifest does not claim ' + dl);
});

test('a self-hosted church’s QR is NOT claimed — it keeps the browser path, by design', () => {
  const selfLoc = { origin: 'https://stmarys.example.org' };
  const selfFriend = memberBuilders(selfLoc).joinLinkFor(CTX);
  assert.ok(selfFriend.startsWith('https://stmarys.example.org/'), 'self-hosted builder must use its own origin');
  assert.equal(claimed(selfFriend), false, 'the manifest cannot know a church’s domain at build time (gateway.mjs assetlinks note) — claiming it would be a lie Android then disproves');
  assert.equal(safeQuery(selfFriend), null, 'and the handler must not accept hosts the manifest does not claim');
  const selfCon = consoleBuilders(selfLoc).joinUrl();
  assert.ok(selfCon.startsWith('https://stmarys.example.org/'));
  assert.equal(claimed(selfCon), false);
});

test('the marketing apex: /join is claimed (the web console prints such QRs), its root is not', () => {
  assert.ok(claimed('https://trinityone.church/join?follow=npub1abc'),
    'steward.html runs on the Pages deploy and joinUrl() builds from a public origin — those printed QRs must open the app');
  assert.equal(claimed('https://trinityone.church/?follow=npub1abc'), false,
    'the apex root is the marketing site — claiming it swallows every link to the sales page');
  assert.equal(claimed('https://trinityone.church/'), false);
});

test('manifest and handler agree, shape for shape (neither side can widen alone)', () => {
  for (const u of [
    'https://app.trinityone.church/?follow=npub1abc',
    'https://app.trinityone.church/join?follow=npub1abc',
    'https://app.trinityone.church/join.html?follow=npub1abc',
    'https://trinityone.church/join?follow=npub1abc',
    'https://trinityone.church/?follow=npub1abc',
    'https://app.trinityone.church/install?follow=npub1abc',
    'https://evil.tld/join?follow=npub1abc',
  ]) {
    assert.equal(claimed(u), safeQuery(u) !== null,
      'manifest and safeQuery disagree on ' + u + ' — a claimed-but-refused link opens the app and drops the invite; an accepted-but-unclaimed one is dead code waiting to mislead');
  }
});
