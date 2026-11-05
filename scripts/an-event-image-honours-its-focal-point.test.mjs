// AN EVENT COVER IMAGE KEEPS ITS FOCAL POINT + ZOOM, EVERYWHERE IT SHOWS (calendar-pilot-2026-11-05, item 3).
// Run: node --test scripts/an-event-image-honours-its-focal-point.test.mjs
//
// A steward can set where an event photo is framed (focal point) and how far it is zoomed, instead of a silent
// centre-crop, and that framing must survive a round-trip through the sealed event doc AND ride into the
// SIZE-CAPPED public copy. These tests drive the SHIPPED code, never source text (CLAUDE.md rule 3):
//   - eventImgStyle is lifted out of app/recur.jsx and RUN (the render math every surface shares).
//   - publishEvent's doc and subscribeEvents' mapper are lifted out of vendor/steward.js and RUN (the two
//     whitelist points a field can be dropped at), proving imgPos/imgZoom survive the write->read round-trip.
//   - _webCopyBody (+ its size cap) is lifted out of vendor/steward.js and RUN, proving the public copy now
//     carries a capped image + focal point where before it carried NO image.
//   - publicEventFields / buildCalendar are IMPORTED from scripts/public-calendar.mjs and RUN, proving the
//     relay admits the image into its public map but keeps it OUT of the .ics feed (item-3 decision).
//   - SchEventEdit is lifted out of app/stew-schedule.jsx and RENDERED, proving the (re)picker exists and that
//     changing the zoom flows through to the publishEvent call (CLAUDE.md rule 1: a point-of-use test).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { fnBody } from './test-slice.mjs';
import { publicEventFields, buildCalendar } from './public-calendar.mjs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const RECUR = read('../app/recur.jsx');
const SCHED = read('../app/stew-schedule.jsx');
const STEWARD = read('../vendor/steward.js');
const jsx = (src) => transformSync(src, { loader: 'jsx', jsx: 'transform', jsxFactory: 'h', jsxFragment: 'Frag' }).code;

// ── eventImgStyle: the shared render math out of app/recur.jsx ───────────────────────────────────────────────
function realEventImgStyle() {
  const win = {};
  new Function('window', jsx(RECUR))(win);
  assert.equal(typeof win.eventImgStyle, 'function', 'app/recur.jsx did not define eventImgStyle - re-anchor');
  return win.eventImgStyle;
}
const eventImgStyle = realEventImgStyle();

test('no focal point and no zoom is byte-for-byte the old centre cover', () => {
  // The back-compat default: every event made before this feature has neither value and must look EXACTLY as it
  // did - a bare objectFit:cover, whose implicit objectPosition is 50% 50%, with no transform.
  assert.deepEqual(eventImgStyle(null, undefined), { objectFit: 'cover', objectPosition: '50% 50%' });
  assert.deepEqual(eventImgStyle({ x: 50, y: 50 }, 1), { objectFit: 'cover', objectPosition: '50% 50%' });
  assert.equal('transform' in eventImgStyle(null, 1), false, 'a default image must carry no transform');
});

test('a focal point becomes the objectPosition', () => {
  const s = eventImgStyle({ x: 20, y: 80 }, 1);
  assert.equal(s.objectPosition, '20% 80%', 'the focal point did not reach objectPosition');
  assert.equal(s.objectFit, 'cover');
});

test('zoom becomes a scale transform anchored at the focal point', () => {
  const s = eventImgStyle({ x: 25, y: 75 }, 2.5);
  assert.equal(s.transform, 'scale(2.5)', 'zoom did not become a scale()');
  assert.equal(s.transformOrigin, '25% 75%', 'the scale is not anchored at the focal point');
  assert.equal(s.objectPosition, '25% 75%');
});

test('out-of-range focal point and zoom are clamped, never passed through raw', () => {
  const s = eventImgStyle({ x: -40, y: 400 }, 99);
  assert.equal(s.objectPosition, '0% 100%', 'focal point was not clamped to 0..100');
  assert.equal(s.transform, 'scale(6)', 'zoom was not clamped to the 6x ceiling');
});

