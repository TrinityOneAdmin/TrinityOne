// A SERVICE CHIP ON THE STEWARD CALENDAR DRAGS TO ANOTHER DAY, EXACTLY LIKE AN EVENT CHIP (owner, 2026-11-24).
// Run: node --test scripts/a-service-chip-drags-to-another-day.test.mjs
//
// These tests drive the SHIPPED code, never source text (CLAUDE.md rule 3 — app/*.jsx ships UNBUNDLED, so a
// `false &&` would leave every word of a condition in place and any text match would still pass):
//   - DashCalendar is BUILT from app/stew-schedule.jsx and RENDERED (the same harness as
//     one-occurrence-moves-or-skips-without-the-series.test.mjs): dragging a SERVICE chip onto a day calls
//     publishService({ id, name, date:newDate, time }) — the same-id rewrite the engine replaces in place —
//     and the chip paints on the new day BEFORE the relay echoes (the `moves` overlay). CLAUDE.md rule 1.
//   - An EVENT drag on the same calendar still calls publishEvent and never publishService (regression pin
//     for the kind routing in onDropDay), and a service drag never calls publishEvent.
//   - The rota stays attached THROUGH THE ENGINE: publishService (lifted out of vendor/steward.js and RUN)
//     writes the moved service to the SAME d-address as the original, publishRota's address depends only on
//     rota.service, and subscribeServices' mapper reads the new date back. At the point of use, the moved
//     chip still renders its coverage dot FULL from the same rota (coverageFor finds it by id).
//   - A publishService that answers null (not saved) drops the overlay: the chip falls back to its old day.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { fnBody } from './test-slice.mjs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const SCHED = read('../app/stew-schedule.jsx');
const STEWARD = read('../vendor/steward.js');
const jsx = (src) => transformSync(src, { loader: 'jsx', jsx: 'transform', jsxFactory: 'h', jsxFragment: 'Frag' }).code;
const pad = (n) => String(n).padStart(2, '0');
const tick = () => new Promise(r => setTimeout(r, 0));

// ── DashCalendar harness (the same shape one-occurrence-moves-or-skips… uses) ────────────────────────────────
function buildSched(stewardStub, { services = [], events = [], rotas = [], rosters = [], groups = [] } = {}) {
  const states = []; let idx = 0;
  const React = {
    useState(init) { const i = idx++; if (states.length <= i) states.push(typeof init === 'function' ? init() : init); return [states[i], (v) => { states[i] = typeof v === 'function' ? v(states[i]) : v; }]; },
    useEffect() {}, useRef: (v) => ({ current: v === undefined ? null : v }), useMemo: (f) => f(), useCallback: (f) => f, Fragment: 'Frag',
  };
  const h = (type, p, ...kids) => ({ type, props: { ...(p || {}), children: kids.flat() } });
  const nil = () => [];
  const SkConfirm = () => null;
  const window = {
    expandEvents: (evs) => evs, Steward: stewardStub,
    useStewardServices: () => services, useStewardEvents: () => events, useStewardRotas: () => rotas,
    useStewardRosters: () => rosters, useStewardGroups: () => groups, useStewardRsvps: () => ({}),
    useStewardMembers: nil, useStewardBlocked: nil, useStewardRequests: nil, useStewardRequestReplies: nil,
    useStewardBookings: nil, useStewardRooms: nil, useStewardRunsheets: nil, eventImgStyle: () => ({}), confirm: () => true,
  };
  const scope = {
    React, h, Frag: 'Frag', window, Icon: () => null, CustomEvent: class {}, confirm: () => true, SkConfirm,
    useStewDialog: () => ({ current: null }), todayISO: () => '2026-10-01',
    document: { createElement: () => ({ getContext: () => ({ drawImage() {} }), toDataURL: () => 'data:image/jpeg;base64,AAAA' }) },
    Image: class { set src(v) {} }, FileReader: class { readAsDataURL() {} },
  };
  const names = Object.keys(scope);
  const mod = new Function(...names, jsx(SCHED) + '\nreturn { DashCalendar };')(...names.map(n => scope[n]));
  return { mod, reset: () => { idx = 0; } };
}
const flat = (n, out = []) => { if (!n || typeof n !== 'object') return out; if (Array.isArray(n)) { n.forEach(x => flat(x, out)); return out; } out.push(n); flat(n.props && n.props.children, out); return out; };
const label = (x) => { if (x == null) return ''; if (typeof x === 'string' || typeof x === 'number') return String(x); if (Array.isArray(x)) return x.map(label).join(''); return x.props ? label(x.props.children) : ''; };
const stopEv = { preventDefault() {}, stopPropagation() {}, dataTransfer: { setData() {}, effectAllowed: '', dropEffect: '' } };

