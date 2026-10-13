// DELETING A TEAM (owner, 2026-10-12): it is removed fully, past services keep their record, upcoming services lose
// the team and the people on them are told — and nothing is sent until the undo window has passed.
// Run: node --test scripts/deleting-a-team-removes-it-and-keeps-the-past.test.mjs
//
// HOW THIS FILE ASSERTS (CLAUDE.md rules 1, 3, 4).
//   ENGINE  Steward.removeTeam / removeRoster / sendServingCancel / removeGroup are LIFTED out of the SHIPPED bundle
//           (vendor/steward.js) and run against the REAL relay store (scripts/event-store.mjs put()), with the shipped
//           readers (subscribeRosters/Rotas/Services) reading the store back afterwards. A write gate is not a
//           retention rule: the headline test proves a PAST service still reads back after the team is tombstoned.
//   SCREENS the real DashRota + TeamRemovalHost (app/stew-schedule.jsx) and the real DashGroups (app/stew-dashboard.jsx),
//           rendered, with the delete control pressed. Nothing here matches text in app/*.jsx.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { v2 as nip44 } from 'nostr-tools/nip44';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { openStore } from './event-store.mjs';
import { fnBody, stmt } from './test-slice.mjs';
import { miniReact, find, texts } from './render-jsx-screen.mjs';
import { loadSchedule, h } from './rota-board-harness.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const STEWARD = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
const STEW = readFileSync(join(ROOT, 'app/stew-dashboard.jsx'), 'utf8');

const churchSk = generateSecretKey(), CP = getPublicKey(churchSk);
const NAMEKEY = generateSecretKey();
const hex = (b) => Buffer.from(b).toString('hex');
const unhex = (h) => new Uint8Array(Buffer.from(h, 'hex'));
const NET = 'trinityone', ROSTER_D = 'trinityone/roster:', ROTA_D = 'trinityone/rota:', GROUP_D = 'trinityone/group:', REQUEST_D = 'trinityone/request:';
const T = Math.floor(Date.now() / 1000) - 10_000;
const TODAY = '2026-10-13';
const RUTH = { id: 'p1', name: 'Ruth Carver', pub: 'a'.repeat(64) };
const SAM = { id: 'p2', name: 'Sam Okoye', pub: 'b'.repeat(64) };
const ROSTER_T1 = { roles: [{ id: 'r1', name: 'Greeter' }], people: [RUTH], pods: [] };
const ROSTER_T2 = { roles: [{ id: 'r1', name: 'Sound' }], people: [SAM], pods: [] };

function once(src, anchor, file) {
  const at = src.indexOf(anchor);
  assert.notEqual(at, -1, `${anchor} is missing from ${file} — re-anchor this test`);
  assert.equal(src.indexOf(anchor, at + 1), -1, `${anchor} appears twice in ${file}`);
  return at;
}
const fn = (anchor) => fnBody(STEWARD, once(STEWARD, anchor, 'steward.js'), anchor);
const st = (anchor) => { once(STEWARD, anchor, 'steward.js'); return stmt(STEWARD, anchor); };

const rosterEvent = (team, doc, at = T) => finalizeEvent({ kind: 30078, created_at: at, tags: [['d', ROSTER_D + team], ['t', NET]],
  content: JSON.stringify({ pubs: doc.people.map(p => p.pub).filter(Boolean), e: nip44.encrypt(JSON.stringify(doc), NAMEKEY) }) }, churchSk);
const groupEvent = (id, name, at = T) => finalizeEvent({ kind: 30078, created_at: at, tags: [['d', GROUP_D + id], ['t', NET]], content: JSON.stringify({ name, kind: 'team' }) }, churchSk);

