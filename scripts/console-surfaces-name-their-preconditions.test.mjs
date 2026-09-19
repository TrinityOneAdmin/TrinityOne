// A CONSOLE SURFACE MUST NOT OFFER AN ACTION WITHOUT NAMING ITS PRECONDITION.
// Run: node --test scripts/console-surfaces-name-their-preconditions.test.mjs
//
// Console audit 2026-09-19 §A5, §A6 and §C (TrinityOne-internal/UI-AUDIT-console-2026-09-19.md), work package
// P11b. Each test below is one surface the audit photographed on the Oppo offering something it could not do,
// or describing something that did not yet exist:
//   · Group leaders: "the people you tick below" pre-selected and Save live, on a church nobody has joined;
//   · Finance: opening the tab for the first time PUBLISHED a £ book (finance/settings, baseCurrency GBP) with
//     no currency control anywhere — against the owner's nation-neutral default;
//   · Calendar: "No upcoming services" under a "Sunday Service" the wizard had just created — the wizard's
//     meetings are calendar events, the calendar's "services" are the rota's;
//   · Set a console PIN: "Settings → Security" (the page is Settings → Church key) and "recover via your 12-word
//     phrase" on the path where the phrase has not been shown yet;
//   · Bulk upload: "Drop files here" on a phone, which has nothing to drop from;
//   · Congregation features: "Set up the Lightning address" offered two lines under "Locked during the pilot".
//
// Every screen is mounted the way the phone mounts it — scripts/console-screens.mjs compiles every console
// script with esbuild `jsx: 'transform'` into ONE scope — and the assertions read control STATE (disabled,
// present, absent), a publish spy on window.Steward, and the rendered text of the mounted tree. Where the only
// change is a sentence, the sentence is read off the RENDERED tree, never off the source file.
//
// ⚠ RULE 3 (CLAUDE.md): nothing here matches text in a .jsx file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConsole, fakeReact, fakeBrowser, fakeSteward, nodes, texts } from './console-screens.mjs';

const button = (tree, label) => nodes(tree).find(n => n.type === 'button' && (n.kids || []).some(k => typeof k === 'string' && k.includes(label)));
// a button whose text, at any depth, contains `label` (the option rows wrap their label in a div)
const buttonSaying = (tree, label) => nodes(tree).find(n => n.type === 'button' && texts(n).join(' ').includes(label));
const said = (tree) => texts(tree).join(' ').replace(/\s+/g, ' ');
// a subscription that answers at once with a fixed value — the shape makeSub (steward-root.jsx) expects
const answers = (value) => (cb) => { cb(value); return () => {}; };

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// 1. GROUP LEADERS — Save waits until there is someone to tick, or another option is chosen.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
function leadersDialog({ members }) {
  const { React, reset, flush, unmount } = fakeReact();
  const publishes = [];
  const Steward = fakeSteward({ churchPub: 'cp', subscribeMembers: answers(members), publishGroup: async (g) => { publishes.push(g); return { id: 'evt' }; } });
  const { window } = fakeBrowser({ Steward });
  const { GroupLeadersModal } = loadConsole({ React, window, expr: '{ GroupLeadersModal }' });
  let tree;
  const group = { id: 'g1', name: 'Youth', leaders: [], members: members.map(m => m.pubkey) };
  const draw = () => { reset(); tree = GroupLeadersModal({ group, onClose() {} }); flush(); return tree; };
  draw(); draw();   // the second draw sees what the members subscription delivered
  return { draw, get tree() { return tree; }, publishes, unmount };
}

test('Group leaders: with nobody in the church, the dialog says so where the list would be and Save is disabled', () => {
  const d = leadersDialog({ members: [] });
  const save = button(d.tree, 'Save');
  assert.ok(save, 're-anchor: no Save button in the Group leaders dialog');
  assert.equal(save.props.disabled, true,
    'THE DEFECT: "The leaders you choose — the people you tick below" is selected, there is nobody below, and Save is live');
  const status = nodes(d.tree).find(n => n.props && n.props.role === 'status');
  assert.ok(status, 'nothing on the dialog names the precondition (no role="status" line where the list would be)');
  assert.match(said(status), /no one to tick|nobody/i, 'the empty-state line does not say there is nobody to tick: ' + JSON.stringify(said(status)));
  // pressing it anyway must publish nothing
  save.props.onClick();
  assert.equal(d.publishes.length, 0, 'a press on the disabled Save still published a leader list');
  d.unmount();
});