function cellFor(nodes, key, Y, M) {
  for (const n of nodes) {
    if (n.type !== 'button' || !n.props || typeof n.props.onDrop !== 'function') continue;
    const dayDiv = (n.props.children || [])[0];
    const d = dayDiv && dayDiv.props && (dayDiv.props.children || [])[0];
    if (typeof d === 'number' && `${Y}-${pad(M + 1)}-${pad(d)}` === key) return n;
  }
  return null;
}
// A chip inside a cell, found by being a DRAGGABLE div whose rendered text names the thing (found by what it
// says on screen, then RUN — behaviour is asserted by running its handlers, never by matching source text).
const chipIn = (cell, name) => flat(cell).find(n => n && n.type === 'div' && n.props && n.props.draggable && typeof n.props.onDragStart === 'function' && label(n).includes(name));

// Current-month fixture days, away from month edges so source and target are real cells of the same grid.
const Y = new Date().getFullYear(), M = new Date().getMonth();
const OWN = `${Y}-${pad(M + 1)}-10`, TGT = `${Y}-${pad(M + 1)}-12`;
const SVC = { id: 'svc1', name: 'Sunday Gathering', date: OWN, time: '10:30' };
// A one-slot rota world: team t1, one role, one person assigned — so the coverage dot is FULL (sage) exactly
// when coverageFor still finds the rota for THIS service id.
const RIG = {
  services: [SVC],
  groups: [{ id: 't1', kind: 'team', name: 'Welcome' }],
  rosters: [{ team: 't1', roles: [{ id: 'r1', name: 'Door' }], people: [], pods: [] }],
  rotas: [{ id: 'svc1', service: 'svc1', published: true, assign: { 't1::r1': { id: 'm1', name: 'Ann', pub: 'p1' } } }],
};
const dotOf = (chip) => { const span = (chip.props.children || []).find(k => k && k.type === 'span'); return span && span.props.style && span.props.style.background; };

