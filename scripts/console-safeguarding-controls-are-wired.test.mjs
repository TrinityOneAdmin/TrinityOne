// THE TWO SAFEGUARDING CONTROLS ON A MEMBER'S ROW MUST ACTUALLY BE WIRED TO THE ENGINE BEHIND THEM.
//   Run: node --test scripts/console-safeguarding-controls-are-wired.test.mjs
//
// CLAUDE.md rule 1, in its plainest form: "a well-tested engine nobody is required to consult is not a
// feature." An audit on 2026-09-01 sabotaged the shipped console and ran the WHOLE suite. Replacing
//
//     <button onClick={() => toggleMinor(m.pubkey)} aria-label={… 'Mark as a child: ' …}>
//   with
//     <button onClick={() => {}} …>
//
// produced ZERO test failures across every file in scripts/. The button still reads "Child", the tooltip
// still explains what it does, and pressing it writes nothing. `minors:<churchpub>` is the document the
// relay's minorOf() reads before it decides anything at all — which rooms a young person is served, whether
// an adult may DM them, whether they may volunteer for the care rota, whether their photograph is
// suppressed — so a church that marks its under-18s on a console with that one expression broken has NO
// safeguarding whatsoever, on every device, with a green suite. It is the worst of the twelve gaps that
// round found, and nothing anywhere pressed that button.
//
// The second gap is the sibling control, and it is subtler. toggleApproved refuses to clear a member who is
// marked as a child — Rev. Miriam cleared Ivy, aged six, by mis-tapping an unnamed row — and the guard is
//     if (!approvedSet.has(pk) && minorsSet.has(pk)) { …tell the steward…; return null; }
// Put `false &&` in front of that condition and a child can be cleared for youth work from the console
// again. NOTE WHAT THAT DEFEATS: app/*.jsx ships UNBUNDLED (CLAUDE.md rule 3), so `false && ` leaves every
// word of the condition, the message and the comment in the file. Any assertion that matches text in this
// file still passes. So nothing here matches text: the row is RENDERED, the control is found by its
// ACCESSIBLE NAME, its handler is invoked, and what reached window.Steward is what is asserted.
//
// WHAT IS REAL HERE. `memberRow`, `toggleMinor` and `toggleApproved` are sliced out of the shipped
// app/stew-dashboard.jsx by brace-match (scripts/test-slice.mjs), compiled together with the same esbuild
// the packaged build uses, and run in one scope — so the button's onClick calls the real toggle, which calls
// the injected window.Steward. Everything else on the row (SkPill, SkBadge, Icon) is furniture and is
// stubbed; a name the row needs and this file does not supply is a ReferenceError at the point of use,
// deliberately.
//
// MEASURED RED/GREEN, 2026-09-01, each sabotage scoped to the enclosing function and verified to occur
// exactly once inside it before the edit:
//   · the shipped console                                                     7 pass / 0 fail
//   · "Mark as a child" onClick -> `onClick={() => {}}`                       5 pass / 2 fail
//   · toggleApproved's guard -> `if (false && !approvedSet.has(pk) && …) {`   5 pass / 2 fail
// The runner slices the enclosing function (memberRow, toggleApproved), asserts the anchor occurs exactly
// once inside it, replaces it there, runs this file, and restores the source byte-for-byte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fnBody } from './test-slice.mjs';
import { miniReact, find } from './render-jsx-screen.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const STEW = readFileSync(join(ROOT, 'app/stew-dashboard.jsx'), 'utf8');

const PK = 'bramhexpubkey';
const NAME = 'Bram Whitlock';

