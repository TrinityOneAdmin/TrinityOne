// A PERSON MARKED AS A CHILD CANNOT TAP "WE'RE HERE" — SCREEN, ENGINE AND RELAY.
//   Run: node --test scripts/a-child-cannot-say-were-here.test.mjs
//
// Owner, 2026-09-30 (reference/DOMAIN.md): "a person marked as a child cannot tap 'We're here' — blocked fully
// for now (screen AND relay)", and "we may find that teens drop their younger siblings off, so … it could be
// opened up in the future". Built so it can be relaxed in ONE place per layer (named below). It uses the
// "marked as a child for chat" mark, NOT the check-in register — those are two different lists.
//
// The sim found a child with "I bring children" ticked could tap the button, and nothing below the screen
// refused: writeArrival had no check and the relay's checkinarrival: door asked only whether the writer was a
// member of the church and the session window was open.
//
//   SCREEN  wereHereOffers() (app/screens-today.jsx) — one predicate, both callers (MyChildrenCard and
//           WereHereSection). CONFIRMED isMinor only, never the "maybe" window: a parent at a door who cannot
//           announce arrival is the worse failure, and the relay is the backstop for the unresolved window.
//   ENGINE  writeArrival() refuses a confirmed minor with { ok:false, reason:'minor' } and publishes nothing.
//   RELAY   accept()'s checkinarrival: branch refuses a marked minor's arrival. A TOMBSTONE (withdrawal) is
//           NOT refused — a child must be able to take their own record down. accept() only, never
//           arrivalIdOk: that half also runs on /import and relay-to-relay, which replay history.
//
// RULE 3: the screen is RENDERED; the engine function is LIFTED from the shipped bundle; the relay is the
// shipped gateway on a fresh data dir. Nothing here matches text in app/*.jsx.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { v2 as nip44 } from 'nostr-tools/nip44';
import { requireFreePort } from './test-ports.mjs';
import { fnBody } from './test-slice.mjs';
import { buildHelperGrant, buildCheckinPermission, GRANT_SOURCE } from './checkin-role-source.mjs';
import { D } from './trinity-doc-types.mjs';
import { loadScreen, miniReact, texts, button } from './render-jsx-screen.mjs';

const ROOT = new URL('../', import.meta.url).pathname;

// ══════════════ 1. THE SCREEN ═════════════════════════════════════════════════════════════════════════════════
const Stub = (n) => function S(p) { return { type: n, props: p, kids: [] }; };
const SERVICE_NOW = { session: 'svc-am', name: 'Morning', from: 0, until: 9e9 };
function section({ isMinor }) {
  const { React, draw } = miniReact();
  const store = { 'bk': '1' };
  const F = {
    myPubkey: 'a'.repeat(64),
    bringsChildren: () => true, myChildNames: () => ['Milo', 'Ivy'],
    arrivalSessionNow: () => SERVICE_NOW, arrivalOutcome: () => null, setArrivalOutcome() {}, arrivalQR: () => null,
    subscribeCareRequests: (cb) => { cb([]); return () => {}; },
  };
  const globals = {
    React, console, setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {},
    Icon: ({ name }) => React.createElement('i', { 'data-icon': name }),
    ChurchBadge: Stub('ChurchBadge'),
    document: { addEventListener() {}, removeEventListener() {}, querySelector: () => null },
    navigator: { userAgent: '' }, location: { search: '', hostname: 'x' },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem(k, v) { store[k] = String(v); }, removeItem() {} },
    lsGet: (k, d) => d, lsSet: () => {},
    cx: (...a) => a.filter(Boolean).join(' '),
    SectionLabel: Stub('SectionLabel'), Halo: Stub('Halo'), Sheet: Stub('Sheet'), IconBtn: Stub('IconBtn'),
    useTrinityAudio: () => ({ track: null, playing: false }),
    todayISO: () => '2026-10-02', fetch: async () => ({ ok: false, json: async () => ({}) }),
    window: {
      addEventListener() {}, removeEventListener() {}, innerWidth: 360, Fellowship: F,
      TrinityIdentity: { qrSVG: () => '' },
      TrinityData: { NOTIFICATIONS: [], PLANS: [], VOTD_POOL: [] },
      Bible: { parseRef: () => null, loaded: false, books: () => [], getVerses: () => [], maxChapter: () => 1, activeVersion: 'WEB', refLabel: () => '', defaultLoc: () => ({ book: 43, chap: 1 }) },
    },
  };
  const mod = loadScreen('app/screens-today.jsx', ['MyChildrenCard', 'WereHereSection'], globals);
  const ctx = {
    church: { npub: 'npub1church', id: 'c1', name: 'St Chad’s' }, toast() {}, connTick: 0,
    churchServices: [{ id: 'svc-am', date: '2026-10-02', time: '09:00', name: 'Morning' }],
    safeguard: { minors: [], approved: [], guardians: {}, isMinor, minorsKnown: true },
    myChildren: { children: [], askAtDesk: 0, settled: true },
    checkinArrive: async () => ({ ok: true, id: 'x' }),
  };
  const out = {};
  for (const name of ['MyChildrenCard', 'WereHereSection']) {
    const props = { ctx };
    draw(mod[name], props);
    const tree = draw(mod[name], props);
    out[name] = { tree, words: texts(tree).join(' | '), buttons: button(tree, 'We’re here').length };
  }
  return out;
}

