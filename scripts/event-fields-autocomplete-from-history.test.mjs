// THE EVENT COMPOSE FORM LETS A STEWARD PICK NAME / WHERE / IMAGE FROM THE CHURCH'S OWN PAST VALUES, AND
// THE THREE PICKERS ARE INDEPENDENT (calendar-pilot-2026-11-05, item 5).
// Run: node --test scripts/event-fields-autocomplete-from-history.test.mjs
//
// THE FEATURE. SchEventModal (app/stew-schedule.jsx) already loads the church's own events via
// window.useStewardEvents() for the clash check; each carries title/where/image. This build derives the
// DISTINCT past values from that list (module-scope pure helper eventHistory) and offers them back:
//   - Name  -> <input list="sch-event-names">  + <datalist> of distinct titles
//   - Where -> <input list="sch-event-wheres"> + <datalist> of distinct wheres
//   - Image -> a thumbnail picker (a datalist cannot preview images) of distinct past covers
// OWNER DECISION: the three fields are INDEPENDENT — picking a past Name must NOT auto-fill Where or Image.
//
// POINT OF USE (CLAUDE.md rule 1) and NO TEXT-MATCHING JSX (rule 3): app/stew-schedule.jsx ships UNBUNDLED,
// so a `false &&` guard would leave every word in place and a grep would still pass. These tests LIFT the
// real eventHistory out of the file and RUN it, and RENDER the real SchEventModal and read its real input
// `list` wiring, its real <datalist> options and its real image-picker onClick — then FIRE those handlers
// and RE-READ the component's state to prove independence. Nothing asserts behaviour by matching source text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const SCHED = read('../app/stew-schedule.jsx');
const jsx = (src) => transformSync(src, { loader: 'jsx', jsx: 'transform', jsxFactory: 'h', jsxFragment: 'Frag' }).code;

// ── tree helpers (expand function components, flatten, read text) ─────────────────────────────────────────────
const h = (type, p, ...kids) => ({ type, props: { ...(p || {}), children: kids.flat() } });
const expand = (n) => {
  if (Array.isArray(n)) return n.map(expand);
  if (!n || typeof n !== 'object') return n;
  if (typeof n.type === 'function') return expand(n.type(n.props));
  return { ...n, props: { ...n.props, children: expand(n.props.children) } };
};
const flat = (n, out = []) => { if (Array.isArray(n)) n.forEach(x => flat(x, out)); else if (n && typeof n === 'object') { out.push(n); flat(n.props.children, out); } return out; };

// Build the REAL app/stew-schedule.jsx and hand back eventHistory + SchEventModal, wired to a persistent
// useState store so a handler fired after render can be observed by RE-RENDERING (idx resets each render).
function buildSched(events) {
  const store = [];
  let idx = 0;
  const React = {
    Fragment: 'Frag',
    useState(init) {
      const i = idx++;
      if (i >= store.length) store.push({ v: typeof init === 'function' ? init() : init });
      const cell = store[i];
      return [cell.v, (nv) => { cell.v = typeof nv === 'function' ? nv(cell.v) : nv; }];
    },
    useEffect() {}, useRef: (v) => ({ current: v }), useMemo: (f) => f(), useCallback: (f) => f,
  };
  const scope = {
    React, h, Frag: 'Frag',
    window: { useStewardGroups: () => [], useStewardEvents: () => events, Steward: {}, NETWORKS_ENABLED: false },
    Icon: () => null,
    useStewDialog: () => ({ current: null }),
    CustomEvent: class {},
    localStorage: { getItem: () => null, setItem: () => {} },
    document: { createElement: () => ({ getContext: () => ({ drawImage() {} }), toDataURL: () => '' }) },
    // calendar-pilot item 3: SchCoverField.applyImage builds a downscaled public variant via `new Image()`, a
    // browser global this Node render scope must supply; the downscale is async best-effort so a no-op src
    // setter (onload never fires) is enough — the immediate onChange still sets the picked image.
    Image: class { set src(v) {} },
  };
  const names = Object.keys(scope);
  const mod = new Function(...names, jsx(SCHED) + '\nreturn { eventHistory, SchEventModal };')(...names.map(n => scope[n]));
  assert.equal(typeof mod.eventHistory, 'function', 'eventHistory not exported from stew-schedule.jsx — re-anchor');
  assert.equal(typeof mod.SchEventModal, 'function', 'SchEventModal not exported from stew-schedule.jsx — re-anchor');
  // every render returns the flattened node list of the real modal
  const render = () => { idx = 0; return flat(expand(mod.SchEventModal({ day: '', onClose: () => {} }))); };
  return { mod, render };
}

