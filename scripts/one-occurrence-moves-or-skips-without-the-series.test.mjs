// ONE OCCURRENCE OF A REPEATING EVENT CAN MOVE OR SKIP, WITHOUT TOUCHING THE REST OF THE SERIES.
// calendar-pilot-2026-11-05, items 2 (drag one week to another day) + 4 (skip one week — a one-week break).
// Run: node --test scripts/one-occurrence-moves-or-skips-without-the-series.test.mjs
//
// The mechanism is a per-occurrence `exceptions` map on the SERIES doc, keyed by the occurrence's CANONICAL ISO
// date -> { skip:true } or { date:'<newIso>' }. These tests drive the SHIPPED code, never source text (CLAUDE.md
// rule 3 — app/*.jsx ships UNBUNDLED, so a `false &&` would leave every word in place):
//   - expandEvents is lifted out of app/recur.jsx and RUN (the one walk both shells share): a skip drops ONLY
//     that week, a move relocates ONLY that week, no exceptions == today's baseline byte-for-byte.
//   - DashCalendar is BUILT from app/stew-schedule.jsx and RENDERED: dragging a recurring chip onto a day writes
//     an `exceptions` entry (NOT an anchor move, NOT removeEvent); dragging a one-off changes its own date; and
//     SchEventDetail's "Skip just this week" writes a {skip:true} exception (CLAUDE.md rule 1 — point of use).
//   - publishEvent + subscribeEvents are lifted out of vendor/steward.js and RUN: `exceptions` survives the
//     write->read round-trip, and item-3's imgPos/imgZoom STILL survive beside it (no regression).
//   - _webCopyBody is lifted out of vendor/steward.js and RUN: the public copy now carries `exceptions`.
//   - publicEventFields / buildCalendar are IMPORTED from scripts/public-calendar.mjs and RUN: a skipped week
//     becomes an EXDATE and is omitted; a moved week appears on the NEW day (a standalone VEVENT) and NOT the old.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { fnBody } from './test-slice.mjs';
import { publicEventFields, buildCalendar, unfoldIcs } from './public-calendar.mjs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const RECUR = read('../app/recur.jsx');
const SCHED = read('../app/stew-schedule.jsx');
const STEWARD = read('../vendor/steward.js');
const jsx = (src) => transformSync(src, { loader: 'jsx', jsx: 'transform', jsxFactory: 'h', jsxFragment: 'Frag' }).code;

// ── expandEvents: the shared walk out of app/recur.jsx ───────────────────────────────────────────────────────
function realExpandEvents() {
  const win = {};
  new Function('window', jsx(RECUR))(win);
  assert.equal(typeof win.expandEvents, 'function', 'app/recur.jsx did not define expandEvents — re-anchor');
  return win.expandEvents;
}
const expandEvents = realExpandEvents();

// A weekly series anchored on a Monday well in the past, so its canonical occurrences are every Monday.
const weekly = (exceptions) => ({ id: 's1', title: 'Prayer', time: '19:30', recur: 'weekly', day: 1, date: '2026-01-05', ...(exceptions ? { exceptions } : {}) });

test('no exceptions is the baseline — every week present, byte-for-byte today', () => {
  const out = expandEvents([weekly()], '2026-03-01', 35).filter(o => o.id === 's1');
  const dates = out.map(o => o.date);
  assert.deepEqual(dates, ['2026-03-02', '2026-03-09', '2026-03-16', '2026-03-23', '2026-03-30'],
    'a plain weekly series no longer paints every Monday — back-compat is broken');
  // occDate is the canonical date on every occurrence (needed so a second drag keys off the real date).
  assert.ok(out.every(o => o.occDate === o.date), 'occDate is not stamped equal to the canonical date on a plain series');
});