function console_({ ring = [hex(NAMEKEY)], store = openStore(':memory:'), clock = { s: T } } = {}) {
  const subs = [], sent = [];
  const world = {
    pub: CP, sk: churchSk, NET, actingChurch: '',
    ROSTER_D, ROTA_D, SERVICE_D: 'trinityone/service:', GROUP_D, REQUEST_D, RUNSHEET_D: 'trinityone/runsheet:', ROOM_D: 'trinityone/room:', BOOKING_D: 'trinityone/booking:',
    _nameKeyRing: ring, _unhex: unhex, encrypt2: nip44.encrypt, decrypt3: nip44.decrypt, NAME_KEY_WAIT_MS: 0,
    _localBlocked: new Set(), _consoleDisplay: () => true, _consoleChurchVoice: () => true,
    localStorage: { getItem: () => null, setItem() {} },
    relays: () => ['wss://r'],
    pool: { subscribeMany: (_r, _f, h) => { subs.push(h); return { close() {} }; } },
    now: () => clock.s, Date: { now: () => clock.s * 1000 },
    _skewShift: () => 0, STAMP_CAP_SEC: 600, SKEW_CAP_SEC: 900,
    finalizeEvent,
    publish: async (evt, opts) => {
      sent.push(evt);
      const r = store.put(evt);
      if (r === 'stored' || r === 'duplicate') return evt;
      if (opts) { opts.reason = 'invalid: ' + r; opts.refused = true; }
      return false;
    },
  };
  const names = Object.keys(world);
  const body = `
    ${fn('function _pickWinner(vers, trusted)')}
    ${fn('function _reduceVersions(vers, byId, id, trusted)')}
    ${fn('function _seedFromCache(versions, byId, items, trusted)')}
    ${fn('function _absorbById(versions, byId, id, rec, trusted)')}
    ${fn('function _tombstoneTargets(e)')}
    ${fn('function _forgetById(versions, byId, id, by, ts, trusted, opts)')}
    ${st('var _lastStamp = ')}
    ${st('var _lockedAddr = ')}
    ${fn('function _addrLocked(d)')}
    ${st('var _lastSaveFail = ')}
    ${fn('function _saveFailed(why)')}
    ${fn('function _noteSeenStamp(d, ts)')}
    ${fn('function _monotonic(tmpl)')}
    ${st('var _nameKeyListeners = ')}
    ${fn('function _onNameKeyRing(fn)')}
    ${fn('function _nameKeyRingChanged()')}
    ${fn('function _sealChurchDoc(obj)')}
    ${fn('function _sealChurchDocReady(obj)')}
    ${fn('function _openChurchDoc(content)')}
    let _svcSeq = 0, _reqSeq = 0;
    function feChurch(t) { return finalizeEvent(_monotonic(t), sk); }
    const S = { ${fn('_subAddr(prefix, map, onItems, lockedShape)')},
                ${fn('subscribeRosters(onRosters)')}, ${fn('subscribeRotas(onRotas)')}, ${fn('subscribeServices(onServices)')},
                ${fn('async publishRoster(teamId, roster)')}, ${fn('async publishRota(rota)')}, ${fn('async publishService(svc)')},
                ${fn('removeGroup(id)')}, ${fn('removeRoster(teamId) {')}, ${fn('async removeTeam(teamId, ctx)')}, ${fn('async sendServingCancel(req)')},
                ${fn('lastSaveFailure()')} };
    const window = { Steward: S };
    return { S, ringChanged: _nameKeyRingChanged };`;
  const api = new Function(...names, body)(...names.map(n => world[n]));
  return { ...api, subs, sent, store, ring, clock };
}

// What a console that opens AFTER the removal reads: the SHIPPED readers fed everything the relay stored.
function readBack(c) {
  const r = console_({ store: c.store, ring: c.ring });
  const out = { rosters: [], rotas: [], services: [] };
  r.S.subscribeRosters(x => { out.rosters = x; });
  r.S.subscribeRotas(x => { out.rotas = x; });
  r.S.subscribeServices(x => { out.services = x; });
  for (const e of c.store.query({ kinds: [30078] })) for (const h of r.subs) h.onevent(e);
  return out;
}

