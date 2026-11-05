// APPROVING A HELPER GRANTS THE CHOSEN PRESET'S CAPABILITIES + A NAME — never [] (the empty-grant bug).
// Run: node --test scripts/approving-a-helper-grants-the-preset.test.mjs
//
// THE BUG THIS GUARDS. Approving a "request to help" used to call add(pk) with no name and no caps, so the
// roster got caps[pk] = [] — the helper was admitted able to do NOTHING, under an app-invented name. The fix
// opens an approve sheet that captures the name and a permission PRESET and calls add(pk, name, grants).
//
// POINT OF USE (CLAUDE.md rules 1 & 3). This MOUNTS the real DashStewardsPanel out of app/stew-dashboard.jsx
// through console-screens.mjs (the console compiled the way the phone loads it, steward-root.jsx included, so
// window.usePendingStewards is the REAL makeSub hook over Steward.subscribeStewardRequests). It PRESSES the
// real controls; no text is matched in the .jsx. The preset->caps mapping it drives is the REAL presetCaps,
// lifted from the shipped bundle (vendor/steward.js) — not a stub. Put add(pk) back in place of the sheet and
// the recorded setStewards grant returns to [], and these fail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnBody, deps } from './test-slice.mjs';
import { loadConsole, fakeReact, fakeBrowser, fakeSteward, nodes, texts } from './console-screens.mjs';

const VENDOR = readFileSync(new URL('../vendor/steward.js', import.meta.url), 'utf8');
// The REAL preset machinery, lifted from the shipped bundle so the mounted screen drives genuine code.
const presetBody = fnBody(VENDOR, 'function _presetCaps(id) {', '_presetCaps');
const presetCaps = new Function(deps(VENDOR, presetBody, []) + '\nreturn ' + presetBody)();
const PRESETS = new Function(deps(VENDOR, 'STEWARD_PRESETS', []) + '\nreturn STEWARD_PRESETS;')();

const OWNER = 'aa'.repeat(32);
const HELPER = 'bb'.repeat(32);

function setup({ hasPin = false } = {}) {
  const fr = fakeReact();
  const wrote = [];               // every setStewards(pubkeys, caps, names) this console would publish
  const Steward = fakeSteward({
    actingChurch: '', pubkey: OWNER,
    stewardPresets: () => PRESETS.map(p => ({ ...p, caps: Array.isArray(p.caps) ? p.caps.slice() : null })),
    presetCaps: (id) => presetCaps(id),
    stewardCapNames: () => ['finance', 'care', 'safeguarding', 'members', 'content', 'sealedrooms'],
    hasPinLock: () => hasPin,
    verifyPin: async (p) => p === '12345678',
    stewardLabels: () => ({}), stewardCaps: () => ({}), stewardSince: () => ({}),
    // the pending "request to help" arrives through the real hook's subscription
    subscribeStewardRequests: (cb) => { cb([{ pubkey: HELPER, npub: 'npub_helper', name: 'Ruth Bexley' }]); return () => {}; },
    setStewards: (pubkeys, caps, names) => { wrote.push({ pubkeys, caps, names }); return Promise.resolve(true); },
  });
  const { window } = fakeBrowser({ Steward });
  const mods = loadConsole({ React: fr.React, window, expr: '{ DashStewardsPanel }' });
  let tree = null;
  const draw = () => { fr.reset(); tree = mods.DashStewardsPanel({ church: { name: 'St Aidan' } }); fr.flush(); return tree; };
  const all = () => nodes(tree);
  const press = (label) => {
    const b = all().find(n => n.type === 'button' && texts(n).join(' ').includes(label));
    assert.ok(b, 're-anchor: no button says "' + label + '"');
    b.props.onClick({ stopPropagation() {}, preventDefault() {} }); draw();
  };
  const pickRadio = (aria) => {
    const r = all().find(n => n.type === 'input' && n.props && n.props.type === 'radio' && n.props['aria-label'] === aria);
    assert.ok(r, 're-anchor: no preset radio "' + aria + '"');
    r.props.onChange({ target: { checked: true }, stopPropagation() {}, preventDefault() {} }); draw();
  };
  const typeInto = (aria, value) => {
    const i = all().find(n => (n.type === 'input' || n.type === 'textarea') && n.props && n.props['aria-label'] === aria);
    assert.ok(i, 're-anchor: no field "' + aria + '"');
    i.props.onChange({ target: { value }, stopPropagation() {}, preventDefault() {} }); draw();
  };
  // first draw queues the subscription effect; a second draw repaints once it has delivered the request
  draw(); draw();
  return { fr, draw, all, press, pickRadio, typeInto, get wrote() { return wrote; }, get tree() { return tree; } };
}