test('SCREEN CONTROL: an adult who brings children, in a service window, IS offered "We’re here" (the card is reachable at all)', () => {
  const s = section({ isMinor: false });
  assert.ok(s.WereHereSection.buttons >= 1 || s.MyChildrenCard.buttons >= 1,
    're-anchor: the adult sees no "We’re here" at all, so the absences below are vacuous. Section: ' + s.WereHereSection.words + ' Card: ' + s.MyChildrenCard.words);
});

test('SCREEN: a person marked as a child is offered no "We’re here" — in either component', () => {
  const s = section({ isMinor: true });
  assert.equal(s.WereHereSection.buttons, 0,
    'A MARKED CHILD WAS OFFERED "WE’RE HERE". Section read: ' + s.WereHereSection.words);
  assert.equal(s.MyChildrenCard.buttons, 0, 'the card (the other caller of the shared predicate) offered it to a marked child: ' + s.MyChildrenCard.words);
});

// ══════════════ 2. THE ENGINE ═════════════════════════════════════════════════════════════════════════════════
const BUNDLE = readFileSync(new URL('../vendor/fellowship.js', import.meta.url), 'utf8');
const CP = 'c'.repeat(64), MEHEX = 'e'.repeat(64);
function writer({ self }) {
  const published = [];
  const sgSelf = self ? { cp: CP, me: MEHEX, isMinor: !!self.isMinor, known: !!self.known } : { cp: '', me: '', isMinor: false, known: false };
  const scope = {
    toPub: (x) => x, sk: new Uint8Array(32), pub: MEHEX, NET: 'trinityone', CHECKINARRIVAL_D: 'trinityone/checkinarrival:',
    nip44e: () => 'sealed', nip44ck: () => 'ck',
    finalizeEvent: (t) => ({ ...t, id: 'ev' }),
    publishSetFor: () => ['wss://x.invalid'], _publishAny: async (_r, e) => { published.push(e); },
    _pubReason: () => 'not-sent',
    _sgSelf: sgSelf, _mePub: () => MEHEX,
    _sgMine: new Function('_sgSelf', '_mePub', fnBody(BUNDLE, 'function _sgMine(cp)', '_sgMine') + '\nreturn _sgMine;')(sgSelf, () => MEHEX),
  };
  const body = fnBody(BUNDLE, 'async writeArrival(churchNpub, rec) {', 'writeArrival');
  // bind whatever names the bundle gave the imported nostr-tools helpers
  for (const n of ['finalizeEvent', 'encrypt', 'getConversationKey']) {
    for (const hit of body.match(new RegExp('\\b' + n + '\\d*\\b', 'g')) || []) {
      scope[hit] = n === 'finalizeEvent' ? scope.finalizeEvent : n === 'encrypt' ? scope.nip44e : scope.nip44ck;
    }
  }
  const proxy = new Proxy(scope, {
    has: (t, k) => (k in t) || !(k in globalThis),
    get: (t, k) => { if (k in t) return t[k]; if (k === Symbol.unscopables) return undefined; throw new ReferenceError('needs a stub for ' + String(k)); },
    set: (t, k, v) => { t[k] = v; return true; },
  });
  const f = new Function('scope', `with (scope) { return ({ ${body} }).writeArrival; }`)(proxy);
  return { run: () => f(CP, { session: 'svc-am' }), published };
}

