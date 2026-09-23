// THE "NOT ON THE WEBSITE" TICK IS DRAWN FOR THE CHURCH KEY AND FOR NOBODY ELSE, AND A TICK THAT DID NOT LAND IS SAID.
//   Run: node --test scripts/the-not-on-the-website-tick-is-the-owners.test.mjs
//
// The audit of 7ffcfaf (finding 5) showed the commit claimed "shown only when the console holds the church
// key" with nothing that bit: hiding the tick from a delegate could be deleted and every test stayed green.
// The relay refuses a delegate's share: write anyway, so the cost was a tick that silently did nothing — which
// is the failure this codebase specialises in. Two things are pinned here, both by RENDERING the real
// SchEventModal and SchEventEdit through a miniature React and reading the tree (CLAUDE.md rule 3: no text
// matching against app/*.jsx):
//   1. an owner console draws the tick; a delegated steward's console does not;
//   2. when the engine refuses to record the opt-out (it does so until it has read the church's share:
//      document), the dialog raises the console's steward-write-blocked banner rather than swallowing it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

const SRC = readFileSync(new URL('../app/stew-schedule.jsx', import.meta.url), 'utf8');
const JS = transformSync(SRC, { loader: 'jsx', jsx: 'transform', jsxFactory: 'h', jsxFragment: 'Frag' }).code;

function mount(componentName, props, { steward = {}, preset = {}, events = [], groups = [] } = {}) {
  const states = []; let idx = 0;
  const React = {
    useState(init) { const i = idx++; if (states.length <= i) states.push(Object.prototype.hasOwnProperty.call(preset, i) ? preset[i] : (typeof init === 'function' ? init() : init)); return [states[i], (v) => { states[i] = typeof v === 'function' ? v(states[i]) : v; }]; },
    useEffect() {}, useRef: () => ({ current: null }), useMemo: (f) => f(),
    Fragment: 'Frag',
  };
  const h = (type, props2, ...kids) => ({ type, props: { ...(props2 || {}), children: kids.flat() } });
  const dispatched = [];
  const win = { Steward: steward, useStewardGroups: () => groups, useStewardEvents: () => events,
    dispatchEvent(e) { dispatched.push(e); return true; }, confirm: () => true };
  const scope = { React, h, Frag: 'Frag', Icon: () => null, SchModal: (p) => h('modal', p), useStewDialog: () => ({ current: null }), todayISO: () => '2026-09-22',
    window: win, CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init && init.detail; } } };
  const names = Object.keys(scope);
  const mod = new Function(...names, JS + `\nreturn { ${componentName} };`)(...names.map(n => scope[n]));
  const render = () => { idx = 0; return mod[componentName](props); };
  // The walk EXPANDS function components (the tick lives in SchWebsiteHeldRow) and follows SchModal's `footer`
  // prop as well as `children` — the New event dialog's buttons sit in the footer, not the body.
  const nodes = (n, out = []) => {
    if (!n || typeof n !== 'object') return out;
    if (Array.isArray(n)) { n.forEach(x => nodes(x, out)); return out; }
    out.push(n);
    if (typeof n.type === 'function') { try { nodes(n.type(n.props), out); } catch (e) {} return out; }
    nodes(n.props && n.props.children, out); nodes(n.props && n.props.footer, out); return out;
  };
  return { render, states, nodes: () => nodes(render()), dispatched };
}
const tickOf = (m) => m.nodes().find(n => n.type === 'input' && n.props && n.props['aria-label'] === 'Not on the website');
const onTickOf = (m) => m.nodes().find(n => n.type === 'input' && n.props && n.props['aria-label'] === 'On the website');
const owner = (over = {}) => ({ isDelegated: () => false, setWebsiteHeld: async () => true, isWebsiteHeld: () => false, setWebsiteShown: async () => true, isWebsiteShown: () => false, publishEvent: async (ev) => ({ id: 'evt1', ...ev }), ownedNetworks: () => [], ...over });