// A church with two teams. Services: one PAST, two UPCOMING. Ruth (team t1) is on all three; Sam (team t2) on the past one and the first upcoming.
async function seeded() {
  const c = console_();
  c.store.put(rosterEvent('t1', ROSTER_T1, T - 50));
  c.store.put(rosterEvent('t2', ROSTER_T2, T - 50));
  c.store.put(groupEvent('t1', 'Welcome', T - 50));
  c.store.put(groupEvent('t2', 'Sound', T - 50));
  const svc = {};
  for (const [id, date] of [['past', '2026-10-04'], ['up1', '2026-10-20'], ['up2', '2026-10-27']]) {
    svc[id] = await c.S.publishService({ id, date, time: '10:30', name: 'Sunday' });
    c.clock.s++;
  }
  const rota = { past: { 't1::r1': RUTH, 't2::r1': SAM }, up1: { 't1::r1': RUTH, 't2::r1': SAM }, up2: { 't1::r1': RUTH } };
  for (const id of Object.keys(rota)) { await c.S.publishRota({ service: id, published: true, assign: rota[id] }); c.clock.s++; }
  c.sent.length = 0;
  const seen = readBack(c);
  assert.equal(seen.rotas.length, 3, 'CONTROL: the seeded church has three rotas');
  assert.equal(seen.services.length, 3, 'CONTROL: and three services');
  const requests = [{ id: 'reqRuthUp1', memberPub: RUTH.pub, serviceId: 'up1', teamId: 't1', roleId: 'r1', role: 'Greeter', teamName: 'Welcome' }];
  return { c, ctx: { rosters: seen.rosters, rotas: seen.rotas, services: seen.services, requests, today: TODAY, teamName: 'Welcome' } };
}

// ── ENGINE ─────────────────────────────────────────────────────────────────────────────────────────────────────
test('PAST SERVICES KEEP THEIR RECORD: after the team is tombstoned the past rota and service still read back, intact', async () => {
  const { c, ctx } = await seeded();
  const res = await c.S.removeTeam('t1', ctx);
  assert.equal(res.ok, true, 'removeTeam failed: ' + JSON.stringify(res));
  const after = readBack(c);
  // THE ASSERTION THAT MATTERS MOST: a write gate is not a retention rule (replaying one over an import deleted everything).
  const past = after.rotas.find(r => r.service === 'past');
  assert.ok(past, 'THE PAST ROTA IS GONE: deleting a team erased who served on a past Sunday');
  assert.deepEqual(Object.keys(past.assign).sort(), ['t1::r1', 't2::r1'], 'the past rota was rewritten: it must be left exactly as it was, including the deleted team\'s slot');
  assert.equal(past.assign['t1::r1'].name, 'Ruth Carver');
  assert.ok(after.services.find(s => s.id === 'past'), 'the past service itself is gone');
  assert.equal(after.services.length, 3, 'a service was removed: only rotas change, never services');
  assert.equal(c.sent.filter(e => e.tags.some(t => t[0] === 'd' && t[1] === ROTA_D + 'past')).length, 0, 'the engine published to the past rota at all');
});

test('the team is removed fully: roster and group are tombstoned; the OTHER team is untouched', async () => {
  const { c, ctx } = await seeded();
  assert.equal((await c.S.removeTeam('t1', ctx)).ok, true);
  const after = readBack(c);
  assert.equal(after.rosters.find(r => r.team === 't1'), undefined, 'the roster is still readable: members would still see the team');
  assert.ok(after.rosters.find(r => r.team === 't2'), 'the other team\'s roster was removed too');
  const dead = (d) => c.sent.some(e => e.tags.some(t => t[0] === 'd' && t[1] === d) && e.tags.some(t => t[0] === 'deleted'));
  assert.ok(dead(GROUP_D + 't1'), 'the group (team) was not tombstoned');
  assert.ok(dead(ROSTER_D + 't1'), 'the roster was not tombstoned');
  assert.ok(!dead(GROUP_D + 't2') && !dead(ROSTER_D + 't2'), 'a different team was tombstoned');
});

test('UPCOMING services lose the team\'s slots (and only those); published stays; other teams keep theirs', async () => {
  const { c, ctx } = await seeded();
  await c.S.removeTeam('t1', ctx);
  const after = readBack(c);
  const up1 = after.rotas.find(r => r.service === 'up1'), up2 = after.rotas.find(r => r.service === 'up2');
  assert.deepEqual(Object.keys(up1.assign), ['t2::r1'], 'up1 should keep only the other team');
  assert.deepEqual(Object.keys(up2.assign), [], 'up2 held only the deleted team');
  assert.equal(up1.published, true);
});