test('a { skip:true } exception drops ONLY that week; its siblings are untouched', () => {
  const out = expandEvents([weekly({ '2026-03-16': { skip: true } })], '2026-03-01', 35).filter(o => o.id === 's1');
  const dates = out.map(o => o.date);
  assert.ok(!dates.includes('2026-03-16'), 'the skipped week is still on the calendar');
  assert.deepEqual(dates, ['2026-03-02', '2026-03-09', '2026-03-23', '2026-03-30'],
    'skipping one week removed the wrong occurrences (or more than one)');
});

test('a { date:new } exception relocates ONLY that week; the rest stay on their own day', () => {
  const out = expandEvents([weekly({ '2026-03-16': { date: '2026-03-18' } })], '2026-03-01', 35).filter(o => o.id === 's1');
  const dates = out.map(o => o.date).sort();
  assert.ok(!dates.includes('2026-03-16'), 'the moved week still shows on its original day');
  assert.ok(dates.includes('2026-03-18'), 'the moved week did not appear on its new day');
  assert.deepEqual(dates, ['2026-03-02', '2026-03-09', '2026-03-18', '2026-03-23', '2026-03-30'],
    'moving one week disturbed another occurrence');
  const moved = out.find(o => o.date === '2026-03-18');
  assert.equal(moved.occDate, '2026-03-16', 'the moved occurrence lost its canonical date — a second drag would mis-key');
  assert.equal(moved.time, '19:30', 'the moved week lost its time (owner decision: time is unchanged)');
});

// ── DashCalendar: the point of use (drag + skip) ─────────────────────────────────────────────────────────────
function buildSched(stewardStub, events) {
  const states = []; let idx = 0;
  const React = {
    useState(init) { const i = idx++; if (states.length <= i) states.push(typeof init === 'function' ? init() : init); return [states[i], (v) => { states[i] = typeof v === 'function' ? v(states[i]) : v; }]; },
    useEffect() {}, useRef: (v) => ({ current: v === undefined ? null : v }), useMemo: (f) => f(), useCallback: (f) => f, Fragment: 'Frag',
  };
  const h = (type, p, ...kids) => ({ type, props: { ...(p || {}), children: kids.flat() } });
  const nil = () => [];
  // Skip / Remove no longer call confirm(): they set state and SchEventDetail renders the SkConfirm dialog. This
  // harness does not expand child components, so the stub is only an identity the test finds in the tree.
  const SkConfirm = () => null;
  const window = {
    expandEvents, Steward: stewardStub,
    useStewardServices: nil, useStewardEvents: () => events, useStewardRotas: nil, useStewardRosters: nil,
    useStewardGroups: nil, useStewardRsvps: () => ({}), useStewardMembers: nil, useStewardBlocked: nil,
    useStewardRequests: nil, useStewardRequestReplies: nil, useStewardBookings: nil, useStewardRooms: nil,
    useStewardRunsheets: nil, eventImgStyle: () => ({}), confirm: () => true,
  };
  const scope = {
    React, h, Frag: 'Frag', window, Icon: () => null, CustomEvent: class {}, confirm: () => true, SkConfirm,
    useStewDialog: () => ({ current: null }), todayISO: () => '2026-10-01',
    document: { createElement: () => ({ getContext: () => ({ drawImage() {} }), toDataURL: () => 'data:image/jpeg;base64,AAAA' }) },
    Image: class { set src(v) {} }, FileReader: class { readAsDataURL() {} },
  };
  const names = Object.keys(scope);
  const mod = new Function(...names, jsx(SCHED) + '\nreturn { DashCalendar, SchEventDetail };')(...names.map(n => scope[n]));
  return { mod, reset: () => { idx = 0; }, SkConfirm };
}
const flat = (n, out = []) => { if (!n || typeof n !== 'object') return out; if (Array.isArray(n)) { n.forEach(x => flat(x, out)); return out; } out.push(n); flat(n.props && n.props.children, out); return out; };
const stopEv = { preventDefault() {}, stopPropagation() {}, dataTransfer: { setData() {}, effectAllowed: '', dropEffect: '' } };
const pad = (n) => String(n).padStart(2, '0');

