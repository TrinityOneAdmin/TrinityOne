// BOTH CARE CHATS OFFER REPLY THE SAME WAY AS THE OTHER CHATS: a swipe (with the arrow) and a visible ⋯.
// Run: node --test scripts/reply-affordances-on-care-chats.test.mjs
//
// Point-of-use (CLAUDE.md rule 1/3): the REAL CareChatSheet (app/screens-today.jsx) and StewCareChat
// (app/stew-meals.jsx) are rendered through scripts/render-jsx-screen.mjs; the tests drive the handlers a finger
// would and read the tree. Nothing matches text in app/*.jsx. The send path is NOT under test here (it is
// unchanged); the one send assertion is that a swipe-started reply reaches sendCareChat with opts.replyTo.
//
// Users of the code touched (rule 2): CareChatSheet — rendered by the Care tab (Today) and the Care page;
// StewCareChat — rendered from the console's care list and child-care triage. Both only gain affordances.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScreen, miniReact, texts, find } from './render-jsx-screen.mjs';

const THREAD = [
  { id: 'm1', mine: false, from: 'ab'.repeat(32), text: 'Please pray for my mother', at: 1 },
  { id: 'm2', mine: true, text: 'Of course, tonight', at: 2 },
  { id: 'm3', mine: false, from: 'ab'.repeat(32), text: 'Thank you', at: 3 },
];
const sent = [];
const touch = (x, y) => ({ touches: [{ clientX: x, clientY: y }], changedTouches: [{ clientX: x, clientY: y }] });

function build(which, { native = true, touch = false } = {}) {
  const { React, draw } = miniReact();
  const Icon = ({ name }) => React.createElement('i', { 'data-icon': name });
  const api = {
    subscribeCareChat: (id, cb) => { cb(THREAD); return () => {}; },
    sendCareChat: async (...a) => { sent.push(a); return { id: 'x' }; },
  };
  const win = { matchMedia: () => ({ matches: !touch }), addEventListener() {}, removeEventListener() {}, Fellowship: api, StewardMeals: api,
    Capacitor: native ? { isNativePlatform: () => true } : undefined };
  const globals = { React, window: win, Icon, console, setTimeout, clearTimeout, setInterval, clearInterval,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: { addEventListener() {}, removeEventListener() {}, querySelector: () => null },
    navigator: { userAgent: '' }, location: { search: '', hostname: 'x' },
    lsGet: (k, d) => d, lsSet() {}, cx: (...a) => a.filter(Boolean).join(' '),
    ChurchBadge: () => null, SectionLabel: () => null, Halo: () => null, Sheet: () => null, IconBtn: () => null,
    useTrinityAudio: () => ({ track: null, playing: false }), todayISO: () => '2026-09-04',
    fetch: async () => ({ ok: false, json: async () => ({}) }),
    TrinityData: { NOTIFICATIONS: [], PLANS: [], VOTD_POOL: [] } };
  const [file, name] = which === 'member' ? ['app/screens-today.jsx', 'CareChatSheet'] : ['app/stew-meals.jsx', 'StewCareChat'];
  const Comp = loadScreen(file, [name], globals)[name];
  const props = { reqId: 'r1', requesterPub: 'cd'.repeat(32), title: 'Care', onClose() {} };
  const d = () => draw(Comp, props);
  d();
  return {
    d,
    rows: (t) => find(t, n => n.props && n.props.onTouchStart),
    cues: (t) => find(t, n => n.props && n.props['data-reply-cue']),
    dots: (t) => find(t, n => n.type === 'button' && n.props.title === 'Message actions'),
    menu: (t) => find(t, n => n.props && n.props['data-reply-menu']),
    bar: (t) => find(t, n => n.props && n.props['aria-label'] === 'Stop replying')[0],
    input: (t) => find(t, n => n.type === 'input')[0],
    sendBtn: (t) => find(t, n => n.type === 'button' && /^Send/.test(n.props['aria-label'] || ''))[0],
  };
}

