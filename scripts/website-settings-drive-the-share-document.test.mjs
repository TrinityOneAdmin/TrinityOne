// SETTINGS → YOUR WEBSITE: THE THREE PHASE-2 CONTROLS ARE ON THE SCREEN, ONLY WHILE THE SWITCH IS ON, AND
// EACH ONE WRITES THE FIELD IT SAYS IT DOES.
//   Run: node --test scripts/website-settings-drive-the-share-document.test.mjs
//
// reference/DESIGN-embeddable-church-info.md, "What a steward can choose" — phase 2. "How far ahead",
// "Calendar name" and "How much of each event" are Settings-page controls that patch the church's own
// `share:` document; scripts/the-website-horizon-and-calname-settings-drive-the-feed.test.mjs proves the
// RELAY reads what lands there. This file is CLAUDE.md rule 1's other half — the point of use: delete a
// control from app/stew-dashboard.jsx's DashWebsitePanel, or wire it to the wrong engine call, and the
// relay-side file stays green while this one goes red.
//
// Same lift-and-render approach as scripts/one-unreadable-event-does-not-park-the-whole-website.test.mjs's
// `panel()` (CLAUDE.md rule 3: nothing here matches text in app/*.jsx — the REAL DashWebsitePanel is sliced
// out of the source, compiled, and executed).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

const DASH = readFileSync(new URL('../app/stew-dashboard.jsx', import.meta.url), 'utf8');
const share = (over = {}) => ({ calendar: true, sermons: false, plans: false, optOut: [], optIn: [], address: 'own', horizonMonths: 6, calName: '', detail: 'full', known: true, ...over });

// `sink.calls` collects every `setWebsiteShare(patch)` the panel made. `church` lets a row check the
// calendar-name placeholder falls back to the church's own display name.
function panel(snapshot, sink, church = { name: 'Grace Church' }) {
  const from = DASH.indexOf('const WEB_BLOCKED_WHY = {');
  assert.notEqual(from, -1, 'app/stew-dashboard.jsx: WEB_BLOCKED_WHY is gone — re-anchor this lift');
  assert.ok(from < DASH.indexOf('function DashWebsitePanel({ church }) {'), 're-anchor: the why table moved below the panel');
  const JS = transformSync(DASH.slice(from, DASH.indexOf('window.DashWebsitePanel = DashWebsitePanel;')),
    { loader: 'jsx', jsx: 'transform', jsxFactory: 'h', jsxFragment: 'Frag' }).code;
  const states = []; let idx = 0;
  const React = {
    useState(init) { const i = idx++; if (states.length <= i) states.push(typeof init === 'function' ? init() : init); return [states[i], (v) => { states[i] = typeof v === 'function' ? v(states[i]) : v; }]; },
    useEffect(fn) { try { fn(); } catch (e) {} }, useRef: () => ({ current: null }), useMemo: (f) => f(),
    Fragment: 'Frag',
  };
  const h = (type, props, ...kids) => ({ type, props: { ...(props || {}), children: kids.flat() } });
  const s = sink || {};
  s.calls = [];
  const win = {
    Steward: {
      subscribeWebsiteShare: (cb) => { cb(snapshot); return () => {}; },
      websiteFeedUrl: () => 'https://church.example/public/npub1x/calendar.ics',
      setWebsiteShare: async (patch) => { s.calls.push(patch); return s.ok !== false; },
      setWebsiteHeldMany: async () => true,
    },
  };
  const scope = { React, h, Frag: 'Frag', Icon: () => null, Panel: (p) => h('panel', p), copyText: () => true, window: win };
  const names = Object.keys(scope);
  const mod = new Function(...names, JS + '\nreturn { DashWebsitePanel };')(...names.map(n => scope[n]));
  const nodes = (n, out = []) => {
    if (!n || typeof n !== 'object') return out;
    if (Array.isArray(n)) { n.forEach(x => nodes(x, out)); return out; }
    out.push(n);
    if (typeof n.type === 'function') { try { nodes(n.type(n.props), out); } catch (e) {} return out; }
    nodes(n.props && n.props.children, out); return out;
  };
  const text = (n) => (typeof n === 'string' || typeof n === 'number') ? String(n)
    : (n && n.props ? [].concat(n.props.children || []).map(text).join('') : '');
  const render = () => { idx = 0; s.tree = mod.DashWebsitePanel({ church }); s.nodes = nodes(s.tree); return s.nodes.map(text).join(' | '); };
  // TWO PASSES: pass 1 renders with `share` still null and its effect hands the panel the real snapshot;
  // pass 2 renders with that snapshot in hand. The calendar-name field derives straight from the share
  // document (no sync effect of its own), so two passes is enough.
  render();
  s.render = render;
  s.text = text;
  return render();
}
const allNodes = (n, out = []) => {
  if (!n || typeof n !== 'object') return out;
  if (Array.isArray(n)) { n.forEach(x => allNodes(x, out)); return out; }
  out.push(n);
  allNodes(n.props && n.props.children, out);
  return out;
};
const radiosIn = (sink, name) => allNodes(sink.tree).filter(n => n && n.type === 'input' && n.props && n.props.name === name);
const inputByLabel = (sink, label) => allNodes(sink.tree).find(n => n && n.type === 'input' && n.props && n.props['aria-label'] === label);

