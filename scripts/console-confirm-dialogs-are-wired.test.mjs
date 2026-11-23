// POINT-OF-USE (CLAUDE.md 1 & 3): FIVE CONSOLE ACTIONS ASK FIRST, AND THE ASKING IS ON THE SCREEN.
// Run: node --test scripts/console-confirm-dialogs-are-wired.test.mjs
//
// 18a80059 replaced window.confirm()/window.alert() with the SkConfirm dialog. Each of these five had no test
// that would notice the dialog being deleted from the JSX — and a deleted dialog here is not cosmetic: the
// button only sets state now, so with the dialog gone the button does NOTHING, silently.
//
//   1. DashRooms          (app/stew-schedule.jsx)   the ✕ on a room chip          -> Steward.removeRoom
//   2. DashDevotionals    (app/stew-dashboard.jsx)  "Publish N drafts"            -> Steward.publishDevotional
//   3. DashNetworksPanel  (app/stew-dashboard.jsx)  NetworkRow's "Leave"          -> Steward.leaveNetwork
//   4. DashSettings       (app/stew-dashboard.jsx)  a scanned QR that is not a handoff -> the "Invalid QR" notice
//   5. MealsNeedModal     (app/stew-meals.jsx)      "Close need"                  -> StewardMeals.removeNeed
//
// Every test renders the REAL component through scripts/console-screens.mjs (all of steward.html's scripts in one
// shared scope), finds the control in the RENDERED tree, runs its onClick, and reads the tree again. Nothing is
// asserted from the .jsx text. The harness does not expand child components, so SkConfirm is found by identity
// (node.type === window.SkConfirm) and driven through the props the screen handed it.
//
// (The sixth dialog of that audit, SchEventDetail's Remove, is in
// scripts/one-occurrence-moves-or-skips-without-the-series.test.mjs beside the Skip test it shares a harness with.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConsole, fakeReact, fakeBrowser, fakeSteward, nodes, texts } from './console-screens.mjs';

const tick = () => new Promise(r => setImmediate(r));
const said = (n) => texts(n).join('');

// One console, one component under test. `expr` names what to pull out of the shared scope.
function mount(stewardOverrides, expr, { before } = {}) {
  const fr = fakeReact();
  const { window } = fakeBrowser({ Steward: fakeSteward(stewardOverrides) });
  if (before) before(window);
  const mods = loadConsole({ React: fr.React, window, expr });
  let tree = null;
  const drawWith = (render) => { fr.reset(); tree = render(); fr.flush(); return tree; };
  const confirms = () => nodes(tree).filter(n => n.type === window.SkConfirm);
  const button = (re) => nodes(tree).find(n => n.type === 'button' && typeof n.props.onClick === 'function' && re.test(said(n)));
  return { fr, window, mods, drawWith, confirms, button, get tree() { return tree; } };
}

// ── 1 · Rooms: removing a room ───────────────────────────────────────────────────────────────────────────────
function rooms() {
  const removed = [];
  const ROOMS = [{ id: 'r1', name: 'Main Hall' }, { id: 'r2', name: 'Kitchen' }];
  const h = mount({
    subscribeRooms: (cb) => { cb(ROOMS); return () => {}; },
    removeRoom: (id) => { removed.push(id); },
  }, '{ DashRooms }');
  const draw = () => h.drawWith(() => h.mods.DashRooms());
  draw(); draw();   // first draw subscribes, second paints what the stream delivered
  const removeBtns = () => nodes(h.tree).filter(n => n.type === 'button' && n.props.title === 'Remove room');
  return { ...h, draw, removed, removeBtns };
}

test('rooms: the ✕ on a room opens a confirm naming THAT room, and removes nothing yet', () => {
  const h = rooms();
  assert.equal(h.removeBtns().length, 2, 'the fixture has two rooms but the screen does not show two "Remove room" controls — re-anchor');
  assert.equal(h.confirms().length, 0, 'a confirm dialog is on screen before anything was pressed');
  h.removeBtns()[1].props.onClick();
  h.draw();
  assert.equal(h.removed.length, 0, 'pressing ✕ removed the room before the steward confirmed');
  const dlg = h.confirms();
  assert.equal(dlg.length, 1, 'pressing ✕ on a room did not open the SkConfirm dialog — the button now does nothing');
  assert.match(dlg[0].props.title, /Kitchen/, 'the confirm does not name the room that was pressed');
  assert.equal(dlg[0].props.confirmLabel, 'Remove');
});

test('rooms: cancelling the confirm removes nothing and closes the dialog', () => {
  const h = rooms();
  h.removeBtns()[1].props.onClick(); h.draw();
  h.confirms()[0].props.onCancel(); h.draw();
  assert.equal(h.removed.length, 0, 'the room was removed even though the steward cancelled');
  assert.equal(h.confirms().length, 0, 'the confirm stayed on screen after Cancel');
});