// Find the day-cell <button> for a given YYYY-MM-DD in a rendered DashCalendar. Each cell renders its day number
// as its first child div; the view is today's month, so the key is reconstructable (DashCalendar.monKey).
function cellFor(nodes, key, Y, M) {
  for (const n of nodes) {
    if (n.type !== 'button' || !n.props || typeof n.props.onDrop !== 'function') continue;
    const dayDiv = (n.props.children || [])[0];
    const d = dayDiv && dayDiv.props && (dayDiv.props.children || [])[0];
    if (typeof d === 'number' && `${Y}-${pad(M + 1)}-${pad(d)}` === key) return n;
  }
  return null;
}

test('dragging a RECURRING occurrence writes an exceptions entry — NOT an anchor move, NOT removeEvent', () => {
  const calls = [];
  const steward = { publishEvent: (doc) => { calls.push({ fn: 'publishEvent', doc }); return Promise.resolve({ id: doc.id }); }, removeEvent: (id) => calls.push({ fn: 'removeEvent', id }) };
  // A weekly Monday series whose anchor is in the past; choose an occurrence + target inside THIS month's grid.
  const Y = new Date().getFullYear(), M = new Date().getMonth();
  const series = { id: 's1', title: 'Prayer', time: '19:30', recur: 'weekly', day: 1, date: '2020-01-06' };
  const from = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const occs = expandEvents([series], from, 120).filter(o => o.date.startsWith(`${Y}-${pad(M + 1)}`) && Number(o.date.slice(8)) < 27);
  assert.ok(occs.length, 'the fixture series paints no occurrence in the current month — adjust the fixture');
  const occ = occs[0].date;                           // a Monday this month
  const tgt = `${Y}-${pad(M + 1)}-${pad(Number(occ.slice(8)) + 1)}`;   // the day after — same month, a real cell

  const { mod, reset } = buildSched(steward, [series]);
  reset();
  const nodes = flat(mod.DashCalendar());
  const occCell = cellFor(nodes, occ, Y, M);
  assert.ok(occCell, 'no calendar cell for the occurrence day — re-anchor');
  const chip = flat(occCell).find(n => n.type === 'div' && n.props && n.props.draggable && typeof n.props.onDragStart === 'function');
  assert.ok(chip, 'the recurring event chip is not draggable — the move affordance is gone from the screen');
  const tgtCell = cellFor(nodes, tgt, Y, M);
  assert.ok(tgtCell && typeof tgtCell.props.onDrop === 'function', 'the target day is not a drop zone — re-anchor');

  chip.props.onDragStart(stopEv);                     // pick the chip up
  tgtCell.props.onDrop(stopEv);                        // drop it on the next day

  assert.ok(!calls.some(c => c.fn === 'removeEvent'), 'a drag called removeEvent — that would delete the WHOLE series');
  const pub = calls.find(c => c.fn === 'publishEvent');
  assert.ok(pub, 'dropping a recurring occurrence did not publish anything');
  assert.equal(pub.doc.id, 's1', 'the drag published a different document');
  assert.equal(pub.doc.date, '2020-01-06', 'the SERIES ANCHOR was moved — every occurrence would shift');
  assert.deepEqual(pub.doc.exceptions, { [occ]: { date: tgt } }, 'the drag did not write exceptions[canonicalDate] = { date:newDate }');
});