test('ENGINE: a confirmed minor’s arrival is refused and nothing is published', async () => {
  const w = writer({ self: { isMinor: true, known: true } });
  const r = await w.run();
  assert.deepEqual(r && { ok: r.ok, reason: r.reason }, { ok: false, reason: 'minor' }, 'a marked child published an arrival');
  assert.equal(w.published.length, 0, 'the arrival reached the relay layer');
});

test('ENGINE CONTROL: a confirmed adult, and a member whose answer has not arrived, still announce arrival (fails open)', async () => {
  for (const self of [{ isMinor: false, known: true }, null]) {
    const w = writer({ self });
    const r = await w.run();
    assert.equal(r && r.ok, true, 'the guard refused a member the church has not marked as a child: ' + JSON.stringify(self));
    assert.equal(w.published.length, 1);
  }
});

// ══════════════ 3. THE RELAY ══════════════════════════════════════════════════════════════════════════════════
const PORT = 8957;   // unique across scripts/*.test.mjs and *.probe.mjs; checked free by requireFreePort
const WS_URL = `ws://127.0.0.1:${PORT}/relay`;
const NET = 'trinityone';
const now = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) }; };
const church = K(), sgLead = K(), ada = K(), gina = K(), mia = K();   // mia is the marked child, gina an ordinary adult
const MORNING = 'svc-morning', KEY_AM = '11'.repeat(32);
let relay, dataDir, w;