// Compile a set of slices from stew-dashboard.jsx together, with `globals` in scope, and hand back the named
// declarations. Same mechanism as scripts/a-dm-that-never-sent-is-not-sent.test.mjs: a temp .jsx through the
// real esbuild, then a data: module. The slices go in ONE file so memberRow's onClick closes over the REAL
// toggleMinor / toggleApproved rather than over a mock of the decision under test.
async function loadSlices(anchors, exportNames, globals) {
  const src = anchors.map(([anchor, what]) => fnBody(STEW, anchor, what)).join('\n');
  const tmp = join(tmpdir(), 'sgwired-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.jsx');
  let js;
  try {
    writeFileSync(tmp, src + `\nexport { ${exportNames.join(', ')} };\n`);
    js = execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [tmp, '--jsx=transform', '--format=esm', '--log-level=error'], { encoding: 'utf8' });
  } finally { rmSync(tmp, { force: true }); }
  const key = '__sgwired_' + Math.random().toString(36).slice(2);
  globalThis[key] = globals;
  const preamble = Object.keys(globals).map(k => `const ${k} = globalThis.${key}.${k};`).join('\n');
  return await import('data:text/javascript;base64,' + Buffer.from(preamble + '\n' + js).toString('base64'));
}

const Stub = (n) => { const f = function () { return null; }; Object.defineProperty(f, 'name', { value: n }); return f; };

// One member's row, drawn the way the Members panel draws it, over a church whose safeguarding state we set.
async function memberRowFor({ minor = false, cleared = false }) {
  const { React } = miniReact();
  const calls = { minors: [], approved: [], nophoto: [], reseal: [], notice: [], blocked: [] };
  const sg = {
    loaded: true, clearedKnown: true, cleared: {},
    minors: minor ? [PK] : [],
    approved: cleared ? [PK] : [],
    nophoto: [],
  };
  const win = {
    Steward: {
      setMinors: (l) => { calls.minors.push(l); return true; },
      setApproved: (l, o) => { calls.approved.push([l, o]); return true; },
      setNoPhoto: (l) => { calls.nophoto.push(l); return true; },
    },
    dispatchEvent: (e) => { calls.blocked.push(e); return true; },
  };
  const mod = await loadSlices(
    [['const toggleMinor = (pk) => {', 'toggleMinor'],
     ['const toggleApproved = (pk) => {', 'toggleApproved'],
     ['const memberRow = (m, inactive) => {', 'memberRow']],
    ['memberRow'],
    {
      React, window: win, CustomEvent, Promise,
      // toggleMinor / toggleApproved
      sg, minorsSet: new Set(sg.minors), approvedSet: new Set(sg.approved), nophotoSet: new Set(sg.nophoto),
      kidPhotosAllowed: false,
      setMinorNotice: (n) => calls.notice.push(n),
      _reseal: (...a) => calls.reseal.push(a),
      // the row's own furniture — none of it is the control under test
      nameByPub: { [PK]: NAME }, guardians: {}, parentSet: new Set(),
      minorNotice: null, delegated: false, photosAllowed: false,
      SkBadge: Stub('SkBadge'), SkPill: Stub('SkPill'), Icon: Stub('Icon'),
      SK_TINT: { gold: { fg: '#000' }, sage: { fg: '#000' }, clay: { fg: '#000' }, ink: { fg: '#000' } },
      nameHandle: () => '', shortNpub: () => 'npub1abc…', ago: () => 'a while ago',
      doCopy: () => {}, copied: null, confirmBlock: null, block: () => {}, setConfirmBlock: () => {},
      setLinkChild: () => {}, setReseatFor: () => {}, toggleNoPhoto: () => {},
      stewCapState: () => ({ allowed: false }),
    });
  const tree = mod.memberRow({ pubkey: PK, npub: 'npub1abc', name: NAME, count: 3, lastTs: 1, joined: 1 }, false);
  const byLabel = (starts) => {
    const hits = find(tree, n => n.type === 'button' && String((n.props || {})['aria-label'] || '').startsWith(starts));
    assert.equal(hits.length, 1,
      `the member row no longer carries exactly one control whose accessible name starts "${starts}" ` +
      `(found ${hits.length}) — re-anchor this test rather than deleting it`);
    return hits[0];
  };
  return { tree, calls, byLabel };
}

// ── the premise ────────────────────────────────────────────────────────────────────────────────────────────
test('CONTROL: a member’s row carries both safeguarding controls, each naming the person', async () => {
  // Miriam's original complaint was that every row's button read the same words with nothing naming the
  // person; if that regressed, the two tests below would be pressing an unidentifiable control.
  const r = await memberRowFor({});
  assert.equal(r.byLabel('Mark as a child: ').props['aria-label'], 'Mark as a child: ' + NAME);
  assert.equal(r.byLabel('Clear for youth work: ').props['aria-label'], 'Clear for youth work: ' + NAME);
});