test('dragging a SERVICE chip to another day rewrites THE SAME service with the new date, and the chip paints there at once', async () => {
  const calls = [];
  const steward = {
    publishService: (doc) => { calls.push({ fn: 'publishService', doc }); return Promise.resolve({ id: doc.id, ...doc }); },
    publishEvent: (doc) => calls.push({ fn: 'publishEvent', doc }),
    removeService: (id) => calls.push({ fn: 'removeService', id }),
  };
  const { mod, reset } = buildSched(steward, RIG);
  reset();
  let nodes = flat(mod.DashCalendar());
  const chip = chipIn(cellFor(nodes, OWN, Y, M), 'Sunday Gathering');
  assert.ok(chip, 'the service chip is not draggable — the move affordance is gone from the screen');
  assert.equal(chip.props.style && chip.props.style.cursor, 'grab', 'the service chip does not show the grab cursor the event chips show');
  assert.match(String(chip.props.title || ''), /Drag to move/, 'the service chip does not say it can be dragged');
  const tgtCell = cellFor(nodes, TGT, Y, M);
  assert.ok(tgtCell && typeof tgtCell.props.onDrop === 'function', 'the target day is not a drop zone — re-anchor');

  chip.props.onDragStart(stopEv);
  tgtCell.props.onDrop(stopEv);
  await tick();

  assert.ok(!calls.some(c => c.fn === 'removeService'), 'a drag called removeService — the service would be gone');
  assert.ok(!calls.some(c => c.fn === 'publishEvent'), 'a service drag published an EVENT — the kind routing is wrong');
  const pubs = calls.filter(c => c.fn === 'publishService');
  assert.equal(pubs.length, 1, 'a service drag did not call publishService exactly once');
  assert.deepEqual(pubs[0].doc, { id: 'svc1', name: 'Sunday Gathering', date: TGT, time: '10:30' },
    'the drag did not rewrite THE SAME service (same id, same name/time) with only the date changed');

  // THE PRE-ECHO OVERLAY: the stub subscription still serves the OLD date, yet the chip must already sit on
  // the new day (and have left the old one) — the same `moves` treatment event chips get.
  reset();
  nodes = flat(mod.DashCalendar());
  const movedChip = chipIn(cellFor(nodes, TGT, Y, M), 'Sunday Gathering');
  assert.ok(movedChip, 'the chip did not paint on the new day before the relay echoed');
  assert.ok(!chipIn(cellFor(nodes, OWN, Y, M), 'Sunday Gathering'), 'the chip still paints on the old day too');
  // POINT-OF-USE rota linkage: the moved chip's coverage dot is still FULL — coverageFor found the SAME rota
  // by service id. If the move detached the rota, the one slot would read unfilled and the dot turns gold.
  assert.equal(dotOf(movedChip), 'var(--sage)', 'the moved chip lost its rota coverage — the rota is no longer found for this service');
});

test('dragging an EVENT chip still publishes the event and never touches publishService (regression pin)', () => {
  const calls = [];
  const steward = {
    publishEvent: (doc) => { calls.push({ fn: 'publishEvent', doc }); return Promise.resolve({ id: doc.id }); },
    publishService: (doc) => calls.push({ fn: 'publishService', doc }),
    removeEvent: (id) => calls.push({ fn: 'removeEvent', id }),
  };
  const oneoff = { id: 'o1', title: 'Fair', time: '12:00', recur: '', date: OWN };
  const { mod, reset } = buildSched(steward, { ...RIG, events: [oneoff] });
  reset();
  const nodes = flat(mod.DashCalendar());
  const evChip = chipIn(cellFor(nodes, OWN, Y, M), 'Fair');
  assert.ok(evChip, 'the one-off event chip is not draggable any more');
  evChip.props.onDragStart(stopEv);
  cellFor(nodes, TGT, Y, M).props.onDrop(stopEv);
  assert.ok(!calls.some(c => c.fn === 'publishService'), 'an event drag called publishService — the kind routing broke the event path');
  assert.ok(!calls.some(c => c.fn === 'removeEvent'), 'an event drag called removeEvent');
  const pub = calls.find(c => c.fn === 'publishEvent');
  assert.ok(pub, 'an event drag no longer publishes the event');
  assert.equal(pub.doc.date, TGT, 'the event did not move to the dropped day');
});

test('a service move the engine refuses (null) drops the overlay — the chip falls back, it does not pretend', async () => {
  const steward = { publishService: () => Promise.resolve(null) };
  const { mod, reset } = buildSched(steward, RIG);
  reset();
  let nodes = flat(mod.DashCalendar());
  chipIn(cellFor(nodes, OWN, Y, M), 'Sunday Gathering').props.onDragStart(stopEv);
  cellFor(nodes, TGT, Y, M).props.onDrop(stopEv);
  await tick();
  reset();
  nodes = flat(mod.DashCalendar());
  assert.ok(chipIn(cellFor(nodes, OWN, Y, M), 'Sunday Gathering'), 'a refused save left the chip off its real day');
  assert.ok(!chipIn(cellFor(nodes, TGT, Y, M), 'Sunday Gathering'), 'a refused save left the chip pretending it moved');
});

