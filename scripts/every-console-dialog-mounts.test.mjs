// EVERY CONSOLE DIALOG MUST RENDER ONCE WITHOUT A FREE IDENTIFIER — THE GUARD THAT WOULD HAVE CAUGHT 8537ba2.
// Run: node --test scripts/every-console-dialog-mounts.test.mjs
//
// The bug class. app/*.jsx are classic scripts sharing one global scope, and near-identical sibling
// components are this codebase's house style. A helper added to one sibling and REFERENCED from another
// (8537ba2: `guardedClose` defined in SermonEditModal, used in StewBackupModal) is not a load-time error —
// it is a ReferenceError the first time that sibling renders, which for a dialog is the moment a steward
// opens it. "Back up to a file" crashed the console for 27 days that way, and no test mounted the modal.
//
// What this does. It ENUMERATES (by reading the source — that is all the source is used for) every top-level
// function in app/stew-*.jsx whose body carries `role="dialog"`, loads the whole console the way the phone
// does (scripts/console-screens.mjs: every script steward.html lists, esbuild `jsx: 'transform'` as
// build-steward-apk.sh runs it, one shared scope), and CALLS each one once with minimal props. Then:
//   • a ReferenceError anywhere in that render, or in the effects it queued, FAILS the test and names the
//     component and the identifier;
//   • any other error means this harness could not supply what the dialog needs (a real relay, a real
//     church, a DOM). That is recorded as PARTIAL, not as a pass — and the list of partials below is asserted
//     exact in both directions, so a dialog cannot quietly drop out of coverage, and one that starts
//     rendering is promoted rather than left mis-described.
//
// What it asserts: "did not throw a ReferenceError", nothing more. It does not claim a dialog works, closes,
// or says the right thing. Child components are not called — each dialog's OWN body is what renders, which
// is exactly where a sibling-copy bug lives. Dialogs built on a wrapper (SchAddServiceModal on SchModal,
// the calendar modals on CkModal, every SkConfirm caller) are NOT enumerated here: the wrapper is, their
// bodies are not. A ReferenceError in one of those still needs its own mount test.
//
// PARTIAL — the dialogs this harness cannot draw to the end, and why (read the reason before touching the list):
//   (none at the time of writing — every enumerated dialog renders to the end against a no-op Steward, with
//   the REAL vendor/finance-ledger.js supplying the finance dialogs' book and API)
//
// STATE-GATED — role="dialog" markup that sits inside a screen and renders only after the steward acts:
//   DashGroups        two dialogs (delete-group confirm, team members) behind `pendingDelete` / `teamMembers`
//   DashNetworksPanel the "Create a network" naming dialog behind `naming`
//   CategoriesModal   its own delete confirm behind `pendingDelete`, inside a dialog that IS rendered
// Rendering those screens once with default state evaluates the screen's body but not the gated branch. A
// free identifier inside such a branch is not caught here. They are listed so nobody reads this test as
// covering them. Every OTHER enumerated component must put a role="dialog" node in its output — otherwise an
// early `return null` (a closed `open` prop, say) would count as "rendered to the end" while evaluating nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { loadConsole, fakeReact, fakeBrowser, fakeSteward, nodes, BROWSER_GLOBALS } from './console-screens.mjs';

const ROOT = new URL('../', import.meta.url);