test('THE SCREEN: the three feed settings are on the page when the calendar is on', () => {
  const sink = {};
  const said = panel(share(), sink);
  assert.match(said, /How far ahead/);
  assert.match(said, /Calendar name/);
  assert.match(said, /How much of each event/);
  assert.equal(radiosIn(sink, 'website-horizon').length, 3, 'not all three horizon options are on the page');
  assert.ok(inputByLabel(sink, 'Calendar name'), 'the calendar-name field is missing');
  assert.equal(radiosIn(sink, 'website-detail').length, 2, 'the detail radio pair is not both on the page');
});

test('THE SCREEN: DELETING THE SWITCH from a church\'s answer hides all three — nothing about the calendar leaves the app, settings included', () => {
  const sink = {};
  const said = panel(share({ calendar: false }), sink);
  assert.doesNotMatch(said, /How far ahead/);
  assert.doesNotMatch(said, /Calendar name/);
  assert.doesNotMatch(said, /How much of each event/);
  assert.equal(radiosIn(sink, 'website-horizon').length, 0);
  assert.equal(inputByLabel(sink, 'Calendar name'), undefined);
});

test('THE SCREEN: picking a horizon writes exactly that field, and nothing else', async () => {
  const sink = {};
  panel(share({ horizonMonths: 6 }), sink);
  const twelve = radiosIn(sink, 'website-horizon').find(r => String(r.props.value) === '12');
  assert.ok(twelve, 're-anchor: the 12-month option is gone');
  await twelve.props.onChange({});
  assert.deepEqual(sink.calls, [{ horizonMonths: 12 }],
    'THE 12-MONTH OPTION DID NOT PATCH horizonMonths — it called the engine with ' + JSON.stringify(sink.calls));
  // the 6-month option, already selected, is checked
  const six = radiosIn(sink, 'website-horizon').find(r => String(r.props.value) === '6');
  assert.equal(!!six.props.checked, true, 'the stored horizon is not shown as selected');
  assert.equal(!!twelve.props.checked, false, 'an unselected option reads as checked');
});

test('THE SCREEN: the calendar-name field starts pre-filled from the share document, and saves on blur, not on every keystroke', async () => {
  const sink = {};
  panel(share({ calName: 'St Aidan’s — What’s On' }), sink);
  const field = inputByLabel(sink, 'Calendar name');
  assert.ok(field, 're-anchor: the calendar-name field is gone');
  assert.equal(field.props.value, 'St Aidan’s — What’s On', 'the field did not load the church’s saved name');
  await field.props.onChange({ target: { value: 'New name' } });
  assert.deepEqual(sink.calls, [], 'A KEYSTROKE PATCHED THE DOCUMENT — the field must save on blur, not on every change');
  sink.render();   // the edit landed in state; re-render, as a real browser would before the next event fires
  const field2 = inputByLabel(sink, 'Calendar name');
  assert.equal(field2.props.value, 'New name', 'the typed value is not reflected back into the field');
  await field2.props.onBlur({ target: { value: 'New name' } });
  assert.deepEqual(sink.calls, [{ calName: 'New name' }], 'blurring the field did not save the new name');
});

test('THE SCREEN: the calendar-name field is blank with an empty share and placeholders the church\'s own name', () => {
  const sink = {};
  panel(share({ calName: '' }), sink, { name: 'Grace Church, Milltown' });
  const field = inputByLabel(sink, 'Calendar name');
  assert.equal(field.props.value, '', 'an unset calName should read as blank, not the church name — the engine falls back to the church’s name on its own');
  assert.equal(field.props.placeholder, 'Grace Church, Milltown', 'the field does not hint at the church’s own name');
});

test('THE SCREEN: blurring without changing the field does not write anything', async () => {
  const sink = {};
  panel(share({ calName: 'Same name' }), sink);
  const field = inputByLabel(sink, 'Calendar name');
  await field.props.onBlur({ target: { value: 'Same name' } });
  assert.deepEqual(sink.calls, [], 'blurring an unchanged field still wrote to the relay');
});

test('THE SCREEN: picking "Short" writes detail, and "Full" is the one shown selected by default', async () => {
  const sink = {};
  panel(share({ detail: 'full' }), sink);
  const [full, short] = ['full', 'short'].map(v => radiosIn(sink, 'website-detail').find(r => r.props.value === v));
  assert.ok(full && short, 're-anchor: one of the detail options is gone');
  assert.equal(!!full.props.checked, true, 'full, the stored value, is not shown as selected');
  await short.props.onChange({});
  assert.deepEqual(sink.calls, [{ detail: 'short' }], 'THE SHORT OPTION DID NOT PATCH detail');
});

test('THE SCREEN: a control that cannot yet write (not known) is disabled, not silently inert', () => {
  const sink = {};
  panel(share({ known: false, calendar: true }), sink);
  // this snapshot draws no controls at all (see the earlier row) — the real hazard this guards is a FUTURE
  // change that shows them before `known`; if that ever happens, they must not be pressable.
  for (const r of radiosIn(sink, 'website-horizon')) assert.equal(!!r.props.disabled, true, 'a horizon option is live before the relay has answered');
});