test('dragging a ONE-OFF event changes its own date (no exceptions, no series)', () => {
  const calls = [];
  const steward = { publishEvent: (doc) => { calls.push(doc); return Promise.resolve({ id: doc.id }); }, removeEvent: () => calls.push('remove') };
  const Y = new Date().getFullYear(), M = new Date().getMonth();
  const own = `${Y}-${pad(M + 1)}-10`, tgt = `${Y}-${pad(M + 1)}-12`;
  const oneoff = { id: 'o1', title: 'Fair', time: '12:00', recur: '', date: own };
  const { mod, reset } = buildSched(steward, [oneoff]);
  reset();
  const nodes = flat(mod.DashCalendar());
  const srcCell = cellFor(nodes, own, Y, M);
  const chip = flat(srcCell).find(n => n.type === 'div' && n.props && n.props.draggable);
  assert.ok(chip, 'a one-off event chip is not draggable');
  chip.props.onDragStart(stopEv);
  cellFor(nodes, tgt, Y, M).props.onDrop(stopEv);
  assert.equal(calls.length, 1, 'a one-off drag did not publish exactly once');
  assert.equal(calls[0].date, tgt, 'the one-off did not move to the dropped day');
  assert.ok(!calls[0].exceptions || !Object.keys(calls[0].exceptions).length, 'a one-off grew an exceptions map');
});

test('"Skip just this week" writes a { skip:true } exception, never removeEvent', () => {
  const calls = [];
  const steward = { publishEvent: (doc) => { calls.push({ fn: 'publishEvent', doc }); return Promise.resolve({}); }, removeEvent: (id) => calls.push({ fn: 'removeEvent', id }) };
  const { mod, reset, SkConfirm } = buildSched(steward, []);
  reset();
  // An expanded occurrence, exactly as DashCalendar hands SchEventDetail: date = this week, seriesDate = anchor,
  // occDate = canonical date, exceptions = whatever the series already carries.
  const occ = { id: 's1', title: 'Prayer', time: '19:30', recur: 'weekly', day: 1, date: '2026-03-16', seriesDate: '2026-01-05', occDate: '2026-03-16', recurring: true, exceptions: {} };
  let closed = 0;
  const draw = () => { reset(); return flat(mod.SchEventDetail({ event: occ, onClose() { closed++; } })); };
  const label = (n) => flat(n).length && (function t(x) { if (x == null) return ''; if (typeof x === 'string' || typeof x === 'number') return String(x); if (Array.isArray(x)) return x.map(t).join(''); return x.props ? t(x.props.children) : ''; })(n);
  // The Skip button is found by what it SAYS on screen, then RUN (CLAUDE.md rule 3: no behaviour is asserted from text).
  // It asks first now: the press opens the SkConfirm dialog, and only the dialog's Confirm writes the exception.
  const skip = draw().find(n => n.type === 'button' && n.props && typeof n.props.onClick === 'function' && /Skip just this week/.test(label(n)));
  assert.ok(skip, 'SchEventDetail shows no "Skip just this week" control on a recurring occurrence');
  assert.equal(draw().filter(n => n.type === SkConfirm).length, 0, 'a confirm dialog is on screen before anything was pressed');
  skip.props.onClick();
  assert.equal(calls.length, 0, 'pressing Skip wrote something before the steward confirmed');
  const dialogs = draw().filter(n => n.type === SkConfirm);
  assert.equal(dialogs.length, 1, 'pressing Skip did not open the confirm dialog');
  assert.equal(dialogs[0].props.confirmLabel, 'Skip', 'the dialog on screen is not the Skip one');
  dialogs[0].props.onConfirm();
  assert.equal(closed, 1, 'the card did not close after the skip was confirmed');
  assert.ok(!calls.some(c => c.fn === 'removeEvent'), 'Skip called removeEvent — that deletes the whole series');
  const pub = calls.find(c => c.fn === 'publishEvent');
  assert.ok(pub, 'Skip did not publish');
  assert.equal(pub.doc.date, '2026-01-05', 'Skip moved the series anchor');
  assert.deepEqual(pub.doc.exceptions, { '2026-03-16': { skip: true } }, 'Skip did not write exceptions[date] = { skip:true }');
});