for (const which of ['member', 'steward']) {
  test(`${which}: dragging a message right shows the arrow and moves it; letting go past the arm starts a reply (no redraw between move and lift)`, () => {
    const w = build(which);
    const t0 = w.d();
    assert.equal(w.rows(t0).length, 3, 'every message should be a swipe row');
    assert.equal(w.cues(t0).length, 0, 'an arrow is showing with nobody touching');
    assert.equal(w.rows(t0)[0].props.style.touchAction, 'pan-y');
    const r = w.rows(t0)[0];
    r.props.onTouchStart(touch(10, 10));
    r.props.onTouchMove(touch(40, 12));
    const t1 = w.d();
    assert.equal(w.cues(t1).length, 1, 'no reply arrow while dragging');
    assert.match(w.rows(t1)[0].props.style.translate, /^30px\b/);
    w.rows(t1)[0].props.onTouchMove(touch(70, 12));
    w.rows(t1)[0].props.onTouchEnd({ changedTouches: [{ clientX: 70, clientY: 12 }] });
    const t2 = w.d();
    assert.ok(w.bar(t2), 'a swipe past the arm did not start a reply');
    assert.ok(texts(t2).join(' ').includes('Replying to'), 'no Replying-to bar');
    assert.ok(find(t2, n => n.type === 'div' && texts(n).join(' ').includes('Replying to') && texts(n).join(' ').includes('Please pray')).length, 'the bar does not quote the swiped message');
    assert.equal(w.cues(t2).length, 0, 'the arrow stayed after letting go');
  });

  test(`${which}: a short drag does not reply`, () => {
    const w = build(which);
    const r = w.rows(w.d())[0];
    r.props.onTouchStart(touch(10, 10)); r.props.onTouchMove(touch(40, 12));
    r.props.onTouchEnd({ changedTouches: [{ clientX: 40, clientY: 12 }] });
    assert.equal(w.bar(w.d()), undefined);
  });

  test(`${which}: a swipe-started reply is sent with replyTo = that message (the existing send path)`, async () => {
    sent.length = 0;
    const w = build(which);
    const r = w.rows(w.d())[1];
    r.props.onTouchStart(touch(10, 10)); r.props.onTouchMove(touch(70, 12));
    r.props.onTouchEnd({ changedTouches: [{ clientX: 70, clientY: 12 }] });
    w.input(w.d()).props.onChange({ target: { value: 'ok' } });
    await w.sendBtn(w.d()).props.onClick();
    assert.equal(sent.length, 1);
    assert.equal(sent[0][3].replyTo, 'm2');
  });

  test(`${which}: every message has a visible ⋯ that offers Reply and ONLY Reply`, () => {
    const w = build(which, { native: false });
    const dots = w.dots(w.d());
    assert.equal(dots.length, 3, 'no ⋯ on the messages');
    dots[0].props.onClick();
    const m = w.menu(w.d());
    assert.equal(m.length, 1);
    const buttons = find(m[0], n => n.type === 'button');
    assert.equal(buttons.length, 1, 'the ⋯ menu offers more than Reply: ' + texts(m[0]).join('|'));
    assert.ok(texts(buttons[0]).join('').includes('Reply'));
    buttons[0].props.onClick();
    assert.ok(w.bar(w.d()), 'pressing Reply in the ⋯ did not start a reply');
    assert.equal(w.menu(w.d()).length, 0, 'the ⋯ menu stayed open after Reply');
  });

  test(`${which}: the last message's ⋯ menu opens upward, an earlier one downward`, () => {
    const w = build(which, { native: false });
    w.dots(w.d())[2].props.onClick();
    assert.equal(w.menu(w.d())[0].props['data-reply-menu'], 'up');
  });
}

test('steward web console: no swipe rows (the swipe is APK-only there), ⋯ still present', () => {
  const w = build('steward', { native: false });
  const t = w.d();
  assert.equal(w.rows(t).length, 0);
  assert.equal(w.dots(t).length, 3);
});

// ── TOUCH (owner 2026-10-15): Reply is the SOLE action behind the ⋯, so a touch phone shows none ─────────────
for (const which of ['member', 'steward']) {
  test(`${which}: TOUCH + swipe live -> NO VISIBLE ⋯ on any message (hidden focusable ones remain), and the swipe still replies`, () => {
    const w = build(which, { native: true, touch: true });
    const t = w.d();
    assert.equal(w.dots(t).length, 3, 'a touch surface lost the hidden assistive-tech ⋯');
    assert.ok(w.dots(t).every(b => b.props.style.width === '1px' && b.props.style.opacity === 0 && b.props.style.display !== 'none'), 'a touch surface still shows the reply-only ⋯ visibly');
    const r = w.rows(t)[0];
    r.props.onTouchStart(touch(10, 10)); r.props.onTouchMove(touch(70, 12));
    r.props.onTouchEnd({ changedTouches: [{ clientX: 70, clientY: 12 }] });
    assert.ok(w.bar(w.d()), 'swipe no longer replies once the ⋯ is gone');
  });
  test(`${which}: POINTER + native still shows the ⋯ and it replies (mouse cannot swipe)`, () => {
    const w = build(which, { native: true, touch: false });
    const d = w.dots(w.d());
    assert.equal(d.length, 3);
    d[0].props.onClick();
    find(w.menu(w.d())[0], n => n.type === 'button')[0].props.onClick();
    assert.ok(w.bar(w.d()));
  });
}
test('steward: TOUCH browser with NO swipe (not the APK) keeps its ⋯ — otherwise there is no reply route at all', () => {
  const w = build('steward', { native: false, touch: true });
  assert.equal(w.rows(w.d()).length, 0);
  assert.equal(w.dots(w.d()).length, 3);
});