const conn = () => new Promise((r, j) => { const s = new WebSocket(WS_URL); s.on('open', () => r(s)); s.on('error', j); });
const send = (s, e) => new Promise(res => {
  const on = d => { const m = JSON.parse(d); if (m[0] === 'OK' && m[1] === e.id) { s.off('message', on); res([m[2], m[3] || '']); } };
  s.on('message', on); s.send(JSON.stringify(['EVENT', e]));
});
async function publishAs(who, e) {
  const s = await conn();
  const authed = new Promise(res => {
    const on = d => { const m = JSON.parse(d);
      if (m[0] === 'AUTH') { s.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', WS_URL], ['challenge', m[1]]], content: '' }, who.sk)])); res(true); } };
    s.on('message', on); setTimeout(() => res(false), 600);
  });
  s.send(JSON.stringify(['REQ', 'warm', { kinds: [30078], limit: 1 }]));
  assert.equal(await authed, true, 'the relay never sent an AUTH challenge — the write below would be refused for the wrong reason');
  await sleep(100);
  const out = await send(s, e); s.close(); return out;
}
const doc = (who, d, content, extra = []) => finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', d], ['t', NET], ...extra], content: typeof content === 'string' ? content : JSON.stringify(content) }, who.sk);
const permission = (by, whoPub) => finalizeEvent({ kind: 30078, created_at: now(),
  tags: [['d', D.CHECKINPERM + whoPub], ['t', NET], ['church', by.pub], ['person', whoPub]],
  content: JSON.stringify(buildCheckinPermission({ person: whoPub, source: 'steward', lifetime: 'open', from: now() - 86400, until: null })) }, by.sk);
const grant = (session, helpers, key, from, until) => {
  const { doc: body, failed } = buildHelperGrant({ session, source: GRANT_SOURCE, lifetime: 'session', from, until, helpers, keepers: [church.pub, sgLead.pub], sessionKeyHex: key,
    wrap: (p, pl) => nip44.encrypt(pl, nip44.utils.getConversationKey(church.sk, p)) });
  assert.equal(failed.length, 0);
  return finalizeEvent({ kind: 30078, created_at: now(), tags: [['d', D.CHECKINHELPER + session], ['t', NET], ['church', church.pub], ['session', session]], content: JSON.stringify(body) }, church.sk);
};
const addr = (sid, pub) => D.CHECKINARRIVAL + sid + ':' + pub;
const selfSeal = (who, obj) => nip44.encrypt(JSON.stringify(obj), nip44.utils.getConversationKey(who.sk, who.pub));
const arrival = (who, sid) => finalizeEvent({ kind: 30078, created_at: now(),
  tags: [['d', addr(sid, who.pub)], ['t', NET], ['church', church.pub], ['session', sid]], content: selfSeal(who, { at: now() }) }, who.sk);
const tomb = (who, sid) => finalizeEvent({ kind: 30078, created_at: now(),
  tags: [['d', addr(sid, who.pub)], ['t', NET], ['church', church.pub], ['session', sid], ['deleted', '1']], content: '' }, who.sk);

async function boot() {
  relay = spawn(process.execPath, ['scripts/gateway.mjs', String(PORT)], { cwd: ROOT, stdio: 'ignore',
    env: { ...process.env, TRINITY_DATA_DIR: dataDir, CHURCH_NPUB: npubEncode(church.pub) } });
  const t0 = Date.now();
  while (Date.now() - t0 < 25000) { try { if ((await fetch(`http://127.0.0.1:${PORT}/status`)).ok) return; } catch {} await sleep(150); }
  throw new Error('the gateway never came up on ' + PORT);
}

before(async () => {
  await requireFreePort(PORT, 'a-child-cannot-say-were-here.test.mjs (it spawns its own gateway)');
  dataDir = mkdtempSync(join(tmpdir(), 'childarrive-'));
  await boot();
  w = await conn();
  for (const who of [sgLead, ada, gina, mia]) await send(w, doc(who, D.MEMBER + church.pub, { joined: now() }));
  await send(w, doc(church, D.STEWARDS + church.pub, { pubkeys: [sgLead.pub], caps: { [sgLead.pub]: ['safeguarding'] } }));
  await send(w, doc(church, D.MINORS + church.pub, { pubkeys: [mia.pub] }));   // the CHAT mark, not the check-in register
  await sleep(250);
  await send(w, permission(church, ada.pub));
  const t = now();
  await send(w, grant(MORNING, [ada.pub], KEY_AM, t - 600, t + 3600));
  await sleep(400);
});
after(async () => {
  try { w.close(); } catch {}
  try { relay.kill('SIGKILL'); } catch {}
  await sleep(300);
  try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
});

test('RELAY BASELINE: an ordinary adult member’s arrival lands in a live session', async () => {
  const [ok, msg] = await publishAs(gina, arrival(gina, MORNING));
  assert.equal(ok, true, 'an adult could not announce arrival, so the refusal below proves nothing: ' + msg);
});

test('RELAY: a person the church marked as a child cannot write an arrival', async () => {
  const [ok, msg] = await publishAs(mia, arrival(mia, MORNING));
  assert.equal(ok, false, 'A MARKED CHILD ANNOUNCED AN ARRIVAL at the children’s session — the screen hides the button, but the relay is the boundary');
  assert.match(String(msg), /blocked|invalid|restricted|not/i, 'refused, but not in a policy refusal’s words: ' + msg);
  const s = await conn();
  const got = await new Promise(res => {
    const out = [];
    s.on('message', d => { const m = JSON.parse(d); if (m[0] === 'EVENT') out.push(m[2]);
      else if (m[0] === 'AUTH') s.send(JSON.stringify(['AUTH', finalizeEvent({ kind: 22242, created_at: now(), tags: [['relay', WS_URL], ['challenge', m[1]]], content: '' }, church.sk)])); });
    s.send(JSON.stringify(['REQ', 'q', { kinds: [30078], '#d': [addr(MORNING, mia.pub)] }]));
    setTimeout(() => res(out), 900);
  });
  s.close();
  assert.equal(got.length, 0, 'the frame said no and the arrival is on disk anyway');
});

test('RELAY: …but the same child can still WITHDRAW (a tombstone is not refused)', async () => {
  const [ok, msg] = await publishAs(mia, tomb(mia, MORNING));
  assert.equal(ok, true, 'a marked child could not take their own arrival record down — only a NEW arrival is refused: ' + msg);
});