test('PEOPLE ARE TOLD, and only AFTER the rota, roster and group have all landed; the old request card is the one replaced', async () => {
  const { c, ctx } = await seeded();
  const res = await c.S.removeTeam('t1', ctx);
  assert.equal(res.told, 2, 'Ruth is on two upcoming services: two notices');
  const idx = (pred) => c.sent.findIndex(pred);
  const dOf = (e) => (e.tags.find(t => t[0] === 'd') || [])[1];
  const lastWrite = Math.max(idx(e => dOf(e) === ROTA_D + 'up1'), idx(e => dOf(e) === ROTA_D + 'up2'), idx(e => dOf(e) === ROSTER_D + 't1'), idx(e => dOf(e) === GROUP_D + 't1'));
  const firstNotice = idx(e => String(dOf(e)).startsWith(REQUEST_D));
  assert.ok(firstNotice > lastWrite, 'a notice went out BEFORE the removal had landed: people told about a team that may still exist');
  const notices = c.sent.filter(e => String(dOf(e)).startsWith(REQUEST_D));
  assert.ok(notices.every(e => e.tags.some(t => t[0] === 'p' && t[1] === RUTH.pub)), 'a notice went to somebody who was not on the team');
  assert.ok(notices.some(e => dOf(e) === REQUEST_D + 'reqRuthUp1'), 'the request she was ASKED on was not the one replaced, so she would keep a live "can you serve?" card');
  const opened = JSON.parse(nip44.decrypt(JSON.parse(notices[0].content).e, NAMEKEY));
  assert.equal(opened.cancelled, true);
  assert.match(opened.note, /no longer needed/i);
  assert.equal(notices.length, 2);
  assert.ok(!notices.some(e => e.tags.some(t => t[0] === 'p' && t[1] === SAM.pub)), 'Sam (other team) was told');
});

test('a failure mid-way tells NOBODY and tombstones nothing: a rota that will not save stops the removal', async () => {
  const { c, ctx } = await seeded();
  const real = c.S.publishRota;
  c.S.publishRota = async (r) => (r.service === 'up2' ? null : real(r));
  const res = await c.S.removeTeam('t1', ctx);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'rota');
  const dOf = (e) => (e.tags.find(t => t[0] === 'd') || [])[1];
  assert.equal(c.sent.filter(e => String(dOf(e)).startsWith(REQUEST_D)).length, 0, 'someone was told about a removal that did not happen');
  assert.equal(c.sent.filter(e => e.tags.some(t => t[0] === 'deleted')).length, 0, 'the team was tombstoned while a rota still holds its slots');
  assert.ok(readBack(c).rosters.find(r => r.team === 't1'), 'the team is gone though the removal failed');
});

test('a group tombstone the relay refuses tells nobody', async () => {
  const { c, ctx } = await seeded();
  c.S.removeGroup = async () => false;
  const res = await c.S.removeTeam('t1', ctx);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'group');
  const dOf = (e) => (e.tags.find(t => t[0] === 'd') || [])[1];
  assert.equal(c.sent.filter(e => String(dOf(e)).startsWith(REQUEST_D)).length, 0);
});

test('A LOCKED ROSTER IS NEVER DELETED: refused, nothing published, the relay copy survives', async () => {
  const { c, ctx } = await seeded();
  const locked = { ...ctx, rosters: ctx.rosters.map(r => (r.team === 't1' ? { team: 't1', id: 't1', roles: [], people: [], pods: [], _locked: true } : r)) };
  const res = await c.S.removeTeam('t1', locked);
  assert.deepEqual([res.ok, res.reason], [false, 'locked']);
  assert.equal(c.sent.length, 0, 'something was published although the team could not be read');
  assert.ok(readBack(c).rosters.find(r => r.team === 't1'), 'the roster did not survive');
});