// ── enumerate: every top-level function in app/stew-*.jsx whose body carries role="dialog" ──────────────
// "Body" here is the text from one top-level `function` to the next: role="dialog" only ever appears inside
// a function, so this needs no brace-matching (fnBody cannot read BulkInviteModal). `aria-modal` is required
// with it so the one COMMENT that mentions the attribute (WizShell's) is not enumerated.
const DIALOG = /role="dialog" aria-modal/;
function dialogComponents() {
  const out = [];
  const files = readdirSync(new URL('app/', ROOT)).filter(f => /^stew-.*\.jsx$/.test(f)).sort();
  for (const f of files) {
    const src = readFileSync(new URL('app/' + f, ROOT), 'utf8');
    const starts = [...src.matchAll(/^(?:async )?function (\w+)\(/gm)];
    starts.forEach((m, i) => {
      const body = src.slice(m.index, i + 1 < starts.length ? starts[i + 1].index : src.length);
      if (DIALOG.test(body)) out.push({ file: 'app/' + f, name: m[1], sites: (body.match(new RegExp(DIALOG.source, 'g')) || []).length });
    });
  }
  return out;
}

// ── minimal props: shapes, not decisions. A callback is a no-op; an object has the fields the dialog reads ─
const onClose = () => {};
const church = { name: 'St Test', pubkey: 'ab'.repeat(32), accent: '', picture: '' };
const group = { id: 'g1', name: 'Home group', members: [], leaders: [], kind: 'group' };
// The finance dialogs read a ledger book and the ledger API. Both come from the REAL vendor/finance-ledger.js
// (a pure-computation bundle steward.html loads before the screens), not from a stub of their shape.
const props = (F) => {
const book = F.createBook({ baseCurrency: 'GBP', decimals: 2 });
return {
  SkConfirm: { title: 'Sure?', body: 'Body.', onConfirm() {}, onCancel() {} },
  InvitePosterModal: { church, url: 'https://console.example/join#x', svg: '<svg></svg>', onClose },
  JoinModal: { onClose }, NewPostModal: { onClose },
  NewGroupModal: { open: true, onClose }, NewTeamModal: { open: true, onClose },
  EditGroupMembersModal: { group, onClose }, GroupLeadersModal: { group, onClose },
  CategoriesModal: { cats: [], groups: [], onClose },
  DashGroups: {}, DashNetworksPanel: {},
  NewPlanModal: { onClose }, NewDevotionalModal: { onClose, editing: null, seriesOptions: [] },
  BulkUploadModal: { kind: 'devotionals', onClose },
  CkModal: { title: 'Title', children: null, onClose }, SchModal: { title: 'Title', children: null, onClose },
  StewBackupModal: { church, onClose }, WebAddressModal: { church, onClose },
  SermonEditModal: { sermon: { id: 's1', title: 'Sermon', desc: '' }, onSave: async () => {}, onClose, upload: null },
  NameEditModal: { current: '', isNetwork: false, onSave() {}, onClose },
  SeriesNameModal: { current: '', count: 0, onSave() {}, onClose },
  SeriesScheduleModal: { label: 'devotional', count: 0, onApply() {}, onClear() {}, onClose },
  PinModal: { action: 'set', onClose },
  BooksRecord: { book, onRecord() {}, onClose }, BooksDonate: { onGave() {}, onClose },
  FinanceImport: { book, F, onPost() {}, onClose },
  FinanceShareStatement: { book, F, churchName: 'St Test', accent: '', logo: '', canPost: false, onPostToMembers() {}, onClose },
  StewardHelp: { onClose, initialId: 'console' },
  AnnounceCareModal: { onClose },
  StewCareChat: { reqId: 'r1', requesterPub: 'cd'.repeat(32), title: 'Care', onClose },
  MealsNeedModal: { need: null, onClose, onSaved() {}, onDeleted() {} },
  SchEventDetail: { event: { id: 'e1', title: 'Evensong', date: '2026-09-20', start: '18:00', end: '19:00' }, onClose },
  RoomBookingModal: { bk: { roomId: '', date: '2026-09-20', start: '', end: '', title: '' }, rooms: [], bookings: [], onClose },
  // feat/console-hamburger-nav adds the phone's sections drawer as a dialog. Listed here BEFORE that branch
  // merges (an audit of the two found this file red 3/3 the moment they met); an entry for a component that is
  // not in the tree is simply never looked up.
  StewSectionsMenu: { nav: [{ key: 'overview', label: 'Overview', ic: 'today' }], tab: 'overview', onPick() {}, onHelp() {}, onClose },
};
};

// Dialogs this harness cannot draw to the end. Keep in step with the PARTIAL block at the top of the file.
const EXPECTED_PARTIAL = new Set([]);
// Screens whose role="dialog" markup is behind state a single default render does not set (STATE-GATED above).
const STATE_GATED = new Set(['DashGroups', 'DashNetworksPanel']);

function drawAll() {
  const { React, fresh, flush } = fakeReact();
  // window.Steward: every method exists and does nothing, no key loaded. Context, not a decision — a dialog
  // that needs a real answer from it fails with a TypeError and is recorded as partial, never as a pass.
  const { window } = fakeBrowser({ Steward: fakeSteward() });
  const list = dialogComponents();
  const names = [...new Set(list.map(x => x.name))];
  const mods = loadConsole({ React, window, vendor: ['vendor/finance-ledger.js'], expr: '{ ' + names.join(', ') + ' }' });
  assert.equal(typeof window.FinanceLedger?.createBook, 'function', 're-anchor: vendor/finance-ledger.js no longer defines FinanceLedger.createBook');
  const PROPS = props(window.FinanceLedger);
  const results = [];
  for (const { file, name } of list.filter((x, i, a) => a.findIndex(y => y.name === x.name) === i)) {
    const Comp = mods[name];
    assert.equal(typeof Comp, 'function', name + ' is enumerated from ' + file + ' but is not a function after load');
    const props = PROPS[name];
    assert.ok(props, name + ' (' + file + ') carries role="dialog" and has no entry in PROPS — add its minimal props, or list it as partial with a reason');
    fresh();                                                       // a new hook store: nothing carries over from the previous dialog
    let err = null, tree = null;
    try { tree = Comp(props); flush(); } catch (e) { err = e; }
    const dialog = !!nodes(tree).find(n => n.props && n.props.role === 'dialog');
    results.push({ file, name, err, dialog });
  }
  return results;
}

test('no console dialog throws a ReferenceError when it renders', () => {
  const results = drawAll();
  const refs = results.filter(r => r.err && r.err.name === 'ReferenceError');   // by name: the context has its own Error realm
  const lines = refs.map(r => {
    const id = (String(r.err.message).match(/^(\w+) is not defined/) || [])[1] || '?';
    const gap = BROWSER_GLOBALS.has(id) ? ' (a browser global — a hole in console-screens.mjs, stub it there)' : ' — a free identifier in the console’s own code: the 8537ba2 class of bug';
    return '  ' + r.name + ' (' + r.file + '): ' + r.err.message + gap;
  });
  assert.equal(refs.length, 0,
    'THESE DIALOGS THROW THE MOMENT A STEWARD OPENS THEM — the console shows the error boundary instead:\n' + lines.join('\n'));
});

test('the enumeration and the partial list are honest in both directions', () => {
  const results = drawAll();
  assert.ok(results.length >= 30, 'only ' + results.length + ' dialogs enumerated — the role="dialog" scan has lost most of the console; re-anchor');
  assert.ok(results.some(r => r.name === 'StewBackupModal'), 'StewBackupModal is no longer enumerated — the scan misses the dialog this test was written for');
  const partial = results.filter(r => r.err).map(r => r.name + ': ' + r.err.name + ': ' + String(r.err.message).slice(0, 90));
  const unexpected = partial.filter(p => !EXPECTED_PARTIAL.has(p.split(':')[0]));
  assert.deepEqual(unexpected, [],
    'these dialogs no longer render to the end in this harness — a ReferenceError would have failed the test above, ' +
    'so this is a missing stub or a new prop. Either supply it in PROPS/console-screens.mjs or add the name to ' +
    'EXPECTED_PARTIAL and the PARTIAL block with the reason:\n  ' + unexpected.join('\n  '));
  const promoted = [...EXPECTED_PARTIAL].filter(n => !results.some(r => r.name === n && r.err));
  assert.deepEqual(promoted, [], 'these now render to the end — remove them from EXPECTED_PARTIAL and the PARTIAL block: ' + promoted.join(', '));
  const rendered = results.filter(r => !r.err).length;
  assert.ok(rendered >= results.length - EXPECTED_PARTIAL.size, 'fewer dialogs rendered than the partial list allows');
  const blank = results.filter(r => !r.err && !r.dialog && !STATE_GATED.has(r.name)).map(r => r.name);
  assert.deepEqual(blank, [],
    'these rendered without throwing but put NO role="dialog" node in their output — an early return, so their ' +
    'body was never evaluated and this test proved nothing about them. Supply the prop that opens them: ' + blank.join(', '));
  const gatedButShown = [...STATE_GATED].filter(n => results.some(r => r.name === n && r.dialog));
  assert.deepEqual(gatedButShown, [], 'these are listed as state-gated but rendered a dialog on the first draw — remove them from STATE_GATED: ' + gatedButShown.join(', '));
});

test('what was drawn (for the record)', (t) => {
  const results = drawAll();
  t.diagnostic(results.length + ' components enumerated; ' + results.filter(r => r.dialog).length + ' put a dialog on screen; ' +
    results.filter(r => r.err).length + ' partial; state-gated: ' + [...STATE_GATED].join(', '));
  t.diagnostic(results.map(r => r.name + (r.err ? '✗' : r.dialog ? '' : '·')).join(' '));
});