// REMOVE ASKS FIRST TOO (CLAUDE.md rule 1 — point of use). The Remove button only sets state now; the SkConfirm
// dialog is what calls removeEvent. With the dialog deleted from SchEventDetail the button does nothing at all, and
// the Skip test above cannot see that: it never presses Remove. Same harness, same card, the other button.
function removeHarness(event) {
  const calls = [];
  const steward = { publishEvent: (doc) => { calls.push({ fn: 'publishEvent', doc }); return Promise.resolve({}); }, removeEvent: (id) => calls.push({ fn: 'removeEvent', id }) };
  const { mod, reset, SkConfirm } = buildSched(steward, []);
  let closed = 0;
  const draw = () => { reset(); return flat(mod.SchEventDetail({ event, onClose() { closed++; } })); };
  const label = (x) => { if (x == null) return ''; if (typeof x === 'string' || typeof x === 'number') return String(x); if (Array.isArray(x)) return x.map(label).join(''); return x.props ? label(x.props.children) : ''; };
  // Found by what it SAYS on screen ("Remove" / "Remove series"), then RUN.
  const removeBtn = (re) => draw().find(n => n.type === 'button' && n.props && typeof n.props.onClick === 'function' && re.test(label(n).trim()));
  const dialogs = () => draw().filter(n => n.type === SkConfirm);
  return { calls, removeBtn, dialogs, closed: () => closed };
}
const ONE_OFF = { id: 'o1', title: 'Fair', time: '12:00', recur: '', date: '2026-03-16' };
const SERIES_OCC = { id: 's1', title: 'Prayer', time: '19:30', recur: 'weekly', day: 1, date: '2026-03-16', seriesDate: '2026-01-05', occDate: '2026-03-16', recurring: true, exceptions: {} };

test('"Remove" on a one-off opens the confirm, and removes nothing until it is confirmed', () => {
  const h = removeHarness(ONE_OFF);
  const btn = h.removeBtn(/^Remove$/);
  assert.ok(btn, 'SchEventDetail shows no "Remove" control on a one-off event');
  assert.equal(h.dialogs().length, 0, 'a confirm dialog is on screen before anything was pressed');
  btn.props.onClick();
  assert.equal(h.calls.length, 0, 'pressing Remove wrote something before the steward confirmed');
  const dlg = h.dialogs();
  assert.equal(dlg.length, 1, 'pressing Remove did not open the confirm dialog — the button now does nothing');
  assert.equal(dlg[0].props.confirmLabel, 'Remove', 'the dialog on screen is not the Remove one');
  assert.equal(dlg[0].props.title, 'Remove this event?', 'a one-off is asked about as if it were something else');
  assert.match(dlg[0].props.body, /Fair/, 'the confirm does not name the event');
  assert.equal(h.closed(), 0, 'the card closed before the steward answered');
});

test('cancelling the Remove confirm removes nothing and leaves the card open', () => {
  const h = removeHarness(ONE_OFF);
  h.removeBtn(/^Remove$/).props.onClick();
  h.dialogs()[0].props.onCancel();
  assert.equal(h.calls.length, 0, 'the event was removed (or republished) even though the steward cancelled');
  assert.equal(h.dialogs().length, 0, 'the confirm stayed on screen after Cancel');
  assert.equal(h.closed(), 0, 'cancelling the confirm closed the event card');
});

test('confirming Remove calls removeEvent for THAT event, once, and closes the card', () => {
  const h = removeHarness(ONE_OFF);
  h.removeBtn(/^Remove$/).props.onClick();
  h.dialogs()[0].props.onConfirm();
  assert.deepEqual(h.calls, [{ fn: 'removeEvent', id: 'o1' }], 'confirming Remove did not call removeEvent(id) exactly once and nothing else');
  assert.equal(h.closed(), 1, 'the card did not close after the event was removed');
});