test('an owner console draws the tick in both dialogs', () => {
  assert.ok(tickOf(mount('SchEventModal', { day: '', onClose() {} }, { steward: owner() })), 'the New event dialog has no "Not on the website" tick for the church key');
  assert.ok(tickOf(mount('SchEventEdit', { event: { id: 'evt1', title: 'T', date: '2026-10-01' }, onClose() {} }, { steward: owner() })), 'the Edit event dialog has no tick for the church key');
});

// ── WHERE THE TICK SITS (owner, 2026-09-22) ──────────────────────────────────────────────────────────────
// Driven at 1280x1000 in a real browser, the New event dialog ran TITLE, DATE/TIME, WHERE, TYPE, BELONGS TO,
// COVER IMAGE (OPTIONAL), NOTE (OPTIONAL) and only then the tick — off the bottom of the screen. A steward
// had to scroll past the photo picker and the note box to reach the one control that decides whether the
// event becomes public. It now sits immediately after "Belongs to", whose answer decides which of the two
// ticks is shown at all, and above the optional fields. Same place in all four cases: both ticks, both
// dialogs. These rows read the ORDER OF THE RENDERED TREE, never the order of the source file (rule 3).
const orderIn = (m, ...preds) => { const ns = m.nodes(); return preds.map(p => ns.findIndex(p)); };
const isTick = (label) => (n) => n.type === 'input' && n.props && n.props['aria-label'] === label;
const isCover = (n) => n.type === 'input' && n.props && n.props.type === 'file';
const isNote = (n) => n.type === 'textarea' && n.props && /^(Note \(optional\)|Details)$/.test(String(n.props['aria-label'] || ''));
const isBelongs = (n) => n.type === 'div' && [].concat((n.props && n.props.children) || []).includes('Belongs to');
// The LABEL is not the block. An audit moved the tick between "Belongs to" and its own group chips and both
// test files stayed green, so the lower bound is the last chip, not the heading above it.
const isChip = (n) => n.type === 'button' && [].concat((n.props && n.props.children) || []).includes('Whole church');
const isWhere = (n) => n.type === 'input' && n.props && n.props['aria-label'] === 'Where';
const YOUTH_GROUP = [{ id: 'grpyouth', name: 'Youth', kind: 'group' }];

test('the website tick sits between "Belongs to" and the optional fields in the New event dialog — both ticks', () => {
  const whole = mount('SchEventModal', { day: '', onClose() {} }, { steward: owner(), groups: YOUTH_GROUP });
  const [tick, belongs, chip, cover, note] = orderIn(whole, isTick('Not on the website'), isBelongs, isChip, isCover, isNote);
  assert.ok(tick >= 0 && belongs >= 0 && chip >= 0 && cover >= 0 && note >= 0,
    're-anchor: one of these controls is not in the New event dialog at all — ' + JSON.stringify({ tick, belongs, chip, cover, note }));
  assert.ok(tick > belongs, 'the website tick is ABOVE "Belongs to", which is what decides which tick is shown');
  assert.ok(tick > chip, 'THE WEBSITE TICK IS INSIDE THE "BELONGS TO" BLOCK, between its heading and its own group chips');
  assert.ok(tick < cover,
    'THE WEBSITE TICK IS BELOW THE COVER IMAGE PICKER — a steward has to scroll past the photo and the note to reach the control that decides whether the event is public');
  assert.ok(tick < note, 'THE WEBSITE TICK IS BELOW THE NOTE BOX — same scroll, same control');
  // the group event's opposite tick, in the same place
  const grp = mount('SchEventModal', { day: '', onClose() {} }, { steward: owner(), groups: YOUTH_GROUP, preset: { 6: 'grpyouth' } });
  const [on, belongs2, chip2, cover2, note2] = orderIn(grp, isTick('On the website'), isBelongs, isChip, isCover, isNote);
  assert.ok(on >= 0 && chip2 >= 0, 're-anchor: a group event draws no "On the website" tick in the New event dialog');
  assert.ok(on > belongs2, 'the group tick is above "Belongs to"');
  assert.ok(on > chip2, 'the group tick sits inside the "Belongs to" block rather than after it');
  assert.ok(on < cover2 && on < note2,
    'THE GROUP EVENT\'S TICK IS BELOW THE OPTIONAL FIELDS — the two ticks are the same control in two states and must sit in the same place');
});