// ── the public copy: _webCopyBody out of vendor/steward.js ───────────────────────────────────────────────────
// _webCopyBody calls _webImg (which reads the WEB_IMG_MAX const) and _evImgPos/_evImgZoom. All four are pure
// top-level functions in the bundle; lift them together and run the REAL public-copy builder.
function realWebCopyBody() {
  const cap = STEWARD.match(/WEB_IMG_MAX\s*=\s*([0-9eExX.+]+)/);   // esbuild rewrites 60000 -> 6e4, so capture the whole literal
  assert.ok(cap, 'WEB_IMG_MAX is gone - re-anchor');
  const parts = [
    'const WEB_IMG_MAX = ' + cap[1] + ';',
    fnBody(STEWARD, 'function _evImgPos(p) {'),
    fnBody(STEWARD, 'function _evImgZoom(z) {'),
    fnBody(STEWARD, 'function _webImg(ev) {'),
    fnBody(STEWARD, 'function _webCopyBody(ev) {'),
    'return { _webCopyBody, WEB_IMG_MAX };',
  ];
  return new Function(parts.join('\n'))();
}
const { _webCopyBody, WEB_IMG_MAX } = realWebCopyBody();
const dataUri = (n) => 'data:image/jpeg;base64,' + 'A'.repeat(n);

test('_webCopyBody now carries the size-capped image AND its focal point (it carried NO image before)', () => {
  const pub = dataUri(200), full = dataUri(5000);
  const body = JSON.parse(_webCopyBody({ title: 'Picnic', date: '2026-07-01', time: '12:00', image: full, imgPub: pub, imgPos: { x: 20, y: 80 }, imgZoom: 2 }));
  assert.equal(body.image, pub, 'the public copy did not carry the small imgPub variant');
  assert.notEqual(body.image, full, 'the public copy carried the FULL in-app image, not the capped variant');
  assert.deepEqual(body.imgPos, { x: 20, y: 80 }, 'the focal point did not reach the public copy');
  assert.equal(body.imgZoom, 2, 'the zoom did not reach the public copy');
});

test('a public image over the cap is refused outright, never sliced into a corrupt data: URI', () => {
  const body = JSON.parse(_webCopyBody({ title: 'X', date: '2026-07-01', time: '12:00', image: dataUri(WEB_IMG_MAX + 10), imgPub: dataUri(WEB_IMG_MAX + 10) }));
  assert.equal(body.image, '', 'an over-cap image was carried into the public copy - the size cap is defeated');
});

test('an event with no image is unchanged: empty image, centre, scale 1 - the pre-feature bytes', () => {
  const body = JSON.parse(_webCopyBody({ title: 'Meet', date: '2026-07-01', time: '12:00' }));
  assert.equal(body.image, '');
  assert.equal(body.imgPos, null);
  assert.equal(body.imgZoom, 1);
});

// ── round-trip: publishEvent -> subscribeEvents, both lifted from vendor/steward.js ───────────────────────────
function realImgNorms() {
  return new Function(fnBody(STEWARD, 'function _evImgPos(p) {') + '\n' + fnBody(STEWARD, 'function _evImgZoom(z) {') + '\nreturn { _evImgPos, _evImgZoom };')();
}
const norms = realImgNorms();

async function publishDoc(ev) {
  const body = fnBody(STEWARD, 'async publishEvent(ev, asPub) {', 'publishEvent');
  let sealed = null;
  const scope = {
    skFor: () => new Uint8Array(32).fill(1), _evtSeq: 0, EVENT_D: 'trinityone/event:', NET: 'net', actingChurch: '',
    _sealChurchDocReady: async (doc) => JSON.stringify(doc),   // identity "seal" so the round-trip is readable
    publish: (e) => { sealed = e.content; return Promise.resolve(true); }, feChurch: (e) => e, now: () => 1000,
    _evImgPos: norms._evImgPos, _evImgZoom: norms._evImgZoom, Promise, JSON, Math, Date, String, Object, isFinite,
  };
  const fn = new Function('scope', 'with (scope) { return ({ ' + body + ' }); }')(scope);
  const result = await fn.publishEvent(ev);
  return { result, doc: JSON.parse(sealed) };
}
function readMapper() {
  const body = fnBody(STEWARD, 'subscribeEvents(onEvents) {', 'subscribeEvents');
  let mapper = null;
  const scope = { EVENT_D: 'trinityone/event:', _evImgPos: norms._evImgPos, _evImgZoom: norms._evImgZoom };
  const fn = new Function('scope', 'with (scope) { return ({ ' + body + ' }); }')(scope);
  fn.subscribeEvents.call({ _subAddr: (d, m) => { mapper = m; return () => {}; } }, () => {});
  assert.equal(typeof mapper, 'function', 'subscribeEvents handed no mapper - re-anchor');
  return mapper;
}