test('on a repeating meeting the button says "Remove series", the confirm says ALL its repeats, and it removes the doc', () => {
  const h = removeHarness(SERIES_OCC);
  assert.equal(h.removeBtn(/^Remove$/), undefined, 'a repeating meeting offers a bare "Remove" — it reads as "just this date" and deletes every one');
  const btn = h.removeBtn(/^Remove series$/);
  assert.ok(btn, 'SchEventDetail shows no "Remove series" control on a repeating meeting');
  btn.props.onClick();
  assert.equal(h.calls.length, 0, 'pressing Remove series wrote something before the steward confirmed');
  const dlg = h.dialogs();
  assert.equal(dlg.length, 1, 'pressing Remove series did not open the confirm dialog');
  assert.equal(dlg[0].props.title, 'Remove this series?');
  assert.match(dlg[0].props.body, /ALL its repeats/, 'the confirm does not say the whole series goes');
  dlg[0].props.onConfirm();
  // NOT a skip: nothing is published, the series document itself is removed.
  assert.deepEqual(h.calls, [{ fn: 'removeEvent', id: 's1' }], 'confirming Remove series did not call removeEvent(seriesId) and nothing else');
  assert.equal(h.closed(), 1, 'the card did not close after the series was removed');
});

// ── round-trip through vendor/steward.js: exceptions survive, and item-3's imgPos/imgZoom still do ────────────
function realImgNorms() {
  return new Function(fnBody(STEWARD, 'function _evImgPos(p) {') + '\n' + fnBody(STEWARD, 'function _evImgZoom(z) {') + '\nreturn { _evImgPos, _evImgZoom };')();
}
function realEvExceptions() {
  const cap = STEWARD.match(/EV_EXC_MAX\s*=\s*([0-9eExX.+]+)/);
  assert.ok(cap, 'EV_EXC_MAX is gone — re-anchor');
  return new Function('const EV_EXC_MAX = ' + cap[1] + ';\n' + fnBody(STEWARD, 'function _evExceptions(x) {') + '\nreturn _evExceptions;')();
}
const norms = realImgNorms();
const _evExceptions = realEvExceptions();

async function publishDoc(ev) {
  const body = fnBody(STEWARD, 'async publishEvent(ev, asPub) {', 'publishEvent');
  let sealed = null;
  const scope = {
    skFor: () => new Uint8Array(32).fill(1), _evtSeq: 0, EVENT_D: 'trinityone/event:', NET: 'net', actingChurch: '',
    _sealChurchDocReady: async (doc) => JSON.stringify(doc), publish: (e) => { sealed = e.content; return Promise.resolve(true); },
    feChurch: (e) => e, now: () => 1000, _evImgPos: norms._evImgPos, _evImgZoom: norms._evImgZoom, _evExceptions,
    Promise, JSON, Math, Date, String, Object, isFinite,
  };
  const fn = new Function('scope', 'with (scope) { return ({ ' + body + ' }); }')(scope);
  const result = await fn.publishEvent(ev);
  return { result, doc: JSON.parse(sealed) };
}
function readMapper() {
  const body = fnBody(STEWARD, 'subscribeEvents(onEvents) {', 'subscribeEvents');
  let mapper = null;
  const scope = { EVENT_D: 'trinityone/event:', _evImgPos: norms._evImgPos, _evImgZoom: norms._evImgZoom, _evExceptions };
  const fn = new Function('scope', 'with (scope) { return ({ ' + body + ' }); }')(scope);
  fn.subscribeEvents.call({ _subAddr: (d, m) => { mapper = m; return () => {}; } }, () => {});
  assert.equal(typeof mapper, 'function', 'subscribeEvents handed no mapper — re-anchor');
  return mapper;
}