test('rooms: confirming removes exactly the room that was pressed, once', () => {
  const h = rooms();
  h.removeBtns()[1].props.onClick(); h.draw();
  h.confirms()[0].props.onConfirm(); h.draw();
  assert.deepEqual(h.removed, ['r2'], 'confirming did not call Steward.removeRoom with the pressed room’s id');
  assert.equal(h.confirms().length, 0, 'the confirm stayed on screen after Remove');
});

// ── 2 · Devotionals: "Publish N drafts" ──────────────────────────────────────────────────────────────────────
function devotionals() {
  const published = [];
  const DEVOS = [
    { id: 'd1', title: 'Day 1', ref: 'John 1', type: 'text', text: 'one', order: 0, draft: true, publishAt: 0 },
    { id: 'd2', title: 'Day 2', ref: 'John 2', type: 'text', text: 'two', order: 1, draft: false, publishAt: 0 },
    { id: 'd3', title: 'Day 3', ref: 'John 3', type: 'text', text: 'three', order: 2, draft: true, publishAt: 1900000000 },
  ];
  const h = mount({
    subscribeDevotionals: (cb) => { cb(DEVOS); return () => {}; },
    publishDevotional: (d) => { published.push(d); },
  }, '{ DashDevotionals }');
  const draw = () => h.drawWith(() => h.mods.DashDevotionals());
  draw(); draw();
  const publishBtn = () => h.button(/Publish 2 drafts/);
  return { ...h, draw, published, publishBtn };
}

test('devotionals: "Publish 2 drafts" opens a confirm and publishes nothing yet', () => {
  const h = devotionals();
  assert.ok(h.publishBtn(), 'no "Publish 2 drafts" button with two drafts in the list — re-anchor');
  assert.equal(h.confirms().length, 0, 'a confirm dialog is on screen before anything was pressed');
  h.publishBtn().props.onClick();
  h.draw();
  assert.equal(h.published.length, 0, 'pressing Publish drafts published before the steward confirmed');
  const dlg = h.confirms();
  assert.equal(dlg.length, 1, 'pressing "Publish 2 drafts" did not open the SkConfirm dialog — the button now does nothing');
  assert.equal(dlg[0].props.title, 'Publish drafts?');
  assert.match(dlg[0].props.body, /2 drafts/, 'the confirm does not say how many drafts it will publish');
  assert.equal(dlg[0].props.confirmLabel, 'Publish');
});

test('devotionals: cancelling publishes nothing and closes the dialog', () => {
  const h = devotionals();
  h.publishBtn().props.onClick(); h.draw();
  h.confirms()[0].props.onCancel(); h.draw();
  assert.equal(h.published.length, 0, 'drafts were published even though the steward cancelled');
  assert.equal(h.confirms().length, 0, 'the confirm stayed on screen after Cancel');
});

test('devotionals: confirming takes the DRAFTS live — not the one already published — and keeps a schedule', () => {
  const h = devotionals();
  h.publishBtn().props.onClick(); h.draw();
  h.confirms()[0].props.onConfirm(); h.draw();
  assert.deepEqual(h.published.map(d => d.id).sort(), ['d1', 'd3'], 'confirming did not republish exactly the two drafts');
  assert.ok(h.published.every(d => d.draft === false), 'a draft was republished still marked as a draft');
  assert.equal(h.published.find(d => d.id === 'd3').publishAt, 1900000000, 'publishing a scheduled draft dropped its schedule');
  assert.equal(h.published.find(d => d.id === 'd1').text, 'one', 'publishing a draft dropped its text');
  assert.equal(h.confirms().length, 0, 'the confirm stayed on screen after Publish');
});

// ── 3 · Networks: leaving a network ──────────────────────────────────────────────────────────────────────────
function network() {
  const left = [];
  const NET = { networkPub: 'ab'.repeat(32), npub: 'npub1' + 'q'.repeat(58) };
  const h = mount({
    subscribeNetworks: (cb) => { cb([NET]); return () => {}; },
    subscribeNetworkProfile: () => () => {},
    leaveNetwork: (pub) => { left.push(pub); },
  }, '{ DashNetworksPanel, NetworkRow }');
  const draw = () => h.drawWith(() => h.mods.DashNetworksPanel());
  draw(); draw();
  // The Leave button lives in the CHILD NetworkRow, which this harness leaves unexpanded. Render that child for
  // real — with the props the panel handed it, in a hook store of its own — and press ITS button, so the path
  // tested is button -> NetworkRow.onLeave -> the panel's state, not a prop the test called by name.
  const pressLeave = () => {
    const row = nodes(h.tree).find(n => n.type === h.mods.NetworkRow);
    assert.ok(row, 'the panel shows no NetworkRow for the network this church belongs to — re-anchor');
    const child = fakeReact();
    const panelReact = h.window.React;
    h.window.React = child.React;
    let rowTree;
    try { rowTree = h.mods.NetworkRow(row.props); child.flush(); } finally { h.window.React = panelReact; }
    const btn = nodes(rowTree).find(n => n.type === 'button' && said(n) === 'Leave');
    assert.ok(btn, 'the network row has no "Leave" button');
    btn.props.onClick();
  };
  return { ...h, draw, left, NET, pressLeave };
}