test('…and the Edit dialog puts it above the details box — both ticks', () => {
  // BOTH SIDES, not just the upper one. An audit moved this tick to the very top of the Edit dialog, above
  // "Name", and both this file and the headless-browser file stayed green: only `tick < Details` was ever
  // asserted. The four cases are meant to sit in the SAME place, so the lower bound is pinned too.
  const whole = mount('SchEventEdit', { event: { id: 'evt1', title: 'T', date: '2026-10-01' }, onClose() {} }, { steward: owner() });
  const [tick, where, note] = orderIn(whole, isTick('Not on the website'), isWhere, isNote);
  assert.ok(tick >= 0 && where >= 0 && note >= 0, 're-anchor: ' + JSON.stringify({ tick, where, note }));
  assert.ok(tick < note, 'THE WEBSITE TICK IS BELOW THE DETAILS BOX IN THE EDIT DIALOG — the same scroll as the New event dialog had');
  assert.ok(tick > where, 'THE WEBSITE TICK IS ABOVE "WHERE" IN THE EDIT DIALOG — it is meant to follow the fields that say what the event IS, in the same place as the New event dialog');
  const grp = mount('SchEventEdit', { event: { id: 'evt1', title: 'T', date: '2026-10-01', groupId: 'grpyouth' }, onClose() {} }, { steward: owner() });
  const [on, where2, note2] = orderIn(grp, isTick('On the website'), isWhere, isNote);
  assert.ok(on >= 0 && where2 >= 0, 're-anchor: a group event draws no "On the website" tick in the Edit dialog');
  assert.ok(on < note2, 'THE GROUP EVENT\'S TICK IS BELOW THE DETAILS BOX — the four cases must agree');
  assert.ok(on > where2, 'the group event\'s tick is above "Where" — the four cases must agree');
});

test('a delegated steward\'s console draws NO tick — the relay would refuse the write, so a tick would silently do nothing', () => {
  assert.equal(tickOf(mount('SchEventModal', { day: '', onClose() {} }, { steward: owner({ isDelegated: () => true }) })), undefined, 'THE TICK IS SHOWN TO A DELEGATE in the New event dialog');
  assert.equal(tickOf(mount('SchEventEdit', { event: { id: 'evt1', title: 'T', date: '2026-10-01' }, onClose() {} }, { steward: owner({ isDelegated: () => true }) })), undefined, 'THE TICK IS SHOWN TO A DELEGATE in the Edit event dialog');
});

test('a GROUP event is offered the OPPOSITE tick — "On the website", off by default — and never the opt-out one', () => {
  // Audit F2, owner 2026-09-22: a group's event is withheld from the church's own minors by the relay's read
  // gate, so it does not go on the public feed unless a steward puts it there, per item.
  const m = mount('SchEventEdit', { event: { id: 'evt1', title: 'T', date: '2026-10-01', groupId: 'grpyouth' }, onClose() {} }, { steward: owner() });
  assert.equal(tickOf(m), undefined, 'a GROUP event is offered "Not on the website" — its default is already off, so that tick would do nothing');
  const on = onTickOf(m);
  assert.ok(on, 'the Edit dialog has no "On the website" tick for a group event');
  assert.equal(on.props.checked, false, 'a group event opens already ticked on to the website');
  const shown = onTickOf(mount('SchEventEdit', { event: { id: 'evt1', title: 'T', date: '2026-10-01', groupId: 'grpyouth' }, onClose() {} }, { steward: owner({ isWebsiteShown: (id) => id === 'evt1' }) }));
  assert.equal(shown.props.checked, true, 'a group event the church already put on the website opens unticked');
  // …and a delegate is offered neither, for the reason the row below gives
  const del = mount('SchEventEdit', { event: { id: 'evt1', title: 'T', date: '2026-10-01', groupId: 'grpyouth' }, onClose() {} }, { steward: owner({ isDelegated: () => true }) });
  assert.equal(onTickOf(del), undefined, 'THE "ON THE WEBSITE" TICK IS SHOWN TO A DELEGATE');
});