const EVENTS = [
  { title: 'Prayer', where: 'Chapel', image: 'data:img,A' },
  { title: 'Prayer', where: 'Hall',   image: 'data:img,B' },   // SAME name, different where AND image
  { title: 'Youth',  where: 'Chapel', image: 'data:img,B' },   // repeat where + image
  { title: '',       where: '',       image: '' },             // all empty -> dropped
  { title: '  Social  ', where: '  Garden ', image: '' },      // trimmed; empty image dropped
];
const EXPECT = { names: ['Prayer', 'Youth', 'Social'], wheres: ['Chapel', 'Hall', 'Garden'], images: ['data:img,A', 'data:img,B'] };

const eventHistory = buildSched(EVENTS).mod.eventHistory;

// ── eventHistory: the pure, lifted helper ─────────────────────────────────────────────────────────────────────
test('eventHistory dedupes, drops empties and trims across all three fields', () => {
  const r = eventHistory(EVENTS);
  assert.deepEqual(r.names, EXPECT.names, 'names not deduped/trimmed/empty-dropped');
  assert.deepEqual(r.wheres, EXPECT.wheres, 'wheres not deduped/trimmed/empty-dropped');
  assert.deepEqual(r.images, EXPECT.images, 'images not deduped/empty-dropped');
  // dedup specifically: 'Prayer' appears twice in the source, once in the list
  assert.equal(r.names.filter(n => n === 'Prayer').length, 1, '"Prayer" was not deduped');
  // empties specifically: no '' leaked into any list
  assert.ok([...r.names, ...r.wheres, ...r.images].every(Boolean), 'an empty string survived');
});

test('eventHistory returns three INDEPENDENT lists (a name is not bound to its where/image)', () => {
  const r = eventHistory(EVENTS);
  // 'Prayer' is a single name, yet it occurred with TWO wheres and TWO images; both survive in their own
  // lists, so the name carries no where/image with it — the lists are not tuples.
  assert.equal(r.names.filter(n => n === 'Prayer').length, 1, '"Prayer" should collapse to one name');
  assert.ok(r.wheres.includes('Chapel') && r.wheres.includes('Hall'), 'both wheres that "Prayer" had must be offered independently');
  assert.ok(r.images.includes('data:img,A') && r.images.includes('data:img,B'), 'both images that "Prayer" had must be offered independently');
  // and the lists are plainly separate collections, not a projection of one another
  assert.ok(!r.names.some(n => r.wheres.includes(n)), 'a name leaked into the wheres list');
});

test('eventHistory is safe on empty / missing input', () => {
  assert.deepEqual(eventHistory([]), { names: [], wheres: [], images: [] });
  assert.deepEqual(eventHistory(undefined), { names: [], wheres: [], images: [] });
});

// ── point of use: the real modal wires each field to its OWN datalist / picker ───────────────────────────────
function datalistValues(nodes, id) {
  const dl = nodes.find(n => n.type === 'datalist' && n.props.id === id);
  assert.ok(dl, 'no <datalist id="' + id + '"> rendered by the modal');
  return flat(dl).filter(n => n.type === 'option').map(n => n.props.value);
}
const input = (nodes, label) => nodes.find(n => n.type === 'input' && n.props['aria-label'] === label);

