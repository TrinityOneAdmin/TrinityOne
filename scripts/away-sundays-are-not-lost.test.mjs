// A MEMBER'S AWAY-SUNDAYS ARE NEVER DELETED FROM THE ROTA BY THE APP THAT IS MEANT TO ADD ONE.
// Run: node --test scripts/away-sundays-are-not-lost.test.mjs
//
// Audit finding, 2026-09-14. The sheet read ONE source — a local mirror — and every save REPLACES the whole
// array. So an ordinary cache wipe emptied the sheet, the member ticked one new Sunday, and the church's
// record of the Sundays they had already given was deleted, from the rota, with a success toast.
//
// The fix asks the church what it holds. The load-bearing half is that a read nobody answered is NOT the
// same as "you have told them nothing" — that conflation is the shape that armed the relay doc-wipe (B0),
// and here it would arm the same replace-with-nothing.
//
// ⚠ THE SHEET IS RENDERED AND ITS CONTROLS ARE PRESSED. app/*.jsx ships unbundled, so a test that matched
// its text would pass with the whole branch disabled (CLAUDE.md rule 3) — which is exactly why the existing
// scripts/unavail-roundtrip.test.mjs could not see this.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadScreen, miniReact, texts } from './render-jsx-screen.mjs';

const Stub = (n) => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };
const reads = (t) => texts(t).join(' ').replace(/\s+/g, ' ').trim();
function find(n, pred, out = []) {
  if (!n || typeof n !== 'object') return out;
  if (Array.isArray(n)) { n.forEach(c => find(c, pred, out)); return out; }
  if (pred(n)) out.push(n);
  (n.kids || []).forEach(c => find(c, pred, out));
  return out;
}
const button = (tree, label) => find(tree, n => n.type === 'button' && texts(n).join(' ').includes(label));

// `saveFails` is the REASON setUnavailable throws with, or null for a save that works. The engine attaches
// it (`_pubReason`) precisely so this sheet can tell "nothing left the phone" from "nobody answered" — two
// outcomes that need opposite sentences.
function sheet({ mirror = [], church = null, complete = true, saveFails = null } = {}) {
  const { React, draw } = miniReact();
  const saved = [];
  const toasts = [];
  const globals = {
    React,
    window: { addEventListener() {}, removeEventListener() {}, dispatchEvent() {}, innerWidth: 390,
      matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) },
    document: { addEventListener() {}, removeEventListener() {}, createElement: () => ({ style: {}, appendChild() {}, remove() {}, click() {} }), body: { appendChild() {}, removeChild() {} } },
    navigator: { userAgent: '' },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {}, console,
    Icon: Stub('Icon'), IconBtn: Stub('IconBtn'), UserAvatar: Stub('UserAvatar'), ChurchBadge: Stub('ChurchBadge'),
    Overlay: function Overlay(p) { return React.createElement('div', {}, p.open ? p.children : null); },
    BottomSheet: ({ open, children }) => (open ? children : null),
    safeCssColor: (c) => c, lsGet: (k, d) => d, lsSet: () => {}, todayISO: () => '2026-09-14',
    Math, Date, JSON, Set, Map, Number, String, Array, Promise, Object, isNaN, Boolean, parseInt, parseFloat,
  };
  const mod = loadScreen('app/screens-serving.jsx', ['UnavailSheet'], globals);
  const ctx = {
    church: { id: 'c1', name: "St Chad's", npub: 'c'.repeat(64) },
    getUnavailableDates: () => mirror,
    readUnavailableDates: () => Promise.resolve({ dates: church === null ? [] : church, complete }),
    setUnavailableDates: (d) => {
      saved.push(d);
      if (!saveFails) return Promise.resolve({});
      const e = new Error('publish failed'); e.reason = saveFails;
      return Promise.reject(e);
    },
    toast: (m) => toasts.push(m),
    joinState: { isPending: false },
  };
  const api = { saved, toasts, ctx };
  api.redraw = () => { api.tree = draw(mod.UnavailSheet, { open: true, onClose() {}, ctx }); return api.tree; };
  api.redraw();
  api.settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); return api.redraw(); };
  api.press = async (label) => {
    const b = button(api.tree, label);
    assert.equal(b.length, 1, 'expected one control reading ' + JSON.stringify(label) + ', found ' + b.length);
    b[0].props.onClick();
    for (let i = 0; i < 8; i++) await Promise.resolve();
    return api.redraw();
  };
  return api;
}

test('THE CHURCH IS ASKED, AND ITS ANSWER IS WHAT THE MEMBER SEES', async () => {
  // The mirror is empty — wiped — but the church holds two Sundays. The sheet must show the church's.
  const s = sheet({ mirror: [], church: ['2026-09-20', '2026-09-27'] });
  await s.settle();
  const t = reads(s.tree);
  assert.match(t, /Mark 2 away|2 Sundays/i,
    'THE SHEET SHOWS THE PHONE’S EMPTY COPY RATHER THAN WHAT THE CHURCH ACTUALLY HOLDS — so the member ' +
    'believes they have told nobody. Read: ' + t);
});