// ── the engine: a moved service is THE SAME document, so the rota stays attached ─────────────────────────────
function liftPublishService() {
  const body = fnBody(STEWARD, 'async publishService(svc) {', 'publishService');
  const published = [];
  const scope = {
    _lastSaveFail: '', _svcSeq: 0, SERVICE_D: 'trinityone/service:', NET: 'net', sk: new Uint8Array(32).fill(1),
    _addrLocked: () => false, _sealChurchDocReady: async (doc) => JSON.stringify(doc),
    publish: (e) => { published.push(e); return Promise.resolve(true); }, feChurch: (e) => e, now: () => 1000,
    _saveFailed: (why) => { scope._lastSaveFail = why; return null; },
    Promise, JSON, Math, Date, String, Object,
  };
  const fn = new Function('scope', 'with (scope) { return ({ ' + body + ' }); }')(scope);
  return { publishService: (svc) => fn.publishService(svc), published };
}
function liftPublishRota() {
  const body = fnBody(STEWARD, 'async publishRota(rota) {', 'publishRota');
  const published = [];
  const scope = {
    _lastSaveFail: '', ROTA_D: 'trinityone/rota:', NET: 'net', sk: new Uint8Array(32).fill(1),
    _addrLocked: () => false, _sealChurchDocReady: async (doc) => JSON.stringify(doc),
    publish: (e) => { published.push(e); return Promise.resolve(true); }, feChurch: (e) => e, now: () => 1000,
    _saveFailed: (why) => { scope._lastSaveFail = why; return null; },
    Promise, JSON, Math, Date, String, Object,
  };
  const fn = new Function('scope', 'with (scope) { return ({ ' + body + ' }); }')(scope);
  return { publishRota: (rota) => fn.publishRota(rota), published };
}
function liftServicesMapper() {
  const body = fnBody(STEWARD, 'subscribeServices(onServices) {', 'subscribeServices');
  let mapper = null;
  const scope = { SERVICE_D: 'trinityone/service:' };
  const fn = new Function('scope', 'with (scope) { return ({ ' + body + ' }); }')(scope);
  fn.subscribeServices.call({ _subAddr: (d, m) => { mapper = m; return () => {}; } }, () => {});
  assert.equal(typeof mapper, 'function', 'subscribeServices handed no mapper — re-anchor');
  return mapper;
}
const dTag = (e) => { const t = (e.tags || []).find(x => x && x[0] === 'd'); return t && t[1]; };

test('through the engine: the moved service replaces the SAME d-address, reads back with the new date, and the rota address never changes', async () => {
  const S = liftPublishService();
  const first = await S.publishService({ id: 'svc1', name: 'Sunday Gathering', date: OWN, time: '10:30' });
  const moved = await S.publishService({ id: 'svc1', name: 'Sunday Gathering', date: TGT, time: '10:30' });
  assert.equal(S.published.length, 2, 'the two writes did not both publish');
  assert.equal(dTag(S.published[0]), 'trinityone/service:svc1', 'the service d-address is not SERVICE_D+id — re-anchor');
  assert.equal(dTag(S.published[1]), dTag(S.published[0]),
    'the move wrote a DIFFERENT address — the relay would keep two services and the rota would point at the old one');
  assert.equal(first.id, moved.id, 'the move minted a new service id');
  const mapped = liftServicesMapper()(JSON.parse(S.published[1].content));
  assert.equal(mapped.date, TGT, 'a reader of the moved doc does not see the new date');
  assert.equal(mapped.time, '10:30', 'the move lost the service time');
  assert.equal(mapped.name, 'Sunday Gathering', 'the move lost the service name');

  // The rota's address is ROTA_D + rota.service — the service ID, never its date — so the SAME rota document
  // keeps covering the moved service.
  const R = liftPublishRota();
  const rota = await R.publishRota({ service: 'svc1', published: true, assign: { 't1::r1': { id: 'm1', name: 'Ann', pub: 'p1' } } });
  assert.equal(dTag(R.published[0]), 'trinityone/rota:svc1', 'the rota d-address is not ROTA_D+serviceId — re-anchor');
  assert.equal(rota.service, moved.id, 'the rota does not reference the moved service by the id the move kept');
});