test('the Name input is wired to a datalist of the distinct past names', () => {
  const { render } = buildSched(EVENTS);
  const nodes = render();
  const name = input(nodes, 'Title');
  assert.ok(name, 'no Title input on the form');
  assert.equal(name.props.list, 'sch-event-names', 'the Title input is not wired to list="sch-event-names"');
  assert.deepEqual(datalistValues(nodes, 'sch-event-names'), EXPECT.names, 'the name datalist does not carry the distinct past names');
});

test('the Where input is wired to a SEPARATE datalist of the distinct past wheres', () => {
  const { render } = buildSched(EVENTS);
  const nodes = render();
  const where = input(nodes, 'Where');
  assert.ok(where, 'no Where input on the form');
  assert.equal(where.props.list, 'sch-event-wheres', 'the Where input is not wired to list="sch-event-wheres"');
  assert.deepEqual(datalistValues(nodes, 'sch-event-wheres'), EXPECT.wheres, 'the where datalist does not carry the distinct past wheres');
});

test('the image picker lists the distinct past cover images', () => {
  const { render } = buildSched(EVENTS);
  const nodes = render();
  const picks = nodes.filter(n => n.type === 'button' && n.props['aria-label'] === 'Use this past cover image');
  const srcs = picks.map(b => { const img = flat(b).find(n => n.type === 'img'); return img && img.props.src; });
  assert.deepEqual(srcs, EXPECT.images, 'the image picker does not offer exactly the distinct past images');
});

// ── independence AT THE POINT OF USE: picking one field changes only that field's state ───────────────────────
test('picking a past NAME does not change the Where or Image state', () => {
  const { render } = buildSched(EVENTS);
  let nodes = render();
  input(nodes, 'Title').props.onChange({ target: { value: 'Prayer' } });   // simulate picking a past name
  nodes = render();   // re-read live state
  assert.equal(input(nodes, 'Title').props.value, 'Prayer', 'the name pick did not set the title');
  assert.equal(input(nodes, 'Where').props.value, '', 'the name pick leaked into Where (fields must be independent)');
  // image is still unset -> no cover preview (its Remove button only renders when image is truthy)
  assert.ok(!nodes.some(n => n.type === 'button' && n.props.title === 'Remove this photo'),
    'the name pick set a cover image (fields must be independent)');
});

test('picking a past IMAGE sets only the image, not the Name or Where', () => {
  const { render } = buildSched(EVENTS);
  let nodes = render();
  const pick = nodes.find(n => n.type === 'button' && n.props['aria-label'] === 'Use this past cover image'
    && flat(n).some(x => x.type === 'img' && x.props.src === 'data:img,B'));
  assert.ok(pick, 'no picker button for data:img,B');
  pick.props.onClick();
  nodes = render();   // re-read live state
  // the cover preview now shows the chosen image (Remove button + preview img present)
  assert.ok(nodes.some(n => n.type === 'button' && n.props.title === 'Remove this photo'), 'the image pick did not set a cover');
  // the cover preview img, NOT a 72x48 picker thumbnail. calendar-pilot item 3 (18d5b5cb) rebuilt the cover
  // field: the preview is now a draggable 150px box whose img carries draggable={false}, where it used to be a
  // bare height:130 img — so re-anchor the locator to that unique marker (the picker thumbnails carry no
  // draggable prop), which still excludes the thumbnails without asserting anything new about the image.
  const preview = nodes.find(n => n.type === 'img' && n.props.src === 'data:img,B' && n.props.draggable === false);
  assert.ok(preview, 'the chosen image is not shown as the cover');
  assert.equal(input(nodes, 'Title').props.value, '', 'the image pick leaked into the Name (fields must be independent)');
  assert.equal(input(nodes, 'Where').props.value, '', 'the image pick leaked into Where (fields must be independent)');
});