// ── gap 1: the mark control ────────────────────────────────────────────────────────────────────────────────
test('PRESSING “Mark as a child” PUBLISHES THE CHILD MARK — the one expression every other gate rests on', async () => {
  const r = await memberRowFor({});
  r.byLabel('Mark as a child: ').props.onClick();
  assert.equal(r.calls.minors.length, 1,
    'the steward pressed “Mark as a child” on ' + NAME + ' and NOTHING was published. `minors:<churchpub>` is ' +
    'what the relay’s minorOf() reads before it decides which rooms a young person is served, whether an ' +
    'adult may DM them, whether they may join the care rota, and whether their photograph is suppressed. ' +
    'A church whose console has this one expression broken has no safeguarding at all, and the screen ' +
    'still says “Child”');
  assert.deepEqual(r.calls.minors[0], [PK], 'the mark was published without the member it was pressed on');
});

test('…and pressing it again UNMARKS them, so the control is a toggle and not a one-way write', async () => {
  const r = await memberRowFor({ minor: true });
  r.byLabel('Unmark as a child: ').props.onClick();
  assert.equal(r.calls.minors.length, 1, 'unmarking a child published nothing — the mark can never be corrected');
  assert.deepEqual(r.calls.minors[0], [], 'the member is still on the published list of children after unmarking');
});

// ── gap 2: a child may not be cleared for youth work ───────────────────────────────────────────────────────
test('A MEMBER MARKED AS A CHILD CANNOT BE CLEARED FOR YOUTH WORK FROM THE ROW', async () => {
  const r = await memberRowFor({ minor: true });
  r.byLabel('Clear for youth work: ').props.onClick();
  assert.deepEqual(r.calls.approved, [],
    'a member marked as a child was written onto the church’s CLEARED-ADULTS list. The two documents now ' +
    'disagree, and the danger is the correction: unmark the child and the stale clearance is all that ' +
    'remains — measured, a six-year-old then privately messaged another child');
});

test('…and the steward is TOLD why, rather than left believing the press landed', async () => {
  const r = await memberRowFor({ minor: true });
  r.byLabel('Clear for youth work: ').props.onClick();
  assert.equal(r.calls.blocked.length, 1,
    'the press did nothing and said nothing. Miriam: “not a word of objection that I was clearing a child ' +
    'I had marked as a child two minutes earlier”');
  const detail = r.calls.blocked[0].detail || {};
  assert.match(String(detail.message || ''), new RegExp(NAME),
    'the refusal does not name the person it is about, which is the fault it exists to correct');
  assert.match(String(detail.message || ''), /child/i, 'the refusal does not say why it refused');
});

test('AN ADULT IS STILL CLEARED — the guard refuses children, not everybody', async () => {
  // Without this, the two tests above pass just as well over a control that is dead, or a guard that always
  // refuses. This is the half that says the screen still does its ordinary job.
  const r = await memberRowFor({});
  r.byLabel('Clear for youth work: ').props.onClick();
  assert.equal(r.calls.approved.length, 1,
    'a church can no longer clear anybody for youth work from the members screen');
  assert.deepEqual(r.calls.approved[0][0], [PK], 'the clearance was published without the member it was pressed on');
});

test('…and a cleared adult’s clearance can still be REMOVED, marked as a child or not', async () => {
  // The guard is entry-only (`!approvedSet.has(pk) && …`). If it ever became symmetric, a church that had
  // cleared somebody and then discovered they were 15 could not take the clearance away — the worst
  // direction to lock.
  const r = await memberRowFor({ minor: true, cleared: true });
  r.byLabel('Remove youth clearance from ').props.onClick();
  assert.equal(r.calls.approved.length, 1,
    'a clearance held by somebody now marked as a child cannot be removed from the console');
  assert.deepEqual(r.calls.approved[0][0], [], 'the member is still on the published cleared list after removal');
});
