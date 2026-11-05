// THE EMBEDDABLE WIDGET RENDERS AN EVENT'S COVER IMAGE, FRAMED AT THE FOCAL POINT THE STEWARD SET.
//   Run: node --test scripts/the-widget-renders-an-event-cover-at-its-focal-point.test.mjs
//
// calendar-pilot-2026-11-05 item 3b, owner go-ahead to show event images on the public widget (reversing the
// widget's prior "colour only, no images" rule). The upstream plumbing (item 3) already carries a size-capped
// image + focal point into the relay's pubevent: copy and out of /public/<npub>/event-images.json; this file is
// the widget END of that path.
//
// It drives the SHIPPED functions, not a mirror (memory: tests-must-drive-shipped-code): renderList, eventImage,
// eventImgStyle and eventIdFromUid are the exact function objects buildWidgetScript() serialises with .toString()
// into the browser bundle (the `export` keyword does not appear in fn.toString(), so exporting them for this test
// changes no shipped byte — the same guarantee parseIcs already has). renderList touches the DOM through a tiny
// stub `document`, so this is a point-of-use test (CLAUDE.md rule 1): delete the image block from renderList and
// the "renders an <img>" assertions fail, even though eventImgStyle's own math still passes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderList, eventImage, eventImgStyle, eventIdFromUid } from './public-widget.mjs';

// ── a minimal DOM: enough for el() (createElement/className/textContent/appendChild) and the <img> block ──────
function makeEl(tag) {
  return {
    tagName: tag, className: '', style: {}, children: [], attrs: {}, _text: '',
    get textContent() { return this._text; },
    set textContent(v) { this._text = v; this.children = []; },
    appendChild(c) { this.children.push(c); return c; },
    setAttribute(k, v) { this.attrs[k] = v; },
  };
}
globalThis.document = {
  createElement: (t) => makeEl(t),
  createTextNode: (t) => ({ nodeType: 3, textContent: String(t) }),
};
function walk(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (node.tagName) out.push(node);
  (node.children || []).forEach((c) => walk(c, out));
  return out;
}
const imgsIn = (root) => walk(root).filter((n) => n.tagName === 'img');
const dataUri = (n) => 'data:image/jpeg;base64,' + 'A'.repeat(n);
const occ = (over) => ({ date: '2026-10-03', time: '19:30', summary: 'Event', location: '', description: '', recur: '', uid: 'trinityone-e@npub1x', ...over });

test('eventIdFromUid pulls the bare event id out of a series UID and a moved-occurrence UID', () => {
  assert.equal(eventIdFromUid('trinityone-supper@npub1x'), 'supper');
  assert.equal(eventIdFromUid('trinityone-supper-ex-20261020@npub1x'), 'supper', 'a moved week must map to its base event image');
  assert.equal(eventIdFromUid(''), '');
  assert.equal(eventIdFromUid(undefined), '');
});

test('eventImage returns a data: cover and rejects an external URL outright', () => {
  const m = { supper: { image: dataUri(40), imgPos: { x: 10, y: 90 }, imgZoom: 2 } };
  assert.deepEqual(eventImage(m, 'trinityone-supper@n'), { image: dataUri(40), imgPos: { x: 10, y: 90 }, imgZoom: 2 });
  assert.equal(eventImage({ e: { image: 'https://cdn.example/x.png' } }, 'trinityone-e@n'), null, 'an off-origin image URL was admitted — the no-third-party rule is broken');
  assert.equal(eventImage({}, 'trinityone-e@n'), null);
  assert.equal(eventImage(null, 'trinityone-e@n'), null);
});

test('an event with a focal point renders an <img> with the right object-position and scale', () => {
  const root = makeEl('div');
  const images = { supper: { image: dataUri(50), imgPos: { x: 20, y: 80 }, imgZoom: 2 } };
  renderList(root, [occ({ summary: 'Harvest supper', uid: 'trinityone-supper@npub1x' })], 'Grace', images);
  const imgs = imgsIn(root);
  assert.equal(imgs.length, 1, 'the event cover <img> was not rendered — the widget still shows no image');
  assert.ok(imgs[0].src.startsWith('data:image/'), 'the <img> src is not the same-origin data: URI');
  assert.equal(imgs[0].style.objectFit, 'cover');
  assert.equal(imgs[0].style.objectPosition, '20% 80%', 'the focal point did not reach object-position');
  assert.equal(imgs[0].style.transform, 'scale(2)', 'the zoom did not become a scale()');
  assert.equal(imgs[0].style.transformOrigin, '20% 80%', 'the scale is not anchored at the focal point');
});

test('a default (centred, un-zoomed) cover renders an <img> with no transform', () => {
  const root = makeEl('div');
  const images = { e: { image: dataUri(30), imgPos: null, imgZoom: 1 } };
  renderList(root, [occ()], 'Grace', images);
  const im = imgsIn(root)[0];
  assert.ok(im, 'a plain cover image did not render');
  assert.equal(im.style.objectPosition, '50% 50%');
  assert.equal('transform' in im.style, false, 'an un-zoomed cover carried a transform');
});

test('a moved occurrence shows the same cover as its base event', () => {
  const root = makeEl('div');
  const images = { supper: { image: dataUri(20), imgPos: { x: 50, y: 50 }, imgZoom: 1 } };
  renderList(root, [occ({ uid: 'trinityone-supper-ex-20261020@npub1x' })], 'Grace', images);
  assert.equal(imgsIn(root).length, 1, 'the moved week did not inherit its base event image');
});

test('an event with no image stays the colour-only card — no <img> at all', () => {
  const root = makeEl('div');
  // two events; only one is in the images map
  const occs = [occ({ summary: 'Has photo', uid: 'trinityone-with@npub1x' }), occ({ summary: 'No photo', uid: 'trinityone-without@npub1x' })];
  renderList(root, occs, 'Grace', { with: { image: dataUri(10), imgPos: null, imgZoom: 1 } });
  assert.equal(imgsIn(root).length, 1, 'an event with no image still drew an <img>');
});

test('a failed/empty images fetch does NOT break the card — renderList(…, {}) and (…, null) render colour-only', () => {
  for (const images of [{}, null, undefined]) {
    const root = makeEl('div');
    assert.doesNotThrow(() => renderList(root, [occ(), occ({ uid: 'trinityone-f@n' })], 'Grace', images), 'renderList threw when the images map was ' + JSON.stringify(images));
    assert.equal(imgsIn(root).length, 0, 'a colour-only render drew an image from an empty/absent map');
    // the rows themselves still render: the two list items are present
    assert.equal(walk(root).filter((n) => n.tagName === 'li').length, 2, 'the colour-only list lost its rows');
  }
});

test('eventImgStyle clamps an out-of-range focal point and zoom (the shared render math)', () => {
  assert.deepEqual(eventImgStyle(null, undefined), { objectFit: 'cover', objectPosition: '50% 50%' });
  const s = eventImgStyle({ x: -40, y: 400 }, 99);
  assert.equal(s.objectPosition, '0% 100%');
  assert.equal(s.transform, 'scale(6)');
});