test('a LOCKED upcoming rota (it may hold the team\'s slots) also refuses the whole removal', async () => {
  const { c, ctx } = await seeded();
  const locked = { ...ctx, rotas: ctx.rotas.map(r => (r.service === 'up2' ? { id: 'up2', _locked: true } : r)) };
  const res = await c.S.removeTeam('t1', locked);
  assert.deepEqual([res.ok, res.reason], [false, 'locked']);
  assert.equal(c.sent.length, 0, 'the removal started although a rota could not be read');
});

// ── SCREENS ────────────────────────────────────────────────────────────────────────────────────────────────────
function clock() {
  let now = 0; const q = [];
  return {
    setTimeout: (f, ms) => { const t = { f, at: now + ms }; q.push(t); return t; },
    clearTimeout: (t) => { const i = q.indexOf(t); if (i >= 0) q.splice(i, 1); },
    advance: async (ms) => { now += ms; for (const t of [...q]) if (t.at <= now && q.includes(t)) { q.splice(q.indexOf(t), 1); await t.f(); } },
    pending: () => q.length,
  };
}
const SkConfirm = function SkConfirm() { return null; };
const TEAM = { id: 't1', kind: 'team', name: 'Welcome', accent: 'var(--clay)' };
const SERVICES = [{ id: 'up1', date: '2026-10-20', time: '10:30', name: 'Sunday' }];
const ROTAS = [{ id: 'up1', service: 'up1', published: true, assign: { 't1::r1': { id: 'p1', name: 'Ruth Carver', pub: RUTH.pub } } }];

function board({ rosters = [{ team: 't1', roles: [{ id: 'r1', name: 'Greeter' }], people: [RUTH], pods: [] }] } = {}) {
  const clk = clock(); const calls = [];
  const Steward = {
    removeTeam: async (id, ctx) => { calls.push(['removeTeam', id, ctx]); return { ok: true, told: 1, toldFailed: 0 }; },
    removeGroup: async (id) => { calls.push(['removeGroup', id]); return { ok: 1 }; },
    publishRota: async (r) => { calls.push(['publishRota', r]); return {}; },
    sendServingCancel: async (r) => { calls.push(['sendServingCancel', r]); return {}; },
    sendServingRequest: async (r) => { calls.push(['sendServingRequest', r]); return {}; },
    nameKeyReady: () => true,
  };
  const sch = loadSchedule({ setTimeout: clk.setTimeout, clearTimeout: clk.clearTimeout }, {
    useStewardGroups: () => [TEAM], useStewardRosters: () => rosters, useStewardServices: () => SERVICES, useStewardRotas: () => ROTAS,
    useStewardRequests: () => [], useStewardRequestReplies: () => [], useStewardUnavail: () => ({}),
    SkConfirm, todayISO: () => TODAY, Steward,
  }, ['DashRota', 'TeamRemovalHost']);
  const draw = () => { sch.reset(); const boardTree = sch.mod.DashRota({ onNewTeam() {} }); const host = sch.mod.TeamRemovalHost(); return { boardTree, host }; };
  const delBtn = () => find(draw().boardTree, n => n.type === 'button' && /Delete team/.test(String((n.props || {}).title || '')));
  const confirmEl = () => find(draw().host, n => n.type === SkConfirm);
  const undoBtn = () => find(draw().host, n => n.type === 'button' && /^Undo$/.test(texts(n).join('').trim()));
  const teamShown = () => find(draw().boardTree, n => n.type === 'div' && texts(n).join(' ') === 'Welcome').length > 0 || JSON.stringify(draw().boardTree).includes('"Welcome"');
  return { sch, clk, calls, draw, delBtn, confirmEl, undoBtn, teamShown, TeamRemoval: sch.win.TeamRemoval };
}