test('imgPos/imgZoom survive publishEvent -> subscribeEvents (the sealed doc and the read mapper)', async () => {
  const { doc } = await publishDoc({ title: 'Walk', date: '2026-08-02', time: '09:30', image: dataUri(50), imgPub: dataUri(20), imgPos: { x: 30, y: 70 }, imgZoom: 3 });
  assert.deepEqual(doc.imgPos, { x: 30, y: 70 }, 'publishEvent dropped imgPos from the sealed doc');
  assert.equal(doc.imgZoom, 3, 'publishEvent dropped imgZoom from the sealed doc');
  assert.equal(doc.imgPub, dataUri(20), 'publishEvent dropped the public variant from the sealed doc');

  const mapped = readMapper()(doc);
  assert.deepEqual(mapped.imgPos, { x: 30, y: 70 }, 'subscribeEvents dropped imgPos on read - a reader that cannot frame the image');
  assert.equal(mapped.imgZoom, 3, 'subscribeEvents dropped imgZoom on read');
  assert.equal(mapped.image, dataUri(50), 'subscribeEvents dropped the image on read');
});

test('a centre focal point round-trips as null, so an unmoved image keeps the old bytes', async () => {
  const { doc } = await publishDoc({ title: 'Plain', date: '2026-08-02', time: '09:30', image: dataUri(10), imgPos: { x: 50, y: 50 }, imgZoom: 1 });
  assert.equal(doc.imgPos, null, 'a centre focal point was stored as {50,50} instead of null - needless republish churn');
  assert.equal(doc.imgZoom, 1);
});

// ── the relay public path: publicEventFields admits it, the .ics never carries it ────────────────────────────
test('publicEventFields admits the capped image + focal point', () => {
  const f = publicEventFields({ id: 'e1', date: '2026-09-01', time: '19:30', title: 'Service', image: dataUri(100), imgPos: { x: 10, y: 90 }, imgZoom: 2 });
  assert.equal(f.image, dataUri(100), 'the relay dropped the public image');
  assert.deepEqual(f.imgPos, { x: 10, y: 90 }, 'the relay dropped the focal point');
  assert.equal(f.imgZoom, 2, 'the relay dropped the zoom');
});

test('publicEventFields re-caps a mislabeled oversize image to empty (the relay-side backstop)', () => {
  const f = publicEventFields({ id: 'e1', date: '2026-09-01', time: '19:30', title: 'Service', image: dataUri(200000) });
  assert.equal(f.image, '', 'the relay carried a 200 KB image into its public map');
});

test('the .ics feed carries NO image data, by the item-3 decision', () => {
  // The decision for item 3: honour the image on the public PAGE (via the per-church map), keep the calendar
  // FEED lean so a phone subscription is not a megabyte. buildCalendar must never serialise a data: URI.
  const ics = buildCalendar([{ id: 'e1', date: '2026-09-01', time: '19:30', title: 'Service', blurb: 'All welcome', image: dataUri(100), imgPos: { x: 10, y: 90 }, imgZoom: 2 }], { name: 'Grace' });
  assert.match(ics, /BEGIN:VEVENT/, 'the event was not placed on the calendar at all - re-anchor');
  assert.equal(/data:image/.test(ics), false, 'a data: URI leaked into the .ics feed - subscriptions would bloat');
  assert.equal(/imgPos|imgZoom/.test(ics), false, 'focal-point fields leaked into the .ics feed');
});