test('Group leaders: choosing "Stewards only" with nobody in the church makes Save live again — the block is about the leaders option, not the dialog', () => {
  const d = leadersDialog({ members: [] });
  const stewards = buttonSaying(d.tree, 'Stewards only');
  assert.ok(stewards, 're-anchor: no "Stewards only" option');
  stewards.props.onClick();
  d.draw();
  assert.equal(button(d.tree, 'Save').props.disabled, false, 'Save stays disabled after a different option is chosen');
  d.unmount();
});

test('Group leaders: with one member in the church, Save is enabled and the empty-state line is gone', () => {
  const d = leadersDialog({ members: [{ pubkey: 'p1', npub: 'npub1p1', name: 'Ruth' }] });
  assert.equal(button(d.tree, 'Save').props.disabled, false, 'Save is disabled with someone to tick');
  assert.equal(nodes(d.tree).some(n => n.props && n.props.role === 'status'), false, 'the "nobody to tick" line is shown with a member on screen');
  d.unmount();
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// 3. CALENDAR — the "upcoming services" panel names the rota, so it cannot contradict an event just made.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
test('Calendar: with one meeting on the calendar and nothing on the rota, the side panel says the rota is empty — not "No upcoming services"', () => {
  const { React, reset, flush, unmount } = fakeReact();
  const t = new Date(); const date = t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');   // today: always in the month on screen
  const Steward = fakeSteward({ churchPub: 'cp',
    subscribeEvents: answers([{ id: 'e1', title: 'Sunday Service', date, time: '10:00', recur: 'weekly', accent: 'var(--clay)' }]),
    subscribeServices: answers([]), subscribeRotas: answers([]), subscribeRosters: answers([]), subscribeGroups: answers([]),
    subscribeRsvps: answers({}), subscribeMembers: answers([]), subscribeBookings: answers([]), subscribeRooms: answers([]), subscribeRunsheets: answers([]) });
  const { window } = fakeBrowser({ Steward });
  window.innerWidth = 1280;   // the side panel is a column on desktop and stacks on a phone; the sentence is the same
  const { DashCalendar } = loadConsole({ React, window, expr: '{ DashCalendar }' });
  let tree;
  const draw = () => { reset(); tree = DashCalendar({}); flush(); return tree; };
  draw(); draw();
  // CONTROL: the meeting is on the calendar (a cell carries the title), so the panel below it is the case the audit photographed
  assert.ok(said(tree).includes('Sunday Service'), 're-anchor: the injected Sunday Service is not on the calendar at all');
  const status = nodes(tree).find(n => n.props && n.props.role === 'status');
  assert.ok(status, 'the upcoming-services panel has no empty-state line (no role="status")');
  const line = said(status);
  assert.match(line, /rota/i, 'THE DEFECT: the empty state does not say it is the ROTA that is empty: ' + JSON.stringify(line));
  assert.doesNotMatch(line, /no upcoming services/i, 'the empty state still says "No upcoming services" under a service the steward just created');
  unmount();
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// 4. SET A CONSOLE PIN — names the page that exists, and never promises words the steward has not seen.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
function pinGate({ newChurch }) {
  const { React, reset, flush, unmount } = fakeReact();
  const { window } = fakeBrowser({ Steward: fakeSteward() });
  if (newChurch) window.localStorage.setItem('trinityone.steward.newchurch', '1');
  const { StewardForcedPin } = loadConsole({ React, window, expr: '{ StewardForcedPin }' });
  reset(); const tree = StewardForcedPin({}); flush();
  return { text: said(tree), tree, unmount };
}

test('Set a console PIN: the gate points at Settings → Church key, never "Settings → Security"', () => {
  for (const newChurch of [false, true]) {
    const g = pinGate({ newChurch });
    assert.ok(button(g.tree, 'Set PIN'), 're-anchor: the gate has no "Set PIN" button');
    assert.match(g.text, /Church key/, `THE DEFECT (newchurch=${newChurch}): the gate does not name Settings → Church key: ` + JSON.stringify(g.text));
    assert.doesNotMatch(g.text, /Settings → Security/, `(newchurch=${newChurch}) the gate still says "Settings → Security", which is the delegates' page`);
    g.unmount();
  }
});

test('Set a console PIN: on the new-church path it does not promise a 12-word phrase the wizard has not shown yet', () => {
  const fresh = pinGate({ newChurch: true });
  assert.doesNotMatch(fresh.text, /12-word/, 'THE DEFECT: "recover the church via your 12-word phrase" on a church whose phrase has not been shown');
  assert.match(fresh.text, /come next/i, 'the new-church footer does not say the recovery words come next: ' + JSON.stringify(fresh.text));
  fresh.unmount();
  // …and the other routes (restore, adopt, an old install) already hold the phrase, so they may be told it restores the church
  const old = pinGate({ newChurch: false });
  assert.match(old.text, /12-word/, 'a console that already holds its phrase is no longer told the phrase is the way back');
  old.unmount();
});

test('Set a console PIN: the copy is short — one sentence of why, one line of advice, one line of footer', () => {
  // Owner, 2026-09-10: less instructional copy on screen. Counted on the rendered tree, not the source.
  const g = pinGate({ newChurch: false });
  const prose = g.text.replace(/Set a console PIN|Set PIN & enter/g, '');
  const sentences = prose.split(/[.;]\s|[.;]$/).map(s => s.trim()).filter(s => s.length > 20);
  assert.ok(sentences.length <= 4, 'the gate carries ' + sentences.length + ' sentences of copy; the rule is one why, one line of advice, one footer:\n  ' + sentences.join('\n  '));
  g.unmount();
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// 5. BULK UPLOAD — on a phone the zone is a "Choose files" control; only a desktop is told to drop.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
function bulkUpload({ width }) {
  const { React, reset, flush, unmount } = fakeReact();
  const { window } = fakeBrowser({ Steward: fakeSteward() });
  window.innerWidth = width;
  const { BulkUploadModal } = loadConsole({ React, window, expr: '{ BulkUploadModal }' });
  reset(); const tree = BulkUploadModal({ kind: 'devotionals', onClose() {} }); flush();
  const zone = nodes(tree).find(n => typeof n.props.onDrop === 'function');
  assert.ok(zone, 're-anchor: no drop zone (an element with onDrop) in the bulk-upload dialog');
  assert.ok(nodes(zone).some(n => n.type === 'input' && n.props.type === 'file'), 're-anchor: the zone no longer wraps the file input that is the real control');
  return { zone: said(zone), text: said(tree), unmount };
}

test('Bulk upload: at 360px the zone says "Choose files" and nothing on the dialog says "Drop"', () => {
  const b = bulkUpload({ width: 360 });
  assert.doesNotMatch(b.zone, /drop/i, 'THE DEFECT: the phone is told to drop files, which it has nothing to drop from: ' + JSON.stringify(b.zone));
  assert.match(b.zone, /choose files/i, 'the zone does not say what it is on a phone — a control to choose files: ' + JSON.stringify(b.zone));
  assert.doesNotMatch(b.text, /\bdrop\b/i, 'the dialog still tells a phone to drop something: ' + JSON.stringify(b.text));
  b.unmount();
});

test('Bulk upload: at 1280px the zone still invites a drop', () => {
  const b = bulkUpload({ width: 1280 });
  assert.match(b.zone, /drop/i, 'the desktop drop zone lost its drop invitation: ' + JSON.stringify(b.zone));
  b.unmount();
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// 6. CONGREGATION FEATURES — "Set up the Lightning address" is disabled, with the reason, while giving is
//    locked for the pilot; with the lock off it opens the editor as before.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
function givingPanel(props) {
  const { React, reset, flush, unmount } = fakeReact();
  const { window } = fakeBrowser({ Steward: fakeSteward({ publishProfile() {} }) });
  const { DashGivingPanel } = loadConsole({ React, window, expr: '{ DashGivingPanel }' });
  let tree;
  const draw = () => { reset(); tree = DashGivingPanel({ church: { name: 'St Test', giving: false }, ...props }); flush(); return tree; };
  draw();
  const link = () => buttonSaying(tree, 'Lightning address');
  const field = () => nodes(tree).find(n => n.type === 'input' && n.props.inputMode === 'email');
  return { draw, link, field, unmount };
}

test('Congregation features: with giving locked (the shipped default), the Lightning-address link is disabled, says why, and opens nothing', () => {
  const g = givingPanel({});   // no `locked` passed: the real caller passes none either, so this is the shipped lock
  const link = g.link();
  assert.ok(link, 're-anchor: no "…Lightning address" button on the giving panel');
  assert.equal(link.props.disabled, true, 'THE DEFECT: "Set up the Lightning address" is live under "Locked during the pilot"');
  assert.match(String(link.props.title || ''), /locked during the pilot/i, 'the disabled link does not carry the same one-line reason as the switch');
  const sw = nodes(g.draw()).find(n => n.type === 'button' && n.props['aria-label'] === 'Toggle giving');
  assert.equal(sw && sw.props.disabled, true, 're-anchor: the giving switch itself is no longer locked — the link and the switch must read ONE lock');
  link.props.onClick();
  g.draw();
  assert.equal(g.field(), undefined, 'pressing the disabled link still opened the Lightning-address editor');
  g.unmount();
});

test('Congregation features: with the lock off, the link is enabled and opens the Lightning-address editor', () => {
  const g = givingPanel({ locked: false });
  const link = g.link();
  assert.ok(link, 're-anchor: no "…Lightning address" button on the unlocked panel');
  assert.equal(!link.props.disabled, true, 'the link is disabled even with the lock off — the lock is not what disables it');
  link.props.onClick();
  g.draw();
  assert.ok(g.field(), 'with the lock off, pressing the link renders no Lightning-address field');
  g.unmount();
});

// RULE 1 — the point of USE. The two tests above mount the panel directly; this follows the real Settings page
// (initialSection 'features') down to the panel it places, with the props it gives, and reads the same link.
test('Congregation features: the real Settings page places the giving panel with the lock ON', () => {
  const { React, reset, flush, fresh, unmount } = fakeReact();
  // hasKey stays false (the harness default): steward-root.jsx's top level calls selfRegister('').catch on a
  // keyed console, which the do-nothing Steward cannot answer. The Features page renders either way.
  const { window } = fakeBrowser({ Steward: fakeSteward({ isDelegated: () => false, publishProfile() {} }) });
  const { DashSettings, DashFeaturesPanel, DashGivingPanel } = loadConsole({ React, window, expr: '{ DashSettings, DashFeaturesPanel, DashGivingPanel }' });
  reset(); const page = DashSettings({ initialSection: 'features' }); flush();
  const feat = nodes(page).find(n => n.type === DashFeaturesPanel);
  assert.ok(feat, 're-anchor: the Features page does not place DashFeaturesPanel');
  fresh(); const panel = DashFeaturesPanel(feat.props); flush();   // fresh(): a different component gets its own hook slots
  const giving = nodes(panel).find(n => n.type === DashGivingPanel);
  assert.ok(giving, 'THE POINT OF USE: Congregation features no longer places DashGivingPanel');
  assert.equal('locked' in giving.props, false, 'the page passes an explicit `locked` — the shipped default is what must hold here');
  fresh(); const tree = DashGivingPanel(giving.props); flush();
  const link = buttonSaying(tree, 'Lightning address');
  assert.ok(link, 're-anchor: the placed panel renders no Lightning-address link');
  assert.equal(link.props.disabled, true, 'on the real page the Lightning-address link is live while giving is locked');
  unmount();
});