test('THE ROTA PAGE OFFERS DELETE; the confirm says it is final; NOTHING is published or sent until the undo window passes', async () => {
  const b = board();
  const del = b.delBtn();
  assert.equal(del.length, 1, 'the Rota page has no (or two) delete-team controls — re-anchor');
  del[0].props.onClick();
  const ce = b.confirmEl();
  assert.equal(ce.length, 1, 'pressing delete did not open the confirm dialog');
  assert.match(ce[0].props.body, /FINAL/, 'the confirm does not say it is final');
  assert.match(ce[0].props.body, /1 person on 1 upcoming service will be told/, 'the confirm does not say who will be told');
  assert.equal(b.calls.length, 0, 'something was published before the steward confirmed');
  ce[0].props.onConfirm();
  assert.equal(b.undoBtn().length, 1, 'no Undo is offered after confirming');
  await b.clk.advance(8999);
  assert.equal(b.calls.length, 0, 'THE ORDERING IS REVERSED: the removal (or a notice) went out INSIDE the undo window');
  await b.clk.advance(1);
  assert.deepEqual(b.calls.map(c => c[0]), ['removeTeam'], 'after the window exactly one removeTeam call should be made (and no direct sends from the screen)');
  assert.equal(b.calls[0][1], 't1');
  assert.deepEqual(b.calls[0][2].rotas.map(r => r.service), ['up1'], 'the engine was not handed what the console has read');
});

test('THE UNDO BAR CANCELS THE SEND: after Undo nothing is ever published, and the team is back on the board', async () => {
  const b = board();
  b.delBtn()[0].props.onClick(); b.confirmEl()[0].props.onConfirm();
  assert.equal(b.delBtn().length, 0, 'the team stayed on the board while being removed');
  b.undoBtn()[0].props.onClick();
  await b.clk.advance(60_000);
  assert.equal(b.calls.length, 0, 'Undo did not cancel: the team was removed anyway');
  assert.equal(b.clk.pending(), 0);
  assert.equal(b.delBtn().length, 1, 'Undo did not bring the team back onto the board');
});

test('a team this console cannot read yet cannot even be offered for deletion', async () => {
  const b = board({ rosters: [{ team: 't1', id: 't1', roles: [], people: [], pods: [], _locked: true }] });
  b.delBtn()[0].props.onClick();
  assert.equal(b.confirmEl().length, 0, 'a confirm dialog opened for a team that cannot be read');
  assert.match(texts(b.draw().host).join(' '), /Can’t read/);
  await b.clk.advance(60_000);
  assert.equal(b.calls.length, 0);
});

// ── the Groups screen: the REAL DashGroups, sharing the REAL removal flow ──────────────────────────────────────
async function loadConsoleComponent(name, anchor, globals) {
  const src = fnBody(STEW, anchor, name) + '\n' + ['stewKeyRecipients', 'stewKeyRecipientsOrAdmitted', 'useStewKeyRecipients'].map(n => fnBody(STEW, 'function ' + n + '(', n)).join('\n') + '\n' + STEW.match(/^const STEW_KEYS_LOADING = .*;$/m)[0];
  const tmp = join(tmpdir(), 'delteam-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, src + `\nexport { ${name} };\n`);
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const key = '__delteam_' + Math.random().toString(36).slice(2);
  globalThis[key] = globals;
  const preamble = Object.keys(globals).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  return (await import('data:text/javascript;base64,' + Buffer.from(preamble + '\n' + js).toString('base64')))[name];
}
const Stub = (n) => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };

