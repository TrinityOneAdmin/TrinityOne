// A CONFIRMED RSVP CLOSES THE EVENT CARD, AND ITS TOAST IS VISIBLE OVER IT.
// Run: node --test scripts/event-card-closes-on-confirmed-rsvp-and-toast-sits-above-it.test.mjs
//
// Device-reported: tapping Going/Maybe/Can't in the event card (a BottomSheet at z 70) toasted at z 60 -- under the
// card, never seen -- and left the card open. Both are point-of-use faults, so EventDetail and Toast are
// LIFTED out of app/*.jsx and RUN here (CLAUDE.md rules 1 and 3); nothing text-matches the screens.
// setRsvp's own true/false is proved in an-rsvp-must-not-be-reversed-by-a-slow-relay.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { fnBody } from './test-slice.mjs';

const SERVING = readFileSync(new URL('../app/screens-serving.jsx', import.meta.url), 'utf8');
const UI = readFileSync(new URL('../app/ui.jsx', import.meta.url), 'utf8');
const js = (src) => transformSync(src, { loader: 'jsx', jsx: 'transform', jsxFactory: 'h', jsxFragment: 'Frag' }).code;
const h = (type, props, ...kids) => ({ type, props: { ...(props || {}), children: kids.flat(Infinity) } });
const walk = (n, out = []) => {
  if (!n || typeof n !== 'object') return out;
  if (Array.isArray(n)) { n.forEach(x => walk(x, out)); return out; }
  out.push(n); walk(n.props && n.props.children, out); return out;
};

function eventCard(setRsvp) {
  let closed = 0;
  const src = js(fnBody(SERVING, 'function EventDetail(', 'EventDetail'));
  const scope = { h, Frag: 'Frag', React: { Fragment: 'Frag' }, Icon: () => null, ServDateBlock: () => null,
    BottomSheet: 'sheet' };
  const names = Object.keys(scope);
  const EventDetail = new Function(...names, src + '\nreturn EventDetail;')(...names.map(n => scope[n]));
  const tree = EventDetail({ event: { id: 'ev-1', title: 'Picnic' }, open: true, onClose: () => { closed++; }, ctx: { myRsvps: {}, setRsvp } });
  const btn = (label) => walk(tree).find(n => n.type === 'button' && n.props.children.join('') === label);
  return { btn, closed: () => closed };
}

test('Going / Maybe / Can’t each close the card once the answer is CONFIRMED', async () => {
  for (const label of ['Going', 'Maybe', 'Can’t']) {
    const seen = [];
    const c = eventCard(async (id, v) => { seen.push([id, v]); return true; });
    const b = c.btn(label);
    assert.ok(b, 'no "' + label + '" button rendered -- re-anchor');
    await b.props.onClick();
    assert.equal(seen.length, 1, label + ': setRsvp was not called');
    assert.equal(c.closed(), 1, label + ': a confirmed answer left the card open, so the member must swipe it away');
  }
});

test('the card STAYS OPEN when the answer was not confirmed, so she can retry', async () => {
  const c = eventCard(async () => false);
  await c.btn('Going').props.onClick();
  assert.equal(c.closed(), 0, 'the card closed over an answer the church never confirmed -- she loses the retry and the failure toast context');
});

test('a card with no setRsvp does not throw or close', async () => {
  const c = eventCard(undefined);
  await c.btn('Going').props.onClick();
  assert.equal(c.closed(), 0);
});

test('the Toast sits ABOVE the event card (BottomSheet z 70) and the Overlay (55)', () => {
  const src = js(fnBody(UI, 'function Toast(', 'Toast'));
  const toastKind = () => 'ok'; const Icon = () => null;
  const Toast = new Function('h', 'toastKind', 'Icon', src + '\nreturn Toast;')(h, toastKind, Icon);
  const el = Toast({ msg: 'You’re going — your church has your answer' });
  assert.ok(el, 'Toast rendered nothing');
  assert.ok(el.props.style.zIndex > 70,
    'THE CONFIRMATION RENDERS UNDER THE OPEN CARD (zIndex ' + el.props.style.zIndex + ' vs sheet 70) and is never seen');
});