test('the Edit dialog opens with the tick reflecting what the church already recorded', () => {
  const held = tickOf(mount('SchEventEdit', { event: { id: 'evt1', title: 'T', date: '2026-10-01' }, onClose() {} }, { steward: owner({ isWebsiteHeld: (id) => id === 'evt1' }) }));
  assert.equal(held.props.checked, true, 'an event the church holds off the website opens unticked');
});

test('a tick the engine refused to record is said through the console banner, and the event is still saved', async () => {
  let closed = false;
  // preset: SchEventModal's state order is title, date, time, where, blurb, accent, group, image, repeat, until, held
  const m = mount('SchEventModal', { day: '', onClose: () => { closed = true; } }, { steward: owner({ setWebsiteHeld: async () => false }), preset: { 0: 'Vestry meeting', 1: '2026-10-01', 10: true } });
  const add = m.nodes().find(n => n.props && typeof n.props.onClick === 'function' && n.props.disabled === false);
  assert.ok(add, 'no enabled Add button rendered — re-anchor (the preset state indices may have moved)');
  await add.props.onClick();
  assert.equal(closed, true, 'the event WAS saved, so the dialog must close as usual');
  const banner = m.dispatched.find(e => e.type === 'steward-write-blocked');
  assert.ok(banner, 'the opt-out was refused and nothing told the steward — the tick silently did nothing');
  assert.match(String(banner.detail && banner.detail.message), /Not on the website/, 'the banner does not name the tick that was lost');
});

test('CONTROL: a tick the engine recorded raises no banner', async () => {
  const m = mount('SchEventModal', { day: '', onClose() {} }, { steward: owner(), preset: { 0: 'Vestry meeting', 1: '2026-10-01', 10: true } });
  const add = m.nodes().find(n => n.props && typeof n.props.onClick === 'function' && n.props.disabled === false);
  await add.props.onClick();
  assert.equal(m.dispatched.some(e => e.type === 'steward-write-blocked'), false, 'a recorded tick raised the banner — the message would cry wolf');
});

// ── F3: the date field a steward types into ──────────────────────────────────────────────────────────────
// AUDIT-feeds-round3-2026-09-22 F3. The defect it names is in the FEED BUILDER, and that is where it is
// refused (scripts/public-calendar.mjs range-checks the computed occurrence). Its reachability note is this
// screen: "the console's own event date field has no `max`, so a steward who fat-fingers a year reaches it."
// This row is that half — asserted on the RENDERED TREE, never by matching app/*.jsx (CLAUDE.md rule 3),
// because a `max` written into the source and never reaching the input is exactly what a text match cannot
// tell apart from a working one.
const dateFieldOf = (m) => m.nodes().find(n => n.type === 'input' && n.props && n.props['aria-label'] === 'Date' && n.props.type === 'date');

test('F3: both event date fields cap the year at a date this product can write down', () => {
  for (const [name, props] of [
    ['SchEventModal', { day: '', onClose() {} }],
    ['SchEventEdit', { event: { id: 'evt1', title: 'T', date: '2026-10-01' }, onClose() {} }],
  ]) {
    const f = dateFieldOf(mount(name, props, { steward: owner() }));
    assert.ok(f, name + ': no date field rendered at all — re-anchor this row');
    assert.equal(f.props.max, '9999-12-31',
      `${name}: THE EVENT DATE FIELD HAS NO MAX (${JSON.stringify(f.props.max)}) — a steward can type a year the public calendar cannot represent, which is how F3 is reached from the console`);
  }
});