test('THE GROUPS SCREEN OFFERS DELETE FOR A TEAM, and it goes through the same strong confirm + undo — not the old one-step group delete', async () => {
  const b = board();
  const { React, draw } = miniReact();
  let captured = null;
  const removed = [];
  const win = {
    Steward: { publishGroup: async () => ({}), removeGroup: (id) => { removed.push(id); return Promise.resolve({ ok: 1 }); } },
    useStewardGroups: () => [TEAM], useStewardRosters: () => [], useStewardMembers: () => [], useStewardCategories: () => [],
    dispatchEvent: () => true, addEventListener() {}, removeEventListener() {},
    // the real flow object from the Rota page's module; the hook is a plain read here (no second React)
    TeamRemoval: b.TeamRemoval, useTeamRemoval: () => b.TeamRemoval.state(), TeamRemovalHost: Stub('TeamRemovalHost'),
  };
  const Comp = await loadConsoleComponent('DashGroups', 'function DashGroups()', {
    React, window: win, CustomEvent, setTimeout, clearTimeout,
    location: { search: '', hostname: 'x' }, document: { addEventListener() {}, removeEventListener() {} },
    ListPanel: function ListPanel(p) { captured = p; return null; },
    Icon: Stub('Icon'), SkPill: Stub('SkPill'), SkConfirm: Stub('SkConfirm'), NewGroupModal: Stub('NewGroupModal'), CategoriesModal: Stub('CategoriesModal'),
    GroupChatModal: Stub('GroupChatModal'), GroupLeadersModal: Stub('GroupLeadersModal'), EditGroupMembersModal: Stub('EditGroupMembersModal'),
    KeyDistributor: Stub('KeyDistributor'), useRealMemberCount: () => 5, useStewDialog: () => ({}), groupLiveSub: () => '1 member',
  });
  draw(Comp, {});
  const item = captured.items.find(x => x.id === 't1');
  assert.ok(item, 'the team is not in the Groups list');
  const del = find(captured.renderAside(item), n => n.type === 'button' && /Remove team/.test(String((n.props || {}).title || '')));
  assert.equal(del.length, 1, 'the Groups screen offers no delete for a team');
  del[0].props.onClick();
  assert.equal(b.TeamRemoval.state().asking && b.TeamRemoval.state().asking.id, 't1', 'the Groups delete did not open the strong team confirm');
  assert.deepEqual(removed, [], 'the Groups screen deleted the group straight away, leaving the roster and rotas behind');
  b.TeamRemoval.confirm();
  await b.clk.advance(8999);
  assert.deepEqual(b.calls, [], 'something was sent inside the undo window');
  await b.clk.advance(1);
  assert.deepEqual(b.calls.map(c => c[0]), ['removeTeam']);
  // and once removed it leaves the Groups list
  draw(Comp, {});
  assert.equal(captured.items.find(x => x.id === 't1'), undefined, 'the removed team is still listed on the Groups screen');
});

// ── THE MEMBER'S PHONE: a "no longer needed" notice is not a question, and is shown as what it is ────────────────
// Lifted from app/ and RUN (rule 3): notifServingItems (screens-extras.jsx) and the servPending filter (app.jsx).
const EXTRAS = readFileSync(join(ROOT, 'app/screens-extras.jsx'), 'utf8');
const APP = readFileSync(join(ROOT, 'app/app.jsx'), 'utf8');
const CANCEL = { id: 'reqRuthUp1', ts: 5, date: '2026-10-20', role: 'Greeter', teamName: 'Welcome', serviceId: 'up1', teamId: 't1', roleId: 'r1', cancelled: true };
const ASK = { ...CANCEL, id: 'reqOther', cancelled: undefined };

test('the bell says "No longer needed" for a cancelled slot, and still says "Asked you to serve" for a live one', () => {
  const notifServingItems = new Function(fnBody(EXTRAS, 'function notifServingItems(', 'notifServingItems') + '\nreturn notifServingItems;')();
  const out = notifServingItems([CANCEL, ASK], '2026-10-13', 'Best Church');
  assert.equal(out.length, 2);
  assert.match(out.find(x => x.id === 'req:reqRuthUp1').text, /^No longer needed · Greeter · Welcome$/);
  assert.match(out.find(x => x.id === 'req:reqOther').text, /^Asked you to serve/);
});

test('a cancelled request is NEVER counted as pending - the member is not asked to answer a slot that no longer exists', () => {
  const at = once(APP, 'const servPending = servReqs.filter(', 'app.jsx');
  const line = APP.slice(at, APP.indexOf('\n', at));
  const servPendingOf = new Function('servReqs', 'servReplies', '_lockedHere', 'todayStr', line + '\nreturn servPending;');
  const got = servPendingOf([CANCEL, ASK], {}, () => false, '2026-10-13');
  assert.deepEqual(got.map(r => r.id), ['reqOther'], 'the cancelled slot is still offered to the member as a question');
});