test('SAVING DOES NOT DELETE WHAT THE CHURCH ALREADY HOLDS', async () => {
  // THE DEFECT, end to end. The mirror is empty — wiped — and the church holds two Sundays. Every save
  // REPLACES the whole array, so if the sheet is working from the empty mirror, pressing save sends [] or a
  // single new date and the rota loses both.
  // ⚠ NOTHING IS TICKED HERE ON PURPOSE. My first version ticked a day to model "adding a third" and picked
  // one that was ALREADY selected, so it toggled it OFF and the test failed for its own reason rather than
  // the code's. The property does not need a new date: if the sheet has loaded what the church holds, a
  // plain save must send it back intact.
  const s = sheet({ mirror: [], church: ['2026-09-20', '2026-09-27'] });
  await s.settle();
  const b = button(s.tree, 'away');
  assert.equal(b.length, 1, 're-anchor: no save control — the sheet did not load the church\u2019s dates at all');
  b[0].props.onClick();
  for (let i = 0; i < 8; i++) await Promise.resolve();
  assert.equal(s.saved.length, 1, 're-anchor: nothing was saved');
  assert.deepEqual(s.saved[0].slice().sort(), ['2026-09-20', '2026-09-27'],
    'SAVING DELETED THE SUNDAYS THE CHURCH ALREADY HELD. The phone\u2019s copy was empty and the sheet wrote ' +
    'that emptiness back over the rota. Sent: ' + JSON.stringify(s.saved[0]));
});

test('A READ NOBODY ANSWERED REFUSES TO SAVE, AND SAYS WHY', async () => {
  // The load-bearing half. Offline, or a silent relay: the sheet cannot know what the church holds, so
  // writing would replace it with whatever the wiped mirror happened to show.
  const s = sheet({ mirror: [], church: null, complete: false });
  await s.settle();
  const b = button(s.tree, 'away').concat(button(s.tree, 'Choose dates'));
  if (b.length) { b[0].props.onClick(); for (let i = 0; i < 8; i++) await Promise.resolve(); s.redraw(); }
  assert.deepEqual(s.saved, [],
    'THE SHEET SAVED WHILE IT COULD NOT SEE WHAT THE CHURCH HOLDS. Every save replaces the whole list, so ' +
    'this deletes dates the member already gave.');
  assert.match(reads(s.tree), /couldn’t check|could not check/i,
    'it refused silently — the member is left thinking nothing happened rather than told why');
});

test('…and when the read DOES answer, saving works normally', async () => {
  // Re-anchor: the guard must not be a blanket refusal that blocks the feature.
  const s = sheet({ mirror: ['2026-09-20'], church: ['2026-09-20'] });
  await s.settle();
  const b = button(s.tree, 'away');
  assert.equal(b.length, 1, 're-anchor: no save control rendered');
  b[0].props.onClick();
  for (let i = 0; i < 8; i++) await Promise.resolve();
  assert.equal(s.saved.length, 1, 'a confirmed read still could not save — the guard is blocking the feature');
});

// ── AND THE OPPOSITE LIE: "nothing was saved" over a save that very probably LANDED ───────────────────────
//
// Added 2026-09-16. The catch in this sheet said "That didn't reach your church, so nothing was saved" for
// all three failure outcomes at once. When nobody ANSWERED, the document is signed, on the wire, and usually
// lands a moment later — so the member is told the rota does not know about Sundays it already knows about,
// and goes and tells their leader out of band. A wrong failure message sends somebody to redo work already
// done, which is why it is worse than no message.
//
// Re-saving is safe and the wording says so: every save replaces the whole list at the fixed d-tag
// `unavail:<me>` and the ticks have not changed, so pressing Save again writes exactly the same dates.
async function saveAndRead(s) {
  await s.settle();
  const b = button(s.tree, 'away').concat(button(s.tree, 'Clear all'));
  assert.ok(b.length, 're-anchor: no save control rendered');
  b[0].props.onClick();
  for (let i = 0; i < 12; i++) await Promise.resolve();
  return reads(s.redraw());
}

test('a save NOBODY ANSWERED is not reported as "nothing was saved"', async () => {
  const s = sheet({ mirror: ['2026-09-20'], church: ['2026-09-20'], saveFails: 'unconfirmed' });
  const t = await saveAndRead(s);
  assert.match(t, /couldn’t confirm|could not confirm/i,
    'the sheet still claims a settled failure over a save nobody answered for. Read: ' + t);
  assert.doesNotMatch(t, /nothing was saved/i,
    'it is still telling the member the rota does not know, over dates the rota very probably has. Read: ' + t);
});

test('CONTROL: a save that genuinely never left the phone still says nothing was saved', async () => {
  // Without this row, "always say we couldn’t confirm" would pass the one above — and softening a settled
  // failure is the dangerous direction: the member stops worrying about dates the church never received.
  const s = sheet({ mirror: ['2026-09-20'], church: ['2026-09-20'], saveFails: 'not-sent' });
  const t = await saveAndRead(s);
  assert.match(t, /nothing was saved/i,
    'a save that reached no relay at all is being softened into "it may well have". Read: ' + t);
});

test('CONTROL: a save that WORKED reports no failure at all', async () => {
  const s = sheet({ mirror: ['2026-09-20'], church: ['2026-09-20'] });
  const t = await saveAndRead(s);
  assert.doesNotMatch(t, /couldn’t confirm|nothing was saved/i,
    'a successful save is reporting a failure — the opposite lie again. Read: ' + t);
});