test('network: "Leave" opens a confirm and leaves nothing yet', () => {
  const h = network();
  assert.equal(h.confirms().length, 0, 'a confirm dialog is on screen before anything was pressed');
  h.pressLeave();
  h.draw();
  assert.equal(h.left.length, 0, 'pressing Leave left the network before the steward confirmed');
  const dlg = h.confirms();
  assert.equal(dlg.length, 1, 'pressing Leave did not open the SkConfirm dialog — the button now does nothing');
  assert.equal(dlg[0].props.title, 'Leave this network?');
  assert.equal(dlg[0].props.confirmLabel, 'Leave');
});

test('network: cancelling leaves nothing and closes the dialog', () => {
  const h = network();
  h.pressLeave(); h.draw();
  h.confirms()[0].props.onCancel(); h.draw();
  assert.equal(h.left.length, 0, 'the church left its network even though the steward cancelled');
  assert.equal(h.confirms().length, 0, 'the confirm stayed on screen after Cancel');
});

test('network: confirming leaves THAT network, once', () => {
  const h = network();
  h.pressLeave(); h.draw();
  h.confirms()[0].props.onConfirm(); h.draw();
  assert.deepEqual(h.left, [h.NET.networkPub], 'confirming did not call Steward.leaveNetwork with the network’s key');
  assert.equal(h.confirms().length, 0, 'the confirm stayed on screen after Leave');
});

// ── 4 · Settings: a scanned QR that is not a church handoff ──────────────────────────────────────────────────
// The route on a phone: Settings -> Hand over the church -> "Scan a handoff QR" -> the scanner reports a payload
// -> "Restore this church?" -> Restore -> Steward.adoptChurch(payload) THROWS on a bad payload -> the notice.
// It was a window.alert(), which is silent in the Tauri webview; if the SkConfirm goes, a bad scan says nothing.
function settings({ adopt }) {
  const adopted = [];
  const h = mount({
    adoptChurch: (payload) => { adopted.push(payload); return adopt(payload); },
  }, '{ DashSettings, StewQRScanner }', {
    // "Scan a handoff QR" is offered only inside the phone app (stewOnPhoneApp()).
    before: (window) => { window.Capacitor = { isNativePlatform: () => true }; },
  });
  const draw = () => h.drawWith(() => h.mods.DashSettings({ initialSection: 'stewards' }));
  draw();
  const scan = (payload) => {
    const btn = h.button(/Scan a handoff QR/);
    assert.ok(btn, 'no "Scan a handoff QR" button on the Hand-over page inside the phone app — re-anchor (initialSection "stewards")');
    btn.props.onClick(); draw();
    const scanner = nodes(h.tree).find(n => n.type === h.mods.StewQRScanner);
    assert.ok(scanner, 'pressing "Scan a handoff QR" did not open the scanner');
    scanner.props.onResult(payload); draw();
  };
  const byTitle = (t) => h.confirms().filter(n => n.props.title === t);
  return { ...h, draw, adopted, scan, byTitle };
}
const notHandoff = () => { throw new Error('not a handoff payload'); };

test('settings: a scanned QR that is not a handoff puts the "Invalid QR" notice on screen', () => {
  const h = settings({ adopt: notHandoff });
  assert.equal(h.confirms().length, 0, 'a dialog is on screen before anything was scanned');
  h.scan('https://example.org/not-a-church');
  assert.equal(h.adopted.length, 0, 'the scanned payload was applied before the steward confirmed');
  assert.equal(h.byTitle('Invalid QR').length, 0, 'the Invalid QR notice appeared before the payload was even tried');
  const ask = h.byTitle('Restore this church?');
  assert.equal(ask.length, 1, 'a scanned payload did not open the "Restore this church?" confirm');
  ask[0].props.onConfirm(); h.draw();
  assert.deepEqual(h.adopted, ['https://example.org/not-a-church'], 'Restore did not hand the scanned payload to Steward.adoptChurch');
  const notice = h.byTitle('Invalid QR');
  assert.equal(notice.length, 1, 'a QR that adoptChurch refused produced no "Invalid QR" notice — the steward is told nothing');
  assert.match(notice[0].props.body, /valid church handoff/, 'the notice does not say what was wrong');
  assert.equal(notice[0].props.confirmLabel, 'OK');
  assert.equal(h.byTitle('Restore this church?').length, 0, 'the Restore confirm stayed up behind the notice');
});