// ── point of use: SchEventEdit now has a (re)picker, and the zoom reaches publishEvent ───────────────────────
function mountEventEdit(event, steward) {
  const states = [];
  let idx = 0;
  const React = {
    useState(init) { const i = idx++; if (states.length <= i) states.push(typeof init === 'function' ? init() : init); return [states[i], (v) => { states[i] = typeof v === 'function' ? v(states[i]) : v; }]; },
    useEffect() {}, useRef: (v) => ({ current: v === undefined ? null : v }), Fragment: 'Frag',
  };
  const h = (type, props, ...kids) => ({ type, props: { ...(props || {}), children: kids.flat() } });
  const window = { eventImgStyle: eventImgStyle, Steward: steward };
  // SCH_MAX_DATE / SchWebsiteHeldRow / SchWebsiteShownRow are declared IN the module - do NOT also pass them, or
  // the Function body has a param and a const of the same name (a SyntaxError). SchModal/Icon are external, so stub.
  const scope = {
    React, h, Frag: 'Frag', window, Icon: () => null, CustomEvent: class {},
    SchModal: (p) => h('modal', p, p.children),
    document: { createElement: () => ({ getContext: () => ({ drawImage() {} }), toDataURL: () => dataUri(10) }) },
    Image: class { set src(v) {} }, FileReader: class { readAsDataURL() {} },
  };
  const names = Object.keys(scope);
  const mod = new Function(...names, jsx(SCHED) + '\nreturn { SchEventEdit, SchCoverField };')(...names.map(n => scope[n]));
  const flat = (n, out = []) => { if (!n || typeof n !== 'object') return out; if (Array.isArray(n)) { n.forEach(x => flat(x, out)); return out; } out.push(n); flat(n.props && n.props.children, out); return out; };
  const renderEdit = () => { idx = 0; return flat(mod.SchEventEdit({ event, onClose() {} })); };
  // SchCoverField is a child component; h() does not execute it, so render it by hand to reach its controls.
  const renderCover = (editNodes) => { const cf = editNodes.find(n => n.type === mod.SchCoverField); assert.ok(cf, 'SchEventEdit renders no SchCoverField - the image (re)picker is gone'); return { onChange: cf.props.onChange, nodes: flat(mod.SchCoverField(cf.props)) }; };
  return { renderEdit, renderCover };
}

test('SchEventEdit renders an image (re)picker - it had NONE before', () => {
  const m = mountEventEdit({ id: 'e1', title: 'Fair', image: dataUri(40) }, { isDelegated: () => false });
  const cover = m.renderCover(m.renderEdit());
  const fileInput = cover.nodes.find(n => n.type === 'input' && n.props && n.props.type === 'file');
  assert.ok(fileInput, 'no file input in the cover field - an event image still cannot be changed after creation');
});

test('changing the zoom flows through SchEventEdit to the publishEvent call', async () => {
  let captured = null;
  const steward = { isDelegated: () => false, publishEvent: async (doc) => { captured = doc; return { id: 'e1', ...doc }; } };
  const m = mountEventEdit({ id: 'e1', title: 'Fair', image: dataUri(40), imgPos: { x: 50, y: 50 }, imgZoom: 1 }, steward);
  // drive the real zoom slider inside the real cover field
  const cover = m.renderCover(m.renderEdit());
  const zoom = cover.nodes.find(n => n.type === 'input' && n.props && n.props.type === 'range');
  assert.ok(zoom, 'the cover field shows no zoom slider when an image is present');
  zoom.props.onChange({ target: { value: '2.5' } });   // calls cover onChange -> SchEventEdit setters

  const nodes = m.renderEdit();
  const save = nodes.find(n => n.props && typeof n.props.onClick === 'function' && String(n.props.onClick).includes('publishEvent'));
  assert.ok(save, 'no Save button wired to publishEvent - re-anchor');
  await save.props.onClick();
  assert.ok(captured, 'Save did not call publishEvent');
  assert.equal(captured.imgZoom, 2.5, 'the zoom the steward set did not reach publishEvent');
});

test('an unchanged edit still passes the existing focal point through (the control for the test above)', async () => {
  let captured = null;
  const steward = { isDelegated: () => false, publishEvent: async (doc) => { captured = doc; return { id: 'e1', ...doc }; } };
  const m = mountEventEdit({ id: 'e1', title: 'Fair', image: dataUri(40), imgPos: { x: 15, y: 85 }, imgZoom: 2 }, steward);
  const nodes = m.renderEdit();
  const save = nodes.find(n => n.props && typeof n.props.onClick === 'function' && String(n.props.onClick).includes('publishEvent'));
  await save.props.onClick();
  assert.deepEqual(captured.imgPos, { x: 15, y: 85 }, 'editing an event lost its focal point - the pass-through is broken');
  assert.equal(captured.imgZoom, 2);
});