test('exceptions survive publishEvent -> subscribeEvents, and imgPos/imgZoom STILL do (item-3 no regression)', async () => {
  const ex = { '2026-03-16': { skip: true }, '2026-03-30': { date: '2026-04-01' } };
  const { doc } = await publishDoc({ title: 'Prayer', date: '2026-01-05', time: '19:30', recur: 'weekly', day: 1, exceptions: ex, imgPos: { x: 30, y: 70 }, imgZoom: 3 });
  assert.deepEqual(doc.exceptions, ex, 'publishEvent dropped exceptions from the sealed doc');
  assert.deepEqual(doc.imgPos, { x: 30, y: 70 }, 'item-3 regressed: publishEvent dropped imgPos');
  assert.equal(doc.imgZoom, 3, 'item-3 regressed: publishEvent dropped imgZoom');
  const mapped = readMapper()(doc);
  assert.deepEqual(mapped.exceptions, ex, 'subscribeEvents dropped exceptions on read — a reader that cannot honour a move/skip');
  assert.deepEqual(mapped.imgPos, { x: 30, y: 70 }, 'item-3 regressed: subscribeEvents dropped imgPos on read');
  assert.equal(mapped.imgZoom, 3, 'item-3 regressed: subscribeEvents dropped imgZoom on read');
});

test('_evExceptions is the gate: sorted keys, junk dropped, bounded, {} for no map', () => {
  assert.deepEqual(_evExceptions(undefined), {}, 'a missing map is not {}');
  assert.deepEqual(_evExceptions({ 'not-a-date': { skip: true }, '2026-03-02': { nonsense: 1 }, '2026-03-09': { date: 'bad' } }), {},
    'junk keys/values were not dropped');
  // keys come back sorted (byte-determinism for the public copy's reconciler)
  const out = _evExceptions({ '2026-03-30': { skip: true }, '2026-03-02': { date: '2026-03-04' } });
  assert.deepEqual(Object.keys(out), ['2026-03-02', '2026-03-30'], 'exception keys are not sorted — bytes would differ across consoles');
  assert.deepEqual(out, { '2026-03-02': { date: '2026-03-04' }, '2026-03-30': { skip: true } });
  // bounded
  const big = {}; for (let i = 0; i < 500; i++) big[`2026-${pad(1 + (i % 12))}-${pad(1 + (i % 27))}`] = { skip: true };
  assert.ok(Object.keys(_evExceptions(big)).length <= 200, 'the exceptions map is not bounded');
});

// ── the public copy + the .ics feed ──────────────────────────────────────────────────────────────────────────
function realWebCopyBody() {
  const cap = STEWARD.match(/WEB_IMG_MAX\s*=\s*([0-9eExX.+]+)/);
  const capExc = STEWARD.match(/EV_EXC_MAX\s*=\s*([0-9eExX.+]+)/);
  assert.ok(cap && capExc, 'WEB_IMG_MAX / EV_EXC_MAX is gone — re-anchor');
  const parts = [
    'const WEB_IMG_MAX = ' + cap[1] + ';', 'const EV_EXC_MAX = ' + capExc[1] + ';',
    fnBody(STEWARD, 'function _evImgPos(p) {'), fnBody(STEWARD, 'function _evImgZoom(z) {'),
    fnBody(STEWARD, 'function _evExceptions(x) {'), fnBody(STEWARD, 'function _webImg(ev) {'),
    fnBody(STEWARD, 'function _webCopyBody(ev) {'), 'return { _webCopyBody };',
  ];
  return new Function(parts.join('\n'))()._webCopyBody;
}
const _webCopyBody = realWebCopyBody();

test('_webCopyBody carries the exceptions map into the public copy (it carried none before)', () => {
  const ex = { '2026-03-16': { skip: true }, '2026-03-30': { date: '2026-04-01' } };
  const body = JSON.parse(_webCopyBody({ title: 'Prayer', date: '2026-01-05', time: '19:30', recur: 'weekly', day: 1, exceptions: ex }));
  assert.deepEqual(body.exceptions, ex, 'the public copy did not carry exceptions — a skipped/moved week would not reach the feed');
  const plain = JSON.parse(_webCopyBody({ title: 'Meet', date: '2026-01-05', time: '19:30', recur: 'weekly', day: 1 }));
  assert.deepEqual(plain.exceptions, {}, 'an event with no exceptions must carry {} (deterministic bytes)');
});