test('the pending request renders as a "Request to help" with an Approve control', () => {
  const h = setup();
  assert.ok(texts(h.tree).join(' ').includes('Requests to help'), 'the pending request did not render');
  assert.ok(h.all().some(n => n.type === 'button' && texts(n).join('').includes('Approve')), 'no Approve control on the pending request');
});

test('approving with the default (general) preset grants care+content+members and the name — NOT []', () => {
  const h = setup();
  h.press('Approve');             // open the approve sheet for the pending request
  assert.ok(h.all().some(n => n.type === 'input' && n.props && n.props.type === 'radio' && n.props['aria-label'] === 'General helper'),
    'the approve sheet does not offer the General helper preset');
  h.press('Approve as helper');   // confirm with the default preset

  assert.equal(h.wrote.length, 1, 'approving did not publish a roster');
  const w = h.wrote[0];
  assert.ok(w.pubkeys.includes(HELPER), 'the approved helper is not on the published roster');
  assert.deepEqual((w.caps[HELPER] || []).slice().sort(), ['care', 'content', 'members'].sort(),
    'the default preset did not grant care+content+members');
  assert.notEqual((w.caps[HELPER] || []).length, 0,
    'THE EMPTY-GRANT REGRESSION: the helper was approved with [] (nothing) — the exact bug this guards');
  assert.equal(w.names[HELPER], 'Ruth Bexley', 'the owner-set name was not written to the roster');
});

test('the owner can override the preset (finance) and the name before approving', () => {
  const h = setup();
  h.press('Approve');
  h.typeInto('The helper’s name, as you know them', 'Tom the treasurer');
  h.pickRadio('Finance helper');
  h.press('Approve as helper');

  const w = h.wrote[0];
  assert.deepEqual(w.caps[HELPER], ['finance'], 'the Finance preset did not grant exactly finance');
  assert.equal(w.names[HELPER], 'Tom the treasurer', 'the owner-typed name was not used');
});

test('a console PIN is required before the grant lands, and a wrong PIN writes nothing', async () => {
  const h = setup({ hasPin: true });
  h.press('Approve');
  h.typeInto('Your console PIN, to confirm this', '00000000');   // wrong PIN
  h.press('Approve as helper');
  await new Promise(r => setImmediate(r));
  assert.equal(h.wrote.length, 0, 'a wrong PIN still approved the helper');
  h.typeInto('Your console PIN, to confirm this', '12345678');   // right PIN
  h.press('Approve as helper');
  await new Promise(r => setImmediate(r));
  assert.equal(h.wrote.length, 1, 'the correct PIN did not approve the helper');
  assert.notEqual((h.wrote[0].caps[HELPER] || []).length, 0, 'approved with [] even on the PIN path');
});

test('the add-a-helper default view shows the invite, not a paste/pick fork, until Advanced', () => {
  const h = setup();
  h.press('Add a helper');
  const pasteField = () => h.all().find(n => n.type === 'input' && n.props && /Paste their/.test(String(n.props.placeholder || '')));
  assert.ok(h.all().some(n => n.type === 'button' && /invite/i.test(texts(n).join(' '))), 'the invite control is not the primary path');
  assert.ok(!pasteField(), 'the add-by-code paste box is a co-equal option in the default view — it must sit behind Advanced');
  h.press('Advanced');
  assert.ok(pasteField(), 'Advanced did not reveal the add-by-code paste box');
});