test('settings: the "Invalid QR" notice goes away on OK, and on the scrim/Escape too', () => {
  for (const how of ['onConfirm', 'onCancel']) {
    const h = settings({ adopt: notHandoff });
    h.scan('junk');
    h.byTitle('Restore this church?')[0].props.onConfirm(); h.draw();
    const notice = h.byTitle('Invalid QR');
    assert.equal(notice.length, 1, 'no Invalid QR notice to dismiss');
    notice[0].props[how](); h.draw();
    assert.equal(h.confirms().length, 0, 'the Invalid QR notice stayed on screen after ' + how);
    assert.equal(h.adopted.length, 1, 'dismissing the notice tried the bad payload again');
  }
});

test('settings: cancelling the restore never tries the payload and shows no notice', () => {
  const h = settings({ adopt: notHandoff });
  h.scan('junk');
  h.byTitle('Restore this church?')[0].props.onCancel(); h.draw();
  assert.equal(h.adopted.length, 0, 'the payload was applied even though the steward cancelled');
  assert.equal(h.confirms().length, 0, 'a dialog stayed on screen after Cancel');
});

test('settings: a GOOD handoff QR shows no "Invalid QR" notice', () => {
  const h = settings({ adopt: () => true });
  h.scan('a-real-handoff');
  h.byTitle('Restore this church?')[0].props.onConfirm(); h.draw();
  assert.deepEqual(h.adopted, ['a-real-handoff']);
  assert.equal(h.confirms().length, 0, 'a dialog is on screen after a handoff that adoptChurch accepted');
});

// ── 5 · Care: closing a need ─────────────────────────────────────────────────────────────────────────────────
function careNeed({ removeNeed } = {}) {
  const removed = []; let deleted = 0, closed = 0;
  const NEED = { id: 'n1', displayLabel: 'A family in our church', type: 'meals', dates: ['2030-01-07', '2030-01-09'], notes: '', recipient: '', dietary: [], meals: ['dinner'], dayMeals: {}, slotTimes: {} };
  const h = mount({}, '{ MealsNeedModal }', {
    before: (window) => {
      window.StewardMeals = {
        removeNeed: async (id) => { removed.push(id); if (removeNeed) return removeNeed(id); return true; },
        publishNeed: async () => { throw new Error('this test never saves'); },
      };
    },
  });
  const draw = (need = NEED) => h.drawWith(() => h.mods.MealsNeedModal({ need, onClose() { closed++; }, onSaved() {}, onDeleted() { deleted++; } }));
  draw();
  const closeBtn = () => h.button(/Close need/);
  return { ...h, draw, removed, closeBtn, deleted: () => deleted, closed: () => closed };
}

test('care: "Close need" opens a confirm and closes nothing yet', async () => {
  const h = careNeed();
  assert.ok(h.closeBtn(), 'no "Close need" button when editing an existing need — re-anchor');
  assert.equal(h.confirms().length, 0, 'a confirm dialog is on screen before anything was pressed');
  h.closeBtn().props.onClick();
  await tick(); h.draw();
  assert.equal(h.removed.length, 0, 'pressing Close need removed it before the steward confirmed');
  const dlg = h.confirms();
  assert.equal(dlg.length, 1, 'pressing "Close need" did not open the SkConfirm dialog — the button now does nothing');
  assert.equal(dlg[0].props.title, 'Close this care need?');
  assert.equal(dlg[0].props.confirmLabel, 'Close');
});

test('care: cancelling the confirm closes nothing and leaves the editor open', async () => {
  const h = careNeed();
  h.closeBtn().props.onClick(); await tick(); h.draw();
  h.confirms()[0].props.onCancel(); await tick(); h.draw();
  assert.equal(h.removed.length, 0, 'the need was closed even though the steward cancelled');
  assert.equal(h.deleted(), 0, 'the editor reported the need deleted after Cancel');
  assert.equal(h.confirms().length, 0, 'the confirm stayed on screen after Cancel');
});

test('care: confirming closes THAT need and tells the screen behind it', async () => {
  const h = careNeed();
  h.closeBtn().props.onClick(); await tick(); h.draw();
  h.confirms()[0].props.onConfirm(); await tick(); h.draw();
  assert.deepEqual(h.removed, ['n1'], 'confirming did not call StewardMeals.removeNeed with the need’s id');
  assert.equal(h.deleted(), 1, 'the editor did not report the need deleted (onDeleted) after it was closed');
  assert.equal(h.confirms().length, 0, 'the confirm stayed on screen after Close');
});

test('care: a NEW need has no "Close need" control at all', () => {
  const h = careNeed();
  h.fr.fresh();
  h.draw(null);
  assert.equal(h.closeBtn(), undefined, 'a need that does not exist yet is offered "Close need"');
});