test('publicEventFields admits exceptions on a series and strips them from a one-off', () => {
  const ex = { '2026-03-16': { skip: true } };
  const s = publicEventFields({ id: 's1', date: '2026-01-05', time: '19:30', recur: 'weekly', day: 1, exceptions: ex });
  assert.deepEqual(s.exceptions, ex, 'the relay dropped exceptions off a series');
  const o = publicEventFields({ id: 'o1', date: '2026-03-16', time: '12:00', exceptions: ex });
  assert.deepEqual(o.exceptions, {}, 'a one-off kept an exceptions map — only a repeating event can have one');
});

// RFC-5545: a skip is an EXDATE; a move is an EXDATE on the original + a standalone VEVENT on the new day.
const veventCount = (ics) => (ics.match(/BEGIN:VEVENT/g) || []).length;

test('a SKIPPED week is EXDATE-d out of the series and gets no replacement VEVENT', () => {
  const ics = unfoldIcs(buildCalendar([{ id: 's1', title: 'Prayer', date: '2026-09-02', time: '19:30', recur: 'weekly', day: 0, exceptions: { '2026-09-20': { skip: true } } }], { uidScope: 'x' }));
  assert.match(ics, /DTSTART:20260906T193000/, 'the series DTSTART is gone — re-anchor');
  assert.match(ics, /RRULE:FREQ=WEEKLY;BYDAY=SU/, 'the series RRULE is gone');
  assert.match(ics, /EXDATE:20260920T193000/, 'the skipped week was not EXDATE-d (its time must match DTSTART)');
  assert.equal(veventCount(ics), 1, 'a skip added a stray VEVENT — a skip removes an instance, it does not add one');
});

test('a MOVED week shows on the NEW day (a standalone VEVENT) and NOT the original', () => {
  const ics = unfoldIcs(buildCalendar([{ id: 's1', title: 'Prayer', date: '2026-09-02', time: '19:30', recur: 'weekly', day: 0, exceptions: { '2026-09-13': { date: '2026-09-15' } } }], { uidScope: 'x' }));
  assert.match(ics, /EXDATE:20260913T193000/, 'the moved week was not EXDATE-d off its original day');
  assert.match(ics, /DTSTART:20260915T193000/, 'the moved week does not appear on its new day');
  assert.doesNotMatch(ics, /DTSTART:20260913/, 'the original day still carries a DTSTART — the week shows on both days');
  assert.equal(veventCount(ics), 2, 'a move must be exactly the series VEVENT plus one standalone VEVENT for the new day');
  assert.match(ics, /UID:trinityone-s1-ex-20260913@x/, 'the moved VEVENT has no stable, distinct UID');
});

test('an ALL-DAY series EXDATEs with VALUE=DATE (matching its DTSTART value type)', () => {
  const ics = unfoldIcs(buildCalendar([{ id: 's1', title: 'Fast', date: '2026-09-02', recur: 'weekly', day: 0, exceptions: { '2026-09-20': { skip: true } } }], { uidScope: 'x' }));
  assert.match(ics, /DTSTART;VALUE=DATE:20260906/, 'an all-day series lost its DATE-valued DTSTART');
  assert.match(ics, /EXDATE;VALUE=DATE:20260920/, 'an all-day EXDATE must be VALUE=DATE, not a date-time');
});

test('a series with NO exceptions produces exactly the pre-feature .ics (no EXDATE, one VEVENT)', () => {
  const ics = buildCalendar([{ id: 's1', title: 'Prayer', date: '2026-09-02', time: '19:30', recur: 'weekly', day: 0 }], { uidScope: 'x' });
  assert.doesNotMatch(ics, /EXDATE/, 'a plain series grew an EXDATE line');
  assert.equal(veventCount(ics), 1, 'a plain series is still one VEVENT');
});
